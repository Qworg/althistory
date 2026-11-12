import { type WorldCalendarSet, dateCalendarOf, datePrecisionOf, formatDateEntry, parseIsoInstant } from '@althistory/calendar';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isIso = (value: unknown): value is string => typeof value === 'string' && parseIsoInstant(value) !== null;

/**
 * A tool's result with each date also in the world's notation (Req 18): an
 * event's `timestamp` gains `worldDate` (at the precision the event records),
 * an arc's `startTime`/`endTime` gain `worldStart`/`worldEnd` (its end as the
 * day it ends). The timestamps stay as they are: they are the dates' places
 * on the graph's timeline, which the tools also take.
 */
export function withWorldDates(output: unknown, calendar: WorldCalendarSet): unknown {
  if (Array.isArray(output)) return output.map((item) => withWorldDates(item, calendar));
  if (!isRecord(output)) return output;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(output)) {
    // The calendar itself (a generated world's) is data, not dates.
    result[key] = key === 'calendar' || key === 'metadata' ? value : withWorldDates(value, calendar);
  }
  const metadata = isRecord(output.metadata) ? output.metadata : undefined;
  if (isIso(output.timestamp)) {
    result.worldDate = formatDateEntry(output.timestamp, datePrecisionOf(metadata), calendar, 'start', dateCalendarOf(metadata));
  }
  if (isIso(output.startTime)) result.worldStart = formatDateEntry(output.startTime, 'day', calendar, 'start');
  if (isIso(output.endTime)) result.worldEnd = formatDateEntry(output.endTime, 'day', calendar, 'end');
  return result;
}
