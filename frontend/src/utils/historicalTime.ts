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
 *
 * An invented world's calendar (see `utils/worldCalendar.ts`) relabels the
 * year and nothing else: "Nov 20, 1843" becomes "Nov 20, 844 AR", in the
 * locale's own order. Every formatter takes the calendar as its last argument;
 * left out, it is the active graph's (`getActiveCalendar()`), and `null` means
 * none. Without a calendar the output is exactly what it always was.
 */

import type { GraphCalendar } from '@/types'
import { getActiveCalendar } from '@/stores/worldCalendarStore'
import { formatWorldYear } from '@/utils/worldCalendar'

type DateInput = Date | string | number

/** The calendar argument: `undefined` is the active graph's, `null` none. */
type CalendarArg = GraphCalendar | null | undefined

function resolveCalendar(calendar: CalendarArg): GraphCalendar | null {
  return calendar === undefined ? getActiveCalendar() : calendar
}

/**
 * `date` formatted with `options`, its year replaced by the world year. The
 * locale still decides the order and the month's name (`formatToParts`), but on
 * the Gregorian calendar: the world keeps the stored months and days, so a
 * locale whose default calendar is another (th-TH's Buddhist one) must not
 * renumber them.
 */
function formatInWorld(
  date: Date,
  locale: string | undefined,
  options: Intl.DateTimeFormatOptions,
  calendar: GraphCalendar
): string {
  const parts = new Intl.DateTimeFormat(locale, { ...options, calendar: 'gregory' }).formatToParts(date)
  const year = formatWorldYear(date.getUTCFullYear(), calendar)
  return parts
    .filter((part) => part.type !== 'era')
    .map((part) => (part.type === 'year' ? year : part.value))
    .join('')
    .trim()
}

/**
 * A stored year (a UTC year, as the timestamps hold it) in the world's
 * calendar, or null when there is no calendar, so a caller keeps its own
 * spelling of a plain year: `worldYearLabel(year) ?? String(year)`.
 */
export function worldYearLabel(storedYear: number, calendar?: CalendarArg): string | null {
  const active = resolveCalendar(calendar)
  return active ? formatWorldYear(storedYear, active) : null
}

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
export function formatHistoricalDate(value: DateInput, locale?: string, calendar?: CalendarArg): string {
  const date = toDate(value)
  if (Number.isNaN(date.getTime())) return 'Invalid date'
  const world = resolveCalendar(calendar)
  if (world) return formatInWorld(date, locale, DATE_OPTIONS, world)
  return date.toLocaleDateString(locale, DATE_OPTIONS)
}

/**
 * The date alone for a timestamp at midnight UTC (how dates are stored), and
 * the date with the UTC time otherwise: "Nov 20, 1843" or
 * "Nov 20, 1843, 14:30 UTC".
 */
export function formatHistoricalTimestamp(value: DateInput, locale?: string, calendar?: CalendarArg): string {
  const date = toDate(value)
  if (Number.isNaN(date.getTime())) return 'Invalid date'
  const world = resolveCalendar(calendar)
  if (isUtcMidnight(date)) return formatHistoricalDate(date, locale, world)
  const time = date.toLocaleTimeString(locale, {
    timeZone: 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return `${formatHistoricalDate(date, locale, world)}, ${time} UTC`
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
export function formatHistoricalDateAt(
  value: DateInput,
  precision: DatePrecision,
  locale?: string,
  calendar?: CalendarArg
): string {
  const world = resolveCalendar(calendar)
  if (precision === 'day') return formatHistoricalTimestamp(value, locale, world)
  const date = toDate(value)
  if (Number.isNaN(date.getTime())) return 'Invalid date'
  if (world && precision === 'year') return formatWorldYear(date.getUTCFullYear(), world)
  const options: Intl.DateTimeFormatOptions =
    precision === 'month' ? { timeZone: 'UTC', year: 'numeric', month: 'short' } : { timeZone: 'UTC', year: 'numeric' }
  if (world) return formatInWorld(date, locale, options, world)
  return date.toLocaleDateString(locale, options)
}

/** An event's date, at the precision its source gave. */
export function formatEventDate(
  event: { timestamp: string; metadata?: Record<string, unknown> },
  locale?: string,
  calendar?: CalendarArg
): string {
  return formatHistoricalDateAt(event.timestamp, datePrecisionOf(event.metadata), locale, calendar)
}

/** "Nov 20, 1843 – Jan 9, 1868". */
export function formatHistoricalRange(start: DateInput, end: DateInput, locale?: string, calendar?: CalendarArg): string {
  const world = resolveCalendar(calendar)
  return `${formatHistoricalDate(start, locale, world)} – ${formatHistoricalDate(end, locale, world)}`
}
