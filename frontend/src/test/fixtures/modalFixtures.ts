import { Arc, Event, InferredPressure, CausalRelationship, CopyOperation } from '@/types'

/**
 * Creates a mock Arc with sensible defaults
 * @param overrides - Partial Arc to override defaults
 * @returns A complete Arc object
 */
export const createMockArc = (overrides: Partial<Arc> = {}): Arc => ({
  id: '1',
  name: 'Test Arc',
  description: 'Test Description',
  start_time: '2023-01-01T00:00:00Z',
  end_time: '2023-01-31T23:59:59Z',
  level: 0,
  parent_arc_id: null,
  created_at: '2023-01-01T00:00:00Z',
  updated_at: '2023-01-01T00:00:00Z',
  ...overrides
})

/**
 * Creates a mock Event with sensible defaults
 * @param overrides - Partial Event to override defaults
 * @returns A complete Event object
 */
export const createMockEvent = (overrides: Partial<Event> = {}): Event => ({
  id: '1',
  description: 'Test Event',
  actor: 'Test Actor',
  target: 'Test Target',
  timestamp: '2023-01-15T12:00:00Z',
  created_at: '2023-01-01T00:00:00Z',
  updated_at: '2023-01-01T00:00:00Z',
  ...overrides
})

/**
 * Creates a mock InferredPressure with sensible defaults
 * @param overrides - Partial InferredPressure to override defaults
 * @returns A complete InferredPressure object
 */
export const createMockPressure = (overrides: Partial<InferredPressure> = {}): InferredPressure => ({
  id: '1',
  description: 'Test Pressure',
  confidence_score: 0.85,
  pressure_type: 'economic',
  created_at: '2023-01-01T00:00:00Z',
  updated_at: '2023-01-01T00:00:00Z',
  ...overrides
})

/**
 * Creates a mock CausalRelationship with sensible defaults
 * @param overrides - Partial CausalRelationship to override defaults
 * @returns A complete CausalRelationship object
 */
export const createMockCausalRelationship = (overrides: Partial<CausalRelationship> = {}): CausalRelationship => ({
  id: '1',
  cause_event_id: '1',
  effect_event_id: '2',
  weight: 0.8,
  evidence: 'Test evidence',
  confidence: 0.9,
  relationship_type: 'direct',
  created_at: '2023-01-01T00:00:00Z',
  updated_at: '2023-01-01T00:00:00Z',
  ...overrides
})

/**
 * Creates a mock CopyOperation with sensible defaults
 * @param overrides - Partial CopyOperation to override defaults
 * @returns A complete CopyOperation object
 */
export const createMockCopyOperation = (overrides: Partial<CopyOperation> = {}): CopyOperation => ({
  id: '1',
  name: 'Test Copy',
  type: 'full',
  status: 'completed',
  progress: 100,
  created_at: '2023-01-01T00:00:00Z',
  completed_at: '2023-01-01T00:05:00Z',
  parameters: {},
  ...overrides
})

/**
 * Pre-built test scenarios for ArcDetailPanel
 */
export const arcDetailPanelScenarios = {
  createMode: {
    arc: null,
    isOpen: true,
    containedEvents: [] as Event[],
    childArcs: [] as Arc[],
    parentArc: null as Arc | null
  },
  editMode: {
    arc: createMockArc(),
    isOpen: true,
    containedEvents: [createMockEvent()],
    childArcs: [createMockArc({ id: '2', name: 'Child Arc', parent_arc_id: '1' })],
    parentArc: null as Arc | null
  },
  withParent: {
    arc: createMockArc({ parent_arc_id: 'parent-1' }),
    isOpen: true,
    containedEvents: [] as Event[],
    childArcs: [] as Arc[],
    parentArc: createMockArc({ id: 'parent-1', name: 'Parent Arc' })
  },
  withManyEvents: {
    arc: createMockArc(),
    isOpen: true,
    containedEvents: [
      createMockEvent({ id: '1', description: 'Event 1', timestamp: '2023-01-05T12:00:00Z' }),
      createMockEvent({ id: '2', description: 'Event 2', timestamp: '2023-01-10T12:00:00Z' }),
      createMockEvent({ id: '3', description: 'Event 3', timestamp: '2023-01-15T12:00:00Z' }),
      createMockEvent({ id: '4', description: 'Event 4', timestamp: '2023-01-20T12:00:00Z' }),
      createMockEvent({ id: '5', description: 'Event 5', timestamp: '2023-01-25T12:00:00Z' })
    ],
    childArcs: [] as Arc[],
    parentArc: null as Arc | null
  }
}

/**
 * Pre-built test scenarios for EventDetailModal
 */
export const eventDetailModalScenarios = {
  createMode: {
    event: null,
    isOpen: true,
    relatedArcs: [] as Arc[],
    causalRelationships: [] as CausalRelationship[]
  },
  editMode: {
    event: createMockEvent(),
    isOpen: true,
    relatedArcs: [] as Arc[],
    causalRelationships: [] as CausalRelationship[]
  },
  withRelations: {
    event: createMockEvent(),
    isOpen: true,
    relatedArcs: [
      createMockArc({ id: 'arc-1', name: 'Related Arc 1' }),
      createMockArc({ id: 'arc-2', name: 'Related Arc 2' })
    ],
    causalRelationships: [
      createMockCausalRelationship({ id: 'rel-1', cause_event_id: '1', effect_event_id: '2' }),
      createMockCausalRelationship({ id: 'rel-2', cause_event_id: '3', effect_event_id: '1' })
    ]
  }
}

