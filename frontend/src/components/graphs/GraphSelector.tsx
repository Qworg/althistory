/**
 * GraphSelector Component
 * 
 * Dropdown component for switching between graphs, creating new graphs,
 * and accessing graph management features.
 */

import React, { useState, useCallback, memo, useRef, useEffect, useMemo, useId, type ReactNode } from 'react'
import { useStackedDialogKeys } from '@/components/modals/useStackedDialogKeys'
import {
  useApiAccess,
  useGraphManagement,
  useGraphHeadVersion,
} from '@/hooks/useGraphs'
import { useGlobalStore } from '@/stores/globalStore'
import { GraphCalendar, GraphStatus } from '@/types'
import { formatHistoricalRange, worldYearLabel } from '@/utils/historicalTime'
import { buildGraphTree, branchLabel } from './graphTree'

/** The fork glyph, in the divergence accent: this graph is a branch. */
function ForkGlyph({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={`${className} shrink-0 text-divergence`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <circle cx="6" cy="5" r="2" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="9" r="2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 7v10M18 11c0 4-6 3-11.2 6.4" />
    </svg>
  )
}

/**
 * The UTC year of a timestamp, so a range never shifts by the viewer's zone;
 * in the graph's own years when it has a world calendar. Each graph in the
 * list is labelled by its own calendar, not the open graph's.
 */
function utcYear(value: string, calendar: GraphCalendar | null): string {
  const year = new Date(value).getUTCFullYear()
  return Number.isNaN(year) ? '?' : worldYearLabel(year, calendar) ?? String(year)
}

/**
 * The selector's panel as a bottom sheet, for phones: a modal dialog like the
 * toolbar's More sheet (Escape and the backdrop close it, Tab stays inside,
 * focus returns to the selector button).
 */
function GraphSheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  useStackedDialogKeys(panelRef, true, onClose)

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const first =
      panelRef.current?.querySelector<HTMLElement>('[aria-current="true"]') ??
      panelRef.current?.querySelector<HTMLElement>('button')
    first?.focus()
    return () => {
      if (opener && typeof opener.focus === 'function' && opener.isConnected) opener.focus()
    }
  }, [])

  return (
    <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        className="absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col overflow-y-auto overscroll-contain rounded-t-xl border-t border-line bg-card text-ink shadow-xl"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-1">
          <h2 id={titleId} className="font-display text-lg font-semibold text-ink">
            Graphs
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-11 w-11 items-center justify-center rounded-md text-ink-muted hover:bg-subtle hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-selected"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

interface GraphSelectorProps {
  onOpenManager?: () => void
  className?: string
  /** Open as a bottom sheet (phones) rather than a panel under the button. */
  sheet?: boolean
}

export const GraphSelector = memo(function GraphSelector({ 
  onOpenManager,
  className = '',
  sheet = false,
}: GraphSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [newGraphName, setNewGraphName] = useState('')
  const [filter, setFilter] = useState<GraphStatus | 'all'>('active')
  
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const {
    activeGraphId,
    activeGraph,
    graphs,
    switchGraph,
    createGraph,
    isLoading,
    isCreating: isCreatingGraph,
    isSwitching,
  } = useGraphManagement()
  const headVersion = useGraphHeadVersion(activeGraphId, activeGraph?.version)
  const accessProblem = useApiAccess()

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      // The sheet is portaled out of this component's DOM and has its own
      // backdrop to close it; a press inside it is not "outside".
      if (sheet) return
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
        setIsCreating(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [sheet])

  // Focus input when creating
  useEffect(() => {
    if (isCreating && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isCreating])

  const closePanel = useCallback(() => {
    setIsOpen(false)
    setIsCreating(false)
  }, [])

  const handleToggle = useCallback(() => {
    setIsOpen(prev => !prev)
    setIsCreating(false)
  }, [])

  const handleSelectGraph = useCallback((graphId: string) => {
    if (graphId !== activeGraphId) {
      switchGraph(graphId)
    }
    setIsOpen(false)
  }, [activeGraphId, switchGraph])

  const handleStartCreate = useCallback(() => {
    setIsCreating(true)
    setNewGraphName('')
  }, [])

  const handleCancelCreate = useCallback(() => {
    setIsCreating(false)
    setNewGraphName('')
  }, [])

  const handleCreate = useCallback(async () => {
    if (!newGraphName.trim()) return

    try {
      const newGraph = await createGraph({ name: newGraphName.trim() })
      switchGraph(newGraph.id)
      setIsCreating(false)
      setNewGraphName('')
      setIsOpen(false)
    } catch (error) {
      console.error('Failed to create graph:', error)
      const addError = useGlobalStore.getState?.()?.addError
      addError?.({
        type: 'network',
        message: `Failed to create graph: ${error instanceof Error ? error.message : 'Unknown error'}`,
      })
    }
  }, [newGraphName, createGraph, switchGraph])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCreate()
    } else if (e.key === 'Escape') {
      handleCancelCreate()
    }
  }, [handleCreate, handleCancelCreate])

  // Branches are listed under the graph they were forked from.
  const graphTree = useMemo(
    () => buildGraphTree(filter === 'all' ? graphs : graphs.filter(g => g.status === filter)),
    [graphs, filter]
  )
  const activeIsBranch = Boolean(activeGraph?.parentGraphId)

  // While the graph list loads there is already an active graph; inviting the
  // user to "Select Graph" then contradicted the timeline beneath it.
  // Refused access is not "no graphs": the list is unreadable, so the
  // selector says what is missing and stays shut (the view takes the key).
  const displayName = accessProblem
    ? accessProblem === 'forbidden'
      ? 'Key can’t read graphs'
      : 'API key needed'
    : activeGraph?.name || (isLoading ? 'Loading graph…' : 'Select a graph')
  const isDisabled = isLoading || isSwitching || Boolean(accessProblem)

  const panelBody = (
    <>
          {/* Filter Tabs */}
          <div className="flex border-b border-line">
            {(['active', 'archived', 'all'] as const).map(status => (
              <button
                key={status}
                onClick={() => setFilter(status)}
                className={`
                  flex-1 px-3 py-2 text-sm font-medium capitalize
                  ${filter === status 
                    ? 'text-baseline border-b-2 border-baseline' 
                    : 'text-ink-muted hover:text-ink'}
                `}
              >
                {status}
              </button>
            ))}
          </div>

          {/* Graph List: each branch indented under its baseline, with a fork
              glyph, showing only the part of its name that is its own ("Clerks
              Prevail" under "The Engine Age"). The full name stays the
              accessible name, and names wrap instead of truncating. */}
          <div className="max-h-80 overflow-y-auto">
            {graphTree.length === 0 ? (
              <div className="px-4 py-3 text-sm text-ink-muted text-center">
                No {filter !== 'all' ? filter : ''} graphs found
              </div>
            ) : (
              graphTree.map(({ graph, parent, depth }) => {
                const isActive = graph.id === activeGraphId
                const shortName = branchLabel(graph, parent)
                const showsShortName = shortName !== graph.name
                return (
                  <button
                    key={graph.id}
                    onClick={() => handleSelectGraph(graph.id)}
                    aria-current={isActive ? 'true' : undefined}
                    data-depth={depth}
                    style={depth > 0 ? { paddingLeft: `${1 + depth * 1.25}rem` } : undefined}
                    className={`
                      w-full px-4 py-3 text-left hover:bg-subtle transition-colors
                      ${isActive ? 'bg-selected/10' : ''}
                      flex items-start gap-3
                    `}
                  >
                    {/* Selection Indicator, or the fork glyph for a branch */}
                    {depth > 0 ? (
                      <span className="relative mt-0.5 flex-shrink-0">
                        <ForkGlyph />
                        {isActive && (
                          <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-selected" aria-hidden="true" />
                        )}
                      </span>
                    ) : (
                      <span
                        className={`
                          mt-1.5 w-2 h-2 rounded-full flex-shrink-0
                          ${isActive ? 'bg-selected' : 'bg-transparent'}
                        `}
                        aria-hidden="true"
                      />
                    )}

                    <div className="flex-1 min-w-0">
                      {/* Graph Name (two lines at most, never cut mid-word) */}
                      <div className="font-medium text-ink break-words line-clamp-2">
                        {showsShortName ? (
                          <>
                            <span aria-hidden="true">{shortName}</span>
                            <span className="sr-only">{graph.name}</span>
                          </>
                        ) : (
                          graph.name
                        )}
                        {graph.branchName && graph.branchName !== graph.name && graph.branchName !== shortName && (
                          <span className="ml-1.5 text-xs text-ink-secondary border border-divergence/50 px-1.5 py-0.5 rounded">
                            {graph.branchName}
                          </span>
                        )}
                      </div>

                      {/* Description */}
                      {graph.description && (
                        <div className="text-sm text-ink-muted line-clamp-2 mt-0.5">
                          {graph.description}
                        </div>
                      )}

                      {/* Metadata */}
                      <div className="font-mono-code flex flex-wrap items-center gap-x-3 mt-1 text-xs text-ink-muted">
                        <span>{graph.metadata.eventCount} events</span>
                        <span>{graph.metadata.arcCount} arcs</span>
                        {graph.metadata.temporalRange && (
                          <span
                            title={formatHistoricalRange(
                              graph.metadata.temporalRange.start,
                              graph.metadata.temporalRange.end,
                              undefined,
                              graph.calendar ?? null
                            )}
                          >
                            {utcYear(graph.metadata.temporalRange.start, graph.calendar ?? null)}–{utcYear(graph.metadata.temporalRange.end, graph.calendar ?? null)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Status Badge */}
                    {graph.status !== 'active' && (
                      <span className={`
                        text-xs px-1.5 py-0.5 rounded capitalize
                        ${graph.status === 'archived' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}
                      `}>
                        {graph.status}
                      </span>
                    )}
                  </button>
                )
              })
            )}
          </div>

          {/* Create New Graph */}
          <div className="border-t border-line p-2">
            {isCreating ? (
              <div className="flex gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={newGraphName}
                  onChange={(e) => setNewGraphName(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Graph name..."
                  className="flex-1 px-3 py-2 border border-line bg-card text-ink rounded text-sm focus:outline-none focus:ring-2 focus:ring-selected"
                />
                <button
                  onClick={handleCreate}
                  disabled={!newGraphName.trim() || isCreatingGraph}
                  className="px-3 py-2 bg-baseline text-on-accent rounded text-sm hover:bg-baseline/90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isCreatingGraph ? '...' : 'Create'}
                </button>
                <button
                  onClick={handleCancelCreate}
                  className="px-2 py-2 text-ink-muted hover:text-ink"
                  aria-label="Cancel new graph"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={handleStartCreate}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm text-baseline hover:bg-blue-50 rounded transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  New Graph
                </button>
          
                {onOpenManager && (
                  <button
                    onClick={() => {
                      setIsOpen(false)
                      onOpenManager()
                    }}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-ink-secondary hover:bg-subtle rounded transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" 
                      />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    Manage
                  </button>
                )}
              </div>
            )}
          </div>
    </>
  )

  return (
    <div ref={dropdownRef} className={`relative ${className}`}>
      {/* Main Button */}
      <button
        onClick={handleToggle}
        disabled={isDisabled}
        className={`
          flex items-center gap-2 px-3 py-2 rounded-lg border border-line
          ${isDisabled 
            ? 'bg-subtle text-ink-muted cursor-not-allowed'
            : 'bg-card hover:bg-subtle text-ink cursor-pointer'}
          transition-colors min-w-[200px]
        `}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        {/* Graph Icon: the fork glyph when the active graph is a branch */}
        {activeIsBranch ? (
          <ForkGlyph className="w-5 h-5" />
        ) : (
          <svg className="w-5 h-5 text-ink-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
              d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" 
            />
          </svg>
        )}

        {/* Graph Name */}
        <span className="flex-1 text-left truncate font-medium">
          {isSwitching ? 'Switching...' : displayName}
        </span>

        {/* Version Badge: the Version history number, the one merge and
            restore speak in (see useGraphHeadVersion) */}
        {activeGraph && headVersion !== null && (
          <span
            className="font-mono-code text-xs text-ink-muted bg-subtle px-1.5 py-0.5 rounded"
            title={`Version ${headVersion} in Version history`}
          >
            v{headVersion}
          </span>
        )}

        {/* Chevron */}
        <svg 
          className={`w-4 h-4 text-ink-muted transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown Menu: a panel under the button on desktop; on a phone a
          bottom sheet, because a 20rem panel anchored to the button's right
          edge started off the left of a 390px screen. */}
      {isOpen && !sheet && (
        <div className="absolute top-full right-0 mt-1 w-80 max-w-[calc(100vw-2rem)] bg-card text-ink border border-line rounded-lg shadow-lg z-50">
          {panelBody}
        </div>
      )}
      {isOpen && sheet && (
        <GraphSheet onClose={closePanel}>{panelBody}</GraphSheet>
      )}
    </div>
  )
})

export default GraphSelector
