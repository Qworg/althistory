import { describe, it, expect } from 'vitest'
import {
  filterEvents,
  filterArcs,
  filterCausalRelationships,
  hasActiveFilters,
  toPanelFilters,
  fromPanelFilters,
  filtersEqual
} from './filterUtils'
import type { FilterState } from '@/types'
import type { Event, Arc, CausalRelationship } from '@/types'

const baseFilters: FilterState = {
  dateRange: null,
  actors: [],
  targets: [],
  eventTypes: [],
  arcLevels: [],
  causalWeightRange: [0, 1],
  confidenceThreshold: 0,
  searchQuery: ''
}

const events: Event[] = [
  {
    id: 'e1',
    description: 'Battle of Hastings',
    actor: 'William',
    target: 'Harold',
    timestamp: '1066-10-14T09:00:00.000Z',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z'
  },
  {
    id: 'e2',
    description: 'Coronation ceremony',
    actor: 'William',
    target: 'Church',
    timestamp: '1066-12-25T12:00:00.000Z',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z'
  },
  {
    id: 'e3',
    description: 'Harold sworn oath',
    actor: 'Harold',
    target: 'William',
    timestamp: '1064-01-10T08:00:00.000Z',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z'
  }
]

const arcs: Arc[] = [
  {
    id: 'a1',
    name: 'Norman Conquest',
    description: 'William takes England',
    start_time: '1066-09-01T00:00:00.000Z',
    end_time: '1067-01-01T00:00:00.000Z',
    level: 0,
    parent_arc_id: null,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z'
  },
  {
    id: 'a2',
    name: 'Succession Crisis',
    description: 'Contest for the throne',
    start_time: '1064-01-01T00:00:00.000Z',
    end_time: '1065-01-01T00:00:00.000Z',
    level: 1,
    parent_arc_id: 'a1',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z'
  }
]

const relationships: CausalRelationship[] = [
  {
    id: 'r1',
    cause_event_id: 'e3',
    effect_event_id: 'e1',
    weight: 0.8,
    evidence: 'Oath broken',
    confidence: 0.9,
    relationship_type: 'direct',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z'
  },
  {
    id: 'r2',
    cause_event_id: 'e1',
    effect_event_id: 'e2',
    weight: 0.2,
    evidence: 'Weak link',
    confidence: 0.3,
    relationship_type: 'contributory',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z'
  }
]

describe('filterEvents', () => {
  it('returns every event when no filter is active', () => {
    expect(filterEvents(events, baseFilters)).toHaveLength(3)
  })

  it('narrows by search query across description, actor and target', () => {
    expect(filterEvents(events, { ...baseFilters, searchQuery: 'battle' }).map(e => e.id)).toEqual(['e1'])
    expect(filterEvents(events, { ...baseFilters, searchQuery: 'harold' }).map(e => e.id)).toEqual(['e1', 'e3'])
  })

  it('narrows by actor and target', () => {
    expect(filterEvents(events, { ...baseFilters, actors: ['Harold'] }).map(e => e.id)).toEqual(['e3'])
    expect(filterEvents(events, { ...baseFilters, targets: ['Church'] }).map(e => e.id)).toEqual(['e2'])
  })

  it('narrows by an inclusive date range', () => {
    const filtered = filterEvents(events, {
      ...baseFilters,
      dateRange: {
        start: new Date('1066-01-01T00:00:00.000Z'),
        end: new Date('1066-12-31T23:59:59.999Z')
      }
    })
    expect(filtered.map(e => e.id)).toEqual(['e1', 'e2'])
  })

  it('treats an empty date bound as open', () => {
    const filtered = filterEvents(events, {
      ...baseFilters,
      dateRange: { start: new Date('1066-01-01T00:00:00.000Z'), end: new Date('') }
    })
    expect(filtered.map(e => e.id)).toEqual(['e1', 'e2'])
  })
})

describe('filterArcs', () => {
  it('narrows by arc level', () => {
    expect(filterArcs(arcs, { ...baseFilters, arcLevels: [1] }).map(a => a.id)).toEqual(['a2'])
  })

  it('keeps arcs overlapping the date range', () => {
    const filtered = filterArcs(arcs, {
      ...baseFilters,
      dateRange: {
        start: new Date('1066-10-01T00:00:00.000Z'),
        end: new Date('1066-11-01T00:00:00.000Z')
      }
    })
    expect(filtered.map(a => a.id)).toEqual(['a1'])
  })

  it('narrows by search query', () => {
    expect(filterArcs(arcs, { ...baseFilters, searchQuery: 'crisis' }).map(a => a.id)).toEqual(['a2'])
  })
})

describe('filterCausalRelationships', () => {
  it('narrows by weight range', () => {
    expect(
      filterCausalRelationships(relationships, { ...baseFilters, causalWeightRange: [0.5, 1] }).map(r => r.id)
    ).toEqual(['r1'])
  })

  it('narrows by confidence threshold', () => {
    expect(
      filterCausalRelationships(relationships, { ...baseFilters, confidenceThreshold: 0.5 }).map(r => r.id)
    ).toEqual(['r1'])
  })
})

describe('hasActiveFilters', () => {
  it('is false for the default filters', () => {
    expect(hasActiveFilters(baseFilters)).toBe(false)
  })

  it('is true for each filter dimension', () => {
    expect(hasActiveFilters({ ...baseFilters, searchQuery: 'x' })).toBe(true)
    expect(hasActiveFilters({ ...baseFilters, actors: ['x'] })).toBe(true)
    expect(hasActiveFilters({ ...baseFilters, causalWeightRange: [0.2, 1] })).toBe(true)
    expect(hasActiveFilters({ ...baseFilters, confidenceThreshold: 0.4 })).toBe(true)
  })
})

describe('panel filter adapters', () => {
  it('round-trips through the string-bounded panel shape', () => {
    const store: FilterState = {
      ...baseFilters,
      dateRange: {
        start: new Date('2020-01-02T00:00:00.000Z'),
        end: new Date('2020-03-04T00:00:00.000Z')
      },
      searchQuery: 'oath'
    }
    const panel = toPanelFilters(store)
    expect(panel.dateRange).toEqual({ start: '2020-01-02', end: '2020-03-04' })
    expect(fromPanelFilters(panel).searchQuery).toBe('oath')
  })

  it('compares store filters by value', () => {
    expect(filtersEqual(baseFilters, { ...baseFilters })).toBe(true)
    expect(filtersEqual(baseFilters, { ...baseFilters, actors: ['a'] })).toBe(false)
  })
})
