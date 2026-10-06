/**
 * Tests for the Wikidata extractor.
 *
 * The two fixtures are **recordings**: the JSON is the response
 * query.wikidata.org returned for the query `buildSparqlQuery` produces, posted
 * verbatim on 2026-10-06.
 *
 *   - `wikidata-historical-events.json`: the shipped `historical-events` query
 *     with `LIMIT 25`, trimmed to the first 10 of the 25 rows returned (the
 *     broad query returns whatever matches first, so the rows are arbitrary
 *     conflicts -- Punic Wars, the Mexican-American War, the Korean War). Eight
 *     of the ten carry BCE dates, which `normalizeWikidataDate` must drop. It
 *     also shows the query's row-per-place shape: `OPTIONAL { P276 }` yields one
 *     row per place, so the Second Punic War appears six times.
 *   - `wikidata-norman-conquest.json`: the same query with
 *     `parameters.subject = Q200485`, which records the case the old
 *     point-in-time-only query could not return: the Norman conquest of England
 *     has `start time` (P580) and no `point in time` (P585), and no `P276`, so
 *     the row exercises both the P580 branch and the unbound-place fallback.
 *
 * The assertions below are written against the recorded values, so a fixture
 * cannot quietly drift away from the query the way the hand-tuned predecessor
 * did; `buildSparqlQuery` is separately asserted to anchor on the two classes
 * those recordings come from.
 */

import { describe, it, expect } from 'vitest';
import { HttpClient, HttpRequest, HttpResponse } from './http';
import {
  WikidataExtractor,
  buildSparqlQuery,
  parseWikidataResponse,
  normalizeWikidataDate,
} from './WikidataExtractor';
import historicalEvents from './fixtures/wikidata-historical-events.json';
import normanConquest from './fixtures/wikidata-norman-conquest.json';

class SingleResponseHttpClient implements HttpClient {
  readonly requests: HttpRequest[] = [];

  constructor(private readonly payload: unknown) {}

  async request(request: HttpRequest): Promise<HttpResponse> {
    this.requests.push(request);
    return { status: 200, body: JSON.stringify(this.payload), headers: {} };
  }
}

describe('normalizeWikidataDate', () => {
  it('normalizes a Wikidata dateTime literal', () => {
    expect(normalizeWikidataDate('1066-10-14T00:00:00Z')).toBe('1066-10-14T00:00:00Z');
  });

  it('accepts a date-only value', () => {
    expect(normalizeWikidataDate('1066-10-14')).toBe('1066-10-14T00:00:00Z');
  });

  it('rejects a BCE date', () => {
    expect(normalizeWikidataDate('-0044-03-15T00:00:00Z')).toBeNull();
  });
});

describe('parseWikidataResponse', () => {
  it('maps the recorded event bindings and drops the unrepresentable dates', () => {
    const facts = parseWikidataResponse(historicalEvents, 'event');

    // Eight of the ten recorded rows are BCE conflicts, which `Date` cannot
    // represent.
    expect(historicalEvents.results.bindings).toHaveLength(10);
    expect(historicalEvents.results.bindings.filter((row) => row.date.value.startsWith('-'))).toHaveLength(8);
    expect(facts).toHaveLength(2);
    expect(facts.map((fact) => fact.label)).toEqual(['Mexican-American War', 'Korean War']);
    expect(facts[0]).toMatchObject({
      entityId: 'Q6683',
      label: 'Mexican-American War',
      date: '1846-04-24T00:00:00Z',
      placeLabel: 'Mexico',
    });
    expect(facts[1]).toMatchObject({
      entityId: 'Q8663',
      label: 'Korean War',
      date: '1950-06-25T00:00:00Z',
      placeLabel: 'Sea of Japan',
    });
    expect(facts.map((fact) => fact.label)).not.toContain('Second Punic War');
  });

  it('maps person bindings', () => {
    const facts = parseWikidataResponse(
      {
        results: {
          bindings: [
            {
              person: { value: 'http://www.wikidata.org/entity/Q42' },
              personLabel: { value: 'Douglas Adams' },
              date: { value: '1952-03-11T00:00:00Z' },
              eventLabel: { value: 'birth' },
            },
          ],
        },
      },
      'person'
    );
    expect(facts[0]).toMatchObject({
      entityId: 'Q42',
      personLabel: 'Douglas Adams',
      label: 'birth',
    });
  });
});

