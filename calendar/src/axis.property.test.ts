import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { alignYearTicksToCalendar, alignedYearTicks, worldYear } from './index'
import * as arb from './test/arbitraries'

/** The multi-year steps a d3 time scale ticks at. */
const STEPS = [2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]

const DAY = 86_400_000

function yearStart(year: number, utc: boolean): Date {
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

/** Year ticks as d3 makes them: New Year's Days on multiples of a step, and a domain a little wider. */
const axis = fc
  .record({
    step: fc.constantFrom(...STEPS),
    first: fc.integer({ min: -2000, max: 9000 }),
    count: fc.integer({ min: 2, max: 12 }),
    padBefore: fc.double({ min: 0, max: 0.99, noNaN: true }),
    padAfter: fc.double({ min: 0, max: 0.99, noNaN: true }),
    utc: fc.boolean(),
  })
  .map(({ step, first, count, padBefore, padAfter, utc }) => {
    const start = Math.ceil(first / step) * step
    const ticks = Array.from({ length: count }, (_, i) => yearStart(start + i * step, utc))
    const span = step * 365 * DAY
    const domain = [new Date(+ticks[0]! - padBefore * span), new Date(+ticks[count - 1]! + padAfter * span)]
    return { step, ticks, domain, utc }
  })

describe('year ticks in a world calendar, for every axis and time zone', () => {
  it("fall on the world's round years, in order, inside the domain, with none left out", () => {
    fc.assert(
      fc.property(axis, arb.calendar, ({ step, ticks, domain, utc }, calendar) => {
        // Even multi-year ticks in a world calendar are always moved: never left on Gregorian round years.
        const result = alignedYearTicks(ticks, domain, calendar, utc)
        expect(result).not.toBeNull()
        const { ticks: aligned, step: used } = result!
        expect(alignYearTicksToCalendar(ticks, domain, calendar, utc)).toEqual(aligned)
        expect(used).toBeLessThanOrEqual(step)
        const yearOf = (d: Date) => (utc ? d.getUTCFullYear() : d.getFullYear())
        const isRound = (year: number) => (year >= 1 ? year === 1 || year % used === 0 : (1 - year) % used === 0)
        const [lo, hi] = [+domain[0]!, +domain[1]!]

        expect(aligned.length).toBeGreaterThanOrEqual(2)
        for (const [i, tick] of aligned.entries()) {
          expect(+tick).toBe(+yearStart(yearOf(tick), utc))
          expect(isRound(worldYear(yearOf(tick), calendar)), String(worldYear(yearOf(tick), calendar))).toBe(true)
          expect(+tick).toBeGreaterThanOrEqual(lo)
          expect(+tick).toBeLessThanOrEqual(hi)
          if (i > 0) {
            const gap = yearOf(tick) - yearOf(aligned[i - 1]!)
            expect(gap).toBeGreaterThanOrEqual(1)
            expect(gap).toBeLessThanOrEqual(used)
          }
        }
        // Every round world year whose New Year's Day is in the domain has a tick.
        const years = new Set(aligned.map(yearOf))
        for (let year = yearOf(new Date(lo)) - 1; year <= yearOf(new Date(hi)) + 1; year++) {
          const at = +yearStart(year, utc)
          if (at >= lo && at <= hi && isRound(worldYear(year, calendar))) expect(years.has(year), String(year)).toBe(true)
        }
        // A smaller step only when the given one had fewer than two round years in view.
        if (used < step) {
          const roundAtStep = Array.from({ length: yearOf(new Date(hi)) - yearOf(new Date(lo)) + 3 }, (_, i) => yearOf(new Date(lo)) - 1 + i).filter(
            (year) => {
              const at = +yearStart(year, utc)
              const w = worldYear(year, calendar)
              return at >= lo && at <= hi && (w >= 1 ? w === 1 || w % step === 0 : (1 - w) % step === 0)
            }
          )
          expect(roundAtStep.length).toBeLessThan(2)
        }
      }),
      arb.runs(2000)
    )
  })

  it('puts a narrow two-tick axis on round world years, not "841 AR" and "851 AR"', () => {
    const ticks = [yearStart(1840, true), yearStart(1850, true)]
    const aligned = alignYearTicksToCalendar(ticks, ticks, { epochYear: 1000, eraLabel: 'AR' }, true)
    expect(aligned.map((tick) => worldYear(tick.getUTCFullYear(), { epochYear: 1000 }))).toEqual([845, 850])
  })

  it('leave ticks alone without a calendar, or when they are not even multi-year steps', () => {
    fc.assert(
      fc.property(axis, ({ ticks, domain, utc }) => {
        expect(alignYearTicksToCalendar(ticks, domain, null, utc)).toBe(ticks)
      })
    )
    fc.assert(
      fc.property(axis, arb.calendar, ({ ticks, domain, utc }, calendar) => {
        const months = ticks.map((tick) => new Date(+tick + 31 * DAY))
        expect(alignYearTicksToCalendar(months, domain, calendar, utc)).toBe(months)
        const uneven = [...ticks, yearStart((utc ? ticks[ticks.length - 1]!.getUTCFullYear() : ticks[ticks.length - 1]!.getFullYear()) + 1, utc)]
        expect(alignYearTicksToCalendar(uneven, domain, calendar, utc)).toBe(uneven)
      })
    )
  })
})
