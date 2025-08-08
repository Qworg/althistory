import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useViewStateManager } from './useViewStateManager'
import { useGlobalStore } from '@/stores/globalStore'

// Mock the global store
vi.mock('@/stores/globalStore')
const mockUseGlobalStore = vi.mocked(useGlobalStore)

// Mock react-router
vi.mock('react-router', () => ({
  useLocation: () => ({ pathname: '/timeline' })
}))

// Mock sessionStorage
const mockSessionStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn()
}
Object.defineProperty(window, 'sessionStorage', {
  value: mockSessionStorage
})

describe('useViewStateManager', () => {
  const mockStore = {
    viewMode: 'timeline' as const,
    selectedEvents: ['event1'],
    selectedArcs: ['arc1'],
    activeFilters: {
      dateRange: null,
      actors: ['actor1'],
      targets: [],
      eventTypes: [],
      arcLevels: [],
      causalWeightRange: [0, 1] as [number, number],
      confidenceThreshold: 0,
      searchQuery: 'test',
    },
    sessionData: {
      viewportState: {
        timeline: {
          zoomLevel: 2,
          centerTime: '2023-01-01T00:00:00Z',
        },
        causalGraph: {
          layout: 'force-directed',
          nodePositions: {},
        },
      },
    },
    updateSessionData: vi.fn(),
    setSelectedEvents: vi.fn(),
    setSelectedArcs: vi.fn(),
    setFilters: vi.fn(),
  }

  beforeEach(() => {
    mockUseGlobalStore.mockReturnValue(mockStore as any)
    vi.clearAllMocks()
    mockSessionStorage.getItem.mockReturnValue(null)
    
    // Mock DOM elements
    const mockMainElement = {
      scrollLeft: 100,
      scrollTop: 200
    }
    vi.spyOn(document, 'querySelector').mockReturnValue(mockMainElement as any)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('saves current view state', () => {
    const { result } = renderHook(() => useViewStateManager())
    
    act(() => {
      result.current.saveCurrentViewState()
    })
    
    expect(mockSessionStorage.setItem).toHaveBeenCalledWith(
      'viewState_timeline',
      expect.stringContaining('"selectedEvents":["event1"]')
    )
  })

  it('restores view state from memory', () => {
    const { result } = renderHook(() => useViewStateManager())
    
    // First save a state
    act(() => {
      result.current.saveCurrentViewState()
    })
    
    // Then restore it
    act(() => {
      const restored = result.current.restoreViewState('timeline')
      expect(restored).toBe(true)
    })
    
    expect(mockStore.setSelectedEvents).toHaveBeenCalledWith(['event1'])
    expect(mockStore.setSelectedArcs).toHaveBeenCalledWith(['arc1'])
    expect(mockStore.setFilters).toHaveBeenCalledWith(mockStore.activeFilters)
  })

  it('restores view state from session storage when not in memory', () => {
    const savedState = {
      selectedEvents: ['event2'],
      selectedArcs: ['arc2'],
      filters: {
        dateRange: null,
        actors: ['actor2'],
        targets: [],
        eventTypes: [],
        arcLevels: [],
        causalWeightRange: [0, 1],
        confidenceThreshold: 0,
        searchQuery: '',
      },
      scrollPosition: { x: 50, y: 100 },
      zoomLevel: 1.5,
      centerPoint: { x: 1000, y: 0 },
      timestamp: Date.now()
    }
    
    mockSessionStorage.getItem.mockReturnValue(JSON.stringify(savedState))
    
    const { result } = renderHook(() => useViewStateManager())
    
    act(() => {
      const restored = result.current.restoreViewState('causal')
      expect(restored).toBe(true)
    })
    
    expect(mockStore.setSelectedEvents).toHaveBeenCalledWith(['event2'])
    expect(mockStore.setSelectedArcs).toHaveBeenCalledWith(['arc2'])
    expect(mockStore.setFilters).toHaveBeenCalledWith(savedState.filters)
  })

  it('returns false when restoring expired state', () => {
    const expiredState = {
      selectedEvents: ['event1'],
      selectedArcs: [],
      filters: mockStore.activeFilters,
      scrollPosition: { x: 0, y: 0 },
      zoomLevel: 1,
      centerPoint: null,
      timestamp: Date.now() - (31 * 60 * 1000) // 31 minutes ago (expired)
    }
    
    mockSessionStorage.getItem.mockReturnValue(JSON.stringify(expiredState))
    
    const { result } = renderHook(() => useViewStateManager())
    
    act(() => {
      const restored = result.current.restoreViewState('timeline')
      expect(restored).toBe(false)
    })
    
    expect(mockStore.setSelectedEvents).not.toHaveBeenCalled()
    expect(mockSessionStorage.removeItem).toHaveBeenCalledWith('viewState_timeline')
  })

  it('clears all view states', () => {
    const { result } = renderHook(() => useViewStateManager())
    
    act(() => {
      result.current.clearAllViewStates()
    })
    
    expect(mockSessionStorage.removeItem).toHaveBeenCalledWith('viewState_timeline')
    expect(mockSessionStorage.removeItem).toHaveBeenCalledWith('viewState_causal')
    expect(mockSessionStorage.removeItem).toHaveBeenCalledWith('viewState_actor-perspective')
  })

  it('clears specific view state', () => {
    const { result } = renderHook(() => useViewStateManager())
    
    act(() => {
      result.current.clearViewState('timeline')
    })
    
    expect(mockSessionStorage.removeItem).toHaveBeenCalledWith('viewState_timeline')
  })

  it('checks if state exists for view', () => {
    const { result } = renderHook(() => useViewStateManager())
    
    // Save state first
    act(() => {
      result.current.saveCurrentViewState()
    })
    
    expect(result.current.hasStateFor('timeline')).toBe(true)
    expect(result.current.hasStateFor('causal')).toBe(false)
  })

  it('handles session storage errors gracefully', () => {
    mockSessionStorage.setItem.mockImplementation(() => {
      throw new Error('Storage quota exceeded')
    })
    
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    
    const { result } = renderHook(() => useViewStateManager())
    
    act(() => {
      result.current.saveCurrentViewState()
    })
    
    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to save view state to session storage:',
      expect.any(Error)
    )
    
    consoleSpy.mockRestore()
  })

  it('handles JSON parse errors gracefully', () => {
    mockSessionStorage.getItem.mockReturnValue('invalid json')
    
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    
    const { result } = renderHook(() => useViewStateManager())
    
    act(() => {
      const restored = result.current.restoreViewState('timeline')
      expect(restored).toBe(false)
    })
    
    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to load view state from session storage:',
      expect.any(Error)
    )
    
    consoleSpy.mockRestore()
  })

  it('saves state before page unload', () => {
    const { result } = renderHook(() => useViewStateManager())
    
    // Simulate beforeunload event
    const beforeUnloadEvent = new Event('beforeunload')
    window.dispatchEvent(beforeUnloadEvent)
    
    expect(mockSessionStorage.setItem).toHaveBeenCalled()
  })

  it('restores scroll position with delay', async () => {
    const mockMainElement = {
      scrollLeft: 0,
      scrollTop: 0
    }
    vi.spyOn(document, 'querySelector').mockReturnValue(mockMainElement as any)
    
    const savedState = {
      selectedEvents: [],
      selectedArcs: [],
      filters: mockStore.activeFilters,
      scrollPosition: { x: 150, y: 250 },
      zoomLevel: 1,
      centerPoint: null,
      timestamp: Date.now()
    }
    
    mockSessionStorage.getItem.mockReturnValue(JSON.stringify(savedState))
    
    const { result } = renderHook(() => useViewStateManager())
    
    act(() => {
      result.current.restoreViewState('timeline')
    })
    
    // Wait for the setTimeout to execute
    await new Promise(resolve => setTimeout(resolve, 150))
    
    expect(mockMainElement.scrollLeft).toBe(150)
    expect(mockMainElement.scrollTop).toBe(250)
  })

  it('updates session data for zoom and center point restoration', () => {
    const savedState = {
      selectedEvents: [],
      selectedArcs: [],
      filters: mockStore.activeFilters,
      scrollPosition: { x: 0, y: 0 },
      zoomLevel: 3,
      centerPoint: { x: 2000, y: 0 },
      timestamp: Date.now()
    }
    
    mockSessionStorage.getItem.mockReturnValue(JSON.stringify(savedState))
    
    const { result } = renderHook(() => useViewStateManager())
    
    act(() => {
      result.current.restoreViewState('timeline')
    })
    
    expect(mockStore.updateSessionData).toHaveBeenCalledWith({
      viewportState: {
        ...mockStore.sessionData.viewportState,
        timeline: {
          ...mockStore.sessionData.viewportState.timeline,
          zoomLevel: 3,
          centerTime: new Date(2000).toISOString()
        }
      }
    })
  })
})