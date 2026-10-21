/**
 * Web document extractor.
 *
 * The Wikipedia extractor only serves Wikipedia articles, and the plan the
 * CLI was built from asks for "web documents" as well: a page on any site,
 * read as text and mined for dated events. This extractor does that.
 *
 * The page is fetched over HTTPS by {@link PublicWebHttpClient}, which
 * refuses internal hosts, converted from HTML to plain text, and handed to
 * the same text extraction the `ingest text` command uses -- so a page and a
 * pasted paragraph are read the same way.
 */

import { LLMClient } from '../llm/LLMClient';
import { HttpClient } from './http';
import { TextExtractor } from './TextExtractor';
import {
  ExtractedEvent,
  ExtractionContext,
  ExtractionResult,
  Extractor,
} from './types';

export interface WebDocumentExtractionInput {
  url: string;
}

/**
 * Whether a URL names a Wikipedia article.
 *
 * The Wikipedia extractor is used for those, and the web document extractor
 * for everything else.
 */
export function isWikipediaUrl(rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return host === 'wikipedia.org' || host.endsWith('.wikipedia.org');
  } catch {
    return false;
  }
}

export interface WebDocumentExtractorDeps {
  httpClient: HttpClient;
  llmClient?: LLMClient | null;
  now?: () => Date;
}

const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '-',
  mdash: '-',
  hellip: '...',
  rsquo: "'",
  lsquo: "'",
  ldquo: '"',
  rdquo: '"',
};

/** The highest code point Unicode defines. */
const MAX_CODE_POINT = 0x10ffff;

/**
 * Whether a code point is a character that must not reach the store.
 *
 * The control characters are dropped: they are noise in prose, and several of
 * them are illegal in XML, so an event description carrying one would break
 * the GraphML export.
 */
function isForbiddenCodePoint(code: number): boolean {
  if (code < 0x20) return code !== 0x09 && code !== 0x0a && code !== 0x0d;
  if (code === 0x7f) return true;
  if (code >= 0xd800 && code <= 0xdfff) return true; // a lone surrogate
  if (code === 0xfffe || code === 0xffff) return true; // a non-character
  return false;
}

/**
 * Decode the HTML entities that appear in ordinary prose.
 *
 * Named entities from a small table are decoded, and numeric ones are
 * decoded by code point. A numeric entity that names no code point -- one
 * beyond the end of Unicode, or a lone surrogate -- is left as it is, because
 * a document that mentions `&#99999999;` should not lose the text around it
 * and should not stop the ingestion either.
 */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16);
      return decodeCodePoint(code, match);
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10);
      return decodeCodePoint(code, match);
    }
    const decoded = HTML_ENTITIES[entity.toLowerCase()];
    return decoded ?? match;
  });
}

/** Turn a numeric entity into the character it names, or keep it as it is. */
function decodeCodePoint(code: number, match: string): string {
  if (!Number.isFinite(code) || !Number.isInteger(code)) return match;
  if (code < 0 || code > MAX_CODE_POINT) return match;
  if (isForbiddenCodePoint(code)) return '';
  return String.fromCodePoint(code);
}

/** The tags that end a block of prose. */
const BLOCK_TAGS = new Set([
  'p',
  'div',
  'section',
  'article',
  'li',
  'tr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'pre',
]);

/**
 * Remove the control characters that must not reach the store.
 *
 * They are noise in prose, and several of them are illegal in XML, so an
 * event description carrying one would break the GraphML export. The tab,
 * the newline and the carriage return are kept: they are the line breaks of
 * the text.
 */
export function stripControlCharacters(text: string): string {
  let result = '';
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) continue;
    if (code === 0x7f) continue;
    result += character;
  }
  return result;
}

/** The tags whose content is code rather than prose. */
const RAW_TEXT_TAGS = new Set(['script', 'style', 'noscript']);

/**
 * The end of a raw-text element, searched from where the walk is.
 *
 * The search has to start at the current position: a page with two scripts
 * has two closers, and a search from the start of the document finds the
 * first one again. The walk would then step back to the same place and never
 * end, which is what used to hang the CLI on any real page.
 *
 * The closer is the first one at or after `from`; the returned end is the
 * position just after the closing angle bracket, so the walk carries on
 * after the element it has just consumed.
 */
