/**
 * Wikidata extractor (spec Req 8).
 *
 * Runs SPARQL against the Wikidata query service through the injected
 * {@link HttpClient} and maps each result binding to an {@link ExtractedEvent}.
 * Three query types are supported: `historical-events`, `person-timeline` and
 * `custom` (a caller-supplied query). Results carry the Wikidata entity id in
 * their provenance. Each date is read with its precision (`timePrecision`), so
 * a year before 1 CE is the year it names and a month, a year, a decade or a
 * million years is stored as a month or a year (see {@link readWikidataTime}
 * for the numbering, measured against live data). A year beyond 9999 either
 * way is read: the timeline holds about 285 million years each side.
 *
 * `historical-events` matches items that are instances of an event class and
 * carry a date, reading the date from `point in time` (P585) **or** `start time`
 * (P580). Both properties are needed: the Norman conquest of England (Q200485)
 * records a start and end time (P580/P582) and no point in time, while the
 * Battle of Hastings (Q83224) records a point in time and no start time.
 *
 * The class anchors and the shape of the class test were measured against
 * query.wikidata.org, not assumed. `occurrence` (Q1190554), the real common
 * ancestor of battle and conquest, times out as an anchor (HTTP 504 after 65s),
 * and so does the equivalent `VALUES ?class { ... }` spelling of the two-class
 * test below; the `{ ... } UNION { ... }` form returns in about two seconds. See
 * {@link EVENT_CLASS_QIDS} for what is and is not covered. It remains a broad
 * heuristic rather than a curated chronology: it returns whatever matches first,
 * bounded by `limit`. End times (P582) are not read, so a war contributes its
 * start, not its conclusion.
 */

import { compareAxisTime, isoBeyondRange, parseIsoInstant, toAxisTime } from '@althistory/calendar';
import { DataSource } from '../ExportService';
import { HttpClient, JsonValue, parseJsonBody, wikimediaUserAgent } from './http';
import { newTempId } from './ids';
import { readTimeRange } from './timeRange';
import {
  ExtractedEvent,
  ExtractionContext,
  ExtractionResult,
  Extractor,
  WikidataExtractionInput,
} from './types';
import { DroppedRowCounts, countDropped, describeDroppedRows } from './droppedRows';

const WIKIDATA_ENDPOINT = 'https://query.wikidata.org/sparql';
const DEFAULT_LIMIT = 50;
const HARD_LIMIT = 500;

/**
 * The Wikidata classes a `historical-events` item may be an instance of, directly
 * or through any number of subclass (`P279*`) hops. Every entry was checked
 * against the live ontology and the live query service:
 *
 *   - `armed conflict` (Q350604): covers its subclasses `battle` (Q178561, the
 *     class of the Battle of Hastings Q83224) and `war` (Q198) one hop down.
 *   - `conquest` (Q1361229): the class of the Norman conquest of England
 *     (Q200485). A conquest is **not** a subclass of armed conflict, so it needs
 *     its own branch; dropping it would lose that item again.
 *
 * `occurrence` (Q1190554) is the common ancestor of both, and is deliberately
 * not used as an anchor: the broad query with it (or with the equivalent
 * `VALUES ?class { ... }` test) is one the query service cannot answer -- it
 * fails with HTTP 504 after about a minute -- while the two-branch form below
 * answers in about two seconds.
 *
 * Deliberately not covered: event kinds outside armed conflict and conquest
 * (treaties, elections, natural disasters, ...). A caller who needs those should
 * send a `custom` SPARQL query; this list is not a claim to cover "all historical
 * events".
 */
const EVENT_CLASS_QIDS: readonly string[] = ['Q350604', 'Q1361229'];

export interface WikidataExtractorDeps {
  httpClient: HttpClient;
  endpoint?: string;
  now?: () => Date;
}

export interface WikidataFact {
  entityId: string;
  entityType: 'event' | 'person';
  label: string;
  date: string;
  /** How much of `date` Wikidata states: a month or a year is stored at its first day with this recorded. */
  datePrecision: 'day' | 'month' | 'year';
  placeLabel: string;
  personLabel: string;
}

