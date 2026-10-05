# Cytoscape Comprehensive Mocking Plan

## Overview

**Category:** Complex Library Mocking Issues  
**Affected Tests:** 8 tests in CausalGraphComponent.test.tsx  
**Priority:** MEDIUM - Advanced causal analysis features  
**Estimated Effort:** 1-2 weeks  
**Risk Level:** Low - Non-critical for basic functionality

## Problem Statement

The Cytoscape graph visualization library has an extensive API surface that is not fully mocked in tests, causing test failures with errors like:
- `cytoscapeInstance.style is not a function`
- `elements().removeClass is not a function`
- `AggregateError with multiple TypeError issues`

### Current Mock Limitations

```typescript
// Current incomplete mock:
const mockCytoscape = {
  on: vi.fn(),
  nodes: vi.fn(() => ({ forEach: vi.fn() })),
  // Missing: style, elements, layout chains, selectors, etc.
}
```

**Required but missing methods:**
- `cy.style()` - Style management
- `cy.elements()` - Element collection with chaining
- `cy.$()` - jQuery-style selectors
- `cy.layout()` - Layout algorithms
- `cy.animate()` - Animation system
- And 50+ more chaining methods

---

## Phase 1: API Surface Analysis (Days 1-2)

### 1.1 Document All Used Cytoscape APIs

**Audit `CausalGraphComponent.tsx` (909 lines) for all Cytoscape calls:**

```typescript
// Core instance methods used
cy.on(event, selector, handler)
cy.off(event, selector, handler)
cy.nodes()
cy.edges()
cy.elements()
cy.add(elements)
cy.layout(options)
cy.fit(eles?, padding?)
cy.animate(options)
cy.getElementById(id)
cy.destroy()

// Collection methods used
collection.forEach(callback)
collection.map(callback)
collection.remove()
collection.addClass(className)
collection.removeClass(className)
collection.select()
collection.data()
collection.position()
collection.id()

// Layout methods
layout.run()
layout.on(event, handler)

// Node/Edge singular methods
node.data()
node.addClass(className)
node.removeClass(className)
node.select()
edge.data()
edge.addClass(className)
```

### 1.2 Identify Chaining Patterns

Map all method chains in the codebase:

```typescript
// Pattern 1: Elements chain
cy.elements().removeClass('highlighted')
cy.elements().filter('[weight >= 0.5]').addClass('strong')

// Pattern 2: Node/Edge operations
cy.nodes().forEach(node => node.addClass('processed'))
cy.edges().map(edge => edge.data())

// Pattern 3: Layout chain
cy.layout({ name: 'cose' }).run()

// Pattern 4: Selector chain
cy.$('#nodeId').select()
cy.$('node[weight > 0.5]').addClass('heavy')
```

---

## Phase 2: Comprehensive Mock Implementation (Days 3-7)

### 2.1 Create Mock Factory

**File: `frontend/src/test/__mocks__/cytoscape.ts`**

