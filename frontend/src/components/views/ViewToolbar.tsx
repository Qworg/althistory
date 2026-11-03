import React, { useCallback, useEffect, useId, useRef, useState } from 'react'
import { shouldIgnoreAppShortcut } from '@/utils/keyboardShortcuts'
import { useGlobalStore } from '@/stores/globalStore'
import { ViewMode, CreateEventRequest, CreateArcRequest } from '@/types'
import {
  GraphCopyModal,
  GraphCopyProgressPanel,
  CopyHistoryPanel,
  GraphComparisonModal,
  EventDetailModal,
  ArcDetailPanel
} from '@/components/modals'
import { PanelBase } from '@/components/modals/ModalBase'
import { ExportPanel, VersionHistoryPanel } from '@/components/graphs'
import { ImportWizard } from '@/components/import'
import { IngestionWizard } from '@/components/ingestion'
import { useCreateEvent, useCreateArc } from '@/hooks/useAPI'
import { useActiveGraphId, useSwitchGraph, useDeleteGraph } from '@/hooks/useGraphs'
import { StreamingStatusBadge } from '@/components/streaming/StreamingStatusBadge'
import { useStreamingWrite } from '@/hooks/useStreamingWrite'
import { MoreSheet } from '@/components/layout/MoreSheet'
import { useMoreSheetStore } from '@/components/layout/moreSheetStore'

interface ViewToolbarProps {
  viewMode: ViewMode
  className?: string
  /**
   * The phone layout (below `lg`): only the view's primary actions and the
   * filter controls, as 44px icon buttons. Graph management and streaming move
   * to the MobileBottomBar's "More" sheet, which this toolbar draws. Every
   * keyboard shortcut keeps working either way.
   */
  compact?: boolean
}

interface ToolbarAction {
  id: string
  label: string
  icon: React.ReactNode
  onClick: () => void
  disabled?: boolean
  tooltip?: string
  shortcut?: string
  /** A toggle's state: rendered as aria-pressed with the selected styling. */
  pressed?: boolean
  /** Keyboard-only: the control it stands for lives in the view itself. */
  hidden?: boolean
}

/**
 * Graph-management actions, collapsed into the toolbar's "Graph" menu. Their
 * keyboard shortcuts work whether or not the menu is open.
 */
const GRAPH_MENU_ACTION_IDS = new Set([
  'copy-graph',
  'copy-progress',
  'copy-history',
  'export-data',
  'version-history'
])

/** Graph-level actions shown beside the Graph menu on desktop. */
const GRAPH_TOOL_ACTION_IDS = new Set(['branch-divergence', 'import-data', 'ingest-data'])

/** Shown only when they would do something (their shortcuts still apply). */
const CONDITIONAL_ACTION_IDS = new Set(['clear-selection', 'clear-filters'])

/** "Show copy history (Shift+H)" -> "Show copy history": no keys on a touch sheet. */
const withoutShortcut = (text?: string) => text?.replace(/\s*\([^)]*\)\s*$/, '')

