/**
 * Worlds and the Gregorian calendar over the whole axis, not only what a Date
 * holds (docs/specs/deep-time.md, Req 8-12): a 1,000,000-year chronicle with a
 * 30-hour day, a day of one second, a day of a million.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import * as arb from '../test/arbitraries'
import * as warb from '../test/worldArbitraries'
import {
  type CompiledCalendar,
  type WorldCalendarSet,
  type WorldDateFields,
  MAX_AXIS_MS,
  MIN_AXIS_MS,
  calendarIn,
  compileCalendar,
  dateAt,
  formatInWorld,
  formatWorldFields,
  gregorianDefinition,
  gregorianTicks,
  isoOfAxisTime,
  legacyCalendarSet,
  parseWorldDate,
  positionOf,
  readWorldTimestamp,
  worldTicks,
} from '../index'

const tuple = (d: WorldDateFields) => [d.year, d.part, d.day, d.hour, d.minute, d.second]
const compare = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!
  return 0
}

/** A calendar set, and a position anywhere on the axis. */
const anywhere = fc.tuple(warb.calendarSet, arb.axisTime)

describe('a world over the whole axis (Req 8)', () => {
  it('names every position, and the first position of its second reads back the same, at any distance from 1970', () => {
    fc.assert(
      fc.property(anywhere, ([set, t]) => {
        const calendar = calendarIn(set)
        const d = dateAt(calendar, t)
        const start = positionOf(calendar, d)
        fc.pre(start !== null)
        expect(start!).toBeLessThanOrEqual(t)
        // Within the second: a second is at most a day of milliseconds long.
        expect(t - start!).toBeLessThan(BigInt(calendar.dayMs))
        expect(dateAt(calendar, start!)).toEqual(d)
        if (start! - 1n >= MIN_AXIS_MS) expect(compare(tuple(dateAt(calendar, start! - 1n)), tuple(d))).toBeLessThan(0)
      }),
      arb.runs(4000)
    )
  })

  it('never names an earlier date for a later position', () => {
    fc.assert(
      fc.property(warb.calendarSet, arb.axisTime, fc.bigInt({ min: 0n, max: 10n ** 12n }), (set, a, gap) => {
        const calendar = calendarIn(set)
        const b = a + gap
        fc.pre(b <= MAX_AXIS_MS)
        expect(compare(tuple(dateAt(calendar, a)), tuple(dateAt(calendar, b)))).toBeLessThanOrEqual(0)
      }),
      arb.runs(3000)
    )
  })

  it('reads the text it writes: a date out to the end of the axis names the day that holds the position', () => {
    fc.assert(
      fc.property(anywhere, ([set, t]) => {
        const calendar = calendarIn(set)
        const d = dateAt(calendar, t)
        const text = formatWorldFields(calendar, d, 'day')
        const read = parseWorldDate(calendar, text)
        fc.pre(read.ok)
        if (!read.ok) return
        expect(read.fields).toMatchObject({ year: d.year, part: d.part, day: d.day })
        // The first moment of the day: no later than the position, and in the same day.
        expect(read.position).toBeLessThanOrEqual(t)
        expect(tuple(dateAt(calendar, read.position)).slice(0, 3)).toEqual([d.year, d.part, d.day])
      }),
      arb.runs(3000)
    )
  })

  it('reads, at every door, the day it wrote, beyond ±275,760 years (Req 10)', () => {
    fc.assert(
      fc.property(warb.calendarSet, arb.deepAxisTime, (set, t) => {
        const text = formatInWorld(set, t, 'day')
        const read = readWorldTimestamp(set, text)
        fc.pre(read !== null)
        const shown = calendarIn(set)
        const d = dateAt(shown, t)
        const back = dateAt(calendarIn(set, read!.calendar), read!.time)
        expect(back.year === d.year || read!.calendar !== shown.definition.id).toBe(true)
        expect(read!.iso).toBe(isoOfAxisTime(read!.time))
      }),
      arb.runs(2000)
    )
  })
})

describe('a chronicle of a million years (Req 9)', () => {
  const world: WorldCalendarSet = {
    version: 2,
    dayLength: 30 * 3600,
    primary: 'ages',
    calendars: [
      {
        id: 'ages',
        name: 'The Ages',
        parts: [
          { name: 'Ember', days: 40 },
          { name: 'Ash', days: 41 },
          { name: 'Rest', days: 3, intercalary: true },
        ],
        leapRules: [{ every: 10, part: 2, days: 1 }],
        epoch: 0,
        eras: [{ label: 'AF', from: 1 }],
        beforeEra: 'BF',
      },
    ],
  }

  it('reaches a million years either way and reads each date back', () => {
    const calendar = calendarIn(world)
    const yearMs = BigInt(Math.round((calendar.cycleDays * calendar.dayMs) / calendar.cycleYears))
    for (const years of [1n, 1_000n, 275_761n, 1_000_000n, -1_000_000n, 100_000_000n]) {
      const t = years * yearMs
      const d = dateAt(calendar, t)
      const text = formatWorldFields(calendar, d, 'day')
      const read = readWorldTimestamp(world, text)
      expect(read, text).not.toBeNull()
      expect(dateAt(calendar, read!.time)).toMatchObject({ year: d.year, part: d.part, day: d.day })
      expect(positionOf(calendar, { ...d, hour: 0, minute: 0, second: 0 })).toBe(read!.time)
    }
  })

  it('has dayLength 1 and 1,000,000 positions to the end of the axis', () => {
    for (const dayLength of [1, 1_000_000]) {
      const set: WorldCalendarSet = { ...world, dayLength }
      const calendar = compileCalendar(world.calendars[0]!, dayLength)
      for (const t of [MIN_AXIS_MS, MAX_AXIS_MS, 0n, 123_456_789_012_345_678n]) {
        const d = dateAt(calendar, t)
        const start = positionOf(calendar, d)
        fc.pre(start !== null)
        expect(dateAt(calendar, start!)).toEqual(d)
      }
      expect(formatInWorld(set, MAX_AXIS_MS)).not.toBe('Invalid date')
    }
  })
})