/**
 * Pre-built test scenarios for CopyHistoryPanel
 */
export const copyHistoryPanelScenarios = {
  empty: {
    isOpen: true,
    operations: [] as CopyOperation[]
  },
  withOperations: {
    isOpen: true,
    operations: [
      createMockCopyOperation({ id: '1', name: 'Full Copy 1', type: 'full', status: 'completed' }),
      createMockCopyOperation({ id: '2', name: 'Time Range Copy', type: 'time_range', status: 'completed' }),
      createMockCopyOperation({ id: '3', name: 'Filtered Copy', type: 'filtered', status: 'in_progress', progress: 50 })
    ]
  },
  withFailedOperation: {
    isOpen: true,
    operations: [
      createMockCopyOperation({ id: '1', name: 'Full Copy', status: 'completed' }),
      createMockCopyOperation({
        id: '2',
        name: 'Failed Copy',
        status: 'failed',
        error_message: 'Network error occurred'
      })
    ]
  }
}

/**
 * Pre-built test scenarios for PressureDetailModal
 */
export const pressureDetailModalScenarios = {
  basic: {
    pressure: createMockPressure(),
    isOpen: true,
    evidenceEvents: [] as Event[]
  },
  withEvidence: {
    pressure: createMockPressure({
      description: 'Economic pressure from trade sanctions',
      confidence_score: 0.92,
      pressure_type: 'economic'
    }),
    isOpen: true,
    evidenceEvents: [
      createMockEvent({ id: '1', description: 'Sanctions announced' }),
      createMockEvent({ id: '2', description: 'Trade volume decreased' })
    ]
  },
  lowConfidence: {
    pressure: createMockPressure({
      confidence_score: 0.35,
      pressure_type: 'political'
    }),
    isOpen: true,
    evidenceEvents: [createMockEvent()]
  }
}

/**
 * Pre-built test scenarios for CausalRelationshipModal
 */
export const causalRelationshipModalScenarios = {
  createMode: {
    relationship: null,
    isOpen: true,
    causeEvent: createMockEvent({ id: 'cause-1', description: 'Cause Event' }),
    effectEvent: createMockEvent({ id: 'effect-1', description: 'Effect Event' })
  },
  editMode: {
    relationship: createMockCausalRelationship(),
    isOpen: true,
    causeEvent: createMockEvent({ id: '1', description: 'Cause Event' }),
    effectEvent: createMockEvent({ id: '2', description: 'Effect Event' })
  },
  indirectRelationship: {
    relationship: createMockCausalRelationship({
      relationship_type: 'indirect',
      weight: 0.5,
      confidence: 0.7
    }),
    isOpen: true,
    causeEvent: createMockEvent({ id: '1' }),
    effectEvent: createMockEvent({ id: '2' })
  }
}

/**
 * Creates a batch of mock events with sequential IDs
 * @param count - Number of events to create
 * @param baseOverrides - Base overrides to apply to all events
 * @returns Array of Event objects
 */
export const createMockEventBatch = (count: number, baseOverrides: Partial<Event> = {}): Event[] => {
  return Array.from({ length: count }, (_, index) =>
    createMockEvent({
      id: `event-${index + 1}`,
      description: `Event ${index + 1}`,
      timestamp: new Date(2023, 0, index + 1).toISOString(),
      ...baseOverrides
    })
  )
}

/**
 * Creates a batch of mock arcs with sequential IDs
 * @param count - Number of arcs to create
 * @param baseOverrides - Base overrides to apply to all arcs
 * @returns Array of Arc objects
 */
export const createMockArcBatch = (count: number, baseOverrides: Partial<Arc> = {}): Arc[] => {
  return Array.from({ length: count }, (_, index) =>
    createMockArc({
      id: `arc-${index + 1}`,
      name: `Arc ${index + 1}`,
      start_time: new Date(2023, 0, index * 7 + 1).toISOString(),
      end_time: new Date(2023, 0, (index + 1) * 7).toISOString(),
      ...baseOverrides
    })
  )
}

/**
 * Creates a hierarchical arc structure
 * @param depth - How many levels of hierarchy
 * @returns Object with parent arc and array of child arcs
 */
export const createMockArcHierarchy = (depth: number): { parent: Arc; children: Arc[] } => {
  const parent = createMockArc({ id: 'parent', name: 'Parent Arc' })
  const children: Arc[] = []

  let currentParentId = parent.id
  for (let i = 0; i < depth; i++) {
    const child = createMockArc({
      id: `child-${i + 1}`,
      name: `Child Arc Level ${i + 1}`,
      parent_arc_id: currentParentId
    })
    children.push(child)
    currentParentId = child.id
  }

  return { parent, children }
}
