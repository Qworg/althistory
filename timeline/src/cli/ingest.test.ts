/**
 * Unit tests for CLI Ingestion (Phase 2).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DirectEngine } from './engine/DirectEngine';
import type { WorldCalendarSet } from '@althistory/calendar';
import { clusterEventsIntoArcs } from './generator/arcClustering';
import { ExtractedEvent } from '../services/ingestion/types';
import { HttpClient, HttpRequest, HttpResponse } from '../services/ingestion/http';
import wikipediaFixture from '../services/ingestion/fixtures/wikipedia-battle-of-hastings.json';
import wikidataFixture from '../services/ingestion/fixtures/wikidata-historical-events.json';
import deepTimeFixture from '../services/ingestion/fixtures/wikidata-deep-time.json';

const mockSource = {
  type: 'text' as const,
  extractedAt: '2026-01-01T00:00:00Z',
};

describe('CLI Arc Clustering (clusterEventsIntoArcs)', () => {
  it('returns empty array when events list is empty', () => {
    const arcs = clusterEventsIntoArcs([], mockSource);
    expect(arcs).toEqual([]);
  });

  it('clusters events within proximity threshold into a single arc', () => {
    const events: ExtractedEvent[] = [
      {
        tempId: 'e-1',
        description: 'First event in 1775',
        actor: 'American Patriots',
        target: 'British Army',
        timestamp: '1775-04-19T00:00:00Z',
        confidence: 0.9,
        source: mockSource,
        selected: true,
        edited: false,
      },
      {
        tempId: 'e-2',
        description: 'Second event in 1776',
        actor: 'Continental Congress',
        target: 'King George III',
        timestamp: '1776-07-04T00:00:00Z',
        confidence: 0.9,
        source: mockSource,
        selected: true,
        edited: false,
      },
    ];

    const arcs = clusterEventsIntoArcs(events, mockSource);
    expect(arcs).toHaveLength(1);
    expect(arcs[0].start_time).toBe('1775-04-19T00:00:00Z');
    expect(arcs[0].end_time).toBe('1776-07-04T00:00:00Z');
    expect(arcs[0].name).toContain('American Patriots');
  });

  it('splits on the adaptive boundary once there are enough events for a median', () => {
    // With four events there are three gaps, so the median is used: the
    // boundary is three times the median gap (and at least thirty days).
    // Two events are a day apart and two are a year apart, so the median
    // falls on the short gap and the year-long pair is split off.
    const events: ExtractedEvent[] = [
      {
        tempId: 'e-1',
        description: 'First',
        actor: 'Alice',
        target: 'Bob',
        timestamp: '2000-01-01T00:00:00Z',
        confidence: 0.9,
        source: mockSource,
        selected: true,
        edited: false,
      },
      {
        tempId: 'e-2',
        description: 'Second',
        actor: 'Alice',
        target: 'Bob',
        timestamp: '2000-01-02T00:00:00Z',
        confidence: 0.9,
        source: mockSource,
        selected: true,
        edited: false,
      },
      {
        tempId: 'e-3',
        description: 'Third',
        actor: 'Alice',
        target: 'Bob',
        timestamp: '2000-01-03T00:00:00Z',
        confidence: 0.9,
        source: mockSource,
        selected: true,
        edited: false,
      },
      {
        tempId: 'e-4',
        description: 'Fourth',
        actor: 'Carol',
        target: 'Dave',
        timestamp: '2001-01-03T00:00:00Z',
        confidence: 0.9,
        source: mockSource,
        selected: true,
        edited: false,
      },
    ];

    const arcs = clusterEventsIntoArcs(events, mockSource);

    expect(arcs).toHaveLength(2);
    expect(arcs[0].start_time).toBe('2000-01-01T00:00:00Z');
    expect(arcs[0].end_time).toBe('2000-01-03T00:00:00Z');
    expect(arcs[1].start_time).toBe('2001-01-03T00:00:00Z');
  });

  it('caps a cluster at eight events', () => {
    // Nine events a day apart: the eighth fills the cluster, the ninth starts
    // a new one. The cap is the CLI's own, and it is the reason the CLI
    // clusterer is not the API's.
    const events: ExtractedEvent[] = Array.from({ length: 9 }, (_, index) => ({
      tempId: `e-${index}`,
      description: `Event ${index}`,
      actor: 'Alice',
      target: 'Bob',
      timestamp: `2000-01-${String(index + 1).padStart(2, '0')}T00:00:00Z`,
      confidence: 0.9,
      source: mockSource,
      selected: true,
      edited: false,
    }));

    const arcs = clusterEventsIntoArcs(events, mockSource);

    expect(arcs).toHaveLength(2);
    expect(arcs[0].start_time).toBe('2000-01-01T00:00:00Z');
    expect(arcs[0].end_time).toBe('2000-01-08T00:00:00Z');
    expect(arcs[1].start_time).toBe('2000-01-09T00:00:00Z');
  });

  it('clusters distant events into separate arcs', () => {
    const events: ExtractedEvent[] = [
      {
        tempId: 'e-1',
        description: 'Battle of Hastings',
        actor: 'Normans',
        target: 'Anglo-Saxons',
        timestamp: '1066-10-14T00:00:00Z',
        confidence: 0.9,
        source: mockSource,
        selected: true,
        edited: false,
      },
      {
        tempId: 'e-2',
        description: 'Moon landing',
        actor: 'NASA',
        target: 'Moon',
        timestamp: '1969-07-20T00:00:00Z',
        confidence: 0.9,
        source: mockSource,
        selected: true,
        edited: false,
      },
    ];

    const arcs = clusterEventsIntoArcs(events, mockSource);
    expect(arcs).toHaveLength(2);
    expect(arcs[0].start_time).toBe('1066-10-14T00:00:00Z');
    expect(arcs[1].start_time).toBe('1969-07-20T00:00:00Z');
  });

  it('names an arc with the year as a person types it, a BCE year included', () => {
    const at = (timestamp: string): ExtractedEvent => ({
      tempId: 'e-1',
      description: 'An event',
      actor: 'Rome',
      target: 'Gaul',
      timestamp,
      confidence: 0.9,
      source: mockSource,
      selected: true,
      edited: false,
    });
    expect(clusterEventsIntoArcs([at('-000043-03-15T00:00:00.000Z')], mockSource)[0]!.name).toBe('Period of Rome (44 BCE)');
    expect(clusterEventsIntoArcs([at('0000-06-01T00:00:00.000Z')], mockSource)[0]!.name).toBe('Period of Rome (1 BCE)');
    expect(clusterEventsIntoArcs([at('1066-10-14T00:00:00.000Z')], mockSource)[0]!.name).toBe('Period of Rome (1066)');
    expect(clusterEventsIntoArcs([at('+300000-01-01T00:00:00.000Z')], mockSource)[0]!.name).toBe('Period of Rome (300000)');
  });

  describe("in a world whose day is 30 hours and whose year is 120 of them", () => {
    const HOUR = 3600 * 1000;
    const VAEL: WorldCalendarSet = {
      version: 2,
      dayLength: 30 * 3600,
      primary: 'reckoning',
      calendars: [
        { id: 'reckoning', name: 'the Reckoning', parts: ['Lowtide', 'Greywater', 'Thaw', 'Seedtide'].map((name) => ({ name, days: 30 })), epoch: 0, eras: [{ label: 'AR', from: 1 }] },
      ],
    };
    const event = (tempId: string, ms: number): ExtractedEvent => ({
      tempId,
      description: tempId,
      actor: 'Council',
      target: 'Realm',
      timestamp: new Date(ms).toISOString(),
      confidence: 0.9,
      source: mockSource,
      selected: true,
      edited: false,
    });

    it("pads an arc around one moment by the world's day, not 24 hours", () => {
      const at = 100 * 30 * HOUR;
      const [single] = clusterEventsIntoArcs([event('e-1', at)], mockSource, { calendar: VAEL });
      expect(Date.parse(single!.end_time) - Date.parse(single!.start_time)).toBe(30 * HOUR);
      const [same] = clusterEventsIntoArcs([event('e-1', at), event('e-2', at)], mockSource, { calendar: VAEL });
      expect(Date.parse(same!.end_time) - Date.parse(same!.start_time)).toBe(30 * HOUR);
      // Without a world, a day is 24 hours.
      const [plain] = clusterEventsIntoArcs([event('e-1', at)], mockSource);
      expect(Date.parse(plain!.end_time) - Date.parse(plain!.start_time)).toBe(24 * HOUR);
    });

    it("splits a few events five of the world's years apart, not five Gregorian years", () => {
      const year = 120 * 30 * HOUR;
      // 5.5 world years is about 2.3 Gregorian years: apart in the world, together on Earth.
      const events = [event('e-1', 0), event('e-2', 5.5 * year)];
      expect(clusterEventsIntoArcs(events, mockSource, { calendar: VAEL })).toHaveLength(2);
      expect(clusterEventsIntoArcs(events, mockSource)).toHaveLength(1);
      expect(clusterEventsIntoArcs([event('e-1', 0), event('e-2', 4.5 * year)], mockSource, { calendar: VAEL })).toHaveLength(1);
    });
  });
});

describe('DirectEngine Ingestion', () => {
  let engine: DirectEngine;

  beforeEach(() => {
    engine = new DirectEngine();
  });

  afterEach(async () => {
    await engine.shutdown();
  });

  it('ingests pattern-based text with dry-run without writing to graph', async () => {
    const text = 'The Treaty of Paris was signed on 10 February 1763 by representatives of Great Britain and France.';

    const result = await engine.ingestText(undefined, text, {
      mode: 'pattern',
      dryRun: true,
      graphName: 'Dry Run Graph',
    });

    expect(result.dryRun).toBe(true);
    expect(result.eventsCreated).toBe(1);
    expect(result.entities.events).toHaveLength(1);
    expect(result.entities.events[0].actor).toBe('Treaty of Paris');
    expect(result.entities.events[0].target).toBe('Great Britain');

    // A dry run creates nothing at all -- not even the graph it would have
    // written to. The graph it names is a preview id, not a stored graph.
    expect(result.graphId).toContain('dry-run');
    await expect(engine.getGraph(result.graphId)).rejects.toThrow(/not found/i);
  });

  it('refuses to pretend a pattern extraction was a model extraction', async () => {
    const text = 'The Treaty of Paris was signed on 10 February 1763 by Great Britain and France.';

    // No provider is configured in the test environment, so the model path
    // has nothing to offer and the command says so.
    await expect(
      engine.ingestText(undefined, text, { mode: 'llm', dryRun: true })
    ).rejects.toThrow(/LLM extraction produced nothing/);
  });

  it('reads the text both ways in hybrid mode', async () => {
    const text = 'The Treaty of Paris was signed on 10 February 1763 by representatives of Great Britain and France.';
    const result = await engine.ingestText(undefined, text, {
      mode: 'hybrid',
      dryRun: true,
    });

    // The pattern path still contributes when the model does not answer.
    expect(result.eventsCreated).toBeGreaterThanOrEqual(1);
  });

  it('ingests and persists events with arc grouping', async () => {
    const text =
      'The Treaty of Paris was signed on 10 February 1763 by representatives of Great Britain and France. The Treaty of Versailles was signed on 3 September 1783 by representatives of the United States.';
    const result = await engine.ingestText(undefined, text, {
      mode: 'pattern',
      dryRun: false,
      groupArcs: true,
      graphName: 'Persisted Ingestion',
    });

    expect(result.dryRun).toBe(false);
    expect(result.eventsCreated).toBe(2);
    expect(result.arcsCreated).toBe(2);

    const persistedEvents = await engine.listEvents(result.graphId);
    expect(persistedEvents.length).toBeGreaterThanOrEqual(2);

    const persistedArcs = await engine.listArcs(result.graphId);
    expect(persistedArcs.length).toBeGreaterThanOrEqual(1);
  });
});

/**
 * A client that answers from recorded fixtures, so the ingestion tests never
 * touch the network.
 */
