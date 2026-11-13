/**
 * Historical moments in and out of the databases (docs/specs/deep-time.md,
 * Req 13).
 *
 * Stored timestamps are `datetime` values in Neo4j (range ±999,999,999 years)
 * and ISO text in the local store; both hold any moment the axis does. What a
 * driver or `new Date(text)` cannot do is carry one beyond a Date's range
 * through a double or a Date, so:
 *
 * - a query's `datetime($p)` whose value lies beyond a Date's range is sent as
 *   `datetime({epochMillis: $p})` with the milliseconds as a 64-bit integer
 *   ({@link deepTemporalQuery}); every other query is sent exactly as it was
 *   written, so real history is untouched;
 * - a stored value is read by the fields the driver gives
 *   ({@link readInstantValue}), by arithmetic, to the same `Date` (or
 *   `AxisDate`) every reader makes.
 */

import { type AxisTime, axisTimeOfCivil, inDateRange, instantOfAxisTime, toAxisTime, toInstant } from '@althistory/calendar';
import { int } from 'neo4j-driver';

const DATETIME_PARAM = /datetime\(\$(\w+)\)/g;

/** A query and its bound parameters. */
export interface TemporalQuery {
  query: string;
  parameters: Record<string, unknown>;
}

/**
 * The moment a parameter names, when it is ISO text beyond a Date's range:
 * what only `epochMillis` can carry to Neo4j.
 */
function deepMoment(value: unknown): AxisTime | null {
  if (typeof value !== 'string' || !/^[+-]\d{6,9}-/.test(value)) return null;
  const time = toAxisTime(value);
  return time !== null && !inDateRange(time) ? time : null;
}

/**
 * Rewrites `datetime($name)` to `datetime({epochMillis: $name})` for every
 * parameter that holds a moment beyond a Date's range, which is then sent as a
 * 64-bit integer of milliseconds. A query with none is returned as it came.
 */
export function deepTemporalQuery(query: string, parameters: Record<string, unknown>): TemporalQuery {
  let rewritten: Record<string, unknown> | null = null;
  const text = query.replace(DATETIME_PARAM, (whole, name: string) => {
    const moment = deepMoment(parameters[name]);
    if (moment === null) return whole;
    rewritten ??= { ...parameters };
    rewritten[name] = int(moment.toString());
    return `datetime({epochMillis: $${name}})`;
  });
  return rewritten ? { query: text, parameters: rewritten } : { query, parameters };
}

/** `session.run` (the driver's or the local store's) with {@link deepTemporalQuery} applied. */
export function runTemporal<S extends { run(query: string, parameters?: Record<string, unknown>): unknown }>(
  session: S,
  query: string,
  parameters: Record<string, unknown> = {}
): ReturnType<S['run']> {
  const sent = deepTemporalQuery(query, parameters);
  return session.run(sent.query, sent.parameters) as ReturnType<S['run']>;
}

/** A number a driver may hold as an Integer or a plain number. */
function fieldNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(String(value));
}

/**
 * A temporal column as the instant it holds. The driver gives a `DateTime`
 * (fields, as numbers or Integers), the local store the ISO text it was
 * handed, and a repository may hold a Date; all read alike, exactly, beyond a
 * Date's range included.
 */
export function readInstantValue(value: unknown, field: string): Date {
  if (value === null || value === undefined) {
    throw new TypeError(`Record property "${field}" is missing`);
  }
  if (value instanceof Date) return value;
  if (typeof value === 'object' && 'year' in value && 'month' in value && 'day' in value) {
    const parts = value as Record<string, unknown>;
    const nanosecond = parts.nanosecond === undefined ? 0 : fieldNumber(parts.nanosecond);
    const offset = parts.timeZoneOffsetSeconds === undefined ? 0 : fieldNumber(parts.timeZoneOffsetSeconds);
    const msOfDay =
      ((fieldNumber(parts.hour ?? 0) * 60 + fieldNumber(parts.minute ?? 0)) * 60 + fieldNumber(parts.second ?? 0)) * 1000 +
      Math.floor(nanosecond / 1_000_000);
    const time = axisTimeOfCivil(fieldNumber(parts.year), fieldNumber(parts.month), fieldNumber(parts.day), msOfDay - offset * 1000);
    return instantOfAxisTime(time) ?? new Date(NaN);
  }
  return toInstant(String(value));
}
