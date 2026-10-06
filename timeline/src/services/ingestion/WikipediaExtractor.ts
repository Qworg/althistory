/**
 * Wikipedia extractor (spec Req 7).
 *
 * Fetches article wikitext through the MediaWiki `action=parse` API and pulls
 * dated facts from two places:
 *   - infobox fields (`date`, `birth_date`, `founded`, ...), treated as the
 *     more reliable structured source;
 *   - dates in cleaned prose, using the shared text patterns.
 *
 * Link following crawls linked main-namespace articles breadth-first, bounded
 * by `linkDepth` (max 3, per the spec) and `maxPages`, with an optional regex
 * filter applied to link titles. Only the root page's infoboxes are used;
 * followed pages contribute prose events, which keeps page parsing cheap and
 * avoids duplicating the same infobox fields.
 *
 * All fetching goes through the injected {@link HttpClient}; the recorded
 * fixture in `fixtures/wikipedia-battle-of-hastings.json` exercises this class
 * with no network.
 */

import { DataSource } from '../ExportService';
import { HttpClient, JsonValue, parseJsonBody } from './http';
import { newTempId } from './ids';
import { extractCapitalizedEntities, extractDates, splitSentences } from './text-patterns';
import {
  ExtractedEvent,
  ExtractionContext,
  ExtractionResult,
  Extractor,
  WikipediaExtractionInput,
} from './types';
import { patternConfidence } from './TextExtractor';

const MAX_LINK_DEPTH = 3;
const DEFAULT_MAX_PAGES = 5;
const HARD_PAGE_LIMIT = 50;

export interface WikipediaExtractorDeps {
  httpClient: HttpClient;
  now?: () => Date;
}

export interface WikipediaTarget {
  host: string;
  title: string;
}

interface WikipediaPage {
  title: string;
  wikitext: string;
  links: string[];
}

const INFOBOX_DATE_FIELDS = new Set([
  'date',
  'event_date',
  'date_event',
  'birth_date',
  'death_date',
  'founded',
  'established',
  'dissolved',
  'start_date',
  'end_date',
]);

/**
 * Parse a Wikipedia article URL into host and title. Accepts `/wiki/Title` and
 * `?title=Title`. Rejects non-Wikipedia hosts before any request is made.
 */