/**
 * A date property's best-ranked value with its precision, as a graph pattern
 * on `?subject`. `wdt:` gives the value alone, and the value alone cannot say
 * which year a BCE date is (see {@link readWikidataTime}); the statement's
 * value node (`psv:`) carries `timePrecision` too. `wikibase:BestRank` keeps
 * what `wdt:` keeps: the preferred statements, or the normal ones when none
 * is preferred.
 *
 * Measured on query.wikidata.org, for the broad `historical-events` query with
 * LIMIT 25, one request every 8 s.
 *
 * On 2026-11-15, during a rate-limiting outage: the `wdt:`-only query 3.4 s,
 * this form 7 s; `?statement a wikibase:BestRank` outside the branches 11 s
 * once and a timeout (60 s) once; joining the value node to the `wdt:` value
 * 51 s.
 *
 * On 2026-11-16, a healthy service (seconds per run, four runs each; the service caches,
 * so the first run of a form is not the slowest):
 *
 * | Form | Runs | Same rows as this form? |
 * | :-- | :-- | :-- |
 * | the old `wdt:`-only query (no precision) | 1.2, 2.4, 2.8, 1.9; again 2.6, 3.8, 1.2, 0.8 | no precision, so BCE and coarse dates are wrong |
 * | this form (`BestRank` in each branch) | 2.2, 4.1, 1.2, 4.4; again 4.7, 1.4, 1.9, 1.6 | -- |
 * | `wdt:` date joined to `psv:` for the precision | 35.4, 65 (HTTP 504), 57.0, 65 (HTTP 504) | not usable |
 * | `p:`/`psv:` with `FILTER(?rank != wikibase:DeprecatedRank)` | 2.3, 4.5, 9.2, 6.0 | not equivalent (a normal statement beside a preferred one stays); same rows on Thermopylae and the Norman conquest; slower |
 * | `VALUES (?p ?psv)`-driven, `BestRank` | 6.2, 5.8, 2.7, 5.2 | same rows on Thermopylae and the Norman conquest; slower |
 *
 * So the 7 s of the outage was mostly the outage: this form runs in 1 to 5 s,
 * about half a second behind the form that cannot read a BCE year (means of
 * 2.7 s and 2.1 s over the eight runs each), and no other form
 * that keeps the best-rank rule is faster. It stays.
 */
function datedBy(subject: string, property: string): string {
  return `?${subject} p:${property} ?statement . ?statement a wikibase:BestRank ; psv:${property} [ wikibase:timeValue ?date ; wikibase:timePrecision ?precision ] .`;
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(HARD_LIMIT, Math.floor(limit)));
}

/** Build the SPARQL text for a query type. `customQuery` wins verbatim. */
export function buildSparqlQuery(input: WikidataExtractionInput, limit: number): string {
  if (input.queryType === 'custom') {
    if (!input.customQuery || input.customQuery.trim().length === 0) {
      throw new Error('A custom Wikidata query requires a non-empty query string');
    }
    return input.customQuery.trim();
  }

  if (input.queryType === 'person-timeline') {
    const person = input.parameters?.person;
    if (!person || !/^Q\d+$/.test(person)) {
      throw new Error('person-timeline requires parameters.person to be a Wikidata id such as Q42');
    }
    return [
      'SELECT ?person ?personLabel ?date ?precision ?eventLabel WHERE {',
      `  VALUES ?person { wd:${person} }`,
      `  { ${datedBy('person', 'P569')} BIND("birth" AS ?eventLabel) }`,
      '  UNION',
      `  { ${datedBy('person', 'P570')} BIND("death" AS ?eventLabel) }`,
      '  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }',
      `} LIMIT ${limit}`,
    ].join('\n');
  }

  const subject = input.parameters?.subject;
  const subjectClause = subject && /^Q\d+$/.test(subject) ? `  VALUES ?event { wd:${subject} }\n` : '';
  const classBranches = EVENT_CLASS_QIDS.map((qid) => `{ ?event wdt:P31/wdt:P279* wd:${qid} . }`).join(
    ' UNION '
  );
  return [
    'SELECT ?event ?eventLabel ?date ?precision ?placeLabel WHERE {',
    subjectClause,
    `  { ${classBranches} }`,
    `  { ${datedBy('event', 'P585')} }`,
    '  UNION',
    `  { ${datedBy('event', 'P580')} }`,
    '  OPTIONAL { ?event wdt:P276 ?place . }',
    '  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }',
    `} LIMIT ${limit}`,
  ]
    .filter((line) => line.length > 0)
    .join('\n');
}

