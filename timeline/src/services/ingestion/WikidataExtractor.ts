/**
 * Wikidata extractor (spec Req 8).
 *
 * Runs SPARQL against the Wikidata query service through the injected
 * {@link HttpClient} and maps each result binding to an {@link ExtractedEvent}.
 * Three query types are supported: `historical-events`, `person-timeline` and
 * `custom` (a caller-supplied query). Results carry the Wikidata entity id in
 * their provenance. Dates before year 1 are not representable by `Date` and
 * are dropped; that limit is recorded in the ingestion report.
 */

import { DataSource } from '../ExportService';
import { HttpClient, JsonValue, parseJsonBody } from './http';
import { newTempId } from './ids';
import {
  ExtractedEvent,
  ExtractionContext,
  ExtractionResult,
  Extractor,
  WikidataExtractionInput,
} from './types';

const WIKIDATA_ENDPOINT = 'https://query.wikidata.org/sparql';
const DEFAULT_LIMIT = 50;
const HARD_LIMIT = 500;

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
  placeLabel: string;
  personLabel: string;
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
      'SELECT ?person ?personLabel ?date ?eventLabel WHERE {',
      `  VALUES ?person { wd:${person} }`,
      '  { ?person wdt:P569 ?date . BIND("birth" AS ?eventLabel) }',
      '  UNION',
      '  { ?person wdt:P570 ?date . BIND("death" AS ?eventLabel) }',
      '  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }',
      `} LIMIT ${limit}`,
    ].join('\n');
  }

  const subject = input.parameters?.subject;
  const subjectClause = subject && /^Q\d+$/.test(subject) ? `  VALUES ?event { wd:${subject} }\n` : '';
  return [
    'SELECT ?event ?eventLabel ?date ?placeLabel WHERE {',
    subjectClause,
    '  ?event wdt:P31/wdt:P279* wd:Q198 .',
    '  ?event wdt:P585 ?date .',
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

/** Normalize a Wikidata date value to an ISO-8601 instant, or null if unusable. */
export function normalizeWikidataDate(value: string): string | null {
  const match = value.match(/^\+?(\d{4})-(\d{2})-(\d{2})(?:T[\d:.]+Z?)?$/);
  if (!match) return null;
  const year = match[1];
  const month = match[2];
  const day = match[3];
  return `${year}-${month}-${day}T00:00:00Z`;
}

/**
 * Read `results.bindings` from a SPARQL JSON result set into facts.
 * `entityType` distinguishes the two predefined queries' label semantics.
 */
export function parseWikidataResponse(
  payload: unknown,
  entityType: 'event' | 'person'
): WikidataFact[] {
  if (!isJsonObject(payload)) {
    throw new Error('Wikidata response was not a JSON object');
  }
  const results = payload.results;
  if (!isJsonObject(results) || !Array.isArray(results.bindings)) {
    throw new Error('Wikidata response did not contain results.bindings');
  }

  const facts: WikidataFact[] = [];
  for (const rawBinding of results.bindings) {
    if (!isJsonObject(rawBinding)) continue;
    const date = normalizeWikidataDate(bindingValue(rawBinding, 'date'));
    if (!date) continue;

    if (entityType === 'event') {
      const entityUrl = bindingValue(rawBinding, 'event');
      const entityId = entityUrl.split('/').pop() ?? '';
      const label = bindingValue(rawBinding, 'eventLabel') || entityId;
      facts.push({
        entityId,
        entityType,
        label,
        date,
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
        placeLabel: '',
        personLabel,
      });
    }
  }

  return facts;
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
        'User-Agent': 'AlthistoryIngestion/1.0 (local research tool)',
      },
      body: `query=${encodeURIComponent(query)}`,
    });

    const payload = parseJsonBody(response.body, 'Wikidata');
    const facts = parseWikidataResponse(payload, entityType);
    const filtered = this.applyTimeRange(facts, context?.defaultTimeRange);
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
    };
  }

  private applyTimeRange(
    facts: WikidataFact[],
    range?: { start: string; end: string }
  ): WikidataFact[] {
    if (!range) return facts;
    const start = Date.parse(range.start);
    const end = Date.parse(range.end);
    if (Number.isNaN(start) || Number.isNaN(end)) return facts;
    return facts.filter((fact) => {
      const time = Date.parse(fact.date);
      return !Number.isNaN(time) && time >= start && time <= end;
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
      confidence: 0.9,
      source: { type: 'wikidata', wikidataId: fact.entityId, url: wikidataUrl, extractedAt },
      selected: true,
      edited: false,
    };
  }
}
