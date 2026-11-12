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
 * year 0 that a plain multiple would put at the epoch. When fewer than two of
 * the step's round years are in view (a narrow axis given two ticks a decade
 * apart may hold only one), the next smaller step of d3's 1-2-5 series that
 * gives no more than one tick over d3's count is used, or else that one round
 * year alone: an axis of world years never falls back to Gregorian round
 * numbers ("841 AR", "851 AR"), and never crowds more labels than d3 chose
 * room for. Ticks that are not all New Year's Days at an even
 * step of two or more years (months, days, hours) are returned unchanged, as
 * they are without a calendar.
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
  return alignedYearTicks(ticks, domain, calendar, utc)?.ticks ?? ticks
}

/**
 * {@link alignYearTicksToCalendar}, saying which step the ticks were put on;
 * null when they are left as they are.
 */
export function alignedYearTicks(
  ticks: Date[],
  domain: readonly Date[],
  calendar: GraphCalendar | null,
  utc = false
): { ticks: Date[]; step: number } | null {
  if (!calendar || ticks.length < 2) return null
  const yearOf = (d: Date) => (utc ? d.getUTCFullYear() : d.getFullYear())
  const isYearStart = (d: Date) =>
    utc
      ? d.getUTCMonth() === 0 && d.getUTCDate() === 1 && d.getUTCHours() === 0 && d.getUTCMinutes() === 0
      : d.getMonth() === 0 && d.getDate() === 1 && d.getHours() === 0 && d.getMinutes() === 0
  if (!ticks.every(isYearStart)) return null
  const step = yearOf(ticks[1]!) - yearOf(ticks[0]!)
  if (step < 2) return null
  for (let i = 2; i < ticks.length; i++) {
    if (yearOf(ticks[i]!) - yearOf(ticks[i - 1]!) !== step) return null
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
  const first = worldYear(yearOf(new Date(lo)), calendar)
  const last = worldYear(yearOf(new Date(hi)), calendar) + 1

  const roundYears = (candidate: number): Date[] => {
    /** A world year an axis would name: year 1, a multiple of the step, or a round count before year 1. */
    const isRound = (year: number) => (year >= 1 ? year === 1 || year % candidate === 0 : (1 - year) % candidate === 0)
    const aligned: Date[] = []
    for (let year = first; year <= last; year++) {
      if (!isRound(year)) continue
      const date = yearStart(storedYear(year, calendar))
      if (+date >= lo && +date <= hi) aligned.push(date)
    }
    return aligned
  }

  const atStep = roundYears(step)
  if (atStep.length > 1) return { ticks: atStep, step }
  // A smaller step, but no more ticks than d3 asked for and one: it chose
  // its count for the axis's width, and near year 1 a step of 2 could fit
  // five labels where there is room for two.
  for (const candidate of smallerSteps(step)) {
    const aligned = roundYears(candidate)
    if (aligned.length > 1 && aligned.length <= ticks.length + 1) return { ticks: aligned, step: candidate }
  }
  // Otherwise the one round year in view, which a domain as wide as the step always holds.
  return atStep.length > 0 ? { ticks: atStep, step } : null
}

/** The steps of d3's 1-2-5 series below `step`, largest first: 20 -> 10, 5, 2, 1. */
function smallerSteps(step: number): number[] {
  const steps: number[] = []
  for (let power = 1; power < step; power *= 10) {
    for (const unit of [1, 2, 5]) if (unit * power < step) steps.push(unit * power)
  }
  return steps.reverse()
}
