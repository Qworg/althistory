import { describe, it, expect } from 'vitest'
import { toInstant } from '@althistory/calendar'
import { buildNavModel, keyboardTimeStep, movedArcBounds, navigate, offsetByStep, parseMarkKey, resizedArcBounds } from './timelineNavigation'

const events = [
  { id: 'b', timestamp: '2024-03-01T00:00:00Z' },
  { id: 'a', timestamp: '2024-01-01T00:00:00Z' },
  { id: 'c', timestamp: '2024-09-01T00:00:00Z' },
]
const arcs = [
  { id: 'top', start_time: '2024-01-01T00:00:00Z', end_time: '2024-12-31T00:00:00Z', renderLevel: 0 },
  { id: 'spring', start_time: '2024-02-15T00:00:00Z', end_time: '2024-04-01T00:00:00Z', renderLevel: 1 },
  { id: 'autumn', start_time: '2024-08-01T00:00:00Z', end_time: '2024-10-01T00:00:00Z', renderLevel: 1 },
]

describe('buildNavModel / navigate', () => {
  const model = buildNavModel(events, arcs)

  it('orders lanes top to bottom (arc rows, then the event track) and each lane by time', () => {
    expect(model.lanes.map(lane => lane.map(item => item.key))).toEqual([
      ['arc:top'],
      ['arc:spring', 'arc:autumn'],
      ['event:a', 'event:b', 'event:c'],
    ])
  })

  it('steps within a lane without wrapping, and jumps to its ends', () => {
    expect(navigate(model, 'event:a', 'next')).toBe('event:b')
    expect(navigate(model, 'event:c', 'next')).toBeNull()
    expect(navigate(model, 'event:a', 'prev')).toBeNull()
    expect(navigate(model, 'event:b', 'last')).toBe('event:c')
    expect(navigate(model, 'arc:autumn', 'first')).toBe('arc:spring')
  })

  it('moves between lanes to the nearest mark in time', () => {
    expect(navigate(model, 'event:c', 'up')).toBe('arc:autumn')
    expect(navigate(model, 'event:b', 'up')).toBe('arc:spring')
    expect(navigate(model, 'arc:spring', 'up')).toBe('arc:top')
    expect(navigate(model, 'arc:top', 'up')).toBeNull()
    expect(navigate(model, 'arc:autumn', 'down')).toBe('event:c')
    expect(navigate(model, 'event:a', 'down')).toBeNull()
  })

  it('aims a vertical move from a long arc at the part of it in view', () => {
    // Unclipped, the arc's midpoint (July) is nearest autumn; with only
    // January to March on screen, the move lands on spring instead.
    expect(navigate(model, 'arc:top', 'down')).toBe('arc:autumn')
    const view = { start: new Date('2024-01-01T00:00:00Z').getTime(), end: new Date('2024-03-01T00:00:00Z').getTime() }
    expect(navigate(model, 'arc:top', 'down', view)).toBe('arc:spring')
  })

  it('ignores unknown keys and parses known ones', () => {
    expect(navigate(model, 'event:nope', 'next')).toBeNull()
    expect(parseMarkKey('arc:x:y')).toEqual({ kind: 'arc', id: 'x:y' })
    expect(parseMarkKey('pressure:1')).toBeNull()
  })
})

describe('keyboardTimeStep / offsetByStep', () => {
  const DAY = 24 * 60 * 60 * 1000

  it('picks a calendar step about 1/40 of the visible span', () => {
    expect(keyboardTimeStep(4 * DAY)).toEqual({ unit: 'hour', count: 1 })
    expect(keyboardTimeStep(365 * DAY)).toEqual({ unit: 'day', count: 7 })
    expect(keyboardTimeStep(200 * 365.25 * DAY)).toEqual({ unit: 'year', count: 5 })
    expect(keyboardTimeStep(1000)).toEqual({ unit: 'minute', count: 1 })
  })

  it('offsets months and years on the calendar, in UTC', () => {
    const start = new Date('1843-03-15T00:00:00Z')
    expect(offsetByStep(start, { unit: 'year', count: 5 }, 1).toISOString()).toBe('1848-03-15T00:00:00.000Z')
    expect(offsetByStep(start, { unit: 'month', count: 1 }, -1).toISOString()).toBe('1843-02-15T00:00:00.000Z')
    expect(offsetByStep(start, { unit: 'day', count: 7 }, 1).toISOString()).toBe('1843-03-22T00:00:00.000Z')
  })
})

