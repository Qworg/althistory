import { afterEach, describe, expect, it } from 'vitest'
import { axisTicks, formatTimeAxisTicks } from './d3Calculations'
import { formatEventDate } from './historicalTime'
import { useWorldCalendarStore } from '@/stores/worldCalendarStore'
import { AR, VAEL, vael } from '@/test/fixtures/worldCalendars'

afterEach(() => useWorldCalendarStore.getState().setCalendar(null))

const domain = (start: Date, end: Date): [Date, Date] => [start, end]

describe('the time axis in a world calendar', () => {
  it("puts ticks on the world's round years, labelled as its dates are", () => {
    const ticks = axisTicks(domain(vael(300, 0, 1), vael(360, 0, 1)), 6, VAEL)
    // As many round steps as the room allows: every 20 years.
    expect(ticks.map((tick) => tick.label)).toEqual(['300 AR', '320 AR', '340 AR', '360 AR'])
    // Each tick is the first moment of the year it names, as an event on it is labelled.
    for (const tick of ticks) {
      expect(formatEventDate({ timestamp: tick.date.toISOString(), metadata: { datePrecision: 'year' } }, 'en-US', VAEL)).toBe(tick.label)
    }
  })

  it('names its own months, festivals and hours when zoomed in', () => {
    const months = axisTicks(domain(vael(312, 0, 1), vael(313, 0, 1)), 8, VAEL).map((tick) => tick.label)
    expect(months).toEqual([
      'Lowtide 312 AR',
      'Thaw 312 AR',
      'Brightwater 312 AR',
      "Midyear's Day 312 AR",
      'Panfire 312 AR',
      'Ebb 312 AR',
      'Longnight 312 AR',
      'Lowtide 313 AR',
    ])
    // A day of 20 hours, a tick every six of them.
    const hours = axisTicks(domain(vael(312, 2, 4), vael(312, 2, 5)), 6, VAEL).map((tick) => tick.label)
    expect(hours).toEqual(['Thaw 4, 312 AR', '06:00', '12:00', '18:00', 'Thaw 5, 312 AR'])
  })

  it('counts years before the first era back', () => {
    const labels = axisTicks(domain(vael(-30, 0, 1), vael(30, 0, 1)), 6, VAEL).map((tick) => tick.label)
    expect(labels).toEqual(['30 before AR', '20 before AR', '10 before AR', '10 AR', '20 AR', '30 AR'])
    // With room for it, the era's first year too (there is no year 0).
    expect(axisTicks(domain(vael(-30, 0, 1), vael(30, 0, 1)), 8, VAEL).map((tick) => tick.label)).toContain('1 AR')
  })

  it('reads the open graph’s calendar (and the one the viewer picked) when none is passed', () => {
    const range = domain(vael(300, 0, 1), vael(360, 0, 1))
    useWorldCalendarStore.getState().setCalendar(VAEL)
    expect(axisTicks(range, 6).every((tick) => / AR$/.test(tick.label))).toBe(true)
    useWorldCalendarStore.getState().showCalendar('tide')
    expect(axisTicks(range, 6).every((tick) => / TC$/.test(tick.label) || !/\d+ AR/.test(tick.label))).toBe(true)
  })

  it('agrees with the event labels in a relabelled Gregorian calendar', () => {
    const ticks = axisTicks(domain(new Date('1309-01-01T00:00:00Z'), new Date('1313-06-01T00:00:00Z')), 5, AR)
    const tick = ticks.find((candidate) => candidate.label === '312 AR')
    expect(tick?.date.toISOString()).toBe('1311-01-01T00:00:00.000Z')
  })
})

describe('the time axis without a world calendar', () => {
  it('is the UTC axis it always was', () => {
    const range = domain(new Date('1835-01-01T00:00:00Z'), new Date('1880-01-01T00:00:00Z'))
    const ticks = axisTicks(range, 5, null)
    expect(ticks.map((tick) => tick.label)).toEqual(formatTimeAxisTicks(ticks.map((tick) => tick.date), +range[1] - +range[0], true))
    expect(ticks.map((tick) => tick.label)).toEqual(['1840s', '1850s', '1860s', '1870s', '1880s'])
  })
})
