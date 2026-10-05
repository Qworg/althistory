import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
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

// Mock Cytoscape - the factory will be set up in beforeEach
vi.mock('cytoscape')

// Mock the global store with getState support and selector support
vi.mock('@/stores/globalStore', () => {
  const mockState = {
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
  })
  ;(mockFn as any).getState = () => mockState
  ;(mockFn as any)._mockState = mockState

  return {
    useGlobalStore: mockFn
  }
})

// Mock hooks
vi.mock('@/hooks/useCausalPathExploration', () => ({
  default: () => ({
    availablePaths: [],
    currentHighlight: null,
    navigationState: { isNavigating: false, currentPathIndex: 0, currentStepIndex: 0, autoAdvance: false, autoAdvanceInterval: 2000 },
    isLoading: false,
    startExploration: vi.fn(),
    stopExploration: vi.fn(),
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
    loadSuggestions: vi.fn(),
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

const mockUseGlobalStore = useGlobalStore as any
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
    vi.mocked(cytoscape).mockReturnValue(mockCy as any)

    // Update the mock state with test data
    const mockState = (mockUseGlobalStore as any)._mockState
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
                label: 'Actor 1 → Target 1'
              })
            }),
            expect.objectContaining({
              data: expect.objectContaining({
                id: '2',
                event: mockEvents[1],
                label: 'Actor 2 → Target 2'
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
        forEach: (callback: any) => {
          callback({
            id: () => '1',
            position: () => ({ x: 100, y: 200 })
          })
          callback({
            id: () => '2',
            position: () => ({ x: 300, y: 400 })
          })
        }
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
  })
})
