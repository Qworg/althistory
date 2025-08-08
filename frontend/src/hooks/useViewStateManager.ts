import { useCallback, useEffect, useRef } from 'react'
import { useLocation } from 'react-router'
import { useGlobalStore } from '@/stores/globalStore'
import { ViewMode, FilterState } from '@/types'

interface ViewState {
  selectedEvents: string[]
  selectedArcs: string[]
  filters: FilterState
  scrollPosition: { x: number; y: number }
  zoomLevel: number
  centerPoint: { x: number; y: number } | null
  timestamp: number
}

interface ViewStateMap {
  timeline: ViewState | null
  causal: ViewState | null
  'actor-perspective': ViewState | null
}

const STATE_EXPIRY_TIME = 30 * 60 * 1000 // 30 minutes

export function useViewStateManager() {
  const location = useLocation()
  const {
    viewMode,
    selectedEvents,
    selectedArcs,
    activeFilters,
    sessionData,
    updateSessionData,
    setSelectedEvents,
    setSelectedArcs,
    setFilters
  } = useGlobalStore()

  const previousViewMode = useRef<ViewMode | null>(null)
  const stateMap = useRef<ViewStateMap>({
    timeline: null,
    causal: null,
    'actor-perspective': null
  })

  // Get current scroll position
  const getCurrentScrollPosition = useCallback((): { x: number; y: number } => {
    const mainElement = document.querySelector('main')
    return {
      x: mainElement?.scrollLeft || 0,
      y: mainElement?.scrollTop || 0
    }
  }, [])

  // Set scroll position
  const setScrollPosition = useCallback((position: { x: number; y: number }) => {
    const mainElement = document.querySelector('main')
    if (mainElement) {
      mainElement.scrollLeft = position.x
      mainElement.scrollTop = position.y
    }
  }, [])

  // Get current zoom level from session data
  const getCurrentZoomLevel = useCallback((): number => {
    switch (viewMode) {
      case 'timeline':
        return sessionData.viewportState.timeline.zoomLevel
      case 'causal':
        // For causal graph, we might track zoom differently
        return 1
      case 'actor-perspective':
        return 1
      default:
        return 1
    }
  }, [viewMode, sessionData])

  // Get current center point from session data
  const getCurrentCenterPoint = useCallback((): { x: number; y: number } | null => {
    switch (viewMode) {
      case 'timeline':
        const centerTime = sessionData.viewportState.timeline.centerTime
        return centerTime ? { x: new Date(centerTime).getTime(), y: 0 } : null
      case 'causal':
        // For causal graph, center point might be different
        return null
      case 'actor-perspective':
        return null
      default:
        return null
    }
  }, [viewMode, sessionData])

  // Save current view state
  const saveCurrentViewState = useCallback(() => {
    if (!previousViewMode.current) return

    const currentState: ViewState = {
      selectedEvents: [...selectedEvents],
      selectedArcs: [...selectedArcs],
      filters: { ...activeFilters },
      scrollPosition: getCurrentScrollPosition(),
      zoomLevel: getCurrentZoomLevel(),
      centerPoint: getCurrentCenterPoint(),
      timestamp: Date.now()
    }

    // Save to memory
    stateMap.current[previousViewMode.current] = currentState

    // Save to session storage for persistence across page reloads
    const stateKey = `viewState_${previousViewMode.current}`
    try {
      sessionStorage.setItem(stateKey, JSON.stringify(currentState))
    } catch (error) {
      console.warn('Failed to save view state to session storage:', error)
    }

    console.log(`Saved state for ${previousViewMode.current}:`, currentState)
  }, [
    selectedEvents,
    selectedArcs,
    activeFilters,
    getCurrentScrollPosition,
    getCurrentZoomLevel,
    getCurrentCenterPoint
  ])

  // Restore view state
  const restoreViewState = useCallback((targetViewMode: ViewMode) => {
    // Try to get from memory first
    let savedState = stateMap.current[targetViewMode]

    // If not in memory, try session storage
    if (!savedState) {
      const stateKey = `viewState_${targetViewMode}`
      try {
        const storedState = sessionStorage.getItem(stateKey)
        if (storedState) {
          savedState = JSON.parse(storedState)
        }
      } catch (error) {
        console.warn('Failed to load view state from session storage:', error)
      }
    }

    // Check if state is still valid (not expired)
    if (savedState && Date.now() - savedState.timestamp < STATE_EXPIRY_TIME) {
      console.log(`Restoring state for ${targetViewMode}:`, savedState)

      // Restore selections
      setSelectedEvents(savedState.selectedEvents)
      setSelectedArcs(savedState.selectedArcs)

      // Restore filters
      setFilters(savedState.filters)

      // Restore scroll position (with a small delay to ensure DOM is ready)
      setTimeout(() => {
        setScrollPosition(savedState.scrollPosition)
      }, 100)

      // Restore zoom and center point through session data
      if (savedState.zoomLevel !== 1 || savedState.centerPoint) {
        const newViewportState = { ...sessionData.viewportState }
        
        switch (targetViewMode) {
          case 'timeline':
            newViewportState.timeline = {
              ...newViewportState.timeline,
              zoomLevel: savedState.zoomLevel,
              centerTime: savedState.centerPoint ? new Date(savedState.centerPoint.x).toISOString() : null
            }
            break
          case 'causal':
            // Handle causal graph viewport state if needed
            break
          case 'actor-perspective':
            // Handle actor perspective viewport state if needed
            break
        }

        updateSessionData({ viewportState: newViewportState })
      }

      return true
    } else {
      // Clear expired state
      if (savedState) {
        stateMap.current[targetViewMode] = null
        const stateKey = `viewState_${targetViewMode}`
        try {
          sessionStorage.removeItem(stateKey)
        } catch (error) {
          console.warn('Failed to remove expired view state:', error)
        }
      }
      return false
    }
  }, [
    setSelectedEvents,
    setSelectedArcs,
    setFilters,
    setScrollPosition,
    sessionData,
    updateSessionData
  ])

  // Clear all saved states
  const clearAllViewStates = useCallback(() => {
    stateMap.current = {
      timeline: null,
      causal: null,
      'actor-perspective': null
    }

    // Clear from session storage
    const viewModes: ViewMode[] = ['timeline', 'causal', 'actor-perspective']
    viewModes.forEach(mode => {
      const stateKey = `viewState_${mode}`
      try {
        sessionStorage.removeItem(stateKey)
      } catch (error) {
        console.warn('Failed to remove view state from session storage:', error)
      }
    })
  }, [])

  // Clear state for specific view
  const clearViewState = useCallback((targetViewMode: ViewMode) => {
    stateMap.current[targetViewMode] = null
    const stateKey = `viewState_${targetViewMode}`
    try {
      sessionStorage.removeItem(stateKey)
    } catch (error) {
      console.warn('Failed to remove view state from session storage:', error)
    }
  }, [])

  // Handle view mode changes
  useEffect(() => {
    // Save state when leaving a view
    if (previousViewMode.current && previousViewMode.current !== viewMode) {
      saveCurrentViewState()
    }

    // Restore state when entering a view
    if (viewMode && viewMode !== previousViewMode.current) {
      // Small delay to ensure the new view is mounted
      setTimeout(() => {
        restoreViewState(viewMode)
      }, 150)
    }

    previousViewMode.current = viewMode
  }, [viewMode, saveCurrentViewState, restoreViewState])

  // Save state before page unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (previousViewMode.current) {
        saveCurrentViewState()
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [saveCurrentViewState])

  // Clean up expired states periodically
  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      const now = Date.now()
      const viewModes: ViewMode[] = ['timeline', 'causal', 'actor-perspective']
      
      viewModes.forEach(mode => {
        const state = stateMap.current[mode]
        if (state && now - state.timestamp > STATE_EXPIRY_TIME) {
          clearViewState(mode)
        }
      })
    }, 5 * 60 * 1000) // Check every 5 minutes

    return () => clearInterval(cleanupInterval)
  }, [clearViewState])

  return {
    saveCurrentViewState,
    restoreViewState,
    clearAllViewStates,
    clearViewState,
    hasStateFor: (viewMode: ViewMode) => {
      const state = stateMap.current[viewMode]
      return state !== null && Date.now() - state.timestamp < STATE_EXPIRY_TIME
    }
  }
}