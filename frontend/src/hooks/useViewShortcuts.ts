import { useEffect, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router'
import { useGlobalStore } from '@/stores/globalStore'
import { ViewMode } from '@/types'

interface ViewConfig {
  mode: ViewMode
  path: string
  shortcut: string
}

const viewConfigs: ViewConfig[] = [
  { mode: 'timeline', path: '/timeline', shortcut: '1' },
  { mode: 'causal', path: '/causal-graph', shortcut: '2' },
  { mode: 'actor-perspective', path: '/actor-perspective', shortcut: '3' },
]

/**
 * Hook to register global Alt+1/2/3 keyboard shortcuts for view switching.
 * Should be used at the layout level so shortcuts work regardless of layout mode.
 */
export function useViewShortcuts() {
  const navigate = useNavigate()
  const location = useLocation()
  const { setViewMode, updateSessionData, viewMode, selectedEvents, selectedArcs, activeFilters } = useGlobalStore()

  // Save current view state before switching
  const saveCurrentViewState = useCallback(() => {
    const currentState = {
      selectedEvents,
      selectedArcs,
      filters: activeFilters,
      timestamp: Date.now(),
    }

    const viewStateKey = `${viewMode}State`
    updateSessionData({
      [viewStateKey]: currentState,
      lastViewMode: viewMode,
    })
  }, [viewMode, selectedEvents, selectedArcs, activeFilters, updateSessionData])

  // Get current view mode from URL
  const getCurrentViewMode = useCallback((): ViewMode => {
    const config = viewConfigs.find((c) => c.path === location.pathname)
    return config?.mode || 'timeline'
  }, [location.pathname])

  // Handle view switching
  const handleViewSwitch = useCallback(
    (targetMode: ViewMode, targetPath: string) => {
      const currentViewMode = getCurrentViewMode()
      if (targetMode === currentViewMode) return

      saveCurrentViewState()
      navigate(targetPath, { replace: false })
      setViewMode(targetMode)
    },
    [getCurrentViewMode, navigate, setViewMode, saveCurrentViewState]
  )

  // Register keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      // Don't trigger when typing in inputs
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
      ) {
        return
      }

      // Check for Alt + number shortcuts
      if (event.altKey && !event.ctrlKey && !event.shiftKey) {
        const config = viewConfigs.find((c) => c.shortcut === event.key)
        if (config) {
          event.preventDefault()
          handleViewSwitch(config.mode, config.path)
        }
      }
    }

    document.addEventListener('keydown', handleKeyPress)
    return () => document.removeEventListener('keydown', handleKeyPress)
  }, [handleViewSwitch])
}
