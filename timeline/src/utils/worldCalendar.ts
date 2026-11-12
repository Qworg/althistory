/**
 * A graph's own calendar, for invented worlds.
 *
 * Every timestamp is still a UTC instant on the proleptic Gregorian calendar;
 * that is what sorting, validation, the time scales and the causal-order checks
 * read, and none of it changes. A calendar relabels a date when it is shown:
 * with `epochYear: 1000` and `eraLabel: "AR"`, the stored year 1000 is shown as
 * "1 AR" and 1311 as "312 AR". It can also name the twelve months
 * (`monthNames`), so March 4 reads "Thaw 4". The months keep their stored
 * lengths and order, and the days their numbers: a world with thirteen months,
 * or months of other lengths, cannot be written, because every date is still a
 * Gregorian one underneath.
 *
 * The frontend has the same arithmetic in `frontend/src/utils/historicalTime.ts`;
 * the two must agree.
 */

export interface GraphCalendar {
  /** The stored (Gregorian) year that is year 1 of this world. */
  epochYear: number;
  /** Written after the year: "AR" shows the year as "312 AR". Absent or empty shows "Year 312". */
  eraLabel?: string;
  /** What the calendar is called, e.g. "the Reckoning of the Rising". Display only. */
  name?: string;
  /**
   * The world's names for the twelve months, January's first. Absent shows the
   * stored months' names ("Mar"). Exactly twelve, distinct, none empty, and
   * none holding a comma (the separator wherever the list is written out), a
   * `|` (a Markdown table's) or a control character.
   */
  monthNames?: string[];
}

/** The years a timestamp can hold without an expanded (six-digit) year. */
export const MIN_EPOCH_YEAR = 1;
export const MAX_EPOCH_YEAR = 9999;
export const MAX_ERA_LABEL_LENGTH = 16;
export const MAX_CALENDAR_NAME_LENGTH = 80;
export const MONTH_COUNT = 12;
export const MAX_MONTH_NAME_LENGTH = 24;
/**
 * What no month name may hold: a comma, which separates the names in the
 * flags, the export and what a model is told ("Thaw, early" would read as two
 * months and shift the rest); a `|`, which splits a Markdown table cell; and a
 * control character, such as a newline that would start a line of its own in
 * a model's instructions.
 */
const FORBIDDEN_IN_MONTH_NAME = /[,|\p{Cc}\p{Zl}\p{Zp}]/u;
/**
 * What the era label and the calendar's name may not hold, for the same
 * reasons: the label is in every date of an export's tables, and both go into
 * a model's instructions. A comma is fine in them; nothing lists them.
 */
const FORBIDDEN_IN_LABEL = /[|\p{Cc}\p{Zl}\p{Zp}]/u;

/**
 * Check a calendar from outside (a request body, a tool argument, an import).
 * Returns the problems found; an empty list means it is usable.
 */
export function calendarProblems(value: unknown): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return ['calendar must be an object with an epochYear'];
  }
  const record = value as Record<string, unknown>;
  const problems: string[] = [];
  const known = new Set(['epochYear', 'eraLabel', 'name', 'monthNames']);
  for (const key of Object.keys(record)) {
    if (!known.has(key)) problems.push(`calendar has an unknown field "${key}"`);
  }
  const epoch = record.epochYear;
  if (typeof epoch !== 'number' || !Number.isInteger(epoch)) {
    problems.push('calendar.epochYear must be an integer year');
  } else if (epoch < MIN_EPOCH_YEAR || epoch > MAX_EPOCH_YEAR) {
    problems.push(`calendar.epochYear must be between ${MIN_EPOCH_YEAR} and ${MAX_EPOCH_YEAR}`);
  }
  if (record.eraLabel !== undefined) {
    if (typeof record.eraLabel !== 'string') {
      problems.push('calendar.eraLabel must be a string');
    } else if (record.eraLabel.trim().length > MAX_ERA_LABEL_LENGTH) {
      problems.push(`calendar.eraLabel must be at most ${MAX_ERA_LABEL_LENGTH} characters`);
    } else if (FORBIDDEN_IN_LABEL.test(record.eraLabel)) {
      problems.push('calendar.eraLabel cannot contain a "|" or a line break or other control character');
    }
  }
  if (record.name !== undefined) {
    if (typeof record.name !== 'string') {
      problems.push('calendar.name must be a string');
    } else if (record.name.trim().length > MAX_CALENDAR_NAME_LENGTH) {
      problems.push(`calendar.name must be at most ${MAX_CALENDAR_NAME_LENGTH} characters`);
    } else if (FORBIDDEN_IN_LABEL.test(record.name)) {
      problems.push('calendar.name cannot contain a "|" or a line break or other control character');
    }
  }
  if (record.monthNames !== undefined) {
    problems.push(...monthNameProblems(record.monthNames));
  }
  return problems;
}

