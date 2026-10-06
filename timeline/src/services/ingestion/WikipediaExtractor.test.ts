/**
 * Tests for the Wikipedia extractor, driven by MediaWiki `parse` responses
 * recorded from the live API (see the two fixtures' `pageid`/`title`):
 *
 *   - `wikipedia-battle-of-hastings.json`: enwiki "Battle of Hastings"
 *     (pageid 44667). Its infobox carries a plain-text date
 *     (`| date = 14 October 1066`), a `location` field whose value contains a
 *     piped wikilink and a `<br>`, and nested templates (`{{Plainlist|...}}`,
 *     `{{Location map many|...}}`, `{{Campaignbox ...}}`). Its link list is a
 *     real `prop=links` list, including the Category, Template, File and
 *     Wikipedia entries a real response contains.
 *   - `wikipedia-ada-lovelace.json`: enwiki "Ada Lovelace" (pageid 974). Its
 *     infobox carries the template-valued dates real articles use:
 *     `| birth_date = {{birth date|df=y|1815|12|10}}` and
 *     `| death_date = {{death date and age|df=y|1852|11|27|1815|12|10}}`.
 *
 * Both were trimmed (infobox plus lead, and a subset of the link list) rather
 * than stored whole; the retained text is verbatim. The fake HTTP client keys
 * responses by the `page` query parameter, so link-following behaviour is
 * asserted from the requests made.
 */

import { describe, it, expect } from 'vitest';
import { HttpClient, HttpRequest, HttpResponse } from './http';
import {
  WikipediaExtractor,
  assertSafeLinkFilter,
  parseWikipediaUrl,
  parseWikipediaPagePayload,
  parseTemplateFields,
  cleanWikiText,
  extractTemplates,
  renderWikiTemplates,
} from './WikipediaExtractor';
import wikipediaFixture from './fixtures/wikipedia-battle-of-hastings.json';
import lovelaceFixture from './fixtures/wikipedia-ada-lovelace.json';

const LINKED_PAGE = {
  parse: {
    title: 'William the Conqueror',
    wikitext: 'William invaded England on 28 September 1066.',
    links: [],
  },
};

class RouteHttpClient implements HttpClient {
  readonly pages: string[] = [];
  readonly urls: string[] = [];

  constructor(private readonly pagesByTitle: Record<string, unknown>) {}