function isJsonObject(value: unknown): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function bindingValue(binding: { [key: string]: JsonValue }, key: string): string {
  const entry = binding[key];
  if (!isJsonObject(entry)) return '';
  return typeof entry.value === 'string' ? entry.value : '';
}

/**
 * A Wikidata time as the timeline stores it: the ISO 8601 instant (UTC
 * midnight of its first day, a year before 0000 or after 9999 expanded, as
 * `-000043-03-13T00:00:00Z`) and how much of it Wikidata states.
 *
 * Wikidata numbers years before 1 CE two ways, and which one a query result
 * uses depends on the precision. Measured on 2026-11-15 against
 * query.wikidata.org and Special:EntityData (the JSON the items are stored as;
 * the recordings are in `fixtures/wikidata-bce-*.json` and
 * `fixtures/wikidata-deep-time.json`):
 *
 * | Item, property | Entity JSON `time`, `precision` | SPARQL `timeValue` (and `wdt:`) |
 * | :-- | :-- | :-- |
 * | Q1048 (Julius Caesar), P570, Julian | `-0044-03-15`, 11 (day) | `-0043-03-13` |
 * | Q1048, P570, Gregorian | `-0044-00-00`, 9 (year) | `-0043-01-01` |
 * | Q220 (Rome), P571, Julian | `-0753-04-21`, 11 | `-0752-04-13` |
 * | Q131969 (Thermopylae), P585, Julian | `-0480-07-00`, 10 (month) | `-0479-07-01` |
 * | Q137567 (Asculum), P585 | `-0089-00-00`, 9 | `-0088-01-01` |
 * | Q2888236 (Cameria), P585 | `-0730-00-00`, 8 (decade) | `-0730-01-01` |
 * | Q513097 (Ten Kings), P585 | `-1400-00-00`, 7 (century) | `-1400-01-01` |
 * | Q55811 (K-Pg extinction), P585 | `-66000000-00-00`, 3 (million years) | `-66000000-01-01` |
 *
 * The JSON counts back from 1 CE with no year 0 ("-0044" is 44 BCE). The
 * query service writes XSD 1.1 years, where 0 is 1 BCE, for a precision of a
 * year or finer: it adds one to a BCE year ("-0043" is 44 BCE) and converts a
 * Julian day to the proleptic Gregorian calendar (15 March 44 BC is 13 March
 * 44 BCE). For a decade or coarser it leaves the year as the JSON has it, so
 * there "-0730" is 730 BCE. Both are read here as the year they name, stored
 * astronomically as ISO 8601 has it. Without a precision (a `custom` query
 * that selects none) a date is read as the query service writes most of them,
 * XSD 1.1, at day precision.
 *
 * Precision 11 and finer (day, hour, minute, second) is a day; 10 a month; 9
 * a year; 8 to 0 (decade to billion years) a year too, the year Wikidata
 * gives: a decade's representative year, or the round number of a deep date
 * ("66000000 BCE"), not one of our own rounding. A date beyond the timeline
 * (the Big Bang, -13787000000) is null.
 */
export function readWikidataTime(value: string, precision?: number): WikidataTime | null {
  const read = classifyWikidataTime(value, precision);
  return read.ok ? read.time : null;
}

export type WikidataTime = { timestamp: string; precision: 'day' | 'month' | 'year' };

/** Why a Wikidata date value is no date on the timeline. */
export type UnreadableWikidataTime = 'no-date' | 'unreadable' | 'before-timeline' | 'after-timeline';