function findRawTextEnd(html: string, tagName: string, from: number): number {
  const closer = new RegExp(`</\\s*${tagName}\\b`, 'gi');
  closer.lastIndex = from;
  const match = closer.exec(html);
  if (!match) return -1;
  const angle = html.indexOf('>', match.index);
  return angle < 0 ? html.length : angle + 1;
}

/** The name of the tag a `<...>` holds, lowercased and without its slash. */
function readTagName(tagText: string): string {
  const match = tagText.match(/^\/?\s*([a-zA-Z][a-zA-Z0-9-]*)/);
  return match ? match[1].toLowerCase() : '';
}

/**
 * Convert an HTML document into the plain text a reader would see.
 *
 * The scripts, the styles and the comments are dropped, the block-level tags
 * become line breaks, and every other tag is removed. The result is prose
 * with paragraph breaks, which is what the pattern extractor reads.
 *
 * The document is walked once, from left to right. The regular expressions
 * this used to be built from rescan the rest of the document at every
 * unclosed start, which made a page full of `<!--` or `<` cost time
 * quadratic in the size of the page; the walk below is linear, and an
 * unterminated comment, script or tag ends the walk. The closer of a script
 * or a style is searched from the position the walk is at, so the second
 * script of a page is closed by the second closer, and the walk always
 * moves forward.
 */
export function htmlToText(html: string): string {
  const parts: string[] = [];
  let text = '';
  let index = 0;

  const flush = (): void => {
    if (text) {
      parts.push(text);
      text = '';
    }
  };

  while (index < html.length) {
    const open = html.indexOf('<', index);
    if (open < 0) {
      text += html.slice(index);
      break;
    }
    text += html.slice(index, open);

    if (html.startsWith('<!--', open)) {
      const end = html.indexOf('-->', open + 4);
      if (end < 0) break; // an unterminated comment swallows the rest
      flush();
      parts.push(' ');
      index = end + 3;
      continue;
    }

    const tagEnd = html.indexOf('>', open + 1);
    if (tagEnd < 0) {
      // There is no closing angle bracket left, so the rest is text.
      text += html.slice(open);
      break;
    }

    const tagText = html.slice(open + 1, tagEnd);
    const tagName = readTagName(tagText);
    index = tagEnd + 1;

    if (RAW_TEXT_TAGS.has(tagName)) {
      const closeEnd = findRawTextEnd(html, tagName, index);
      if (closeEnd < 0) {
        // An unterminated script or style: the rest is code, not prose.
        flush();
        parts.push(' ');
        break;
      }
      flush();
      parts.push(' ');
      index = closeEnd;
      continue;
    }

    flush();
    if (tagName === 'br') {
      parts.push('\n');
    } else if (BLOCK_TAGS.has(tagName)) {
      parts.push('\n');
    } else {
      parts.push(' ');
    }
  }
  flush();

  return stripControlCharacters(decodeHtmlEntities(parts.join('')))
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Reads a web document and extracts the events it describes.
 */
export class WebDocumentExtractor implements Extractor<WebDocumentExtractionInput> {
  readonly sourceType = 'text' as const;
  private readonly httpClient: HttpClient;
  private readonly textExtractor: TextExtractor;

  constructor(deps: WebDocumentExtractorDeps) {
    this.httpClient = deps.httpClient;
    this.textExtractor = new TextExtractor({
      llmClient: deps.llmClient ?? null,
      now: deps.now,
    });
  }

  async extract(
    input: WebDocumentExtractionInput,
    context?: ExtractionContext
  ): Promise<ExtractionResult> {
    const response = await this.httpClient.request({
      url: input.url,
      headers: { Accept: 'text/html,text/plain;q=0.9' },
    });

    const contentType = response.headers['content-type'] || '';
    const text = contentType.includes('html') ? htmlToText(response.body) : response.body;

    if (text.trim().length === 0) {
      return { events: [], arcs: [], relationships: [], sources: [], overallConfidence: 0 };
    }

    const result = await this.textExtractor.extract({ text, useLLM: true }, context);
    return this.withSource(result, input.url);
  }

  /** Record the document the entities came from. */
  private withSource(result: ExtractionResult, url: string): ExtractionResult {
    const source = { type: 'text' as const, url, extractedAt: new Date().toISOString() };
    const events: ExtractedEvent[] = result.events.map((event) => ({
      ...event,
      source: { ...source, ...event.source, url: event.source.url ?? url },
    }));
    return { ...result, events };
  }
}
