import { vi } from 'vitest'

// Types for our mock

/** A plain `{ x, y }` coordinate pair, as used by Cytoscape positions/midpoints. */
export interface MockPosition {
  x: number
  y: number
}

/**
 * The `data` bag of a mocked element. Cytoscape elements are user-defined, so the
 * well-known keys are named and everything else is allowed through an index signature.
 */
export interface MockElementData {
  id?: string
  source?: string
  target?: string
  [key: string]: unknown
}

/** A raw (plain object) element as it is stored in `cy._mockData`. */
export interface MockElement {
  group?: string
  id?: string
  data: MockElementData
  position?: MockPosition
  [key: string]: unknown
}

/** Signature used for every stored Cytoscape event handler in this mock. */
export type MockEventHandler = (...args: unknown[]) => unknown

/** Internal bookkeeping attached to every mock instance as `cy._mockData`. */
export interface MockData {
  nodes: MockElement[]
  edges: MockElement[]
  eventHandlers: Map<string, MockEventHandler[]>
  zoomLevel: number
  panPosition: MockPosition
}

/**
 * A single element as handed to `forEach`/`map` callbacks: the raw data item wrapped
 * in the chainable accessor methods the product code actually calls.
 */
export interface MockNode {
  data: (key?: string, value?: unknown) => unknown
  id: () => string
  position: (pos?: MockPosition) => MockPosition | MockNode
  addClass: (...classNames: string[]) => MockNode
  removeClass: (...classNames: string[]) => MockNode
  select: (selectee?: string) => MockNode
  unselect: (unselectee?: string) => MockNode
  renderedMidpoint: () => MockPosition
  renderedPosition: () => MockPosition
  source: () => MockCollection
  target: () => MockCollection
  [key: string]: unknown
}

export interface MockCollection {
  forEach: ReturnType<typeof vi.fn>
  map: ReturnType<typeof vi.fn>
  filter: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
  addClass: ReturnType<typeof vi.fn>
  removeClass: ReturnType<typeof vi.fn>
  select: ReturnType<typeof vi.fn>
  unselect: ReturnType<typeof vi.fn>
  data: ReturnType<typeof vi.fn>
  position: ReturnType<typeof vi.fn>
  id: ReturnType<typeof vi.fn>
  renderedMidpoint: ReturnType<typeof vi.fn>
  source: ReturnType<typeof vi.fn>
  target: ReturnType<typeof vi.fn>
  length: number
  [key: string]: unknown
}

export interface MockLayout {
  run: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
}

export interface MockStyle {
  selector: ReturnType<typeof vi.fn>
  style: ReturnType<typeof vi.fn>
  css: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  clear: ReturnType<typeof vi.fn>
}

export interface MockCytoscape {
  on: ReturnType<typeof vi.fn>
  off: ReturnType<typeof vi.fn>
  one: ReturnType<typeof vi.fn>
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
  batch: ReturnType<typeof vi.fn>
  startBatch: ReturnType<typeof vi.fn>
  endBatch: ReturnType<typeof vi.fn>
  json: ReturnType<typeof vi.fn>
  ready: ReturnType<typeof vi.fn>
  _mockData: MockData
}

// Cache for wrapped elements to maintain consistent mock function references
const wrappedElementCache = new WeakMap<MockElement, MockNode>()

/**
 * Appends `handler` to the handler list stored under `key`, creating it if needed.
 * Replaces the previous `get(key)!.push(...)` form with a real guard.
 */
function appendHandler(
  registry: Map<string, MockEventHandler[]>,
  key: string,
  handler: MockEventHandler
): void {
  const existing = registry.get(key)
  if (existing) {
    existing.push(handler)
    return
  }
  registry.set(key, [handler])
}

/**
 * Wraps a raw data item to look like a Cytoscape element with methods
 * Uses caching to ensure consistent mock function references for method chaining
 */