```typescript
import { vi } from 'vitest'

// Types for our mock
interface MockCollection {
  forEach: ReturnType<typeof vi.fn>
  map: ReturnType<typeof vi.fn>
  filter: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
  addClass: ReturnType<typeof vi.fn>
  removeClass: ReturnType<typeof vi.fn>
  select: ReturnType<typeof vi.fn>
  data: ReturnType<typeof vi.fn>
  position: ReturnType<typeof vi.fn>
  id: ReturnType<typeof vi.fn>
  length: number
  // Enable chaining
  [key: string]: any
}

interface MockLayout {
  run: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
}

interface MockCytoscape {
  on: ReturnType<typeof vi.fn>
  off: ReturnType<typeof vi.fn>
  nodes: ReturnType<typeof vi.fn>
  edges: ReturnType<typeof vi.fn>
  elements: ReturnType<typeof vi.fn>
  add: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
  layout: ReturnType<typeof vi.fn>
  fit: ReturnType<typeof vi.fn>
  animate: ReturnType<typeof vi.fn>
  getElementById: ReturnType<typeof vi.fn>
  $: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
  style: ReturnType<typeof vi.fn>
  zoom: ReturnType<typeof vi.fn>
  center: ReturnType<typeof vi.fn>
  pan: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  container: ReturnType<typeof vi.fn>
  // For test access
  _mockData: {
    nodes: any[]
    edges: any[]
    eventHandlers: Map<string, Function[]>
  }
}

/**
 * Creates a mock Cytoscape collection with proper chaining support
 */
export function createMockCollection(items: any[] = []): MockCollection {
  const collection: MockCollection = {
    length: items.length,
    forEach: vi.fn((callback: (item: any) => void) => {
      items.forEach(callback)
      return collection
    }),
    map: vi.fn((callback: (item: any) => any) => items.map(callback)),
    filter: vi.fn((selectorOrCallback: string | ((item: any) => boolean)) => {
      if (typeof selectorOrCallback === 'function') {
        return createMockCollection(items.filter(selectorOrCallback))
      }
      // Simple selector support
      return createMockCollection(items)
    }),
    remove: vi.fn(() => collection),
    addClass: vi.fn((className: string) => collection),
    removeClass: vi.fn((className: string) => collection),
    select: vi.fn(() => collection),
    data: vi.fn((key?: string, value?: any) => {
      if (items.length === 1 && key === undefined) {
        return items[0]?.data || {}
      }
      if (key !== undefined && value === undefined) {
        return items[0]?.data?.[key]
      }
      return collection
    }),
    position: vi.fn((pos?: { x: number; y: number }) => {
      if (pos === undefined && items.length === 1) {
        return items[0]?.position || { x: 0, y: 0 }
      }
      return collection
    }),
    id: vi.fn(() => items[0]?.data?.id || '')
  }
  
  return collection
}

/**
 * Creates a mock layout object
 */
export function createMockLayout(): MockLayout {
  const layout: MockLayout = {
    run: vi.fn(() => layout),
    on: vi.fn((event: string, handler: Function) => layout),
    stop: vi.fn(() => layout)
  }
  return layout
}

/**
 * Creates a mock Cytoscape style object with chainable methods
 */
export function createMockStyle() {
  const style = {
    selector: vi.fn().mockReturnThis(),
    style: vi.fn().mockReturnThis(),
    css: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    clear: vi.fn().mockReturnThis()
  }
  return style
}

/**
 * Creates a complete mock Cytoscape instance
 */
export function createMockCytoscape(): MockCytoscape {
  const mockData = {
    nodes: [] as any[],
    edges: [] as any[],
    eventHandlers: new Map<string, Function[]>()
  }

  const cy: MockCytoscape = {
    _mockData: mockData,
    
    on: vi.fn((event: string, selectorOrHandler: string | Function, handler?: Function) => {
      const actualHandler = handler || selectorOrHandler as Function
      const key = handler ? `${event}:${selectorOrHandler}` : event
      
      if (!mockData.eventHandlers.has(key)) {
        mockData.eventHandlers.set(key, [])
      }
      mockData.eventHandlers.get(key)!.push(actualHandler)
      return cy
    }),
    
    off: vi.fn((event: string, selectorOrHandler?: string | Function) => {
      // Remove handlers
      return cy
    }),
    
    nodes: vi.fn(() => createMockCollection(mockData.nodes)),
    
    edges: vi.fn(() => createMockCollection(mockData.edges)),
    
    elements: vi.fn(() => createMockCollection([...mockData.nodes, ...mockData.edges])),
    
    add: vi.fn((elements: any | any[]) => {
      const elementsArray = Array.isArray(elements) ? elements : [elements]
      elementsArray.forEach(el => {
        if (el.group === 'nodes' || el.data?.source === undefined) {
          mockData.nodes.push(el)
        } else {
          mockData.edges.push(el)
        }
      })
      return createMockCollection(elementsArray)
    }),
    
    remove: vi.fn(() => {
      mockData.nodes = []
      mockData.edges = []
      return cy
    }),
    
    layout: vi.fn(() => createMockLayout()),
    
    fit: vi.fn((eles?: any, padding?: number) => cy),
    
    animate: vi.fn((options: any, animateOptions?: any) => cy),
    
    getElementById: vi.fn((id: string) => {
      const element = [...mockData.nodes, ...mockData.edges].find(
        el => el.data?.id === id
      )
      return createMockCollection(element ? [element] : [])
    }),
    
    $: vi.fn((selector: string) => {
      // Simple selector matching
      const id = selector.replace(/^#/, '')
      return cy.getElementById(id)
    }),
    
    destroy: vi.fn(),
    
    style: vi.fn(() => createMockStyle()),
    
    zoom: vi.fn((level?: number) => level === undefined ? 1 : cy),
    
    center: vi.fn(() => cy),
    
    pan: vi.fn((position?: { x: number; y: number }) => 
      position === undefined ? { x: 0, y: 0 } : cy
    ),
    
    resize: vi.fn(() => cy),
    
    container: vi.fn(() => document.createElement('div'))
  }
  
  return cy
}

/**
 * Test helper to trigger mock Cytoscape events
 */
export function triggerCytoscapeEvent(
  cy: MockCytoscape, 
  event: string, 
  selector: string | null, 
  eventData: any
) {
  const key = selector ? `${event}:${selector}` : event
  const handlers = cy._mockData.eventHandlers.get(key) || []
  handlers.forEach(handler => handler(eventData))
}

/**
 * Test helper to create mock node event data
 */
export function createMockNodeEvent(nodeData: any) {
  return {
    target: {
      data: vi.fn(() => nodeData),
      addClass: vi.fn(),
      removeClass: vi.fn(),
      select: vi.fn(),
      position: vi.fn(() => ({ x: 0, y: 0 })),
      id: vi.fn(() => nodeData.id)
    }
  }
}

/**
 * Test helper to create mock edge event data
 */
export function createMockEdgeEvent(edgeData: any) {
  return {
    target: {
      data: vi.fn(() => edgeData),
      addClass: vi.fn(),
      removeClass: vi.fn(),
      select: vi.fn(),
      source: vi.fn(() => createMockCollection([{ data: { id: edgeData.source } }])),
      target: vi.fn(() => createMockCollection([{ data: { id: edgeData.target } }]))
    }
  }
}

// Default export for vi.mock
const cytoscape = vi.fn(() => createMockCytoscape())
export default cytoscape

// Reset function for tests
export function resetCytoscapeMock() {
  cytoscape.mockClear()
}
```

