import { type WorldCalendarSet, dateCalendarOf, datePrecisionOf, formatDateEntry, parseIsoInstant, toAxisTime } from '@althistory/calendar';

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

/**
 * A result with each event's and arc's moment also as milliseconds on the
 * axis, a decimal string (`timestampMs`, `startTimeMs`, `endTimeMs`): exact
 * at any distance from 1970, where a JSON number is not past ±2^53, and JSON
 * has no bigint (docs/specs/deep-time.md, Req 14). An event is an object with
 * a `timestamp` and a `description`, an arc one with a `startTime` and an
 * `endTime`; the dates beside them stay as they are.
 */
export function withAxisTimes(output: unknown): unknown {
  if (Array.isArray(output)) return output.map((item) => withAxisTimes(item));
  if (!isRecord(output)) return output;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(output)) {
    result[key] = key === 'calendar' || key === 'metadata' ? value : withAxisTimes(value);
  }
  const at = (value: unknown) => (typeof value === 'string' && parseIsoInstant(value) ? toAxisTime(value) : null);
  const moment = at(output.timestamp);
  if (moment !== null && typeof output.description === 'string') result.timestampMs = String(moment);
  const start = at(output.startTime);
  const end = at(output.endTime);
  if (start !== null && end !== null) {
    result.startTimeMs = String(start);
    result.endTimeMs = String(end);
  }
  return result;
}
