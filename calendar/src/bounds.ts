/**
 * Dates as people type them: a filter's bounds ("1843", "1843-11",
 * "44-03-15 BCE") and the values of the app's date fields ("1843-11-20",
 * "1843-11-20T14:30").
 *
 * Like every historical time, each is read as a UTC instant, whatever the
 * host's zone: a field's "1843-11-20T00:00" is midnight UTC, not local
 * midnight.
 */

import type { WorldCalendarSet } from './world/definition'
import type { DatePrecision } from './describe'
import { daysInMonth } from './gregorian'
import { parseIsoInstant, toInstant } from './instant'
import { formatWorldBound, worldBound } from './world/axis'
import { calendarIn, dateAt } from './world/engine'
import { formatWorldFields } from './world/notation'

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
  // ISO 8601's own spelling of a year outside 1-9999 (a signed six-digit
  // year, or 0000) counts astronomically, as toISOString writes it and every
  // other reader reads it: "-000043" is 44 BCE, "0000" is 1 BCE.
  const iso = /^(?:([+-]\d{6})|(0000))(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(trimmed)
  let astronomicalYear: number
  let monthText: string | undefined
  let dayText: string | undefined
  if (iso) {
    astronomicalYear = Number(iso[1] ?? 0)
    monthText = iso[3]
    dayText = iso[4]
  } else {
    const match = HISTORICAL_DATE_PATTERN.exec(trimmed)
    if (!match) {
      return { ok: false, error: 'Write the year first: 1843, 1843-11 or 1843-11-20 (add BCE before 1 CE).' }
    }
    const [, minus, yearText, monthPart, dayPart, era] = match
    const eraUpper = era?.toUpperCase()
    const isBce = Boolean(minus) || eraUpper === 'BCE' || eraUpper === 'BC'
    if (minus && (eraUpper === 'BCE' || eraUpper === 'BC' || eraUpper === 'CE' || eraUpper === 'AD')) {
      return { ok: false, error: 'Use a minus sign or an era, not both.' }
    }
    const year = Number(yearText)
    if (year === 0) {
      return { ok: false, error: 'There is no year 0: 1 BCE is followed by 1 CE.' }
    }
    astronomicalYear = isBce ? 1 - year : year
    monthText = monthPart
    dayText = dayPart
  }
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
  const date = toInstant(value)
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

/**
 * An instant as a bound at the precision it is known to: "1871-03-01" for a
 * day (even the 1st, which {@link formatHistoricalDateBound} would widen to
 * the month), "1871-03" for a month, "1871" for a year. What a date field
 * shows, so that saving it unchanged keeps what is known.
 */
export function formatBoundAt(value: Date, precision: DatePrecision): string {
  if (Number.isNaN(value.getTime())) return ''
  const year = value.getUTCFullYear()
  if (precision === 'year') return formatBound(year)
  if (precision === 'month') return formatBound(year, value.getUTCMonth() + 1)
  return formatBound(year, value.getUTCMonth() + 1, value.getUTCDate())
}

/** How much of a date a canonical bound names: `1843` a year, `1843-11` a month, `1843-11-20` a day. */
export function boundPrecision(text: string): DatePrecision {
  const parts = text.replace(/ BCE$/, '').split('-').length
  return parts === 1 ? 'year' : parts === 2 ? 'month' : 'day'
}

/**
 * A typed bound for a graph. In a world, it is written in the world's
 * notation ("Thaw 312 AR", "312 AR"), read by {@link worldBound}; a link's
 * bound, an ISO 8601 date and time, is the instant it names. Year-first text
 * ("312", "1843-11") is no date of the world's, and is refused. Without a world, {@link parseHistoricalDate}. The text returned is
 * the canonical spelling (in a world, in the calendar shown): what the field
 * shows once it is left.
 */
export function readDateBound(input: string, edge: DateBoundEdge, calendar: WorldCalendarSet | null): HistoricalDateParse {
  if (!calendar) {
    const historical = parseHistoricalDate(input, edge)
    if (historical.ok) return historical
    // A date and time (a link's, or pasted): the instant it names.
    const instant = parseIsoInstant(input.trim())
    if (instant && !instant.dateOnly) return { ok: true, date: instant.date, text: formatHistoricalDateBound(instant.date, edge) }
    return historical
  }
  const world = worldBound(calendar, input, edge)
  if (world.ok) {
    // Spelled at the precision it was typed, as a stored bound is ("Qaa 4,
    // Year 9" stays a day, though it ends the year); a date in another of
    // the world's calendars, in the one shown.
    const shown = calendarIn(calendar)
    const text =
      world.calendar === shown.definition.id
        ? formatWorldFields(shown, dateAt(shown, world.position), world.precision)
        : formatWorldBound(calendar, world.position, edge)
    return { ok: true, date: new Date(world.position), text }
  }
  // ISO 8601, as every door reads it: a date and time (a link's) is that
  // instant, a date its UTC day (as an end, the day's last moment). A
  // Gregorian month or year is no period of the world's, nor is a bare "312".
  const instant = parseIsoInstant(input.trim())
  if (instant && (instant.precision === 'month' || instant.precision === 'year')) {
    return { ok: false, error: `"${input.trim()}" is a Gregorian ${instant.precision}, which is no ${instant.precision} of this world: give it in the world's calendar, or give a day.` }
  }
  if (instant) {
    const at = instant.dateOnly && edge === 'end' ? instant.date.getTime() + 86_400_000 - 1 : instant.date.getTime()
    if (Math.abs(at) <= 8.64e15) return { ok: true, date: new Date(at), text: formatWorldBound(calendar, at, edge) }
  }
  return world
}

/**
 * An instant (or a typed bound) as a bound for a graph, the inverse of
 * {@link readDateBound}: in a world, in the notation of the calendar shown;
 * otherwise {@link formatHistoricalDateBound}. '' when there is nothing to show.
 */
export function formatDateBound(
  value: Date | string | null | undefined,
  edge: DateBoundEdge,
  calendar: WorldCalendarSet | null
): string {
  if (!calendar) return formatHistoricalDateBound(value, edge)
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'string') {
    const read = readDateBound(value, edge, calendar)
    if (read.ok) return read.text
  }
  return formatWorldBound(calendar, toInstant(value).getTime(), edge)
}

// ── Date fields ──────────────────────────────────────────────────────────

/**
 * What a date field holds, as an instant: a `date` value (YYYY-MM-DD) is its
 * UTC midnight, a `datetime-local` value (YYYY-MM-DDTHH:mm) is that UTC
 * wall-clock time, and a full ISO 8601 timestamp is itself. Anything else (a
 * free-text field part-way through "1066", or "March 1066") is null: the
 * host's lenient parser would read "1" as 2001, and a date-time without a
 * zone as local time. So is a date or time that does not exist
 * ("2019-02-31", "T24:00"), which V8 would roll over into the next month or
 * day and other engines refuse. See {@link parseIsoInstant}.
 */
export function readDateField(value: string | null | undefined): { date: Date; dateOnly: boolean } | null {
  // A field holds a whole date, written in full: "1066" or "1066-3-4" is a
  // free-text field part-way through (on its way to "1066-3-14").
  if (!value || !/^[+-]?\d{4,6}-\d{2}-\d{2}(?:$|[Tt ])/.test(value)) return null
  const parsed = parseIsoInstant(value)
  if (!parsed || parsed.precision === 'year' || parsed.precision === 'month') return null
  return { date: parsed.date, dateOnly: parsed.dateOnly }
}
