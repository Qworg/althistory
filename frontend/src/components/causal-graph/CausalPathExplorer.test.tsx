import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CausalPathExplorer from './CausalPathExplorer'
import { useGlobalStore } from '@/stores/globalStore'
import { apiClient } from '@/services/api'
import { Event, CausalRelationship, CausalPath } from '@/types'

// Mock the global store
vi.mock('@/stores/globalStore')
const mockUseGlobalStore = vi.mocked(useGlobalStore)

// Mock the API client
vi.mock('@/services/api', () => ({
  apiClient: {
    causal: {
      findChain: vi.fn(),
      getSuggestions: vi.fn(),
      createLink: vi.fn(),
      getRelationships: vi.fn(),
      updateLink: vi.fn(),
      deleteLink: vi.fn()
    }
  }
}))

const mockApiClient = vi.mocked(apiClient)
const mockFindChain = mockFindChain as ReturnType<typeof vi.fn>

// Mock data
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
  },
  {
    id: '3',
    description: 'Event 3',
    actor: 'Actor 3',
    target: 'Target 3',
    timestamp: '2023-01-03T00:00:00Z',
    created_at: '2023-01-03T00:00:00Z',
    updated_at: '2023-01-03T00:00:00Z'
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
  },
  {
    id: 'rel2',
    cause_event_id: '2',
    effect_event_id: '3',
    weight: 0.6,
    evidence: 'Moderate evidence',
    confidence: 0.7,
    relationship_type: 'indirect',
    created_at: '2023-01-02T00:00:00Z',
    updated_at: '2023-01-02T00:00:00Z'
  }
]

const mockCausalPath: CausalPath = {
  events: mockEvents,
  relationships: mockRelationships,
  totalWeight: 0.7,
  confidence: 0.8
}

