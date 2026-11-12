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
  /** What the calendar is called, e.g. "the Reckoning of Vael". Display only. */
  name?: string;
  /**
   * The world's names for the twelve months, January's first. Absent shows the
   * stored months' names ("Mar"). Exactly twelve, distinct, none empty.
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
    }
  }
  if (record.name !== undefined) {
    if (typeof record.name !== 'string') {
      problems.push('calendar.name must be a string');
    } else if (record.name.trim().length > MAX_CALENDAR_NAME_LENGTH) {
      problems.push(`calendar.name must be at most ${MAX_CALENDAR_NAME_LENGTH} characters`);
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

/** "the months January to December are Thaw, Seed, …": which name is which stored month. */
function describeMonths(monthNames: string[]): string {
  return `the months January to December are ${monthNames.join(', ')}`;
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
    ? ` Its months, in order, are ${calendar.monthNames.join(', ')}: the first is January, the twelfth December, and a day keeps its number.`
    : '';
  return (
    `The text dates events in an invented world's calendar${named}. ` +
    `Its year N${written} is the ISO year N + ${calendar.epochYear - 1}.${months} ` +
    'Give every timestamp as that ISO date.'
  );
}
