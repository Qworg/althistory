/**
 * Reading a world calendar from command-line flags or tool arguments.
 *
 * The flags are `--epoch-year`, `--era-label` and `--calendar-name`; the MCP
 * tools take the same three as `epochYear`, `eraLabel` and `calendarName`.
 */

import { GraphCalendar, normalizeCalendar } from '@/utils/worldCalendar';
import { ValidationErrorCLI } from './exitCodes';

export interface CalendarInput {
  epochYear?: unknown;
  eraLabel?: unknown;
  calendarName?: unknown;
}

/** An integer year from a flag ("1000") or a tool argument (1000). */
function readYear(value: unknown): number {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!/^-?\d+$/.test(text)) {
    throw new ValidationErrorCLI(`Invalid epoch year "${String(value)}": expected a whole year such as 1000`);
  }
  return Number(text);
}

function readText(value: unknown, what: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new ValidationErrorCLI(`${what} must be text`);
  }
  return value;
}

/**
 * The parts of a calendar that were given, unchecked: what `generate timeline`
 * takes, since it fills in the epoch year itself. Undefined when none was given.
 */
export function partialCalendarFrom(
  input: CalendarInput
): { epochYear?: number; eraLabel?: string; name?: string } | undefined {
  const epochYear = input.epochYear === undefined || input.epochYear === null ? undefined : readYear(input.epochYear);
  const eraLabel = readText(input.eraLabel, 'The era label');
  const name = readText(input.calendarName, 'The calendar name');
  if (epochYear === undefined && eraLabel === undefined && name === undefined) return undefined;
  return {
    ...(epochYear !== undefined ? { epochYear } : {}),
    ...(eraLabel !== undefined ? { eraLabel } : {}),
    ...(name !== undefined ? { name } : {}),
  };
}

/**
 * A complete, checked calendar, or undefined when no calendar was asked for.
 * A label or a name without an epoch year is a mistake: the epoch is what
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