function monthNameProblems(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    return [`calendar.monthNames must be a list of ${MONTH_COUNT} names`];
  }
  const names = (value as string[]).map((entry) => entry.trim());
  if (names.length !== MONTH_COUNT) {
    return [`calendar.monthNames must name all ${MONTH_COUNT} months (got ${names.length})`];
  }
  const problems: string[] = [];
  if (names.some((name) => name.length === 0)) {
    problems.push('calendar.monthNames cannot have an empty name');
  }
  if (names.some((name) => name.length > MAX_MONTH_NAME_LENGTH)) {
    problems.push(`calendar.monthNames must each be at most ${MAX_MONTH_NAME_LENGTH} characters`);
  }
  if (names.some((name) => FORBIDDEN_IN_MONTH_NAME.test(name))) {
    problems.push('calendar.monthNames cannot contain a comma, a "|" or a line break or other control character');
  }
  const seen = new Set<string>();
  for (const name of names) {
    const key = name.toLowerCase();
    if (name && seen.has(key)) {
      problems.push(`calendar.monthNames names "${name}" twice`);
      break;
    }
    seen.add(key);
  }
  return problems;
}

/** A checked calendar, trimmed, with empty optional fields dropped. Throws on a bad one. */
export function normalizeCalendar(value: unknown): GraphCalendar {
  const problems = calendarProblems(value);
  if (problems.length > 0) {
    throw new Error(problems.join('; '));
  }
  const record = value as GraphCalendar;
  const calendar: GraphCalendar = { epochYear: record.epochYear };
  const eraLabel = record.eraLabel?.trim();
  if (eraLabel) calendar.eraLabel = eraLabel;
  const name = record.name?.trim();
  if (name) calendar.name = name;
  if (record.monthNames) calendar.monthNames = record.monthNames.map((month) => month.trim());
  return calendar;
}

/**
 * A calendar read back from where it was stored or carried (the graph index,
 * an export being imported, an answer from the app), keeping what still
 * checks out. A calendar written before a rule was added (a "|" in its label,
 * a comma in a month name) loses that field, not its epoch: dropping the whole
 * calendar would turn the world's years back into stored ones without a word.
 * Without a usable epoch there is no calendar. Writes refuse a bad calendar
 * outright (`calendarProblems`); this is only for reading.
 */
export function storedCalendar(value: unknown): GraphCalendar | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const base = { epochYear: record.epochYear };
  if (calendarProblems(base).length > 0) return undefined;
  const kept: Record<string, unknown> = { ...base };
  for (const field of ['eraLabel', 'name', 'monthNames'] as const) {
    if (record[field] !== undefined && calendarProblems({ ...base, [field]: record[field] }).length === 0) {
      kept[field] = record[field];
    }
  }
  return normalizeCalendar(kept);
}

/** The world's year for a stored year: the epoch year is 1, the year before it 0. */
export function worldYear(storedYear: number, calendar: GraphCalendar): number {
  return storedYear - calendar.epochYear + 1;
}

