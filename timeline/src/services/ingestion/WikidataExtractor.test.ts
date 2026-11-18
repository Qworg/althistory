/**
 * Tests for the Wikidata extractor.
 *
 * The fixtures are **recordings**: the JSON is the response query.wikidata.org
 * returned for the query `buildSparqlQuery` produces, posted verbatim on
 * 2026-11-15 (the queries that ask for each date's precision).
 *
 *   - `wikidata-historical-events.json`: the shipped `historical-events` query
 *     with `LIMIT 25`, all 25 rows (the broad query returns whatever matches
 *     first, so the rows are arbitrary conflicts, here civil wars). Two carry
 *     BCE years (the Corcyrean Civil War, 427 BC, and the Phyle Campaign, 404
 *     BC), five a year's precision or a month's, one a decade's. It also shows
 *     the query's row-per-place shape: `OPTIONAL { P276 }` yields one row per
 *     place, so the Ottoman Civil War of 1509-13 appears twice.
 *   - `wikidata-norman-conquest.json`: the same query with
 *     `parameters.subject = Q200485`, which records the case the old
 *     point-in-time-only query could not return: the Norman conquest of England
 *     has `start time` (P580) and no `point in time` (P585), and no `P276`, so
 *     the row exercises both the P580 branch and the unbound-place fallback.
 *   - `wikidata-bce-thermopylae.json` (`subject = Q131969`) and
 *     `wikidata-bce-person-caesar.json` (`person-timeline`, `person = Q1048`):
 *     BCE dates at a day's and a month's precision, whose numbering the
 *     `readWikidataTime` table compares with the entity JSON.
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
  readWikidataTime,
  classifyWikidataTime,
} from './WikidataExtractor';
import { MAX_AXIS_MS, axisTimeOfCivil, civilOfAxisTime, formatDateEntry, toAxisTime } from '@althistory/calendar';

// The last year the axis reaches into: its 31 December is past the bound.
const topYear = Number(civilOfAxisTime(MAX_AXIS_MS).year);
import historicalEvents from './fixtures/wikidata-historical-events.json';
import normanConquest from './fixtures/wikidata-norman-conquest.json';
import caesar from './fixtures/wikidata-bce-person-caesar.json';
import thermopylae from './fixtures/wikidata-bce-thermopylae.json';
import deepTime from './fixtures/wikidata-deep-time.json';

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

  it('drops what is no date: a month or day that does not exist, a precision Wikidata does not have, a moment beyond the timeline', () => {
    expect(normalizeWikidataDate('1066-02-30T00:00:00Z')).toBeNull();
    expect(normalizeWikidataDate('1066-10-14T00:00:00Z', 15)).toBeNull();
    // The Big Bang (Q323), as the query service returned it: 13.8 billion years is past the ±285 million the axis holds.
    expect(readWikidataTime('-13787000000-01-01T00:00:00Z', 3)).toBeNull();
  });
});

/**
 * The year a BCE value names depends on its precision. Each pair is a
 * query.wikidata.org value as recorded on 2026-11-15, beside the entity
 * JSON's value for the same statement (Special:EntityData), which counts back
 * from 1 CE with no year 0. See `readWikidataTime` for the table.
 */
describe('classifyWikidataTime', () => {
  it('calls a day inside the last year but past the bound beyond the timeline, not unreadable', () => {
    for (const precision of [11, 10, undefined]) {
      expect(classifyWikidataTime(`+${topYear}-12-31T00:00:00Z`, precision), String(precision)).toEqual({ ok: false, reason: 'after-timeline' });
    }
  });

  it('keeps a date that does not exist unreadable, and an unknown value no date', () => {
    expect(classifyWikidataTime('1066-02-30T00:00:00Z', 11)).toEqual({ ok: false, reason: 'unreadable' });
    expect(classifyWikidataTime('http://www.wikidata.org/.well-known/genid/abc')).toEqual({ ok: false, reason: 'no-date' });
  });
});