  async request(request: HttpRequest): Promise<HttpResponse> {
    const url = new URL(request.url);
    const page = url.searchParams.get('page') ?? '';
    this.pages.push(page);
    this.urls.push(request.url);
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

  it('keeps only main-namespace links', () => {
    const page = parseWikipediaPagePayload(wikipediaFixture, 'Fallback');
    expect(page.links).toEqual([
      'William the Conqueror',
      'Harold Godwinson',
      'Norman conquest of England',
      'Duchy of Normandy',
      'Kingdom of England',
    ]);
    // The recorded response also carries ns 4 (Wikipedia:), 6 (File:),
    // 10 (Template:) and 14 (Category:) links.
    const allRecorded = wikipediaFixture.parse.links.length;
    expect(allRecorded).toBe(9);
    expect(page.links.length).toBeLessThan(allRecorded);
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

  it('keeps prose through a formatting-only template instead of truncating at its brace', () => {
    expect(cleanWikiText('It was fought {{nowrap|in 1066}}.')).toBe('It was fought in 1066.');
    expect(cleanWikiText("'''Ada King''' ({{née|'''Byron'''}}; 10 December 1815).")).toBe(
      'Ada King (née Byron; 10 December 1815).'
    );
  });

  it('matches a template containing a nested template', () => {
    const text = '{{Infobox x|date={{nowrap|1066}}|place=York}}';
    const templates = extractTemplates(text, 'Infobox');
    expect(templates).toHaveLength(1);
    expect(templates[0]).toBe(text);
  });
});

describe('parseTemplateFields', () => {
  it('reads a template-valued field whole instead of cutting at the inner pipe', () => {
    const template =
      '{{Infobox military conflict\n| date = {{Start date|1066|10|14|df=y}}\n| place = Senlac Hill, England\n}}';
    const fields = parseTemplateFields(template);
    expect(fields.date).toBe('{{Start date|1066|10|14|df=y}}');
    expect(fields.place).toBe('Senlac Hill, England');
  });

  it('reads a nested template and a piped wikilink in one field', () => {
    const template =
      '{{Infobox person|birth_date={{Birth date and age|1879|3|14}}|death_place=[[London|London, England]]}}';
    const fields = parseTemplateFields(template);
    expect(fields.birth_date).toBe('{{Birth date and age|1879|3|14}}');
    expect(fields.death_place).toBe('[[London|London, England]]');
  });

  it('keeps a hyphenated key and ignores positional arguments', () => {
    const fields = parseTemplateFields('{{Infobox x|positional|birth-date=1066-10-14}}');
    expect(fields['birth-date']).toBe('1066-10-14');
    expect(Object.keys(fields)).toEqual(['birth-date']);
  });
});

describe('renderWikiTemplates', () => {
  it('renders date templates from their year|month|day arguments', () => {
    expect(renderWikiTemplates('{{Birth date|1879|3|14}}', 'infobox')).toBe('14 March 1879');
    expect(renderWikiTemplates('{{Start date|1066|10|14|df=y}}', 'infobox')).toBe('14 October 1066');
    expect(renderWikiTemplates('{{Death date and age|1955|4|18|1879|3|14}}', 'infobox')).toBe(
      '18 April 1955'
    );
  });

  it('renders a date inside a formatting wrapper', () => {
    expect(renderWikiTemplates('{{nowrap|{{Start date|1066|10|14}}}}', 'prose')).toBe('14 October 1066');
  });

  it('keeps an infobox value but drops a citation template from prose', () => {
    expect(renderWikiTemplates('{{convert|10|km}}', 'infobox')).toBe('10 km');
    expect(renderWikiTemplates('A note{{sfn|Smith|2000}}.', 'prose')).toBe('A note.');
  });

  it('leaves an unclosed template as-is', () => {
    expect(renderWikiTemplates('A note {{unclosed', 'prose')).toBe('A note {{unclosed');
  });
});

describe('assertSafeLinkFilter', () => {
  it('rejects a nested quantifier', () => {
    expect(() => assertSafeLinkFilter('(a+)+$')).toThrow(/Unsafe link filter/);
  });

  it('rejects a quantified alternation', () => {
    expect(() => assertSafeLinkFilter('(a|aa)+$')).toThrow(/Unsafe link filter/);
  });

  it('rejects a backreference', () => {
    expect(() => assertSafeLinkFilter('(a)\\1')).toThrow(/Unsafe link filter/);
  });

  it('rejects an over-long pattern', () => {
    expect(() => assertSafeLinkFilter('a'.repeat(300))).toThrow(/Unsafe link filter/);
  });

  it('accepts the plain patterns the extractor documents', () => {
    expect(() => assertSafeLinkFilter('^William')).not.toThrow();
    expect(() => assertSafeLinkFilter('^William|^Harold')).not.toThrow();
    expect(() => assertSafeLinkFilter('\\d{4}')).not.toThrow();
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
      confidence: 0.85,
      source: { type: 'wikipedia', articleTitle: 'Battle of Hastings' },
    });
    // The real `location` field: a piped link plus a `<br>`, read whole.
    expect(infoboxEvent?.target).toBe(
      'Hailesaltede, near Hastings, Sussex, England (today Battle, East Sussex, England)'
    );

    const proseEvent = result.events.find((event) =>
      event.description.includes('was fought on 14 October 1066')
    );
    expect(proseEvent).toBeDefined();
    expect(proseEvent?.source.type).toBe('wikipedia');
    expect(proseEvent?.actor).toBe('Battle of Hastings');

    expect(result.sources[0]).toMatchObject({
      type: 'wikipedia',
      url: 'https://en.wikipedia.org/wiki/Battle_of_Hastings',
    });
    expect(result.overallConfidence).toBeGreaterThan(0);
  });

  it('renders the template-valued infobox dates a real person article uses', async () => {
    const extractor = new WikipediaExtractor({
      httpClient: new RouteHttpClient({ 'Ada Lovelace': lovelaceFixture }),
    });

    const result = await extractor.extract({ url: 'https://en.wikipedia.org/wiki/Ada_Lovelace' });

    const infoboxEvents = result.events.filter((event) => event.description.includes(' — '));
    expect(infoboxEvents.map((event) => event.description)).toEqual([
      'Ada Lovelace — Birth Date: 10 December 1815',
      'Ada Lovelace — Death Date: 27 November 1852',
    ]);
    expect(infoboxEvents.map((event) => event.timestamp)).toEqual([
      '1815-12-10T00:00:00Z',
      '1852-11-27T00:00:00Z',
    ]);
    // The recorded prose carries the same dates, so a prose event is expected
    // alongside the two infobox ones.
    expect(result.events.length).toBeGreaterThan(infoboxEvents.length);
  });

  it('parses the nested templates in the real infobox without truncating its fields', () => {
    const fields = parseTemplateFields(
      extractTemplates(wikipediaFixture.parse.wikitext, 'Infobox')[0]
    );

    expect(fields.date).toBe('14 October 1066');
    expect(fields.combatant1).toBe('[[Duchy of Normandy]]');
    expect(fields.combatant2).toBe('[[Kingdom of England]]');
    expect(fields['part_of']).toBe('the [[Norman Conquest]]');
    // Values that contain the nested Plainlist / Location map / Campaignbox
    // templates are read whole rather than cut at their first inner pipe.
    expect(fields.commander1).toContain('{{Plainlist|');
    expect(fields.commander1).toContain('William the Conqueror|William of Normandy');
    expect(fields.campaignbox).toContain('{{Location map many | United Kingdom East Sussex');
  });

  it('renders a template date value with a leading named argument', () => {
    // The real Ada Lovelace form: `{{birth date|df=y|1815|12|10}}`.
    expect(renderWikiTemplates('{{birth date|df=y|1815|12|10}}', 'infobox')).toBe('10 December 1815');
    expect(renderWikiTemplates('{{death date and age|df=y|1852|11|27|1815|12|10}}', 'infobox')).toBe(
      '27 November 1852'
    );
  });

  it('still extracts a plain-text infobox date', async () => {
    const plain = {
      parse: { title: 'Plain article', wikitext: '{{Infobox x|date = 14 October 1066}}', links: [] },
    };
    const extractor = new WikipediaExtractor({ httpClient: new RouteHttpClient({ 'Plain article': plain }) });

    const result = await extractor.extract({ url: 'https://en.wikipedia.org/wiki/Plain_article' });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ timestamp: '1066-10-14T00:00:00Z', target: 'Plain article' });
  });

  it('fetches only the root page when link following is off', async () => {
    const http = client();
    const extractor = new WikipediaExtractor({ httpClient: http });
    await extractor.extract({ url: 'https://en.wikipedia.org/wiki/Battle_of_Hastings' });
    expect(http.pages).toEqual(['Battle of Hastings']);
  });

  it('asks for a main-namespace links property and sends no namespace parameter', async () => {
    const http = client();
    const extractor = new WikipediaExtractor({ httpClient: http });
    await extractor.extract({ url: 'https://en.wikipedia.org/wiki/Battle_of_Hastings' });

    expect(http.urls[0]).toContain('action=parse');
    expect(http.urls[0]).toContain('prop=wikitext%7Clinks');
    expect(http.urls[0]).toContain('formatversion=2');
    // `plnamespace` is not a parameter of `action=parse&prop=links` (MediaWiki
    // answers "Unrecognized parameter: plnamespace."), so the client-side `ns`
    // filter is the whole namespace check. Assert the request does not pretend
    // otherwise.
    expect(http.urls[0]).not.toContain('plnamespace');
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

  it('never queues a Category, Template or File link', async () => {
    const mainNamespaceLinks = [
      'William the Conqueror',
      'Harold Godwinson',
      'Norman conquest of England',
      'Duchy of Normandy',
      'Kingdom of England',
    ];
    const pagesByTitle: Record<string, unknown> = { 'Battle of Hastings': wikipediaFixture };
    for (const title of mainNamespaceLinks) {
      // Any non-main-namespace link that got queued would hit this fake client
      // as an unexpected page and fail the extraction.
      pagesByTitle[title] = { parse: { title, wikitext: '', links: [] } };
    }
    const http = new RouteHttpClient(pagesByTitle);
    const extractor = new WikipediaExtractor({ httpClient: http });

    await extractor.extract({
      url: 'https://en.wikipedia.org/wiki/Battle_of_Hastings',
      options: { followLinks: true, linkDepth: 1, maxPages: 10 },
    });

    expect(http.pages).toEqual(['Battle of Hastings', ...mainNamespaceLinks]);
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

  it('refuses a link filter whose shape can backtrack catastrophically', async () => {
    const extractor = new WikipediaExtractor({ httpClient: client() });
    await expect(
      extractor.extract({
        url: 'https://en.wikipedia.org/wiki/Battle_of_Hastings',
        options: { followLinks: true, linkFilter: '(a+)+$' },
      })
    ).rejects.toThrow(/Unsafe link filter/);
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
