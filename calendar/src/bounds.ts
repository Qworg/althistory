/**
 * Dates as people type them: a filter's bounds ("1843", "1843-11",
 * "44-03-15 BCE") and the values of the app's date fields ("1843-11-20",
 * "1843-11-20T14:30").
 *
 * Like every historical time, each is read as a UTC instant, whatever the
 * host's zone: a field's "1843-11-20T00:00" is midnight UTC, not local
 * midnight.
 */

import type { GraphCalendar } from './calendar'
import type { DatePrecision } from './describe'
import { daysInMonth } from './gregorian'
import { formatHistoricalDate, formatHistoricalDateAt, formatHistoricalTimestamp } from './locale'

// ── Bounds ───────────────────────────────────────────────────────────────
//
// The filter's date bounds are typed, not picked: a native date input shows
// the browser's locale order (mm/dd/yyyy in the US) and cannot reach BCE. A
// bound is a year, a year and month, or a full date, written largest unit
// first -- `1843`, `1843-11`, `1843-11-20` -- with `BCE` (or a minus sign) for
// years before 1 CE. There is no year 0: 1 BCE is followed by 1 CE.
//
// A start bound is the first moment of the period it names and an end bound
// the last, so `1843` to `1843` is the whole year.

export type DateBoundEdge = 'start' | 'end'

export type HistoricalDateParse = { ok: true; date: Date; text: string } | { ok: false; error: string }

const HISTORICAL_DATE_PATTERN = /^(-)?(\d{1,6})(?:-(\d{1,2})(?:-(\d{1,2}))?)?(?:\s*(BCE|BC|CE|AD))?$/i

/** A UTC instant from an astronomical year (1 BCE = 0); safe for years 0-99. */
function utcDate(astronomicalYear: number, monthIndex: number, day: number): Date {
  const date = new Date(Date.UTC(2000, 0, 1))
  date.setUTCFullYear(astronomicalYear, monthIndex, day)
  return date
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** The canonical spelling of a bound: `1843`, `1843-11`, `44-03-15 BCE`. */
function formatBound(astronomicalYear: number, month?: number, day?: number): string {
  const bce = astronomicalYear <= 0
  const year = bce ? 1 - astronomicalYear : astronomicalYear
  let text = String(year)
  if (month !== undefined) text += `-${pad2(month)}`
  if (day !== undefined) text += `-${pad2(day)}`
  return bce ? `${text} BCE` : text
}

/**
 * Read a typed date bound. `edge` decides which end of the named period it
 * stands for. Returns the instant and the canonical spelling, or a message
 * that says what is wrong.
 */
export function parseHistoricalDate(input: string, edge: DateBoundEdge): HistoricalDateParse {
  const trimmed = input.trim().replace(/\s+/g, ' ')
  const match = HISTORICAL_DATE_PATTERN.exec(trimmed)
  if (!match) {
    return { ok: false, error: 'Write the year first: 1843, 1843-11 or 1843-11-20 (add BCE before 1 CE).' }
  }
  const [, minus, yearText, monthText, dayText, era] = match
  const eraUpper = era?.toUpperCase()
  const isBce = Boolean(minus) || eraUpper === 'BCE' || eraUpper === 'BC'
  if (minus && (eraUpper === 'BCE' || eraUpper === 'BC' || eraUpper === 'CE' || eraUpper === 'AD')) {
    return { ok: false, error: 'Use a minus sign or an era, not both.' }
  }
  const year = Number(yearText)
  if (year === 0) {
    return { ok: false, error: 'There is no year 0: 1 BCE is followed by 1 CE.' }
  }
  const astronomicalYear = isBce ? 1 - year : year
  const month = monthText === undefined ? undefined : Number(monthText)
  const day = dayText === undefined ? undefined : Number(dayText)
  if (month !== undefined && (month < 1 || month > 12)) {
    return { ok: false, error: 'The month must be 01 to 12.' }
  }
  // By arithmetic, not by a Date: one past the end of what a Date holds is
  // NaN, which would read as a day the month does not have.
  if (month !== undefined && day !== undefined && (day < 1 || day > daysInMonth(astronomicalYear, month))) {
    return { ok: false, error: `That month has no day ${day}.` }
  }

  let date: Date
  if (edge === 'start') {
    date = utcDate(astronomicalYear, (month ?? 1) - 1, day ?? 1)
  } else {
    // The last millisecond of the period: the start of the next one, less 1ms.
    const next =
      day !== undefined
        ? utcDate(astronomicalYear, month! - 1, day + 1)
        : month !== undefined
          ? utcDate(astronomicalYear, month, 1)
          : utcDate(astronomicalYear + 1, 0, 1)
    date = new Date(next.getTime() - 1)
  }
  if (Number.isNaN(date.getTime())) {
    return { ok: false, error: 'That date is out of range.' }
  }
  return { ok: true, date, text: formatBound(astronomicalYear, month, day) }
}

/**
 * The canonical spelling of an instant as a bound, the inverse of
 * {@link parseHistoricalDate}: a start on 1 January reads as the year, on the
 * 1st of a month as the month; an end on the last moment of a year or month
 * likewise. Anything else is the full date. Invalid -> ''.
 */
export function formatHistoricalDateBound(value: Date | string | null | undefined, edge: DateBoundEdge): string {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'string') {
    // A typed bound (from a link, say) keeps its own precision: `1843` as an
    // end is the whole year, where Date would read it as 1 January.
    const parsed = parseHistoricalDate(value, edge)
    if (parsed.ok) return parsed.text
  }
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  if (edge === 'end') {
    const next = new Date(date.getTime() + 1)
    const isMidnight = (d: Date) =>
      d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0
    if (isMidnight(next)) {
      if (next.getUTCDate() === 1 && next.getUTCMonth() === 0) return formatBound(next.getUTCFullYear() - 1)
      if (next.getUTCDate() === 1) {
        return formatBound(date.getUTCFullYear(), date.getUTCMonth() + 1)
      }
      return formatBound(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
    }
  } else if (
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  ) {
    if (date.getUTCDate() === 1 && date.getUTCMonth() === 0) return formatBound(date.getUTCFullYear())
    if (date.getUTCDate() === 1) return formatBound(date.getUTCFullYear(), date.getUTCMonth() + 1)
  }
  return formatBound(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

/** How much of a date a canonical bound names: `1843` a year, `1843-11` a month, `1843-11-20` a day. */
export function boundPrecision(text: string): DatePrecision {
  const parts = text.replace(/ BCE$/, '').split('-').length
  return parts === 1 ? 'year' : parts === 2 ? 'month' : 'day'
}

/**
 * A typed bound as it reads in a world calendar ("1843-11" -> "Nov 844 AR"),
 * at the precision it was typed; null without a calendar or a readable bound.
 * Bounds are typed as stored (Gregorian) dates, like every date field; this is
 * what the filter's hint and chip show beside them.
 */
export function worldBoundLabel(
  text: string,
  edge: DateBoundEdge,
  calendar: GraphCalendar | null,
  locale?: string
): string | null {
  if (!calendar || text.trim() === '') return null
  const parsed = parseHistoricalDate(text, edge)
  if (!parsed.ok) return null
  const precision = boundPrecision(parsed.text)
  // An end bound is the period's last moment; the date alone names it.
  return precision === 'day'
    ? formatHistoricalDate(parsed.date, locale, calendar)
    : formatHistoricalDateAt(parsed.date, precision, locale, calendar)
}

// ── Date fields ──────────────────────────────────────────────────────────

const FIELD_VALUE =
  /^(\d{4,})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-](\d\d):(\d\d))?)?$/