class FixtureHttpClient implements HttpClient {
  readonly requests: HttpRequest[] = [];

  constructor(private readonly handler: (url: string) => { body: string; headers?: Record<string, string> }) {}

  async request(request: HttpRequest): Promise<HttpResponse> {
    this.requests.push(request);
    const answer = this.handler(request.url);
    return { status: 200, body: answer.body, headers: answer.headers || {} };
  }
}

const WEB_PAGE = `<!doctype html>
<html>
  <head><title>History of the Battle</title><style>body { color: red; }</style></head>
  <body>
    <script>console.log('ignored')</script>
    <h1>The Battle of Hastings</h1>
    <p>The Battle of Hastings was fought on 14 October 1066 between the Normans and the Anglo-Saxons.</p>
  </body>
</html>`;

describe('DirectEngine Ingestion from the web', () => {
  let engine: DirectEngine;
  let http: FixtureHttpClient;

  afterEach(async () => {
    await engine.shutdown();
  });

  it('reads a Wikipedia article through the Wikipedia extractor', async () => {
    http = new FixtureHttpClient((url) => {
      if (url.includes('/w/api.php')) {
        return { body: JSON.stringify(wikipediaFixture), headers: { 'content-type': 'application/json' } };
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    engine = new DirectEngine({ httpClient: http });

    const result = await engine.ingestUrl(undefined, 'https://en.wikipedia.org/wiki/Battle_of_Hastings', {
      dryRun: true,
    });

    expect(http.requests[0].url).toContain('en.wikipedia.org');
    expect(result.eventsCreated).toBeGreaterThanOrEqual(1);
  });

  it('reads a page on any other site as a web document', async () => {
    http = new FixtureHttpClient((url) => {
      if (url === 'https://example.org/history') {
        return { body: WEB_PAGE, headers: { 'content-type': 'text/html' } };
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    engine = new DirectEngine({ httpClient: http });

    const result = await engine.ingestUrl(undefined, 'https://example.org/history', { dryRun: true });

    expect(result.eventsCreated).toBe(1);
    expect(result.entities.events[0].description).toContain('Battle of Hastings');
    // The script and the style are not part of the text.
    expect(result.entities.events[0].description).not.toContain('console.log');
  });

  it('reads Wikidata through the SPARQL endpoint', async () => {
    http = new FixtureHttpClient((url) => {
      if (url.includes('query.wikidata.org')) {
        return { body: JSON.stringify(wikidataFixture), headers: { 'content-type': 'application/sparql-results+json' } };
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    engine = new DirectEngine({ httpClient: http });

    const result = await engine.ingestWikidata(undefined, { preset: 'historical-events', dryRun: true });

    expect(http.requests[0].url).toContain('query.wikidata.org');
    // Every one of the 25 recorded rows is a date the timeline holds, the two BCE ones (427 and 404 BCE) included.
    expect(result.eventsCreated).toBe(25);
    expect(result.entities.events.filter((event) => event.timestamp.startsWith('-')).map((event) => event.timestamp).sort()).toEqual([
      '-000403-01-01T00:00:00Z',
      '-000426-01-01T00:00:00Z',
    ]);
    expect(result.droppedRows).toBeUndefined();
  });

  it('reports the results a Wikidata ingest left out, on a dry run and on a real one (#33)', async () => {
    http = new FixtureHttpClient(() => ({ body: JSON.stringify(deepTimeFixture), headers: {} }));
    engine = new DirectEngine({ httpClient: http });

    const dry = await engine.ingestWikidata(undefined, { preset: 'historical-events', dryRun: true });
    expect(dry.eventsCreated).toBe(7);
    expect(dry.droppedRows).toMatchObject({ total: 3, reasons: [{ reason: 'before-timeline', count: 3, items: 3 }] });

    const real = await engine.ingestWikidata(undefined, { preset: 'historical-events', graphName: 'Deep time' });
    expect(real.dryRun).toBe(false);
    expect(real.eventsCreated).toBe(7);
    expect(real.droppedRows).toMatchObject({ total: 3, reasons: [{ reason: 'before-timeline', count: 3, items: 3 }] });
  });

  it('counts what --min-confidence removes as a reason of its own, so the report accounts for every result', async () => {
    http = new FixtureHttpClient(() => ({ body: JSON.stringify(deepTimeFixture), headers: {} }));
    engine = new DirectEngine({ httpClient: http });

    // Every event is read at 0.9, so a minimum of 0.95 removes all seven.
    const result = await engine.ingestWikidata(undefined, { preset: 'historical-events', dryRun: true, minConfidence: 0.95 });
    expect(result.eventsCreated).toBe(0);
    expect(result.droppedRows?.total).toBe(10);
    expect(result.droppedRows?.reasons.map((r) => [r.reason, r.count, r.items])).toEqual(
      expect.arrayContaining([['below-confidence', 7, 7], ['before-timeline', 3, 3]])
    );
  });
});
