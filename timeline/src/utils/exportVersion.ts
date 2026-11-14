/**
 * The version of an export document (docs/export-format.md, docs/specs/
 * deep-time.md Req 15).
 *
 * A document whose dates all lie within what a JavaScript `Date` holds is
 * written as "1.0", byte for byte as it always was, with the same checksum.
 * One with a date beyond it is written as "1.1": the same shape, with expanded
 * ISO years ("+300000-01-01T00:00:00.000Z") allowed. Both are read.
 */

import { inDateRange, toAxisTime } from '@althistory/calendar';

export type ExportVersion = '1.0' | '1.1';

/** Every version this build reads. */
export const READABLE_EXPORT_VERSIONS: readonly string[] = ['1.0', '1.1'];

/** Whether a stored or exported timestamp lies beyond what a `Date` holds. */
export function isDeepTimestamp(value: unknown): boolean {
  if (typeof value !== 'string' && !(value instanceof Date)) return false;
  const time = toAxisTime(value);
  return time !== null && !inDateRange(time);
}

/** The version a document with these events and arcs is written as. */
export function exportVersionOf(data: {
  events: ReadonlyArray<{ timestamp?: unknown }>;
  arcs: ReadonlyArray<{ start_time?: unknown; end_time?: unknown }>;
}): ExportVersion {
  for (const event of data.events) if (isDeepTimestamp(event.timestamp)) return '1.1';
  for (const arc of data.arcs) if (isDeepTimestamp(arc.start_time) || isDeepTimestamp(arc.end_time)) return '1.1';
  return '1.0';
}
