import { useCallback, useEffect, useId, useState, useRef } from 'react'
import { shouldIgnoreAppShortcut } from '@/utils/keyboardShortcuts'
import type { Core, Layouts, NodeSingular } from 'cytoscape'
import { useGlobalStore } from '@/stores/globalStore'
import {
  getLayoutFromShortcut,
  getShortcutForLayout,
  isPrimaryLayout,
  PRIMARY_LAYOUT_NAMES,
  getDefaultLayoutOptions,
  DEFAULT_LAYOUT_OPTIONS,
  getPreviewLayoutOptions,
  isActionShortcut,
  getActionFromShortcut,
  LAYOUT_TIMEOUT_MS,
  PREVIEW_TIMEOUT_MS,
  FIT_PADDING,
  DEFAULT_ZOOM,
  LayoutConfig,
  LayoutOptions,
  toCytoscapeLayoutOptions
} from '@/utils/layoutManagerUtils'

export type { LayoutConfig }

export interface CausalGraphLayoutManagerProps {
  cytoscapeInstance: Core | null
  className?: string
  onLayoutChange?: (layoutName: string) => void
  showLayoutPreview?: boolean
}

// Options come from DEFAULT_LAYOUT_OPTIONS, the one tuned set the canvas also
// uses, so a layout looks the same however it was chosen.
const layoutConfigs: LayoutConfig[] = [
  {
    name: 'time',
    label: 'Time order',
    description: 'Events left to right by date, as on the timeline: every cause left of its effects',
    category: 'hierarchical',
    options: { ...DEFAULT_LAYOUT_OPTIONS['time'] }
  },
  {
    name: 'cose',
    label: 'Clusters',
    description: 'Linked events pull together; unlinked ones drift apart',
    category: 'force',
    options: { ...DEFAULT_LAYOUT_OPTIONS['cose'] }
  },
  {
    name: 'cose-bilkent',
    label: 'Tight clusters',
    description: 'Like Clusters, with tighter, cleaner groups',
    category: 'force',
    options: { ...DEFAULT_LAYOUT_OPTIONS['cose-bilkent'] }
  },
  {
    name: 'breadthfirst',
    label: 'Tree',
    description: 'Root causes at the top, their effects in levels below',
    category: 'hierarchical',
    options: { ...DEFAULT_LAYOUT_OPTIONS['breadthfirst'] }
  },
  {
    name: 'dagre',
    label: 'Cause to effect',
    description: 'Every cause above its effects, ranked step by step',
    category: 'hierarchical',
    options: { ...DEFAULT_LAYOUT_OPTIONS['dagre'] }
  },
  {
    name: 'circle',
    label: 'Ring',
    description: 'Every event on one circle, so each link is in view',
    category: 'circular',
    options: { ...DEFAULT_LAYOUT_OPTIONS['circle'] }
  },
  {
    name: 'concentric',
    label: 'Hubs at centre',
    description: 'The most-linked events in the middle, the least at the edge',
    category: 'circular',
    options: {
      ...DEFAULT_LAYOUT_OPTIONS['concentric'],
      concentric: (node: NodeSingular) => node.degree(), // Use node degree for concentricity
      levelWidth: () => 1
    }
  },
  {
    name: 'grid',
    label: 'Grid',
    description: 'Rows and columns, for scanning every event',
    category: 'grid',
    options: {
      ...DEFAULT_LAYOUT_OPTIONS['grid'],
      position: () => ({ row: undefined, col: undefined }), // Auto-position
      sort: undefined
    }
  },
  {
    name: 'random',
    label: 'Scatter',
    description: 'Random positions, to see the graph afresh',
    category: 'force',
    options: { ...DEFAULT_LAYOUT_OPTIONS['random'] }
  }
]

