/**
 * A world's dates in plain English, as the exports, the CLI and a language
 * model's instructions write them. The app writes them in the viewer's locale
 * instead (locale.ts).
 */

import type { GraphCalendar } from './calendar'
import { MONTH_WORDS, formatWorldYear, monthLabel } from './years'

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
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp)
  if (Number.isNaN(date.getTime())) return String(timestamp)
  if (!calendar) return isoDatePart(date, precision)
  const year = formatWorldYear(date.getUTCFullYear(), calendar)
  const month = monthLabel(date.getUTCMonth(), calendar)
  if (precision === 'year') return year
  if (precision === 'month') return `${month} ${year}`
  return `${month} ${date.getUTCDate()}, ${year}`
}

/** One line saying how the calendar maps, for exports and tool output. */
export function describeCalendar(calendar: GraphCalendar): string {
  const named = calendar.name ? `${calendar.name}: ` : ''
  const years = `${named}stored year ${calendar.epochYear} is ${formatWorldYear(calendar.epochYear, calendar)}`
  return calendar.monthNames ? `${years}; the months: ${monthPairs(calendar.monthNames)}` : years
}

/** "January is Lowtide, February is Greywater, …": which name is which stored month. */
function monthPairs(monthNames: string[]): string {
  return monthNames.map((name, index) => `${MONTH_WORDS[index]} is ${name}`).join(', ')
}

/**
 * What a reader of prose about the world (a language model extracting events)
 * needs to turn the world's dates into stored ones: how its years are counted
 * and, if it names them, which month is which.
 */
export function calendarExtractionInstructions(calendar: GraphCalendar): string {
  const named = calendar.name ? ` (${calendar.name})` : ''
  const written = calendar.eraLabel ? ` (written "N ${calendar.eraLabel}")` : ''
  const months = calendar.monthNames
    ? ` Its months are the ISO months under other names: ${monthPairs(calendar.monthNames)}. A day keeps its number.`
    : ''
  const before = calendar.eraLabel ? `"N before ${calendar.eraLabel}"` : '"N before Year 1"'
  return (
    `The text dates events in an invented world's calendar${named}. ` +
    `Its year N${written} is the ISO year N + ${calendar.epochYear - 1}, and a year counted back, ${before}, ` +
    `is the ISO year ${calendar.epochYear} - N.${months} ` +
    'Give every timestamp as that ISO date.'
  )
}