### 2.2 Create Test Helpers Module

**File: `frontend/src/test/helpers/cytoscapeTestHelpers.ts`**

```typescript
import { vi } from 'vitest'
import { 
  createMockCytoscape, 
  triggerCytoscapeEvent, 
  createMockNodeEvent,
  createMockEdgeEvent 
} from '../__mocks__/cytoscape'
import { Event, CausalRelationship } from '@/types'

/**
 * Sets up a complete Cytoscape mock with realistic test data
 */
export function setupCytoscapeTestEnvironment(options: {
  events?: Event[]
  relationships?: CausalRelationship[]
} = {}) {
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
  cy: ReturnType<typeof createMockCytoscape>,
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
  cy: ReturnType<typeof createMockCytoscape>,
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
  cy: ReturnType<typeof createMockCytoscape>,
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
 * Helper to verify layout was applied
 */
export function expectLayoutApplied(cy: ReturnType<typeof createMockCytoscape>, layoutName: string) {
  expect(cy.layout).toHaveBeenCalledWith(
    expect.objectContaining({ name: layoutName })
  )
}

/**
 * Helper to get recorded event handlers
 */
export function getEventHandlers(cy: ReturnType<typeof createMockCytoscape>, event: string, selector?: string) {
  const key = selector ? `${event}:${selector}` : event
  return cy._mockData.eventHandlers.get(key) || []
}
```

---

## Phase 3: Update Test Files (Days 8-10)

### 3.1 Refactor CausalGraphComponent.test.tsx