export function ViewToolbar({ viewMode, className = '', compact = false }: ViewToolbarProps) {
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
  const [showImportWizard, setShowImportWizard] = useState(false)
  const [showIngestionWizard, setShowIngestionWizard] = useState(false)
  const [showExportPanel, setShowExportPanel] = useState(false)
  const [showVersionHistory, setShowVersionHistory] = useState(false)
  const [comparisonData, setComparisonData] = useState<{
    originalName: string
    copiedName: string
    /** The copy's graph id: the graph the comparison is against. */
    copiedGraphId: string
  } | null>(null)

  const moreSheetOpen = useMoreSheetStore((state) => state.isOpen)
  const setMoreSheetOpen = useMoreSheetStore((state) => state.setOpen)

  // Widening past lg puts the tools back on the toolbar: the sheet must not
  // reopen by itself on the way back down.
  useEffect(() => {
    if (!compact && moreSheetOpen) setMoreSheetOpen(false)
  }, [compact, moreSheetOpen, setMoreSheetOpen])

  // Mutations
  const createEventMutation = useCreateEvent()
  const createArcMutation = useCreateArc()

  // Graph-level operations (copy switching/deletion and the import/export tools)
  // all act on the active graph, so they share the same hooks as GraphSelector.
  const activeGraphId = useActiveGraphId()
  const switchGraphMutation = useSwitchGraph()
  const deleteGraphMutation = useDeleteGraph()

  // A copy's id is the id of the graph the copy created, so the id is all
  // that is needed to switch to it. Resolving a name against the graph list
  // would fail right after a copy: the list has not been refreshed, and the
  // copy is not in it.
  const handleSwitchToGraph = useCallback((graphId: string) => {
    switchGraphMutation.mutate(graphId)
  }, [switchGraphMutation])

  // A copy's id is the id of the graph the copy created (see POST /graphs/copy),
  // so deleting a copy is deleting that graph.
  const handleDeleteCopy = useCallback((copyId: string) => {
    deleteGraphMutation.mutate(copyId)
  }, [deleteGraphMutation])

  // High-throughput WebSocket streaming write state
  const {
    status: streamStatus,
    stats: streamStats,
    error: streamError,
    connect: connectStream,
    disconnect: disconnectStream,
  } = useStreamingWrite({ graphId: activeGraphId ?? undefined })

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
        tooltip: 'Create new event (E)',
        shortcut: 'E'
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
        tooltip: 'Create new arc (A)',
        shortcut: 'A'
      }
    ]
  }, [sessionData, updateSessionData])

  // Causal graph view: no toolbar actions of its own. The canvas's layout
  // panel is the one layout control (its keys 1-8, F and R are its own), and
  // its Draw Link (D) is the one way to link events.

  // Actor perspective-specific actions. The layout is chosen in the view's own
  // segmented control; C and T stay bound here, writing the same session state
  // that control reads, so there is one layout switch and it has keys.
  const getActorPerspectiveActions = useCallback((): ToolbarAction[] => {
    const actorState = sessionData?.viewportState?.actorPerspective
    const currentLayout = actorState?.layout ?? 'chronological'
    const currentShowStats = actorState?.showStats ?? true

    const writeActorState = (next: Partial<{ layout: 'chronological' | 'thematic'; showStats: boolean }>) => {
      updateSessionData({
        viewportState: {
          ...sessionData.viewportState,
          actorPerspective: {
            layout: currentLayout,
            showStats: currentShowStats,
            ...next
          }
        }
      })
    }

    return [
      {
        id: 'actor-stats',
        label: 'Statistics',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        ),
        onClick: () => writeActorState({ showStats: !currentShowStats }),
        pressed: currentShowStats,
        tooltip: 'Show or hide actor statistics (S)',
        shortcut: 'S'
      },
      {
        id: 'layout-chronological',
        label: 'Chronological layout',
        icon: null,
        hidden: true,
        onClick: () => writeActorState({ layout: 'chronological' }),
        shortcut: 'C'
      },
      {
        id: 'layout-thematic',
        label: 'Thematic layout',
        icon: null,
        hidden: true,
        onClick: () => writeActorState({ layout: 'thematic' }),
        shortcut: 'T'
      }
    ]
  }, [sessionData, updateSessionData])

  // Common actions available in all views
  const getCommonActions = useCallback((): ToolbarAction[] => {
    const hasSelection = selectedEvents.length > 0 || selectedArcs.length > 0
    const hasFilters = Object.entries(activeFilters).some(([key, value]) => {
      if (key === 'causalWeightRange') {
        return Array.isArray(value) && (value[0] !== 0 || value[1] !== 1)
      }
      return Array.isArray(value) ? value.length > 0 : value !== null && value !== '' && value !== 0
    })

    return [
      {
        id: 'copy-graph',
        label: 'Branch or copy…',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <circle cx="6" cy="6" r="2" />
            <circle cx="6" cy="18" r="2" />
            <circle cx="18" cy="9" r="2" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 8v8M6 12c0-2 1.5-3 4-3h6" />
          </svg>
        ),
        onClick: () => setShowCopyModal(true),
        tooltip: 'Fork a what-if branch, or make a plain copy (Shift+B)',
        shortcut: 'Shift+B'
      },
      {
        id: 'copy-progress',
        label: 'Copy progress',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        ),
        onClick: () => setShowProgressPanel(true),
        tooltip: 'Show copies in progress (Shift+S)',
        shortcut: 'Shift+S'
      },
      {
        id: 'copy-history',
        label: 'Copy history',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ),
        onClick: () => setShowHistoryPanel(true),
        tooltip: 'Show copy history (Shift+H)',
        shortcut: 'Shift+H'
      },
      {
        id: 'branch-divergence',
        label: 'Compare branches',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
          </svg>
        ),
        onClick: () => setShowComparisonModal(true),
        tooltip: 'Compare this graph with a counterfactual branch: where they diverge and what changed'
      },
      {
        id: 'import-data',
        label: 'Import',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        ),
        onClick: () => setShowImportWizard(true),
        tooltip: 'Import graph archive (JSON/CSV)'
      },
      {
        id: 'ingest-data',
        label: 'Ingest',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
          </svg>
        ),
        onClick: () => setShowIngestionWizard(true),
        tooltip: 'Extract historical events from Wikipedia, Wikidata, or text'
      },
      {
        id: 'export-data',
        label: 'Export',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
        ),
        onClick: () => setShowExportPanel(true),
        tooltip: 'Export active graph archive'
      },
      {
        id: 'version-history',
        label: 'Versions',
        // Stacked snapshots, so it does not share Copy history's clock.
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l9 4.5-9 4.5-9-4.5L12 3z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l9 4.5 9-4.5M3 16.5L12 21l9-4.5" />
          </svg>
        ),
        onClick: () => setShowVersionHistory(true),
        tooltip: 'View version history and restore snapshots'
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
        tooltip: 'Toggle filter panel (Shift+F)',
        shortcut: 'Shift+F'
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
        tooltip: 'Clear all filters (Shift+R)',
        shortcut: 'Shift+R'
      }
    ]
  }, [selectedEvents.length, selectedArcs.length, activeFilters, uiState.filterPanelOpen, clearSelection, clearFilters, setFilterPanelOpen])

  // Get actions based on current view mode
  const getViewSpecificActions = useCallback((): ToolbarAction[] => {
    switch (viewMode) {
      case 'timeline':
        return getTimelineActions()
      case 'causal':
        return []
      case 'actor-perspective':
        return getActorPerspectiveActions()
      default:
        return []
    }
  }, [viewMode, getTimelineActions, getActorPerspectiveActions])

  const viewSpecificActions = getViewSpecificActions().filter(action => !action.hidden)
  const commonActions = getCommonActions()
  const graphMenuActions = commonActions.filter(action => GRAPH_MENU_ACTION_IDS.has(action.id))
  const graphToolActions = commonActions.filter(action => GRAPH_TOOL_ACTION_IDS.has(action.id))
  // Filters and the conditional clears: on the toolbar at every width.
  const viewStateActions = commonActions.filter(action =>
    !GRAPH_MENU_ACTION_IDS.has(action.id) &&
    !GRAPH_TOOL_ACTION_IDS.has(action.id) &&
    !(CONDITIONAL_ACTION_IDS.has(action.id) && action.disabled)
  )

  // Memoised so the keyboard-shortcut effect below is not re-subscribed on every
  // render; both builders are themselves useCallback'd and rebuild exactly when
  // the state their actions depend on changes.
  const allActions = React.useMemo<Array<ToolbarAction>>(
    () => [...getViewSpecificActions(), ...getCommonActions()],
    [getViewSpecificActions, getCommonActions]
  )

  // Handle keyboard shortcuts
  React.useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      // Not while typing, composing, or with a modal dialog open
      if (shouldIgnoreAppShortcut(event)) {
        return
      }

      // Find matching action by shortcut
      const action = allActions.find(action => {
        if (!action.shortcut) return false
        
        const shortcuts = action.shortcut.toLowerCase().split('|')
        const key = event.key.toLowerCase()
        
        return shortcuts.some(shortcut => {
          // Modifiers must match exactly, not merely be present: otherwise the
          // plain "F" (fit) also fired on Ctrl+F and "C" (chronological)
          // swallowed Ctrl+C copy.
          //
          // Toolbar shortcuts are bare keys or Shift+key, the convention web
          // apps use (Gmail, GitHub, Google Calendar's "c", Linear): Ctrl/⌘
          // combinations belong to the browser and OS. Ctrl+N, Ctrl+Shift+N
          // and Ctrl+T never reach the page; Ctrl+F/R/H would hijack find,
          // reload and history; and ⌘H hides the app on macOS. So no toolbar
          // shortcut uses Ctrl, nothing fires with Meta held, and there is no
          // Ctrl-vs-⌘ variant to maintain.
          if (shortcut.includes('ctrl+') !== event.ctrlKey) return false
          if (shortcut.includes('shift+') !== event.shiftKey) return false
          if (shortcut.includes('alt+') !== event.altKey) return false
          if (event.metaKey) return false

          const keyPart = shortcut.split('+').pop()
          return keyPart === key
        })
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

  const streamingBadge = (
    <StreamingStatusBadge
      status={streamStatus}
      stats={streamStats}
      error={streamError}
      onConnect={connectStream}
      onDisconnect={disconnectStream}
    />
  )

  const renderButton = (action: ToolbarAction) => {
    const isPrimaryCreate = action.id === 'create-event' || action.id === 'create-arc'
    const isDivergenceExplorer = action.id === 'branch-divergence'
    const isActiveFilterToggle = action.id === 'toggle-filters' && uiState.filterPanelOpen
    const isSelected = action.pressed === true || isActiveFilterToggle
    // Clear actions are icon-only until wide screens: they come and go with state.
    const labelClass = CONDITIONAL_ACTION_IDS.has(action.id) ? 'lg:inline' : 'sm:inline'
    return (
      <button
        key={action.id}
        type="button"
        onClick={action.onClick}
        disabled={action.disabled}
        aria-pressed={action.pressed}
        className={`
          inline-flex items-center rounded-md text-xs sm:text-sm font-medium
          transition-colors duration-200 ease-out
          focus:outline-none focus-visible:ring-2 focus-visible:ring-selected focus-visible:ring-offset-1
          ${compact ? 'h-11 min-w-11 justify-center px-2.5' : 'px-2.5 py-1'}
          ${action.disabled
            ? 'text-ink-muted opacity-60 cursor-not-allowed'
            : isPrimaryCreate
              ? 'bg-baseline/10 text-baseline border border-baseline/25 hover:bg-baseline/15'
              : isDivergenceExplorer
                ? 'bg-amber-50/80 text-amber-900 border border-amber-200/80 hover:bg-amber-100'
                : isSelected
                  ? 'bg-subtle text-ink border border-line'
                  : 'text-ink-secondary hover:text-ink hover:bg-subtle border border-transparent'
          }
        `}
        title={action.tooltip}
        aria-label={action.label}
      >
        {action.icon}
        {!compact && <span className={`ml-1 hidden ${labelClass}`}>{action.label}</span>}
      </button>
    )
  }

  const divider = <div className="w-px h-5 bg-line" aria-hidden="true" />

  return (
    <>
      {compact ? (
        // Phone: the view's primary actions and the filter controls, one row.
        <div className={`flex items-center gap-1 ${className}`} role="toolbar" aria-label="View toolbar">
          {viewSpecificActions.map(renderButton)}
          {viewSpecificActions.length > 0 && divider}
          {viewStateActions.map(renderButton)}
        </div>
      ) : (
        <div className={`flex flex-wrap items-center gap-x-2 gap-y-1.5 ${className}`} role="toolbar" aria-label="View toolbar">
          {viewSpecificActions.length > 0 && (
            <>
              <div className="flex flex-wrap items-center gap-1">
                {viewSpecificActions.map(renderButton)}
              </div>
              {divider}
            </>
          )}

          {/* Graph management: the Graph menu, then the graph-level tools */}
          <div className="flex flex-wrap items-center gap-1">
            {graphMenuActions.length > 0 && <GraphMenu actions={graphMenuActions} />}
            {graphToolActions.map(renderButton)}
          </div>
          {divider}

          {/* What the views show: filters and selection */}
          <div className="flex flex-wrap items-center gap-1">
            {viewStateActions.map(renderButton)}
          </div>

          {divider}
          {streamingBadge}
        </div>
      )}

      {/* Phone overflow, opened from the MobileBottomBar's "More" button */}
      {compact && (
        <MoreSheet
          isOpen={moreSheetOpen}
          onClose={() => setMoreSheetOpen(false)}
          groups={[
            {
              label: 'Graph',
              items: [...graphMenuActions, ...graphToolActions.filter(a => a.id === 'branch-divergence')].map(action => ({
                id: action.id,
                label: action.label,
                icon: action.icon,
                description: withoutShortcut(action.tooltip),
                onClick: action.onClick
              }))
            },
            {
              label: 'Bring in history',
              items: graphToolActions.filter(a => a.id !== 'branch-divergence').map(action => ({
                id: action.id,
                label: action.label,
                icon: action.icon,
                description: withoutShortcut(action.tooltip),
                onClick: action.onClick
              }))
            }
          ]}
          footer={
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-ink-muted">Live streaming</span>
              {streamingBadge}
            </div>
          }
        />
      )}

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
          handleSwitchToGraph(graphName)
          setShowProgressPanel(false)
        }}
      />

      {/* Copy History Panel */}
      <CopyHistoryPanel
        isOpen={showHistoryPanel}
        onClose={() => setShowHistoryPanel(false)}
        onSwitchToGraph={(graphName) => {
          handleSwitchToGraph(graphName)
          setShowHistoryPanel(false)
        }}
        onCompareGraphs={(originalName, copiedName, copiedGraphId) => {
          // The copy's id is passed all the way through: without it the
          // comparison falls back to "the first graph that is not the active
          // one", which is not necessarily the copy that was clicked.
          setComparisonData({ originalName, copiedName, copiedGraphId })
          setShowComparisonModal(true)
          setShowHistoryPanel(false)
        }}
        onDeleteCopy={handleDeleteCopy}
      />

      {/* Compare branches (BranchComparisonModal via GraphComparisonModal) */}
      <GraphComparisonModal
        isOpen={showComparisonModal}
        onClose={() => {
          setShowComparisonModal(false)
          setComparisonData(null)
        }}
        initialBaselineGraphId={activeGraphId ?? undefined}
        initialCounterfactualGraphId={comparisonData?.copiedGraphId}
        originalGraphName={comparisonData?.originalName || ''}
        copiedGraphName={comparisonData?.copiedName || ''}
      />

      {/* Import Wizard (Req 18) */}
      {showImportWizard && (
        <ImportWizard
          isOpen
          onClose={() => setShowImportWizard(false)}
          targetGraphId={activeGraphId ?? undefined}
        />
      )}

      {/* Ingestion Wizard (Req 19) */}
      {showIngestionWizard && (
        <IngestionWizard
          isOpen
          onClose={() => setShowIngestionWizard(false)}
          targetGraphId={activeGraphId ?? undefined}
        />
      )}

      {/* Export Panel (Req 5) */}
      <PanelBase
        isOpen={showExportPanel}
        onClose={() => setShowExportPanel(false)}
        title="Export Graph"
        width="28rem"
      >
        <ExportPanel />
      </PanelBase>

      {/* Version History Panel (Req 17.5). The panel titles it, so the
          component's own header is hidden. */}
      <PanelBase
        isOpen={showVersionHistory}
        onClose={() => setShowVersionHistory(false)}
        title="Version history"
        width="28rem"
      >
        <VersionHistoryPanel hideHeader />
      </PanelBase>

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

    </>
  )
}

