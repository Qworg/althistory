/**
 * Ticks for a timeline without a world calendar, by arithmetic, so that an
 * axis can run past what a Date holds (docs/specs/deep-time.md, Req 12), or
 * across 1 CE. The app draws the rest of a real history's axis with d3's own
 * ticks, as it always did. The ticks fall on the proleptic Gregorian
 * calendar's round years, months, days and hours, and are labelled as the date
 * formatters (locale.ts) write those dates, in the locale's digits and with
 * its era, so a tick reads as the labels beside it ("250000000 BC",
 * "Mar 1, 44 BC").
 */

import { formatHistoricalDate, formatHistoricalDateAt, formatHistoricalTimestamp } from '../locale'
import { type AxisTime, civilOfAxisTime, instantOfAxisTime } from '../time'
import { type TickLabeller, type WorldTick, worldTicks } from './axis'
import type { WorldCalendarSet } from './definition'
import { calendarIn } from './engine'
import { gregorianDefinition } from './legacy'

const GREGORIAN_AXIS: WorldCalendarSet = {
  version: 2,
  dayLength: 86_400,
  calendars: [{ ...gregorianDefinition({ id: 'gregorian', name: 'Gregorian', eraLabel: 'CE' }), beforeEra: 'BCE' }],
  primary: 'gregorian',
}

/** The time of day alone, as the timestamp formatter writes it after the date ("14:30"). */
function timeOfDay(date: Date, locale: string | undefined): string {
  const full = formatHistoricalTimestamp(date, locale, null)
  const day = formatHistoricalDate(date, locale, null)
  return full.startsWith(`${day}, `) ? full.slice(day.length + 2).replace(/ UTC$/, '') : full
}

/** Tick labels as the date formatters write the tick's moment, at the unit's precision. */
function intlLabels(locale: string | undefined): TickLabeller {
  return (unit, ticks) => {
    const dates = ticks.map((position) => instantOfAxisTime(position) ?? new Date(NaN))
    let labels: string[]
    if (unit === 'year' || unit === 'month') {
      labels = dates.map((date) => formatHistoricalDateAt(date, unit, locale, null))
    } else if (unit === 'day') {
      labels = dates.map((date) => formatHistoricalDate(date, locale, null))
    } else {
      // As a d3 axis reads: a day's first moment by its date, the rest by their time.
      labels = ticks.map((position, index) => {
        const { hour, minute } = civilOfAxisTime(position)
        return hour === 0 && minute === 0 ? formatHistoricalDate(dates[index]!, locale, null) : timeOfDay(dates[index]!, locale)
      })
    }
    if (new Set(labels).size !== labels.length) labels = dates.map((date) => formatHistoricalTimestamp(date, locale, null))
    return labels
  }
}

/**
 * Ticks over a domain on the proleptic Gregorian calendar: at most `maxTicks`,
 * in order, on round units, each labelled differently, in `locale` (the
 * viewer's when undefined).
 */
export function gregorianTicks(domain: readonly [AxisTime | number, AxisTime | number], maxTicks: number, locale?: string): WorldTick[] {
  return worldTicks(calendarIn(GREGORIAN_AXIS), domain, maxTicks, intlLabels(locale))
}
