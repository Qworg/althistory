/**
 * Server-side formatting of *historical* dates in text the server writes for
 * people to read: pressure descriptions, version-history summaries.
 *
 * It is the web app's `formatHistoricalDate` (`@althistory/calendar`): a
 * short month, the day and the year, in UTC, because the API stores a date as
 * its UTC midnight, with the era before 1 CE ("Mar 15, 44 BC"). The locale is
 * fixed so the stored text does not depend on the machine that wrote it.
 */

import { formatHistoricalDate as formatInLocale, toInstant } from '@althistory/calendar';

/** "May 31, 1847". An unparseable value yields "an unknown date". */
export function formatHistoricalDate(value: Date | string | number): string {
  const date = toInstant(value);
  if (Number.isNaN(date.getTime())) return 'an unknown date';
  return formatInLocale(date, 'en-US', null);
}

/**
 * "from May 31, 1847 to Jun 3, 1847", or "on May 31, 1847" when both ends fall
 * on the same day.
 */
export function formatHistoricalSpan(start: Date | string | number, end: Date | string | number): string {
  const from = formatHistoricalDate(start);
  const to = formatHistoricalDate(end);
  return from === to ? `on ${from}` : `from ${from} to ${to}`;
}
