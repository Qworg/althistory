/**
 * Stored years and months as a world names them.
 */

import { type GraphCalendar, hasTwelveMonthNames } from './calendar'

/** The world's year for a stored year: the epoch year is 1, the year before it 0. */
export function worldYear(storedYear: number, calendar: GraphCalendar): number {
  return storedYear - calendar.epochYear + 1
}

/** The stored year that shows as the given world year. */
export function storedYear(year: number, calendar: GraphCalendar): number {
  return year + calendar.epochYear - 1
}

/**
 * A world year as words: "312 AR", or "Year 312" without a label. A year before
 * year 1 counts back from it: the year before the epoch is "1 before AR" (or
 * "1 before Year 1"), because a year 0 or a minus sign reads as an error.
 *
 * `formatNumber` writes the numbers in a locale's digits (see locale.ts); left
 * out, they are ASCII digits, as the exports and the CLI write them.
 */
export function formatWorldYear(
  storedYearValue: number,
  calendar: GraphCalendar,
  formatNumber: (value: number) => string = String
): string {
  const year = worldYear(storedYearValue, calendar)
  const label = calendar.eraLabel?.trim()
  if (year >= 1) return label ? `${formatNumber(year)} ${label}` : `Year ${formatNumber(year)}`
  const before = 1 - year
  return label ? `${formatNumber(before)} before ${label}` : `${formatNumber(before)} before Year ${formatNumber(1)}`
}

/** The stored months' short English names, as the exports and the CLI write them. */
export const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/** The stored months' full English names, as a model is told which is which. */
export const MONTH_WORDS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

/**
 * The world's name for a month (0 = January), or null when the calendar does
 * not name its months (or names them unusably: a list that is not twelve
 * strings, or an empty name, which only a hand-edited data file can hold).
 */
export function worldMonthName(monthIndex: number, calendar: GraphCalendar | null | undefined): string | null {
  const months = calendar?.monthNames
  return hasTwelveMonthNames(months) ? months[monthIndex] || null : null
}

/** A month (0 = January) by the world's name for it, or the stored month's short English name. */
export function monthLabel(monthIndex: number, calendar: GraphCalendar | null | undefined): string {
  return worldMonthName(monthIndex, calendar) ?? SHORT_MONTHS[monthIndex] ?? String(monthIndex + 1)
}
