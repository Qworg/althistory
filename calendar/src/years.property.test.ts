import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  SHORT_MONTHS,
  formatWorldYear,
  monthLabel,
  storedYear,
  worldYear,
} from './index'
import * as arb from './test/arbitraries'

/** Every year a Date can hold, and a little beyond. */
const anyYear = fc.integer({ min: -300000, max: 300000 })

/**
 * "312 AR" -> 312 forward; "10 before AR" -> 10 back: the count a label
 * writes, read back by its shape alone.
 */
function readWorldYear(text: string, label: string | undefined): { count: number; back: boolean } {
  const before = label ? new RegExp(`^(\\d+) before ${escape(label)}$`) : /^(\d+) before Year 1$/
  const after = label ? new RegExp(`^(\\d+) ${escape(label)}$`) : /^Year (\d+)$/
  const back = before.exec(text)
  if (back) return { count: Number(back[1]), back: true }
  const forward = after.exec(text)
  if (forward) return { count: Number(forward[1]), back: false }
  throw new Error(`"${text}" is not a world year`)
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

describe('world years, for every calendar and year', () => {
  it('map a stored year to a world year and back', () => {
    fc.assert(
      fc.property(arb.calendar, anyYear, (calendar, year) => {
        expect(storedYear(worldYear(year, calendar), calendar)).toBe(year)
        expect(worldYear(storedYear(year, calendar), calendar)).toBe(year)
        expect(worldYear(calendar.epochYear, calendar)).toBe(1)
      })
    )
  })

  it('write a count of at least 1, forward or back, never a year 0 or a minus sign', () => {
    fc.assert(
      fc.property(arb.calendar, anyYear, (calendar, year) => {
        const { count, back } = readWorldYear(formatWorldYear(year, calendar), calendar.eraLabel)
        expect(count).toBeGreaterThanOrEqual(1)
        expect(back ? 1 - count : count).toBe(worldYear(year, calendar))
      }),
      arb.runs(1000)
    )
  })

  it('give two different years two different labels', () => {
    fc.assert(
      fc.property(arb.calendar, anyYear, anyYear, (calendar, a, b) => {
        fc.pre(a !== b)
        expect(formatWorldYear(a, calendar)).not.toBe(formatWorldYear(b, calendar))
      }),
      arb.runs(1000)
    )
  })

  it('count back from the epoch with no gap: the year before year 1 is "1 before"', () => {
    fc.assert(
      fc.property(arb.calendar, (calendar) => {
        const label = calendar.eraLabel
        expect(formatWorldYear(calendar.epochYear, calendar)).toBe(label ? `1 ${label}` : 'Year 1')
        expect(formatWorldYear(calendar.epochYear - 1, calendar)).toBe(label ? `1 before ${label}` : '1 before Year 1')
      })
    )
  })
})

describe('month labels', () => {
  it("are the world's name when it names its months, and the stored month's otherwise", () => {
    fc.assert(
      fc.property(fc.option(arb.calendar, { nil: null }), fc.integer({ min: 0, max: 11 }), (calendar, month) => {
        const expected = calendar?.monthNames?.[month] ?? SHORT_MONTHS[month]
        expect(monthLabel(month, calendar)).toBe(expected)
      })
    )
  })
})
