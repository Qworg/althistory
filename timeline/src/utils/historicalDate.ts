/**
 * Server-side formatting of *historical* dates in text the server writes for
 * people to read: pressure descriptions, version-history summaries.
 *
 * It is the web app's `formatHistoricalDate` (`@althistory/calendar`): a
 * short month, the day and the year, in UTC, because the API stores a date as
 * its UTC midnight, with the era before 1 CE ("Mar 15, 44 BC"). The locale is
 * fixed so the stored text does not depend on the machine that wrote it.
 */

import {
  type DatePrecision,
  type WorldCalendarSet,
  formatDateEntry,
  formatHistoricalDate as formatInLocale,
  readDateEntry,
  toAxisTime,
  toInstant,
} from '@althistory/calendar';

/** "May 31, 1847", or in a world "Thaw 4, 312 AR". An unparseable value yields "an unknown date". */
export function formatHistoricalDate(value: Date | string | number, calendar?: WorldCalendarSet): string {
  const date = toInstant(value);
  if (Number.isNaN(date.getTime())) return 'an unknown date';
  return formatInLocale(date, 'en-US', calendar ?? null);
}

/**
 * "from May 31, 1847 to Jun 3, 1847", or "on May 31, 1847" when both ends fall
 * on the same day.
 */
export function formatHistoricalSpan(start: Date | string | number, end: Date | string | number, calendar?: WorldCalendarSet): string {
  const from = formatHistoricalDate(start, calendar);
  const to = formatHistoricalDate(end, calendar);
  return from === to ? `on ${from}` : `from ${from} to ${to}`;
}

/**
 * A date in a graph without a world as it was typed, at the precision it is
 * known to, for text a person or a model reads and may give back (an export,
 * a validator's message): "1871", "1871-03", "44-03-15 BCE",
 * "1843-11-20 14:30" (UTC). As an end, a day is the whole day. When that text
 * does not name the instant exactly (a time with seconds, a year whose
 * recorded precision is wrong), the instant follows in brackets.
 */
export function formatTypedDate(value: Date, precision: DatePrecision = 'day', edge: 'start' | 'end' = 'start'): string {
  const time = toAxisTime(value);
  const text = formatDateEntry(value, precision, null, edge);
  if (time === null || text === '') return 'an unknown date';
  const back = readDateEntry(text, null, edge);
  return back.ok && back.time === time ? text : `${text} (${value.toISOString()})`;
}
