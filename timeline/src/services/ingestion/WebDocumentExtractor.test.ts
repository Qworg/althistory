/**
 * The web document extractor.
 *
 * The extractor reads a page on any site, so the tests check the two things
 * that can go wrong: that the markup is not read as text, and that the
 * events in the prose are found.
 */

import { describe, it, expect } from 'vitest';
import { WebDocumentExtractor, htmlToText, decodeHtmlEntities, isWikipediaUrl, stripControlCharacters } from './WebDocumentExtractor';
import { HttpClient, HttpRequest, HttpResponse } from './http';

class SingleResponseHttpClient implements HttpClient {
  readonly requests: HttpRequest[] = [];

  constructor(private readonly body: string, private readonly contentType = 'text/html') {}

  async request(request: HttpRequest): Promise<HttpResponse> {
    this.requests.push(request);
    return { status: 200, body: this.body, headers: { 'content-type': this.contentType } };
  }
}

const PAGE = `<!doctype html>
<html>
  <head>
    <title>The Battle of Hastings</title>
    <style>body { font-family: serif; }</style>
  </head>
  <body>
    <script>console.log('not text');</script>
    <h1>The Battle of Hastings</h1>
    <p>The Battle of Hastings was fought on 14 October 1066 between the Normans and the Anglo-Saxons.</p>
    <!-- a comment -->
    <p>The crown passed to William I on 25 December 1066.</p>
  </body>
</html>`;

describe('htmlToText', () => {
  it('drops the scripts, the styles and the comments', () => {
    const text = htmlToText(PAGE);
    expect(text).not.toContain('console.log');
    expect(text).not.toContain('font-family');
    expect(text).not.toContain('a comment');
  });

  it('keeps the prose and the paragraph breaks', () => {
    const text = htmlToText(PAGE);
    expect(text).toContain('The Battle of Hastings was fought on 14 October 1066');
    expect(text).toContain('The crown passed to William I on 25 December 1066.');
    expect(text.split('\n').length).toBeGreaterThan(1);
  });

  it('decodes the entities of ordinary prose', () => {
    expect(decodeHtmlEntities('Tom &amp; Jerry &lt;3 &#65;')).toBe('Tom & Jerry <3 A');
    expect(htmlToText('<p>Tom &amp; Jerry</p>')).toContain('Tom & Jerry');
  });

  it('leaves a numeric entity that names no code point as it is', () => {
    // A page can carry any entity at all. One that is out of range must not
    // stop the ingestion.
    expect(() => decodeHtmlEntities('&#99999999;')).not.toThrow();
    expect(decodeHtmlEntities('&#99999999;')).toBe('&#99999999;');
    expect(decodeHtmlEntities('&#x110000;')).toBe('&#x110000;');
    expect(decodeHtmlEntities('&#xFFFFFFFF;')).toBe('&#xFFFFFFFF;');
  });

  it('drops the control characters a numeric entity can name', () => {
    // U+0001 is not allowed in XML, and the GraphML export would fail on it.
    expect(decodeHtmlEntities('a&#1;b')).toBe('ab');
    expect(decodeHtmlEntities('a&#x1F;b')).toBe('ab');
    expect(decodeHtmlEntities('a&#9;b')).toBe('a\tb');
  });

  it('drops the control characters the page carries as they are', () => {
    expect(stripControlCharacters('a\u0001b\u007fc')).toBe('abc');
    expect(stripControlCharacters('a\tb\nc')).toBe('a\tb\nc');
    expect(htmlToText('<p>a\u0001b</p>')).toBe('ab');
  });

  it('reads a hostile document in linear time', () => {
    // A page full of unclosed comments, and a page full of angle brackets
    // with no closing one, used to cost time quadratic in the size of the
    // page: every start rescanned the rest of the document.
    const comments = '<!--'.repeat(100000);
    const angles = '<'.repeat(200000);

    const started = Date.now();
    const fromComments = htmlToText(comments);
    const fromAngles = htmlToText(angles);
    const elapsed = Date.now() - started;

    expect(fromComments.length).toBeLessThan(1000);
    expect(fromAngles.length).toBeLessThanOrEqual(200000);
    expect(elapsed).toBeLessThan(5000);
  });

  it('closes every script and every style with the closer that follows it', () => {
    // The closer used to be searched from the start of the document, so the
    // second script was closed by the first closer: the walk stepped back
    // and never ended, and the CLI hung on the page.
    const page = [
      '<script>first();</script>',
      'between the scripts',
      '<script>second();</script>',
      'between the styles',
      '<style>a { color: red; }</style>',
      'between the styles',
      '<style>b { color: blue; }</style>',
      '<p>The prose.</p>',
    ].join(' ');

    const text = htmlToText(page);

    expect(text).toContain('between the scripts');
    expect(text).toContain('between the styles');
    expect(text).toContain('The prose.');
    expect(text).not.toContain('first()');
    expect(text).not.toContain('second()');
    expect(text).not.toContain('color');
  });

  it('returns when a script or a style is never closed', () => {
    const page = '<p>Before.</p><script>never closed; <p>After.</p>';

    const text = htmlToText(page);

    expect(text).toContain('Before.');
    // The rest of the document is code, not prose.
    expect(text).not.toContain('never closed');
    expect(text).not.toContain('After.');
  });

  it('returns when there are many scripts and styles', () => {
    const page = Array.from({ length: 200 }, (_value, index) =>
      `<script>${index}();</script><style>.c${index} { color: red; }</style><p>Text ${index}.</p>`
    ).join('');

    const text = htmlToText(page);

    expect(text).toContain('Text 0.');
    expect(text).toContain('Text 199.');
    expect(text).not.toContain('();');
  });
});

describe('isWikipediaUrl', () => {
  it('recognises the Wikipedia hosts', () => {
    expect(isWikipediaUrl('https://en.wikipedia.org/wiki/Battle_of_Hastings')).toBe(true);
    expect(isWikipediaUrl('https://wikipedia.org/wiki/Thing')).toBe(true);
  });

  it('does not recognise the other hosts', () => {
    expect(isWikipediaUrl('https://example.org/history')).toBe(false);
    expect(isWikipediaUrl('not a url')).toBe(false);
  });
});

describe('WebDocumentExtractor', () => {
  it('extracts the dated events of a page', async () => {
    const http = new SingleResponseHttpClient(PAGE);
    const extractor = new WebDocumentExtractor({ httpClient: http });

    const result = await extractor.extract({ url: 'https://example.org/history' });

    expect(http.requests[0].url).toBe('https://example.org/history');
    expect(result.events.length).toBeGreaterThanOrEqual(1);
    expect(result.events[0].description).toContain('Battle of Hastings');
    expect(result.events[0].source.url).toBe('https://example.org/history');
  });

  it('returns nothing for an empty document', async () => {
    const http = new SingleResponseHttpClient('<html><body></body></html>');
    const extractor = new WebDocumentExtractor({ httpClient: http });

    const result = await extractor.extract({ url: 'https://example.org/empty' });

    expect(result.events).toHaveLength(0);
  });
});
