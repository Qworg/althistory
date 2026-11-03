/**
 * Server-side formatting of *historical* dates in text the server writes for
 * people to read: pressure descriptions, version-history summaries.
 *
 * It matches the web app's `formatHistoricalDate` (frontend
 * `src/utils/historicalTime.ts`): a short month, the day and the year, in UTC,
 * because the API stores a date as its UTC midnight. `Date#toDateString` used
 * the server's own time zone (so a server west of Greenwich wrote the day
 * before) and read like a log line ("Mon May 31 1847"). The locale is fixed so
 * the stored text does not depend on the machine that wrote it.
 */

const HISTORICAL_DATE = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

/** "May 31, 1847". An unparseable value yields "an unknown date". */
export function formatHistoricalDate(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'an unknown date';
  return HISTORICAL_DATE.format(date);
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
