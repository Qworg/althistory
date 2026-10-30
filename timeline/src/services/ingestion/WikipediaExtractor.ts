/**
 * Wikipedia extractor (spec Req 7).
 *
 * Fetches article wikitext through the MediaWiki `action=parse` API and pulls
 * dated facts from two places:
 *   - infobox fields (`date`, `birth_date`, `founded`, ...), treated as the
 *     more reliable structured source;
 *   - dates in cleaned prose, using the shared text patterns.
 *
 * Infobox parsing is template-aware. Fields are split on top-level `|` only, so
 * a value that contains a nested template or a piped wikilink is read whole
 * instead of being cut at the first `|`: the recorded "Battle of Hastings"
 * infobox has `| location = [[Rape of Hastings|Hailesaltede]], ...` and
 * `| commander1 = {{Plainlist|...}}`. Date-bearing templates
 * (`{{birth date|df=y|1815|12|10}}`, `{{death date and age|...}}`,
 * `{{start date|...}}`) are rendered to `D Month YYYY` text before the shared
 * date patterns run, because real articles carry an infobox date both as plain
 * text (`| date = 14 October 1066`) and as one of those templates (the recorded
 * "Ada Lovelace" infobox is the template case).
 *
 * Link following crawls linked articles breadth-first, bounded by `linkDepth`
 * (max 3, per the spec) and `maxPages`. Links are restricted to the article
 * (main) namespace by the parser, which keeps only link entries reporting
 * `ns: 0`: a Category, Template, File, Wikipedia or other project page is not an
 * article to follow. (The namespace cannot be filtered server-side here:
 * `action=parse&prop=links` rejects a `plnamespace` parameter as unrecognized,
 * so the client-side filter is the whole of the check.) The optional `linkFilter`
 * regex is compiled from user input, so it first passes
 * {@link assertSafeLinkFilter}; that guard is a heuristic narrowing against the
 * classic catastrophic-backtracking shapes, not a proof that every accepted
 * pattern runs in linear time. Only the root page's infoboxes are used; followed
 * pages contribute prose events, which keeps page parsing cheap and avoids
 * duplicating the same infobox fields.
 *
 * All fetching goes through the injected {@link HttpClient}; the recorded
 * fixtures in `fixtures/wikipedia-battle-of-hastings.json` and
 * `fixtures/wikipedia-ada-lovelace.json` exercise this class with no network.
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

/** MediaWiki namespace 0 is the article (main) namespace. */
const MAIN_NAMESPACE = 0;

/** Longest accepted user-supplied `linkFilter` pattern. */
const MAX_LINK_FILTER_LENGTH = 200;

/**
 * Templates that render to a date built from their positional arguments, in
 * `year|month|day` order (the order MediaWiki's date templates use, e.g.
 * `{{Start date|1066|10|14}}`, `{{Death date and age|1955|4|18|1879|3|14}}`).
 * `Death date and age` / `Birth date and age` put the sought date first, so the
 * leading three numbers are the right ones.
 */
const DATE_TEMPLATE_NAMES = new Set([
  'birth date',
  'birth date and age',
  'birth-date',
  'birth-date and age',
  'death date',
  'death date and age',
  'death-date',
  'death-date and age',
  'start date',
  'start date and age',
  'start-date',
  'end date',
  'end date and age',
  'end-date',
  'date',
  'dts',
  'film date',
  'birth year and age',
  'death year and age',
]);

/**
 * Templates that only wrap or format their arguments. In prose these keep their
 * content (`{{nowrap|in 1066}}` -> `in 1066`, `{{née|Byron}}` -> `née Byron`);
 * every other unknown template is dropped in prose mode so citation templates
 * and footnotes (`{{sfn|...}}`, `{{efn|...}}`) do not leak into descriptions.
 * The list is curated and deliberately small: a template belongs here only if
 * dropping it would silently delete text a reader would have seen.
 */
const TRANSPARENT_TEMPLATE_NAMES = new Set([
  'nowrap',
  'nobr',
  'nowraplinks',
  'small',
  'smaller',
  'big',
  'lang',
  'circa',
  'quote',
  'blockquote',
  'center',
]);

/**
 * Templates whose rendering is a fixed word followed by their content, e.g.
 * `{{née|Byron}}` -> `née Byron`. The word is part of the render, so these are
 * not in {@link TRANSPARENT_TEMPLATE_NAMES}: dropping the whole invocation would
 * leave `(; 10 December 1815)` behind in a real lead sentence.
 */
