import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import * as arb from '../test/arbitraries'
import * as warb from '../test/worldArbitraries'
import { MAX_TIME, calendarIn, dateAt, formatWorldFields, positionOf, worldBound, worldBoundExamples, worldTicks } from './index'

/** A domain as a timeline shows one: minutes to tens of thousands of years wide. */
const domain = fc
  .tuple(fc.integer({ min: -1e14, max: 1e14 }), fc.constantFrom(6e4, 3.6e6, 8.64e7, 3e9, 3e10, 3e11, 3e12, 3e13, 3e14), fc.double({ min: 0.1, max: 10, noNaN: true }))
  .map(([start, scale, factor]) => [start, Math.min(MAX_TIME, start + Math.round(scale * factor))] as [number, number])

describe('a timeline in any world calendar (Req 17)', () => {
  it('puts at most the ticks asked for inside the domain, in order, on round units, each labelled differently', () => {
    fc.assert(
      fc.property(warb.calendarSet, domain, fc.integer({ min: 2, max: 12 }), (set, [lo, hi], maxTicks) => {
        const calendar = calendarIn(set)
        const ticks = worldTicks(calendar, [lo, hi], maxTicks)
        expect(ticks.length).toBeLessThanOrEqual(maxTicks)
        for (const [index, tick] of ticks.entries()) {
          expect(tick.position).toBeGreaterThanOrEqual(lo)
          expect(tick.position).toBeLessThanOrEqual(hi)
          if (index > 0) expect(tick.position).toBeGreaterThan(ticks[index - 1]!.position)
          // On a boundary: the first millisecond of a second that starts a minute.
          const date = dateAt(calendar, tick.position)
          expect(date.second).toBe(0)
          expect(positionOf(calendar, date)).toBe(tick.position)
        }
        expect(new Set(ticks.map((tick) => tick.label)).size).toBe(ticks.length)
        // A domain wider than a few of the calendar's minutes always has a tick.
        const minute = calendar.dayMs / (calendar.time.hoursPerDay * calendar.time.minutesPerHour)
        if (hi - lo >= 3 * minute) expect(ticks.length).toBeGreaterThanOrEqual(1)
      }),
      arb.runs(1500)
    )
  })
})

describe('a filter bound in a world calendar (Req 15)', () => {
  it('names, at its precision, the period that holds the date it was written from', () => {
    fc.assert(
      fc.property(warb.calendarSet, fc.integer({ min: -1e13, max: 1e13 }), fc.constantFrom('day', 'month', 'year') as fc.Arbitrary<'day' | 'month' | 'year'>, (set, p, precision) => {
        const calendar = calendarIn(set)
        const text = formatWorldFields(calendar, dateAt(calendar, p), precision)
        const start = worldBound(set, text, 'start')
        const end = worldBound(set, text, 'end')
        expect(start.ok && end.ok, text).toBe(true)
        if (!start.ok || !end.ok) return
        expect(start.precision).toBe(precision)
        expect(start.position).toBeLessThanOrEqual(p)
        expect(p).toBeLessThanOrEqual(end.position)
        // The end is the last millisecond: one more is the next period.
        expect(formatWorldFields(calendar, dateAt(calendar, end.position), precision)).toBe(text)
        expect(formatWorldFields(calendar, dateAt(calendar, end.position + 1), precision)).not.toBe(text)
      }),
      arb.runs(2000)
    )
  })

  it('gives examples for a hint that read as bounds at their precision', () => {
    fc.assert(
      fc.property(warb.calendarSet, (set) => {
        const examples = worldBoundExamples(set)
        for (const precision of ['year', 'month', 'day'] as const) {
          const read = worldBound(set, examples[precision], 'start')
          expect(read.ok, examples[precision]).toBe(true)
          if (read.ok) expect(read.precision).toBe(precision)
        }
      }),
      arb.runs(500)
    )
  })
})
