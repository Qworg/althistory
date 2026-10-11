import { describe, it, expect } from 'vitest'
import {
  analyzeEventDivergence,
  analyzeRelationshipDivergence,
  findPointOfDivergence,
  EventComparisonItem,
} from './divergenceAnalysis'
import { Event, CausalRelationship } from '@/types'

describe('divergenceAnalysis', () => {
  const createMockEvent = (id: string, timestamp: string, description: string, actor = 'A', target = 'B'): Event => ({
    id,
    timestamp,
    description,
    actor,
    target,
    created_at: timestamp,
    updated_at: timestamp,
  })

  const createMockRel = (id: string, cause: string, effect: string, weight = 0.8): CausalRelationship => ({
    id,
    cause_event_id: cause,
    effect_event_id: effect,
    weight,
    confidence: 0.9,
    relationship_type: 'direct',
    evidence: 'Direct causality',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  })

  describe('analyzeEventDivergence', () => {
    it('returns empty metrics when both event lists are empty', () => {
      const { items, metrics } = analyzeEventDivergence([], [])
      expect(items).toHaveLength(0)
      expect(metrics.totalBaselineEvents).toBe(0)
      expect(metrics.totalCounterfactualEvents).toBe(0)
      expect(metrics.hasDivergence).toBe(false)
      expect(metrics.pointOfDivergence).toBeNull()
      expect(metrics.divergenceRate).toBe(0)
    })

    it('identifies identical timelines with zero divergence', () => {
      const events = [
        createMockEvent('e1', '1940-05-01T00:00:00Z', 'Chamberlain Resigns'),
        createMockEvent('e2', '1940-05-10T00:00:00Z', 'Churchill Appointed Prime Minister'),
      ]

      const { items, metrics } = analyzeEventDivergence(events, events)
      expect(items).toHaveLength(2)
      expect(items.every(i => i.status === 'shared')).toBe(true)
      expect(metrics.hasDivergence).toBe(false)
      expect(metrics.pointOfDivergence).toBeNull()
      expect(metrics.sharedEventsCount).toBe(2)
      expect(metrics.divergenceRate).toBe(0)
    })

    it('identifies Point of Divergence when a counterfactual event is added', () => {
      const baseline = [
        createMockEvent('e1', '1940-05-01T00:00:00Z', 'Chamberlain Resigns'),
        createMockEvent('e2', '1940-05-10T00:00:00Z', 'Churchill Appointed'),
        createMockEvent('e3', '1940-06-04T00:00:00Z', 'Dunkirk Evacuation Complete'),
      ]

      const counterfactual = [
        createMockEvent('e1', '1940-05-01T00:00:00Z', 'Chamberlain Resigns'),
        createMockEvent('cf_pod', '1940-05-10T12:00:00Z', 'Halifax Appointed Prime Minister'),
        createMockEvent('cf_peace', '1940-05-28T00:00:00Z', 'Italian Mediation Accepted'),
      ]

      const { items, metrics } = analyzeEventDivergence(baseline, counterfactual)

      expect(metrics.hasDivergence).toBe(true)
      expect(metrics.pointOfDivergence).not.toBeNull()
      expect(metrics.pointOfDivergence?.timestamp).toBe('1940-05-10T00:00:00Z') // baseline e2 absent at 1940-05-10
      expect(metrics.divergentEventsCount).toBe(2)
      expect(metrics.baselineOnlyEventsCount).toBe(2)
      expect(metrics.sharedEventsCount).toBe(1)
      expect(items.find(i => i.id === 'cf_pod')?.status).toBe('divergent_added')
    })

    it('identifies modified events and tracks field changes', () => {
      const e1Base = createMockEvent('e1', '1940-05-10T00:00:00Z', 'Churchill Appointed', 'King', 'Churchill')
      const e1Cf = createMockEvent('e1', '1940-05-10T00:00:00Z', 'Halifax Appointed', 'King', 'Halifax')

      const { items, metrics } = analyzeEventDivergence([e1Base], [e1Cf])

      expect(metrics.hasDivergence).toBe(true)
      expect(metrics.modifiedEventsCount).toBe(1)
      expect(metrics.pointOfDivergence?.type).toBe('event_modified')
      const modItem = items[0]
      expect(modItem).toBeDefined()
      if (!modItem) throw new Error('modItem not defined')
      expect(modItem.status).toBe('modified')
      expect(modItem.changes).toEqual(
        expect.arrayContaining([
          { field: 'description', baselineValue: 'Churchill Appointed', counterfactualValue: 'Halifax Appointed' },
          { field: 'target', baselineValue: 'Churchill', counterfactualValue: 'Halifax' },
        ])
      )
    })

    it('correctly calculates pre-divergence and post-divergence event counts', () => {
      const baseline = [
        createMockEvent('e0', '1939-09-01T00:00:00Z', 'Outbreak of War'),
        createMockEvent('e1', '1940-05-01T00:00:00Z', 'Chamberlain Resigns'),
        createMockEvent('e2', '1940-05-10T00:00:00Z', 'Churchill Takes Office'),
      ]

      const counterfactual = [
        createMockEvent('e0', '1939-09-01T00:00:00Z', 'Outbreak of War'),
        createMockEvent('e1', '1940-05-01T00:00:00Z', 'Chamberlain Resigns'),
        createMockEvent('cf1', '1940-05-10T00:00:00Z', 'Halifax Takes Office'),
      ]

      const { metrics } = analyzeEventDivergence(baseline, counterfactual)
      expect(metrics.preDivergenceCount).toBe(2) // e0 and e1 occur before 1940-05-10
      expect(metrics.postDivergenceBaselineCount).toBe(1)
      expect(metrics.postDivergenceCounterfactualCount).toBe(1)
    })
  })

  describe('findPointOfDivergence', () => {
    it('returns null when items list has only shared events', () => {
      const items: EventComparisonItem[] = [
        { id: '1', status: 'shared', timestamp: '2024-01-01T00:00:00Z' },
      ]
      expect(findPointOfDivergence(items)).toBeNull()
    })

    it('selects the earliest timestamp among divergent events', () => {
      const items: EventComparisonItem[] = [
        { id: 'shared', status: 'shared', timestamp: '2020-01-01T00:00:00Z' },
        { id: 'cf_late', status: 'divergent_added', timestamp: '2022-01-01T00:00:00Z' },
        { id: 'cf_early', status: 'divergent_added', timestamp: '2021-06-01T00:00:00Z' },
      ]
      const pod = findPointOfDivergence(items)
      expect(pod?.timestamp).toBe('2021-06-01T00:00:00Z')
      expect(pod?.type).toBe('event_added')
    })
  })

  describe('analyzeRelationshipDivergence', () => {
    it('detects added, removed, and weight-changed causal relationships', () => {
      const rShared = createMockRel('r1', 'e1', 'e2', 0.8)
      const rModifiedBase = createMockRel('r2', 'e2', 'e3', 0.4)
      const rModifiedCf = createMockRel('r2', 'e2', 'e3', 0.9)
      const rRemoved = createMockRel('r3', 'e3', 'e4', 0.5)
      const rAdded = createMockRel('r4', 'e2', 'cf1', 0.7)

      const baseRels = [rShared, rModifiedBase, rRemoved]
      const cfRels = [rShared, rModifiedCf, rAdded]

      const results = analyzeRelationshipDivergence(baseRels, cfRels)

      const sharedResult = results.find(r => r.id === 'r1')
      const modifiedResult = results.find(r => r.id === 'r2')
      const addedResult = results.find(r => r.id === 'r4')
      const removedResult = results.find(r => r.id === 'r3')

      expect(sharedResult?.status).toBe('shared')
      expect(modifiedResult?.status).toBe('weight_changed')
      expect(addedResult?.status).toBe('added')
      expect(removedResult?.status).toBe('removed')
    })
  })
})