describe('keyboard steps in a world calendar', () => {
  // VAEL: fourteen parts in the Reckoning (twelve months, two festivals), Midyear's Day after Highsun, the Drowned Days last; days of 30 hours.
  it("steps by the world's own days, months and years", async () => {
    const { VAEL, vael } = await import('@/test/fixtures/worldCalendars')
    const day = offsetByStep(vael(312, 2, 4, 6), { unit: 'day', count: 1 }, 1, VAEL)
    expect(day.getTime() - vael(312, 2, 4, 6).getTime()).toBe(30 * 3600 * 1000)
    expect(offsetByStep(vael(312, 2, 4, 6), { unit: 'month', count: 1 }, 1, VAEL)).toEqual(vael(312, 3, 4, 6))
    // A month past Highsun 15 is Saltreap 15: Midyear's Day is a festival, not a month.
    expect(offsetByStep(vael(312, 5, 15), { unit: 'month', count: 1 }, 1, VAEL)).toEqual(vael(312, 7, 15))
    expect(offsetByStep(vael(312, 7, 15), { unit: 'month', count: 1 }, -1, VAEL)).toEqual(vael(312, 5, 15))
    // From a festival, the month after it (or before it, going back).
    expect(offsetByStep(vael(312, 6, 1), { unit: 'month', count: 1 }, 1, VAEL)).toEqual(vael(312, 7, 1))
    expect(offsetByStep(vael(312, 6, 1), { unit: 'month', count: 1 }, -1, VAEL)).toEqual(vael(312, 5, 1))
    expect(offsetByStep(vael(312, 13, 2), { unit: 'month', count: 1 }, 1, VAEL)).toEqual(vael(313, 0, 2))
    // Back across the year's start, past the Drowned Days, to Longnight.
    expect(offsetByStep(vael(312, 0, 4), { unit: 'month', count: 1 }, -1, VAEL)).toEqual(vael(311, 12, 4))
    // The Drowned Days' fifth day (a leap year) a year on is its fourth.
    expect(offsetByStep(vael(312, 13, 5), { unit: 'year', count: 1 }, 1, VAEL)).toEqual(vael(313, 13, 4))
    // The step fits the world's units: a world year in view steps by its days.
    expect(keyboardTimeStep(vael(313, 0, 1).getTime() - vael(312, 0, 1).getTime(), VAEL)).toEqual({ unit: 'day', count: 7 })
  })
})

describe('keyboard month steps on the Gregorian calendar', () => {
  it('keep the day, or the month\'s last when it is shorter', () => {
    const step = (iso: string, n: number, unit: 'month' | 'year' = 'month') => offsetByStep(new Date(iso), { unit, count: 1 }, n, null).toISOString()
    expect(step('2023-01-31T12:00:00.000Z', 1)).toBe('2023-02-28T12:00:00.000Z')
    expect(step('2024-03-31T00:00:00.000Z', -1)).toBe('2024-02-29T00:00:00.000Z')
    expect(step('2024-02-29T00:00:00.000Z', 1, 'year')).toBe('2025-02-28T00:00:00.000Z')
    expect(step('0001-01-15T00:00:00.000Z', -1)).toBe('0000-12-15T00:00:00.000Z')
    // At the very start of what a Date holds, the 1st of the month is out of range.
    expect(step('-271821-04-25T00:00:00.000Z', 1)).toBe('-271821-05-25T00:00:00.000Z')
  })
})

describe('movedArcBounds / resizedArcBounds beyond a Date\'s range', () => {
  const day = { unit: 'day', count: 1 } as const

  it.each(['+300000', '+1000000', '+100000000'])(
    'moves an arc ending on the last millisecond of a day (%s) by exactly the start\'s step',
    year => {
      const moved = movedArcBounds(`${year}-01-01T00:00:00.000Z`, `${year}-12-31T23:59:59.999Z`, day, 1, null)
      expect(moved).not.toBeNull()
      const next = String(Number(year) + 1).replace(/^/, '+')
      // The start moved one day; the end moved one day: it still ends on a last millisecond.
      expect(moved!.start.toISOString()).toBe(`${year}-01-02T00:00:00.000Z`)
      expect(moved!.end.toISOString()).toBe(`${next}-01-01T23:59:59.999Z`)
    }
  )

  it('moves a real-history arc as before', () => {
    const moved = movedArcBounds('1066-09-01T00:00:00.000Z', '1067-01-01T00:00:00.000Z', day, -1, null)
    expect(moved!.start.toISOString()).toBe('1066-08-31T00:00:00.000Z')
    expect(moved!.end.toISOString()).toBe('1066-12-31T00:00:00.000Z')
  })

  it('compares a resized edge exactly: an end a millisecond before the start is clamped to the start', () => {
    const start = '+300000-01-01T00:00:01.000Z'
    const end = '+300001-01-01T00:00:00.000Z'
    // A double cannot tell these two moments apart (1 ms apart where doubles are 2 ms apart), so getTime() would keep the end.
    const before = toInstant('+300000-01-01T00:00:00.999Z')
    expect(resizedArcBounds(start, end, 'end', before).end.toISOString()).toBe(start)
    const after = toInstant('+300001-01-01T00:00:00.001Z')
    expect(resizedArcBounds(start, end, 'start', after).start.toISOString()).toBe(end)
  })
})
