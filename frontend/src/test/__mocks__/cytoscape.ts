import { vi } from 'vitest'

// Types for our mock
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
  [key: string]: any
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
  _mockData: {
    nodes: any[]
    edges: any[]
    eventHandlers: Map<string, Function[]>
  }
}

/**
 * Wraps a raw data item to look like a Cytoscape element with methods
 */
function wrapAsElement(item: any): any {
  return {
    data: (key?: string, value?: any) => {
      if (key === undefined) {
        return item.data || item
      }
      if (value === undefined) {
        return item.data?.[key] ?? item[key]
      }
      if (item.data) {
        item.data[key] = value
      }
      return wrapAsElement(item)
    },
    id: () => item.data?.id || item.id || '',
    position: (pos?: { x: number; y: number }) => {
      if (pos === undefined) {
        return item.position || { x: 0, y: 0 }
      }
      item.position = pos
      return wrapAsElement(item)
    },
    addClass: vi.fn(() => wrapAsElement(item)),
    removeClass: vi.fn(() => wrapAsElement(item)),
    select: vi.fn(() => wrapAsElement(item)),
    unselect: vi.fn(() => wrapAsElement(item)),
    renderedMidpoint: () => ({ x: 100, y: 100 }),
    source: () => createMockCollection([]),
    target: () => createMockCollection([])
  }
}

/**
 * Creates a mock Cytoscape collection with proper chaining support
 */
export function createMockCollection(items: any[] = []): MockCollection {
  const collection: MockCollection = {
    length: items.length,
    forEach: vi.fn((callback: (item: any, index: number) => void) => {
      items.forEach((item, index) => callback(wrapAsElement(item), index))
      return collection
    }),
    map: vi.fn((callback: (item: any, index: number) => any) =>
      items.map((item, index) => callback(wrapAsElement(item), index))
    ),
    filter: vi.fn((selectorOrCallback: string | ((item: any) => boolean)) => {
      if (typeof selectorOrCallback === 'function') {
        return createMockCollection(items.filter(selectorOrCallback))
      }
      // Simple selector support - return all for now
      return createMockCollection(items)
    }),
    remove: vi.fn(() => collection),
    addClass: vi.fn((_className: string) => collection),
    removeClass: vi.fn((_className: string) => collection),
    select: vi.fn(() => collection),
    unselect: vi.fn(() => collection),
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
    id: vi.fn(() => items[0]?.data?.id || ''),
    renderedMidpoint: vi.fn(() => ({ x: 100, y: 100 })),
    source: vi.fn(() => createMockCollection([])),
    target: vi.fn(() => createMockCollection([]))
  }

  return collection
}

/**
 * Creates a mock layout object
 */
export function createMockLayout(): MockLayout {
  const layout: MockLayout = {
    run: vi.fn(() => layout),
    on: vi.fn((_event: string, _handler: Function) => layout),
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

    off: vi.fn((_event: string, _selectorOrHandler?: string | Function) => {
      return cy
    }),

    one: vi.fn((event: string, selectorOrHandler: string | Function, handler?: Function) => {
      const actualHandler = handler || selectorOrHandler as Function
      const key = handler ? `${event}:${selectorOrHandler}` : event

      if (!mockData.eventHandlers.has(key)) {
        mockData.eventHandlers.set(key, [])
      }
      mockData.eventHandlers.get(key)!.push(actualHandler)
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

    fit: vi.fn((_eles?: any, _padding?: number) => cy),

    animate: vi.fn((_options: any, _animateOptions?: any) => cy),

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
      unselect: vi.fn(),
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

// Export types for external use
export type { MockCytoscape, MockCollection, MockLayout, MockStyle }