describe('readWikidataTime: years before 1 CE, as the query service writes them', () => {
  it('at a year or finer, reads XSD 1.1 years (0 is 1 BCE): the query service has already added one', () => {
    // Q1048 P570: JSON -0044-03-15 (Julian, precision 11) is 15 March 44 BC; the query service converts it to Gregorian.
    expect(readWikidataTime('-0043-03-13T00:00:00Z', 11)).toEqual({ timestamp: '-000043-03-13T00:00:00Z', precision: 'day' });
    // Q1048 P570: JSON -0044-00-00 (Gregorian, precision 9) is the year 44 BC.
    expect(readWikidataTime('-0043-01-01T00:00:00Z', 9)).toEqual({ timestamp: '-000043-01-01T00:00:00Z', precision: 'year' });
    // Q220 P571 (Rome): JSON -0753-04-21 Julian.
    expect(readWikidataTime('-0752-04-13T00:00:00Z', 11)).toEqual({ timestamp: '-000752-04-13T00:00:00Z', precision: 'day' });
    // Q131969 (Thermopylae) P585: JSON -0480-07-00, precision 10: July 480 BC.
    expect(readWikidataTime('-0479-07-01T00:00:00Z', 10)).toEqual({ timestamp: '-000479-07-01T00:00:00Z', precision: 'month' });
    // Q137567 (Asculum) P585: JSON -0089-00-00, precision 9.
    expect(readWikidataTime('-0088-01-01T00:00:00Z', 9)).toEqual({ timestamp: '-000088-01-01T00:00:00Z', precision: 'year' });
  });

  it('coarser than a year, reads the year counted back from 1 CE, as the JSON has it: the query service leaves it alone', () => {
    // Q2888236 (Cameria) P585: JSON -0730-00-00, precision 8 (decade): the 730s BC.
    expect(readWikidataTime('-0730-01-01T00:00:00Z', 8)).toEqual({ timestamp: '-000729-01-01T00:00:00Z', precision: 'year' });
    // Q513097 (Ten Kings) P585: JSON -1400-00-00, precision 7 (century).
    expect(readWikidataTime('-1400-01-01T00:00:00Z', 7)).toEqual({ timestamp: '-001399-01-01T00:00:00Z', precision: 'year' });
    // Q55811 (K-Pg extinction) P585: JSON -66000000-00-00, precision 3 (million years): "66000000 BCE" on the timeline.
    expect(readWikidataTime('-66000000-01-01T00:00:00Z', 3)).toEqual({ timestamp: '-65999999-01-01T00:00:00Z', precision: 'year' });
  });

  it('names the year Wikidata shows, whatever the precision', () => {
    // Each is the year the entity JSON gives, written as people write it.
    const shown = (value: string, precision: number) => {
      const read = readWikidataTime(value, precision)!;
      return formatDateEntry(read.timestamp, read.precision, null);
    };
    expect(shown('-0043-03-13T00:00:00Z', 11)).toBe('44-03-13 BCE');
    expect(shown('-0043-01-01T00:00:00Z', 9)).toBe('44 BCE');
    expect(shown('-0479-07-01T00:00:00Z', 10)).toBe('480-07 BCE');
    expect(shown('-0730-01-01T00:00:00Z', 8)).toBe('730 BCE');
    expect(shown('-66000000-01-01T00:00:00Z', 3)).toBe('66000000 BCE');
  });

  it('maps every precision Wikidata has, 0 (a billion years) to 14 (a second), to a day, a month or a year', () => {
    for (let precision = 0; precision <= 14; precision++) {
      const read = readWikidataTime('+1846-04-24T00:00:00Z', precision);
      const expected = precision >= 11 ? 'day' : precision === 10 ? 'month' : 'year';
      expect(read?.precision, String(precision)).toBe(expected);
      expect(read?.timestamp, String(precision)).toBe(expected === 'day' ? '1846-04-24T00:00:00Z' : expected === 'month' ? '1846-04-01T00:00:00Z' : '1846-01-01T00:00:00Z');
    }
    // Deep years go the expanded ISO way, read exactly beyond what a Date holds.
    expect(readWikidataTime('-251900000-01-01T00:00:00Z', 4)).toEqual({ timestamp: '-251899999-01-01T00:00:00Z', precision: 'year' });
    expect(readWikidataTime('+300000-01-01T00:00:00Z', 6)).toEqual({ timestamp: '+300000-01-01T00:00:00Z', precision: 'year' });
  });

  it('reads a value without a precision (a custom query that selects none) as the query service writes most: XSD 1.1, a day', () => {
    expect(readWikidataTime('-0043-03-13T00:00:00Z')).toEqual({ timestamp: '-000043-03-13T00:00:00Z', precision: 'day' });
  });
});

