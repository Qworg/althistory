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

import { type DateBoundEdge, formatBoundAt, readHistoricalText } from './bounds'
import type { DatePrecision } from './describe'
import { toAxisTime, toInstant } from './instant'
import { type AxisTime, instantOfAxisTime, isoOfAxisTime } from './time'
import { formatHistoricalDate, formatHistoricalTimestamp } from './locale'
import type { WorldCalendarSet } from './world/definition'
import { calendarIn, dateAt } from './world/engine'
import { readWorldTimestamp, unreadDateReason } from './world/describe'
import { formatWorldFields, parseWorldDate, worldPeriod } from './world/notation'

export type DateEntryRead =
  | { ok: true; iso: string; /** The same instant on the axis (time.ts). */ time: AxisTime; precision: DatePrecision; /** The world calendar it was written in. */ calendar?: string }
  | { ok: false; error: string }

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
    if (shown.ok) {
      let position = shown.position
      if (edge === 'end' && !shown.timed) {
        const period = worldPeriod(calendarIn(calendar, shown.calendar), shown.fields, shown.precision)
        if (!period) return { ok: false, error: 'That date is beyond the range a date can hold.' }
        position = period.end
      }
      return { ok: true, iso: isoOfAxisTime(position), time: position, precision: shown.precision, calendar: shown.calendar }
    }
    // The world's other calendars, and ISO 8601, as every other door reads them.
    const read = readWorldTimestamp(calendar, trimmed, edge)
    if (read) return { ok: true, ...read }
    return { ok: false, error: unreadDateReason(calendar, trimmed) }
  }
  // As every door reads it: ISO 8601, then a year first ("1871-03", "44 BCE",
  // "1843-11-20 14:30"), its message when neither.
  const read = readWorldTimestamp(null, trimmed, edge)
  if (read) return { ok: true, iso: read.iso, time: read.time, precision: read.precision }
  const historical = readHistoricalText(trimmed, edge)
  return historical.ok ? { ok: true, iso: historical.iso, time: historical.time, precision: historical.precision } : { ok: false, error: historical.error }
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
  edge: DateBoundEdge = 'start',
  /** In a world, the calendar a month or year was given in (`dateCalendarOf`); it is written in that one. */
  calendarId?: string
): string {
  if (value === null || value === undefined || value === '') return ''
  const position = toAxisTime(value)
  if (position === null) return ''
  // An end on the last moment of its day names the day, as a start on its first does.
  const endsDay = edge === 'end' && isDayStart(position + 1n, calendar)
  if (calendar) {
    const own = precision !== 'day' && calendarId && calendar.calendars.some((definition) => definition.id === calendarId) ? calendarId : undefined
    const shown = calendarIn(calendar, own)
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
  const date = instantOfAxisTime(position)
  if (!date) return ''
  const day = formatBoundAt(date, precision)
  if (endsDay || precision !== 'day') return day
  const hours = date.getUTCHours()
  const minutes = date.getUTCMinutes()
  return hours || minutes || edge === 'end' ? `${day} ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}` : day
}

function isDayStart(position: AxisTime, calendar: WorldCalendarSet | null): boolean {
  if (!calendar) return position % 86_400_000n === 0n
  const shown = calendarIn(calendar)
  return position % BigInt(shown.dayMs) === 0n
}

/**
 * An end as it is shown (an arc's): the day alone when it is that day's last
 * moment, as it was typed; otherwise the date and time. "Thaw 30, 312 AR", not
 * "Thaw 30, 312 AR, 19:99"; "Mar 31, 1871", not "Mar 31, 1871, 23:59 UTC".
 */
export function formatHistoricalEnd(value: string | Date | null | undefined, locale: string | undefined, calendar: WorldCalendarSet | null): string {
  if (value === null || value === undefined || value === '') return 'Invalid date'
  const date = toInstant(value)
  const time = toAxisTime(date)
  if (time === null) return 'Invalid date'
  if (calendar) return formatDateEntry(date, 'day', calendar, 'end')
  return isDayStart(time + 1n, null) ? formatHistoricalDate(date, locale, null) : formatHistoricalTimestamp(date, locale, null)
}
