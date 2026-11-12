/**
 * Dates in plain text: the ISO date part of an instant, and a date in a
 * calendar of the earlier form, which the world calendars are checked
 * against (world/world.property.test.ts). The app writes dates in the
 * viewer's locale (locale.ts); a world's, in its notation (world/).
 */

import type { GraphCalendar } from './calendar'
import { toInstant } from './instant'
import { formatWorldYear, monthLabel } from './years'

export type DatePrecision = 'day' | 'month' | 'year'

/**
 * The date part of an ISO 8601 timestamp, as `toISOString` writes it:
 * "1311-03-04", or with an expanded year "-000043-03-15" (44 BCE) and
 * "+010000-01-01". Cut to the precision asked for: "-000043-03", "-000043".
 */
export function isoDatePart(date: Date, precision: DatePrecision = 'day'): string {
  const iso = date.toISOString()
  const day = iso.slice(0, iso.indexOf('T'))
  if (precision === 'day') return day
  return precision === 'month' ? day.slice(0, -3) : day.slice(0, -6)
}

/**
 * A stored timestamp as a date in the world's calendar: "Mar 4, 312 AR", or
 * "Thaw 4, 312 AR" when the calendar names its months, always in UTC.
 * Without a calendar it is the ISO date ("1311-03-04"), as exports always wrote it.
 * `precision` drops the parts its source did not state.
 */
export function formatWorldDate(
  timestamp: string | Date,
  calendar: GraphCalendar | null | undefined,
  precision: DatePrecision = 'day'
): string {
  const date = toInstant(timestamp)
  if (Number.isNaN(date.getTime())) return String(timestamp)
  if (!calendar) return isoDatePart(date, precision)
  const year = formatWorldYear(date.getUTCFullYear(), calendar)
  const month = monthLabel(date.getUTCMonth(), calendar)
  if (precision === 'year') return year
  if (precision === 'month') return `${month} ${year}`
  return `${month} ${date.getUTCDate()}, ${year}`
}
