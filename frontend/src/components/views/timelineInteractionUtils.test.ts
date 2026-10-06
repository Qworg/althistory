import { describe, it, expect } from 'vitest'
import {
  isWithinBounds,
  findContainingArcs,
  findExcludedContainingArcs,
  findExcludedContainedEvents,
} from './timelineInteractionUtils'
import type { Arc, Event } from '@/types'

const arc = (overrides: Partial<Arc> = {}): Arc => ({
  id: 'a1',
  name: 'Norman Conquest',
  description: 'William takes England',
  start_time: '1066-09-01T00:00:00.000Z',
  end_time: '1067-01-01T00:00:00.000Z',
  level: 0,
  parent_arc_id: null,
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:00:00.000Z',
  ...overrides,
})

const event = (overrides: Partial<Event> = {}): Event => ({
  id: 'e1',
  description: 'Battle of Hastings',
  actor: 'William',
  target: 'Harold',
  timestamp: '1066-10-14T09:00:00.000Z',
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:00:00.000Z',
  ...overrides,
})

describe('isWithinBounds', () => {
  it('is inclusive at both edges', () => {
    expect(isWithinBounds('1066-09-01T00:00:00.000Z', '1066-09-01T00:00:00.000Z', '1067-01-01T00:00:00.000Z')).toBe(true)
    expect(isWithinBounds('1067-01-01T00:00:00.000Z', '1066-09-01T00:00:00.000Z', '1067-01-01T00:00:00.000Z')).toBe(true)
  })

  it('rejects timestamps outside the window', () => {
    expect(isWithinBounds('1065-12-31T23:59:00.000Z', '1066-09-01T00:00:00.000Z', '1067-01-01T00:00:00.000Z')).toBe(false)
    expect(isWithinBounds('1067-01-01T00:00:01.000Z', '1066-09-01T00:00:00.000Z', '1067-01-01T00:00:00.000Z')).toBe(false)
  })
})

describe('findContainingArcs', () => {
  const inside = event()
  const outside = event({ id: 'e2', timestamp: '1064-01-10T08:00:00.000Z' })

  it('returns the arcs whose window contains the event', () => {
    expect(findContainingArcs(inside, [arc()]).map((a) => a.id)).toEqual(['a1'])
  })

  it('returns nothing when the event is outside every arc', () => {
    expect(findContainingArcs(outside, [arc()])).toEqual([])
  })
})

describe('findExcludedContainingArcs', () => {
  it('flags an arc when the new timestamp leaves its window', () => {
    const excluded = findExcludedContainingArcs(
      event(),
      new Date('1068-01-01T00:00:00.000Z'),
      [arc()]
    )
    expect(excluded.map((a) => a.name)).toEqual(['Norman Conquest'])
  })

  it('returns empty when the new timestamp stays inside the arc', () => {
    expect(
      findExcludedContainingArcs(event(), new Date('1066-11-01T00:00:00.000Z'), [arc()])
    ).toEqual([])
  })

  it('does not constrain events that are outside every arc', () => {
    const outside = event({ timestamp: '1064-01-10T08:00:00.000Z' })
    expect(
      findExcludedContainingArcs(outside, new Date('1200-01-01T00:00:00.000Z'), [arc()])
    ).toEqual([])
  })
})

describe('findExcludedContainedEvents', () => {
  const e1 = event()
  const e2 = event({ id: 'e2', timestamp: '1066-12-25T12:00:00.000Z' })
  const outside = event({ id: 'e3', timestamp: '1064-01-10T08:00:00.000Z' })

  it('returns the contained events a shrink would exclude', () => {
    const excluded = findExcludedContainedEvents(
      arc(),
      { start: new Date('1066-12-26T00:00:00.000Z'), end: new Date('1067-01-01T00:00:00.000Z') },
      [e1, e2, outside]
    )
    expect(excluded.map((e) => e.id).sort()).toEqual(['e1', 'e2'])
  })

  it('returns empty when the new bounds still contain every contained event', () => {
    expect(
      findExcludedContainedEvents(
        arc(),
        { start: new Date('1066-09-01T00:00:00.000Z'), end: new Date('1067-06-01T00:00:00.000Z') },
        [e1, e2, outside]
      )
    ).toEqual([])
  })
})