/** {@link readWikidataTime}, saying why when the value cannot be read. */
export function classifyWikidataTime(
  value: string,
  precision?: number
): { ok: true; time: WikidataTime } | { ok: false; reason: UnreadableWikidataTime } {
  const fail = (reason: UnreadableWikidataTime) => ({ ok: false as const, reason });
  // Nothing, or Wikidata's "unknown value": a blank node, which the query service writes as a URI.
  if (value.trim() === '' || /^https?:\/\/.*genid/i.test(value.trim())) return fail('no-date');
  const match = value.trim().match(/^([+-]?)(\d{4,})-(\d{2})-(\d{2})(?:T[\d:.]+Z?)?$/);
  if (!match) return fail('unreadable');
  const [, sign, yearText, monthText, dayText] = match;
  const known = precision !== undefined && Number.isInteger(precision) && precision >= 0 && precision <= 14 ? precision : undefined;
  if (precision !== undefined && known === undefined) return fail('unreadable');
  const stated: 'day' | 'month' | 'year' = known === undefined || known >= 11 ? 'day' : known === 10 ? 'month' : 'year';
  const digits = Number(yearText);
  // Too many digits for a number is far beyond the timeline, whichever way it points.
  if (!Number.isSafeInteger(digits)) return fail(sign === '-' ? 'before-timeline' : 'after-timeline');
  // XSD 1.1 (0 is 1 BCE) at a year or finer, and without a precision; counted back from 1 CE (no year 0) coarser than that.
  const year = sign !== '-' ? digits : known !== undefined && known <= 8 ? 1 - digits : -digits;
  const month = stated === 'year' ? 1 : Number(monthText);
  const day = stated === 'day' ? Number(dayText) : 1;
  const pad2 = (n: number): string => String(n).padStart(2, '0');
  // ISO 8601: four digits within 0000-9999, else a sign and six or more.
  const isoYear = year >= 0 && year <= 9999 ? String(year).padStart(4, '0') : `${year < 0 ? '-' : '+'}${String(Math.abs(year)).padStart(6, '0')}`;
  const timestamp = `${isoYear}-${pad2(month)}-${pad2(day)}T00:00:00Z`;
  if (!parseIsoInstant(timestamp)) {
    // A moment past the axis's bound (even within its last year), or a month or day that does not exist.
    // A year with too many digits for ISO to scan has no first day on the axis either.
    if (isoBeyondRange(timestamp) || !parseIsoInstant(`${isoYear}-01-01T00:00:00Z`)) return fail(year < 0 ? 'before-timeline' : 'after-timeline');
    return fail('unreadable');
  }
  return { ok: true, time: { timestamp, precision: stated } };
}

/** A Wikidata date value as an ISO-8601 instant, or null if unusable (see {@link readWikidataTime}). */
export function normalizeWikidataDate(value: string, precision?: number): string | null {
  return readWikidataTime(value, precision)?.timestamp ?? null;
}

/**
 * Read `results.bindings` from a SPARQL JSON result set into facts.
 * `entityType` distinguishes the two predefined queries' label semantics.
 */
export function parseWikidataResponse(payload: unknown, entityType: 'event' | 'person'): WikidataFact[] {
  return readWikidataRows(payload, entityType).facts;
}

/** {@link parseWikidataResponse}, and the rows it left out, counted by reason. */
export function readWikidataRows(
  payload: unknown,
  entityType: 'event' | 'person'
): { facts: WikidataFact[]; dropped: DroppedRowCounts } {
  if (!isJsonObject(payload)) {
    throw new Error('Wikidata response was not a JSON object');
  }
  const results = payload.results;
  if (!isJsonObject(results) || !Array.isArray(results.bindings)) {
    throw new Error('Wikidata response did not contain results.bindings');
  }

  const facts: WikidataFact[] = [];
  const dropped: DroppedRowCounts = {};
  const idKey = entityType === 'event' ? 'event' : 'person';
  for (const rawBinding of results.bindings) {
    if (!isJsonObject(rawBinding)) {
      countDropped(dropped, 'unreadable', '');
      continue;
    }
    const precisionText = bindingValue(rawBinding, 'precision');
    const read = classifyWikidataTime(bindingValue(rawBinding, 'date'), precisionText === '' ? undefined : Number(precisionText));
    if (!read.ok) {
      countDropped(dropped, read.reason, (bindingValue(rawBinding, idKey).split('/').pop() ?? ''));
      continue;
    }
    const { timestamp: date, precision: datePrecision } = read.time;

    if (entityType === 'event') {
      const entityUrl = bindingValue(rawBinding, 'event');
      const entityId = entityUrl.split('/').pop() ?? '';
      const label = bindingValue(rawBinding, 'eventLabel') || entityId;
      facts.push({
        entityId,
        entityType,
        label,
        date,
        datePrecision,
        placeLabel: bindingValue(rawBinding, 'placeLabel'),
        personLabel: '',
      });
    } else {
      const personUrl = bindingValue(rawBinding, 'person');
      const entityId = personUrl.split('/').pop() ?? '';
      const personLabel = bindingValue(rawBinding, 'personLabel') || entityId;
      facts.push({
        entityId,
        entityType,
        label: bindingValue(rawBinding, 'eventLabel') || 'event',
        date,
        datePrecision,
        placeLabel: '',
        personLabel,
      });
    }
  }

  return { facts, dropped };
}

