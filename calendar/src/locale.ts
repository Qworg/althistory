/**
 * Formatting *historical* time in a viewer's locale: when an event happened,
 * when an arc starts and ends, the range of a pressure, a point of divergence.
 *
 * These are dates in a history, not moments on the viewer's clock, and they
 * are stored as UTC instants (a date is its UTC midnight). Formatting them in
 * the host's time zone moved them: west of Greenwich, 1843-11-20T00:00Z
 * rendered as the 19th, and before standardised time zones the host applies
 * local mean time, so it rendered as "11/19/1843, 4:07:02 PM". They are
 * formatted in UTC, and a midnight is shown as a date alone.
 *
 * A world calendar relabels the year, and the month when it names them:
 * "Nov 20, 1843" becomes "Nov 20, 844 AR" (or "Frostfall 20, 844 AR"), in the
 * locale's own order. Every formatter takes the calendar explicitly; `null`
 * means none, and then the output is exactly the locale's own.
 */

import type { GraphCalendar } from './calendar'
import type { DatePrecision } from './describe'
import { formatWorldYear, worldMonthName } from './years'

export type DateInput = Date | string | number

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
 * The world year of a date as the locale writes it ("312 AR", "٣١٢ AR"): the
 * year phrase every world-calendar date below contains.
 */
export function formatWorldYearIn(value: DateInput, locale: string | undefined, calendar: GraphCalendar): string {
  const date = toDate(value)
  const formatter = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', year: 'numeric', calendar: 'gregory' })
  return worldYearIn(date, formatter, locale, calendar)
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
    worldMonthName(date.getUTCMonth(), calendar),
    formatter.resolvedOptions().locale
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
function withWorldMonth(
  parts: Intl.DateTimeFormatPart[],
  monthName: string | null,
  locale: string
): Intl.DateTimeFormatPart[] {
  if (!monthName) return parts
  const at = parts.findIndex((part) => part.type === 'month')
  if (at < 0) return parts
  const renamed = [...parts]
  renamed[at] = { type: 'month', value: monthName }
  if (!/^\p{Nd}+$/u.test(parts[at]!.value)) return withoutMonthAffixes(renamed, at)
  // A numeric month's marks belong to the number: the 月 of "3月", the dots
  // of bg's "4.03." and the dash of lt's "03-04". Around a name they read
  // "Thaw月", "4.Thaw." and "Thaw-04", so the marks become spaces, and one
  // with nothing after it goes. A dot after the day stays where the locale
  // writes the day as an ordinal before a month's name ("4. března" in cs,
  // "4. maaliskuuta" in fi, as de writes "4. März"), and goes where the dot
  // only separates numbers (bg's "4.03." beside "4 март").
  const isMark = (part: Intl.DateTimeFormatPart | undefined) =>
    part?.type === 'literal' && !/^\s*$/.test(part.value) && !/[,،]/.test(part.value)
  if (isMark(renamed[at - 1])) {
    const afterDay = renamed[at - 2]?.type === 'day' && renamed[at - 1]!.value.trim() === '.'
    renamed[at - 1] = { type: 'literal', value: afterDay && writesOrdinalDay(locale) ? '. ' : ' ' }
  }
  if (isMark(renamed[at + 1])) {
    if (at + 1 === renamed.length - 1) renamed.pop()
    else renamed[at + 1] = { type: 'literal', value: ' ' }
  }
  return renamed
}

/**
 * A locale's month word can carry a grammatical affix that the formatter
 * writes as a literal glued to it: he's "in" before it ("4 בינו׳") and mn's
 * genitive after it ("1-р сарын 4"). On the world's name it would glue a
 * letter of another script to it ("4 בThaw", "Thawын 4"), so it goes, and the
 * space stays.
 */
function withoutMonthAffixes(parts: Intl.DateTimeFormatPart[], at: number): Intl.DateTimeFormatPart[] {
  const before = parts[at - 1]
  if (before?.type === 'literal' && /[\p{L}\p{M}]$/u.test(before.value)) {
    const value = before.value.replace(/[\p{L}\p{M}]+$/u, '')
    parts[at - 1] = { type: 'literal', value: /\s$/u.test(value) || at - 1 === 0 ? value : `${value} ` }
  }
  const after = parts[at + 1]
  if (after?.type === 'literal' && /^[\p{L}\p{M}]/u.test(after.value)) {
    const value = after.value.replace(/^[\p{L}\p{M}]+/u, '')
    if (at + 1 === parts.length - 1 && value.trim() === '') parts.pop()
    else parts[at + 1] = { type: 'literal', value: /^\s/u.test(value) ? value : ` ${value}` }
  }
  return parts
}

const ordinalDayLocales = new Map<string, boolean>()

/** Whether the locale writes a dot after the day before a month's name: "4. března", not "4 март". */
function writesOrdinalDay(locale: string): boolean {
  let known = ordinalDayLocales.get(locale)
  if (known === undefined) {
    const parts = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', timeZone: 'UTC', calendar: 'gregory' }).formatToParts(
      new Date(Date.UTC(2001, 2, 4))
    )
    const day = parts.findIndex((part) => part.type === 'day')
    const next = parts[day + 1]
    known = day >= 0 && next?.type === 'literal' && next.value.trim() === '.' && parts[day + 2]?.type === 'month'
    ordinalDayLocales.set(locale, known)
  }
  return known
}

