/**
 * The time a request gives for an event or an arc, read for the graph it is
 * bound for (docs/specs/world-calendars.md, Req 14-18).
 *
 * Text is read by the package's one rule (`readWorldTimestamp`), as the CLI,
 * the MCP tools, ingestion and the app's forms read it:
 *
 * - ISO 8601: a date and time is that instant; a date, month or year alone
 *   names that UTC period, with its precision, and as an end (`edge: 'end'`)
 *   is its last moment. In a graph with world calendars, a Gregorian month or
 *   year is no period of the world's and is refused.
 * - In a graph with world calendars, a date in the world's notation ("Thaw
 *   4, 312 AR", "Thaw 312 AR") or given as fields ({ calendar, era, year,
 *   month, day, hour, minute, second }), its precision and calendar recorded.
 *   Text that is neither is refused, never read as a Gregorian date.
 * - In a graph without, other text is read as the API always read it.
 */

import {
  type WorldCalendarSet,
  calendarIn,
  parseIsoInstant,
  readWorldInput,
  readWorldTimestamp,
  storedCalendarSet,
  toInstant,
  unreadDateReason,
  withDatePrecision,
  worldPeriod,
} from '@althistory/calendar';
import type { Request } from 'express';
import { ValidationError } from '../utils/errors';

/**
 * The world calendars of the graph a request is scoped to, to describe its
 * dates with: none when it names no graph, has none, or cannot be read (a
 * description then falls back to Gregorian rather than failing the request).
 */
export async function requestCalendar(req: Request): Promise<WorldCalendarSet | undefined> {
  const graphId: unknown = req.graphId;
  if (typeof graphId !== 'string' || graphId.length === 0) return undefined;
  try {
    return storedCalendarSet((await req.container.graphRepository.findById(graphId))?.calendar) ?? undefined;
  } catch {
    return undefined;
  }
}

export interface RequestTime {
  date: Date;
  /** Set when the date named a month or a year rather than a day. */
  precision?: 'month' | 'year';
  /** The world calendar the date was written in (absent for ISO 8601). */
  calendar?: string;
}

function asTime(read: { iso: string; precision: 'day' | 'month' | 'year'; calendar?: string }): RequestTime {
  const date = new Date(read.iso);
  const calendar = read.calendar ? { calendar: read.calendar } : {};
  return read.precision === 'day' ? { date, ...calendar } : { date, precision: read.precision, ...calendar };
}

/**
 * A request's time for a graph. `calendarOf` is called only when the graph's
 * calendars matter (text that is not an ISO date or date and time, or
 * fields). Throws a ValidationError naming `field` when the value names no time.
 */
export async function readRequestTime(
  value: unknown,
  field: string,
  calendarOf: () => Promise<WorldCalendarSet | undefined>,
  edge: 'start' | 'end' = 'start'
): Promise<RequestTime> {
  if (value instanceof Date) return { date: value };
  if (typeof value === 'string') {
    const iso = parseIsoInstant(value.trim());
    // A date, or a date and time: the same instant in any graph.
    if (iso && iso.precision !== 'year' && iso.precision !== 'month') {
      const read = readWorldTimestamp(null, value, edge);
      if (read) return asTime(read);
      // An ISO date whose end is past the last moment a date can hold.
      throw new ValidationError(`${field}: "${value.trim()}" reaches beyond the range a date can hold`, field, value);
    }
    // A graph that cannot be read has no calendar to read a date with.
    const calendar = await calendarOf().catch(() => undefined);
    const read = readWorldTimestamp(calendar, value, edge);
    if (read) return asTime(read);
    if (calendar) throw new ValidationError(`${field}: ${unreadDateReason(calendar, value)}`, field, value);
    // No world: text that is not ISO 8601, read as the API always read it.
    return { date: toInstant(value) };
  }
  if (typeof value === 'object' && value !== null) {
    const calendar = await calendarOf().catch(() => undefined);
    if (!calendar) throw new ValidationError(`${field}: a date given as fields needs a graph with a world calendar`, field, value);
    const read = readWorldInput(calendar, value);
    if (!read.ok) throw new ValidationError(`${field}: ${read.error}`, field, value);
    let at = read.position;
    if (edge === 'end' && !read.timed) {
      const period = worldPeriod(calendarIn(calendar, read.calendar), read.fields, read.precision);
      if (period) at = period.end;
    }
    return asTime({ iso: new Date(at).toISOString(), precision: read.precision, calendar: read.calendar });
  }
  return { date: toInstant(value) };
}

/**
 * An event's metadata once a request gives it a new date: the old date's
 * precision (and calendar) goes and the new one's comes; the rest is the
 * request's metadata, or the event's when the request sends none. A request
 * whose metadata states a precision itself (the app sends ISO with the
 * precision its form read) keeps it.
 */
export function newDateMetadata(
  requested: Record<string, unknown> | undefined,
  existing: Record<string, unknown> | undefined,
  read: { precision: 'day' | 'month' | 'year'; calendar?: string }
): Record<string, unknown> {
  // The app sends ISO with the precision its form read; a day written in the
  // world's notation states its own (a day), and replaces any old one.
  if (requested && 'datePrecision' in requested && read.precision === 'day' && !read.calendar) return { ...requested };
  return withDatePrecision(requested ?? existing, read);
}