```typescript
// frontend/src/components/causal-graph/CausalGraphComponent.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { CausalGraphComponent } from './CausalGraphComponent'
import { useGlobalStore } from '@/stores/globalStore'
import { Event, CausalRelationship } from '@/types'
import cytoscape, { 
  createMockCytoscape, 
  resetCytoscapeMock 
} from '@/test/__mocks__/cytoscape'
import {
  setupCytoscapeTestEnvironment,
  simulateNodeClick,
  simulateEdgeClick,
  simulateNodeHover,
  expectLayoutApplied,
  getEventHandlers
} from '@/test/helpers/cytoscapeTestHelpers'

// Use the comprehensive mock
vi.mock('cytoscape', () => ({
  default: vi.fn(() => createMockCytoscape())
}))

vi.mock('@/stores/globalStore')
const mockUseGlobalStore = useGlobalStore as any

describe('CausalGraphComponent', () => {
  const mockEvents: Event[] = [
    {
      id: '1',
      description: 'Event 1',
      actor: 'Actor 1',
      target: 'Target 1',
      timestamp: '2023-01-01T00:00:00Z',
      created_at: '2023-01-01T00:00:00Z',
      updated_at: '2023-01-01T00:00:00Z'
    },
    {
      id: '2',
      description: 'Event 2',
      actor: 'Actor 2',
      target: 'Target 2',
      timestamp: '2023-01-02T00:00:00Z',
      created_at: '2023-01-02T00:00:00Z',
      updated_at: '2023-01-02T00:00:00Z'
    }
  ]

  const mockRelationships: CausalRelationship[] = [
    {
      id: 'rel1',
      cause_event_id: '1',
      effect_event_id: '2',
      weight: 0.8,
      evidence: 'Strong evidence',
      confidence: 0.9,
      relationship_type: 'direct',
      created_at: '2023-01-01T00:00:00Z',
      updated_at: '2023-01-01T00:00:00Z'
    }
  ]

  let mockCy: ReturnType<typeof createMockCytoscape>

  beforeEach(() => {
    mockCy = setupCytoscapeTestEnvironment({
      events: mockEvents,
      relationships: mockRelationships
    })
    
    // Make cytoscape return our prepared mock
    ;(cytoscape as any).mockReturnValue(mockCy)
    
    mockUseGlobalStore.mockReturnValue({
      events: mockEvents,
      causalRelationships: mockRelationships,
      selectedEvents: [],
      sessionData: {
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
    })
  })

  afterEach(() => {
    resetCytoscapeMock()
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('renders the causal graph container', async () => {
      render(<CausalGraphComponent />)
      
      const container = document.querySelector('.causal-graph-container')
      expect(container).toBeInTheDocument()
    })

    it('initializes Cytoscape with correct configuration', async () => {
      render(<CausalGraphComponent />)
      
      await waitFor(() => {
        expect(cytoscape).toHaveBeenCalledWith(
          expect.objectContaining({
            container: expect.any(HTMLElement),
            style: expect.any(Array),
            minZoom: 0.1,
            maxZoom: 3
          })
        )
      })
    })

    it('applies custom className', () => {
      render(<CausalGraphComponent className="custom-class" />)
      
      const container = document.querySelector('.causal-graph-container')
      expect(container).toHaveClass('custom-class')
    })
  })

  describe('Event Handling', () => {
    it('sets up node click handlers', async () => {
      render(<CausalGraphComponent />)
      
      await waitFor(() => {
        const handlers = getEventHandlers(mockCy, 'tap', 'node')
        expect(handlers.length).toBeGreaterThan(0)
      })
    })

    it('calls onNodeClick when a node is clicked', async () => {
      const onNodeClick = vi.fn()
      render(<CausalGraphComponent onNodeClick={onNodeClick} />)
      
      await waitFor(() => {
        expect(mockCy.on).toHaveBeenCalled()
      })
      
      simulateNodeClick(mockCy, mockEvents[0])
      
      expect(onNodeClick).toHaveBeenCalledWith(mockEvents[0])
    })

    it('calls onEdgeClick when an edge is clicked', async () => {
      const onEdgeClick = vi.fn()
      render(<CausalGraphComponent onEdgeClick={onEdgeClick} />)
      
      await waitFor(() => {
        expect(mockCy.on).toHaveBeenCalled()
      })
      
      simulateEdgeClick(mockCy, mockRelationships[0])
      
      expect(onEdgeClick).toHaveBeenCalledWith(mockRelationships[0])
    })

    it('highlights node on hover', async () => {
      const onNodeHover = vi.fn()
      render(<CausalGraphComponent onNodeHover={onNodeHover} />)
      
      await waitFor(() => {
        expect(mockCy.on).toHaveBeenCalled()
      })
      
      simulateNodeHover(mockCy, mockEvents[0], true)
      
      expect(onNodeHover).toHaveBeenCalledWith(mockEvents[0])
    })
  })

  describe('Data Management', () => {
    it('adds nodes and edges to graph', async () => {
      render(<CausalGraphComponent />)
      
      await waitFor(() => {
        expect(mockCy.add).toHaveBeenCalled()
      })
      
      // Verify the add was called with correct structure
      const addCalls = mockCy.add.mock.calls
      expect(addCalls.length).toBeGreaterThan(0)
    })

    it('clears elements before updating', async () => {
      const { rerender } = render(<CausalGraphComponent />)
      
      await waitFor(() => {
        expect(mockCy.add).toHaveBeenCalled()
      })
      
      // Update store data
      mockUseGlobalStore.mockReturnValue({
        ...mockUseGlobalStore(),
        events: [...mockEvents, { id: '3', description: 'New Event' }]
      })
      
      rerender(<CausalGraphComponent />)
      
      await waitFor(() => {
        expect(mockCy.elements().remove).toHaveBeenCalled()
      })
    })
  })

  describe('Layout Management', () => {
    it('applies initial layout', async () => {
      render(<CausalGraphComponent />)
      
      await waitFor(() => {
        expectLayoutApplied(mockCy, 'cose')
      })
    })

    it('runs layout when applied', async () => {
      render(<CausalGraphComponent />)
      
      await waitFor(() => {
        const layoutMock = mockCy.layout()
        expect(layoutMock.run).toHaveBeenCalled()
      })
    })
  })

  describe('Cleanup', () => {
    it('destroys Cytoscape instance on unmount', async () => {
      const { unmount } = render(<CausalGraphComponent />)
      
      await waitFor(() => {
        expect(mockCy.add).toHaveBeenCalled()
      })
      
      unmount()
      
      expect(mockCy.destroy).toHaveBeenCalled()
    })
  })
})
```

