import { expect, vi } from 'vitest'
import {
  createMockCytoscape,
  triggerCytoscapeEvent,
  createMockNodeEvent,
  createMockEdgeEvent,
  type MockCytoscape
} from '../__mocks__/cytoscape'
import { Event, CausalRelationship, SessionData } from '@/types'

/**
 * Handler list recorded by the mock, taken from the mock's own types so this
 * helper never has to restate (or drift from) the mocked signature.
 */
type RecordedEventHandlers = NonNullable<
  ReturnType<MockCytoscape['_mockData']['eventHandlers']['get']>
>

/** Store slice accepted by {@link createMockStoreState}. */
export interface MockStoreStateOverrides {
  events: Event[]
  causalRelationships: CausalRelationship[]
  selectedEvents: string[]
  sessionData: Pick<SessionData['viewportState'], 'causalGraph'>
}

/**
 * Sets up a complete Cytoscape mock with realistic test data
 */
export function setupCytoscapeTestEnvironment(options: {
  events?: Event[]
  relationships?: CausalRelationship[]
} = {}): MockCytoscape {
  const cy = createMockCytoscape()

  // Pre-populate with test data if provided
  if (options.events) {
    options.events.forEach(event => {
      cy._mockData.nodes.push({
        group: 'nodes',
        data: {
          id: event.id,
          event,
          label: `${event.actor} → ${event.target}`,
          weight: 0.5,
          isSelected: false,
          isHighlighted: false
        },
        position: { x: Math.random() * 500, y: Math.random() * 500 }
      })
    })
  }

  if (options.relationships) {
    options.relationships.forEach(rel => {
      cy._mockData.edges.push({
        group: 'edges',
        data: {
          id: rel.id,
          source: rel.cause_event_id,
          target: rel.effect_event_id,
          relationship: rel,
          weight: rel.weight,
          label: `${rel.weight.toFixed(2)}`,
          isSelected: false,
          isHighlighted: false
        }
      })
    })
  }

  return cy
}

/**
 * Helper to simulate user clicking on a node
 */
export function simulateNodeClick(
  cy: MockCytoscape,
  eventOrId: Event | string
) {
  const nodeId = typeof eventOrId === 'string' ? eventOrId : eventOrId.id
  const nodeData = cy._mockData.nodes.find(n => n.data.id === nodeId)

  if (nodeData) {
    triggerCytoscapeEvent(cy, 'tap', 'node', createMockNodeEvent(nodeData.data))
  }
}

/**
 * Helper to simulate user clicking on an edge
 */
export function simulateEdgeClick(
  cy: MockCytoscape,
  relationshipOrId: CausalRelationship | string
) {
  const edgeId = typeof relationshipOrId === 'string' ? relationshipOrId : relationshipOrId.id
  const edgeData = cy._mockData.edges.find(e => e.data.id === edgeId)

  if (edgeData) {
    triggerCytoscapeEvent(cy, 'tap', 'edge', createMockEdgeEvent(edgeData.data))
  }
}

/**
 * Helper to simulate node hover
 */
export function simulateNodeHover(
  cy: MockCytoscape,
  eventOrId: Event | string,
  isEnter: boolean = true
) {
  const nodeId = typeof eventOrId === 'string' ? eventOrId : eventOrId.id
  const nodeData = cy._mockData.nodes.find(n => n.data.id === nodeId)

  if (nodeData) {
    const event = isEnter ? 'mouseover' : 'mouseout'
    triggerCytoscapeEvent(cy, event, 'node', createMockNodeEvent(nodeData.data))
  }
}

/**
 * Helper to simulate edge hover
 */
export function simulateEdgeHover(
  cy: MockCytoscape,
  relationshipOrId: CausalRelationship | string,
  isEnter: boolean = true
) {
  const edgeId = typeof relationshipOrId === 'string' ? relationshipOrId : relationshipOrId.id
  const edgeData = cy._mockData.edges.find(e => e.data.id === edgeId)

  if (edgeData) {
    const event = isEnter ? 'mouseover' : 'mouseout'
    triggerCytoscapeEvent(cy, event, 'edge', createMockEdgeEvent(edgeData.data))
  }
}

