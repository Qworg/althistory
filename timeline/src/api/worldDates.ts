/**
 * The time a request gives for an event or an arc, read for the graph it is
 * bound for (docs/specs/world-calendars.md, Req 14, 16, 18).
 *
 * ISO 8601 (and any other text, as the API always read it) is a position on
 * the timeline. In a graph with world calendars, a date may also be written
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
        const timed = read.fields.hour !== 0 || read.fields.minute !== 0 || read.fields.second !== 0;
        if (edge === 'end' && !timed) {
          const period = worldPeriod(calendarIn(calendar, read.calendar), read.fields, read.precision);
          if (period) return withPrecision(new Date(period.end), read.precision);
        }
        return withPrecision(new Date(read.position), read.precision);
      }
      if (typeof value === 'object') throw new ValidationError(`${field}: ${read.error}`, field, value);
      // Not the world's notation: read as the API always read text, below.
      const legacy = toInstant(value);
      if (Number.isNaN(legacy.getTime())) throw new ValidationError(`${field}: ${read.error}`, field, value);
      return { date: legacy };
    }
    if (typeof value === 'object') throw new ValidationError(`${field}: a date given as fields needs a graph with a world calendar`, field, value);
  }
  return { date: toInstant(value) };
}

function withPrecision(date: Date, precision: 'day' | 'month' | 'year'): RequestTime {
  return precision === 'day' ? { date } : { date, precision };
}
