/**
 * Tests for the Wikidata extractor, driven by a recorded SPARQL JSON result.
 */

import { describe, it, expect } from 'vitest';
import { HttpClient, HttpRequest, HttpResponse } from './http';
import {
  WikidataExtractor,
  buildSparqlQuery,
  parseWikidataResponse,
  normalizeWikidataDate,
} from './WikidataExtractor';
import wikidataFixture from './fixtures/wikidata-battle-of-hastings.json';

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
  it('maps event bindings and skips the unrepresentable date', () => {
    const facts = parseWikidataResponse(wikidataFixture, 'event');
    expect(facts).toHaveLength(2);
    expect(facts[0]).toMatchObject({
      entityId: 'Q83274',
      label: 'Battle of Hastings',
      date: '1066-10-14T00:00:00Z',
      placeLabel: 'Senlac Hill',
    });
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
  it('extracts events from a recorded SPARQL response with provenance', async () => {
    const http = new SingleResponseHttpClient(wikidataFixture);
    const extractor = new WikidataExtractor({ httpClient: http, endpoint: 'https://query.wikidata.org/sparql' });

    const result = await extractor.extract({ queryType: 'historical-events', limit: 10 });

    expect(result.events).toHaveLength(2);
    expect(result.events[0]).toMatchObject({
      description: 'Battle of Hastings',
      target: 'Senlac Hill',
      timestamp: '1066-10-14T00:00:00Z',
      confidence: 0.9,
      source: { type: 'wikidata', wikidataId: 'Q83274' },
    });
    expect(result.sources[0].type).toBe('wikidata');
    expect(http.requests[0].method).toBe('POST');
    expect(http.requests[0].body).toContain('query=');
  });

  it('filters facts to the context time range', async () => {
    const http = new SingleResponseHttpClient(wikidataFixture);
    const extractor = new WikidataExtractor({ httpClient: http });

    const result = await extractor.extract(
      { queryType: 'historical-events' },
      { defaultTimeRange: { start: '1066-10-01T00:00:00Z', end: '1066-10-31T00:00:00Z' } }
    );

    expect(result.events).toHaveLength(1);
    expect(result.events[0].timestamp).toBe('1066-10-14T00:00:00Z');
  });
});