describe('parseWikidataResponse', () => {
  it('maps every recorded event binding, BCE years and coarse precisions included', () => {
    const facts = parseWikidataResponse(historicalEvents, 'event');

    expect(historicalEvents.results.bindings).toHaveLength(25);
    expect(facts).toHaveLength(25);
    // The Corcyrean Civil War (Q5887715): the query service's -0426, at a year's precision, is 427 BC.
    expect(facts[2]).toMatchObject({
      entityId: 'Q5887715',
      label: 'Corcyrean Civil War',
      date: '-000426-01-01T00:00:00Z',
      datePrecision: 'year',
      placeLabel: 'Corfu',
    });
    expect(facts.find((fact) => fact.entityId === 'Q6644963')).toMatchObject({ label: 'Phyle Campaign', date: '-000403-01-01T00:00:00Z', datePrecision: 'year' });
    // A month (precision 10) is the month, a decade (8) a year.
    expect(facts[0]).toMatchObject({ label: '1848–1856 Argentine Civil War', date: '1848-02-01T00:00:00Z', datePrecision: 'month' });
    expect(facts.find((fact) => fact.entityId === 'Q6429210')).toMatchObject({ label: 'Kongo Civil War', date: '1600-01-01T00:00:00Z', datePrecision: 'year' });
    expect(facts[1]).toMatchObject({ label: 'Bolivian Civil War', date: '1898-11-06T00:00:00Z', datePrecision: 'day', placeLabel: 'Bolivia' });
    // One row per place.
    expect(facts.filter((fact) => fact.entityId === 'Q7109927').map((fact) => fact.placeLabel)).toEqual(['Anatolia', 'Rumelia']);
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

  it('reads historical events from point-in-time or start-time, with each date its precision', () => {
    const query = buildSparqlQuery({ queryType: 'historical-events' }, 10);
    expect(query).toContain('{ ?event p:P585 ?statement . ?statement a wikibase:BestRank ; psv:P585 [ wikibase:timeValue ?date ; wikibase:timePrecision ?precision ] . }');
    expect(query).toContain('{ ?event p:P580 ?statement . ?statement a wikibase:BestRank ; psv:P580 [ wikibase:timeValue ?date ; wikibase:timePrecision ?precision ] . }');
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
    expect(query).toContain('SELECT ?event ?eventLabel ?date ?precision ?placeLabel WHERE {');
    expect(query).toContain('SERVICE wikibase:label');
    for (const recording of [historicalEvents, normanConquest, thermopylae]) {
      expect(recording.head.vars).toEqual(['event', 'eventLabel', 'date', 'precision', 'placeLabel']);
    }
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
  it('extracts events from the recorded response with provenance and precision', async () => {
    const http = new SingleResponseHttpClient(historicalEvents);
    const extractor = new WikidataExtractor({ httpClient: http, endpoint: 'https://query.wikidata.org/sparql' });

    const result = await extractor.extract({ queryType: 'historical-events', limit: 25 });

    expect(result.events).toHaveLength(25);
    expect(result.events[1]).toMatchObject({
      description: 'Bolivian Civil War',
      target: 'Bolivia',
      timestamp: '1898-11-06T00:00:00Z',
      confidence: 0.9,
      source: { type: 'wikidata', wikidataId: 'Q5887712' },
    });
    // A day records nothing; a year records its precision, so it is shown as "427 BCE", not "Jan 1, 427 BC".
    expect(result.events[1].datePrecision).toBeUndefined();
    expect(result.events[2]).toMatchObject({ description: 'Corcyrean Civil War', timestamp: '-000426-01-01T00:00:00Z', datePrecision: 'year' });
    expect(result.sources[0].type).toBe('wikidata');
    expect(http.requests[0].method).toBe('POST');
    expect(http.requests[0].body).toContain('query=');
  });

  it('filters facts to the context time range', async () => {
    const http = new SingleResponseHttpClient(thermopylae);
    const extractor = new WikidataExtractor({ httpClient: http });

    const result = await extractor.extract(
      { queryType: 'historical-events', parameters: { subject: 'Q131969' } },
      { defaultTimeRange: { start: '-000479-08-01T00:00:00Z', end: '-000479-08-31T00:00:00Z' } }
    );

    expect(result.events.map((event) => event.timestamp)).toEqual(['-000479-08-06T00:00:00Z', '-000479-08-06T00:00:00Z']);
  });

  it('reads the time range by the one rule: year-first text, an end to its last moment', async () => {
    const http = new SingleResponseHttpClient(thermopylae);
    const extractor = new WikidataExtractor({ httpClient: http });

    // "480-07 BCE" as an end is the whole of July 480 BC: the month row is inside it, 6 August is not.
    const result = await extractor.extract(
      { queryType: 'historical-events', parameters: { subject: 'Q131969' } },
      { defaultTimeRange: { start: '481 BCE', end: '480-07 BCE' } }
    );
    expect(result.events.map((event) => event.timestamp)).toEqual(['-000479-07-01T00:00:00Z', '-000479-07-01T00:00:00Z']);
  });

  it('refuses a bound it cannot read, with the reason, rather than dropping it and returning every fact', async () => {
    const extractor = new WikidataExtractor({ httpClient: new SingleResponseHttpClient(historicalEvents) });
    // Prose the lenient stored-text reader would have read in the server's zone, and a date that does not exist.
    await expect(
      extractor.extract({ queryType: 'historical-events' }, { defaultTimeRange: { start: 'April 1846', end: '1846-04-30' } })
    ).rejects.toMatchObject({ statusCode: 400, field: 'context.defaultTimeRange.start', message: expect.stringContaining('"April 1846" is not a date') });
    await expect(
      extractor.extract({ queryType: 'historical-events' }, { defaultTimeRange: { start: '1846-04-01', end: '1846-02-30' } })
    ).rejects.toMatchObject({ field: 'context.defaultTimeRange.end', message: expect.stringContaining('That month has no day 30') });
    await expect(
      extractor.extract({ queryType: 'historical-events' }, { defaultTimeRange: { start: '1847', end: '1846' } })
    ).rejects.toThrow(/ends before it starts/);
  });

  it('sends the shipped historical-events query, not a subclass-of-war query', async () => {
    const http = new SingleResponseHttpClient(historicalEvents);
    const extractor = new WikidataExtractor({ httpClient: http });

    await extractor.extract({ queryType: 'historical-events' });

    const body = decodeURIComponent(http.requests[0].body ?? '');
    expect(body).toContain('psv:P580');
    expect(body).toContain('psv:P585');
    expect(body).toContain('wikibase:timePrecision ?precision');
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

  it('reads the BCE rows the query service returns as the years they name, at their precision', async () => {
    // Recorded 2026-11-15: Thermopylae (Q131969), whose entity JSON gives -0480-07-00 (July 480 BC, month
    // precision) and -0480-08-11 (11 August 480 BC, Julian); the query service writes -0479-07-01 and
    // -0479-08-06 (XSD 1.1 years, the day converted to Gregorian). One row per place, as ever.
    const extractor = new WikidataExtractor({ httpClient: new SingleResponseHttpClient(thermopylae) });
    const result = await extractor.extract({ queryType: 'historical-events', parameters: { subject: 'Q131969' } });
    expect(result.events.map((event) => [event.timestamp, event.datePrecision])).toEqual([
      ['-000479-07-01T00:00:00Z', 'month'],
      ['-000479-08-06T00:00:00Z', undefined],
      ['-000479-07-01T00:00:00Z', 'month'],
      ['-000479-08-06T00:00:00Z', undefined],
    ]);
    expect(formatDateEntry(result.events[0]!.timestamp, 'month', null)).toBe('480-07 BCE');
    expect(formatDateEntry(result.events[1]!.timestamp, 'day', null)).toBe('480-08-06 BCE');
  });

  it("reads a BCE person's birth and death as the years they name", async () => {
    // Recorded 2026-11-15: Julius Caesar (Q1048). Entity JSON: born -0100-07-12 (preferred, month
    // precision), died -0044-03-15 (Julian, day precision); the query service: -0099-07-01 and -0043-03-13.
    const http = new SingleResponseHttpClient(caesar);
    const extractor = new WikidataExtractor({ httpClient: http });
    const result = await extractor.extract({ queryType: 'person-timeline', parameters: { person: 'Q1048' } });
    const dated = result.events.map((event) => [event.target, formatDateEntry(event.timestamp, event.datePrecision ?? 'day', null)]);
    expect(dated).toEqual([
      ['death', '44-03-13 BCE'],
      ['birth', '100-07 BCE'],
    ]);
    // The query asks for each date's precision, from the best-ranked statement's value node.
    const body = decodeURIComponent(http.requests[0]!.body ?? '');
    expect(body).toContain('?person p:P570 ?statement . ?statement a wikibase:BestRank ; psv:P570 [ wikibase:timeValue ?date ; wikibase:timePrecision ?precision ]');
    expect(caesar.head.vars).toEqual(['person', 'personLabel', 'date', 'precision', 'eventLabel']);
  });

  it('reads deep dates from a custom query to the year, exactly, and drops those beyond the timeline', async () => {
    // Recorded 2026-11-15, a `custom` query for extinction events (Q123509) with their precision:
    //   SELECT ?event ?eventLabel ?date ?precision WHERE { ?event wdt:P31/wdt:P279* wd:Q123509 .
    //     ?event wdt:P585 ?date ; p:P585/psv:P585 [ wikibase:timeValue ?date ; wikibase:timePrecision ?precision ] .
    //     SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } LIMIT 10
    // Precisions 3 and 4 (a million and 100,000 years), and 8 (a decade); the year is counted back from 1 CE there.
    const extractor = new WikidataExtractor({ httpClient: new SingleResponseHttpClient(deepTime) });
    const result = await extractor.extract({ queryType: 'custom', customQuery: 'SELECT ...' });
    const shown = new Map(result.events.map((event) => [event.description, formatDateEntry(event.timestamp, event.datePrecision ?? 'day', null)]));
    expect(shown.get('Cretaceous-Paleogene mass extinction')).toBe('66000000 BCE');
    expect(shown.get('Permian-Triassic mass extinction')).toBe('251900000 BCE');
    expect(shown.get('Quaternary extinction event')).toBe('9750 BCE');
    expect(result.events.every((event) => event.datePrecision === 'year')).toBe(true);
    // Exact on the axis, far beyond a double's whole milliseconds.
    const kpg = result.events.find((event) => event.description === 'Cretaceous-Paleogene mass extinction')!;
    expect(toAxisTime(kpg.timestamp)).toBe(axisTimeOfCivil(-65999999, 1, 1));
    // Three are older than the timeline's ±285 million years (the Late Devonian, 372 million years ago, and two older).
    expect(deepTime.results.bindings).toHaveLength(10);
    expect(result.events).toHaveLength(7);
    expect(shown.has('Late Devonian extinction')).toBe(false);
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

  it('counts every row it leaves out, and says why (#33)', async () => {
    const result = await new WikidataExtractor({ httpClient: new SingleResponseHttpClient(deepTime) }).extract({ queryType: 'historical-events' });
    // Three are older than the timeline's 285 million years.
    expect(result.droppedRows).toMatchObject({
      total: 3,
      reasons: [{ reason: 'before-timeline', count: 3, items: 3, itemIds: ['Q678023', 'Q1050953', 'Q1065985'], description: 'the date is beyond the timeline (older than about 285 million years)' }],
    });
  });

  it('reports each kind of dropped row on its own: no date, unreadable, beyond the timeline either way, outside the requested range', async () => {
    const row = (id: string, date: string | undefined, precision?: string) => ({
      event: { type: 'uri', value: `http://www.wikidata.org/entity/${id}` },
      eventLabel: { type: 'literal', value: id },
      ...(date === undefined ? {} : { date: { type: 'literal', value: date } }),
      ...(precision === undefined ? {} : { precision: { type: 'literal', value: precision } }),
    });
    const payload = {
      results: {
        bindings: [
          row('Q1', '1846-04-24T00:00:00Z', '11'),
          row('Q2', undefined),
          row('Q3', 'not a date'),
          row('Q4', '1066-02-30T00:00:00Z', '11'),
          row('Q5', '-13787000000-01-01T00:00:00Z', '0'),
          row('Q6', '+13787000000-01-01T00:00:00Z', '0'),
          row('Q7', '1900-01-01T00:00:00Z', '9'),
          row('Q8', 'http://www.wikidata.org/.well-known/genid/abc'),
          // The last day of the last year the axis holds, past its bound: beyond the timeline, not unreadable.
          row('Q9', `+${topYear}-12-31T00:00:00Z`, '11'),
          'not a row',
        ],
      },
    };
    const result = await new WikidataExtractor({ httpClient: new SingleResponseHttpClient(payload) }).extract(
      { queryType: 'historical-events' },
      { defaultTimeRange: { start: '1800', end: '1850' } }
    );
    expect(result.events.map((event) => event.description)).toEqual(['Q1']);
    const counts = Object.fromEntries(result.droppedRows!.reasons.map((r) => [r.reason, r.count]));
    expect(counts).toEqual({ 'no-date': 2, unreadable: 3, 'before-timeline': 1, 'after-timeline': 2, 'outside-range': 1 });
    expect(result.droppedRows!.total).toBe(9);
  });

  it('counts the distinct items and names them, ten at most, one result per place', async () => {
    const row = (id: string, place: string) => ({
      event: { type: 'uri', value: `http://www.wikidata.org/entity/${id}` },
      eventLabel: { type: 'literal', value: id },
      placeLabel: { type: 'literal', value: place },
      date: { type: 'literal', value: '-13787000000-01-01T00:00:00Z' },
      precision: { type: 'literal', value: '0' },
    });
    const bindings = [row('Q1', 'a'), row('Q1', 'b'), row('Q1', 'c')];
    for (let i = 2; i <= 14; i++) bindings.push(row(`Q${i}`, 'x'));
    const result = await new WikidataExtractor({ httpClient: new SingleResponseHttpClient({ results: { bindings } }) }).extract({ queryType: 'historical-events' });
    const [entry] = result.droppedRows!.reasons;
    expect(entry).toMatchObject({ reason: 'before-timeline', count: 16, items: 14 });
    expect(entry.itemIds).toEqual(['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9', 'Q10']);
  });

  it('reports nothing when nothing was dropped', async () => {
    const result = await new WikidataExtractor({ httpClient: new SingleResponseHttpClient(normanConquest) }).extract({ queryType: 'historical-events' });
    expect(result.droppedRows).toBeUndefined();
  });
});
