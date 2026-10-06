import { describe, it, expect } from 'vitest'
import type { Event, TimeRange } from '@/types'
import {
  WINDOW_OVERSCAN_FRACTION,
  computeTimeWindow,
  filterArcsInWindow,
  filterEventsInWindow,
  isArcInWindow,
  isEventInWindow
} from './timelineVirtualization'

const event = (id: string, timestamp: string): Event => ({
  id,
  description: `Event ${id}`,
  actor: 'Actor',
  target: 'Target',
  timestamp,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z'
})

const range = (start: string, end: string): TimeRange => ({
  start: new Date(start),
  end: new Date(end)
})

describe('computeTimeWindow', () => {
  it('extends the visible range by the overscan fraction on both edges', () => {
    const window = computeTimeWindow(
      range('2024-01-02T00:00:00Z', '2024-01-04T00:00:00Z'),
      0.5
    )
    // Two days of span, so one day of overscan either side.
    expect(window.start.toISOString()).toBe('2024-01-01T00:00:00.000Z')
    expect(window.end.toISOString()).toBe('2024-01-05T00:00:00.000Z')
  })

  it('uses the documented default overscan fraction', () => {
    const window = computeTimeWindow(range('2024-01-02T00:00:00Z', '2024-01-03T00:00:00Z'))
    const overscanMs = new Date('2024-01-02T00:00:00Z').getTime() -
      new Date('2024-01-01T12:00:00Z').getTime()
    expect(WINDOW_OVERSCAN_FRACTION).toBe(0.5)
    expect(new Date('2024-01-02T00:00:00Z').getTime() - window.start.getTime()).toBe(overscanMs)
  })

  it('does not invert a zero-span range', () => {
    const window = computeTimeWindow(range('2024-01-02T00:00:00Z', '2024-01-02T00:00:00Z'), 0.5)
    expect(window.start.getTime()).toBe(window.end.getTime())
  })

  it('leaves a range with unparseable bounds unchanged', () => {
    const broken: TimeRange = { start: new Date('nonsense'), end: new Date('nonsense') }
    const window = computeTimeWindow(broken, 0.5)
    expect(window.start.getTime()).toBeNaN()
    expect(window.end.getTime()).toBeNaN()
  })
})

describe('isEventInWindow / filterEventsInWindow', () => {
  const window = computeTimeWindow(range('2024-01-02T00:00:00Z', '2024-01-03T00:00:00Z'), 0.5)
  // Window is 2024-01-01T12:00 .. 2024-01-03T12:00.

  it('keeps events inside the window including the exact edges', () => {
    expect(isEventInWindow(event('a', '2024-01-02T00:00:00Z'), window)).toBe(true)
    expect(isEventInWindow(event('b', '2024-01-01T12:00:00Z'), window)).toBe(true)
    expect(isEventInWindow(event('c', '2024-01-03T12:00:00Z'), window)).toBe(true)
  })

  it('drops events outside the window', () => {
    expect(isEventInWindow(event('a', '2024-01-01T11:59:59Z'), window)).toBe(false)
    expect(isEventInWindow(event('b', '2024-01-03T12:00:01Z'), window)).toBe(false)
  })

  it('keeps an event whose timestamp cannot be parsed', () => {
    expect(isEventInWindow(event('bad', 'not-a-date'), window)).toBe(true)
  })

  it('renders only the events in view regardless of how many lie outside', () => {
    const inView = [event('in-1', '2024-01-02T06:00:00Z'), event('in-2', '2024-01-02T18:00:00Z')]
    const outside = Array.from({ length: 5000 }, (_, i) =>
      event(`out-${i}`, new Date(Date.UTC(2022, 0, 1) + i * 3_600_000).toISOString())
    )
    expect(filterEventsInWindow([...outside, ...inView], window)).toHaveLength(inView.length)
  })
})

describe('isArcInWindow / filterArcsInWindow', () => {
  const window = computeTimeWindow(range('2024-01-02T00:00:00Z', '2024-01-03T00:00:00Z'), 0.5)

  it('keeps an arc that overlaps the window even without being contained', () => {
    expect(
      isArcInWindow(
        { start_time: '2023-12-01T00:00:00Z', end_time: '2024-02-01T00:00:00Z' },
        window
      )
    ).toBe(true)
  })

  it('drops an arc fully before or after the window', () => {
    expect(
      isArcInWindow({ start_time: '2023-11-01T00:00:00Z', end_time: '2023-12-01T00:00:00Z' }, window)
    ).toBe(false)
    expect(
      isArcInWindow({ start_time: '2024-02-01T00:00:00Z', end_time: '2024-03-01T00:00:00Z' }, window)
    ).toBe(false)
  })

  it('treats touching edges as overlapping', () => {
    expect(
      isArcInWindow({ start_time: '2024-01-03T12:00:00Z', end_time: '2024-01-04T00:00:00Z' }, window)
    ).toBe(true)
  })

  it('keeps an arc whose bounds cannot be parsed', () => {
    expect(isArcInWindow({ start_time: 'nonsense', end_time: 'nonsense' }, window)).toBe(true)
  })

  it('filters to the arcs in view regardless of dataset size', () => {
    const inView = [
      { id: 'a', start_time: '2024-01-01T00:00:00Z', end_time: '2024-01-05T00:00:00Z' },
      { id: 'b', start_time: '2024-01-02T12:00:00Z', end_time: '2024-01-02T13:00:00Z' }
    ]
    const outside = Array.from({ length: 3000 }, (_, i) => ({
      id: `o-${i}`,
      start_time: new Date(Date.UTC(2020, 0, 1) + i * 60_000).toISOString(),
      end_time: new Date(Date.UTC(2020, 0, 1) + i * 60_000 + 3_600_000).toISOString()
    }))
    expect(filterArcsInWindow([...outside, ...inView], window)).toHaveLength(inView.length)
  })
})
