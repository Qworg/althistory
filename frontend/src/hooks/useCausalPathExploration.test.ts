import { renderHook, act, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import useCausalPathExploration from './useCausalPathExploration'
import { useGlobalStore } from '@/stores/globalStore'
import { apiClient } from '@/services/api'
import { Event, CausalRelationship, CausalPath } from '@/types'

// Mock the global store
vi.mock('@/stores/globalStore')
const mockUseGlobalStore = vi.mocked(useGlobalStore)

// Mock the API client
vi.mock('@/services/api')
const mockApiClient = vi.mocked(apiClient)

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

describe('useCausalPathExploration', () => {
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
    mockApiClient.causal.findChain.mockResolvedValue([mockCausalPath])
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useCausalPathExploration())
    
    expect(result.current.availablePaths).toEqual([])
    expect(result.current.currentHighlight).toBeNull()
    expect(result.current.navigationState.isNavigating).toBe(false)
    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('should start exploration and fetch paths', async () => {
    const { result } = renderHook(() => useCausalPathExploration())
    
    await act(async () => {
      await result.current.startExploration('1')
    })

    expect(mockApiClient.causal.findChain).toHaveBeenCalledWith('1', 3)
    expect(result.current.availablePaths).toHaveLength(1)
    expect(result.current.navigationState.isNavigating).toBe(true)
    expect(result.current.currentHighlight).not.toBeNull()
  })

  it('should calculate path metrics correctly', () => {
    const { result } = renderHook(() => useCausalPathExploration())
    
    const metrics = result.current.calculatePathMetrics(mockCausalPath)
    
    expect(metrics.totalWeight).toBe(0.7) // (0.8 + 0.6) / 2
    expect(metrics.avgConfidence).toBe(0.8) // (0.9 + 0.7) / 2
    expect(metrics.cumulativeStrength).toBe(0.8 * 0.9 * 0.6 * 0.7) // Product of weight * confidence
    expect(metrics.length).toBe(3)
    expect(metrics.relationshipCount).toBe(2)
  })

  it('should filter paths based on options', async () => {
    const lowConfidencePath: CausalPath = {
      events: mockEvents.slice(0, 2),
      relationships: [{
        ...mockRelationships[0],
        confidence: 0.05 // Below default threshold
      }],
      totalWeight: 0.5,
      confidence: 0.05
    }
    
    mockApiClient.causal.findChain.mockResolvedValue([mockCausalPath, lowConfidencePath])
    
    const { result } = renderHook(() => useCausalPathExploration())
    
    await act(async () => {
      await result.current.startExploration('1')
    })

    // Should filter out low confidence path
    expect(result.current.availablePaths).toHaveLength(1)
    expect(result.current.availablePaths[0].events).toHaveLength(3)
  })

  it('should navigate between paths', async () => {
    const secondPath: CausalPath = {
      events: mockEvents.slice(0, 2),
      relationships: mockRelationships.slice(0, 1),
      totalWeight: 0.6,
      confidence: 0.7
    }
    
    mockApiClient.causal.findChain.mockResolvedValue([mockCausalPath, secondPath])
    
    const { result } = renderHook(() => useCausalPathExploration())
    
    await act(async () => {
      await result.current.startExploration('1')
    })

    expect(result.current.navigationState.currentPathIndex).toBe(0)
    
    act(() => {
      result.current.navigateToPath(1)
    })

    expect(result.current.navigationState.currentPathIndex).toBe(1)
    expect(result.current.currentHighlight?.path).toBe(secondPath)
  })

  it('should navigate between steps', async () => {
    const { result } = renderHook(() => useCausalPathExploration())
    
    await act(async () => {
      await result.current.startExploration('1')
    })

    expect(result.current.navigationState.currentStepIndex).toBe(0)
    
    act(() => {
      const advanced = result.current.nextStep()
      expect(advanced).toBe(true)
    })

    expect(result.current.navigationState.currentStepIndex).toBe(1)
    
    act(() => {
      const advanced = result.current.previousStep()
      expect(advanced).toBe(true)
    })

    expect(result.current.navigationState.currentStepIndex).toBe(0)
  })

  it('should handle step navigation boundaries', async () => {
    const { result } = renderHook(() => useCausalPathExploration())
    
    await act(async () => {
      await result.current.startExploration('1')
    })

    // At first step, previousStep should return false
    act(() => {
      const advanced = result.current.previousStep()
      expect(advanced).toBe(false)
    })

    // Navigate to last step
    act(() => {
      result.current.navigateToStep(2)
    })

    // At last step, nextStep should return false
    act(() => {
      const advanced = result.current.nextStep()
      expect(advanced).toBe(false)
    })
  })

  it('should toggle auto-advance mode', async () => {
    const { result } = renderHook(() => useCausalPathExploration())
    
    await act(async () => {
      await result.current.startExploration('1')
    })

    expect(result.current.navigationState.autoAdvance).toBe(false)
    
    act(() => {
      result.current.toggleAutoAdvance()
    })

    expect(result.current.navigationState.autoAdvance).toBe(true)
  })

  it('should update auto-advance interval', async () => {
    const { result } = renderHook(() => useCausalPathExploration())
    
    await act(async () => {
      await result.current.startExploration('1')
    })

    act(() => {
      result.current.setAutoAdvanceInterval(1500)
    })

    expect(result.current.navigationState.autoAdvanceInterval).toBe(1500)
    
    // Should enforce minimum interval
    act(() => {
      result.current.setAutoAdvanceInterval(100)
    })

    expect(result.current.navigationState.autoAdvanceInterval).toBe(500)
  })

  it('should get current path info', async () => {
    const { result } = renderHook(() => useCausalPathExploration())
    
    await act(async () => {
      await result.current.startExploration('1')
    })

    const pathInfo = result.current.getCurrentPathInfo()
    
    expect(pathInfo).not.toBeNull()
    expect(pathInfo?.event).toBe(mockEvents[0])
    expect(pathInfo?.stepIndex).toBe(0)
    expect(pathInfo?.pathIndex).toBe(0)
    expect(pathInfo?.isFirstStep).toBe(true)
    expect(pathInfo?.isLastStep).toBe(false)
  })

  it('should stop exploration and clear state', async () => {
    const { result } = renderHook(() => useCausalPathExploration())
    
    await act(async () => {
      await result.current.startExploration('1')
    })

    expect(result.current.navigationState.isNavigating).toBe(true)
    
    act(() => {
      result.current.stopExploration()
    })

    expect(result.current.availablePaths).toEqual([])
    expect(result.current.currentHighlight).toBeNull()
    expect(result.current.navigationState.isNavigating).toBe(false)
  })

  it('should handle API errors', async () => {
    mockApiClient.causal.findChain.mockRejectedValue(new Error('API Error'))
    
    const { result } = renderHook(() => useCausalPathExploration())
    
    await act(async () => {
      await result.current.startExploration('1')
    })

    expect(result.current.error).toBe('API Error')
    expect(mockAddError).toHaveBeenCalledWith({
      message: 'API Error',
      type: 'network'
    })
  })

  it('should update exploration options', () => {
    const { result } = renderHook(() => useCausalPathExploration())
    
    act(() => {
      result.current.updateExplorationOptions({
        maxDepth: 5,
        minConfidence: 0.5
      })
    })

    expect(result.current.explorationOptions.maxDepth).toBe(5)
    expect(result.current.explorationOptions.minConfidence).toBe(0.5)
    expect(result.current.explorationOptions.minWeight).toBe(0.1) // Should keep original value
  })

  it('should highlight and clear path highlights', async () => {
    const { result } = renderHook(() => useCausalPathExploration())
    
    await act(async () => {
      await result.current.startExploration('1')
    })

    expect(result.current.currentHighlight).not.toBeNull()
    
    act(() => {
      result.current.clearHighlight()
    })

    expect(result.current.currentHighlight).toBeNull()
    
    act(() => {
      result.current.highlightPath(mockCausalPath)
    })

    expect(result.current.currentHighlight?.path).toBe(mockCausalPath)
  })
})