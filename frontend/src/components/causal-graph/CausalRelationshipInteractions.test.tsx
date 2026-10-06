import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { act } from 'react'
import type { Core, CytoscapeOptions } from 'cytoscape'
import userEvent from '@testing-library/user-event'
import { CausalGraphComponent } from './CausalGraphComponent'
import { useGlobalStore } from '@/stores/globalStore'
import { apiClient } from '@/services/api'
import { Event, CausalRelationship } from '@/types'
import {
  MockCytoscape
} from '@/test/__mocks__/cytoscape'
import {
  setupCytoscapeTestEnvironment,
  getEventHandlers
} from '@/test/helpers/cytoscapeTestHelpers'

/**
 * Shape of the store double created by the `vi.mock` factory below; the tests
 * assert against its action mocks and swap in per-test data through `_mockState`.
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
  updateCausalRelationship: ReturnType<typeof vi.fn>
  deleteCausalRelationship: ReturnType<typeof vi.fn>
  addError: ReturnType<typeof vi.fn>
}

/** The mocked `useGlobalStore`, which supports both selector and plain calls. */
interface MockStoreHook {
  (selector?: (state: MockStoreState) => unknown): unknown
  getState: () => MockStoreState
  _mockState: MockStoreState
}

const mockStoreHook = useGlobalStore as unknown as MockStoreHook

// The assertions below reach for the store double's action mocks by name.
const mockGlobalStore = mockStoreHook._mockState

/**
 * `cytoscape` is an overloaded entry point (factory, registry accessor, registry
 * registrar). `vi.mocked` can only preserve the *last* overload, which returns
 * `void`, so the factory overload is restated here to give `mockReturnValue` the
 * right signature.
 */
const mockedCytoscape = vi.mocked(cytoscape) as unknown as Mock<
  (options?: CytoscapeOptions) => Core
>

// Mock dependencies
vi.mock('@/services/api')

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
    updateCausalRelationship: vi.fn(),
    deleteCausalRelationship: vi.fn(),
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

// Mock Cytoscape
vi.mock('cytoscape')

// Import cytoscape after mocking
import cytoscape from 'cytoscape'

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

const mockEvents: Event[] = [
  {
    id: 'event1',
    description: 'First event',
    actor: 'Actor A',
    target: 'Target A',
    timestamp: '2023-01-01T10:00:00Z',
    created_at: '2023-01-01T10:00:00Z',
    updated_at: '2023-01-01T10:00:00Z'
  },
  {
    id: 'event2',
    description: 'Second event',
    actor: 'Actor B',
    target: 'Target B',
    timestamp: '2023-01-01T11:00:00Z',
    created_at: '2023-01-01T11:00:00Z',
    updated_at: '2023-01-01T11:00:00Z'
  },
  {
    id: 'event3',
    description: 'Third event',
    actor: 'Actor C',
    target: 'Target C',
    timestamp: '2023-01-01T09:00:00Z', // Earlier than event1 for temporal validation test
    created_at: '2023-01-01T09:00:00Z',
    updated_at: '2023-01-01T09:00:00Z'
  }
]

const mockCausalRelationships: CausalRelationship[] = [
  {
    id: 'rel1',
    cause_event_id: 'event1',
    effect_event_id: 'event2',
    weight: 0.8,
    evidence: 'Strong evidence',
    confidence: 0.9,
    relationship_type: 'direct',
    created_at: '2023-01-01T12:00:00Z',
    updated_at: '2023-01-01T12:00:00Z'
  }
]

