/**
 * Reading a world calendar from command-line flags or tool arguments.
 *
 * The flags are `--epoch-year`, `--era-label`, `--calendar-name` and
 * `--month-names`; the MCP tools take the same four as `epochYear`, `eraLabel`,
 * `calendarName` and `monthNames`.
 */

import { GraphCalendar, normalizeCalendar } from '@/utils/worldCalendar';
import { ValidationErrorCLI } from './exitCodes';

export interface CalendarInput {
  epochYear?: unknown;
  eraLabel?: unknown;
  calendarName?: unknown;
  monthNames?: unknown;
}

/** An integer year from a flag ("1000") or a tool argument (1000). */
function readYear(value: unknown): number {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!/^-?\d+$/.test(text)) {
    throw new ValidationErrorCLI(`Invalid epoch year "${String(value)}": expected a whole year such as 1000`);
  }
  return Number(text);
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
 * Month names from a flag ("Thaw,Seed,…", comma-separated) or a tool argument
 * (a list, or the same comma-separated text). Counting and checking them is
 * `calendarProblems`'s job, so its message is the one every surface gives.
 */
function readMonthNames(value: unknown): string[] | undefined {
  if (isUnset(value)) return undefined;
  if (typeof value === 'string') return splitMonthNames(value);
  if (Array.isArray(value) && value.every((name) => typeof name === 'string')) {
    return value.map((name) => (name as string).trim());
  }
  throw new ValidationErrorCLI('The month names must be a list of twelve names, or the twelve separated by commas');
}

/**
 * Month names written as text, read the same way here as in the app's form
 * (`parseMonthNames` in frontend/src/utils/worldCalendar.ts):
 * - a JSON list ('["Lowtide", …]'), as an MCP client may send the array;
 * - one name per line, a comma ending a line dropped;
 * - otherwise separated by commas, a comma after the last name dropped.
 * Text with no names in it ("," or " ") has none. Anything else that is not
 * a name (brackets, quotes) stays in it and is refused by `calendarProblems`.
 */
export function splitMonthNames(value: string): string[] {
  const text = value.trim();
  if (/^\[[\s\S]*\]$/.test(text)) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (Array.isArray(parsed) && parsed.every((name) => typeof name === 'string')) {
        return parsed.map((name) => (name as string).trim());
      }
    } catch {
      // Not JSON: read as text, and the brackets are refused in the names.
    }
  }
  if (text.includes('\n')) {
    // A blank line in the middle is kept, and refused as an empty name.
    return text.split(/\r?\n/).map((line) => line.trim().replace(/,$/, '').trim());
  }
  const list = text.replace(/,\s*$/, '');
  return list.trim() === '' ? [] : list.split(',').map((name) => name.trim());
}

/**
 * The parts of a calendar that were given, unchecked: what `generate timeline`
 * takes, since it fills in the epoch year itself. Undefined when none was given.
 */
export function partialCalendarFrom(
  input: CalendarInput
): { epochYear?: number; eraLabel?: string; name?: string; monthNames?: string[] } | undefined {
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
 * A complete, checked calendar, or undefined when no calendar was asked for.
 * A label, a name or month names without an epoch year is a mistake: the epoch is what
 * places the world's years.
 */
export function calendarFrom(input: CalendarInput): GraphCalendar | undefined {
  const partial = partialCalendarFrom(input);
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
