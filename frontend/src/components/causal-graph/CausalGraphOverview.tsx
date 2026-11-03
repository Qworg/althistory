import { useRef, useEffect, useState, useCallback, useId } from 'react'
import cytoscape, { Core, BoundingBox, type StylesheetStyle } from 'cytoscape'
import { Event, CausalRelationship } from '@/types'
import { readGraphCanvasTheme, type GraphCanvasTheme } from './causalGraphPresentation'

/** The minimap's stylesheet: the main graph's palette, simplified. */
function buildOverviewStylesheet(theme: GraphCanvasTheme): StylesheetStyle[] {
  const c = theme.colors
  return [
    // Simplified node styles for overview
    {
      selector: 'node',
      style: {
        'background-color': c.nodeFill,
        'border-color': c.nodeBorder,
        'border-width': 1,
        'width': 8,
        'height': 8,
        'overlay-padding': '2px',
        'z-index': 10
      }
    },
    // Nodes inside the main view
    {
      selector: 'node.in-viewport',
      style: {
        'background-color': c.selectedFill,
        'border-color': c.selectedBorder,
        'border-width': 2,
        'width': 10,
        'height': 10
      }
    },
    // Simplified edge styles
    {
      selector: 'edge',
      style: {
        'width': 1,
        'line-color': c.edgeContributory,
        'target-arrow-color': c.edgeContributory,
        'target-arrow-shape': 'triangle',
        'curve-style': 'straight',
        'arrow-scale': 0.8,
        'z-index': 5
      }
    },
    // Strong relationships
    {
      selector: 'edge[weight >= 0.7]',
      style: {
        'line-color': c.edgeDirect,
        'target-arrow-color': c.edgeDirect,
        'width': 2
      }
    }
  ]
}

export interface CausalGraphOverviewProps {
  mainCytoscapeInstance: Core | null
  events: Event[]
  causalRelationships: CausalRelationship[]
  className?: string
  /** Map width in px; by default it fills the column it sits in. */
  width?: number
  height?: number
  onViewportChange?: (viewport: BoundingBox) => void
  showMinimap?: boolean
  enableNavigation?: boolean
}

