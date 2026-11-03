import { useEffect, useCallback } from 'react'
import { shouldIgnoreAppShortcut } from '@/utils/keyboardShortcuts'
import { useNavigate, useLocation } from 'react-router'
import { useGlobalStore } from '@/stores/globalStore'
import { ViewMode } from '@/types'

export interface ViewShortcutConfig {
  mode: ViewMode
  path: string
  /** Pressed with Alt. */
  shortcut: string
}

/**
 * The Alt+n view-switch bindings. Exported so the in-app shortcut reference
 * (`components/help/shortcuts.ts`) lists exactly what this hook handles.
 */
export const VIEW_SHORTCUT_CONFIGS: readonly ViewShortcutConfig[] = [
  { mode: 'timeline', path: '/timeline', shortcut: '1' },
  { mode: 'causal', path: '/causal-graph', shortcut: '2' },
  { mode: 'actor-perspective', path: '/actor-perspective', shortcut: '3' },
]

/**
 * The view a route shows. The route is the one source of truth for the view
 * mode: `/` renders the timeline, and so does any path no view claims.
 */
export function viewModeForPath(pathname: string): ViewMode {
  return VIEW_SHORTCUT_CONFIGS.find((c) => c.path === pathname)?.mode ?? 'timeline'
}

/**
 * Hook to register global Alt+1/2/3 keyboard shortcuts for view switching.
 * Should be used at the layout level so shortcuts work regardless of layout mode.
 */
export function useViewShortcuts() {
  const navigate = useNavigate()
  const location = useLocation()
  const { updateSessionData, viewMode, selectedEvents, selectedArcs, activeFilters } = useGlobalStore()

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

  // Handle view switching. Navigating is enough: `useViewStateManager` derives
  // the store's view mode from the route.
  const handleViewSwitch = useCallback(
    (targetMode: ViewMode, targetPath: string) => {
      if (targetMode === viewModeForPath(location.pathname)) return

      saveCurrentViewState()
      navigate(targetPath, { replace: false })
    },
    [location.pathname, navigate, saveCurrentViewState]
  )

  // Register keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      // Not while typing, composing, or with a modal dialog open
      if (shouldIgnoreAppShortcut(event)) {
        return
      }

      // Check for Alt + number shortcuts
      if (event.altKey && !event.ctrlKey && !event.shiftKey) {
        const config = VIEW_SHORTCUT_CONFIGS.find((c) => c.shortcut === event.key)
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
