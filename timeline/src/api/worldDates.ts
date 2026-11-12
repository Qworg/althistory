/**
 * The time a request gives for an event or an arc, read for the graph it is
 * bound for (docs/specs/world-calendars.md, Req 14, 16, 18).
 *
 * ISO 8601 is a position on the timeline. In a graph without world
 * calendars, other text is read as the API always read it; in a graph with
 * them, text must be ISO 8601 or the world's notation. In a graph with world calendars, a date may also be written
 * in the world's notation ("Thaw 4, 312 AR", "Thaw 312 AR") or given as
 * fields ({ calendar, era, year, month, day, hour, minute, second }); a date
 * at month or year precision names its period, whose start (or end, for the
 * end of an arc) it is stored at, with the precision recorded.
 */

import { type WorldCalendarSet, calendarIn, parseIsoInstant, readWorldInput, toInstant, worldPeriod } from '@althistory/calendar';
import { ValidationError } from '../utils/errors';

export interface RequestTime {
  date: Date;
  /** Set when a world date named a month or a year rather than a day. */
  precision?: 'month' | 'year';
}

/**
 * A request's time for a graph. `calendarOf` is called only when the value
 * is not ISO 8601 (a world date needs the graph's calendars). Throws a
 * ValidationError naming `field` when the value names no time.
 */
export async function readRequestTime(
  value: unknown,
  field: string,
  calendarOf: () => Promise<WorldCalendarSet | undefined>,
  edge: 'start' | 'end' = 'start'
): Promise<RequestTime> {
  if (value instanceof Date) return { date: value };
  if (typeof value === 'string' && parseIsoInstant(value.trim())) return { date: toInstant(value) };
  if (typeof value === 'string' || (typeof value === 'object' && value !== null)) {
    // A graph that cannot be read has no calendar to read a date with: the
    // value is then read as text always was, and refused as such.
    const calendar = await calendarOf().catch(() => undefined);
    if (calendar) {
      const read = readWorldInput(calendar, value);
      if (read.ok) {
        if (edge === 'end' && !read.timed) {
          const period = worldPeriod(calendarIn(calendar, read.calendar), read.fields, read.precision);
          if (period) return withPrecision(new Date(period.end), read.precision);
        }
        return withPrecision(new Date(read.position), read.precision);
      }
      // Neither ISO 8601 nor the world's notation. Read leniently, "312" or
      // "Year 312" would land in the Gregorian year 312 of the server's time
      // zone, a date the world never named: refused, with what it could be.
      throw new ValidationError(`${field}: ${read.error}`, field, value);
    }
    if (typeof value === 'object') throw new ValidationError(`${field}: a date given as fields needs a graph with a world calendar`, field, value);
  }
  return { date: toInstant(value) };
}

function withPrecision(date: Date, precision: 'day' | 'month' | 'year'): RequestTime {
  return precision === 'day' ? { date } : { date, precision };
}