export function parseWikipediaUrl(rawUrl: string): WikipediaTarget {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid Wikipedia URL: ${rawUrl}`);
  }

  const host = parsed.hostname.toLowerCase();
  const isWikipedia = host === 'wikipedia.org' || host.endsWith('.wikipedia.org');
  if (!isWikipedia) {
    throw new Error(`Not a Wikipedia URL: ${parsed.hostname}`);
  }

  let title = '';
  if (parsed.pathname.startsWith('/wiki/')) {
    title = decodeURIComponent(parsed.pathname.slice('/wiki/'.length));
  } else {
    title = parsed.searchParams.get('title') ?? '';
  }

  title = title.replace(/_/g, ' ').trim();
  if (!title) {
    throw new Error(`Could not determine article title from URL: ${rawUrl}`);
  }

  return { host, title };
}

/**
 * Read `parse.wikitext` and `parse.links` from a MediaWiki response. Supports
 * both `formatversion=2` (string fields) and the legacy shape where the value
 * is an object with a `*` key.
 */
export function parseWikipediaPagePayload(payload: JsonValue, fallbackTitle: string): WikipediaPage {
  if (!isJsonObject(payload)) {
    throw new Error('Wikipedia API: unexpected response shape');
  }
  const error = payload.error;
  if (isJsonObject(error)) {
    throw new Error(`Wikipedia API error: ${String(error.code ?? 'unknown')}`);
  }

  const parse = payload.parse;
  if (!isJsonObject(parse)) {
    throw new Error('Wikipedia API: response did not contain a parse object');
  }

  const title = typeof parse.title === 'string' ? parse.title : fallbackTitle;
  const wikitext = readStringOrStar(parse.wikitext);
  const links = Array.isArray(parse.links)
    ? parse.links
        .map((link) => {
          if (typeof link === 'string') return link;
          if (!isJsonObject(link)) return '';
          // formatversion=2 uses `title`; the legacy shape uses `*`.
          if (typeof link.title === 'string') return link.title;
          return readStringOrStar(link);
        })
        .filter((link) => link.length > 0)
    : [];

  return { title, wikitext, links };
}

function isJsonObject(value: JsonValue | undefined): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readStringOrStar(value: JsonValue | undefined): string {
  if (typeof value === 'string') return value;
  if (isJsonObject(value) && typeof value['*'] === 'string') return value['*'];
  return '';
}

/** Strip the wiki markup that would otherwise leak into entity text. */
export function cleanWikiText(value: string): string {
  return value
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/\{\{[\s\S]*?\}\}/g, '')
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Find every `{{name ...}}` template, matching nested braces. */
export function extractTemplates(text: string, name: string): string[] {
  const results: string[] = [];
  const marker = new RegExp(`\\{\\{\\s*${name}\\b`, 'gi');
  let match: RegExpExecArray | null;
  while ((match = marker.exec(text)) !== null) {
    const start = match.index;
    let depth = 0;
    let index = start;
    while (index < text.length) {
      if (text.startsWith('{{', index)) {
        depth += 1;
        index += 2;
      } else if (text.startsWith('}}', index)) {
        depth -= 1;
        index += 2;
        if (depth === 0) {
          results.push(text.slice(start, index));
          break;
        }
      } else {
        index += 1;
      }
    }
  }
  return results;
}

function parseTemplateFields(template: string): Record<string, string> {
  const inner = template.slice(2, -2);
  const fields: Record<string, string> = {};
  for (const match of inner.matchAll(/\|\s*([A-Za-z0-9_]+)\s*=\s*([^|\n]*)/g)) {
    fields[match[1].toLowerCase()] = match[2].trim();
  }
  return fields;
}

function fieldLabel(field: string): string {
  return field.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

export class WikipediaExtractor implements Extractor<WikipediaExtractionInput> {
  readonly sourceType = 'wikipedia' as const;
  private readonly httpClient: HttpClient;
  private readonly now: () => Date;

  constructor(deps: WikipediaExtractorDeps) {
    this.httpClient = deps.httpClient;
    this.now = deps.now ?? (() => new Date());
  }

  async extract(input: WikipediaExtractionInput, context?: ExtractionContext): Promise<ExtractionResult> {
    const target = parseWikipediaUrl(input.url);
    const options = input.options ?? {};
    const followLinks = options.followLinks === true;
    const linkDepth = Math.max(0, Math.min(MAX_LINK_DEPTH, options.linkDepth ?? 0));
    const maxPages = Math.max(1, Math.min(HARD_PAGE_LIMIT, options.maxPages ?? DEFAULT_MAX_PAGES));
    const linkFilter = options.linkFilter ? compileLinkFilter(options.linkFilter) : null;

    const visited = new Set<string>();
    const queue: Array<{ title: string; depth: number }> = [{ title: target.title, depth: 0 }];
    const allEvents: ExtractedEvent[] = [];
    const sources: DataSource[] = [];
    const seen = new Set<string>();
    let pagesFetched = 0;

    while (queue.length > 0 && pagesFetched < maxPages) {
      const current = queue.shift();
      if (!current) break;
      const key = current.title.toLowerCase();
      if (visited.has(key)) continue;
      visited.add(key);

      const page = await this.fetchPage(target.host, current.title);
      pagesFetched += 1;

      const articleUrl = `https://${target.host}/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`;
      const pageEvents =
        current.depth === 0
          ? this.extractFromArticle(page, articleUrl, context)
          : this.extractFromProse(page, articleUrl, context);

      for (const event of pageEvents) {
        const dedupe = `${event.description}\u0000${event.timestamp}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        allEvents.push(event);
      }

      sources.push({
        id: `wikipedia-${pagesFetched}`,
        type: 'wikipedia',
        url: articleUrl,
        accessedAt: this.now().toISOString(),
        confidence: averageConfidence(pageEvents),
        entityIds: pageEvents.map((event) => event.tempId),
      });

      if (followLinks && current.depth < linkDepth) {
        for (const link of this.selectLinks(page.links, linkFilter)) {
          if (!visited.has(link.toLowerCase())) {
            queue.push({ title: link, depth: current.depth + 1 });
          }
        }
      }
    }

    return {
      events: allEvents,
      arcs: [],
      relationships: [],
      sources,
      overallConfidence: averageConfidence(allEvents),
    };
  }

  private async fetchPage(host: string, title: string): Promise<WikipediaPage> {
    const apiUrl =
      `https://${host}/w/api.php?action=parse&prop=wikitext%7Clinks` +
      `&page=${encodeURIComponent(title)}&format=json&formatversion=2&redirects=1`;
    const response = await this.httpClient.request({
      url: apiUrl,
      headers: { 'User-Agent': 'AlthistoryIngestion/1.0 (local research tool)' },
    });
    const payload = parseJsonBody(response.body, 'Wikipedia API');
    return parseWikipediaPagePayload(payload, title);
  }

  private selectLinks(links: string[], filter: RegExp | null): string[] {
    if (!filter) return links;
    return links.filter((link) => filter.test(link));
  }

  private extractFromArticle(
    page: WikipediaPage,
    articleUrl: string,
    context?: ExtractionContext
  ): ExtractedEvent[] {
    const events = this.extractFromInfoboxes(page, articleUrl);
    events.push(...this.extractFromProse(page, articleUrl, context));
    return events;
  }

  private extractFromInfoboxes(page: WikipediaPage, articleUrl: string): ExtractedEvent[] {
    const extractedAt = this.now().toISOString();
    const events: ExtractedEvent[] = [];

    for (const template of extractTemplates(page.wikitext, 'Infobox')) {
      const fields = parseTemplateFields(template);
      const place = fields.place ? cleanWikiText(fields.place) : '';

      for (const [field, rawValue] of Object.entries(fields)) {
        if (!INFOBOX_DATE_FIELDS.has(field)) continue;
        const value = cleanWikiText(rawValue);
        const dates = extractDates(value);
        if (dates.length === 0) continue;
        const date = dates[0];
        const target = place || cleanWikiText(fields.conflict ?? '') || page.title;

        events.push({
          tempId: newTempId('wiki'),
          description: `${page.title} — ${fieldLabel(field)}: ${value}`,
          actor: page.title,
          target,
          timestamp: date.iso,
          confidence: 0.85,
          source: { type: 'wikipedia', url: articleUrl, articleTitle: page.title, extractedAt },
          selected: true,
          edited: false,
        });
      }
    }

    return events;
  }

  private extractFromProse(
    page: WikipediaPage,
    articleUrl: string,
    context?: ExtractionContext
  ): ExtractedEvent[] {
    const extractedAt = this.now().toISOString();
    const prose = cleanWikiText(stripSectionHeadings(page.wikitext));
    const events: ExtractedEvent[] = [];

    for (const sentence of splitSentences(prose)) {
      const dates = extractDates(sentence);
      if (dates.length === 0) continue;

      const entities = extractCapitalizedEntities(sentence);
      const actor = context?.defaultActors?.[0] ?? page.title;
      const target = entities.find((entity) => entity !== page.title) ?? page.title;
      const date = dates[0];

      events.push({
        tempId: newTempId('wiki'),
        description: sentence,
        actor,
        target,
        timestamp: date.iso,
        confidence: patternConfidence(date.precision, actor.length > 0, target.length > 0),
        source: { type: 'wikipedia', url: articleUrl, articleTitle: page.title, extractedAt },
        selected: true,
        edited: false,
      });
    }

    return events;
  }
}

function stripSectionHeadings(wikitext: string): string {
  return wikitext.replace(/^=+.*?=+\s*$/gm, '');
}

function compileLinkFilter(pattern: string): RegExp {
  try {
    return new RegExp(pattern, 'i');
  } catch {
    throw new Error(`Invalid link filter pattern: ${pattern}`);
  }
}

function averageConfidence(events: ExtractedEvent[]): number {
  if (events.length === 0) return 0;
  return events.reduce((sum, event) => sum + event.confidence, 0) / events.length;
}
