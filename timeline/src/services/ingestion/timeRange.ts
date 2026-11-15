/**
 * The time range an ingestion request gives (`context.defaultTimeRange`).
 *
 * It is text entering for the first time, from a person or a program, so it
 * is read by the one rule every door applies (`readWorldTimestamp`,
 * docs/specs/world-calendars.md Req 16): in a world, the world's notation and
 * then an ISO day; without one, ISO 8601 and then year-first text ("1066",
 * "44 BCE"). The start is the first moment of what it names and the end the
 * last. Text it cannot read is refused with the reason, never read leniently
 * (`toInstant` would take "Feb 14 1870" in the server's zone) or dropped.
 */

import { type AxisTime, type WorldCalendarSet, compareAxisTime, readWorldTimestamp, unreadDateReason } from '@althistory/calendar';
import { ValidationError } from '@/utils/errors';

export interface ReadTimeRange {
  start: AxisTime;
  end: AxisTime;
}

/**
 * Read a range's two ends, or throw a {@link ValidationError} naming the end
 * that cannot be read (`context.defaultTimeRange.start`) and why, or saying
 * that the range ends before it starts.
 */
export function readTimeRange(range: { start: string; end: string }, calendar: WorldCalendarSet | null | undefined): ReadTimeRange {
  const read = (edge: 'start' | 'end'): AxisTime => {
    const text = String(range[edge]);
    const at = readWorldTimestamp(calendar ?? null, text, edge);
    if (!at) {
      const field = `context.defaultTimeRange.${edge}`;
      throw new ValidationError(`${field}: ${unreadDateReason(calendar ?? null, text)}`, field, text);
    }
    return at.time;
  };
  const start = read('start');
  const end = read('end');
  if (compareAxisTime(start, end) > 0) {
    throw new ValidationError(
      `context.defaultTimeRange ends before it starts ("${range.start}" to "${range.end}").`,
      'context.defaultTimeRange',
      range
    );
  }
  return { start, end };
}