describe('CausalPathExplorer', () => {
  const mockAddError = vi.fn()
  
  beforeEach(() => {
    mockUseGlobalStore.mockReturnValue({
      events: mockEvents,
      causalRelationships: mockRelationships,
      addError: mockAddError,
      // Add other required store properties with default values
      arcs: [],
      inferredPressures: [],
      selectedEvents: [],
      selectedArcs: [],
      activeFilters: {
        dateRange: null,
        actors: [],
        targets: [],
        eventTypes: [],
        arcLevels: [],
        causalWeightRange: [0, 1],
        confidenceThreshold: 0,
        searchQuery: ''
      },
      viewMode: 'causal' as const,
      uiState: {
        sidebarCollapsed: false,
        filterPanelOpen: true,
        activeModal: null,
        dragState: {
          isDragging: false,
          dragType: null,
          draggedItemId: null
        },
        selectionState: {
          isSelecting: false,
          selectionType: 'single',
          selectionBox: null
        }
      },
      userPreferences: {
        theme: 'light' as const,
        defaultViewMode: 'timeline' as const,
        timelineHeight: 600,
        showEventLabels: true,
        autoSaveFilters: true,
        notificationSettings: {
          showSuccess: true,
          showErrors: true,
          showWarnings: true
        },
        accessibility: {
          highContrast: false,
          reducedMotion: false,
          screenReaderOptimized: false
        }
      },
      sessionData: {
        lastActiveFilters: {
          dateRange: null,
          actors: [],
          targets: [],
          eventTypes: [],
          arcLevels: [],
          causalWeightRange: [0, 1],
          confidenceThreshold: 0,
          searchQuery: ''
        },
        lastViewMode: 'timeline' as const,
        lastSelectedEvents: [],
        lastSelectedArcs: [],
        recentSearches: [],
        viewportState: {
          timeline: {
            zoomLevel: 1,
            centerTime: null
          },
          causalGraph: {
            layout: 'force-directed',
            nodePositions: {}
          }
        }
      },
      isLoading: false,
      loadingOperations: new Set(),
      errors: [],
      // Mock all the action functions
      setEvents: vi.fn(),
      setArcs: vi.fn(),
      setCausalRelationships: vi.fn(),
      setInferredPressures: vi.fn(),
      addEvent: vi.fn(),
      updateEvent: vi.fn(),
      deleteEvent: vi.fn(),
      addArc: vi.fn(),
      updateArc: vi.fn(),
      deleteArc: vi.fn(),
      addCausalRelationship: vi.fn(),
      updateCausalRelationship: vi.fn(),
      deleteCausalRelationship: vi.fn(),
      setSelectedEvents: vi.fn(),
      setSelectedArcs: vi.fn(),
      toggleEventSelection: vi.fn(),
      toggleArcSelection: vi.fn(),
      clearSelection: vi.fn(),
      setFilters: vi.fn(),
      updateFilters: vi.fn(),
      clearFilters: vi.fn(),
      setViewMode: vi.fn(),
      setUIState: vi.fn(),
      setSidebarCollapsed: vi.fn(),
      setFilterPanelOpen: vi.fn(),
      setActiveModal: vi.fn(),
      setDragState: vi.fn(),
      setSelectionState: vi.fn(),
      setUserPreferences: vi.fn(),
      updateSessionData: vi.fn(),
      setLoading: vi.fn(),
      addLoadingOperation: vi.fn(),
      removeLoadingOperation: vi.fn(),
      clearErrors: vi.fn(),
      removeError: vi.fn(),
      savePreferences: vi.fn(),
      loadPreferences: vi.fn(),
      saveSessionData: vi.fn(),
      loadSessionData: vi.fn(),
      clearPersistedData: vi.fn()
    })

    // Mock API client
    mockFindChain.mockResolvedValue([mockCausalPath])
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should not render when not exploring', () => {
    render(<CausalPathExplorer />)
    
    // Component should not render anything when not exploring
    expect(screen.queryByText('Causal Chain Explorer')).not.toBeInTheDocument()
  })

  it('should start exploration when focusEventId is provided', async () => {
    render(<CausalPathExplorer focusEventId="1" maxDepth={3} />)
    
    await waitFor(() => {
      expect(mockFindChain).toHaveBeenCalledWith('1', 3)
    })
  })

  it('should display exploration interface when paths are found', async () => {
    const onPathSelect = vi.fn()
    const onPathHighlight = vi.fn()
    
    render(
      <CausalPathExplorer 
        focusEventId="1" 
        onPathSelect={onPathSelect}
        onPathHighlight={onPathHighlight}
      />
    )
    
    await waitFor(() => {
      expect(screen.getByText('Causal Chain Explorer')).toBeInTheDocument()
    })

    // Should show path navigation
    expect(screen.getByText('Path Navigation (3 steps)')).toBeInTheDocument()
    
    // Should show current step info
    expect(screen.getByText('Actor 1 → Target 1')).toBeInTheDocument()
    
    // Should call callbacks
    expect(onPathHighlight).toHaveBeenCalledWith(mockCausalPath)
    expect(onPathSelect).toHaveBeenCalledWith(mockCausalPath)
  })

  it('should navigate between steps', async () => {
    render(<CausalPathExplorer focusEventId="1" />)
    
    await waitFor(() => {
      expect(screen.getByText('Causal Chain Explorer')).toBeInTheDocument()
    })

    // Should start at step 1
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
    
    // Click next step
    const nextButton = screen.getByTitle('Next step (→)')
    fireEvent.click(nextButton)
    
    // Should move to step 2
    expect(screen.getByText('2 / 3')).toBeInTheDocument()
    expect(screen.getByText('Actor 2 → Target 2')).toBeInTheDocument()
  })

  it('should handle keyboard navigation', async () => {
    render(<CausalPathExplorer focusEventId="1" />)
    
    await waitFor(() => {
      expect(screen.getByText('Causal Chain Explorer')).toBeInTheDocument()
    })

    // Test right arrow key
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    expect(screen.getByText('2 / 3')).toBeInTheDocument()
    
    // Test left arrow key
    fireEvent.keyDown(document, { key: 'ArrowLeft' })
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
    
    // Test escape key
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText('Causal Chain Explorer')).not.toBeInTheDocument()
  })

  it('should display relationship details', async () => {
    render(<CausalPathExplorer focusEventId="1" />)
    
    await waitFor(() => {
      expect(screen.getByText('Causal Chain Explorer')).toBeInTheDocument()
    })

    // Navigate to second step to see relationship
    const nextButton = screen.getByTitle('Next step (→)')
    fireEvent.click(nextButton)
    
    // Should show relationship details
    expect(screen.getByText('Causal Link:')).toBeInTheDocument()
    expect(screen.getByText('direct')).toBeInTheDocument()
    expect(screen.getByText('W: 0.80')).toBeInTheDocument()
    expect(screen.getByText('Confidence: 90%')).toBeInTheDocument()
  })

  it('should display cumulative strength indicators', async () => {
    render(<CausalPathExplorer focusEventId="1" />)
    
    await waitFor(() => {
      expect(screen.getByText('Causal Chain Explorer')).toBeInTheDocument()
    })

    // Should show cumulative strength for each step
    const strengthIndicators = screen.getAllByText(/Cumulative strength:/)
    expect(strengthIndicators.length).toBeGreaterThan(0)
    
    // Should show percentages
    expect(screen.getByText('100.0%')).toBeInTheDocument() // First step is always 100%
  })

  it('should display path summary', async () => {
    render(<CausalPathExplorer focusEventId="1" />)
    
    await waitFor(() => {
      expect(screen.getByText('Causal Chain Explorer')).toBeInTheDocument()
    })

    // Should show path summary
    expect(screen.getByText('Path Summary:')).toBeInTheDocument()
    expect(screen.getByText('3 events')).toBeInTheDocument()
    expect(screen.getByText('2 links')).toBeInTheDocument()
    expect(screen.getByText(/Overall strength:/)).toBeInTheDocument()
  })

  it('should handle API errors gracefully', async () => {
    mockFindChain.mockRejectedValue(new Error('API Error'))
    
    render(<CausalPathExplorer focusEventId="1" />)
    
    await waitFor(() => {
      expect(mockAddError).toHaveBeenCalledWith({
        message: 'Failed to explore causal chains',
        type: 'network'
      })
    })
  })

  it('should display no paths found message', async () => {
    mockFindChain.mockResolvedValue([])
    
    render(<CausalPathExplorer focusEventId="1" />)
    
    await waitFor(() => {
      expect(screen.getByText('No causal chains found')).toBeInTheDocument()
      expect(screen.getByText(/No causal relationships were found/)).toBeInTheDocument()
    })
  })

  it('should handle multiple paths selection', async () => {
    const secondPath: CausalPath = {
      events: [mockEvents[0]!, mockEvents[2]!],
      relationships: [mockRelationships[0]!],
      totalWeight: 0.5,
      confidence: 0.6
    }
    
    mockFindChain.mockResolvedValue([mockCausalPath, secondPath])
    
    render(<CausalPathExplorer focusEventId="1" />)
    
    await waitFor(() => {
      expect(screen.getByText('Available Paths (2)')).toBeInTheDocument()
    })

    // Should show both paths
    expect(screen.getByText('Path 1: 3 events')).toBeInTheDocument()
    expect(screen.getByText('Path 2: 2 events')).toBeInTheDocument()
    
    // Click on second path
    const secondPathButton = screen.getByText('Path 2: 2 events')
    fireEvent.click(secondPathButton)
    
    // Should switch to second path
    expect(screen.getByText('Actor 3 → Target 3')).toBeInTheDocument()
  })

  it('should show keyboard shortcuts help', async () => {
    render(<CausalPathExplorer focusEventId="1" />)
    
    await waitFor(() => {
      expect(screen.getByText('Causal Chain Explorer')).toBeInTheDocument()
    })

    // Should show keyboard shortcuts
    expect(screen.getByText('Keyboard shortcuts:')).toBeInTheDocument()
    expect(screen.getByText('← → Navigate steps')).toBeInTheDocument()
    expect(screen.getByText('Esc Close')).toBeInTheDocument()
  })
})