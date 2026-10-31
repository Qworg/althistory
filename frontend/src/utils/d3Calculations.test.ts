import { describe, it, expect } from 'vitest'
import * as d3 from 'd3'
import {
  createTimeScale,
  calculateTimeDomain,
  calculateEventPositions,
  calculateArcPositions,
  createArcYScale,
  pixelToTimestamp,
  calculateInnerDimensions,
  formatDuration,
  getTimeAxisFormat,
  formatTimeAxisTick,
  formatTimeAxisTicks,
  getTimeAxisInterval
} from './d3Calculations'
import { Event, Arc } from '@/types'
import { ArcWithUIState } from '@/components/timeline/arcHierarchyUtils'

/**
 * `noUncheckedIndexedAccess` makes every indexed read `T | undefined`. These
 * assertions are about elements the function under test is expected to have
 * produced, so an absent element is a real failure and should be reported as
 * one rather than silently yielding `undefined` to the expectation.
 */
const expectDefined = <T,>(value: T | undefined, message: string): T => {
  if (value === undefined) throw new Error(message)
  return value
}

describe('d3Calculations', () => {
  describe('createTimeScale', () => {
    it('creates a time scale with the given domain and range', () => {
      const domain: [Date, Date] = [new Date('2024-01-01'), new Date('2024-02-01')]
      const range: [number, number] = [0, 1000]

      const scale = createTimeScale(domain, range)

      expect(scale).toBeDefined()
      expect(typeof scale).toBe('function')
    })

    it('maps dates to pixel positions within range', () => {
      const domain: [Date, Date] = [new Date('2024-01-01'), new Date('2024-02-01')]
      const range: [number, number] = [0, 1000]

      const scale = createTimeScale(domain, range)

      // Domain start should map near range start (nice() may adjust slightly)
      const startPos = scale(new Date('2024-01-01'))
      expect(startPos).toBeGreaterThanOrEqual(-50)
      expect(startPos).toBeLessThan(100)

      // Domain end should map near range end
      const endPos = scale(new Date('2024-02-01'))
      expect(endPos).toBeGreaterThan(900)
      expect(endPos).toBeLessThanOrEqual(1050)
    })

    it('applies nice() for cleaner tick values', () => {
      const domain: [Date, Date] = [
        new Date('2024-01-15T10:30:00'),
        new Date('2024-01-20T14:45:00')
      ]
      const range: [number, number] = [0, 500]

      const scale = createTimeScale(domain, range)

      // nice() should extend domain to cleaner boundaries.
      // Asserted against the *input* domain rather than `new Date('2024-01-15')`:
      // a bare date parses as UTC midnight, which is a different instant from
      // local midnight everywhere west of UTC, so the literal comparison only
      // held in UTC and east of it.
      const [niceStart, niceEnd] = scale.domain()
      const start = expectDefined(niceStart, 'expected a start bound on the nice domain')
      const end = expectDefined(niceEnd, 'expected an end bound on the nice domain')
      expect(start.getTime()).toBeLessThanOrEqual(domain[0].getTime())
      expect(end.getTime()).toBeGreaterThanOrEqual(domain[1].getTime())
      // ...and it really did widen the domain in both directions
      expect(start.getTime()).toBeLessThan(domain[0].getTime())
      expect(end.getTime()).toBeGreaterThan(domain[1].getTime())
    })
  })

  describe('calculateTimeDomain', () => {
    const mockEvents: Event[] = [
      {
        id: '1',
        description: 'Event 1',
        actor: 'Actor',
        target: 'Target',
        timestamp: '2024-01-15T10:00:00Z',
        created_at: '2024-01-15T09:00:00Z',
        updated_at: '2024-01-15T09:00:00Z'
      },
      {
        id: '2',
        description: 'Event 2',
        actor: 'Actor',
        target: 'Target',
        timestamp: '2024-01-20T14:00:00Z',
        created_at: '2024-01-20T13:00:00Z',
        updated_at: '2024-01-20T13:00:00Z'
      }
    ]

    const mockArcs: Arc[] = [
      {
        id: 'arc1',
        name: 'Arc 1',
        description: 'Test arc',
        start_time: '2024-01-01T00:00:00Z',
        end_time: '2024-01-31T00:00:00Z',
        level: 0,
        parent_arc_id: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
      }
    ]

    it('calculates domain from events only', () => {
      const [start, end] = calculateTimeDomain(mockEvents, [])

      expect(start.getTime()).toBe(new Date('2024-01-15T10:00:00Z').getTime())
      expect(end.getTime()).toBe(new Date('2024-01-20T14:00:00Z').getTime())
    })

    it('calculates domain from arcs only', () => {
      const [start, end] = calculateTimeDomain([], mockArcs)

      expect(start.getTime()).toBe(new Date('2024-01-01T00:00:00Z').getTime())
      expect(end.getTime()).toBe(new Date('2024-01-31T00:00:00Z').getTime())
    })

    it('combines events and arcs for domain', () => {
      const [start, end] = calculateTimeDomain(mockEvents, mockArcs)

      // Should use arc boundaries (wider than events)
      expect(start.getTime()).toBe(new Date('2024-01-01T00:00:00Z').getTime())
      expect(end.getTime()).toBe(new Date('2024-01-31T00:00:00Z').getTime())
    })

    it('returns default 60-day range for empty data', () => {
      const [start, end] = calculateTimeDomain([], [])

      const now = Date.now()
      const thirtyDays = 1000 * 60 * 60 * 24 * 30

      expect(start.getTime()).toBeCloseTo(now - thirtyDays, -4) // Within 10 seconds
      expect(end.getTime()).toBeCloseTo(now + thirtyDays, -4)
    })
  })

  describe('calculateEventPositions', () => {
    const mockEvents: Event[] = [
      {
        id: '1',
        description: 'Event 1',
        actor: 'Actor',
        target: 'Target',
        timestamp: '2024-01-15T00:00:00Z',
        created_at: '2024-01-15T00:00:00Z',
        updated_at: '2024-01-15T00:00:00Z'
      },
      {
        id: '2',
        description: 'Event 2',
        actor: 'Actor',
        target: 'Target',
        timestamp: '2024-01-17T00:00:00Z',
        created_at: '2024-01-17T00:00:00Z',
        updated_at: '2024-01-17T00:00:00Z'
      }
    ]

    it('calculates positions for events', () => {
      const xScale = d3.scaleTime()
        .domain([new Date('2024-01-01'), new Date('2024-02-01')])
        .range([0, 1000])

      const positions = calculateEventPositions(mockEvents, xScale, 200)

      expect(positions).toHaveLength(2)
      const first = expectDefined(positions[0], 'expected a position for event 1')
      expect(first.id).toBe('1')
      expect(first.y).toBe(200)
      expect(first.event).toBe(mockEvents[0])
      expect(typeof first.x).toBe('number')
    })

    it('returns empty array for no events', () => {
      const xScale = d3.scaleTime()
        .domain([new Date('2024-01-01'), new Date('2024-02-01')])
        .range([0, 1000])

      const positions = calculateEventPositions([], xScale, 200)

      expect(positions).toHaveLength(0)
    })

    it('preserves event references', () => {
      const xScale = d3.scaleTime()
        .domain([new Date('2024-01-01'), new Date('2024-02-01')])
        .range([0, 1000])

      const positions = calculateEventPositions(mockEvents, xScale, 200)

      expect(expectDefined(positions[0], 'expected a position for event 1').event).toBe(mockEvents[0])
      expect(expectDefined(positions[1], 'expected a position for event 2').event).toBe(mockEvents[1])
    })
  })

  describe('calculateArcPositions', () => {
    const mockArcs: ArcWithUIState[] = [
      {
        id: 'arc1',
        name: 'Arc 1',
        description: 'Test arc',
        start_time: '2024-01-10T00:00:00Z',
        end_time: '2024-01-20T00:00:00Z',
        level: 0,
        parent_arc_id: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        isExpanded: false,
        isSelected: false,
        renderLevel: 0,
        containedEvents: [],
        childArcs: [],
        parentArc: null,
        eventCount: 0,
        duration: 0
      },
      {
        id: 'arc2',
        name: 'Arc 2',
        description: 'Test arc 2',
        start_time: '2024-01-15T00:00:00Z',
        end_time: '2024-01-25T00:00:00Z',
        level: 0,
        parent_arc_id: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        isExpanded: false,
        isSelected: false,
        renderLevel: 1,
        containedEvents: [],
        childArcs: [],
        parentArc: null,
        eventCount: 0,
        duration: 0
      }
    ]

    it('calculates positions for arcs', () => {
      const xScale = d3.scaleTime()
        .domain([new Date('2024-01-01'), new Date('2024-02-01')])
        .range([0, 1000])
      const yScale = (level: number) => 10 + level * 30

      const positions = calculateArcPositions(mockArcs, xScale, yScale)

      expect(positions).toHaveLength(2)
      expect(expectDefined(positions[0], 'expected a position for arc1').id).toBe('arc1')
      expect(expectDefined(positions[0], 'expected a position for arc1').y).toBe(10) // Level 0
      expect(expectDefined(positions[1], 'expected a position for arc2').y).toBe(40) // Level 1
    })

    it('calculates correct widths', () => {
      const xScale = d3.scaleTime()
        .domain([new Date('2024-01-01'), new Date('2024-02-01')])
        .range([0, 1000])
      const yScale = (level: number) => 10 + level * 30

      const positions = calculateArcPositions(mockArcs, xScale, yScale)

      expect(expectDefined(positions[0], 'expected a position for arc1').width).toBeGreaterThan(0)
      expect(expectDefined(positions[1], 'expected a position for arc2').width).toBeGreaterThan(0)
    })

    it('returns empty array for no arcs', () => {
      const xScale = d3.scaleTime()
        .domain([new Date('2024-01-01'), new Date('2024-02-01')])
        .range([0, 1000])
      const yScale = (level: number) => 10 + level * 30

      const positions = calculateArcPositions([], xScale, yScale)

      expect(positions).toHaveLength(0)
    })
  })

  describe('createArcYScale', () => {
    it('creates a y-scale function with default values', () => {
      const yScale = createArcYScale()

      expect(yScale(0)).toBe(10) // startY
      expect(yScale(1)).toBe(38) // 10 + 28
      expect(yScale(2)).toBe(66) // 10 + 56
    })

    it('respects custom levelHeight and startY', () => {
      const yScale = createArcYScale(20, 5)

      expect(yScale(0)).toBe(5)
      expect(yScale(1)).toBe(25) // 5 + 20
      expect(yScale(2)).toBe(45) // 5 + 40
    })
  })

  describe('pixelToTimestamp', () => {
    it('converts pixel position to timestamp', () => {
      const xScale = d3.scaleTime()
        .domain([new Date('2024-01-01'), new Date('2024-02-01')])
        .range([0, 1000])

      const timestamp = pixelToTimestamp(556, xScale, 56, 944)

      expect(timestamp).toBeInstanceOf(Date)
      // 500 pixels into a 1000px range should be mid-January
      expect(timestamp.getMonth()).toBe(0) // January
    })

    it('clamps to minimum position', () => {
      const xScale = d3.scaleTime()
        .domain([new Date('2024-01-01'), new Date('2024-02-01')])
        .range([0, 1000])

      const timestamp = pixelToTimestamp(-100, xScale, 56, 944)

      // Should clamp to start of domain
      expect(timestamp.getTime()).toBe(xScale.invert(0).getTime())
    })

    it('clamps to maximum position', () => {
      const xScale = d3.scaleTime()
        .domain([new Date('2024-01-01'), new Date('2024-02-01')])
        .range([0, 1000])

      const timestamp = pixelToTimestamp(2000, xScale, 56, 944)

      // Should clamp to innerWidth
      expect(timestamp.getTime()).toBe(xScale.invert(944).getTime())
    })
  })

  describe('calculateInnerDimensions', () => {
    it('calculates inner dimensions correctly', () => {
      const { innerWidth, innerHeight } = calculateInnerDimensions(
        1000,
        500,
        { top: 20, right: 30, bottom: 40, left: 50 }
      )

      expect(innerWidth).toBe(920) // 1000 - 30 - 50
      expect(innerHeight).toBe(440) // 500 - 20 - 40
    })

    it('returns 0 for negative dimensions', () => {
      const { innerWidth, innerHeight } = calculateInnerDimensions(
        50,
        30,
        { top: 20, right: 30, bottom: 40, left: 50 }
      )

      expect(innerWidth).toBe(0) // Would be -30
      expect(innerHeight).toBe(0) // Would be -30
    })
  })

  describe('formatDuration', () => {
    it('formats hours for durations less than a day', () => {
      const start = new Date('2024-01-15T10:00:00')
      const end = new Date('2024-01-15T18:00:00')

      expect(formatDuration(start, end)).toBe('8 hours')
    })

    it('formats days for durations less than a month', () => {
      const start = new Date('2024-01-01')
      const end = new Date('2024-01-15')

      expect(formatDuration(start, end)).toBe('14 days')
    })

    it('formats months for durations less than a year', () => {
      const start = new Date('2024-01-01')
      const end = new Date('2024-04-01')

      expect(formatDuration(start, end)).toBe('3 months')
    })

    it('formats years for durations of a year or more', () => {
      const start = new Date('2022-01-01')
      const end = new Date('2024-06-01')

      expect(formatDuration(start, end)).toBe('2 years')
    })
  })

  describe('getTimeAxisFormat', () => {
    const ONE_HOUR = 60 * 60 * 1000
    const ONE_DAY = 24 * ONE_HOUR
    const ONE_WEEK = 7 * ONE_DAY
    const ONE_MONTH = 30 * ONE_DAY
    const ONE_YEAR = 365 * ONE_DAY

    it('returns HH:MM:SS format within a single day', () => {
      expect(getTimeAxisFormat(12 * ONE_HOUR)).toBe('%H:%M:%S')
      expect(getTimeAxisFormat(ONE_DAY)).toBe('%H:%M:%S')
    })

    it('returns weekday + day format within two weeks', () => {
      expect(getTimeAxisFormat(ONE_DAY + 1)).toBe('%a %d')
      expect(getTimeAxisFormat(ONE_WEEK)).toBe('%a %d')
      expect(getTimeAxisFormat(14 * ONE_DAY)).toBe('%a %d')
    })

    it('returns month + day format within two months', () => {
      expect(getTimeAxisFormat(14 * ONE_DAY + 1)).toBe('%b %d')
      expect(getTimeAxisFormat(ONE_MONTH)).toBe('%b %d')
      expect(getTimeAxisFormat(60 * ONE_DAY)).toBe('%b %d')
    })

    it('returns month + year format within two years', () => {
      expect(getTimeAxisFormat(60 * ONE_DAY + 1)).toBe('%b %Y')
      expect(getTimeAxisFormat(ONE_YEAR)).toBe('%b %Y')
      expect(getTimeAxisFormat(730 * ONE_DAY)).toBe('%b %Y')
    })

    it('returns year format within two decades', () => {
      expect(getTimeAxisFormat(730 * ONE_DAY + 1)).toBe('%Y')
      expect(getTimeAxisFormat(5 * ONE_YEAR)).toBe('%Y')
      expect(getTimeAxisFormat(7300 * ONE_DAY)).toBe('%Y')
    })

    it('returns decade format beyond two decades', () => {
      expect(getTimeAxisFormat(7300 * ONE_DAY + 1)).toBe('decade')
      expect(getTimeAxisFormat(30 * ONE_YEAR)).toBe('decade')
    })
  })

  describe('formatTimeAxisTick', () => {
    const ONE_HOUR = 60 * 60 * 1000
    const ONE_DAY = 24 * ONE_HOUR
    const ONE_YEAR = 365 * ONE_DAY

    it('formats with time for short spans', () => {
      const tick = new Date('2024-01-15T14:30:45')
      const result = formatTimeAxisTick(tick, 12 * ONE_HOUR)
      expect(result).toBe('14:30:45')
    })

    it('formats with weekday for medium spans', () => {
      const tick = new Date('2024-01-15T12:00:00')
      const result = formatTimeAxisTick(tick, 7 * ONE_DAY)
      expect(result).toMatch(/Mon 15/) // Monday Jan 15
    })

    it('formats with month + day for longer spans', () => {
      const tick = new Date('2024-01-15T12:00:00')
      const result = formatTimeAxisTick(tick, 45 * ONE_DAY)
      expect(result).toBe('Jan 15')
    })

    it('formats with month + year for yearly spans', () => {
      const tick = new Date('2024-06-15T12:00:00')
      const result = formatTimeAxisTick(tick, ONE_YEAR)
      expect(result).toBe('Jun 2024')
    })

    it('formats with year only for multi-year spans', () => {
      const tick = new Date('2024-06-15T12:00:00')
      const result = formatTimeAxisTick(tick, 5 * ONE_YEAR)
      expect(result).toBe('2024')
    })

    it('formats as decade for very long spans', () => {
      const tick2020 = new Date('2020-01-01T12:00:00')
      const tick2025 = new Date('2025-01-01T12:00:00')
      const tick1999 = new Date('1999-06-15T12:00:00')
      const longSpan = 30 * ONE_YEAR

      expect(formatTimeAxisTick(tick2020, longSpan)).toBe('2020s')
      expect(formatTimeAxisTick(tick2025, longSpan)).toBe('2020s')
      expect(formatTimeAxisTick(tick1999, longSpan)).toBe('1990s')
    })
  })

  describe('getTimeAxisInterval', () => {
    const ONE_HOUR = 60 * 60 * 1000
    const ONE_DAY = 24 * ONE_HOUR
    const ONE_YEAR = 365 * ONE_DAY

    it('returns hourly interval for sub-day spans', () => {
      const interval = getTimeAxisInterval(12 * ONE_HOUR)
      expect(interval).toBe(d3.timeHour)
    })

    it('returns daily interval for sub-2-week spans', () => {
      const interval = getTimeAxisInterval(7 * ONE_DAY)
      expect(interval).toBe(d3.timeDay)
    })

    it('returns weekly interval for sub-2-month spans', () => {
      const interval = getTimeAxisInterval(45 * ONE_DAY)
      expect(interval).toBe(d3.timeWeek)
    })

    it('returns monthly interval for sub-2-year spans', () => {
      const interval = getTimeAxisInterval(ONE_YEAR)
      expect(interval).toBe(d3.timeMonth)
    })

    it('returns yearly interval for sub-2-decade spans', () => {
      const interval = getTimeAxisInterval(5 * ONE_YEAR)
      expect(interval).toBe(d3.timeYear)
    })

    it('returns decade interval for very long spans', () => {
      const interval = getTimeAxisInterval(30 * ONE_YEAR)
      // Decade intervals are created with d3.timeYear.every(10)
      expect(interval).toBeDefined()
    })
  })
})

describe('formatTimeAxisTicks', () => {
  const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000

  it('falls back to years when count-based ticks step every 5 years over a multi-decade span', () => {
    const scale = d3.scaleTime().domain([new Date(1832, 0, 1), new Date(1871, 0, 1)])
    const ticks = scale.ticks(8)
    const labels = formatTimeAxisTicks(ticks, 39 * YEAR_MS)
    expect(new Set(labels).size).toBe(labels.length)
    expect(labels).toContain('1845')
    expect(labels.some((label) => label.endsWith('s'))).toBe(false)
  })

  it('keeps decade labels when the ticks fall on decades', () => {
    const ticks = [1830, 1840, 1850, 1860].map((year) => new Date(year, 0, 1))
    expect(formatTimeAxisTicks(ticks, 39 * YEAR_MS)).toEqual(['1830s', '1840s', '1850s', '1860s'])
  })

  it('never returns the same label twice', () => {
    const scale = d3.scaleTime().domain([new Date(2020, 0, 1), new Date(2020, 0, 1, 6)])
    const ticks = scale.ticks(10)
    const labels = formatTimeAxisTicks(ticks, 6 * 60 * 60 * 1000)
    expect(new Set(labels).size).toBe(labels.length)
  })
})
