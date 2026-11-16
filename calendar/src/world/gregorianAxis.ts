/**
 * Ticks for a timeline without a world calendar, by arithmetic, so that an
 * axis can run past what a Date holds (docs/specs/deep-time.md, Req 12). The
 * app draws the rest of a real history's axis with d3's own ticks, as it
 * always did. The ticks fall on the proleptic Gregorian calendar's round
 * years, months, days and hours.
 *
 * A tick is written as a person types a date, in every locale, so that it
 * reads back where it is typed (`readDateBound`): ASCII digits, `BCE` after a
 * year before 1 CE and nothing after one from 1 CE on, a month or day in the
 * bound syntax ("250000000 BCE", "300000", "44-03-01 BCE"). A time of day
 * after a day's first moment is its UTC hours and minutes ("14:30").
 */

import { formatBoundAt } from '../bounds'
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

const pad2 = (value: number) => String(value).padStart(2, '0')

/** The UTC hours and minutes of a moment ("14:30"). */
function timeOf(position: AxisTime): string {
  const { hour, minute } = civilOfAxisTime(position)
  return `${pad2(hour)}:${pad2(minute)}`
}

/** Tick labels in the typed syntax, at the unit's precision. */
const typedLabels: TickLabeller = (unit, ticks) => {
  const dates = ticks.map((position) => instantOfAxisTime(position) ?? new Date(NaN))
  let labels: string[]
  if (unit === 'year' || unit === 'month' || unit === 'day') {
    labels = dates.map((date) => formatBoundAt(date, unit))
  } else {
    // As a d3 axis reads: a day's first moment by its date, the rest by their time.
    // (Ticks fall on whole minutes, so a day's start is 00:00.)
    const dayStart = (position: AxisTime) => timeOf(position) === '00:00'
    // The day of the rest is the axis's to name, beside them (the app draws it as a caption).
    labels = ticks.map((position, index) => (dayStart(position) ? formatBoundAt(dates[index]!, 'day') : timeOf(position)))
  }
  if (new Set(labels).size !== labels.length) labels = ticks.map((position, index) => `${formatBoundAt(dates[index]!, 'day')} ${timeOf(position)}`)
  return labels
}

/**
 * Ticks over a domain on the proleptic Gregorian calendar: at most `maxTicks`,
 * in order, on round units, each labelled differently, in the typed syntax.
 */
export function gregorianTicks(domain: readonly [AxisTime | number, AxisTime | number], maxTicks: number): WorldTick[] {
  return worldTicks(calendarIn(GREGORIAN_AXIS), domain, maxTicks, typedLabels)
}
