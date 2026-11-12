import { describe, expect, it } from 'vitest'
import * as d3 from 'd3'
import { alignYearTicksToCalendar, formatTimeAxisTick, formatTimeAxisTicks, getTimeAxisInterval } from './d3Calculations'
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

  it("labels month ticks with the world's month names when it has them", () => {
    const named: GraphCalendar = { ...AR, monthNames: ['Thaw', 'Seedfall', 'Greening', 'Highsun', 'Brine', 'Harvest', 'Ember', 'Ashfall', 'Gale', 'Dimming', 'Frost', 'Deepwinter'] }
    const ticks = [new Date(1311, 2, 1), new Date(1311, 5, 1), new Date(1311, 8, 1)]
    expect(formatTimeAxisTicks(ticks, YEAR_MS, named)).toEqual(['Greening 312 AR', 'Harvest 312 AR', 'Gale 312 AR'])
    const days = [new Date(1311, 2, 4), new Date(1311, 2, 11)]
    expect(formatTimeAxisTicks(days, 50 * 24 * 60 * 60 * 1000, named)).toEqual(['Greening 04', 'Greening 11'])
  })

  it('falls back to the stored month for an empty name', () => {
    const blank: GraphCalendar = { ...AR, monthNames: Array(12).fill('') }
    const ticks = [new Date(1311, 2, 1), new Date(1311, 5, 1)]
    expect(formatTimeAxisTicks(ticks, YEAR_MS, blank)).toEqual(['Mar 312 AR', 'Jun 312 AR'])
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

  it('agrees with the event labels in any time zone when read in UTC', () => {
    // UTC ticks (as the timelines use) put 1 January 1311 (UTC) exactly on the "312 AR" tick.
    const a = new Date('1309-01-01T00:00:00Z')
    const b = new Date('1313-06-01T00:00:00Z')
    const scale = d3.scaleUtc().domain([a, b]).range([0, 1000])
    const ticks = alignYearTicksToCalendar(scale.ticks(5), scale.domain(), AR, true)
    const labels = formatTimeAxisTicks(ticks, +b - +a, AR, true)
    const event = new Date('1311-01-01T00:00:00Z')
    const index = ticks.findIndex((tick) => +tick === +event)
    expect(index).toBeGreaterThanOrEqual(0)
    expect(labels[index]).toBe('312 AR')
    expect(formatEventDate({ timestamp: event.toISOString(), metadata: { datePrecision: 'year' } }, 'en-US', AR)).toBe(
      '312 AR'
    )
    expect(getTimeAxisInterval(10 * YEAR_MS, true)).toBe(d3.utcYear)
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

  it('counts round steps on both sides of the epoch, with year 1 at the epoch', () => {
    const utcYear = (year: number) => {
      const date = new Date(Date.UTC(2000, 0, 1))
      date.setUTCFullYear(year, 0, 1)
      return date
    }
    const domain: [Date, Date] = [utcYear(880), utcYear(1120)]
    const scale = d3.scaleUtc().domain(domain)
    const aligned = alignYearTicksToCalendar(scale.ticks(8), scale.domain(), AR, true)
    // Stored 880 is world year -119: 120 years before year 1.
    expect(formatTimeAxisTicks(aligned, +domain[1] - +domain[0], AR, true)).toEqual([
      '120 before AR',
      '100 before AR',
      '80 before AR',
      '60 before AR',
      '40 before AR',
      '20 before AR',
      '1 AR',
      '20 AR',
      '40 AR',
      '60 AR',
      '80 AR',
      '100 AR',
      '120 AR',
    ])
  })

  it('starts an axis that opens at the epoch on "1 AR", not "1 before AR"', () => {
    const scale = d3.scaleTime().domain([localYear(1000), localYear(1100)])
    const aligned = alignYearTicksToCalendar(scale.ticks(5), scale.domain(), AR)
    const labels = formatTimeAxisTicks(aligned, 100 * YEAR_MS, AR)
    expect(labels[0]).toBe('1 AR')
    expect(labels).not.toContain('1 before AR')
    expect(labels.slice(1, 3)).toEqual(['20 AR', '40 AR'])
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
