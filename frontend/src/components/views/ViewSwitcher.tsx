import React, { useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router'
import { useGlobalStore } from '@/stores/globalStore'
import { ViewMode, FilterState, SessionData } from '@/types'
import { ActorViewIcon, CausalGraphViewIcon, TimelineViewIcon } from '@/components/layout/viewIcons'
import { viewModeForPath } from '@/hooks/useViewShortcuts'

/**
 * Blob `saveCurrentViewState` writes into `sessionData` under the dynamic key
 * `${viewMode}State`. `SessionData` declares no fixed member for those keys, so
 * reads go through this one documented, type-accurate view of the record.
 */
interface SavedViewState {
  selectedEvents: string[]
  selectedArcs: string[]
  filters: FilterState
  timestamp: number
}

const readSavedViewState = (
  sessionData: SessionData,
  stateKey: string
): SavedViewState | undefined =>
  (sessionData as unknown as Record<string, SavedViewState | undefined>)[stateKey]

interface ViewSwitcherProps {
  className?: string
  showLabels?: boolean
  orientation?: 'horizontal' | 'vertical'
}

interface ViewConfig {
  mode: ViewMode
  path: string
  label: string
  icon: React.ReactNode
  description: string
  shortcut?: string
}

const viewConfigs: ViewConfig[] = [
  {
    mode: 'timeline',
    path: '/timeline',
    label: 'Timeline',
    icon: <TimelineViewIcon />,
    description: 'Chronological view of events and arcs',
    shortcut: '1'
  },
  {
    mode: 'causal',
    path: '/causal-graph',
    label: 'Causal Graph',
    icon: <CausalGraphViewIcon />,
    description: 'Network view of causal relationships',
    shortcut: '2'
  },
  {
    mode: 'actor-perspective',
    path: '/actor-perspective',
    label: 'Actor Perspective',
    icon: <ActorViewIcon />,
    description: 'Actor-focused timeline view',
    shortcut: '3'
  }
]

export function ViewSwitcher({ 
  className = '', 
  showLabels = true, 
  orientation = 'horizontal' 
}: ViewSwitcherProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { 
    viewMode, 
    selectedEvents, 
    selectedArcs, 
    activeFilters,
    sessionData,
    updateSessionData 
  } = useGlobalStore()

  // The view on screen comes from the URL. The store's `viewMode` is derived
  // from the route once, in `useViewStateManager` (always mounted by
  // MainLayout), so this switcher only navigates.
  const currentViewMode = viewModeForPath(location.pathname)

  // Save current view state before switching
  const saveCurrentViewState = useCallback(() => {
    const currentState = {
      selectedEvents,
      selectedArcs,
      filters: activeFilters,
      timestamp: Date.now()
    }

    // Save state specific to current view
    const viewStateKey = `${viewMode}State`
    updateSessionData({
      [viewStateKey]: currentState,
      lastViewMode: viewMode
    })
  }, [viewMode, selectedEvents, selectedArcs, activeFilters, updateSessionData])

  // Handle view switching with state preservation
  const handleViewSwitch = useCallback((targetMode: ViewMode, targetPath: string) => {
    if (targetMode === currentViewMode) return

    // Save current state before switching
    saveCurrentViewState()

    // Navigate to new view (the route sets the store's view mode)
    navigate(targetPath, { replace: false })

    // Restore state for target view if available
    const targetStateKey = `${targetMode}State`
    const savedState = readSavedViewState(sessionData, targetStateKey)
    
    if (savedState && Date.now() - savedState.timestamp < 300000) { // 5 minutes
      // Restore selections and filters if they're recent
      // Note: This would be implemented with additional store actions
      console.log('Restoring state for', targetMode, savedState)
    }
  }, [currentViewMode, navigate, saveCurrentViewState, sessionData])

  // Note: Keyboard shortcuts (Alt+1/2/3) are handled globally by useViewShortcuts hook in MainLayout

  const containerClasses = orientation === 'horizontal' 
    ? 'flex items-center space-x-1' 
    : 'flex flex-col space-y-1'

  return (
    <div className={`${containerClasses} ${className}`} role="tablist" aria-label="View switcher">
      {viewConfigs.map((config) => {
        const isActive = config.mode === currentViewMode
        
        return (
          <button
            key={config.mode}
            onClick={() => handleViewSwitch(config.mode, config.path)}
            className={`
              group relative inline-flex items-center px-3 py-2 rounded-lg text-sm font-medium
              transition-all duration-200 ease-in-out
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
              ${isActive
                ? 'bg-blue-100 text-blue-700 shadow-sm dark:bg-blue-500/15 dark:text-blue-200'
                : 'text-ink-secondary hover:text-ink hover:bg-subtle'
              }
              ${orientation === 'vertical' ? 'w-full justify-start' : ''}
            `}
            role="tab"
            aria-selected={isActive}
            aria-controls={`${config.mode}-panel`}
            title={`${config.description} (Alt+${config.shortcut})`}
          >
            <span aria-hidden="true" className={`${showLabels && orientation === 'horizontal' ? 'mr-2' : ''}`}>
              {config.icon}
            </span>
            
            {showLabels && (
              <span className={orientation === 'vertical' ? 'ml-3' : ''}>
                {config.label}
              </span>
            )}

            {/* Keyboard shortcut indicator */}
            {config.shortcut && (
              <span className={`
                ml-auto text-xs text-ink-muted opacity-0 group-hover:opacity-100 
                transition-opacity duration-200
                ${orientation === 'horizontal' ? 'ml-2' : ''}
              `}>
                Alt+{config.shortcut}
              </span>
            )}

            {/* Active indicator */}
            {isActive && (
              <div className={`
                absolute bg-blue-500 rounded-full transition-all duration-200
                ${orientation === 'horizontal' 
                  ? 'bottom-0 left-1/2 transform -translate-x-1/2 w-1 h-1' 
                  : 'left-0 top-1/2 transform -translate-y-1/2 w-1 h-4'
                }
              `} />
            )}
          </button>
        )
      })}
    </div>
  )
}