export function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value)
}

export function isUtcMidnight(date: Date): boolean {
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

/**
 * The options for a date without a world calendar. A year before 1 CE gets
 * its era: a formatter writes the year of its era, so 44 BCE is "44" and,
 * without "BC", reads as 44 CE.
 */
function plainOptions(date: Date, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions {
  return date.getUTCFullYear() <= 0 ? { ...options, era: 'short' } : options
}

/** "Nov 20, 1843" (in the locale), never shifted by the host's time zone; "Mar 15, 44 BC" before 1 CE. */
export function formatHistoricalDate(value: DateInput, locale: string | undefined, calendar: GraphCalendar | null): string {
  const date = toDate(value)
  if (Number.isNaN(date.getTime())) return 'Invalid date'
  if (calendar) return formatInWorld(date, locale, DATE_OPTIONS, calendar)
  return date.toLocaleDateString(locale, plainOptions(date, DATE_OPTIONS))
}

/**
 * The date alone for a timestamp at midnight UTC (how dates are stored), and
 * the date with the UTC time otherwise: "Nov 20, 1843" or
 * "Nov 20, 1843, 14:30 UTC".
 */
export function formatHistoricalTimestamp(value: DateInput, locale: string | undefined, calendar: GraphCalendar | null): string {
  const date = toDate(value)
  if (Number.isNaN(date.getTime())) return 'Invalid date'
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
  calendar: GraphCalendar | null
): string {
  if (precision === 'day') return formatHistoricalTimestamp(value, locale, calendar)
  const date = toDate(value)
  if (Number.isNaN(date.getTime())) return 'Invalid date'
  // On the Gregorian calendar whatever the locale's own: a day is a day in any
  // calendar, but a Gregorian month or year is not one month or year of
  // another (1969 is parts of 1347 and 1348 in fa-IR's Solar Hijri), so the
  // locale's calendar would name the period that holds its first day only.
  const options: Intl.DateTimeFormatOptions =
    precision === 'month'
      ? { timeZone: 'UTC', year: 'numeric', month: 'short', calendar: 'gregory' }
      : { timeZone: 'UTC', year: 'numeric', calendar: 'gregory' }
  if (calendar && precision === 'year') {
    return worldYearIn(date, new Intl.DateTimeFormat(locale, { ...options, calendar: 'gregory' }), locale, calendar)
  }
  if (calendar) return formatInWorld(date, locale, options, calendar)
  return date.toLocaleDateString(locale, plainOptions(date, options))
}

/** An event's date, at the precision its source gave. */
export function formatEventDate(
  event: { timestamp: string; metadata?: Record<string, unknown> },
  locale: string | undefined,
  calendar: GraphCalendar | null
): string {
  return formatHistoricalDateAt(event.timestamp, datePrecisionOf(event.metadata), locale, calendar)
}

/** "Nov 20, 1843 – Jan 9, 1868". */
export function formatHistoricalRange(start: DateInput, end: DateInput, locale: string | undefined, calendar: GraphCalendar | null): string {
  return `${formatHistoricalDate(start, locale, calendar)} – ${formatHistoricalDate(end, locale, calendar)}`
}
