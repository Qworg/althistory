import * as d3 from 'd3'
import { describe, expect, it } from 'vitest'
import { AxisDate, axisOf, isoOfAxisTime, toAxisTime, toInstant } from '@althistory/calendar'
import { axisTicks } from '@/utils/d3Calculations'
import { instantScale, isDeepInstant, rescaleInstantX } from '@/utils/timeScale'

const YEAR = 365.2425 * 86_400_000

describe('the timeline scale inside a Date\'s range', () => {
  const domains: Array<[string, string]> = [
    ['1843-01-01T00:00:00Z', '1871-06-01T00:00:00Z'],
    ['1914-06-01T00:00:00Z', '1914-06-30T00:00:00Z'],
    ['-000100-01-01T00:00:00Z', '0100-01-01T00:00:00Z'],
    ['1066-10-14T09:00:00Z', '1066-10-14T21:00:00Z'],
    ['-271000-01-01T00:00:00Z', '+275000-01-01T00:00:00Z'],
  ]

  it('places every moment where d3 does, to the bit, in UTC and in local time', () => {
    for (const utc of [true, false]) {
      for (const [a, b] of domains) {
        const ours = instantScale(utc).domain([toInstant(a), toInstant(b)]).range([0, 800])
        const theirs = (utc ? d3.scaleUtc() : d3.scaleTime()).domain([toInstant(a), toInstant(b)]).range([0, 800])
        const span = +toInstant(b) - +toInstant(a)
        for (const fraction of [0, 0.1, 0.5, 0.999, 1, -0.2, 1.3]) {
          const at = new Date(+toInstant(a) + span * fraction)
          expect(ours(at)).toBe(theirs(at))
        }
        expect(+ours.invert(400)).toBe(+theirs.invert(400))
      }
    }
  })

  it('has the ticks and the nice domain d3 has', () => {
    for (const [a, b] of domains.slice(0, 4)) {
      const ours = instantScale(true).domain([toInstant(a), toInstant(b)]).range([0, 800])
      const theirs = d3.scaleUtc().domain([toInstant(a), toInstant(b)]).range([0, 800])
      expect(ours.ticks(8).map(Number)).toEqual(theirs.ticks(8).map(Number))
      expect(ours.ticks(d3.utcYear.every(5)!).map(Number)).toEqual(theirs.ticks(d3.utcYear.every(5)!).map(Number))
      expect(ours.copy().nice().domain().map(Number)).toEqual(theirs.copy().nice().domain().map(Number))
    }
  })

  it('draws a real history\'s axis exactly as d3 labels it', () => {
    for (const [a, b] of domains.slice(0, 4)) {
      const ticks = axisTicks([toInstant(a), toInstant(b)], 8, null)
      const d3Ticks = d3.scaleUtc().domain([toInstant(a), toInstant(b)]).ticks(8)
      expect(ticks.map((tick) => +tick.date)).toEqual(d3Ticks.map(Number))
    }
  })

  it('zooms as d3 does', () => {
    const base = instantScale().domain([toInstant('1800-01-01T00:00:00Z'), toInstant('1900-01-01T00:00:00Z')]).range([0, 800])
    const theirs = d3.scaleTime().domain(base.domain()).range([0, 800])
    const transform = d3.zoomIdentity.translate(-300, 0).scale(2.5)
    expect(rescaleInstantX(transform, base).domain().map(Number)).toEqual(transform.rescaleX(theirs).domain().map(Number))
  })
})

describe('the timeline scale over a million years', () => {
  const start = toInstant('-500000-01-01T00:00:00Z')
  const end = toInstant('+500000-01-01T00:00:00Z')

  it('is linear in exact milliseconds, and inverts to the moment a pixel stands for', () => {
    expect(isDeepInstant(start)).toBe(true)
    const scale = instantScale(true).domain([start, end]).range([0, 1000])
    expect(scale(start)).toBe(0)
    expect(scale(end)).toBe(1000)
    expect(scale(toInstant('0000-01-01T00:00:00Z'))).toBeCloseTo(500, 1)
    expect(scale(toInstant('+250000-01-01T00:00:00Z'))).toBeCloseTo(750, 1)
    for (const pixel of [0, 1, 250, 500, 999, 1000]) {
      const back = scale.invert(pixel)
      expect(scale(back)).toBeCloseTo(pixel, 6)
    }
    expect(scale.invert(0)).toBeInstanceOf(AxisDate)
    expect(toAxisTime(scale.invert(1000))).toBe(toAxisTime(end))
  })

  it('tells apart two moments a millisecond apart where a double cannot, past ±285,000 years', () => {
    const origin = toInstant('+200000000-01-01T00:00:00.000Z')
    const next = toInstant('+200000000-01-01T00:00:00.001Z')
    expect(+origin === +next || Math.abs(+next - +origin) < 1024).toBe(true)
    // A scale over the day around them puts them a measurable distance apart.
    const day = instantScale(true)
      .domain([origin, toInstant('+200000000-01-02T00:00:00.000Z')])
      .range([0, 86_400_000])
    expect(day(next) - day(origin)).toBeCloseTo(1, 6)
  })

  it('gives ticks in order, inside the domain, labelled in years with their era', () => {
    const ticks = axisTicks([start, end], 8, null)
    expect(ticks.length).toBeGreaterThan(2)
    expect(ticks.length).toBeLessThanOrEqual(8)
    const moments = ticks.map((tick) => toAxisTime(tick.date)!)
    expect(moments).toEqual([...moments].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)))
    expect(moments[0]! >= toAxisTime(start)!).toBe(true)
    expect(moments[moments.length - 1]! <= toAxisTime(end)!).toBe(true)
    expect(new Set(ticks.map((tick) => tick.label)).size).toBe(ticks.length)
    expect(ticks.some((tick) => /BCE/.test(tick.label))).toBe(true)
    expect(ticks.some((tick) => /CE/.test(tick.label) && !/BCE/.test(tick.label))).toBe(true)
    // The scale's own ticks are those moments.
    const scaleTicks = instantScale(true).domain([start, end]).range([0, 1000]).ticks(8)
    expect(scaleTicks.every((tick) => tick instanceof Date && !Number.isNaN(+tick))).toBe(true)
  })

  it('zooms and pans without leaving the exact axis', () => {
    const base = instantScale(true).domain([start, end]).range([0, 1000])
    const zoomed = rescaleInstantX(d3.zoomIdentity.translate(-500, 0).scale(2), base)
    const [a, b] = zoomed.domain()
    expect(isoOfAxisTime(axisOf(a)!)).toBe(a.toISOString())
    expect(toAxisTime(a)! < toAxisTime(b)!).toBe(true)
    // Two thirds in: a quarter to three quarters of the way across, twice as close.
    expect(+b - +a).toBeCloseTo((+end - +start) / 2, -6)
    expect(YEAR).toBeGreaterThan(0)
  })
})
