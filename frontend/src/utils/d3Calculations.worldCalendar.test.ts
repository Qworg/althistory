import { describe, expect, it } from 'vitest'
import * as d3 from 'd3'
import { alignYearTicksToCalendar, formatTimeAxisTick, formatTimeAxisTicks } from './d3Calculations'
import { formatEventDate } from './historicalTime'
import type { GraphCalendar } from '@/types'

const AR: GraphCalendar = { epochYear: 1000, eraLabel: 'AR' }
const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000

/** A local-time New Year's Day, as d3.scaleTime's year ticks are. */
function localYear(year: number): Date {
  const date = new Date(2000, 0, 1)
  date.setFullYear(year)
  return date
}

describe('time axis labels in a world calendar', () => {
  it('labels year ticks with world years', () => {
    const ticks = [localYear(1310), localYear(1311), localYear(1312)]
    expect(formatTimeAxisTicks(ticks, 10 * YEAR_MS, AR)).toEqual(['311 AR', '312 AR', '313 AR'])
  })

  it('labels month-and-year ticks with the stored month and the world year', () => {
    const ticks = [new Date(1311, 2, 1), new Date(1311, 5, 1), new Date(1311, 8, 1)]
    expect(formatTimeAxisTicks(ticks, YEAR_MS, AR)).toEqual(['Mar 312 AR', 'Jun 312 AR', 'Sep 312 AR'])
  })

  it('labels a decade tick by its own world year', () => {
    const ticks = [localYear(1309), localYear(1319), localYear(1329)]
    expect(formatTimeAxisTicks(ticks, 40 * YEAR_MS, AR)).toEqual(['310 AR', '320 AR', '330 AR'])
    expect(formatTimeAxisTick(localYear(999), 40 * YEAR_MS, AR)).toBe('1 before AR')
  })

  it('leaves ticks without a year alone', () => {
    const ticks = [new Date(1311, 2, 4), new Date(1311, 2, 11)]
    expect(formatTimeAxisTicks(ticks, 20 * 24 * 60 * 60 * 1000, AR)).toEqual(
      formatTimeAxisTicks(ticks, 20 * 24 * 60 * 60 * 1000, null)
    )
  })

  it('is unchanged without a calendar', () => {
    const ticks = [localYear(1840), localYear(1850), localYear(1860)]
    expect(formatTimeAxisTicks(ticks, 40 * YEAR_MS, null)).toEqual(['1840s', '1850s', '1860s'])
  })

  it('agrees with the event labels about the year', () => {
    // An event on 1 July 1311 (UTC) sits between the 1311 and 1312 ticks.
    const event = formatEventDate({ timestamp: '1311-07-01T00:00:00Z', metadata: { datePrecision: 'year' } }, 'en-US', AR)
    expect(formatTimeAxisTick(localYear(1311), 10 * YEAR_MS, AR)).toBe(event)
  })
})

describe('alignYearTicksToCalendar', () => {
  it("moves multi-year ticks onto the world's round years", () => {
    const scale = d3.scaleTime().domain([localYear(1835), localYear(1880)]).range([0, 800])
    const ticks = scale.ticks(5)
    expect(ticks.map((t) => t.getFullYear())).toEqual([1840, 1850, 1860, 1870, 1880])
    const aligned = alignYearTicksToCalendar(ticks, scale.domain(), AR)
    expect(aligned.map((t) => t.getFullYear())).toEqual([1839, 1849, 1859, 1869, 1879])
    expect(formatTimeAxisTicks(aligned, 45 * YEAR_MS, AR)).toEqual(['840 AR', '850 AR', '860 AR', '870 AR', '880 AR'])
  })

  it('works on a UTC scale', () => {
    const scale = d3.scaleUtc().domain([new Date('1835-01-01T00:00:00Z'), new Date('1880-01-01T00:00:00Z')]).range([0, 800])
    const aligned = alignYearTicksToCalendar(scale.ticks(5), scale.domain(), AR, true)
    expect(aligned.map((t) => t.getUTCFullYear())).toEqual([1839, 1849, 1859, 1869, 1879])
  })

  it('leaves yearly, monthly and calendar-less ticks alone', () => {
    const yearly = [localYear(1310), localYear(1311), localYear(1312)]
    expect(alignYearTicksToCalendar(yearly, [localYear(1310), localYear(1312)], AR)).toBe(yearly)
    const monthly = [new Date(1311, 0, 1), new Date(1311, 3, 1)]
    expect(alignYearTicksToCalendar(monthly, [monthly[0]!, monthly[1]!], AR)).toBe(monthly)
    const decades = [localYear(1840), localYear(1850)]
    expect(alignYearTicksToCalendar(decades, [localYear(1835), localYear(1855)], null)).toBe(decades)
  })
})