describe('CausalGraphComponent - Relationship Interactions', () => {
  const user = userEvent.setup()
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
    const mockState = mockStoreHook._mockState
    if (mockState) {
      mockState.events = mockEvents
      mockState.causalRelationships = mockCausalRelationships
      mockState.selectedEvents = []
      mockState.updateSessionData = vi.fn()
      mockState.addCausalRelationship = vi.fn()
      mockState.updateCausalRelationship = vi.fn()
      mockState.deleteCausalRelationship = vi.fn()
      mockState.addError = vi.fn()
    }
    vi.mocked(apiClient.causal.createLink).mockResolvedValue({
      id: 'new-rel',
      cause_event_id: 'event1',
      effect_event_id: 'event2',
      weight: 0.5,
      evidence: 'User-created relationship',
      confidence: 0.7,
      relationship_type: 'direct',
      created_at: '2023-01-01T13:00:00Z',
      updated_at: '2023-01-01T13:00:00Z'
    })
    vi.mocked(apiClient.causal.updateLink).mockResolvedValue({
      ...mockCausalRelationships[0]!,
      weight: 0.6
    })
    vi.mocked(apiClient.causal.deleteLink).mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should render causal graph component', () => {
    render(<CausalGraphComponent />)
    expect(screen.getByText('Create Link')).toBeInTheDocument()
  })

  it('should show create link button', () => {
    render(<CausalGraphComponent />)
    expect(screen.getByText('Create Link')).toBeInTheDocument()
  })

  it('should toggle link creation mode when create link button is clicked', async () => {
    render(<CausalGraphComponent />)

    const createLinkButton = screen.getByText('Create Link')
    await user.click(createLinkButton)

    await waitFor(() => {
      expect(screen.getByText('Cancel Link')).toBeInTheDocument()
    })
    expect(screen.getByText(/Click on a source event to start creating causal link/)).toBeInTheDocument()
  })

  it('should handle keyboard shortcut for toggling link creation mode', async () => {
    render(<CausalGraphComponent />)

    // Press Ctrl+C to toggle link creation mode
    await user.keyboard('{Control>}c{/Control}')

    await waitFor(() => {
      expect(screen.getByText('Cancel Link')).toBeInTheDocument()
    })
  })

  it('should cancel link creation with Escape key', async () => {
    render(<CausalGraphComponent />)

    // Start link creation mode
    const createLinkButton = screen.getByText('Create Link')
    await user.click(createLinkButton)

    await waitFor(() => {
      expect(screen.getByText('Cancel Link')).toBeInTheDocument()
    })

    // Press Escape to cancel
    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.getByText('Create Link')).toBeInTheDocument()
    })
  })

  it('should call onCausalLinkCreate when causal link is created', async () => {
    const onCausalLinkCreate = vi.fn()
    render(<CausalGraphComponent onCausalLinkCreate={onCausalLinkCreate} />)

    // Wait for event handlers to be set up
    await waitFor(() => {
      expect(mockCy.on).toHaveBeenCalledWith('tap', 'node', expect.any(Function))
    })

    // Start link creation mode FIRST
    const createLinkButton = screen.getByText('Create Link')
    await user.click(createLinkButton)

    await waitFor(() => {
      expect(screen.getByText('Cancel Link')).toBeInTheDocument()
    })

    // Get the LATEST tap handlers (after state change may have re-registered them)
    const allHandlers = getEventHandlers(mockCy, 'tap', 'node')
    expect(allHandlers.length).toBeGreaterThan(0)

    // Use the most recently registered handler (last in the array)
    const handler = allHandlers[allHandlers.length - 1]!

    // Simulate clicking on the earlier source node (event3 @ 09:00)
    await act(async () => {
      handler({
        target: {
          data: () => ({ id: 'event3', event: mockEvents[2] }),
          hasClass: () => false
        }
      })
    })

    // Check for instruction update after selecting source
    await waitFor(() => {
      expect(screen.getByText(/Select target event/)).toBeInTheDocument()
    })

    // Simulate clicking on a later target node (event1 @ 10:00)
    await act(async () => {
      handler({
        target: {
          data: () => ({ id: 'event1', event: mockEvents[0] }),
          hasClass: () => false
        }
      })
    })

    await waitFor(() => {
      expect(apiClient.causal.createLink).toHaveBeenCalledWith(
        'event3',
        'event1',
        expect.objectContaining({
          weight: 0.5,
          evidence: 'User-created relationship',
          confidence: 0.7,
          relationship_type: 'direct'
        })
      )
    })

    expect(mockGlobalStore.addCausalRelationship).toHaveBeenCalled()
    expect(onCausalLinkCreate).toHaveBeenCalledWith(mockEvents[2], mockEvents[0])
  })

  it('should validate temporal ordering when creating causal links', async () => {
    render(<CausalGraphComponent />)

    // Start link creation mode FIRST
    const createLinkButton = screen.getByText('Create Link')
    await user.click(createLinkButton)

    await waitFor(() => {
      expect(screen.getByText('Cancel Link')).toBeInTheDocument()
    })

    // Get the LATEST handlers after state change
    const allHandlers = getEventHandlers(mockCy, 'tap', 'node')
    const handler = allHandlers[allHandlers.length - 1]!

    // Try to create link from later event to earlier event (should fail)
    await act(async () => {
      handler({
        target: {
          data: () => ({ id: 'event2', event: mockEvents[1] }), // 11:00
          hasClass: () => false
        }
      })
    })

    await act(async () => {
      handler({
        target: {
          data: () => ({ id: 'event3', event: mockEvents[2] }), // 09:00 (earlier)
          hasClass: () => false
        }
      })
    })

    await waitFor(() => {
      expect(mockGlobalStore.addError).toHaveBeenCalledWith({
        message: 'Cause event must occur before or at the same time as effect event',
        type: 'validation'
      })
    })

    expect(apiClient.causal.createLink).not.toHaveBeenCalled()
  })

  it('should prevent duplicate causal relationships', async () => {
    render(<CausalGraphComponent />)

    // Start link creation mode FIRST
    const createLinkButton = screen.getByText('Create Link')
    await user.click(createLinkButton)

    await waitFor(() => {
      expect(screen.getByText('Cancel Link')).toBeInTheDocument()
    })

    // Get the LATEST handlers after state change
    const allHandlers = getEventHandlers(mockCy, 'tap', 'node')
    const handler = allHandlers[allHandlers.length - 1]!

    // Try to create duplicate relationship (event1 -> event2 already exists)
    await act(async () => {
      handler({
        target: {
          data: () => ({ id: 'event1', event: mockEvents[0] }),
          hasClass: () => false
        }
      })
    })

    await act(async () => {
      handler({
        target: {
          data: () => ({ id: 'event2', event: mockEvents[1] }),
          hasClass: () => false
        }
      })
    })

    await waitFor(() => {
      expect(mockGlobalStore.addError).toHaveBeenCalledWith({
        message: 'Causal relationship already exists between these events',
        type: 'validation'
      })
    })

    expect(apiClient.causal.createLink).not.toHaveBeenCalled()
  })

  it('should show relationship tooltip on edge hover', async () => {
    render(<CausalGraphComponent />)

    await waitFor(() => {
      expect(mockCy.on).toHaveBeenCalledWith('mouseover', 'edge', expect.any(Function))
    })

    const allHandlers = getEventHandlers(mockCy, 'mouseover', 'edge')
    const handler = allHandlers[allHandlers.length - 1]!

    // Mock edge with relationship data
    const mockEdge = {
      addClass: vi.fn(),
      data: () => ({
        id: 'rel1',
        relationship: mockCausalRelationships[0]
      }),
      renderedMidpoint: () => ({ x: 100, y: 100 })
    }

    await act(async () => {
      handler({ target: mockEdge })
    })

    await waitFor(() => {
      expect(screen.getByText('Causal Relationship')).toBeInTheDocument()
      expect(screen.getByText('0.80')).toBeInTheDocument() // Weight
      expect(screen.getByText('0.90')).toBeInTheDocument() // Confidence
      expect(screen.getByText('direct')).toBeInTheDocument() // Type (rendered lower-case; CSS capitalizes it)
      expect(screen.getByText('Strong evidence')).toBeInTheDocument() // Evidence
    })
  })

  it('should call onRelationshipEdit on right-click', async () => {
    const onRelationshipEdit = vi.fn()
    render(<CausalGraphComponent onRelationshipEdit={onRelationshipEdit} />)

    await waitFor(() => {
      expect(mockCy.on).toHaveBeenCalledWith('cxttap', 'edge', expect.any(Function))
    })

    const handlers = getEventHandlers(mockCy, 'cxttap', 'edge')

    const mockEdge = {
      data: () => ({
        id: 'rel1',
        relationship: mockCausalRelationships[0]
      })
    }

    handlers[0]!({ target: mockEdge })

    expect(onRelationshipEdit).toHaveBeenCalledWith(mockCausalRelationships[0])
  })

  it('should handle API errors gracefully', async () => {
    vi.mocked(apiClient.causal.createLink).mockRejectedValue(new Error('Network error'))

    render(<CausalGraphComponent />)

    // Start link creation mode FIRST
    const createLinkButton = screen.getByText('Create Link')
    await user.click(createLinkButton)

    await waitFor(() => {
      expect(screen.getByText('Cancel Link')).toBeInTheDocument()
    })

    // Get the LATEST handlers after state change
    const allHandlers = getEventHandlers(mockCy, 'tap', 'node')
    const handler = allHandlers[allHandlers.length - 1]!

    // Create valid relationship (event3 at 09:00 -> event1 at 10:00 is temporally valid)
    await act(async () => {
      handler({
        target: {
          data: () => ({ id: 'event3', event: mockEvents[2] }),
          hasClass: () => false
        }
      })
    })

    await act(async () => {
      handler({
        target: {
          data: () => ({ id: 'event1', event: mockEvents[0] }),
          hasClass: () => false
        }
      })
    })

    await waitFor(() => {
      expect(mockGlobalStore.addError).toHaveBeenCalledWith({
        message: 'Failed to create causal relationship',
        type: 'network'
      })
    })
  })

  it('should update node highlighting during link creation', async () => {
    render(<CausalGraphComponent />)

    // Start link creation mode FIRST
    const createLinkButton = screen.getByText('Create Link')
    await user.click(createLinkButton)

    await waitFor(() => {
      expect(screen.getByText('Cancel Link')).toBeInTheDocument()
    })

    // Get the LATEST handlers after state change
    const allHandlers = getEventHandlers(mockCy, 'tap', 'node')
    const handler = allHandlers[allHandlers.length - 1]!

    // Select source node
    await act(async () => {
      handler({
        target: {
          data: () => ({ id: 'event1', event: mockEvents[0] })
        }
      })
    })

    // Check that instruction text updates
    await waitFor(() => {
      expect(screen.getByText(/Select target event for causal link from "Actor A → Target A"/)).toBeInTheDocument()
    })
  })

  it('should cancel link creation on background click', async () => {
    render(<CausalGraphComponent />)

    // Start link creation mode FIRST
    const createLinkButton = screen.getByText('Create Link')
    await user.click(createLinkButton)

    await waitFor(() => {
      expect(screen.getByText('Cancel Link')).toBeInTheDocument()
    })

    // Let the same-task guard lapse so the tap below models a genuine user tap
    // arriving in a later task, rather than re-render fallout.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    // Get the LATEST background tap handlers after state change
    const allHandlers = getEventHandlers(mockCy, 'tap')
    const handler = allHandlers[allHandlers.length - 1]!

    // Simulate a deliberate background tap
    await act(async () => {
      handler({ target: mockCy })
    })

    await waitFor(() => {
      expect(screen.getByText('Create Link')).toBeInTheDocument()
    })
    expect(screen.queryByText('Cancel Link')).not.toBeInTheDocument()
  })

  it('should not cancel link creation for a background tap in the same turn as entering link mode', async () => {
    render(<CausalGraphComponent />)

    // The core background tap handler is registered on mount.
    const allHandlers = getEventHandlers(mockCy, 'tap')
    const handler = allHandlers[allHandlers.length - 1]!

    // Enter link mode, then deliver a background tap synchronously in the same
    // task, without yielding to the task queue. This models the gesture /
    // re-render fallout that must not cancel the interaction the user just began.
    fireEvent.click(screen.getByText('Create Link'))
    act(() => {
      handler({ target: mockCy })
    })

    await waitFor(() => {
      expect(screen.getByText('Cancel Link')).toBeInTheDocument()
    })
    expect(screen.queryByText('Create Link')).not.toBeInTheDocument()
  })
})
