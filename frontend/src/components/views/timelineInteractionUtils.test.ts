import { describe, it, expect } from 'vitest'
import {
  isWithinBounds,
  findContainingArcs,
  findExcludedContainingArcs,
  findExcludedContainedEvents,
  findExcludedChildArcs,
  findEscapedParentArc,
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

// parent window '1066-09-01'..'1067-01-01', child window '1066-10-01'..'1066-11-01'
const parent = arc()
const child = arc({
  id: 'a2',
  name: 'Succession Crisis',
  parent_arc_id: 'a1',
  start_time: '1066-10-01T00:00:00.000Z',
  end_time: '1066-11-01T00:00:00.000Z',
})
const unrelated = arc({ id: 'a3', name: 'Unrelated', parent_arc_id: null })

describe('findExcludedChildArcs', () => {
  it('flags a child the shrink would drop outside the parent window', () => {
    const excluded = findExcludedChildArcs(
      parent,
      { start: new Date('1066-11-01T00:00:00.000Z'), end: new Date('1067-01-01T00:00:00.000Z') },
      [parent, child, unrelated]
    )
    expect(excluded.map((a) => a.name)).toEqual(['Succession Crisis'])
  })

  it('returns empty when the new bounds still contain the child', () => {
    expect(
      findExcludedChildArcs(
        parent,
        { start: new Date('1066-09-15T00:00:00.000Z'), end: new Date('1066-12-01T00:00:00.000Z') },
        [parent, child, unrelated]
      )
    ).toEqual([])
  })

  it('does not constrain on children that are already outside the parent', () => {
    const alreadyOutside = arc({
      id: 'a4',
      name: 'Pre-existing outlier',
      parent_arc_id: 'a1',
      start_time: '1060-01-01T00:00:00.000Z',
      end_time: '1060-06-01T00:00:00.000Z',
    })
    expect(
      findExcludedChildArcs(
        parent,
        { start: new Date('1066-10-15T00:00:00.000Z'), end: new Date('1067-01-01T00:00:00.000Z') },
        [parent, alreadyOutside]
      )
    ).toEqual([])
  })
})

describe('findEscapedParentArc', () => {
  it('returns the parent a child resize would escape', () => {
    expect(
      findEscapedParentArc(
        child,
        { start: new Date('1066-08-01T00:00:00.000Z'), end: new Date('1066-11-01T00:00:00.000Z') },
        [parent, child]
      )?.name
    ).toBe('Norman Conquest')
  })

  it('returns null when the resized child stays inside its parent', () => {
    expect(
      findEscapedParentArc(
        child,
        { start: new Date('1066-10-01T00:00:00.000Z'), end: new Date('1066-12-15T00:00:00.000Z') },
        [parent, child]
      )
    ).toBeNull()
  })

  it('returns null for a root arc', () => {
    expect(
      findEscapedParentArc(
        parent,
        { start: new Date('1000-01-01T00:00:00.000Z'), end: new Date('1200-01-01T00:00:00.000Z') },
        [parent]
      )
    ).toBeNull()
  })
})
