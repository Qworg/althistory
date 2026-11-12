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
 * year, and the month when it names them: "Nov 20, 1843" becomes
 * "Nov 20, 844 AR" (or "Frostfall 20, 844 AR"), in the locale's own order. Every formatter takes the calendar as its last argument;
 * left out, it is the active graph's (`getActiveCalendar()`), and `null` means
 * none. Without a calendar the output is exactly what it always was.
 */

import type { GraphCalendar } from '@/types'
import { getActiveCalendar } from '@/stores/worldCalendarStore'
import { formatWorldYear, worldMonthName } from '@/utils/worldCalendar'

type DateInput = Date | string | number

/** The calendar argument: `undefined` is the active graph's, `null` none. */
type CalendarArg = GraphCalendar | null | undefined

function resolveCalendar(calendar: CalendarArg): GraphCalendar | null {
  return calendar === undefined ? getActiveCalendar() : calendar
}

/** Numbers in the digits a date formatter uses (Arabic-Indic for ar-EG, Persian for fa-IR), never grouped. */
function localeDigits(locale: string | undefined, numberingSystem: string): (value: number) => string {
  const format = new Intl.NumberFormat(locale, { numberingSystem, useGrouping: false })
  return (value) => format.format(value)
}

/** The world year of `date`, in the digits `formatter` writes. */
function worldYearIn(date: Date, formatter: Intl.DateTimeFormat, locale: string | undefined, calendar: GraphCalendar): string {
  return formatWorldYear(date.getUTCFullYear(), calendar, localeDigits(locale, formatter.resolvedOptions().numberingSystem))
}

/**
 * `date` formatted with `options`, its year replaced by the world year.
 *
 * The locale still decides the month's name, the digits and, where it can,
 * the order (`formatToParts`), on the Gregorian calendar: the world keeps the
 * stored months (renamed, if it names them; see `withWorldMonth`) and days, so a locale whose default calendar is another
 * (th-TH's Buddhist one) must not renumber them.
 *
 * The year is a phrase ("312 AR", "1500 before AR"), not a number, so the
 * locale's marks for a year number do not fit it. The literal right after
 * the year is dropped: the 年/년 of ja, zh and ko, the " г." of ru and bg,
 * hu's ". " and the "-" that joins lt's numeric fields. Then:
 * - a locale that writes the year first reads "312 AR 3月4日", "312 AR márc. 4."
 *   (with a comma where two numbers would meet: "Year 312, 3月4日");
 * - one that writes it last keeps its own separator ("Mar 4, 312 AR",
 *   "4 мар. 312 AR"), or after a numeric date drops the date's trailing
 *   separator and sets the year off with a comma ("4/03, 312 AR");
 * - one that puts it between other fields (none of the common ones) gets the
 *   date without it, then the year: "…, 312 AR".
 */
function formatInWorld(
  date: Date,
  locale: string | undefined,
  options: Intl.DateTimeFormatOptions,
  calendar: GraphCalendar
): string {
  const formatter = new Intl.DateTimeFormat(locale, { ...options, calendar: 'gregory' })
  const year = worldYearIn(date, formatter, locale, calendar)
  const parts = withWorldMonth(
    formatter.formatToParts(date).filter((part) => part.type !== 'era'),
    worldMonthName(date.getUTCMonth(), calendar)
  )
  const at = parts.findIndex((part) => part.type === 'year')
  const text = (list: Intl.DateTimeFormatPart[]) => list.map((part) => part.value).join('')
  if (at < 0) return text(parts).trim()

  const before = parts.slice(0, at)
  const after = parts.slice(at + 1)
  if (after[0]?.type === 'literal') after.shift()

  if (before.length === 0) {
    const rest = text(after).trim()
    if (!rest) return year
    // "Year 312 3月4日" would run two numbers together.
    return /\p{Nd}$/u.test(year) && /^\p{Nd}/u.test(rest) ? `${year}, ${rest}` : `${year} ${rest}`
  }
  if (after.length === 0) {
    // A numeric date's separator before the year ("4/03/", "03.") would hang
    // off a world year ("4/03/ 312 AR"), so it goes; a comma keeps its space
    // ("ಮಾರ್ಚ್ 4,312" read as one number); and two numbers that would meet
    // are parted by a comma ("4/03, 312 AR"). "мар." keeps its full stop: only
    // a separator after a digit is dropped.
    const head = text(before).replace(/(\p{Nd})[/.-]\s*$/u, '$1').trimEnd()
    if (/[,،]$/.test(head)) return `${head} ${year}`
    return /\p{Nd}$/u.test(head) && /^\p{Nd}/u.test(year) ? `${head}, ${year}` : `${head} ${year}`
  }
  if (before[before.length - 1]?.type === 'literal') before.pop()
  return `${text(before).trim()} ${text(after).trim()}, ${year}`
}

/**
 * The parts with the month named as the world names it; unchanged when the
 * calendar does not name its months. A locale that writes the month as a
 * number with marks around it (ja's "3月", bg's "4.03.", lt's "03-04") loses
 * them, and gets spaces instead.
 */
function withWorldMonth(parts: Intl.DateTimeFormatPart[], monthName: string | null): Intl.DateTimeFormatPart[] {
  if (!monthName) return parts
  const at = parts.findIndex((part) => part.type === 'month')
  if (at < 0) return parts
  const renamed = [...parts]
  renamed[at] = { type: 'month', value: monthName }
  if (!/^\p{Nd}+$/u.test(parts[at]!.value)) return renamed
  // A numeric month's marks belong to the number: the 月 of "3月", the dots
  // of bg's "4.03." and the dash of lt's "03-04". Around a name they read
  // "Thaw月", "4.Thaw." and "Thaw-04", so the marks become spaces, and one
  // with nothing after it goes.
  const isMark = (part: Intl.DateTimeFormatPart | undefined) =>
    part?.type === 'literal' && !/^\s*$/.test(part.value) && !/[,،]/.test(part.value)
  if (isMark(renamed[at - 1])) renamed[at - 1] = { type: 'literal', value: ' ' }
  if (isMark(renamed[at + 1])) {
    if (at + 1 === renamed.length - 1) renamed.pop()
    else renamed[at + 1] = { type: 'literal', value: ' ' }
  }
  return renamed
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
  const options: Intl.DateTimeFormatOptions =
    precision === 'month' ? { timeZone: 'UTC', year: 'numeric', month: 'short' } : { timeZone: 'UTC', year: 'numeric' }
  if (world && precision === 'year') {
    return worldYearIn(date, new Intl.DateTimeFormat(locale, { ...options, calendar: 'gregory' }), locale, world)
  }
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
