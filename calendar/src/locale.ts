/**
 * Formatting *historical* time for the app: when an event happened, when an
 * arc starts and ends, the range of a pressure, a point of divergence.
 *
 * These are dates in a history, not moments on the viewer's clock, and they
 * are stored as UTC instants (a date is its UTC midnight). Formatting them in
 * the host's time zone moved them: west of Greenwich, 1843-11-20T00:00Z
 * rendered as the 19th, and before standardised time zones the host applies
 * local mean time, so it rendered as "11/19/1843, 4:07:02 PM". Without a
 * world calendar they are formatted in UTC in the viewer's locale, and a
 * midnight is shown as a date alone.
 *
 * In a graph with world calendars (docs/specs/world-calendars.md) a date is
 * written in the world's own notation, by its calendar set's primary calendar
 * ("Greywater 4, 312 AR"): invented months have no place in a locale's date
 * order. Every formatter takes the set explicitly; `null` means none.
 */

import { toInstant } from './instant'
import type { DatePrecision } from './describe'
import type { WorldCalendarSet } from './world/definition'
import { calendarIn, dateAt } from './world/engine'
import { formatWorldFields, formatWorldPosition } from './world/notation'

export type DateInput = Date | string | number

/** A timestamp as a Date; text is read as ISO 8601 in UTC (see instant.ts), never in the host's zone. */
export function toDate(value: DateInput): Date {
  return toInstant(value)
}

export function isUtcMidnight(date: Date): boolean {
  return (
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  )
}

/**
 * Always the Gregorian calendar, whatever the locale's default: the dates are
 * stored on it, the axis is drawn on it, and a month or a year (below) can
 * only be named on it. On th-TH's Buddhist calendar 1843-11-20 read "2386"
 * beside a month-precision "1843", and before 1582 ICU's Buddhist calendar
 * is Julian, so 1300-03-03 read as 24 February. The locale still names the
 * months and writes the digits.
 */
const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  calendar: 'gregory',
}

/**
 * The options for a date without a world calendar. A year before 1 CE gets
 * its era: a formatter writes the year of its era, so 44 BCE is "44" and,
 * without "BC", reads as 44 CE.
 */
function plainOptions(date: Date, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions {
  return date.getUTCFullYear() <= 0 ? { ...options, era: 'short' } : options
}

/**
 * "Nov 20, 1843" (in the locale), never shifted by the host's time zone; "Mar
 * 15, 44 BC" before 1 CE. In a world, the date in its notation ("Greywater 4,
 * 312 AR"), without its time.
 */
export function formatHistoricalDate(value: DateInput, locale: string | undefined, calendar: WorldCalendarSet | null): string {
  const date = toDate(value)
  if (Number.isNaN(date.getTime())) return 'Invalid date'
  if (calendar) {
    const primary = calendarIn(calendar)
    return formatWorldFields(primary, dateAt(primary, date.getTime()), 'day')
  }
  return date.toLocaleDateString(locale, plainOptions(date, DATE_OPTIONS))
}

/**
 * The date alone for a timestamp at midnight UTC (how dates are stored), and
 * the date with the UTC time otherwise: "Nov 20, 1843" or
 * "Nov 20, 1843, 14:30 UTC".
 */
export function formatHistoricalTimestamp(value: DateInput, locale: string | undefined, calendar: WorldCalendarSet | null): string {
  const date = toDate(value)
  if (Number.isNaN(date.getTime())) return 'Invalid date'
  // A world's time is its own hours: "Greywater 4, 312 AR, 13:50".
  if (calendar) return formatWorldPosition(calendarIn(calendar), date.getTime())
  if (isUtcMidnight(date)) return formatHistoricalDate(date, locale, calendar)
  const time = date.toLocaleTimeString(locale, {
    timeZone: 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return `${formatHistoricalDate(date, locale, calendar)}, ${time} UTC`
}

/**
 * How much of a date its source stated. A timestamp needs a day, so "March
 * 1871" is stored as 1871-03-01 with `datePrecision: 'month'` in the event's
 * metadata; showing it as "Mar 1, 1871" would invent the day.
 */
export function datePrecisionOf(metadata: Record<string, unknown> | undefined): DatePrecision {
  const value = metadata?.datePrecision
  return value === 'month' || value === 'year' ? value : 'day'
}

/** "Nov 20, 1843", "Mar 1871" or "1871", by how much of the date is known. */
export function formatHistoricalDateAt(
  value: DateInput,
  precision: DatePrecision,
  locale: string | undefined,
  calendar: WorldCalendarSet | null
): string {
  if (precision === 'day') return formatHistoricalTimestamp(value, locale, calendar)
  const date = toDate(value)
  if (Number.isNaN(date.getTime())) return 'Invalid date'
  if (calendar) {
    const primary = calendarIn(calendar)
    return formatWorldFields(primary, dateAt(primary, date.getTime()), precision)
  }
  // On the Gregorian calendar whatever the locale's own: a day is a day in any
  // calendar, but a Gregorian month or year is not one month or year of
  // another (1969 is parts of 1347 and 1348 in fa-IR's Solar Hijri), so the
  // locale's calendar would name the period that holds its first day only.
  const options: Intl.DateTimeFormatOptions =
    precision === 'month'
      ? { timeZone: 'UTC', year: 'numeric', month: 'short', calendar: 'gregory' }
      : { timeZone: 'UTC', year: 'numeric', calendar: 'gregory' }
  return date.toLocaleDateString(locale, plainOptions(date, options))
}

/** An event's date, at the precision its source gave. */
export function formatEventDate(
  event: { timestamp: string; metadata?: Record<string, unknown> },
  locale: string | undefined,
  calendar: WorldCalendarSet | null
): string {
  return formatHistoricalDateAt(event.timestamp, datePrecisionOf(event.metadata), locale, calendar)
}

/** "Nov 20, 1843 – Jan 9, 1868". */
export function formatHistoricalRange(start: DateInput, end: DateInput, locale: string | undefined, calendar: WorldCalendarSet | null): string {
  return `${formatHistoricalDate(start, locale, calendar)} – ${formatHistoricalDate(end, locale, calendar)}`
}