function wrapAsElement(item: MockElement, mockData?: MockData): MockNode {
  // Return cached wrapper if available to maintain mock function references
  const cached = wrappedElementCache.get(item)
  if (cached) {
    return cached
  }

  // Create mock functions once per element
  const addClassFn = vi.fn()
  const removeClassFn = vi.fn()
  const selectFn = vi.fn()
  const unselectFn = vi.fn()

  const wrapped: MockNode = {
    data: (key?: string, value?: unknown): unknown => {
      if (key === undefined) {
        return item.data || item
      }
      if (value === undefined) {
        return item.data?.[key] ?? item[key]
      }
      if (item.data) {
        item.data[key] = value
      }
      return wrapped
    },
    id: (): string => item.data?.id || item.id || '',
    position: (pos?: MockPosition): MockPosition | MockNode => {
      if (pos === undefined) {
        return item.position || { x: 0, y: 0 }
      }
      item.position = pos
      return wrapped
    },
    addClass: addClassFn,
    removeClass: removeClassFn,
    select: selectFn,
    unselect: unselectFn,
    renderedMidpoint: (): MockPosition => ({ x: 100, y: 100 }),
    renderedPosition: (): MockPosition => ({ x: 100, y: 100 }),
    source: (): MockCollection => {
      // Return the source node for edges
      const sourceId = item.data?.source
      if (sourceId && mockData?.nodes) {
        const sourceNode = mockData.nodes.find((n: MockElement) => n.data?.id === sourceId)
        return createMockCollection(sourceNode ? [sourceNode] : [], mockData)
      }
      return createMockCollection([], mockData)
    },
    target: (): MockCollection => {
      // Return the target node for edges
      const targetId = item.data?.target
      if (targetId && mockData?.nodes) {
        const targetNode = mockData.nodes.find((n: MockElement) => n.data?.id === targetId)
        return createMockCollection(targetNode ? [targetNode] : [], mockData)
      }
      return createMockCollection([], mockData)
    }
  }

  // Set up chainable methods to return the same wrapped instance
  addClassFn.mockReturnValue(wrapped)
  removeClassFn.mockReturnValue(wrapped)
  selectFn.mockReturnValue(wrapped)
  unselectFn.mockReturnValue(wrapped)

  // Cache the wrapped element
  wrappedElementCache.set(item, wrapped)

  return wrapped
}

/**
 * Creates a mock Cytoscape collection with proper chaining support
 */
export function createMockCollection(
  items: MockElement[] = [],
  mockData?: MockData
): MockCollection {
  const collection: MockCollection = {
    length: items.length,
    forEach: vi.fn((callback: (item: MockNode, index: number) => void) => {
      items.forEach((item, index) => callback(wrapAsElement(item, mockData), index))
      return collection
    }),
    map: vi.fn((callback: (item: MockNode, index: number) => unknown) =>
      items.map((item, index) => callback(wrapAsElement(item, mockData), index))
    ),
    filter: vi.fn((selectorOrCallback: string | ((item: MockNode, index: number) => boolean)) => {
      if (typeof selectorOrCallback === 'function') {
        // Wrap like forEach/map do, and pass the index: a caller that inspects
        // the element with `item.data('id')` must not receive the raw backing
        // object here while every other iteration method hands it the wrapped
        // one.
        return createMockCollection(
          items.filter((item, index) =>
            selectorOrCallback(wrapAsElement(item, mockData), index)
          ),
          mockData
        )
      }
      // Simple selector support - return all for now
      return createMockCollection(items, mockData)
    }),
    remove: vi.fn(() => collection),
    addClass: vi.fn(() => collection),
    removeClass: vi.fn(() => collection),
    select: vi.fn(() => collection),
    unselect: vi.fn(() => collection),
    data: vi.fn((key?: string, value?: unknown) => {
      if (items.length === 1 && key === undefined) {
        return items[0]?.data || {}
      }
      if (key !== undefined && value === undefined) {
        return items[0]?.data?.[key]
      }
      return collection
    }),
    position: vi.fn((pos?: MockPosition) => {
      if (pos === undefined && items.length === 1) {
        return items[0]?.position || { x: 0, y: 0 }
      }
      return collection
    }),
    id: vi.fn(() => items[0]?.data?.id || ''),
    renderedMidpoint: vi.fn(() => ({ x: 100, y: 100 })),
    renderedPosition: vi.fn(() => ({ x: 100, y: 100 })),
    source: vi.fn(() => {
      // Return source node for edge collections (single edge)
      const sourceId = items[0]?.data?.source
      if (items.length === 1 && sourceId && mockData?.nodes) {
        const sourceNode = mockData.nodes.find((n: MockElement) => n.data?.id === sourceId)
        return createMockCollection(sourceNode ? [sourceNode] : [], mockData)
      }
      return createMockCollection([], mockData)
    }),
    target: vi.fn(() => {
      // Return target node for edge collections (single edge)
      const targetId = items[0]?.data?.target
      if (items.length === 1 && targetId && mockData?.nodes) {
        const targetNode = mockData.nodes.find((n: MockElement) => n.data?.id === targetId)
        return createMockCollection(targetNode ? [targetNode] : [], mockData)
      }
      return createMockCollection([], mockData)
    })
  }

  return collection
}

