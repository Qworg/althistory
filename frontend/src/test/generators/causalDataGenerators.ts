import { Event, CausalRelationship, CausalPath, CausalSuggestion } from '@/types'

let idCounter = 0

/**
 * Reset the ID counter (useful for test isolation)
 */
export function resetIdCounter(): void {
  idCounter = 0
}

/**
 * Generate a unique event ID
 */
export function generateEventId(): string {
  return `event-${++idCounter}`
}

/**
 * Generate a unique relationship ID
 */
export function generateRelationshipId(): string {
  return `rel-${++idCounter}`
}

/**
 * Generate a unique suggestion ID
 */
export function generateSuggestionId(): string {
  return `suggestion-${++idCounter}`
}

/**
 * Generate a test event with optional overrides
 */
export function generateEvent(overrides: Partial<Event> = {}): Event {
  const id = overrides.id ?? generateEventId()
  const now = new Date().toISOString()

  return {
    id,
    description: `Event ${id} description`,
    actor: `Actor ${Math.floor(Math.random() * 10)}`,
    target: `Target ${Math.floor(Math.random() * 10)}`,
    timestamp: overrides.timestamp ?? now,
    created_at: now,
    updated_at: now,
    ...overrides
  }
}

/**
 * Generate a sequence of events with proper timestamps
 */
export function generateEventSequence(
  count: number,
  startDate: Date = new Date('2023-01-01'),
  daysBetween: number = 1
): Event[] {
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(startDate)
    date.setDate(date.getDate() + i * daysBetween)

    return generateEvent({
      timestamp: date.toISOString(),
      description: `Sequential Event ${i + 1}`
    })
  })
}

/**
 * Generate a causal relationship between two events
 */
export function generateRelationship(
  causeEvent: Event | string,
  effectEvent: Event | string,
  overrides: Partial<CausalRelationship> = {}
): CausalRelationship {
  const causeId = typeof causeEvent === 'string' ? causeEvent : causeEvent.id
  const effectId = typeof effectEvent === 'string' ? effectEvent : effectEvent.id
  const now = new Date().toISOString()

  return {
    id: overrides.id ?? `rel-${causeId}-${effectId}`,
    cause_event_id: causeId,
    effect_event_id: effectId,
    weight: overrides.weight ?? Math.random() * 0.5 + 0.5, // 0.5-1.0
    confidence: overrides.confidence ?? Math.random() * 0.3 + 0.7, // 0.7-1.0
    evidence: overrides.evidence ?? 'Generated test evidence',
    relationship_type: overrides.relationship_type ?? 'direct',
    created_at: now,
    updated_at: now,
    ...overrides
  }
}

/**
 * Generate a relationship with specific weight and confidence
 */
export function generateRelationshipWithStrength(
  causeEvent: Event | string,
  effectEvent: Event | string,
  weight: number,
  confidence: number
): CausalRelationship {
  return generateRelationship(causeEvent, effectEvent, { weight, confidence })
}

/**
 * Generate a chain of relationships connecting events in sequence
 */
export function generateRelationshipChain(events: Event[]): CausalRelationship[] {
  return events.slice(0, -1).map((event, i) => generateRelationship(event, events[i + 1]!))
}

/**
 * Generate a causal path of specified length
 */
export function generateCausalPath(length: number = 3): CausalPath {
  const events = generateEventSequence(length)
  const relationships = generateRelationshipChain(events)

  return {
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
  }
}

/**
 * Generate a causal path from existing events
 */
export function generatePathFromEvents(
  events: Event[],
  relationshipOverrides?: Partial<CausalRelationship>
): CausalPath {
  const relationships = events.slice(0, -1).map((event, i) =>
    generateRelationship(event, events[i + 1]!, relationshipOverrides)
  )

  return {
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
  }
}

/**
 * Generate multiple paths with varying strengths
 */
export function generatePaths(
  count: number,
  pathLength: number = 3
): CausalPath[] {
  return Array.from({ length: count }, () => generateCausalPath(pathLength))
}

/**
 * Generate a causal suggestion
 */
export function generateSuggestion(
  overrides: Partial<CausalSuggestion> = {}
): CausalSuggestion {
  const id = overrides.id ?? generateSuggestionId()

  return {
    id,
    cause_event_id: overrides.cause_event_id ?? generateEventId(),
    effect_event_id: overrides.effect_event_id ?? generateEventId(),
    suggested_weight: overrides.suggested_weight ?? Math.random() * 0.5 + 0.5,
    confidence: overrides.confidence ?? Math.random() * 0.3 + 0.7,
    reasoning: overrides.reasoning ?? `AI-generated reasoning for suggestion ${id}`,
    ...overrides
  }
}

/**
 * Generate a suggestion between two specific events
 */
