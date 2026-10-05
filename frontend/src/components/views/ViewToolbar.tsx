import React, { useCallback, useState } from 'react'
import { useGlobalStore } from '@/stores/globalStore'
import { ViewMode, CreateEventRequest, CreateArcRequest, CausalRelationshipData } from '@/types'
import {
  GraphCopyModal,
  GraphCopyProgressPanel,
  CopyHistoryPanel,
  GraphComparisonModal,
  EventDetailModal,
  ArcDetailPanel,
  CausalRelationshipModal
} from '@/components/modals'
import { useCreateEvent, useCreateArc, useCreateCausalLink } from '@/hooks/useAPI'

interface ViewToolbarProps {
  viewMode: ViewMode
  className?: string
}

interface ToolbarAction {
  id: string
  label: string
  icon: React.ReactNode
  onClick: () => void
  disabled?: boolean
  tooltip?: string
  shortcut?: string
}

export function ViewToolbar({ viewMode, className = '' }: ViewToolbarProps) {
  const { 
    selectedEvents, 
    selectedArcs, 
    activeFilters,
    clearSelection,
    clearFilters,
    sessionData,
    updateSessionData,
    setFilterPanelOpen,
    uiState
  } = useGlobalStore()

  // Modal states
  const [showCopyModal, setShowCopyModal] = useState(false)
  const [showProgressPanel, setShowProgressPanel] = useState(false)
  const [showHistoryPanel, setShowHistoryPanel] = useState(false)
  const [showComparisonModal, setShowComparisonModal] = useState(false)
  const [showCreateEventModal, setShowCreateEventModal] = useState(false)
  const [showCreateArcPanel, setShowCreateArcPanel] = useState(false)
  const [showCreateCausalLinkModal, setShowCreateCausalLinkModal] = useState(false)
  const [comparisonData, setComparisonData] = useState<{
    originalName: string
    copiedName: string
  } | null>(null)

  // Actor perspective state
  const [actorLayout, setActorLayout] = useState<'chronological' | 'thematic'>('chronological')
  const [showActorStats, setShowActorStats] = useState(false)

  // Mutations
  const createEventMutation = useCreateEvent()
  const createArcMutation = useCreateArc()
  const createCausalLinkMutation = useCreateCausalLink()

  // Timeline-specific actions
  const getTimelineActions = useCallback((): ToolbarAction[] => {
    return [
      {
        id: 'zoom-fit',
        label: 'Fit to View',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
          </svg>
        ),
        onClick: () => {
          // Trigger fit to view in Timeline component
          updateSessionData({
            viewportState: {
              ...sessionData.viewportState,
              timeline: {
                ...sessionData.viewportState.timeline,
                zoomLevel: 1,
                centerTime: null,
                fitToViewTrigger: (sessionData.viewportState.timeline.fitToViewTrigger || 0) + 1
              }
            }
          })
        },
        tooltip: 'Zoom to fit all events (F)',
        shortcut: 'F'
      },
      {
        id: 'create-event',
        label: 'Create Event',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
        ),
        onClick: () => {
          setShowCreateEventModal(true)
        },
        tooltip: 'Create new event (Ctrl+N)',
        shortcut: 'Ctrl+N'
      },
      {
        id: 'create-arc',
        label: 'Create Arc',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        ),
        onClick: () => {
          setShowCreateArcPanel(true)
        },
        tooltip: 'Create new arc (Ctrl+Shift+N)',
        shortcut: 'Ctrl+Shift+N'
      }
    ]
  }, [sessionData, updateSessionData])

  // Causal graph-specific actions
  const getCausalGraphActions = useCallback((): ToolbarAction[] => {
    const currentLayout = sessionData.viewportState.causalGraph.layout || 'cose'
    
    return [
      {
        id: 'layout-force',
        label: 'Force Layout',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
        ),
        onClick: () => {
          updateSessionData({
            viewportState: {
              ...sessionData.viewportState,
              causalGraph: {
                ...sessionData.viewportState.causalGraph,
                layout: 'cose'
              }
            }
          })
        },
        tooltip: 'Force-directed layout (1)',
        shortcut: '1',
        disabled: currentLayout === 'cose'
      },
      {
        id: 'layout-hierarchical',
        label: 'Hierarchical Layout',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
          </svg>
        ),
        onClick: () => {
          updateSessionData({
            viewportState: {
              ...sessionData.viewportState,
              causalGraph: {
                ...sessionData.viewportState.causalGraph,
                layout: 'breadthfirst'
              }
            }
          })
        },
        tooltip: 'Hierarchical layout (2)',
        shortcut: '2',
        disabled: currentLayout === 'breadthfirst'
      },
      {
        id: 'layout-circular',
        label: 'Circular Layout',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ),
        onClick: () => {
          updateSessionData({
            viewportState: {
              ...sessionData.viewportState,
              causalGraph: {
                ...sessionData.viewportState.causalGraph,
                layout: 'circle'
              }
            }
          })
        },
        tooltip: 'Circular layout (3)',
        shortcut: '3',
        disabled: currentLayout === 'circle'
      },
      {
        id: 'create-causal-link',
        label: 'Create Link',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
        ),
        onClick: () => {
          setShowCreateCausalLinkModal(true)
        },
        tooltip: 'Create causal relationship (L) - Select 2 events first',
        shortcut: 'L',
        disabled: selectedEvents.length !== 2
      }
    ]
  }, [sessionData, updateSessionData, selectedEvents.length])

  // Actor perspective-specific actions
  const getActorPerspectiveActions = useCallback((): ToolbarAction[] => {
    return [
      {
        id: 'layout-chronological',
        label: 'Chronological',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ),
        onClick: () => {
          setActorLayout('chronological')
        },
        tooltip: 'Chronological layout (C)',
        shortcut: 'C',
        disabled: actorLayout === 'chronological'
      },
      {
        id: 'layout-thematic',
        label: 'Thematic',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
        ),
        onClick: () => {
          setActorLayout('thematic')
        },
        tooltip: 'Thematic layout (T)',
        shortcut: 'T',
        disabled: actorLayout === 'thematic'
      },
      {
        id: 'actor-stats',
        label: showActorStats ? 'Hide Stats' : 'Show Stats',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        ),
        onClick: () => {
          setShowActorStats(!showActorStats)
        },
        tooltip: 'Toggle actor statistics (S)',
        shortcut: 'S'
      }
    ]
  }, [actorLayout, showActorStats])

  // Common actions available in all views
  const getCommonActions = useCallback((): ToolbarAction[] => {
    const hasSelection = selectedEvents.length > 0 || selectedArcs.length > 0
    const hasFilters = Object.values(activeFilters).some(value => 
      Array.isArray(value) ? value.length > 0 : value !== null && value !== '' && value !== 0
    )

    return [
      {
        id: 'copy-graph',
        label: 'Copy Graph',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        ),
        onClick: () => setShowCopyModal(true),
        tooltip: 'Create graph copy (Ctrl+C)',
        shortcut: 'Ctrl+C'
      },
      {
        id: 'copy-progress',
        label: 'Copy Status',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        ),
        onClick: () => setShowProgressPanel(true),
        tooltip: 'View copy operations (Ctrl+Shift+C)',
        shortcut: 'Ctrl+Shift+C'
      },
      {
        id: 'copy-history',
        label: 'Copy History',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ),
        onClick: () => setShowHistoryPanel(true),
        tooltip: 'View copy history (Ctrl+H)',
        shortcut: 'Ctrl+H'
      },
      {
        id: 'toggle-filters',
        label: uiState.filterPanelOpen ? 'Hide Filters' : 'Show Filters',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.207A1 1 0 013 6.5V4z" />
          </svg>
        ),
        onClick: () => setFilterPanelOpen(!uiState.filterPanelOpen),
        tooltip: 'Toggle filter panel (Ctrl+F)',
        shortcut: 'Ctrl+F'
      },
      {
        id: 'clear-selection',
        label: 'Clear Selection',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ),
        onClick: clearSelection,
        disabled: !hasSelection,
        tooltip: 'Clear all selections (Escape)',
        shortcut: 'Escape'
      },
      {
        id: 'clear-filters',
        label: 'Clear Filters',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        ),
        onClick: clearFilters,
        disabled: !hasFilters,
        tooltip: 'Clear all filters (Ctrl+R)',
        shortcut: 'Ctrl+R'
      }
    ]
  }, [selectedEvents.length, selectedArcs.length, activeFilters, uiState.filterPanelOpen, clearSelection, clearFilters, setFilterPanelOpen])

  // Get actions based on current view mode
  const getViewSpecificActions = useCallback((): ToolbarAction[] => {
    switch (viewMode) {
      case 'timeline':
        return getTimelineActions()
      case 'causal':
        return getCausalGraphActions()
      case 'actor-perspective':
        return getActorPerspectiveActions()
      default:
        return []
    }
  }, [viewMode, getTimelineActions, getCausalGraphActions, getActorPerspectiveActions])

  const viewSpecificActions = getViewSpecificActions()
  const commonActions = getCommonActions()
  const allActions = [...viewSpecificActions, ...commonActions]

  // Handle keyboard shortcuts
  React.useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      // Only handle shortcuts when no input is focused
      if (event.target instanceof HTMLInputElement || 
          event.target instanceof HTMLTextAreaElement ||
          event.target instanceof HTMLSelectElement) {
        return
      }

      // Find matching action by shortcut
      const action = allActions.find(action => {
        if (!action.shortcut) return false
        
        const shortcut = action.shortcut.toLowerCase()
        const key = event.key.toLowerCase()
        
        if (shortcut.includes('ctrl+') && !event.ctrlKey) return false
        if (shortcut.includes('shift+') && !event.shiftKey) return false
        if (shortcut.includes('alt+') && !event.altKey) return false
        
        const keyPart = shortcut.split('+').pop()
        return keyPart === key
      })

      if (action && !action.disabled) {
        event.preventDefault()
        action.onClick()
      }
    }

    document.addEventListener('keydown', handleKeyPress)
    return () => document.removeEventListener('keydown', handleKeyPress)
  }, [allActions])

  if (allActions.length === 0) {
    return null
  }

  return (
    <>
      <div className={`flex items-center space-x-2 ${className}`} role="toolbar" aria-label="View toolbar">
        {/* View-specific actions */}
        {viewSpecificActions.length > 0 && (
          <>
            <div className="flex items-center space-x-1">
              {viewSpecificActions.map((action) => (
                <button
                  key={action.id}
                  onClick={action.onClick}
                  disabled={action.disabled}
                  className={`
                    inline-flex items-center px-2 py-1 rounded text-sm font-medium
                    transition-all duration-200 ease-in-out
                    focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1
                    ${action.disabled
                      ? 'text-gray-400 cursor-not-allowed'
                      : 'text-gray-700 hover:text-gray-900 hover:bg-gray-100'
                    }
                  `}
                  title={action.tooltip}
                  aria-label={action.label}
                >
                  {action.icon}
                  <span className="ml-1 hidden sm:inline">{action.label}</span>
                </button>
              ))}
            </div>
            
            {commonActions.length > 0 && (
              <div className="w-px h-6 bg-gray-300" aria-hidden="true" />
            )}
          </>
        )}

        {/* Common actions */}
        {commonActions.length > 0 && (
          <div className="flex items-center space-x-1">
            {commonActions.map((action) => (
              <button
                key={action.id}
                onClick={action.onClick}
                disabled={action.disabled}
                className={`
                  inline-flex items-center px-2 py-1 rounded text-sm font-medium
                  transition-all duration-200 ease-in-out
                  focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1
                  ${action.disabled
                    ? 'text-gray-400 cursor-not-allowed'
                    : 'text-gray-700 hover:text-gray-900 hover:bg-gray-100'
                  }
                `}
                title={action.tooltip}
                aria-label={action.label}
              >
                {action.icon}
                <span className="ml-1 hidden sm:inline">{action.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Graph Copy Modal */}
      <GraphCopyModal
        isOpen={showCopyModal}
        onClose={() => setShowCopyModal(false)}
      />

      {/* Graph Copy Progress Panel */}
      <GraphCopyProgressPanel
        isOpen={showProgressPanel}
        onClose={() => setShowProgressPanel(false)}
        onSwitchToGraph={(graphName) => {
          console.log('Switch to graph:', graphName)
          // TODO: Implement graph switching functionality
          setShowProgressPanel(false)
        }}
      />

      {/* Copy History Panel */}
      <CopyHistoryPanel
        isOpen={showHistoryPanel}
        onClose={() => setShowHistoryPanel(false)}
        onSwitchToGraph={(graphName) => {
          console.log('Switch to graph:', graphName)
          // TODO: Implement graph switching functionality
          setShowHistoryPanel(false)
        }}
        onCompareGraphs={(originalName, copiedName) => {
          setComparisonData({ originalName, copiedName })
          setShowComparisonModal(true)
          setShowHistoryPanel(false)
        }}
        onDeleteCopy={(copyId) => {
          console.log('Delete copy:', copyId)
          // TODO: Implement copy deletion functionality
        }}
      />

      {/* Graph Comparison Modal */}
      <GraphComparisonModal
        isOpen={showComparisonModal}
        onClose={() => {
          setShowComparisonModal(false)
          setComparisonData(null)
        }}
        originalGraphName={comparisonData?.originalName || ''}
        copiedGraphName={comparisonData?.copiedName || ''}
        // TODO: Load actual graph data for comparison
        originalData={undefined}
        copiedData={undefined}
      />

      {/* Create Event Modal */}
      <EventDetailModal
        event={null}
        isOpen={showCreateEventModal}
        onClose={() => setShowCreateEventModal(false)}
        onSave={async (eventData) => {
          const createData: CreateEventRequest = {
            description: eventData.description || '',
            actor: eventData.actor || '',
            target: eventData.target || '',
            timestamp: eventData.timestamp || new Date().toISOString()
          }
          await createEventMutation.mutateAsync(createData)
        }}
      />

      {/* Create Arc Panel */}
      <ArcDetailPanel
        arc={null}
        isOpen={showCreateArcPanel}
        onClose={() => setShowCreateArcPanel(false)}
        onSave={async () => {}}
        onCreate={async (arcData: CreateArcRequest) => {
          await createArcMutation.mutateAsync(arcData)
        }}
      />

      {/* Create Causal Link Modal */}
      <CausalRelationshipModal
        relationship={null}
        isOpen={showCreateCausalLinkModal}
        onClose={() => setShowCreateCausalLinkModal(false)}
        causeEventId={selectedEvents.length === 2 ? selectedEvents[0] : undefined}
        effectEventId={selectedEvents.length === 2 ? selectedEvents[1] : undefined}
        onCreate={async (causeId: string, effectId: string, data: CausalRelationshipData) => {
          await createCausalLinkMutation.mutateAsync({ causeId, effectId, relationship: data })
        }}
      />
    </>
  )
}