/**
 * What a date field holds, as an instant: a `date` value (YYYY-MM-DD) is its
 * UTC midnight, a `datetime-local` value (YYYY-MM-DDTHH:mm) is that UTC
 * wall-clock time, and a full ISO 8601 timestamp is itself. Anything else (a
 * free-text field part-way through "1066", or "March 1066") is null: the
 * host's lenient parser would read "1" as 2001, and a date-time without a
 * zone as local time. So is a date or time that does not exist
 * ("2019-02-31", "T24:00"), which V8 would roll over into the next month or
 * day and other engines refuse.
 */
export function readDateField(value: string | null | undefined): { date: Date; dateOnly: boolean } | null {
  if (!value) return null
  const match = FIELD_VALUE.exec(value)
  if (!match) return null
  const [, year, month, day, hour, minute, second, zone, zoneHours, zoneMinutes] = match
  if (Number(day) < 1 || Number(day) > daysInMonth(Number(year), Number(month))) return null
  if (Number(hour ?? 0) > 23 || Number(minute ?? 0) > 59 || Number(second ?? 0) > 59) return null
  if (Number(zoneHours ?? 0) > 23 || Number(zoneMinutes ?? 0) > 59) return null
  const dateOnly = hour === undefined
  const date = new Date(dateOnly ? `${value}T00:00:00Z` : zone ? value : `${value}Z`)
  return Number.isNaN(date.getTime()) ? null : { date, dateOnly }
}

/**
 * What a stored-date field's value reads as in a world calendar ("Mar 4,
 * 312 AR"), or null when there is no calendar or nothing readable to show.
 */
export function worldDateOf(
  value: string | null | undefined,
  calendar: GraphCalendar | null,
  locale?: string
): string | null {
  if (!calendar) return null
  const field = readDateField(value)
  if (!field) return null
  return field.dateOnly
    ? formatHistoricalDate(field.date, locale, calendar)
    : formatHistoricalTimestamp(field.date, locale, calendar)
}
