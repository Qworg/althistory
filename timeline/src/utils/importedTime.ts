/**
 * A date in an imported document (the API's import and the CLI's), read by
 * the rule every door applies (`readWorldTimestamp`, docs/specs/world-calendars.md
 * Req 16): the world's notation, then ISO 8601, and without a world a year
 * first. Without a world, other text a graph stored before (prose) is read as
 * stored text always is (`toInstant`), so an old export still imports; text
 * that starts with a digit and is not such a date is refused.
 */

import { type WorldCalendarSet, readWorldTimestamp, toInstant, withDatePrecision } from '@althistory/calendar';

export interface ImportedTime {
  iso: string;
  precision: 'day' | 'month' | 'year';
  calendar?: string;
}

export function readImportedTime(
  text: unknown,
  calendar: WorldCalendarSet | undefined,
  edge: 'start' | 'end'
): ImportedTime | null {
  if (typeof text !== 'string') return null;
  const read = readWorldTimestamp(calendar, text, edge);
  if (read || calendar) return read;
  // Text that starts as a year does and is no date ("0") is refused, as the
  // API refuses it, never read in the server's zone.
  if (/^[+-]?\d/.test(text.trim())) return null;
  const stored = toInstant(text);
  return Number.isFinite(stored.getTime()) ? { iso: stored.toISOString(), precision: 'day' } : null;
}

/**
 * An imported event's metadata once its date is read, by the API's rule
 * (`newDateMetadata`): a precision the metadata states is kept when the text
 * was a day in ISO 8601 (an export's stored instant); a month, a year or a
 * date in the world's notation states its own. Metadata that is not an
 * object counts as none.
 */
export function importedMetadata(metadata: unknown, read: ImportedTime): Record<string, unknown> {
  const base =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? (metadata as Record<string, unknown>) : {};
  if (read.precision === 'day' && !read.calendar && 'datePrecision' in base) return base;
  return withDatePrecision(base, read);
}
