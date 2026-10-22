import { describe, it, expect } from 'vitest'
import {
  calculateCumulativeStrength,
  calculateStepWeights,
  sortPathsByStrength,
  getStrongestPath,
  transformPathToSteps,
  formatWeightAsPercentage,
  calculatePathConfidence,
  calculatePathWeight,
  getPathStatistics
} from './causalPathCalculations'
import { CausalRelationship, CausalPath, Event } from '@/types'

const createRelationship = (
  weight: number,
  confidence: number,
  overrides: Partial<CausalRelationship> = {}
): CausalRelationship => ({
  id: '1',
  cause_event_id: '1',
  effect_event_id: '2',
  weight,
  confidence,
  evidence: 'test evidence',
  relationship_type: 'direct',
  created_at: '2023-01-01T00:00:00Z',
  updated_at: '2023-01-01T00:00:00Z',
  ...overrides
})

const createEvent = (id: string, overrides: Partial<Event> = {}): Event => ({
  id,
  description: `Event ${id}`,
  actor: `Actor ${id}`,
  target: `Target ${id}`,
  timestamp: '2023-01-01T00:00:00Z',
  created_at: '2023-01-01T00:00:00Z',
  updated_at: '2023-01-01T00:00:00Z',
  ...overrides
})

const createPath = (
  events: Event[],
  relationships: CausalRelationship[]
): CausalPath => ({
  events: events.map((event) => event.id),
  relationships: relationships.map((r) => ({
    weight: r.weight,
    evidence: r.evidence,
    confidence: r.confidence,
    relationship_type: r.relationship_type
  })),
  total_strength: relationships.reduce((acc, r) => acc * r.weight, 1),
  relationship_weights: relationships.map((r) => r.weight),
  depth: relationships.length
})

