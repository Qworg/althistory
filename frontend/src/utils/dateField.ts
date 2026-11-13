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
import { type DateBoundEdge, type DatePrecision, formatDateEntry, readDateEntry, readDateField, toInstant } from '@althistory/calendar'

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
  // A native picker holds a four-digit year: anything else it cannot show.
  if (!/^\d{4}-/.test(iso)) return ''
  return kind === 'date' ? iso.slice(0, 10) : iso.slice(0, 16)
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
  if (!field) return { ok: false, error: 'Give a whole date.' }
  // A date alone as an end is its last moment (Req 15), as in a world and in a filter.
  const end = options.edge === 'end' && field.dateOnly ? new Date(field.date.getTime() + DAY_MS - 1) : field.date
  return { ok: true, iso: end.toISOString(), precision: 'day' }
}

/** A field's value as an ISO instant, or '' when it names none. */
export function dateFieldIso(value: string, options: { calendar?: CalendarArg; edge?: DateBoundEdge } = {}): string {
  const read = readDateFieldValue(value, options)
  return read.ok ? read.iso : ''
}