/**
 * Creates a mock layout object
 */
export function createMockLayout(): MockLayout {
  const handlers: Map<string, MockEventHandler[]> = new Map()

  const layout: MockLayout = {
    run: vi.fn(() => {
      // Trigger layoutstop handlers asynchronously (like real Cytoscape)
      setTimeout(() => {
        const layoutstopHandlers = handlers.get('layoutstop') || []
        layoutstopHandlers.forEach(handler => handler())
      }, 0)
      return layout
    }),
    on: vi.fn((event: string, handler: MockEventHandler) => {
      appendHandler(handlers, event, handler)
      return layout
    }),
    stop: vi.fn(() => layout)
  }
  return layout
}

/**
 * Creates a mock Cytoscape style object with chainable methods
 */
export function createMockStyle(): MockStyle {
  const style: MockStyle = {
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
  const mockData: MockData = {
    nodes: [],
    edges: [],
    eventHandlers: new Map<string, MockEventHandler[]>(),
    // Track zoom/pan state
    zoomLevel: 1,
    panPosition: { x: 0, y: 0 }
  }

  const cy: MockCytoscape = {
    _mockData: mockData,

    on: vi.fn(
      (
        event: string,
        selectorOrHandler: string | MockEventHandler,
        handler?: MockEventHandler
      ) => {
        // `on(event, selector)` without a handler is not a valid Cytoscape call, but the
        // original mock pushed whatever it was given; keep that shape by treating the
        // second argument as the handler.
        const actualHandler: MockEventHandler =
          handler || (selectorOrHandler as MockEventHandler)
        const key = handler ? `${event}:${selectorOrHandler}` : event

        appendHandler(mockData.eventHandlers, key, actualHandler)
        return cy
      }
    ),

    off: vi.fn(
      (
        event: string,
        selectorOrHandler?: string | MockEventHandler,
        handler?: MockEventHandler
      ) => {
        // Determine the key and handler to remove
        let key: string
        let handlerToRemove: MockEventHandler | undefined

        if (typeof selectorOrHandler === 'function') {
          // off(event, handler)
          key = event
          handlerToRemove = selectorOrHandler
        } else if (selectorOrHandler && handler) {
          // off(event, selector, handler)
          key = `${event}:${selectorOrHandler}`
          handlerToRemove = handler
        } else if (selectorOrHandler) {
          // off(event, selector) - remove all handlers for this event+selector
          key = `${event}:${selectorOrHandler}`
        } else {
          // off(event) - remove all handlers for this event
          key = event
        }

        if (handlerToRemove) {
          // Remove specific handler
          const handlers = mockData.eventHandlers.get(key)
          if (handlers) {
            const index = handlers.indexOf(handlerToRemove)
            if (index > -1) {
              handlers.splice(index, 1)
            }
          }
        } else {
          // Remove all handlers for the key
          mockData.eventHandlers.delete(key)
        }

        return cy
      }
    ),

    one: vi.fn(
      (
        event: string,
        selectorOrHandler: string | MockEventHandler,
        handler?: MockEventHandler
      ) => {
        const actualHandler: MockEventHandler =
          handler || (selectorOrHandler as MockEventHandler)
        const key = handler ? `${event}:${selectorOrHandler}` : event

        // Create a wrapper that removes itself after first execution
        const onceWrapper: MockEventHandler = (...args: unknown[]) => {
          // Remove this handler after first call
          const handlers = mockData.eventHandlers.get(key)
          if (handlers) {
            const index = handlers.indexOf(onceWrapper)
            if (index > -1) {
              handlers.splice(index, 1)
            }
          }
          // Call the actual handler
          return actualHandler(...args)
        }

        appendHandler(mockData.eventHandlers, key, onceWrapper)
        return cy
      }
    ),

    nodes: vi.fn(() => createMockCollection(mockData.nodes, mockData)),

    edges: vi.fn(() => createMockCollection(mockData.edges, mockData)),

    elements: vi.fn(() =>
      createMockCollection([...mockData.nodes, ...mockData.edges], mockData)
    ),

    add: vi.fn((elements: MockElement | MockElement[]) => {
      const elementsArray = Array.isArray(elements) ? elements : [elements]
      elementsArray.forEach(el => {
        // Element is an edge if explicitly declared OR has source/target (edge properties)
        const isEdge =
          el.group === 'edges' ||
          (el.data?.source !== undefined && el.data?.target !== undefined)
        if (isEdge) {
          mockData.edges.push(el)
        } else {
          mockData.nodes.push(el)
        }
      })
      return createMockCollection(elementsArray, mockData)
    }),

    remove: vi.fn((selector?: string | MockElement) => {
      if (!selector) {
        // Clear all elements
        mockData.nodes = []
        mockData.edges = []
      } else if (typeof selector === 'string') {
        // Handle selector-based removal
        if (selector.startsWith('#')) {
          // ID selector
          const id = selector.slice(1)
          mockData.nodes = mockData.nodes.filter(n => n.data?.id !== id)
          mockData.edges = mockData.edges.filter(e => e.data?.id !== id)
        } else if (selector === 'node') {
          mockData.nodes = []
        } else if (selector === 'edge') {
          mockData.edges = []
        }
      } else if (selector.data?.id) {
        // Remove specific element
        const id = selector.data.id
        mockData.nodes = mockData.nodes.filter(n => n.data?.id !== id)
        mockData.edges = mockData.edges.filter(e => e.data?.id !== id)
      }
      return cy
    }),

    layout: vi.fn(() => createMockLayout()),

    fit: vi.fn(() => cy),

    animate: vi.fn(() => cy),

    getElementById: vi.fn((id: string) => {
      const element = [...mockData.nodes, ...mockData.edges].find(
        el => el.data?.id === id
      )
      return createMockCollection(element ? [element] : [], mockData)
    }),

    $: vi.fn((selector: string) => {
      // Simple selector matching
      const id = selector.replace(/^#/, '')
      return cy.getElementById(id)
    }),

    destroy: vi.fn(),

    style: vi.fn(() => createMockStyle()),

    zoom: vi.fn((level?: number) => {
      if (level === undefined) {
        return mockData.zoomLevel
      }
      mockData.zoomLevel = level
      return cy
    }),

    center: vi.fn(() => cy),

    pan: vi.fn((position?: MockPosition) => {
      if (position === undefined) {
        return { ...mockData.panPosition }
      }
      mockData.panPosition = { ...position }
      return cy
    }),

    resize: vi.fn(() => cy),

    container: vi.fn(() => document.createElement('div')),

    batch: vi.fn((fn: () => void) => {
      fn()
      return cy
    }),

    startBatch: vi.fn(() => cy),

    endBatch: vi.fn(() => cy),

    json: vi.fn(() => ({
      elements: {
        nodes: mockData.nodes,
        edges: mockData.edges
      }
    })),

    ready: vi.fn((fn: () => void) => {
      fn()
      return cy
    })
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
  eventData: unknown
) {
  const key = selector ? `${event}:${selector}` : event
  const handlers = cy._mockData.eventHandlers.get(key) || []
  handlers.forEach(handler => handler(eventData))
}

/**
 * Test helper to create mock node event data
 */
export function createMockNodeEvent(nodeData: MockElementData) {
  return {
    target: {
      data: vi.fn(() => nodeData),
      addClass: vi.fn(),
      removeClass: vi.fn(),
      select: vi.fn(),
      unselect: vi.fn(),
      position: vi.fn(() => ({ x: 0, y: 0 })),
      renderedPosition: vi.fn(() => ({ x: 100, y: 100 })),
      id: vi.fn(() => nodeData.id)
    }
  }
}

/**
 * Test helper to create mock edge event data
 */
export function createMockEdgeEvent(edgeData: MockElementData) {
  return {
    target: {
      data: vi.fn(() => edgeData),
      addClass: vi.fn(),
      removeClass: vi.fn(),
      select: vi.fn(),
      unselect: vi.fn(),
      renderedMidpoint: vi.fn(() => ({ x: 100, y: 100 })),
      source: vi.fn(() => createMockCollection([{ data: { id: edgeData.source } }])),
      target: vi.fn(() => createMockCollection([{ data: { id: edgeData.target } }]))
    }
  }
}

// Default export - the cytoscape factory function
const cytoscape = vi.fn(() => createMockCytoscape())
export default cytoscape

// Reset function for tests
export function resetCytoscapeMock() {
  cytoscape.mockClear()
}
