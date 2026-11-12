/**
 * Where a time axis puts its year ticks in a world calendar.
 */

import type { GraphCalendar } from './calendar'
import { storedYear, worldYear } from './years'

/**
 * Move year ticks onto the world's round years, as a historian's axis counts.
 *
 * d3 steps multi-year ticks on Gregorian multiples (1840, 1850, ...). With a
 * world calendar whose year 1 is stored 1000, those are world years 841 and
 * 851. The ticks are moved, keeping d3's step, so that they count in round
 * steps from the epoch on both sides of it:
 *
 *   ..., "40 before AR", "20 before AR", "1 AR", "20 AR", "40 AR", ...
 *
 * After the epoch they fall on multiples of the step; before it, on round
 * counts back ("20 before" is world year -19); and year 1 stands in for the
 * year 0 that a plain multiple would put at the epoch. Ticks that are not all
 * New Year's Days at an even step of two or more years (months, days, hours)
 * are returned unchanged, as they are without a calendar.
 *
 * @param ticks - The scale's ticks, in order
 * @param domain - The visible domain; moved ticks outside it are dropped
 * @param calendar - The world calendar; null returns the ticks unchanged
 * @param utc - Whether the ticks are UTC (`d3.scaleUtc`) or local time (`d3.scaleTime`)
 */
export function alignYearTicksToCalendar(
  ticks: Date[],
  domain: readonly Date[],
  calendar: GraphCalendar | null,
  utc = false
): Date[] {
  if (!calendar || ticks.length < 2) return ticks
  const yearOf = (d: Date) => (utc ? d.getUTCFullYear() : d.getFullYear())
  const isYearStart = (d: Date) =>
    utc
      ? d.getUTCMonth() === 0 && d.getUTCDate() === 1 && d.getUTCHours() === 0 && d.getUTCMinutes() === 0
      : d.getMonth() === 0 && d.getDate() === 1 && d.getHours() === 0 && d.getMinutes() === 0
  if (!ticks.every(isYearStart)) return ticks
  const step = yearOf(ticks[1]!) - yearOf(ticks[0]!)
  if (step < 2) return ticks
  for (let i = 2; i < ticks.length; i++) {
    if (yearOf(ticks[i]!) - yearOf(ticks[i - 1]!) !== step) return ticks
  }

  const yearStart = (year: number) => {
    const date = new Date(0)
    if (utc) {
      date.setUTCFullYear(year, 0, 1)
      date.setUTCHours(0, 0, 0, 0)
    } else {
      date.setFullYear(year, 0, 1)
      date.setHours(0, 0, 0, 0)
    }
    return date
  }
  const ends = [+domain[0]!, +domain[domain.length - 1]!]
  const [lo, hi] = [Math.min(...ends), Math.max(...ends)]
  /** A world year an axis would name: year 1, a multiple of the step, or a round count before year 1. */
  const isRound = (year: number) => (year >= 1 ? year === 1 || year % step === 0 : (1 - year) % step === 0)

  const aligned: Date[] = []
  const last = worldYear(yearOf(ticks[ticks.length - 1]!), calendar) + step
  for (let year = worldYear(yearOf(ticks[0]!), calendar) - step; year <= last; year++) {
    if (!isRound(year)) continue
    const date = yearStart(storedYear(year, calendar))
    if (+date >= lo && +date <= hi) aligned.push(date)
  }
  return aligned.length > 1 ? aligned : ticks
}
