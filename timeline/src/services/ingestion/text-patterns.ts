/**
 * Date and named-entity patterns shared by the text and Wikipedia extractors.
 *
 * This is deliberately pattern-based and offline (spec Req 9.1). It recognises
 * ISO dates, `Month D, YYYY`, `D Month YYYY`, `Month YYYY`, and a bare year in
 * the range 1000-2100 only when it carries an `AD` or `CE` suffix. It does NOT
 * support BCE/BC dates: JavaScript's `Date` cannot round-trip a negative year,
 * and `ImportService` rejects any timestamp `Date.parse` cannot read, so a BCE
 * match would only produce an entity that fails validation. That gap is stated
 * in the source disclosure in `./index.ts`; there is no separate ingestion
 * report file.
 */

export type DatePrecision = 'day' | 'month' | 'year';

export interface DateMatch {
  raw: string;
  index: number;
  /** ISO-8601 timestamp. Missing day/month components default to 01. */
  iso: string;
  precision: DatePrecision;
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9,
  oct: 10, nov: 11, dec: 12,
};

const MONTH_NAME = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join('|');

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

function toIso(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, '0')}-${pad2(month)}-${pad2(day)}T00:00:00Z`;
}

interface RawMatch {
  raw: string;
  index: number;
  iso: string;
  precision: DatePrecision;
  /** Higher wins when two matches overlap. */
  rank: number;
}

/**
 * Extract every recognised date, dropping overlapping lower-precision matches
 * (e.g. the bare `1914` inside `28 June 1914`).
 */
export function extractDates(text: string): DateMatch[] {
  const matches: RawMatch[] = [];

  const push = (match: RawMatch): void => {
    // Reject impossible calendar components early; `Date.parse` would roll them.
    const parsed = new Date(match.iso);
    if (Number.isNaN(parsed.getTime())) return;
    matches.push(match);
  };

  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const year = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const day = parseInt(m[3], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    push({ raw: m[0], index: m.index ?? 0, iso: toIso(year, month, day), precision: 'day', rank: 3 });
  }

  for (const m of text.matchAll(new RegExp(`\\b(${MONTH_NAME})\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, 'gi'))) {
    const month = MONTHS[m[1].toLowerCase()];
    const day = parseInt(m[2], 10);
    const year = parseInt(m[3], 10);
    if (!month || day < 1 || day > 31) continue;
    push({ raw: m[0], index: m.index ?? 0, iso: toIso(year, month, day), precision: 'day', rank: 3 });
  }

  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})\\s+(${MONTH_NAME})\\s+(\\d{4})\\b`, 'gi'))) {
    const day = parseInt(m[1], 10);
    const month = MONTHS[m[2].toLowerCase()];
    const year = parseInt(m[3], 10);
    if (!month || day < 1 || day > 31) continue;
    push({ raw: m[0], index: m.index ?? 0, iso: toIso(year, month, day), precision: 'day', rank: 3 });
  }

  for (const m of text.matchAll(new RegExp(`\\b(${MONTH_NAME})\\s+(\\d{4})\\b`, 'gi'))) {
    const month = MONTHS[m[1].toLowerCase()];
    const year = parseInt(m[2], 10);
    if (!month) continue;
    push({ raw: m[0], index: m.index ?? 0, iso: toIso(year, month, 1), precision: 'month', rank: 2 });
  }

  for (const m of text.matchAll(/\b(1\d{3}|20\d{2})\s*(?:AD|CE)\b/g)) {
    const year = parseInt(m[1], 10);
    push({ raw: m[0], index: m.index ?? 0, iso: toIso(year, 1, 1), precision: 'year', rank: 1 });
  }

  const accepted: RawMatch[] = [];
  for (const match of matches.sort((a, b) => a.index - b.index || b.rank - a.rank)) {
    const end = match.index + match.raw.length;
    const overlaps = accepted.some((existing) => {
      const existingEnd = existing.index + existing.raw.length;
      return match.index < existingEnd && existing.index < end;
    });
    if (!overlaps) accepted.push(match);
  }

  return accepted
    .sort((a, b) => a.index - b.index)
    .map(({ raw, index, iso, precision }) => ({ raw, index, iso, precision }));
}

/** Split prose into sentences on terminal punctuation. Abbreviations are not handled. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

// Words that begin a sentence or are too generic to be an actor.
const ENTITY_STOPWORDS = new Set([
  'The', 'A', 'An', 'In', 'On', 'At', 'By', 'During', 'After', 'Before', 'From',
  'To', 'For', 'With', 'And', 'But', 'It', 'He', 'She', 'They', 'This', 'That',
  'These', 'Those', 'His', 'Her', 'Their', 'Its', 'When', 'Then', 'However',
  'Meanwhile', 'Later', 'Following', 'World', 'On', 'Also', 'As', 'Of',
]);

// Month names are recognised as dates, not entities, when they stand alone.
const MONTH_WORDS = new Set([
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
]);

/**
 * Very small proper-noun detector: runs of capitalised words, optionally
 * joined by `of`. Not a real NER model, and it does not resolve coreference.
 */
export function extractCapitalizedEntities(text: string): string[] {
  const entities: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(/\b([A-Z][a-z]+(?:\s+(?:of|the|de|von|van)?\s*[A-Z][a-z]+)*)\b/g)) {
    // A leading sentence word can be captured as part of the phrase
    // ("The Treaty of Paris"); drop leading stopwords rather than the whole.
    const words = m[1].trim().split(/\s+/);
    while (words.length > 0 && ENTITY_STOPWORDS.has(words[0])) {
      words.shift();
    }
    const value = words.join(' ');
    if (value.length < 3) continue;
    if (MONTH_WORDS.has(value.toLowerCase())) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    entities.push(value);
  }
  return entities;
}