export function generateSuggestionForEvents(
  causeEvent: Event | string,
  effectEvent: Event | string,
  overrides: Partial<CausalSuggestion> = {}
): CausalSuggestion {
  const causeId = typeof causeEvent === 'string' ? causeEvent : causeEvent.id
  const effectId = typeof effectEvent === 'string' ? effectEvent : effectEvent.id

  return generateSuggestion({
    cause_event_id: causeId,
    effect_event_id: effectId,
    ...overrides
  })
}

/**
 * Generate multiple suggestions with varying confidence levels
 */
export function generateSuggestions(count: number): CausalSuggestion[] {
  return Array.from({ length: count }, () => generateSuggestion())
}

/**
 * Generate suggestions with specific confidence distribution
 */
export function generateSuggestionsWithConfidenceRange(
  count: number,
  minConfidence: number = 0.3,
  maxConfidence: number = 1.0
): CausalSuggestion[] {
  const confidenceStep = (maxConfidence - minConfidence) / Math.max(count - 1, 1)

  return Array.from({ length: count }, (_, i) =>
    generateSuggestion({
      confidence: minConfidence + i * confidenceStep
    })
  )
}

/**
 * Generate a complete test scenario with events, relationships, and suggestions
 */
export interface TestScenario {
  events: Event[]
  relationships: CausalRelationship[]
  paths: CausalPath[]
  suggestions: CausalSuggestion[]
}

export function generateTestScenario(options: {
  eventCount?: number
  relationshipCount?: number
  pathCount?: number
  pathLength?: number
  suggestionCount?: number
} = {}): TestScenario {
  const {
    eventCount = 10,
    relationshipCount = 5,
    pathCount = 3,
    pathLength = 3,
    suggestionCount = 5
  } = options

  // Generate events
  const events = generateEventSequence(eventCount)

  // Generate relationships between random pairs of events
  const relationships: CausalRelationship[] = []
  for (let i = 0; i < relationshipCount && i < events.length - 1; i++) {
    const causeIdx = Math.floor(Math.random() * (events.length - 1))
    const effectIdx = causeIdx + 1 + Math.floor(Math.random() * (events.length - causeIdx - 1))
    relationships.push(generateRelationship(events[causeIdx]!, events[effectIdx]!))
  }

  // Generate paths
  const paths = Array.from({ length: pathCount }, () => {
    const start = Math.floor(Math.random() * (events.length - pathLength))
    return generatePathFromEvents(events.slice(start, start + pathLength))
  })

  // Generate suggestions for event pairs that don't have relationships
  const suggestions: CausalSuggestion[] = []
  for (let i = 0; i < suggestionCount && i < events.length - 1; i++) {
    const causeEvent = events[i]!
    const effectEvent = events[i + 1]!
    const exists = relationships.some(
      r => r.cause_event_id === causeEvent.id && r.effect_event_id === effectEvent.id
    )
    if (!exists) {
      suggestions.push(generateSuggestionForEvents(causeEvent, effectEvent))
    }
  }

  return {
    events,
    relationships,
    paths,
    suggestions
  }
}

/**
 * Generate mock events for specific actors/targets
 */
export function generateEventsForActor(
  actor: string,
  count: number
): Event[] {
  return Array.from({ length: count }, () =>
    generateEvent({ actor })
  )
}

/**
 * Generate events with specific targets
 */
export function generateEventsForTarget(
  target: string,
  count: number
): Event[] {
  return Array.from({ length: count }, () =>
    generateEvent({ target })
  )
}

/**
 * Generate a branching causal structure (one event causing multiple effects)
 */
export interface BranchingCausalStructure {
  rootEvent: Event
  branchEvents: Event[]
  relationships: CausalRelationship[]
}

export function generateBranchingStructure(
  branchCount: number = 3
): BranchingCausalStructure {
  const rootEvent = generateEvent({ description: 'Root Cause Event' })
  const branchEvents = Array.from({ length: branchCount }, (_, i) =>
    generateEvent({ description: `Effect Event ${i + 1}` })
  )
  const relationships = branchEvents.map(effect =>
    generateRelationship(rootEvent, effect)
  )

  return {
    rootEvent,
    branchEvents,
    relationships
  }
}

/**
 * Generate a converging causal structure (multiple events causing one effect)
 */
export interface ConvergingCausalStructure {
  causeEvents: Event[]
  effectEvent: Event
  relationships: CausalRelationship[]
}

export function generateConvergingStructure(
  causeCount: number = 3
): ConvergingCausalStructure {
  const causeEvents = Array.from({ length: causeCount }, (_, i) =>
    generateEvent({ description: `Cause Event ${i + 1}` })
  )
  const effectEvent = generateEvent({ description: 'Combined Effect Event' })
  const relationships = causeEvents.map(cause =>
    generateRelationship(cause, effectEvent)
  )

  return {
    causeEvents,
    effectEvent,
    relationships
  }
}
