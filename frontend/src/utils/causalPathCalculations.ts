import { CausalPath, CausalPathRelationship } from '@/types'

/**
 * Calculate cumulative strength for a causal path
 * Uses product of weights and confidences
 */
export function calculateCumulativeStrength(relationships: CausalPathRelationship[]): number {
  if (relationships.length === 0) return 0

  return relationships.reduce((cumulative, relationship) => {
    const strength = relationship.weight * relationship.confidence
    return cumulative * strength
  }, 1)
}

/**
 * Calculate step-by-step cumulative weights for a path
 */
export function calculateStepWeights(relationships: CausalPathRelationship[]): number[] {
  const weights: number[] = [1] // First step is always 1 (100%)
  let cumulative = 1

  for (const relationship of relationships) {
    cumulative *= relationship.weight * relationship.confidence
    weights.push(cumulative)
  }

  return weights
}

/**
 * Sort paths by cumulative strength (strongest first)
 */
export function sortPathsByStrength(paths: CausalPath[]): CausalPath[] {
  return [...paths].sort((a, b) => {
    const strengthA = calculateCumulativeStrength(a.relationships)
    const strengthB = calculateCumulativeStrength(b.relationships)
    return strengthB - strengthA
  })
}

/**
 * Get the strongest path from a set of paths
 */
export function getStrongestPath(paths: CausalPath[]): CausalPath | null {
  if (paths.length === 0) return null
  return sortPathsByStrength(paths)[0] || null
}

/**
 * Navigation step in a causal chain.
 *
 * `event` is the event *id*: a path names its events by id, and the caller
 * that has the event objects resolves them.
 */
export interface CausalChainStep {
  eventId: string
  relationship?: CausalPathRelationship
  cumulativeWeight: number
  stepIndex: number
}

/**
 * Transform a causal path into navigation steps
 */
export function transformPathToSteps(path: CausalPath): CausalChainStep[] {
  const steps: CausalChainStep[] = []
  let cumulativeWeight = 1

  // First event (starting point)
  const firstEventId = path.events[0]
  if (firstEventId) {
    steps.push({
      eventId: firstEventId,
      cumulativeWeight: 1,
      stepIndex: 0
    })
  }

  // Subsequent events with their relationships
  for (let i = 1; i < path.events.length; i++) {
    const relationship = path.relationships[i - 1]
    if (relationship) {
      cumulativeWeight *= relationship.weight * relationship.confidence
    }

    steps.push({
      eventId: path.events[i]!,
      relationship,
      cumulativeWeight,
      stepIndex: i
    })
  }

  return steps
}

/**
 * Format cumulative weight as percentage string
 */
export function formatWeightAsPercentage(weight: number): string {
  return `${(weight * 100).toFixed(1)}%`
}

/**
 * Calculate the total path confidence (product of all relationship confidences)
 */
export function calculatePathConfidence(relationships: CausalPathRelationship[]): number {
  if (relationships.length === 0) return 0
  return relationships.reduce((confidence, rel) => confidence * rel.confidence, 1)
}

/**
 * Calculate the total path weight (product of all relationship weights)
 */
export function calculatePathWeight(relationships: CausalPathRelationship[]): number {
  if (relationships.length === 0) return 0
  return relationships.reduce((weight, rel) => weight * rel.weight, 1)
}

/**
 * Get path statistics
 */
export interface PathStatistics {
  length: number
  totalWeight: number
  totalConfidence: number
  cumulativeStrength: number
  averageWeight: number
  averageConfidence: number
}

export function getPathStatistics(path: CausalPath): PathStatistics {
  const { relationships } = path
  const length = relationships.length

  if (length === 0) {
    return {
      length: 0,
      totalWeight: 0,
      totalConfidence: 0,
      cumulativeStrength: 0,
      averageWeight: 0,
      averageConfidence: 0
    }
  }

  const totalWeight = calculatePathWeight(relationships)
  const totalConfidence = calculatePathConfidence(relationships)
  const cumulativeStrength = calculateCumulativeStrength(relationships)

  return {
    length,
    totalWeight,
    totalConfidence,
    cumulativeStrength,
    averageWeight: relationships.reduce((sum, r) => sum + r.weight, 0) / length,
    averageConfidence: relationships.reduce((sum, r) => sum + r.confidence, 0) / length
  }
}