interface GraphMenuProps {
  actions: ToolbarAction[]
}

/**
 * The "Graph" disclosure menu: copy, copy status/history, export, versions.
 * Follows the WAI-ARIA menu button pattern: the trigger opens the menu with
 * click, Enter, Space or ArrowDown (ArrowUp focuses the last item); arrow keys,
 * Home and End move between items; Escape closes it and returns focus to the
 * trigger, as does choosing an item; Tab or a click outside closes it.
 */
function GraphMenu({ actions }: GraphMenuProps) {
  const [open, setOpen] = useState(false)
  const [initialFocus, setInitialFocus] = useState<'first' | 'last'>('first')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const menuId = useId()

  const openMenu = (focus: 'first' | 'last') => {
    setInitialFocus(focus)
    setOpen(true)
  }

  const closeMenu = useCallback((returnFocus: boolean) => {
    setOpen(false)
    if (returnFocus) triggerRef.current?.focus()
  }, [])

  // Move focus into the menu when it opens.
  useEffect(() => {
    if (!open) return
    const items = itemRefs.current.filter((el): el is HTMLButtonElement => el !== null)
    const target = initialFocus === 'last' ? items[items.length - 1] : items[0]
    target?.focus()
  }, [open, initialFocus])

  // A press outside the trigger and the menu closes it, leaving focus where
  // the press put it.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
    }
  }, [open])

  const focusItem = (index: number) => {
    const items = itemRefs.current.filter((el): el is HTMLButtonElement => el !== null)
    if (items.length === 0) return
    const wrapped = (index + items.length) % items.length
    items[wrapped]?.focus()
  }

  const handleTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      openMenu('first')
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      openMenu('last')
    } else if (event.key === 'Escape' && open) {
      // Keep the toolbar's Escape (clear selection) from also firing.
      event.preventDefault()
      event.stopPropagation()
      closeMenu(true)
    }
  }

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = itemRefs.current.filter((el): el is HTMLButtonElement => el !== null)
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        focusItem(current + 1)
        break
      case 'ArrowUp':
        event.preventDefault()
        focusItem(current - 1)
        break
      case 'Home':
        event.preventDefault()
        focusItem(0)
        break
      case 'End':
        event.preventDefault()
        focusItem(items.length - 1)
        break
      case 'Escape':
        // Keep the toolbar's Escape (clear selection) from also firing.
        event.preventDefault()
        event.stopPropagation()
        closeMenu(true)
        break
      case 'Tab':
        closeMenu(false)
        break
    }
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? closeMenu(false) : openMenu('first'))}
        onKeyDown={handleTriggerKeyDown}
        title="Branch, copy, export and version this graph"
        className={`
          inline-flex items-center px-2 py-1 rounded-md text-xs sm:text-sm font-medium
          transition-all duration-200 ease-in-out
          focus:outline-none focus:ring-2 focus:ring-selected focus:ring-offset-1
          ${open ? 'bg-subtle text-ink' : 'text-ink-secondary hover:text-ink hover:bg-subtle'}
        `}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
        </svg>
        <span className="ml-1">Graph</span>
        <svg
          className={`w-3 h-3 ml-0.5 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Graph"
          onKeyDown={handleMenuKeyDown}
          className="absolute left-0 top-full mt-1 z-40 w-max min-w-[14rem] py-1 bg-card border border-line rounded-md shadow-lg"
        >
          {actions.map((action, index) => (
            <button
              key={action.id}
              ref={(el) => { itemRefs.current[index] = el }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              aria-label={action.label}
              aria-disabled={action.disabled || undefined}
              title={action.tooltip}
              onClick={() => {
                if (action.disabled) return
                closeMenu(true)
                action.onClick()
              }}
              className={`
                w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm
                focus:outline-none focus:bg-subtle
                ${action.disabled ? 'text-ink-muted opacity-60 cursor-not-allowed' : 'text-ink-secondary hover:bg-subtle hover:text-ink'}
              `}
            >
              <span aria-hidden="true">{action.icon}</span>
              {/* One line per item: the menu grows to its longest label. */}
              <span className="flex-1 whitespace-nowrap">{action.label}</span>
              {action.shortcut && (
                <kbd className="ml-4 font-mono-code text-xs text-ink-muted" aria-hidden="true">
                  {action.shortcut}
                </kbd>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