describe('the Gregorian calendar over the whole axis (Req 11)', () => {
  it('names every position as the arithmetic of time.ts does', () => {
    const gregorian: CompiledCalendar = compileCalendar(gregorianDefinition({}), 86_400)
    fc.assert(
      fc.property(arb.axisTime, (t) => {
        const d = dateAt(gregorian, t)
        const iso = isoOfAxisTime(t)
        const [year, month, day] = /^([+-]?\d+)-(\d{2})-(\d{2})T/.exec(iso)!.slice(1).map(Number) as [number, number, number]
        expect([d.year, d.part + 1, d.day]).toEqual([year, month, day])
        const start = positionOf(gregorian, d)
        fc.pre(start !== null)
        expect(dateAt(gregorian, start!)).toEqual(d)
      }),
      arb.runs(3000)
    )
  })

  it('makes a calendar with its year 1 anywhere the axis holds', () => {
    const set = legacyCalendarSet({ epochYear: 300_000, eraLabel: 'AR' })
    const calendar = calendarIn(set)
    expect(formatInWorld(set, 0n)).toMatch(/AR|before/)
    expect(dateAt(calendar, 0n).year).toBe(1970 - 300_000 + 1)
  })
})

/** A domain as a deep timeline shows one: from a day to the whole axis wide. */
const deepDomain = fc
  .tuple(arb.axisTime, fc.integer({ min: 3, max: 18 }), fc.double({ min: 0.1, max: 10, noNaN: true }))
  .map(([start, exponent, factor]): [bigint, bigint] => {
    const width = BigInt(Math.round(10 ** exponent * factor))
    const end = start + width
    return [start, end > MAX_AXIS_MS ? MAX_AXIS_MS : end]
  })

describe('a timeline beyond a Date (Req 12)', () => {
  it('puts world ticks in order inside the domain, each labelled differently', () => {
    fc.assert(
      fc.property(warb.calendarSet, deepDomain, fc.integer({ min: 2, max: 12 }), (set, [lo, hi], maxTicks) => {
        fc.pre(hi > lo)
        const calendar = calendarIn(set)
        const ticks = worldTicks(calendar, [lo, hi], maxTicks)
        expect(ticks.length).toBeLessThanOrEqual(maxTicks)
        for (const [index, tick] of ticks.entries()) {
          expect(tick.position).toBeGreaterThanOrEqual(lo)
          expect(tick.position).toBeLessThanOrEqual(hi)
          if (index > 0) expect(tick.position).toBeGreaterThan(ticks[index - 1]!.position)
        }
        expect(new Set(ticks.map((tick) => tick.label)).size).toBe(ticks.length)
      }),
      arb.runs(1500)
    )
  })

  it('puts Gregorian ticks in order inside the domain, each labelled differently, whatever the width', () => {
    fc.assert(
      fc.property(deepDomain, fc.integer({ min: 2, max: 12 }), ([lo, hi], maxTicks) => {
        fc.pre(hi > lo)
        const ticks = gregorianTicks([lo, hi], maxTicks)
        expect(ticks.length).toBeLessThanOrEqual(maxTicks)
        for (const [index, tick] of ticks.entries()) {
          expect(tick.position).toBeGreaterThanOrEqual(lo)
          expect(tick.position).toBeLessThanOrEqual(hi)
          if (index > 0) expect(tick.position).toBeGreaterThan(ticks[index - 1]!.position)
        }
        expect(new Set(ticks.map((tick) => tick.label)).size).toBe(ticks.length)
        // A domain of a few years or more always has a tick.
        if (hi - lo >= 10n * 366n * 86_400_000n) expect(ticks.length).toBeGreaterThanOrEqual(1)
      }),
      arb.runs(1500)
    )
  })

  it('labels a span of a million years in years, with the era', () => {
    const ticks = gregorianTicks([-500_000n * 31_556_952_000n, 300_000n * 31_556_952_000n], 8)
    expect(ticks.length).toBeGreaterThan(2)
    expect(ticks.map((tick) => tick.label).join()).toMatch(/BCE/)
    expect(ticks.map((tick) => tick.label).join()).toMatch(/CE/)
  })
})
