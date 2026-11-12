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
  toInstant,
  unreadDateReason,
  withDatePrecision,
  worldPeriod,
} from '@althistory/calendar';
import { ValidationError } from '../utils/errors';

export interface RequestTime {
  date: Date;
  /** Set when the date named a month or a year rather than a day. */
  precision?: 'month' | 'year';
  /** The world calendar a month or year was given in. */
  calendar?: string;
}

function asTime(read: { iso: string; precision: 'day' | 'month' | 'year'; calendar?: string }): RequestTime {
  const date = new Date(read.iso);
  if (read.precision === 'day') return { date };
  return read.calendar ? { date, precision: read.precision, calendar: read.calendar } : { date, precision: read.precision };
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
  if (requested && 'datePrecision' in requested && read.precision === 'day') return { ...requested };
  return withDatePrecision(requested ?? existing, read);
}
