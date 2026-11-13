/**
 * A date in an imported document (the API's import and the CLI's), read by
 * the rule every door applies (`readWorldTimestamp`, docs/specs/world-calendars.md
 * Req 16): the world's notation, then ISO 8601, and without a world a year
 * first. Without a world, other text a graph stored before is read as stored
 * text always is (`toInstant`), so an old export still imports.
 */

import { type WorldCalendarSet, readWorldTimestamp, toInstant } from '@althistory/calendar';

export interface ImportedTime {
  iso: string;
  precision: 'day' | 'month' | 'year';
  calendar?: string;
}

export function readImportedTime(
  text: string,
  calendar: WorldCalendarSet | undefined,
  edge: 'start' | 'end'
): ImportedTime | null {
  const read = readWorldTimestamp(calendar, text, edge);
  if (read || calendar) return read;
  const stored = toInstant(text);
  return Number.isFinite(stored.getTime()) ? { iso: stored.toISOString(), precision: 'day' } : null;
}