/** The stored year that shows as the given world year. */
export function storedYear(year: number, calendar: GraphCalendar): number {
  return year + calendar.epochYear - 1;
}

/**
 * A world year as words: "312 AR", or "Year 312" without a label. A year before
 * year 1 counts back from it: the year before the epoch is "1 before AR" (or
 * "1 before Year 1"), because a year 0 or a minus sign reads as an error.
 */
export function formatWorldYear(storedYearValue: number, calendar: GraphCalendar): string {
  const year = worldYear(storedYearValue, calendar);
  const label = calendar.eraLabel?.trim();
  if (year >= 1) return label ? `${year} ${label}` : `Year ${year}`;
  const before = 1 - year;
  return label ? `${before} before ${label}` : `${before} before Year 1`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A month (0 = January) by the world's name for it, or the stored month's short name. */
export function worldMonthName(monthIndex: number, calendar: GraphCalendar | undefined): string {
  return calendar?.monthNames?.[monthIndex] ?? MONTHS[monthIndex];
}

/**
 * A stored timestamp as a date in the world's calendar: "Mar 4, 312 AR", or
 * "Thaw 4, 312 AR" when the calendar names its months.
 * Without a calendar it is the ISO date ("1311-03-04"), as exports always wrote it.
 * `precision` drops the parts its source did not state.
 */
export function formatWorldDate(
  timestamp: string | Date,
  calendar: GraphCalendar | undefined,
  precision: 'day' | 'month' | 'year' = 'day'
): string {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(date.getTime())) return String(timestamp);
  if (!calendar) {
    const iso = date.toISOString();
    return precision === 'year' ? iso.slice(0, 4) : precision === 'month' ? iso.slice(0, 7) : iso.slice(0, 10);
  }
  const year = formatWorldYear(date.getUTCFullYear(), calendar);
  const month = worldMonthName(date.getUTCMonth(), calendar);
  if (precision === 'year') return year;
  if (precision === 'month') return `${month} ${year}`;
  return `${month} ${date.getUTCDate()}, ${year}`;
}

/** One line saying how the calendar maps, for exports and tool output. */
export function describeCalendar(calendar: GraphCalendar): string {
  const named = calendar.name ? `${calendar.name}: ` : '';
  const years = `${named}stored year ${calendar.epochYear} is ${formatWorldYear(calendar.epochYear, calendar)}`;
  return calendar.monthNames ? `${years}; ${describeMonths(calendar.monthNames)}` : years;
}

const MONTH_WORDS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "January is Lowtide, February is Greywater, …": which name is which stored month. */
function monthPairs(monthNames: string[]): string {
  return monthNames.map((name, index) => `${MONTH_WORDS[index]} is ${name}`).join(', ');
}

/** "the months: January is Lowtide, …", for a calendar's one-line description. */
function describeMonths(monthNames: string[]): string {
  return `the months: ${monthPairs(monthNames)}`;
}

/**
 * What a reader of prose about the world (a language model extracting events)
 * needs to turn the world's dates into stored ones: how its years are counted
 * and, if it names them, which month is which.
 */
export function calendarExtractionInstructions(calendar: GraphCalendar): string {
  const named = calendar.name ? ` (${calendar.name})` : '';
  const written = calendar.eraLabel ? ` (written "N ${calendar.eraLabel}")` : '';
  const months = calendar.monthNames
    ? ` Its months are the ISO months under other names: ${monthPairs(calendar.monthNames)}. A day keeps its number.`
    : '';
  const before = calendar.eraLabel ? `"N before ${calendar.eraLabel}"` : '"N before Year 1"';
  return (
    `The text dates events in an invented world's calendar${named}. ` +
    `Its year N${written} is the ISO year N + ${calendar.epochYear - 1}, and a year counted back, ${before}, ` +
    `is the ISO year ${calendar.epochYear} - N.${months} ` +
    'Give every timestamp as that ISO date.'
  );
}