describe('buildSparqlQuery', () => {
  it('requires a Wikidata id for a person timeline', () => {
    expect(() => buildSparqlQuery({ queryType: 'person-timeline' }, 10)).toThrow(/parameters.person/);
  });

  it('reads historical events from point-in-time or start-time', () => {
    const query = buildSparqlQuery({ queryType: 'historical-events' }, 10);
    expect(query).toContain('wdt:P585');
    expect(query).toContain('wdt:P580');
    expect(query).toContain('LIMIT 10');
  });

  it('anchors on armed conflict and conquest rather than on a subclass of war', () => {
    const query = buildSparqlQuery({ queryType: 'historical-events' }, 10);
    // Both anchors were checked against the live ontology: `battle` (Q178561)
    // and `war` (Q198) are subclasses of armed conflict (Q350604), and the
    // Norman conquest (Q200485) is an instance of conquest (Q1361229), which is
    // not under armed conflict, so it needs its own branch.
    expect(query).toContain('{ ?event wdt:P31/wdt:P279* wd:Q350604 . }');
    expect(query).toContain('{ ?event wdt:P31/wdt:P279* wd:Q1361229 . }');
    // The predecessor's chain to `war` excluded battles, so it must be gone.
    expect(query).not.toMatch(/wdt:P31\/wdt:P279\* wd:Q198/);
    // And it must not fall back to the too-broad `occurrence` anchor, which the
    // query service cannot answer (HTTP 504, measured).
    expect(query).not.toContain('wd:Q1190554');
  });

  it('projects the variables the recorded responses and the parser use', () => {
    const query = buildSparqlQuery({ queryType: 'historical-events' }, 10);
    expect(query).toContain('SELECT ?event ?eventLabel ?date ?placeLabel WHERE {');
    expect(query).toContain('SERVICE wikibase:label');
    expect(historicalEvents.head.vars).toEqual(['event', 'eventLabel', 'date', 'placeLabel']);
    expect(normanConquest.head.vars).toEqual(['event', 'eventLabel', 'date', 'placeLabel']);
  });

  it('scopes a subject-scoped historical-events query to that item', () => {
    const query = buildSparqlQuery(
      { queryType: 'historical-events', parameters: { subject: 'Q200485' } },
      5
    );
    expect(query).toContain('VALUES ?event { wd:Q200485 }');
  });

  it('uses the custom query verbatim', () => {
    expect(
      buildSparqlQuery({ queryType: 'custom', customQuery: 'SELECT * WHERE { ?s ?p ?o }' }, 5)
    ).toBe('SELECT * WHERE { ?s ?p ?o }');
  });

  it('rejects an empty custom query', () => {
    expect(() => buildSparqlQuery({ queryType: 'custom' }, 5)).toThrow(/non-empty/);
  });
});

describe('WikidataExtractor', () => {
  it('extracts events from the recorded response with provenance', async () => {
    const http = new SingleResponseHttpClient(historicalEvents);
    const extractor = new WikidataExtractor({ httpClient: http, endpoint: 'https://query.wikidata.org/sparql' });

    const result = await extractor.extract({ queryType: 'historical-events', limit: 10 });

    expect(result.events).toHaveLength(2);
    expect(result.events[0]).toMatchObject({
      description: 'Mexican-American War',
      target: 'Mexico',
      timestamp: '1846-04-24T00:00:00Z',
      confidence: 0.9,
      source: { type: 'wikidata', wikidataId: 'Q6683' },
    });
    expect(result.sources[0].type).toBe('wikidata');
    expect(http.requests[0].method).toBe('POST');
    expect(http.requests[0].body).toContain('query=');
  });

  it('filters facts to the context time range', async () => {
    const http = new SingleResponseHttpClient(historicalEvents);
    const extractor = new WikidataExtractor({ httpClient: http });

    const result = await extractor.extract(
      { queryType: 'historical-events' },
      { defaultTimeRange: { start: '1846-04-01T00:00:00Z', end: '1846-04-30T00:00:00Z' } }
    );

    expect(result.events).toHaveLength(1);
    expect(result.events[0].timestamp).toBe('1846-04-24T00:00:00Z');
  });

  it('sends the shipped historical-events query, not a subclass-of-war query', async () => {
    const http = new SingleResponseHttpClient(historicalEvents);
    const extractor = new WikidataExtractor({ httpClient: http });

    await extractor.extract({ queryType: 'historical-events' });

    const body = decodeURIComponent(http.requests[0].body ?? '');
    expect(body).toContain('wdt:P580');
    expect(body).toContain('wdt:P585');
    expect(body).toContain('wd:Q350604');
    expect(body).not.toMatch(/wdt:P31\/wdt:P279\* wd:Q198/);
  });

  it('returns the start-time row that the old point-in-time-only query dropped', async () => {
    const http = new SingleResponseHttpClient(normanConquest);
    const extractor = new WikidataExtractor({ httpClient: http });

    const result = await extractor.extract({
      queryType: 'historical-events',
      parameters: { subject: 'Q200485' },
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      description: 'Norman conquest of England',
      timestamp: '1066-10-04T00:00:00Z',
      source: { type: 'wikidata', wikidataId: 'Q200485' },
    });
    // The recorded row has no `placeLabel` (the OPTIONAL did not bind), so the
    // target falls back to the item label.
    expect(result.events[0].target).toBe('Norman conquest of England');
  });

  it('reports no sources when every row is dropped', async () => {
    const http = new SingleResponseHttpClient({
      results: {
        bindings: [
          {
            event: { type: 'uri', value: 'http://www.wikidata.org/entity/Q17167' },
            eventLabel: { type: 'literal', value: 'Roman Republic' },
            date: { type: 'literal', value: '-0509-00-00T00:00:00Z' },
          },
        ],
      },
    });
    const extractor = new WikidataExtractor({ httpClient: http });

    const result = await extractor.extract({ queryType: 'historical-events' });

    expect(result.events).toHaveLength(0);
    expect(result.sources).toHaveLength(0);
    expect(result.overallConfidence).toBe(0);
  });
});
