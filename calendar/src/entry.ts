/**
 * A date typed into a form: an event's date, an arc's start or end, a range
 * to export or to read text in (docs/specs/world-calendars.md, Req 14-16, 18).
 *
 * Without a world it is written as the filter writes bounds, year first and
 * as precise as is known (`1843`, `1843-11`, `1843-11-20`), `BCE` before 1 CE,
 * with an optional UTC time (`1843-11-20 14:30`). In a world it is written in
 * the world's notation, in the calendar shown (the set's primary) or any
 * other of its calendars ("Thaw 312 AR", "Thaw 4, 312 AR, 06:30"), and an ISO
 * 8601 timestamp is read too.
 *
 * A date at month or year precision names a period: as a start it is the
 * period's first moment, as an end its last (Req 15), and the precision is
 * returned to be recorded (Req 16).
 */

import { type DateBoundEdge, boundPrecision, formatBoundAt, parseHistoricalDate } from './bounds'
import type { DatePrecision } from './describe'
import { parseIsoInstant, readTimestamp, toInstant } from './instant'
import type { WorldCalendarSet } from './world/definition'
import { calendarIn, dateAt } from './world/engine'
import { formatWorldFields, parseWorldDate, parseWorldText, worldPeriod } from './world/notation'

export type DateEntryRead = { ok: true; iso: string; precision: DatePrecision } | { ok: false; error: string }

const TIME_SUFFIX = /^(.+?)(?:[ T](\d{1,2}):(\d{2}))$/

/**
 * Read a typed date. `edge` says which end of a period an untimed date
 * stands for: a start is its first moment, an end its last.
 */
export function readDateEntry(text: string, calendar: WorldCalendarSet | null, edge: DateBoundEdge = 'start'): DateEntryRead {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: false, error: 'Give a date.' }
  if (calendar) {
    // In the calendar shown first, so what a field shows always reads back as
    // itself; then in the world's others (which refuse text two of them read
    // as different dates).
    const shown = parseWorldDate(calendarIn(calendar), trimmed)
    const read = shown.ok ? shown : parseWorldText(calendar, trimmed)
    if (read.ok) {
      let position = read.position
      if (edge === 'end' && !read.timed) {
        const period = worldPeriod(calendarIn(calendar, read.calendar), read.fields, read.precision)
        if (!period) return { ok: false, error: 'That date is beyond the range a date can hold.' }
        position = period.end
      }
      return { ok: true, iso: new Date(position).toISOString(), precision: read.precision }
    }
    // A full ISO 8601 date (pasted, say) is a position too; as an end
    // without a time, the last moment of its (Gregorian, UTC) day, as without a world.
    const iso = readTimestamp(trimmed)
    if (iso && iso.precision === 'day') {
      const dateOnly = parseIsoInstant(trimmed)?.dateOnly ?? false
      const position = Date.parse(iso.iso) + (edge === 'end' && dateOnly ? 86_400_000 - 1 : 0)
      return { ok: true, iso: new Date(position).toISOString(), precision: 'day' }
    }
    return { ok: false, error: sentence(read.error) }
  }
  const timed = TIME_SUFFIX.exec(trimmed)
  const datePart = timed ? timed[1]! : trimmed
  const parsed = parseHistoricalDate(datePart, timed ? 'start' : edge)
  if (!parsed.ok) return { ok: false, error: parsed.error }
  if (timed && boundPrecision(parsed.text) !== 'day') return { ok: false, error: 'A time needs a whole date: 1843-11-20 14:30.' }
  const date = new Date(parsed.date.getTime())
  if (timed) {
    const hours = Number(timed[2])
    const minutes = Number(timed[3])
    if (hours > 23 || minutes > 59) return { ok: false, error: 'The time must be 00:00 to 23:59, in UTC.' }
    date.setUTCHours(hours, minutes, 0, 0)
  }
  // "1871-03" states a month and "1871" a year; a day, or a time, states the day.
  return { ok: true, iso: date.toISOString(), precision: timed ? 'day' : boundPrecision(parsed.text) }
}

/**
 * A date as a form shows it, at the precision it is known to, the inverse of
 * {@link readDateEntry}: in a world, in the calendar shown (the set's
 * primary). At day precision a time is written when the date is not at the
 * start of its day as the time is shown (to the minute, or the second when
 * the notation has seconds); as an end, unless it is the day's last moment,
 * since an end without a time names the whole day. '' when there is no date.
 */
export function formatDateEntry(
  value: string | Date | null | undefined,
  precision: DatePrecision,
  calendar: WorldCalendarSet | null,
  edge: DateBoundEdge = 'start'
): string {
  if (value === null || value === undefined || value === '') return ''
  const position = toInstant(value).getTime()
  if (!Number.isFinite(position)) return ''
  // An end on the last moment of its day names the day, as a start on its first does.
  const endsDay = edge === 'end' && isDayStart(position + 1, calendar)
  if (calendar) {
    const shown = calendarIn(calendar)
    const date = dateAt(shown, position)
    const day = formatWorldFields(shown, date, precision)
    if (endsDay || precision !== 'day') return day
    const timed = formatWorldFields(shown, date, 'day', true)
    if (edge === 'end') return timed
    // The time as shown may read as the day's start: then it says nothing.
    const back = parseWorldDate(shown, timed)
    const startOfDay = parseWorldDate(shown, day)
    return back.ok && startOfDay.ok && back.position === startOfDay.position ? day : timed
  }
  const date = new Date(position)
  const day = formatBoundAt(date, precision)
  if (endsDay || precision !== 'day') return day
  const hours = date.getUTCHours()
  const minutes = date.getUTCMinutes()
  return hours || minutes || edge === 'end' ? `${day} ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}` : day
}

function isDayStart(position: number, calendar: WorldCalendarSet | null): boolean {
  if (!calendar) return position % 86_400_000 === 0
  const shown = calendarIn(calendar)
  return position % shown.dayMs === 0
}

/** A reason as a sentence: capitalised, with a full stop. */
function sentence(text: string): string {
  const trimmed = text.trim()
  const capital = trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
  return /[.!?]$/.test(capital) ? capital : `${capital}.`
}
