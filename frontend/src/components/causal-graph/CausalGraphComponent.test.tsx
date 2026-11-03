import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { render, waitFor, screen, fireEvent, act } from '@testing-library/react'
import type { Core, CytoscapeOptions } from 'cytoscape'
import { CausalGraphComponent } from './CausalGraphComponent'
import { useGlobalStore } from '@/stores/globalStore'
import { Event, CausalRelationship } from '@/types'
import {
  MockCytoscape
} from '@/test/__mocks__/cytoscape'
import {
  setupCytoscapeTestEnvironment,
  getEventHandlers
} from '@/test/helpers/cytoscapeTestHelpers'
import { FIT_PADDING, getDefaultLayoutOptions } from '@/utils/layoutManagerUtils'
import { GRAPH_PALETTES } from './causalGraphPresentation'

/**
 * Shape of the store double created by the `vi.mock` factory below. Only the
 * members the component and these tests actually touch are modelled; `_mockState`
 * is the back door the tests use to swap the data per test case.
 */
interface MockStoreState {
  events: Event[]
  causalRelationships: CausalRelationship[]
  selectedEvents: string[]
  sessionData: {
    viewportState: {
      causalGraph: {
        layout: string
        nodePositions: Record<string, { x: number; y: number }>
      }
    }
  }
  updateSessionData: ReturnType<typeof vi.fn>
  addCausalRelationship: ReturnType<typeof vi.fn>
  addError: ReturnType<typeof vi.fn>
}

/** The mocked `useGlobalStore`, which supports both selector and plain calls. */
interface MockStoreHook {
  (selector?: (state: MockStoreState) => unknown): unknown
  getState: () => MockStoreState
  _mockState: MockStoreState
}

// Mock Cytoscape - the factory will be set up in beforeEach
vi.mock('cytoscape')

// Mock the global store with getState support and selector support
vi.mock('@/stores/globalStore', () => {
  const mockState: MockStoreState = {
    events: [],
    causalRelationships: [],
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
  }

  // Support both selector and no-selector usage
  const mockFn = vi.fn((selector?: (state: typeof mockState) => unknown) => {
    if (typeof selector === 'function') {
      return selector(mockState)
    }
    return mockState
  }) as unknown as MockStoreHook
  mockFn.getState = () => mockState
  mockFn._mockState = mockState

  return {
    useGlobalStore: mockFn
  }
})

// Shared spies for the hook functions the analysis tools call, so a test can
// assert on them across renders (the factories below run on every render).
const hookSpies = vi.hoisted(() => ({
  startExploration: vi.fn(),
  stopExploration: vi.fn(),
  loadSuggestions: vi.fn()
}))

// Mock hooks
vi.mock('@/hooks/useCausalPathExploration', () => ({
  default: () => ({
    availablePaths: [],
    currentHighlight: null,
    navigationState: { isNavigating: false, currentPathIndex: 0, currentStepIndex: 0, autoAdvance: false, autoAdvanceInterval: 2000 },
    isLoading: false,
    startExploration: hookSpies.startExploration,
    stopExploration: hookSpies.stopExploration,
    navigateToPath: vi.fn(),
    navigateToStep: vi.fn(),
    nextStep: vi.fn(),
    previousStep: vi.fn(),
    nextPath: vi.fn(),
    previousPath: vi.fn(),
    toggleAutoAdvance: vi.fn(),
    setAutoAdvanceInterval: vi.fn()
  })
}))

vi.mock('@/hooks/useCausalSuggestions', () => ({
  default: () => ({
    suggestions: [],
    isLoading: false,
    loadSuggestions: hookSpies.loadSuggestions,
    acceptSuggestion: vi.fn(),
    rejectSuggestion: vi.fn(),
    addFeedback: vi.fn()
  })
}))

// Mock child components
vi.mock('./CausalPathHighlighter', () => ({
  default: () => null
}))
vi.mock('./CausalChainNavigationControls', () => ({
  default: () => null
}))
vi.mock('./CausalSuggestionManager', () => ({
  default: () => null
}))
vi.mock('./CausalSuggestionOverlay', () => ({
  default: () => null
}))
vi.mock('./CausalGraphLayoutManager', () => ({
  CausalGraphLayoutManager: () => null
}))
vi.mock('./CausalGraphOverview', () => ({
  CausalGraphOverview: () => null
}))
vi.mock('./CausalGraphPerformanceManager', () => ({
  CausalGraphPerformanceManager: () => null
}))

// Mock API client
vi.mock('@/services/api', () => ({
  apiClient: {
    causal: {
      createLink: vi.fn().mockResolvedValue({
        id: 'new-rel',
        cause_event_id: '1',
        effect_event_id: '2',
        weight: 0.5,
        evidence: 'User-created relationship',
        confidence: 0.7,
        relationship_type: 'direct',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }),
      updateLink: vi.fn(),
      deleteLink: vi.fn(),
      findChain: vi.fn().mockResolvedValue([]),
      getSuggestions: vi.fn().mockResolvedValue([])
    }
  }
}))