export class WikidataExtractor implements Extractor<WikidataExtractionInput> {
  readonly sourceType = 'wikidata' as const;
  private readonly httpClient: HttpClient;
  private readonly endpoint: string;
  private readonly now: () => Date;

  constructor(deps: WikidataExtractorDeps) {
    this.httpClient = deps.httpClient;
    this.endpoint = deps.endpoint ?? WIKIDATA_ENDPOINT;
    this.now = deps.now ?? (() => new Date());
  }

  async extract(
    input: WikidataExtractionInput,
    context?: ExtractionContext
  ): Promise<ExtractionResult> {
    const limit = clampLimit(input.limit);
    const query = buildSparqlQuery(input, limit);
    const entityType = input.queryType === 'person-timeline' ? 'person' : 'event';

    const response = await this.httpClient.request({
      url: this.endpoint,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/sparql-results+json',
        'User-Agent': wikimediaUserAgent(),
      },
      body: `query=${encodeURIComponent(query)}`,
    });

    const payload = parseJsonBody(response.body, 'Wikidata');
    const { facts, dropped } = readWikidataRows(payload, entityType);
    const filtered = this.applyTimeRange(facts, context);
    for (const fact of facts) if (!filtered.includes(fact)) countDropped(dropped, 'outside-range', fact.entityId);
    const droppedRows = describeDroppedRows(dropped);
    const extractedAt = this.now().toISOString();

    const events = filtered.map((fact) => this.toEvent(fact, extractedAt));
    const source: DataSource = {
      id: 'wikidata-source',
      type: 'wikidata',
      url: this.endpoint,
      accessedAt: extractedAt,
      confidence: events.length > 0 ? 0.9 : 0,
      entityIds: events.map((event) => event.tempId),
    };

    return {
      events,
      arcs: [],
      relationships: [],
      sources: events.length > 0 ? [source] : [],
      overallConfidence: events.length > 0 ? 0.9 : 0,
      ...(droppedRows ? { droppedRows } : {}),
    };
  }

  /**
   * The facts inside the context's range, compared exactly (deep-time.md
   * Req 3). A bound it cannot read is refused with the reason (a
   * ValidationError, which the API answers 400), not dropped: dropping it
   * would return every fact as if no range had been asked for.
   */
  private applyTimeRange(facts: WikidataFact[], context?: ExtractionContext): WikidataFact[] {
    const range = context?.defaultTimeRange;
    if (!range) return facts;
    const { start, end } = readTimeRange(range, context?.calendar);
    return facts.filter((fact) => {
      const time = toAxisTime(fact.date);
      return time !== null && compareAxisTime(time, start) >= 0 && compareAxisTime(time, end) <= 0;
    });
  }

  private toEvent(fact: WikidataFact, extractedAt: string): ExtractedEvent {
    const wikidataUrl = `https://www.wikidata.org/wiki/${fact.entityId}`;
    if (fact.entityType === 'person') {
      return {
        tempId: newTempId('wikidata'),
        description: `${fact.personLabel} — ${fact.label}`,
        actor: fact.personLabel,
        target: fact.label,
        timestamp: fact.date,
        ...(fact.datePrecision !== 'day' ? { datePrecision: fact.datePrecision } : {}),
        confidence: 0.9,
        source: { type: 'wikidata', wikidataId: fact.entityId, url: wikidataUrl, extractedAt },
        selected: true,
        edited: false,
      };
    }

    return {
      tempId: newTempId('wikidata'),
      description: fact.label,
      actor: fact.label,
      target: fact.placeLabel || fact.label,
      timestamp: fact.date,
      ...(fact.datePrecision !== 'day' ? { datePrecision: fact.datePrecision } : {}),
      confidence: 0.9,
      source: { type: 'wikidata', wikidataId: fact.entityId, url: wikidataUrl, extractedAt },
      selected: true,
      edited: false,
    };
  }
}