### 3.2 Update Related Test Files

Apply similar updates to:
- `CausalGraphLayoutManager.test.tsx`
- `CausalPathExplorer.test.tsx`
- `CausalRelationshipInteractions.test.tsx`
- `CausalSuggestionManager.test.tsx`

---

## Phase 4: Integration Testing Alternative (Days 11-12)

### 4.1 Create Component Logic Tests (without Cytoscape)

For complex interactions, test component logic separately:

```typescript
// frontend/src/components/causal-graph/CausalGraphLogic.test.ts
import { describe, it, expect } from 'vitest'
import { 
  transformEventsToCytoscapeNodes,
  transformRelationshipsToCytoscapeEdges,
  calculateNodeWeight,
  buildGraphData
} from './causalGraphLogic'

describe('Causal Graph Logic', () => {
  describe('transformEventsToCytoscapeNodes', () => {
    it('creates node data from events', () => {
      const events = [{ id: '1', actor: 'A', target: 'B' }]
      const nodes = transformEventsToCytoscapeNodes(events)
      
      expect(nodes[0]).toMatchObject({
        data: {
          id: '1',
          label: 'A → B'
        }
      })
    })
  })

  describe('calculateNodeWeight', () => {
    it('calculates weight based on relationship count', () => {
      const weight = calculateNodeWeight('1', [
        { cause_event_id: '1', effect_event_id: '2' },
        { cause_event_id: '1', effect_event_id: '3' }
      ])
      
      expect(weight).toBeCloseTo(0.67, 2) // 2 out of 3 possible relationships
    })
  })
})
```

### 4.2 Visual Regression Testing (Optional Enhancement)

For complex visualizations, consider adding visual regression tests:

```typescript
// Using Playwright for visual testing
import { test, expect } from '@playwright/test'

test('causal graph renders correctly', async ({ page }) => {
  await page.goto('/causal-graph')
  
  // Wait for graph to initialize
  await page.waitForSelector('.causal-graph-container canvas')
  
  // Take screenshot for comparison
  await expect(page.locator('.causal-graph-container')).toHaveScreenshot('causal-graph.png')
})
```

---

## Files to Create/Modify

### New Files
1. `frontend/src/test/__mocks__/cytoscape.ts` - Comprehensive mock
2. `frontend/src/test/helpers/cytoscapeTestHelpers.ts` - Test utilities
3. `frontend/src/components/causal-graph/causalGraphLogic.ts` - Extracted logic
4. `frontend/src/components/causal-graph/causalGraphLogic.test.ts` - Logic tests

### Modified Files
1. `frontend/src/components/causal-graph/CausalGraphComponent.test.tsx`
2. `frontend/src/components/causal-graph/CausalGraphLayoutManager.test.tsx`
3. `frontend/src/components/causal-graph/CausalPathExplorer.test.tsx`
4. `frontend/src/components/causal-graph/CausalRelationshipInteractions.test.tsx`
5. `frontend/src/components/causal-graph/CausalSuggestionManager.test.tsx`

---

## Success Criteria

1. **All 8 CausalGraphComponent tests pass** - No mock-related failures
2. **Comprehensive mock coverage** - All used Cytoscape APIs are mocked
3. **Test helper utilities** - Easy-to-use helpers for common operations
4. **Documentation** - Clear documentation of mock capabilities
5. **Maintainability** - Mock is easy to extend for new API usage

---

## Risk Mitigation

1. **Mock Drift** - Document which Cytoscape version the mock targets
2. **Incomplete Coverage** - Log warnings when unmocked methods are called
3. **False Positives** - Include integration tests with real Cytoscape (optional)

---

## Dependencies

- Cytoscape.js v3.x
- Vitest
- React Testing Library
- TypeScript 5.x
