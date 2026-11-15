/**
 * Reading a world calendar from command-line flags or tool arguments.
 *
 * The flags are `--epoch-year`, `--era-label`, `--calendar-name` and
 * `--month-names`; the MCP tools take the same four as `epochYear`, `eraLabel`,
 * `calendarName` and `monthNames`.
 */

import { type GraphCalendar, type WorldCalendarSet, calendarSetFromInput, normalizeCalendar, parseEpochYear, parseMonthNames } from '@althistory/calendar';
import { ValidationErrorCLI } from './exitCodes';

export interface CalendarInput {
  epochYear?: unknown;
  eraLabel?: unknown;
  calendarName?: unknown;
  monthNames?: unknown;
  /** A whole calendar set (an object, or its JSON text): calendars of any shape. */
  calendar?: unknown;
}

/** A whole calendar set given as an object or as JSON text; a CLI error naming what is wrong otherwise. */
function calendarSetFrom(value: unknown): WorldCalendarSet {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new ValidationErrorCLI('The calendar must be a JSON object: { "version": 2, "dayLength": 86400, "calendars": [...], "primary": "..." }');
    }
  }
  try {
    return calendarSetFromInput(parsed);
  } catch (err) {
    throw new ValidationErrorCLI((err as Error).message);
  }
}

const SIMPLE_FIELDS = ['epochYear', 'eraLabel', 'calendarName', 'monthNames'] as const

/** An integer year from a flag ("1000", "+1000") or a tool argument (1000), read as the app's form reads it. */
function readYear(value: unknown): number {
  const year = parseEpochYear(value);
  if (year === null) {
    throw new ValidationErrorCLI(`Invalid epoch year "${String(value)}": expected a whole year such as 1000`);
  }
  return year;
}

/** Absent, null and empty all mean "not given": some clients send "" for an unset field. */
function isUnset(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

function readText(value: unknown, what: string): string | undefined {
  if (isUnset(value)) return undefined;
  if (typeof value !== 'string') {
    throw new ValidationErrorCLI(`${what} must be text`);
  }
  return value as string;
}

/**
 * Month names from a flag ("Thaw,Seed,…") or a tool argument (a list, or the
 * same text): text is read by `parseMonthNames`, as the app's form reads it
 * (a JSON list, one per line, or comma-separated). Counting and checking them
 * is `calendarProblems`'s job, so its message is the one every surface gives.
 */
function readMonthNames(value: unknown): string[] | undefined {
  if (isUnset(value)) return undefined;
  if (typeof value === 'string') return parseMonthNames(value);
  if (Array.isArray(value) && value.every((name) => typeof name === 'string')) {
    return value.map((name) => (name as string).trim());
  }
  throw new ValidationErrorCLI('The month names must be a list of twelve names, or the twelve separated by commas');
}

/**
 * The parts of a calendar that were given, unchecked: what `generate timeline`
 * takes, since it fills in the epoch year itself. Undefined when none was given.
 */
export function partialCalendarFrom(
  input: CalendarInput
): { epochYear?: number; eraLabel?: string; name?: string; monthNames?: string[] } | WorldCalendarSet | undefined {
  const whole = wholeCalendarFrom(input);
  if (whole) return whole;
  const epochYear = isUnset(input.epochYear) ? undefined : readYear(input.epochYear);
  const eraLabel = readText(input.eraLabel, 'The era label');
  const name = readText(input.calendarName, 'The calendar name');
  const monthNames = readMonthNames(input.monthNames);
  if (epochYear === undefined && eraLabel === undefined && name === undefined && monthNames === undefined) {
    return undefined;
  }
  return {
    ...(epochYear !== undefined ? { epochYear } : {}),
    ...(eraLabel !== undefined ? { eraLabel } : {}),
    ...(name !== undefined ? { name } : {}),
    ...(monthNames !== undefined ? { monthNames } : {}),
  };
}

/**
 * A whole calendar set when `calendar` is given, refusing it alongside the
 * simple fields (which describe a different calendar); undefined otherwise.
 */
function wholeCalendarFrom(input: CalendarInput): WorldCalendarSet | undefined {
  if (isUnset(input.calendar)) return undefined;
  const mixed = SIMPLE_FIELDS.filter((field) => !isUnset(input[field]));
  if (mixed.length > 0) {
    throw new ValidationErrorCLI(`Give either a whole calendar or the simple fields (${mixed.join(', ')}), not both`);
  }
  return calendarSetFrom(input.calendar);
}

/**
 * A complete, checked calendar, or undefined when no calendar was asked for.
 * A label, a name or month names without an epoch year is a mistake: the epoch is what
 * places the world's years.
 */
export function calendarFrom(input: CalendarInput): GraphCalendar | WorldCalendarSet | undefined {
  const whole = wholeCalendarFrom(input);
  if (whole) return whole;
  const partial = partialCalendarFrom(input) as { epochYear?: number } | undefined;
  if (!partial) return undefined;
  if (partial.epochYear === undefined) {
    throw new ValidationErrorCLI(
      'A calendar needs an epoch year: the stored year that is year 1 of the world (for example 1000)'
    );
  }
  try {
    return normalizeCalendar(partial);
  } catch (err) {
    throw new ValidationErrorCLI((err as Error).message);
  }
}
