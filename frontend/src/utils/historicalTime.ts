/**
 * Formatting for *historical* time: when an event happened, when an arc
 * starts and ends, the range of a pressure, a point of divergence.
 *
 * These are dates in a history, not moments on the viewer's clock: they are
 * formatted in UTC, and a midnight is shown as a date alone. Wall-clock times
 * -- when a key was created, an export finished, a version was committed --
 * are not historical and keep the viewer's local time.
 *
 * The formatting itself is `@althistory/calendar` (calendar/src/locale.ts),
 * which the backend shares and which is property-tested in every locale and
 * in five time zones. What this module adds is the app's default: every
 * formatter takes the calendar as its last argument, and left out it is the
 * active graph's (`getActiveCalendar()`); `null` means none. Without a
 * calendar the output is the locale's own.
 */

import type { GraphCalendar } from '@/types'
import { getActiveCalendar } from '@/stores/worldCalendarStore'
import * as calendarLib from '@althistory/calendar'

export { datePrecisionOf, type DatePrecision } from '@althistory/calendar'

type DateInput = calendarLib.DateInput

/** The calendar argument: `undefined` is the active graph's, `null` none. */
type CalendarArg = GraphCalendar | null | undefined

function resolveCalendar(calendar: CalendarArg): GraphCalendar | null {
  return calendar === undefined ? getActiveCalendar() : calendar
}

/**
 * A stored year (a UTC year, as the timestamps hold it) in the world's
 * calendar, or null when there is no calendar, so a caller keeps its own
 * spelling of a plain year: `worldYearLabel(year) ?? String(year)`.
 */
export function worldYearLabel(storedYear: number, calendar?: CalendarArg): string | null {
  const active = resolveCalendar(calendar)
  return active ? calendarLib.formatWorldYear(storedYear, active) : null
}

/** "Nov 20, 1843" (in the viewer's locale), never shifted by their time zone. */
export function formatHistoricalDate(value: DateInput, locale?: string, calendar?: CalendarArg): string {
  return calendarLib.formatHistoricalDate(value, locale, resolveCalendar(calendar))
}

/**
 * The date alone for a timestamp at midnight UTC (how dates are stored), and
 * the date with the UTC time otherwise: "Nov 20, 1843" or
 * "Nov 20, 1843, 14:30 UTC".
 */
export function formatHistoricalTimestamp(value: DateInput, locale?: string, calendar?: CalendarArg): string {
  return calendarLib.formatHistoricalTimestamp(value, locale, resolveCalendar(calendar))
}

/** "Nov 20, 1843", "Mar 1871" or "1871", by how much of the date is known. */
export function formatHistoricalDateAt(
  value: DateInput,
  precision: calendarLib.DatePrecision,
  locale?: string,
  calendar?: CalendarArg
): string {
  return calendarLib.formatHistoricalDateAt(value, precision, locale, resolveCalendar(calendar))
}

/** An event's date, at the precision its source gave. */
export function formatEventDate(
  event: { timestamp: string; metadata?: Record<string, unknown> },
  locale?: string,
  calendar?: CalendarArg
): string {
  return calendarLib.formatEventDate(event, locale, resolveCalendar(calendar))
}

/** "Nov 20, 1843 – Jan 9, 1868". */
export function formatHistoricalRange(start: DateInput, end: DateInput, locale?: string, calendar?: CalendarArg): string {
  return calendarLib.formatHistoricalRange(start, end, locale, resolveCalendar(calendar))
}