const PREFIXED_TEMPLATE_NAMES = new Map<string, string>([
  ['née', 'née'],
  ['nee', 'née'],
]);

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

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
  /** Titles of linked article (main-namespace) pages. */
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
 *
 * Only main-namespace links survive: a link entry carrying an `ns` other than 0
 * is a Category, Template, File or other project page and is not an article to
 * follow. The legacy shape has no `ns`, so its namespace is unknown and those
 * entries are kept as-is; every response from a current MediaWiki includes `ns`,
 * so this is a compatibility path rather than the normal one.
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
  const links: string[] = [];

  if (Array.isArray(parse.links)) {
    for (const link of parse.links) {
      if (typeof link === 'string') {
        if (link.length > 0) links.push(link);
        continue;
      }
      if (!isJsonObject(link)) continue;
      if (typeof link.ns === 'number' && link.ns !== MAIN_NAMESPACE) continue;
      // formatversion=2 uses `title`; the legacy shape uses `*`.
      const linkedTitle = typeof link.title === 'string' ? link.title : readStringOrStar(link);
      if (linkedTitle.length > 0) links.push(linkedTitle);
    }
  }

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

/**
 * Strip the wiki markup that would otherwise leak into entity text.
 *
 * Templates go through {@link renderWikiTemplates} in prose mode first, so a
 * date inside a formatting wrapper (`{{nowrap|in 1066}}`) survives as text while
 * a citation template is removed.
 */
export function cleanWikiText(value: string): string {
  return renderWikiTemplates(
    value
      .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
      .replace(/<ref[^>]*\/>/gi, ''),
    'prose'
  )
    // `<br>` is a line break between text, so it becomes a separator rather
    // than joining the two sides together.
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Index just past the `}}` matching the `{{` at `start`, or -1 when the
 * template is never closed. Brace counting is what makes nested templates
 * (`{{a|{{b}}}}`) survive instead of being truncated at the first `}}`.
 */
function matchTemplateEnd(text: string, start: number): number {
  let depth = 0;
  let index = start;
  while (index < text.length) {
    if (text.startsWith('{{', index)) {
      depth += 1;
      index += 2;
    } else if (text.startsWith('}}', index)) {
      depth -= 1;
      index += 2;
      if (depth === 0) return index;
    } else {
      index += 1;
    }
  }
  return -1;
}

/** Find every `{{name ...}}` template, matching nested braces. */
export function extractTemplates(text: string, name: string): string[] {
  const results: string[] = [];
  const marker = new RegExp(`\\{\\{\\s*${name}\\b`, 'gi');
  let match: RegExpExecArray | null;
  while ((match = marker.exec(text)) !== null) {
    const end = matchTemplateEnd(text, match.index);
    if (end === -1) continue;
    results.push(text.slice(match.index, end));
  }
  return results;
}

/**
 * Split `text` on `separator`, ignoring separators inside `{{...}}` or `[[...]]`.
 *
 * This is the fix for infobox fields whose value contains a pipe: both
 * `| date = {{Start date|1066|10|14}}` and `| place = [[X|Y]]` would otherwise
 * be cut at the inner `|`, which is how the previous character-class scan read
 * every template-valued field as just the template opening.
 */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let templateDepth = 0;
  let linkDepth = 0;

  for (let index = 0; index < text.length; index += 1) {
    if (text.startsWith('{{', index)) {
      templateDepth += 1;
      index += 1;
      continue;
    }
    if (text.startsWith('}}', index)) {
      templateDepth = Math.max(0, templateDepth - 1);
      index += 1;
      continue;
    }
    if (text.startsWith('[[', index)) {
      linkDepth += 1;
      index += 1;
      continue;
    }
    if (text.startsWith(']]', index)) {
      linkDepth = Math.max(0, linkDepth - 1);
      index += 1;
      continue;
    }
    if (text[index] === separator && templateDepth === 0 && linkDepth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }

  parts.push(text.slice(start));
  return parts;
}

/** The innermost (deepest, earliest) template invocation, or null. */
function findInnermostTemplate(text: string): { start: number; end: number } | null {
  let searchFrom = 0;
  while (searchFrom < text.length) {
    const start = text.indexOf('{{', searchFrom);
    if (start === -1) return null;
    const end = matchTemplateEnd(text, start);
    if (end === -1) {
      // Unclosed `{{`: skip past it rather than abandoning later templates.
      searchFrom = start + 2;
      continue;
    }
    const inner = findInnermostTemplate(text.slice(start + 2, end - 2));
    if (inner) {
      return { start: start + 2 + inner.start, end: start + 2 + inner.end };
    }
    return { start, end };
  }
  return null;
}

/** Render a `{{...}}` invocation to plain text for the given mode. */
function renderTemplate(invocation: string, mode: TemplateRenderMode): string {
  const body = invocation.slice(2, -2);
  const parts = splitTopLevel(body, '|');
  const name = parts[0].trim().toLowerCase().replace(/\s+/g, ' ');
  const positional = parts
    .slice(1)
    .filter((part) => splitTopLevel(part, '=').length === 1)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (DATE_TEMPLATE_NAMES.has(name)) {
    const date = formatTemplateDate(positional);
    if (date) return date;
  }

  const prefix = PREFIXED_TEMPLATE_NAMES.get(name);
  if (prefix && positional.length > 0) return `${prefix} ${positional.join(' ')}`;

  if (mode === 'infobox') return positional.join(' ');
  if (TRANSPARENT_TEMPLATE_NAMES.has(name)) return positional.join(' ');
  return '';
}

export type TemplateRenderMode = 'infobox' | 'prose';

/**
 * Replace every template invocation in `text` with rendered content, working
 * innermost-first so nested templates resolve.
 *
 * `mode` decides what happens to a template that is not a date template:
 * `infobox` keeps its positional arguments (an infobox field is a value to
 * render), `prose` keeps them only for the transparent wrappers listed in
 * {@link TRANSPARENT_TEMPLATE_NAMES} and drops the rest.
 */
export function renderWikiTemplates(text: string, mode: TemplateRenderMode): string {
  let current = text;
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const innermost = findInnermostTemplate(current);
    if (!innermost) return current;
    const rendered = renderTemplate(current.slice(innermost.start, innermost.end), mode);
    const next = current.slice(0, innermost.start) + rendered + current.slice(innermost.end);
    if (next === current) return current;
    current = next;
  }
  return current;
}

