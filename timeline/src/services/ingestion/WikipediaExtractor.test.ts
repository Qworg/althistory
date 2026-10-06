/**
 * Tests for the Wikipedia extractor, driven by a recorded MediaWiki `parse`
 * fixture. The fake HTTP client keys responses by the `page` query parameter,
 * so link-following behaviour is asserted from the requests made.
 */

import { describe, it, expect } from 'vitest';
import { HttpClient, HttpRequest, HttpResponse } from './http';
import {
  WikipediaExtractor,
  parseWikipediaUrl,
  parseWikipediaPagePayload,
  cleanWikiText,
  extractTemplates,
} from './WikipediaExtractor';
import wikipediaFixture from './fixtures/wikipedia-battle-of-hastings.json';

const LINKED_PAGE = {
  parse: {
    title: 'William the Conqueror',
    wikitext: 'William invaded England on 28 September 1066.',
    links: [],
  },
};

class RouteHttpClient implements HttpClient {
  readonly pages: string[] = [];

  constructor(private readonly pagesByTitle: Record<string, unknown>) {}

  async request(request: HttpRequest): Promise<HttpResponse> {
    const url = new URL(request.url);
    const page = url.searchParams.get('page') ?? '';
    this.pages.push(page);
    const payload = this.pagesByTitle[page];
    if (!payload) {
      throw new Error(`Unexpected page requested: ${page}`);
    }
    return { status: 200, body: JSON.stringify(payload), headers: {} };
  }
}

function client(): RouteHttpClient {
  return new RouteHttpClient({
    'Battle of Hastings': wikipediaFixture,
    'William the Conqueror': LINKED_PAGE,
  });
}

describe('parseWikipediaUrl', () => {
  it('parses a /wiki/ article URL', () => {
    expect(parseWikipediaUrl('https://en.wikipedia.org/wiki/Battle_of_Hastings')).toEqual({
      host: 'en.wikipedia.org',
      title: 'Battle of Hastings',
    });
  });

  it('parses a ?title= URL', () => {
    expect(parseWikipediaUrl('https://de.wikipedia.org/w/index.php?title=Schlacht_bei_Hastings')).toEqual({
      host: 'de.wikipedia.org',
      title: 'Schlacht bei Hastings',
    });
  });

  it('rejects a non-Wikipedia host', () => {
    expect(() => parseWikipediaUrl('https://example.com/wiki/Thing')).toThrow(/Not a Wikipedia URL/);
  });
});

describe('parseWikipediaPagePayload', () => {
  it('reads the formatversion=2 shape', () => {
    const page = parseWikipediaPagePayload(wikipediaFixture, 'Fallback');
    expect(page.title).toBe('Battle of Hastings');
    expect(page.wikitext).toContain('Infobox military conflict');
    expect(page.links).toContain('William the Conqueror');
  });

  it('reads the legacy {"*": ...} shape', () => {
    const page = parseWikipediaPagePayload(
      { parse: { title: 'X', wikitext: { '*': 'body' }, links: [{ '*': 'Link' }] } },
      'Fallback'
    );
    expect(page.wikitext).toBe('body');
    expect(page.links).toEqual(['Link']);
  });

  it('surfaces a MediaWiki error object', () => {
    expect(() => parseWikipediaPagePayload({ error: { code: 'missingtitle' } }, 'X')).toThrow(
      /missingtitle/
    );
  });
});

describe('cleanWikiText and extractTemplates', () => {
  it('strips refs, links and bold markup', () => {
    expect(cleanWikiText("The '''Battle''' was [[fought|fought]] in [[1066]]<ref name=x>note</ref>.")).toBe(
      'The Battle was fought in 1066.'
    );
  });

  it('matches a template containing a nested template', () => {
    const text = '{{Infobox x|date={{nowrap|1066}}|place=York}}';
    const templates = extractTemplates(text, 'Infobox');
    expect(templates).toHaveLength(1);
    expect(templates[0]).toBe(text);
  });
});

describe('WikipediaExtractor', () => {
  it('extracts an infobox date and prose dates from the recorded fixture', async () => {
    const extractor = new WikipediaExtractor({ httpClient: client() });
    const result = await extractor.extract({
      url: 'https://en.wikipedia.org/wiki/Battle_of_Hastings',
    });

    const infoboxEvent = result.events.find((event) => event.description.includes('Date:'));
    expect(infoboxEvent).toMatchObject({
      timestamp: '1066-10-14T00:00:00Z',
      actor: 'Battle of Hastings',
      target: 'Senlac Hill, England',
      confidence: 0.85,
      source: { type: 'wikipedia', articleTitle: 'Battle of Hastings' },
    });

    const proseEvent = result.events.find((event) => event.description.includes('25 December 1066'));
    expect(proseEvent).toBeDefined();
    expect(proseEvent?.source.type).toBe('wikipedia');

    expect(result.sources[0]).toMatchObject({
      type: 'wikipedia',
      url: 'https://en.wikipedia.org/wiki/Battle_of_Hastings',
    });
    expect(result.overallConfidence).toBeGreaterThan(0);
  });

  it('fetches only the root page when link following is off', async () => {
    const http = client();
    const extractor = new WikipediaExtractor({ httpClient: http });
    await extractor.extract({ url: 'https://en.wikipedia.org/wiki/Battle_of_Hastings' });
    expect(http.pages).toEqual(['Battle of Hastings']);
  });

  it('follows links one depth and stops at maxPages', async () => {
    const http = client();
    const extractor = new WikipediaExtractor({ httpClient: http });
    const result = await extractor.extract({
      url: 'https://en.wikipedia.org/wiki/Battle_of_Hastings',
      options: { followLinks: true, linkDepth: 1, maxPages: 2 },
    });

    expect(http.pages).toEqual(['Battle of Hastings', 'William the Conqueror']);
    expect(result.events.some((event) => event.description.includes('28 September 1066'))).toBe(true);
    expect(result.sources.length).toBe(2);
  });

  it('applies the link filter before following', async () => {
    const http = client();
    const extractor = new WikipediaExtractor({ httpClient: http });
    await extractor.extract({
      url: 'https://en.wikipedia.org/wiki/Battle_of_Hastings',
      options: { followLinks: true, linkDepth: 1, maxPages: 5, linkFilter: '^William' },
    });

    expect(http.pages).toEqual(['Battle of Hastings', 'William the Conqueror']);
  });

  it('rejects an invalid link filter pattern', async () => {
    const extractor = new WikipediaExtractor({ httpClient: client() });
    await expect(
      extractor.extract({
        url: 'https://en.wikipedia.org/wiki/Battle_of_Hastings',
        options: { followLinks: true, linkFilter: '(' },
      })
    ).rejects.toThrow(/Invalid link filter/);
  });
});