export function CausalGraphLayoutManager({
  cytoscapeInstance,
  className = '',
  onLayoutChange,
  showLayoutPreview = false
}: CausalGraphLayoutManagerProps) {
  const { sessionData, updateSessionData } = useGlobalStore()
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [previewLayout, setPreviewLayout] = useState<string | null>(null)

  // Refs for preventing race conditions and cleanup
  const isTransitioningRef = useRef(false)
  const previewTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const currentLayoutRef = useRef<Layouts | null>(null)
  const previewLayoutRef = useRef<Layouts | null>(null)

  const currentLayout = sessionData.viewportState.causalGraph.layout || 'cose'

  // Cleanup preview timeout on unmount
  useEffect(() => {
    return () => {
      if (previewTimeoutRef.current) {
        clearTimeout(previewTimeoutRef.current)
      }
      // Stop any running layout on unmount
      if (currentLayoutRef.current?.stop) {
        currentLayoutRef.current.stop()
      }
      // Stop any running preview layout on unmount
      if (previewLayoutRef.current?.stop) {
        previewLayoutRef.current.stop()
      }
    }
  }, [])

  // Apply layout with smooth transition
  const applyLayout = useCallback(async (layoutName: string, options?: LayoutOptions) => {
    // Use ref to prevent race conditions (state may be stale in callbacks)
    if (!cytoscapeInstance || isTransitioningRef.current) return

    // Set both ref and state to prevent race conditions
    isTransitioningRef.current = true
    setIsTransitioning(true)

    // Stop any currently running layout
    if (currentLayoutRef.current?.stop) {
      currentLayoutRef.current.stop()
    }

    try {
      const layoutConfig = layoutConfigs.find(config => config.name === layoutName)
      const layoutOptions = options || layoutConfig?.options || getDefaultLayoutOptions(layoutName)

      // Save current positions for potential rollback
      const currentPositions: Record<string, { x: number; y: number }> = {}
      cytoscapeInstance.nodes().forEach(node => {
        const pos = node.position()
        currentPositions[node.id()] = { x: pos.x, y: pos.y }
      })

      // Apply the layout
      const layout = cytoscapeInstance.layout(toCytoscapeLayoutOptions(layoutOptions))
      currentLayoutRef.current = layout

      // Run layout and wait for completion with timeout to prevent hanging
      await new Promise<void>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          layout.stop()
          reject(new Error('Layout timed out'))
        }, LAYOUT_TIMEOUT_MS)

        layout.on('layoutstop', () => {
          clearTimeout(timeoutId)
          resolve()
        })
        layout.run()
      })

      // Clear reference after layout completes
      currentLayoutRef.current = null

      // Save new positions
      const newPositions: Record<string, { x: number; y: number }> = {}
      cytoscapeInstance.nodes().forEach(node => {
        const pos = node.position()
        newPositions[node.id()] = { x: pos.x, y: pos.y }
      })

      // Update session data
      updateSessionData({
        viewportState: {
          ...sessionData.viewportState,
          causalGraph: {
            ...sessionData.viewportState.causalGraph,
            layout: layoutName,
            nodePositions: newPositions
          }
        }
      })

      // Notify parent component
      onLayoutChange?.(layoutName)

    } catch (error) {
      console.error('Failed to apply layout:', error)
      currentLayoutRef.current = null
    } finally {
      isTransitioningRef.current = false
      setIsTransitioning(false)
    }
  }, [cytoscapeInstance, sessionData, updateSessionData, onLayoutChange])

  // Preview layout (without applying)
  const previewLayoutChange = useCallback((layoutName: string) => {
    if (!showLayoutPreview || !cytoscapeInstance || isTransitioningRef.current) return

    // Clear any existing preview timeout
    if (previewTimeoutRef.current) {
      clearTimeout(previewTimeoutRef.current)
      previewTimeoutRef.current = null
    }

    // Stop any existing preview layout
    if (previewLayoutRef.current?.stop) {
      previewLayoutRef.current.stop()
      previewLayoutRef.current = null
    }

    setPreviewLayout(layoutName)

    // Create a temporary preview with reduced animation
    const previewOptions = getPreviewLayoutOptions(layoutName)
    const layout = cytoscapeInstance.layout(toCytoscapeLayoutOptions(previewOptions))
    previewLayoutRef.current = layout
    layout.run()

    // Clear preview after a delay - store ref for cleanup
    previewTimeoutRef.current = setTimeout(() => {
      setPreviewLayout(null)
      previewTimeoutRef.current = null
      previewLayoutRef.current = null
    }, PREVIEW_TIMEOUT_MS)
  }, [showLayoutPreview, cytoscapeInstance])

  // Cancel preview and restore original layout
  const cancelPreview = useCallback(() => {
    if (!previewLayout || !cytoscapeInstance) return

    // Clear the preview timeout
    if (previewTimeoutRef.current) {
      clearTimeout(previewTimeoutRef.current)
      previewTimeoutRef.current = null
    }

    setPreviewLayout(null)

    // Restore original layout
    applyLayout(currentLayout)
  }, [previewLayout, cytoscapeInstance, currentLayout, applyLayout])

  // "More layouts" starts open when the saved layout is one of them, so the
  // active choice is visible; after that it is the user's to open and close.
  const [showMore, setShowMore] = useState(() => !isPrimaryLayout(currentLayout))
  const headingId = useId()
  const moreId = useId()
  const activeConfig = layoutConfigs.find(config => config.name === currentLayout)

  // Handle keyboard shortcuts
  // Use ref for isTransitioning to avoid re-attaching listener on every state change
  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      // Use ref to get current transitioning state without causing re-attachment
      if (!cytoscapeInstance || isTransitioningRef.current) return

      // Not while typing, composing, or with a modal dialog open
      if (shouldIgnoreAppShortcut(event)) {
        return
      }

      // These are bare keys. With a modifier held the key means something
      // else: Ctrl+R is reload, Shift+R clear filters, Shift+F the filter
      // panel, Alt+1-3 switch views -- none of them should also re-layout,
      // fit or reset the graph.
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
        return
      }

      // Check for layout shortcuts (1-8)
      const layoutName = getLayoutFromShortcut(event.key)
      if (layoutName) {
        event.preventDefault()
        applyLayout(layoutName)
        return
      }

      // Check for action shortcuts (f, r)
      if (isActionShortcut(event.key)) {
        event.preventDefault()
        const action = getActionFromShortcut(event.key)
        if (action === 'fit') {
          cytoscapeInstance.fit(undefined, FIT_PADDING)
        } else if (action === 'reset') {
          cytoscapeInstance.zoom(DEFAULT_ZOOM)
          cytoscapeInstance.center()
        }
      }
    }

    document.addEventListener('keydown', handleKeyPress)
    return () => document.removeEventListener('keydown', handleKeyPress)
  }, [cytoscapeInstance, applyLayout])

  const renderOption = (layout: LayoutConfig) => {
    const isActive = currentLayout === layout.name
    const isPreviewing = previewLayout === layout.name
    const shortcut = getShortcutForLayout(layout.name)

    // The current layout reads as chosen -- a filled radio mark, bold label
    // and tint -- and is never `disabled`: a disabled-looking current choice
    // read as "unavailable". While a layout is being applied the other
    // choices are aria-disabled (the click is ignored), not removed from focus.
    const busy = isTransitioning && !isActive

    return (
      <button
        key={layout.name}
        type="button"
        aria-pressed={isActive}
        aria-disabled={busy || undefined}
        aria-keyshortcuts={shortcut ?? undefined}
        onClick={() => applyLayout(layout.name)}
        onMouseEnter={() => showLayoutPreview && previewLayoutChange(layout.name)}
        onMouseLeave={() => showLayoutPreview && cancelPreview()}
        className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-selected ${
          isActive
            ? 'bg-selected/10 font-semibold text-ink'
            : busy
              ? 'cursor-wait text-ink-secondary'
              : isPreviewing
                ? 'bg-subtle text-ink'
                : 'text-ink-secondary hover:bg-subtle hover:text-ink'
        }`}
        title={`${layout.description}${shortcut ? ` (${shortcut})` : ''}`}
      >
        <span
          className={`flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-full border-2 ${
            isActive ? 'border-selected' : 'border-ink-muted'
          }`}
          aria-hidden="true"
        >
          {isActive && <span className="h-1.5 w-1.5 rounded-full bg-selected" />}
        </span>
        <span className="flex-1">{layout.label}</span>
        {shortcut && (
          <kbd className="font-mono-code text-xs font-normal text-ink-secondary" aria-hidden="true">
            {shortcut}
          </kbd>
        )}
      </button>
    )
  }

  const primaryLayouts = PRIMARY_LAYOUT_NAMES
    .map(name => layoutConfigs.find(config => config.name === name))
    .filter((config): config is LayoutConfig => config !== undefined)
  const moreLayouts = layoutConfigs.filter(config => !isPrimaryLayout(config.name))

  return (
    <section className={`causal-graph-layout-manager ${className}`} aria-labelledby={headingId}>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 id={headingId} className="font-display text-xl font-semibold text-ink">Graph Layout</h3>
        {isTransitioning && (
          <span className="flex items-center gap-1.5 text-xs text-ink-secondary" role="status">
            <span className="h-3 w-3 animate-spin rounded-full border-b border-selected" aria-hidden="true" />
            Applying layout...
          </span>
        )}
      </div>

      {/* A radio-style list on the panel's own surface: no box around it */}
      <div
        role="group"
        aria-label="Layout"
        aria-busy={isTransitioning || undefined}
        className="-mx-2 flex flex-col gap-0.5"
      >
        {primaryLayouts.map(renderOption)}
      </div>

      <button
        type="button"
        aria-expanded={showMore}
        aria-controls={moreId}
        onClick={() => setShowMore(open => !open)}
        className="mt-2 flex items-center gap-1 rounded text-xs font-medium text-ink-secondary hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-selected"
      >
        <svg
          className={`h-3 w-3 transition-transform ${showMore ? 'rotate-90' : ''}`}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
        </svg>
        More layouts
      </button>
      {showMore && (
        <div
          id={moreId}
          role="group"
          aria-label="More layouts"
          aria-busy={isTransitioning || undefined}
          className="-mx-2 mt-1 flex flex-col gap-0.5"
        >
          {moreLayouts.map(renderOption)}
        </div>
      )}

      {/* What the current layout does (it may be one of the hidden ones) */}
      {activeConfig && (
        <p className="mt-3 text-xs text-ink-secondary">
          <span className="font-semibold text-ink">{activeConfig.label}:</span>{' '}
          {activeConfig.description}
        </p>
      )}

      {/* View actions */}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => cytoscapeInstance?.fit(undefined, FIT_PADDING)}
          aria-keyshortcuts="F"
          className="flex-1 rounded-md border border-line px-2 py-1 text-xs font-medium text-ink-secondary transition-colors hover:bg-subtle hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-selected"
          title="Fit the whole graph in view (F)"
        >
          Fit (F)
        </button>
        <button
          type="button"
          onClick={() => {
            cytoscapeInstance?.zoom(DEFAULT_ZOOM)
            cytoscapeInstance?.center()
          }}
          aria-keyshortcuts="R"
          className="flex-1 rounded-md border border-line px-2 py-1 text-xs font-medium text-ink-secondary transition-colors hover:bg-subtle hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-selected"
          title="Reset zoom to 100% (R)"
        >
          Reset (R)
        </button>
      </div>
    </section>
  )
}