/**
 * Helper to simulate right-click on edge (context menu)
 */
export function simulateEdgeRightClick(
  cy: MockCytoscape,
  relationshipOrId: CausalRelationship | string
) {
  const edgeId = typeof relationshipOrId === 'string' ? relationshipOrId : relationshipOrId.id
  const edgeData = cy._mockData.edges.find(e => e.data.id === edgeId)

  if (edgeData) {
    triggerCytoscapeEvent(cy, 'cxttap', 'edge', createMockEdgeEvent(edgeData.data))
  }
}

/**
 * Helper to simulate background click
 */
export function simulateBackgroundClick(cy: MockCytoscape) {
  triggerCytoscapeEvent(cy, 'tap', null, { target: cy })
}

/**
 * Helper to simulate layout stop event
 */
export function simulateLayoutStop(cy: MockCytoscape) {
  triggerCytoscapeEvent(cy, 'layoutstop', null, {})
}

/**
 * Helper to verify layout was applied
 */
export function expectLayoutApplied(cy: MockCytoscape, layoutName: string) {
  expect(cy.layout).toHaveBeenCalledWith(
    expect.objectContaining({ name: layoutName })
  )
}

/**
 * Helper to get recorded event handlers
 */
export function getEventHandlers(cy: MockCytoscape, event: string, selector?: string) {
  const key = selector ? `${event}:${selector}` : event
  return cy._mockData.eventHandlers.get(key) || []
}

/**
 * Creates a standard set of mock events for testing
 */
export function createMockEvents(count: number = 3): Event[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `event-${i + 1}`,
    description: `Event ${i + 1} description`,
    actor: `Actor ${i + 1}`,
    target: `Target ${i + 1}`,
    timestamp: new Date(2023, 0, i + 1).toISOString(),
    created_at: new Date(2023, 0, i + 1).toISOString(),
    updated_at: new Date(2023, 0, i + 1).toISOString()
  }))
}

/**
 * Creates a standard set of mock causal relationships for testing
 */
export function createMockRelationships(events: Event[]): CausalRelationship[] {
  const relationships: CausalRelationship[] = []

  for (let i = 0; i < events.length - 1; i++) {
    relationships.push({
      id: `rel-${i + 1}`,
      cause_event_id: events[i]!.id,
      effect_event_id: events[i + 1]!.id,
      weight: 0.7 + Math.random() * 0.3,
      evidence: `Evidence for relationship ${i + 1}`,
      confidence: 0.7 + Math.random() * 0.3,
      relationship_type: 'direct',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
  }

  return relationships
}

/**
 * Creates a mock store state for Cytoscape-related tests
 */
export function createMockStoreState(overrides: Partial<MockStoreStateOverrides> = {}) {
  const events = overrides.events || createMockEvents()
  const relationships = overrides.causalRelationships || createMockRelationships(events)

  return {
    events,
    causalRelationships: relationships,
    selectedEvents: overrides.selectedEvents || [],
    sessionData: overrides.sessionData || {
      viewportState: {
        causalGraph: {
          layout: 'cose',
          nodePositions: {}
        }
      }
    },
    updateSessionData: vi.fn(),
    addCausalRelationship: vi.fn(),
    addError: vi.fn()
  }
}

/**
 * Waits for a cytoscape event handler to be registered
 */
export async function waitForEventHandler(
  cy: MockCytoscape,
  event: string,
  selector?: string,
  timeout: number = 1000
): Promise<RecordedEventHandlers> {
  const key = selector ? `${event}:${selector}` : event
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    const handlers = cy._mockData.eventHandlers.get(key)
    if (handlers && handlers.length > 0) {
      return handlers
    }
    await new Promise(resolve => setTimeout(resolve, 50))
  }

  throw new Error(`Timeout waiting for event handler: ${key}`)
}

// Re-export common utilities
export {
  createMockCytoscape,
  triggerCytoscapeEvent,
  createMockNodeEvent,
  createMockEdgeEvent
} from '../__mocks__/cytoscape'
export type { MockCytoscape } from '../__mocks__/cytoscape'
