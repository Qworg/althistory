/**
 * The value of a date field in a form, for the graph that is open.
 *
 * Without a world calendar a field is a native picker (`datetime-local` or
 * `date`) whose value is a UTC wall-clock time, read by `readDateField`. In a
 * world, a Gregorian picker means nothing: the field is text in the world's
 * notation ("Thaw 4, 312 AR, 06:30", "Thaw 312 AR"), read by
 * `readDateEntry` (docs/specs/world-calendars.md, Req 14, 15, 18). Both are
 * `@althistory/calendar`; the calendar left out is the open graph's.
 */

import type { GraphCalendar } from '@/types'
import { getActiveCalendar } from '@/stores/worldCalendarStore'
import { type DateBoundEdge, type DatePrecision, addMs, formatDateEntry, isoOfAxisTime, readDateEntry, readDateField, toAxisTime, toInstant } from '@althistory/calendar'

export type DateFieldKind = 'date' | 'datetime'

type CalendarArg = GraphCalendar | null | undefined

const DAY_MS = 86_400_000

const resolve = (calendar: CalendarArg) => (calendar === undefined ? getActiveCalendar() : calendar)

/** An instant as a field shows it: a native picker's value, or text in the world's notation. '' for none. */
export function dateFieldValue(
  value: string | Date | null | undefined,
  kind: DateFieldKind,
  options: { calendar?: CalendarArg; edge?: DateBoundEdge; precision?: DatePrecision } = {}
): string {
  if (value === null || value === undefined || value === '') return ''
  const world = resolve(options.calendar)
  if (world) return formatDateEntry(value, options.precision ?? 'day', world, options.edge ?? 'start')
  const date = toInstant(value)
  if (Number.isNaN(date.getTime())) return ''
  const iso = date.toISOString()
  // A native picker holds a year of four digits, 0001 to 9999: any other date
  // (before 1 CE, after 9999 CE, as far as the timeline goes) is shown as the
  // year-first text the field reads (`44 BCE`, `300000-06-15`), and the field is text.
  if (!NATIVE_YEAR.test(iso)) return formatDateEntry(date, options.precision ?? 'day', null, options.edge ?? 'start')
  return kind === 'date' ? iso.slice(0, 10) : iso.slice(0, 16)
}

/** An ISO date in the years a native date picker holds (0001-9999). */
const NATIVE_YEAR = /^(?!0000)\d{4}-/

/** What a native picker's value looks like: a whole date, or a date and a time. */
export function isNativeDateValue(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/.test(value)
}

/**
 * Whether text is year-first text for a date the picker cannot hold, which
 * the field reads as every other typed date: an era ("44 BCE"), a sign, or a
 * year of five digits or more.
 */
function isTypedYearText(value: string): boolean {
  return /\b(?:BCE|BC|CE|AD)\b/i.test(value) || /^[+-]/.test(value.trim()) || /^\d{5,}/.test(value.trim())
}

export type DateFieldRead = { ok: true; iso: string; precision: DatePrecision } | { ok: false; error: string }

/** A field's value as an instant, or why it names none. */
export function readDateFieldValue(
  value: string,
  options: { calendar?: CalendarArg; edge?: DateBoundEdge } = {}
): DateFieldRead {
  const world = resolve(options.calendar)
  if (world) return readDateEntry(value, world, options.edge ?? 'start')
  const field = readDateField(value)
  if (!field) {
    // A date the picker cannot hold, typed year first as the rest of the app reads it.
    if (isTypedYearText(value)) {
      const typed = readDateEntry(value, null, options.edge ?? 'start')
      return typed.ok ? { ok: true, iso: typed.iso, precision: typed.precision } : { ok: false, error: typed.error }
    }
    return { ok: false, error: 'Give a whole date.' }
  }
  // A date alone as an end is its last moment (Req 15), as in a world and in a filter.
  const start = toAxisTime(field.date)
  const last = options.edge === 'end' && field.dateOnly && start !== null ? addMs(start, DAY_MS - 1) : start
  return last === null ? { ok: false, error: 'Give a whole date.' } : { ok: true, iso: isoOfAxisTime(last), precision: 'day' }
}

/** A field's value as an ISO instant, or '' when it names none. */
export function dateFieldIso(value: string, options: { calendar?: CalendarArg; edge?: DateBoundEdge } = {}): string {
  const read = readDateFieldValue(value, options)
  return read.ok ? read.iso : ''
}
