/**
 * Ticks for a timeline without a world calendar, by arithmetic, so that an
 * axis can run past what a Date holds (docs/specs/deep-time.md, Req 12). The
 * app draws a Date-sized axis with d3's own ticks, as it always did; this is
 * for the rest, and labels in English ("300000 BCE", "Jan 1, 300000 CE").
 */

import type { AxisTime } from '../time'
import { type WorldTick, worldTicks } from './axis'
import type { WorldCalendarSet } from './definition'
import { calendarIn } from './engine'
import { gregorianDefinition } from './legacy'

const GREGORIAN_AXIS: WorldCalendarSet = {
  version: 2,
  dayLength: 86_400,
  calendars: [{ ...gregorianDefinition({ id: 'gregorian', name: 'Gregorian', eraLabel: 'CE' }), beforeEra: 'BCE' }],
  primary: 'gregorian',
}

/** Ticks over a domain on the proleptic Gregorian calendar: at most `maxTicks`, in order, on round units, each labelled differently. */
export function gregorianTicks(domain: readonly [AxisTime | number, AxisTime | number], maxTicks: number): WorldTick[] {
  return worldTicks(calendarIn(GREGORIAN_AXIS), domain, maxTicks)
}