export function CausalGraphOverview({
  mainCytoscapeInstance,
  events,
  causalRelationships,
  className = '',
  width,
  height = 150,
  onViewportChange,
  showMinimap = true,
  enableNavigation = true
}: CausalGraphOverviewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const overviewCyRef = useRef<Core | null>(null)
  const [isInitialized, setIsInitialized] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const headingId = useId()
  const [palette, setPalette] = useState(() => readGraphCanvasTheme().colors)

  // Refs to store latest callback versions (fixes stale closure in event listeners)
  const updateViewportIndicatorRef = useRef<() => void>(() => {})
  const drawViewportOverlayRef = useRef<() => void>(() => {})

  // Initialize overview Cytoscape instance
  const initializeOverview = useCallback(() => {
    if (!containerRef.current || overviewCyRef.current || !mainCytoscapeInstance) return

    const overviewCy = cytoscape({
      container: containerRef.current,
      
      style: buildOverviewStylesheet(readGraphCanvasTheme()),

      layout: {
        name: 'preset', // Use preset positions from main graph
        fit: true,
        padding: 10
      },
      
      // Disable most interactions for overview
      userZoomingEnabled: false,
      userPanningEnabled: enableNavigation,
      boxSelectionEnabled: false,
      selectionType: 'single',
      autoungrabify: !enableNavigation,
      autounselectify: true,
      
      minZoom: 0.1,
      maxZoom: 1,
      wheelSensitivity: 0.1
    })

    overviewCyRef.current = overviewCy
    setIsInitialized(true)

    // Handle navigation clicks
    if (enableNavigation) {
      overviewCy.on('tap', (event) => {
        if (event.target === overviewCy && mainCytoscapeInstance) {
          const position = event.position
          
          // Convert overview position to main graph position
          const overviewExtent = overviewCy.extent()
          const mainExtent = mainCytoscapeInstance.extent()
          
          const scaleX = (mainExtent.x2 - mainExtent.x1) / (overviewExtent.x2 - overviewExtent.x1)
          const scaleY = (mainExtent.y2 - mainExtent.y1) / (overviewExtent.y2 - overviewExtent.y1)
          
          const mainX = mainExtent.x1 + (position.x - overviewExtent.x1) * scaleX
          const mainY = mainExtent.y1 + (position.y - overviewExtent.y1) * scaleY
          
          // Pan main graph to clicked position
          mainCytoscapeInstance.animate({
            pan: { x: mainX, y: mainY }
          }, {
            duration: 300
          })
        }
      })

      // Handle viewport dragging
      overviewCy.on('grab', () => {
        setIsDragging(true)
      })

      overviewCy.on('free', () => {
        setIsDragging(false)
      })
    }

  }, [mainCytoscapeInstance, enableNavigation])

  // Update overview data when main graph changes
  const updateOverviewData = useCallback(() => {
    if (!overviewCyRef.current || !mainCytoscapeInstance || !isInitialized) return

    // Clear existing elements
    overviewCyRef.current.elements().remove()

    // Get positions from main graph
    const nodePositions: Record<string, { x: number; y: number }> = {}
    mainCytoscapeInstance.nodes().forEach(node => {
      const pos = node.position()
      nodePositions[node.id()] = { x: pos.x, y: pos.y }
    })

    // Add nodes with positions from main graph
    const overviewNodes = events.map(event => ({
      data: {
        id: event.id,
        label: `${event.actor.substring(0, 3)}→${event.target.substring(0, 3)}`
      },
      position: nodePositions[event.id] || { x: 0, y: 0 }
    }))

    // Add edges (simplified)
    const overviewEdges = causalRelationships.map(relationship => ({
      data: {
        id: relationship.id,
        source: relationship.cause_event_id,
        target: relationship.effect_event_id,
        weight: relationship.weight
      }
    }))

    overviewCyRef.current.add([...overviewNodes, ...overviewEdges])

    // Fit to container
    overviewCyRef.current.fit(undefined, 10)
    // The map's extent changed, so the "in view" rectangle must follow
    drawViewportOverlayRef.current()

  }, [overviewCyRef, mainCytoscapeInstance, isInitialized, events, causalRelationships])

  // Update viewport indicator
  const updateViewportIndicator = useCallback(() => {
    if (!overviewCyRef.current || !mainCytoscapeInstance || !isInitialized) return

    // Get main graph viewport
    const newViewport = mainCytoscapeInstance.extent()

    // Highlight nodes in current viewport
    overviewCyRef.current.nodes().removeClass('in-viewport')

    mainCytoscapeInstance.nodes().forEach(mainNode => {
      const pos = mainNode.position()
      const isInViewport = pos.x >= newViewport.x1 && pos.x <= newViewport.x2 &&
                          pos.y >= newViewport.y1 && pos.y <= newViewport.y2

      if (isInViewport) {
        const overviewNode = overviewCyRef.current?.getElementById(mainNode.id())
        overviewNode?.addClass('in-viewport')
      }
    })

    // Notify parent of viewport change
    onViewportChange?.(newViewport)

  }, [mainCytoscapeInstance, isInitialized, onViewportChange])

  // The "in view" rectangle: the main graph's visible extent mapped onto the
  // overview. It is computed from both graphs' CURRENT extents every time --
  // reading the saved mainViewport state here drew the previous viewport,
  // because that state is set in the same tick -- clamped to the map, and
  // rendered by React (ADR-001) rather than appended to the container.
  const [overlayRect, setOverlayRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const drawViewportOverlay = useCallback(() => {
    const overview = overviewCyRef.current
    const container = containerRef.current
    if (!overview || !mainCytoscapeInstance || !container) return
    const main = mainCytoscapeInstance.extent()
    const ov = overview.extent()
    const w = container.clientWidth
    const h = container.clientHeight
    const spanX = ov.x2 - ov.x1
    const spanY = ov.y2 - ov.y1
    if (!(w > 0 && h > 0 && spanX > 0 && spanY > 0)) return
    const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v))
    const left = clamp(((main.x1 - ov.x1) / spanX) * w, w)
    const top = clamp(((main.y1 - ov.y1) / spanY) * h, h)
    const right = clamp(((main.x2 - ov.x1) / spanX) * w, w)
    const bottom = clamp(((main.y2 - ov.y1) / spanY) * h, h)
    const next = { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
    setOverlayRect(prev =>
      prev &&
      Math.abs(prev.left - next.left) < 0.5 && Math.abs(prev.top - next.top) < 0.5 &&
      Math.abs(prev.width - next.width) < 0.5 && Math.abs(prev.height - next.height) < 0.5
        ? prev
        : next
    )
  }, [mainCytoscapeInstance])

  // Initialize overview when main graph is ready
  useEffect(() => {
    if (mainCytoscapeInstance && !overviewCyRef.current) {
      initializeOverview()
    }
  }, [mainCytoscapeInstance, initializeOverview])

  // Update overview when data changes
  useEffect(() => {
    if (isInitialized) {
      updateOverviewData()
    }
  }, [isInitialized, updateOverviewData])

  // Keep refs in sync with latest callbacks
  useEffect(() => {
    updateViewportIndicatorRef.current = updateViewportIndicator
  }, [updateViewportIndicator])

  useEffect(() => {
    drawViewportOverlayRef.current = drawViewportOverlay
  }, [drawViewportOverlay])

  // Listen to main graph viewport changes
  useEffect(() => {
    if (!mainCytoscapeInstance || !isInitialized) return

    const handleViewportChange = () => {
      updateViewportIndicatorRef.current()
      if (showMinimap) {
        drawViewportOverlayRef.current()
      }
    }

    // The overview's nodes are added with the main graph's positions at the
    // time the data arrives -- before the main layout has run, when every node
    // still sits at the origin -- so the map showed a single dot. Copy the
    // positions again whenever the main layout settles or a node is dragged.
    const syncPositions = () => {
      const overview = overviewCyRef.current
      if (!overview) return
      overview.batch(() => {
        mainCytoscapeInstance.nodes().forEach(mainNode => {
          const overviewNode = overview.getElementById(mainNode.id())
          if (overviewNode.length > 0) overviewNode.position({ ...mainNode.position() })
        })
      })
      overview.fit(undefined, 10)
    }
    const handleLayoutChange = () => {
      // The overview was just refitted, so its extent changed as well
      syncPositions()
      handleViewportChange()
    }

    // Listen to various events that change viewport
    mainCytoscapeInstance.on('pan zoom resize', handleViewportChange)
    mainCytoscapeInstance.on('layoutstop', handleLayoutChange)
    mainCytoscapeInstance.on('dragfree', 'node', handleLayoutChange)

    // Initial update
    handleViewportChange()

    return () => {
      mainCytoscapeInstance.off('pan zoom resize', handleViewportChange)
      mainCytoscapeInstance.off('layoutstop', handleLayoutChange)
      mainCytoscapeInstance.off('dragfree', 'node', handleLayoutChange)
    }
  }, [mainCytoscapeInstance, isInitialized, showMinimap]) // Removed callback deps - using refs instead

  // Follow the theme (.dark / .high-contrast on <html>), like the main graph
  useEffect(() => {
    if (!isInitialized || typeof MutationObserver === 'undefined') return
    const observer = new MutationObserver(() => {
      const theme = readGraphCanvasTheme()
      overviewCyRef.current?.style(buildOverviewStylesheet(theme))
      setPalette(theme.colors)
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [isInitialized])

  // Cleanup
  useEffect(() => {
    return () => {
      if (overviewCyRef.current) {
        overviewCyRef.current.destroy()
        overviewCyRef.current = null
        setIsInitialized(false)
      }
    }
  }, [])

  if (!showMinimap) {
    return null
  }

  return (
    <section className={`causal-graph-overview ${className}`} aria-labelledby={headingId}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <h3 id={headingId} className="font-display text-xl font-semibold text-ink">Graph Overview</h3>
        <div className="flex items-center gap-1 text-xs text-ink-secondary">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: palette.nodeFill }} aria-hidden="true" />
          <span>Events</span>
          <span className="ml-2 h-2 w-2 rounded-sm border-2" style={{ borderColor: palette.selectedFill }} aria-hidden="true" />
          <span>In view</span>
        </div>
      </div>

      <div
        className="relative overflow-hidden rounded border border-line bg-canvas"
        style={{
          width: width !== undefined ? `${width}px` : '100%',
          height: `${height}px`,
        }}
      >
        {/* Cytoscape owns this node's children; the overlay is its sibling.
            Sized explicitly: Cytoscape's injected stylesheet forces its
            container to position: relative, which cancels absolute/inset
            sizing and left the map 0px tall. */}
        <div
          ref={containerRef}
          className="h-full w-full"
          style={{ cursor: enableNavigation ? (isDragging ? 'grabbing' : 'grab') : 'default' }}
        />
        {overlayRect && (
          <div
            className="viewport-overlay pointer-events-none absolute border-2 border-selected bg-selected/10"
            data-testid="overview-viewport"
            style={{ left: overlayRect.left, top: overlayRect.top, width: overlayRect.width, height: overlayRect.height }}
          />
        )}
      </div>

      {/* Navigation hint */}
      {enableNavigation && (
        <p className="mt-2 text-xs text-ink-secondary">
          Click the map to move the main view there.
        </p>
      )}
    </section>
  )
}