describe('Causal Path Calculations', () => {
  describe('calculateCumulativeStrength', () => {
    it('returns 0 for empty relationships', () => {
      expect(calculateCumulativeStrength([])).toBe(0)
    })

    it('calculates single relationship strength correctly', () => {
      const relationships = [createRelationship(0.8, 0.9)]
      expect(calculateCumulativeStrength(relationships)).toBeCloseTo(0.72, 2)
    })

    it('calculates chain of relationships correctly', () => {
      const relationships = [
        createRelationship(0.8, 0.9), // 0.72
        createRelationship(0.6, 0.7) // 0.42
      ]
      // 0.72 * 0.42 = 0.3024
      expect(calculateCumulativeStrength(relationships)).toBeCloseTo(0.3024, 4)
    })

    it('handles perfect confidence correctly', () => {
      const relationships = [
        createRelationship(0.5, 1.0),
        createRelationship(0.5, 1.0)
      ]
      expect(calculateCumulativeStrength(relationships)).toBe(0.25)
    })

    it('handles zero weight correctly', () => {
      const relationships = [
        createRelationship(0.8, 0.9),
        createRelationship(0, 0.9)
      ]
      expect(calculateCumulativeStrength(relationships)).toBe(0)
    })

    it('handles zero confidence correctly', () => {
      const relationships = [
        createRelationship(0.8, 0),
        createRelationship(0.6, 0.9)
      ]
      expect(calculateCumulativeStrength(relationships)).toBe(0)
    })
  })

  describe('calculateStepWeights', () => {
    it('returns [1] for empty relationships', () => {
      expect(calculateStepWeights([])).toEqual([1])
    })

    it('calculates step-by-step weights', () => {
      const relationships = [
        createRelationship(0.8, 0.9), // 0.72
        createRelationship(0.5, 1.0) // 0.5
      ]
      const weights = calculateStepWeights(relationships)

      expect(weights).toHaveLength(3)
      expect(weights[0]).toBe(1)
      expect(weights[1]).toBeCloseTo(0.72, 2)
      expect(weights[2]).toBeCloseTo(0.36, 2)
    })

    it('handles single relationship', () => {
      const relationships = [createRelationship(0.6, 0.8)]
      const weights = calculateStepWeights(relationships)

      expect(weights).toHaveLength(2)
      expect(weights[0]).toBe(1)
      expect(weights[1]).toBeCloseTo(0.48, 2)
    })

    it('handles long chain', () => {
      const relationships = [
        createRelationship(0.9, 1.0),
        createRelationship(0.9, 1.0),
        createRelationship(0.9, 1.0)
      ]
      const weights = calculateStepWeights(relationships)

      expect(weights).toHaveLength(4)
      expect(weights[0]).toBe(1)
      expect(weights[1]).toBeCloseTo(0.9, 2)
      expect(weights[2]).toBeCloseTo(0.81, 2)
      expect(weights[3]).toBeCloseTo(0.729, 3)
    })
  })

  describe('sortPathsByStrength', () => {
    it('sorts paths from strongest to weakest', () => {
      const weakPath = createPath([], [createRelationship(0.3, 0.5)])
      const strongPath = createPath([], [createRelationship(0.9, 0.9)])

      const sorted = sortPathsByStrength([weakPath, strongPath])

      expect(sorted[0]).toBe(strongPath)
      expect(sorted[1]).toBe(weakPath)
    })

    it('handles empty array', () => {
      expect(sortPathsByStrength([])).toEqual([])
    })

    it('handles single path', () => {
      const path = createPath([], [createRelationship(0.5, 0.5)])
      const sorted = sortPathsByStrength([path])
      expect(sorted).toHaveLength(1)
      expect(sorted[0]).toBe(path)
    })

    it('does not mutate original array', () => {
      const weakPath = createPath([], [createRelationship(0.3, 0.5)])
      const strongPath = createPath([], [createRelationship(0.9, 0.9)])
      const original = [weakPath, strongPath]

      sortPathsByStrength(original)

      expect(original[0]).toBe(weakPath)
      expect(original[1]).toBe(strongPath)
    })

    it('handles paths with equal strength', () => {
      const path1 = createPath([], [createRelationship(0.5, 0.5)])
      const path2 = createPath([], [createRelationship(0.5, 0.5)])

      const sorted = sortPathsByStrength([path1, path2])
      expect(sorted).toHaveLength(2)
    })
  })

  describe('getStrongestPath', () => {
    it('returns null for empty array', () => {
      expect(getStrongestPath([])).toBeNull()
    })

    it('returns the strongest path', () => {
      const weakPath = createPath([], [createRelationship(0.3, 0.5)])
      const strongPath = createPath([], [createRelationship(0.9, 0.9)])

      expect(getStrongestPath([weakPath, strongPath])).toBe(strongPath)
    })

    it('returns single path when only one exists', () => {
      const path = createPath([], [createRelationship(0.5, 0.5)])
      expect(getStrongestPath([path])).toBe(path)
    })
  })

  describe('transformPathToSteps', () => {
    it('transforms path to navigation steps', () => {
      const events = [createEvent('1'), createEvent('2'), createEvent('3')]
      const relationships = [
        createRelationship(0.8, 0.9, {
          cause_event_id: '1',
          effect_event_id: '2'
        }),
        createRelationship(0.6, 0.7, {
          cause_event_id: '2',
          effect_event_id: '3'
        })
      ]
      const path = createPath(events, relationships)

      const steps = transformPathToSteps(path)

      expect(steps).toHaveLength(3)
      expect(steps[0]!.stepIndex).toBe(0)
      expect(steps[0]!.cumulativeWeight).toBe(1)
      expect(steps[0]!.relationship).toBeUndefined()

      expect(steps[1]!.stepIndex).toBe(1)
      expect(steps[1]!.cumulativeWeight).toBeCloseTo(0.72, 2)
      expect(steps[1]!.relationship).toBeDefined()

      expect(steps[2]!.stepIndex).toBe(2)
      expect(steps[2]!.cumulativeWeight).toBeCloseTo(0.3024, 4)
    })

    it('handles empty path', () => {
      const path = createPath([], [])
      expect(transformPathToSteps(path)).toEqual([])
    })

    it('handles single event path', () => {
      const path = createPath([createEvent('1')], [])
      const steps = transformPathToSteps(path)

      expect(steps).toHaveLength(1)
      expect(steps[0]!.eventId).toBe('1')
      expect(steps[0]!.cumulativeWeight).toBe(1)
      expect(steps[0]!.stepIndex).toBe(0)
      expect(steps[0]!.relationship).toBeUndefined()
    })

    it('preserves event references', () => {
      const event1 = createEvent('1')
      const event2 = createEvent('2')
      const path = createPath([event1, event2], [createRelationship(0.8, 0.9)])

      const steps = transformPathToSteps(path)

      expect(steps[0]!.eventId).toBe(event1.id)
      expect(steps[1]!.eventId).toBe(event2.id)
    })
  })

  describe('formatWeightAsPercentage', () => {
    it('formats weight as percentage string', () => {
      expect(formatWeightAsPercentage(0.72)).toBe('72.0%')
      expect(formatWeightAsPercentage(1)).toBe('100.0%')
      expect(formatWeightAsPercentage(0.3024)).toBe('30.2%')
    })

    it('handles edge cases', () => {
      expect(formatWeightAsPercentage(0)).toBe('0.0%')
      expect(formatWeightAsPercentage(0.001)).toBe('0.1%')
      expect(formatWeightAsPercentage(0.999)).toBe('99.9%')
    })
  })

  describe('calculatePathConfidence', () => {
    it('returns 0 for empty relationships', () => {
      expect(calculatePathConfidence([])).toBe(0)
    })

    it('calculates product of confidences', () => {
      const relationships = [
        createRelationship(0.5, 0.9),
        createRelationship(0.5, 0.8)
      ]
      expect(calculatePathConfidence(relationships)).toBeCloseTo(0.72, 2)
    })

    it('handles single relationship', () => {
      const relationships = [createRelationship(0.5, 0.75)]
      expect(calculatePathConfidence(relationships)).toBe(0.75)
    })
  })

  describe('calculatePathWeight', () => {
    it('returns 0 for empty relationships', () => {
      expect(calculatePathWeight([])).toBe(0)
    })

    it('calculates product of weights', () => {
      const relationships = [
        createRelationship(0.8, 0.5),
        createRelationship(0.5, 0.5)
      ]
      expect(calculatePathWeight(relationships)).toBeCloseTo(0.4, 2)
    })

    it('handles single relationship', () => {
      const relationships = [createRelationship(0.6, 0.5)]
      expect(calculatePathWeight(relationships)).toBe(0.6)
    })
  })

  describe('getPathStatistics', () => {
    it('returns zero statistics for empty path', () => {
      const path = createPath([], [])
      const stats = getPathStatistics(path)

      expect(stats.length).toBe(0)
      expect(stats.totalWeight).toBe(0)
      expect(stats.totalConfidence).toBe(0)
      expect(stats.cumulativeStrength).toBe(0)
      expect(stats.averageWeight).toBe(0)
      expect(stats.averageConfidence).toBe(0)
    })

    it('calculates statistics for path', () => {
      const relationships = [
        createRelationship(0.8, 0.9),
        createRelationship(0.6, 0.8)
      ]
      const path = createPath([createEvent('1'), createEvent('2'), createEvent('3')], relationships)

      const stats = getPathStatistics(path)

      expect(stats.length).toBe(2)
      expect(stats.totalWeight).toBeCloseTo(0.48, 2)
      expect(stats.totalConfidence).toBeCloseTo(0.72, 2)
      expect(stats.cumulativeStrength).toBeCloseTo(0.3456, 4)
      expect(stats.averageWeight).toBeCloseTo(0.7, 2)
      expect(stats.averageConfidence).toBeCloseTo(0.85, 2)
    })

    it('handles single relationship path', () => {
      const relationships = [createRelationship(0.7, 0.9)]
      const path = createPath([createEvent('1'), createEvent('2')], relationships)

      const stats = getPathStatistics(path)

      expect(stats.length).toBe(1)
      expect(stats.totalWeight).toBe(0.7)
      expect(stats.totalConfidence).toBe(0.9)
      expect(stats.cumulativeStrength).toBeCloseTo(0.63, 2)
      expect(stats.averageWeight).toBe(0.7)
      expect(stats.averageConfidence).toBe(0.9)
    })
  })
})
