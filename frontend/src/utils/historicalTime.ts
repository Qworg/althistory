/**
 * Formatting for *historical* time: when an event happened, when an arc
 * starts and ends, the range of a pressure, a point of divergence.
 *
 * These are dates in a history, not moments on the viewer's clock, and the API
 * stores them as UTC instants (a date is its UTC midnight). Formatting them in
 * the browser's time zone moved them: west of Greenwich, 1843-11-20T00:00Z
 * rendered as the 19th, and before standardised time zones the browser applies
 * local mean time, so it rendered as "11/19/1843, 4:07:02 PM". They are
 * formatted in UTC, and a midnight is shown as a date alone.
 *
 * Wall-clock times -- when a key was created, an export finished, a version was
 * committed -- are not historical and keep the viewer's local time.
 */

type DateInput = Date | string | number

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value)
}

function isUtcMidnight(date: Date): boolean {
  return (
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  )
}

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
}

/** "Nov 20, 1843" (in the viewer's locale), never shifted by their time zone. */
export function formatHistoricalDate(value: DateInput, locale?: string): string {
  const date = toDate(value)
  if (Number.isNaN(date.getTime())) return 'Invalid date'
  return date.toLocaleDateString(locale, DATE_OPTIONS)
}

/**
 * The date alone for a timestamp at midnight UTC (how dates are stored), and
 * the date with the UTC time otherwise: "Nov 20, 1843" or
 * "Nov 20, 1843, 14:30 UTC".
 */
export function formatHistoricalTimestamp(value: DateInput, locale?: string): string {
  const date = toDate(value)
  if (Number.isNaN(date.getTime())) return 'Invalid date'
  if (isUtcMidnight(date)) return formatHistoricalDate(date, locale)
  const time = date.toLocaleTimeString(locale, {
    timeZone: 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return `${formatHistoricalDate(date, locale)}, ${time} UTC`
}

/**
 * How much of a date its source stated. A timestamp needs a day, so "March
 * 1871" is stored as 1871-03-01 with `datePrecision: 'month'` in the event's
 * metadata; showing it as "Mar 1, 1871" would invent the day.
 */
export type DatePrecision = 'day' | 'month' | 'year'

export function datePrecisionOf(metadata: Record<string, unknown> | undefined): DatePrecision {
  const value = metadata?.datePrecision
  return value === 'month' || value === 'year' ? value : 'day'
}

/** "Nov 20, 1843", "Mar 1871" or "1871", by how much of the date is known. */
export function formatHistoricalDateAt(value: DateInput, precision: DatePrecision, locale?: string): string {
  if (precision === 'day') return formatHistoricalTimestamp(value, locale)
  const date = toDate(value)
  if (Number.isNaN(date.getTime())) return 'Invalid date'
  return date.toLocaleDateString(
    locale,
    precision === 'month' ? { timeZone: 'UTC', year: 'numeric', month: 'short' } : { timeZone: 'UTC', year: 'numeric' }
  )
}

/** An event's date, at the precision its source gave. */
export function formatEventDate(event: { timestamp: string; metadata?: Record<string, unknown> }, locale?: string): string {
  return formatHistoricalDateAt(event.timestamp, datePrecisionOf(event.metadata), locale)
}

/** "Nov 20, 1843 – Jan 9, 1868". */
export function formatHistoricalRange(start: DateInput, end: DateInput, locale?: string): string {
  return `${formatHistoricalDate(start, locale)} – ${formatHistoricalDate(end, locale)}`
}