// Import cytoscape after mocking
import cytoscape from 'cytoscape'

const mockUseGlobalStore = useGlobalStore as unknown as MockStoreHook

/**
 * `cytoscape` is an overloaded entry point (factory, registry accessor, registry
 * registrar). `vi.mocked` can only preserve the *last* overload, which returns
 * `void`, so the factory overload is restated here to give `mockReturnValue` the
 * right signature.
 */
const mockedCytoscape = vi.mocked(cytoscape) as unknown as Mock<
  (options?: CytoscapeOptions) => Core
>
// Get reference to the mock state for tests that need to check/modify it
const getMockStoreState = () => mockUseGlobalStore._mockState

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

  const mockCausalRelationships: CausalRelationship[] = [
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

  let mockCy: MockCytoscape

  beforeEach(() => {
    // Create a fresh mock for each test
    mockCy = setupCytoscapeTestEnvironment({
      events: mockEvents,
      relationships: mockCausalRelationships
    })

    // Set up cytoscape mock to return our instance
    mockedCytoscape.mockReturnValue(mockCy as unknown as Core)

    // Update the mock state with test data
    const mockState = mockUseGlobalStore._mockState
    if (mockState) {
      mockState.events = mockEvents
      mockState.causalRelationships = mockCausalRelationships
      mockState.selectedEvents = []
      mockState.updateSessionData = vi.fn()
      mockState.addCausalRelationship = vi.fn()
      mockState.addError = vi.fn()
    }
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('renders the causal graph container', async () => {
      render(<CausalGraphComponent />)

      const container = document.querySelector('.causal-graph-container')
      expect(container).toBeInTheDocument()
    })

    it('initializes Cytoscape and sets up event handlers', async () => {
      render(<CausalGraphComponent />)

      // Verify Cytoscape was initialized by checking that event handlers were set up
      await waitFor(() => {
        expect(mockCy.on).toHaveBeenCalled()
      })
    })

    it('applies custom className', () => {
      render(<CausalGraphComponent className="custom-class" />)

      const container = document.querySelector('.causal-graph-container')
      expect(container).toHaveClass('custom-class')
    })
  })

  describe('Node labels', () => {
    it('maps each node label into the base node style', async () => {
      render(<CausalGraphComponent />)

      await waitFor(() => expect(mockedCytoscape).toHaveBeenCalled())
      const options = mockedCytoscape.mock.calls[0]?.[0]
      const styles = (options?.style ?? []) as Array<{ selector: string; style: Record<string, unknown> }>
      const nodeStyle = styles.find((entry) => entry.selector === 'node')?.style
      // Without this mapping Cytoscape draws every event as an anonymous circle.
      expect(nodeStyle?.label).toBe('data(label)')
      // The label sits outside the node, so it must not be white on the canvas.
      expect(nodeStyle?.color).not.toBe('#FFFFFF')
    })

    it('hides labels that would be too small to read rather than drawing them unreadably', async () => {
      render(<CausalGraphComponent />)

      await waitFor(() => expect(mockedCytoscape).toHaveBeenCalled())
      const styles = (mockedCytoscape.mock.calls[0]?.[0]?.style ?? []) as Array<{ selector: string; style: Record<string, unknown> }>
      const nodeStyle = styles.find((entry) => entry.selector === 'node')?.style
      expect(nodeStyle?.['min-zoomed-font-size']).toBeGreaterThanOrEqual(8)
      expect(nodeStyle?.['font-size']).toBe('12px')
      expect(nodeStyle?.['text-wrap']).toBe('wrap')
      expect(nodeStyle?.['text-max-width']).toBeDefined()
      // A divergence point keeps readable ink: white text vanished on the label pill.
      const divergence = styles.find((entry) => entry.selector === 'node.divergence-point')?.style
      expect(divergence?.color).toBeUndefined()
    })

    it('labels each node with its event description, shortened to fit', async () => {
      const mockState = getMockStoreState()
      mockState.events = [
        { ...mockEvents[0]!, description: 'Babbage completes the Analytical Engine in London' },
        { ...mockEvents[1]!, description: '' }
      ]
      mockState.causalRelationships = []

      render(<CausalGraphComponent />)

      await waitFor(() => {
        expect(mockCy.add).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({ data: expect.objectContaining({ id: '1', label: 'Babbage completes the Analy…' }) }),
            // No description: the actor pair is all there is to say.
            expect.objectContaining({ data: expect.objectContaining({ id: '2', label: 'Actor 2 → Target 2' }) })
          ])
        )
      })
    })

    it('shows the full description, actor → target and UTC date in the hover tooltip', async () => {
      render(<CausalGraphComponent />)

      await waitFor(() => {
        expect(getEventHandlers(mockCy, 'mouseover', 'node').length).toBeGreaterThan(0)
      })

      act(() => {
        getEventHandlers(mockCy, 'mouseover', 'node')[0]!({
          target: {
            data: () => ({ id: '1', event: mockEvents[0] }),
            addClass: vi.fn(),
            renderedPosition: vi.fn(() => ({ x: 100, y: 100 }))
          }
        })
      })

      const tooltip = screen.getByRole('tooltip')
      expect(tooltip).toHaveTextContent('Event 1')
      expect(tooltip).toHaveTextContent('Actor 1 → Target 1')
      expect(tooltip).toHaveTextContent('Jan 1, 2023')
      // The canvas points assistive technology at the tooltip while it is open.
      expect(screen.getByRole('application')).toHaveAttribute('aria-describedby', tooltip.id)
    })

    it('announces the event keyboard navigation moves to, in full', async () => {
      render(<CausalGraphComponent />)

      const canvas = screen.getByRole('application')
      fireEvent.keyDown(canvas, { key: 'ArrowRight' })

      await waitFor(() => {
        expect(screen.getByText('Event 1. Actor 1 → Target 1. Jan 1, 2023')).toBeInTheDocument()
      })
    })
  })

  describe('Framing the graph', () => {
    it('hides labels that would overprint another, keeping one per crowded spot', async () => {
      const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
        cb(0)
        return 1
      })
      try {
        render(<CausalGraphComponent />)
        await waitFor(() => {
          expect(getEventHandlers(mockCy, 'layoutstop').length).toBeGreaterThan(0)
        })
        // Stack every node on one spot so their label boxes coincide
        mockCy._mockData.nodes.forEach((node) => {
          node.position = { x: 0, y: 0 }
        })
        getEventHandlers(mockCy, 'layoutstop')[0]!()

        // The last pass decides: read each node's most recent label-culled call
        type Spied = { id: () => string; addClass: ReturnType<typeof vi.fn>; removeClass: ReturnType<typeof vi.fn> }
        const lastCall = (fn: ReturnType<typeof vi.fn>) =>
          Math.max(-1, ...fn.mock.invocationCallOrder.filter((_, i) => fn.mock.calls[i]?.[0] === 'label-culled'))
        const state = new Map<string, 'shown' | 'culled'>()
        mockCy.nodes().forEach((node: Spied) => {
          state.set(node.id(), lastCall(node.addClass) > lastCall(node.removeClass) ? 'culled' : 'shown')
        })
        const values = [...state.values()]
        expect(values.filter((v) => v === 'shown')).toHaveLength(1)
        expect(values.filter((v) => v === 'culled').length).toBe(state.size - 1)

        // A culled label comes back for the node being looked at
        const styles = (mockedCytoscape.mock.calls[0]?.[0]?.style ?? []) as Array<{ selector: string; style: Record<string, unknown> }>
        expect(styles.find((e) => e.selector === 'node.label-culled')?.style['text-opacity']).toBe(0)
        expect(styles.find((e) => e.selector.includes('node.label-culled:selected'))?.style['text-opacity']).toBe(1)
      } finally {
        raf.mockRestore()
      }
    })

    it('refits the graph once a layout has settled', async () => {
      render(<CausalGraphComponent />)

      await waitFor(() => {
        expect(getEventHandlers(mockCy, 'layoutstop').length).toBeGreaterThan(0)
      })
      mockCy.fit.mockClear()

      getEventHandlers(mockCy, 'layoutstop')[0]!()

      expect(mockCy.fit).toHaveBeenCalledWith(undefined, FIT_PADDING)
    })

    it('resizes and refits the canvas when its container changes size', async () => {
      let notify: ResizeObserverCallback | null = null
      const observed: Element[] = []
      const disconnect = vi.fn()
      class CapturingResizeObserver {
        constructor(callback: ResizeObserverCallback) {
          notify = callback
        }
        observe(target: Element) {
          observed.push(target)
        }
        unobserve() {}
        disconnect = disconnect
      }
      const original = globalThis.ResizeObserver
      globalThis.ResizeObserver = CapturingResizeObserver as unknown as typeof ResizeObserver
      const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
        cb(0)
        return 1
      })

      try {
        const { unmount } = render(<CausalGraphComponent />)

        await waitFor(() => expect(notify).not.toBeNull())
        expect(observed).toContain(screen.getByRole('application'))
        mockCy.fit.mockClear()
        mockCy.resize.mockClear()

        const resizeTo = (width: number, height: number) =>
          notify!([{ contentRect: { width, height } } as unknown as ResizeObserverEntry], {} as ResizeObserver)

        resizeTo(800, 600)
        expect(mockCy.resize).toHaveBeenCalledTimes(1)
        expect(mockCy.fit).toHaveBeenCalledWith(undefined, FIT_PADDING)

        // The same size again, or a hidden (zero-size) container, is not a resize.
        resizeTo(800, 600)
        resizeTo(0, 0)
        expect(mockCy.resize).toHaveBeenCalledTimes(1)

        unmount()
        expect(disconnect).toHaveBeenCalled()
      } finally {
        globalThis.ResizeObserver = original
        raf.mockRestore()
      }
    })
  })

  describe('Event Handling', () => {
    it('sets up node click handlers', async () => {
      render(<CausalGraphComponent />)

      await waitFor(() => {
        expect(mockCy.on).toHaveBeenCalledWith('tap', 'node', expect.any(Function))
      })
    })

    it('sets up edge click handlers', async () => {
      render(<CausalGraphComponent />)

      await waitFor(() => {
        expect(mockCy.on).toHaveBeenCalledWith('tap', 'edge', expect.any(Function))
      })
    })

    it('sets up node hover handlers', async () => {
      render(<CausalGraphComponent />)

      await waitFor(() => {
        expect(mockCy.on).toHaveBeenCalledWith('mouseover', 'node', expect.any(Function))
        expect(mockCy.on).toHaveBeenCalledWith('mouseout', 'node', expect.any(Function))
      })
    })

    it('sets up edge hover handlers', async () => {
      render(<CausalGraphComponent />)

      await waitFor(() => {
        expect(mockCy.on).toHaveBeenCalledWith('mouseover', 'edge', expect.any(Function))
        expect(mockCy.on).toHaveBeenCalledWith('mouseout', 'edge', expect.any(Function))
      })
    })

    it('sets up layoutstop handler', async () => {
      render(<CausalGraphComponent />)

      await waitFor(() => {
        expect(mockCy.on).toHaveBeenCalledWith('layoutstop', expect.any(Function))
      })
    })

    it('calls onNodeClick when a node is clicked', async () => {
      const onNodeClick = vi.fn()
      render(<CausalGraphComponent onNodeClick={onNodeClick} />)

      await waitFor(() => {
        expect(mockCy.on).toHaveBeenCalledWith('tap', 'node', expect.any(Function))
      })

      // Get the handler that was registered
      const handlers = getEventHandlers(mockCy, 'tap', 'node')
      expect(handlers.length).toBeGreaterThan(0)

      // Simulate node click
      const mockEvent = {
        target: {
          data: () => ({
            id: '1',
            event: mockEvents[0]
          })
        }
      }
      handlers[0]!(mockEvent)

      expect(onNodeClick).toHaveBeenCalledWith(mockEvents[0])
    })

    it('calls onEdgeClick when an edge is clicked', async () => {
      const onEdgeClick = vi.fn()
      render(<CausalGraphComponent onEdgeClick={onEdgeClick} />)

      await waitFor(() => {
        expect(mockCy.on).toHaveBeenCalledWith('tap', 'edge', expect.any(Function))
      })

      const handlers = getEventHandlers(mockCy, 'tap', 'edge')
      expect(handlers.length).toBeGreaterThan(0)

      const mockEvent = {
        target: {
          data: () => ({
            id: 'rel1',
            relationship: mockCausalRelationships[0]
          })
        }
      }
      handlers[0]!(mockEvent)

      expect(onEdgeClick).toHaveBeenCalledWith(mockCausalRelationships[0])
    })

    it('calls onNodeHover when a node is hovered', async () => {
      const onNodeHover = vi.fn()
      render(<CausalGraphComponent onNodeHover={onNodeHover} />)

      await waitFor(() => {
        expect(mockCy.on).toHaveBeenCalledWith('mouseover', 'node', expect.any(Function))
      })

      const handlers = getEventHandlers(mockCy, 'mouseover', 'node')
      expect(handlers.length).toBeGreaterThan(0)

      const mockEvent = {
        target: {
          data: () => ({
            id: '1',
            event: mockEvents[0]
          }),
          addClass: vi.fn(),
          renderedPosition: vi.fn(() => ({ x: 100, y: 100 }))
        }
      }
      handlers[0]!(mockEvent)

      expect(onNodeHover).toHaveBeenCalledWith(mockEvents[0])
      expect(mockEvent.target.addClass).toHaveBeenCalledWith('highlighted')
    })

    it('calls onEdgeHover when an edge is hovered', async () => {
      const onEdgeHover = vi.fn()
      render(<CausalGraphComponent onEdgeHover={onEdgeHover} />)

      await waitFor(() => {
        expect(mockCy.on).toHaveBeenCalledWith('mouseover', 'edge', expect.any(Function))
      })

      const handlers = getEventHandlers(mockCy, 'mouseover', 'edge')
      expect(handlers.length).toBeGreaterThan(0)

      const mockEvent = {
        target: {
          data: () => ({
            id: 'rel1',
            relationship: mockCausalRelationships[0]
          }),
          addClass: vi.fn(),
          renderedMidpoint: () => ({ x: 100, y: 100 })
        }
      }
      handlers[0]!(mockEvent)

      expect(onEdgeHover).toHaveBeenCalledWith(mockCausalRelationships[0])
      expect(mockEvent.target.addClass).toHaveBeenCalledWith('highlighted show-label')
    })
  })

  describe('Data Management', () => {
    it('adds nodes and edges to graph', async () => {
      render(<CausalGraphComponent />)

      await waitFor(() => {
        expect(mockCy.add).toHaveBeenCalled()
      })

      const addCalls = mockCy.add.mock.calls
      expect(addCalls.length).toBeGreaterThan(0)
    })

    it('clears elements before updating', async () => {
      const { rerender } = render(<CausalGraphComponent />)

      await waitFor(() => {
        expect(mockCy.add).toHaveBeenCalled()
      })

      vi.clearAllMocks()

      // Update store data
      const mockState = getMockStoreState()
      mockState.events = [...mockEvents, {
        id: '3',
        description: 'Event 3',
        actor: 'Actor 3',
        target: 'Target 3',
        timestamp: '2023-01-03T00:00:00Z',
        created_at: '2023-01-03T00:00:00Z',
        updated_at: '2023-01-03T00:00:00Z'
      }]

      rerender(<CausalGraphComponent />)

      // Verify elements() was called (which internally handles clearing)
      await waitFor(() => {
        expect(mockCy.elements).toHaveBeenCalled()
      })
    })

    it('transforms data correctly for Cytoscape', async () => {
      render(<CausalGraphComponent />)

      await waitFor(() => {
        expect(mockCy.add).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({
              data: expect.objectContaining({
                id: '1',
                event: mockEvents[0],
                // Labelled with what happened, not with the actor pair.
                label: 'Event 1'
              })
            }),
            expect.objectContaining({
              data: expect.objectContaining({
                id: '2',
                event: mockEvents[1],
                label: 'Event 2'
              })
            }),
            expect.objectContaining({
              data: expect.objectContaining({
                id: 'rel1',
                source: '1',
                target: '2',
                relationship: mockCausalRelationships[0]
              })
            })
          ])
        )
      })
    })

    it('handles empty data gracefully', async () => {
      const mockState = getMockStoreState()
      mockState.events = []
      mockState.causalRelationships = []

      render(<CausalGraphComponent />)

      await waitFor(() => {
        expect(mockCy.add).toHaveBeenCalledWith([])
      })
    })
  })

  describe('Layout Management', () => {
    it('applies initial layout', async () => {
      render(<CausalGraphComponent />)

      await waitFor(() => {
        expect(mockCy.layout).toHaveBeenCalledWith(
          expect.objectContaining({ name: 'cose' })
        )
      })
    })

    it('runs layout when applied', async () => {
      render(<CausalGraphComponent />)

      // Verify layout() was called with correct options
      await waitFor(() => {
        expect(mockCy.layout).toHaveBeenCalled()
      })
    })

    it('saves layout positions when layout stops', async () => {
      render(<CausalGraphComponent />)

      await waitFor(() => {
        expect(mockCy.on).toHaveBeenCalledWith('layoutstop', expect.any(Function))
      })

      const handlers = getEventHandlers(mockCy, 'layoutstop')
      expect(handlers.length).toBeGreaterThan(0)

      // Mock nodes with positions
      mockCy.nodes.mockReturnValue({
        forEach: (callback: (node: { id: () => string; position: () => { x: number; y: number } }) => void) => {
          callback({
            id: () => '1',
            position: () => ({ x: 100, y: 200 })
          })
          callback({
            id: () => '2',
            position: () => ({ x: 300, y: 400 })
          })
        },
        // layoutstop also re-applies zoom-scaled label sizing to the nodes
        style: vi.fn()
      })

      handlers[0]!()

      const mockState = getMockStoreState()
      expect(mockState.updateSessionData).toHaveBeenCalledWith({
        viewportState: {
          ...mockState.sessionData.viewportState,
          causalGraph: {
            ...mockState.sessionData.viewportState.causalGraph,
            nodePositions: {
              '1': { x: 100, y: 200 },
              '2': { x: 300, y: 400 }
            }
          }
        }
      })
    })
  })

  describe('Analysis tools', () => {
    const tapNode = async (event: Event) => {
      const handlers = getEventHandlers(mockCy, 'tap', 'node')
      await act(async () => {
        handlers[handlers.length - 1]!({
          target: { data: () => ({ id: event.id, event }), hasClass: () => false }
        })
      })
    }

    it('only selects a tapped node: it does not open path exploration or suggestions', async () => {
      const onNodeClick = vi.fn()
      render(<CausalGraphComponent onNodeClick={onNodeClick} />)
      await waitFor(() => expect(mockCy.on).toHaveBeenCalledWith('tap', 'node', expect.any(Function)))

      await tapNode(mockEvents[0]!)

      expect(onNodeClick).toHaveBeenCalledWith(mockEvents[0])
      expect(hookSpies.startExploration).not.toHaveBeenCalled()
      expect(hookSpies.loadSuggestions).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: 'Explore Paths' })).toHaveAttribute('aria-pressed', 'false')
      expect(screen.getByRole('button', { name: 'Suggest Links' })).toHaveAttribute('aria-pressed', 'false')
    })

    it('does not open the tools when the focused event changes', async () => {
      const { rerender } = render(<CausalGraphComponent />)
      await waitFor(() => expect(mockCy.add).toHaveBeenCalled())
      rerender(<CausalGraphComponent focusEventId="1" />)
      await waitFor(() => expect(mockCy.getElementById).toHaveBeenCalledWith('1'))

      expect(hookSpies.startExploration).not.toHaveBeenCalled()
      expect(hookSpies.loadSuggestions).not.toHaveBeenCalled()
    })

    it('marks the tools unavailable, with a reason, until an event is selected', () => {
      render(<CausalGraphComponent />)
      const explore = screen.getByRole('button', { name: 'Explore Paths' })
      expect(explore).toHaveAttribute('aria-disabled', 'true')
      expect(explore).toHaveAttribute('title', expect.stringMatching(/Select an event/))

      fireEvent.click(explore)
      expect(hookSpies.startExploration).not.toHaveBeenCalled()
      expect(explore).toHaveAttribute('aria-pressed', 'false')
    })

    it('opens one tool at a time for the tapped event', async () => {
      render(<CausalGraphComponent />)
      await waitFor(() => expect(mockCy.on).toHaveBeenCalledWith('tap', 'node', expect.any(Function)))
      await tapNode(mockEvents[1]!)

      const explore = screen.getByRole('button', { name: 'Explore Paths' })
      const suggest = screen.getByRole('button', { name: 'Suggest Links' })
      expect(explore).not.toHaveAttribute('aria-disabled')

      fireEvent.click(explore)
      expect(explore).toHaveAttribute('aria-pressed', 'true')
      await waitFor(() => expect(hookSpies.startExploration).toHaveBeenCalledWith('2'))

      fireEvent.click(suggest)
      expect(suggest).toHaveAttribute('aria-pressed', 'true')
      expect(explore).toHaveAttribute('aria-pressed', 'false')
      expect(hookSpies.stopExploration).toHaveBeenCalled()
      await waitFor(() => expect(hookSpies.loadSuggestions).toHaveBeenCalledWith('2'))

      fireEvent.click(suggest)
      expect(suggest).toHaveAttribute('aria-pressed', 'false')
    })

    it('respects enablePathExploration and enableSuggestions', () => {
      render(<CausalGraphComponent enablePathExploration={false} enableSuggestions={false} />)
      expect(screen.queryByRole('button', { name: 'Explore Paths' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Suggest Links' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Draw Link' })).toBeInTheDocument()
    })
  })

  describe('Focus Event', () => {
    it('focuses on event when focusEventId prop changes', async () => {
      const { rerender } = render(<CausalGraphComponent />)

      await waitFor(() => {
        expect(mockCy.add).toHaveBeenCalled()
      })

      rerender(<CausalGraphComponent focusEventId="1" />)

      await waitFor(() => {
        expect(mockCy.getElementById).toHaveBeenCalledWith('1')
        expect(mockCy.animate).toHaveBeenCalledWith(
          expect.objectContaining({
            zoom: 1.5
          }),
          expect.objectContaining({
            duration: 500
          })
        )
      })
    })
  })

  describe('Cleanup', () => {
    it('cleans up Cytoscape instance on unmount', async () => {
      const { unmount } = render(<CausalGraphComponent />)

      await waitFor(() => {
        expect(mockCy.add).toHaveBeenCalled()
      })

      unmount()

      expect(mockCy.destroy).toHaveBeenCalled()
    })
  })

  describe('Props', () => {
    it('respects maxDepth prop', async () => {
      render(<CausalGraphComponent maxDepth={5} />)

      const container = document.querySelector('.causal-graph-container')
      expect(container).toBeInTheDocument()

      await waitFor(() => {
        expect(mockCy.add).toHaveBeenCalled()
      })
    })

    it('uses explicit events and causalRelationships props when provided instead of store', async () => {
      const propEvents: Event[] = [
        {
          id: 'prop-event-1',
          description: 'Prop Event 1',
          actor: 'Actor A',
          target: 'Target B',
          timestamp: '2023-01-01T00:00:00Z',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z'
        }
      ]
      const propRelationships: CausalRelationship[] = []

      render(
        <CausalGraphComponent
          events={propEvents}
          causalRelationships={propRelationships}
        />
      )

      await waitFor(() => {
        expect(mockCy.add).toHaveBeenCalled()
      })

      const addedElements = (mockCy.add.mock.calls[0] as unknown[][])[0] as Array<{ data: { id: string } }>
      const addedIds = addedElements.map((el) => el.data.id)
      expect(addedIds).toContain('prop-event-1')
      expect(addedIds).not.toContain('1')
      expect(addedIds).not.toContain('2')
    })
  })

  describe('Cross-Graph References', () => {
    it('synthesizes foreign placeholder nodes and styles cross-graph edges with distinct classes', async () => {
      const localEvents: Event[] = [
        {
          id: 'local-event-1',
          description: 'Local Event',
          actor: 'Local Actor',
          target: 'Local Target',
          timestamp: '2023-01-01T00:00:00Z',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z'
        }
      ]

      const crossGraphRelationships: CausalRelationship[] = [
        {
          id: 'cross-rel-1',
          cause_event_id: 'local-event-1',
          effect_event_id: 'foreign-event-99',
          weight: 0.85,
          evidence: 'Cross-graph causal influence',
          confidence: 0.9,
          relationship_type: 'direct',
          isCrossGraph: true,
          effectGraphId: 'graph-beta',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z'
        }
      ]

      render(
        <CausalGraphComponent
          events={localEvents}
          causalRelationships={crossGraphRelationships}
        />
      )

      await waitFor(() => {
        expect(mockCy.add).toHaveBeenCalled()
      })

      const addedElements = (mockCy.add.mock.calls[0] as unknown[][])[0] as Array<{
        data: { id: string; crossGraphLabel?: string }
        classes?: string
      }>

      // Verify foreign placeholder node was synthesized
      const foreignNode = addedElements.find(el => el.data.id === 'foreign-event-99')
      expect(foreignNode).toBeDefined()
      expect(foreignNode?.classes).toBe('foreign-node')

      // Verify cross-graph edge was created with distinct styling class
      const crossEdge = addedElements.find(el => el.data.id === 'cross-rel-1')
      expect(crossEdge).toBeDefined()
      expect(crossEdge?.classes).toBe('cross-graph')
      expect(crossEdge?.data.crossGraphLabel).toContain('graph-be')
    })

    it('applies divergence-point class to nodes matching divergenceEventIds', async () => {
      const events: Event[] = [
        {
          id: 'event-pod',
          actor: 'Actor A',
          target: 'Target B',
          description: 'Pivotal Divergence Event',
          timestamp: '2023-01-01T00:00:00Z',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z',
        },
        {
          id: 'event-standard',
          actor: 'Actor C',
          target: 'Target D',
          description: 'Standard Event',
          timestamp: '2023-01-02T00:00:00Z',
          created_at: '2023-01-02T00:00:00Z',
          updated_at: '2023-01-02T00:00:00Z',
        },
      ]

      render(
        <CausalGraphComponent
          events={events}
          divergenceEventIds={['event-pod']}
        />
      )

      await waitFor(() => {
        expect(mockCy.add).toHaveBeenCalled()
      })

      const addedElements = (mockCy.add.mock.calls[0] as unknown[][])[0] as Array<{
        data: { id: string }
        classes?: string
      }>

      const podNode = addedElements.find(el => el.data.id === 'event-pod')
      expect(podNode).toBeDefined()
      expect(podNode?.classes).toContain('divergence-point')

      const standardNode = addedElements.find(el => el.data.id === 'event-standard')
      expect(standardNode).toBeDefined()
      expect(standardNode?.classes).toBeUndefined()
    })
  })
  describe('Theme and relationship types', () => {
    type Rule = { selector: string; style: Record<string, unknown> }
    const initialSheet = () => (mockedCytoscape.mock.calls[0]?.[0]?.style ?? []) as Rule[]
    const rule = (sheet: Rule[], selector: string) => sheet.find((r) => r.selector === selector)?.style

    afterEach(() => {
      document.documentElement.classList.remove('dark', 'high-contrast')
    })

    it('draws each relationship type in its own colour and line style', async () => {
      render(<CausalGraphComponent />)
      await waitFor(() => expect(mockedCytoscape).toHaveBeenCalled())
      const sheet = initialSheet()
      const light = GRAPH_PALETTES.light

      // Direct is the base edge: solid
      expect(rule(sheet, 'edge')).toMatchObject({ 'line-style': 'solid', 'line-color': light.edgeDirect, opacity: 1 })
      expect(rule(sheet, 'edge[relationshipType = "indirect"]')).toMatchObject({
        'line-style': 'dashed', 'line-color': light.edgeIndirect, 'target-arrow-color': light.edgeIndirect
      })
      expect(rule(sheet, 'edge[relationshipType = "contributory"]')).toMatchObject({
        'line-style': 'dashed', 'line-cap': 'round', 'line-color': light.edgeContributory
      })
      // The old weight-coloured rules are gone: width carries the weight
      expect(sheet.some((r) => r.selector.includes('weight'))).toBe(false)
      expect(rule(sheet, 'node')).toMatchObject({ 'background-color': light.nodeFill, 'border-color': light.nodeBorder })
      // No raw hex outside the palette and the label ink/surface
      const allowed = new Set<unknown>([...Object.values(light), '#18181b', '#475569', '#ffffff', '#e2dfd7'])
      for (const r of sheet) {
        for (const [key, value] of Object.entries(r.style)) {
          if (typeof value === 'string' && value.startsWith('#')) expect(allowed.has(value), `${r.selector} ${key}`).toBe(true)
        }
      }
    })

    it('gives each edge its relationship type to style by', async () => {
      render(<CausalGraphComponent />)
      await waitFor(() => {
        expect(mockCy.add).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({ data: expect.objectContaining({ id: 'rel1', relationshipType: 'direct' }) })
          ])
        )
      })
    })

    it('starts in the dark palette when the page is dark', async () => {
      document.documentElement.classList.add('dark')
      render(<CausalGraphComponent />)
      await waitFor(() => expect(mockedCytoscape).toHaveBeenCalled())
      expect(rule(initialSheet(), 'edge')?.['line-color']).toBe(GRAPH_PALETTES.dark.edgeDirect)
    })

    it('replaces the whole stylesheet when dark mode or high contrast is switched on', async () => {
      render(<CausalGraphComponent />)
      await waitFor(() => expect(screen.queryByText('Initializing causal graph...')).not.toBeInTheDocument())
      mockCy.style.mockClear()

      const lastSheet = () => {
        const calls = mockCy.style.mock.calls.filter((call) => Array.isArray(call[0]))
        return calls[calls.length - 1]?.[0] as Rule[] | undefined
      }

      act(() => {
        document.documentElement.classList.add('dark')
      })
      await waitFor(() => expect(lastSheet()).toBeDefined())
      expect(rule(lastSheet()!, 'edge')?.['line-color']).toBe(GRAPH_PALETTES.dark.edgeDirect)
      expect(rule(lastSheet()!, 'node:selected')?.['background-color']).toBe(GRAPH_PALETTES.dark.selectedFill)

      mockCy.style.mockClear()
      act(() => {
        document.documentElement.classList.add('high-contrast')
      })
      await waitFor(() => expect(lastSheet()).toBeDefined())
      const hc = lastSheet()!
      expect(rule(hc, 'edge')?.['line-color']).toBe(GRAPH_PALETTES['high-contrast-dark'].edgeDirect)
      // High contrast also thickens the lines
      expect(rule(hc, 'edge')?.width).toBe('mapData(weight, 0, 1, 3, 9)')

      // The legend follows too
      const legend = screen.getByRole('note', { name: 'Legend' })
      expect(legend.querySelector('line')?.getAttribute('stroke')).toBe(GRAPH_PALETTES['high-contrast-dark'].edgeDirect)
    })

    it('keeps a legend that names each type by its line style', () => {
      render(<CausalGraphComponent />)
      const legend = screen.getByRole('note', { name: 'Legend' })
      expect(legend).toHaveTextContent('Direct (solid)')
      expect(legend).toHaveTextContent('Indirect (dashed)')
      expect(legend).toHaveTextContent('Contributory (dotted)')
      expect(legend).toHaveTextContent('Thicker = more weight')
      expect(legend).not.toHaveTextContent('Point of divergence')
    })

    it('adds divergence points to the legend when there are any', () => {
      render(<CausalGraphComponent divergenceEventIds={['1']} />)
      expect(screen.getByRole('note', { name: 'Legend' })).toHaveTextContent('Point of divergence')
    })
  })

  describe('Using the canvas', () => {
    it('lays the graph out with the shared, tuned force options', async () => {
      render(<CausalGraphComponent />)
      await waitFor(() => {
        expect(mockCy.layout).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'cose',
            idealEdgeLength: getDefaultLayoutOptions('cose').idealEdgeLength,
            nodeRepulsion: getDefaultLayoutOptions('cose').nodeRepulsion,
            componentSpacing: getDefaultLayoutOptions('cose').componentSpacing,
            gravity: getDefaultLayoutOptions('cose').gravity,
            padding: FIT_PADDING
          })
        )
      })
    })

    it('stretches a force layout to the canvas aspect before fitting it', async () => {
      render(<CausalGraphComponent />)
      await waitFor(() => {
        expect(getEventHandlers(mockCy, 'layoutstop').length).toBeGreaterThan(0)
      })
      // A square 200x200 cloud on an 800x400 canvas (740x340 inside the padding)
      mockCy._mockData.nodes.forEach((node, i) => {
        node.position = i % 2 ? { x: 200, y: 200 } : { x: 0, y: 0 }
      })
      mockCy.fit.mockClear()

      getEventHandlers(mockCy, 'layoutstop')[0]!({ layout: { options: { name: 'cose' } } })

      const xs = mockCy._mockData.nodes.map((n) => n.position!.x)
      const ys = mockCy._mockData.nodes.map((n) => n.position!.y)
      const width = Math.max(...xs) - Math.min(...xs)
      const height = Math.max(...ys) - Math.min(...ys)
      expect(height).toBe(200)
      expect(width / height).toBeCloseTo(740 / 340, 5)
      // Then framed
      expect(mockCy.fit).toHaveBeenCalledWith(undefined, FIT_PADDING)
    })

    it('leaves a layered layout its own shape', async () => {
      render(<CausalGraphComponent />)
      await waitFor(() => {
        expect(getEventHandlers(mockCy, 'layoutstop').length).toBeGreaterThan(0)
      })
      mockCy._mockData.nodes.forEach((node, i) => {
        node.position = i % 2 ? { x: 200, y: 200 } : { x: 0, y: 0 }
      })

      getEventHandlers(mockCy, 'layoutstop')[0]!({ layout: { options: { name: 'dagre' } } })

      mockCy._mockData.nodes.forEach((node, i) => {
        expect(node.position).toEqual(i % 2 ? { x: 200, y: 200 } : { x: 0, y: 0 })
      })
    })
  })
})