/**
 * Render a date template's positional arguments (`year|month|day`) as
 * `D Month YYYY` or `Month YYYY` so the shared date patterns can read it.
 *
 * Returns null when the arguments are not a usable numeric date, including the
 * single-year form (`{{birth year and age|1879}}`): the extractor only reports
 * a date the source actually states, and a bare year is not matched by the
 * shared patterns unless it carries an era suffix.
 */
function formatTemplateDate(args: string[]): string | null {
  const numbers = args
    .filter((arg) => /^\d{1,4}$/.test(arg))
    .map((arg) => parseInt(arg, 10));

  if (numbers.length >= 3) {
    const [year, month, day] = numbers;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${day} ${MONTH_NAMES[month - 1]} ${year}`;
  }
  if (numbers.length === 2) {
    const [year, month] = numbers;
    if (month < 1 || month > 12) return null;
    return `${MONTH_NAMES[month - 1]} ${year}`;
  }
  return null;
}

/**
 * Read the named fields of a `{{...}}` template. Splitting happens on top-level
 * separators, so template-valued and piped-link-valued fields are read whole.
 * Positional arguments (no `=`) are ignored: infobox fields are named.
 */
export function parseTemplateFields(template: string): Record<string, string> {
  const body = template.replace(/^\{\{/, '').replace(/\}\}$/, '');
  const fields: Record<string, string> = {};

  for (const part of splitTopLevel(body, '|').slice(1)) {
    const assignment = splitTopLevel(part, '=');
    if (assignment.length < 2) continue;
    const key = assignment[0].trim().toLowerCase();
    if (!/^[a-z0-9_ -]+$/.test(key)) continue;
    fields[key] = assignment.slice(1).join('=').trim();
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
    events.push(...this.extractFromHistorySections(page, articleUrl, context));
    events.push(...this.extractFromProse(page, articleUrl, context));
    return events;
  }

  private extractFromHistorySections(
    page: WikipediaPage,
    articleUrl: string,
    context?: ExtractionContext
  ): ExtractedEvent[] {
    const extractedAt = this.now().toISOString();
    const sections = extractHistorySections(page.wikitext);
    const events: ExtractedEvent[] = [];

    for (const section of sections) {
      const cleaned = cleanWikiText(section.body);
      for (const sentence of splitSentences(cleaned)) {
        const dates = extractDates(sentence);
        if (dates.length === 0) continue;

        const entities = extractCapitalizedEntities(sentence);
        const actor = context?.defaultActors?.[0] ?? page.title;
        const target = entities.find((entity) => entity !== page.title) ?? page.title;
        const date = dates[0];
        const baseConfidence = patternConfidence(date.precision, actor.length > 0, target.length > 0);

        events.push({
          tempId: newTempId('wiki'),
          description: sentence,
          actor,
          target,
          timestamp: date.iso,
          confidence: Math.min(0.95, Number((baseConfidence + 0.05).toFixed(2))),
          source: { type: 'wikipedia', url: articleUrl, articleTitle: page.title, extractedAt },
          selected: true,
          edited: false,
        });
      }
    }

    return events;
  }

  private extractFromInfoboxes(page: WikipediaPage, articleUrl: string): ExtractedEvent[] {
    const extractedAt = this.now().toISOString();
    const events: ExtractedEvent[] = [];

    for (const template of extractTemplates(page.wikitext, 'Infobox')) {
      const fields = parseTemplateFields(template);
      // `location` is the field name the military-conflict infobox uses today;
      // `place` is the older/common one. `birth_place`/`death_place` are not
      // used: they name somewhere else than the dated event (e.g. a death
      // place on a birth row), so a row falls back to the article title instead.
      const placeField = fields.place ?? fields.location ?? '';
      const place = placeField ? cleanWikiText(renderWikiTemplates(placeField, 'infobox')) : '';

      for (const [field, rawValue] of Object.entries(fields)) {
        if (!INFOBOX_DATE_FIELDS.has(field)) continue;
        const value = cleanWikiText(renderWikiTemplates(rawValue, 'infobox'));
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

const HISTORY_HEADING_PATTERN = /\b(?:history|timeline|chronology|background|events|overview)\b/i;

export function extractHistorySections(wikitext: string): Array<{ heading: string; body: string }> {
  const headingRegex = /^(={2,3})\s*(.+?)\s*\1\s*$/gm;
  const matches: Array<{ heading: string; index: number; endOfHeading: number }> = [];
  let match: RegExpExecArray | null;

  while ((match = headingRegex.exec(wikitext)) !== null) {
    matches.push({
      heading: match[2].trim(),
      index: match.index,
      endOfHeading: match.index + match[0].length,
    });
  }

  const sections: Array<{ heading: string; body: string }> = [];
  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    if (!HISTORY_HEADING_PATTERN.test(current.heading)) continue;
    const nextStart = i + 1 < matches.length ? matches[i + 1].index : wikitext.length;
    const body = wikitext.slice(current.endOfHeading, nextStart).trim();
    if (body.length > 0) {
      sections.push({ heading: current.heading, body });
    }
  }
  return sections;
}

function stripSectionHeadings(wikitext: string): string {
  return wikitext.replace(/^=+.*?=+\s*$/gm, '');
}

/** Shapes that make a regex backtrack catastrophically on a long input. */
const UNSAFE_LINK_FILTER_SHAPES: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /\([^()]*[+*}][^()]*\)\s*(?:[+*]|\{\d+(?:,\d*)?\})/, reason: 'a quantifier on a group that is itself quantified' },
  { pattern: /\([^()]*\|[^()]*\)\s*(?:[+*]|\{\d+(?:,\d*)?\})/, reason: 'a quantifier on an alternation group' },
  { pattern: /\\[1-9]/, reason: 'a backreference' },
];

/**
 * Heuristic safety check for a user-supplied link filter.
 *
 * Rejects the well-known catastrophic-backtracking shapes (nested quantifiers,
 * a quantifier over an alternation, backreferences) and over-long patterns. This
 * is a narrowing, not a proof: a pattern that avoids these shapes but still
 * backtracks badly would pass, and link titles come from a wiki page rather than
 * from a trusted source. It is a guard, and the extractor's documentation says
 * so.
 */
export function assertSafeLinkFilter(pattern: string): void {
  if (pattern.length > MAX_LINK_FILTER_LENGTH) {
    throw new Error(
      `Unsafe link filter pattern: longer than ${MAX_LINK_FILTER_LENGTH} characters`
    );
  }
  for (const shape of UNSAFE_LINK_FILTER_SHAPES) {
    if (shape.pattern.test(pattern)) {
      throw new Error(`Unsafe link filter pattern (${shape.reason}): ${pattern}`);
    }
  }
}

function compileLinkFilter(pattern: string): RegExp {
  assertSafeLinkFilter(pattern);
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
