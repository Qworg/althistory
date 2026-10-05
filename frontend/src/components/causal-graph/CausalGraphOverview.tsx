import { useRef, useEffect, useState, useCallback } from 'react'
import cytoscape, { Core, BoundingBox } from 'cytoscape'
import { Event, CausalRelationship } from '@/types'

export interface CausalGraphOverviewProps {
  mainCytoscapeInstance: Core | null
  events: Event[]
  causalRelationships: CausalRelationship[]
  className?: string
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
  width = 200,
  height = 150,
  onViewportChange,
  showMinimap = true,
  enableNavigation = true
}: CausalGraphOverviewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const overviewCyRef = useRef<Core | null>(null)
  const [isInitialized, setIsInitialized] = useState(false)
  const [mainViewport, setMainViewport] = useState<BoundingBox | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  // Refs to store latest callback versions (fixes stale closure in event listeners)
  const updateViewportIndicatorRef = useRef<() => void>(() => {})
  const drawViewportOverlayRef = useRef<() => void>(() => {})

  // Initialize overview Cytoscape instance
  const initializeOverview = useCallback(() => {
    if (!containerRef.current || overviewCyRef.current || !mainCytoscapeInstance) return

    const overviewCy = cytoscape({
      container: containerRef.current,
      
      style: [
        // Simplified node styles for overview
        {
          selector: 'node',
          style: {
            'background-color': '#3B82F6',
            'border-color': '#1E40AF',
            'border-width': 1,
            'width': 8,
            'height': 8,
            'font-size': '6px',
            'color': '#FFFFFF',
            'text-valign': 'center',
            'text-halign': 'center',
            'overlay-padding': '2px',
            'z-index': 10
          }
        },
        
        // Highlighted nodes in viewport
        {
          selector: 'node.in-viewport',
          style: {
            'background-color': '#EF4444',
            'border-color': '#DC2626',
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
            'line-color': '#9CA3AF',
            'target-arrow-color': '#9CA3AF',
            'target-arrow-shape': 'triangle',
            'curve-style': 'straight',
            'arrow-scale': 0.8,
            'opacity': 0.6,
            'z-index': 5
          }
        },
        
        // Strong relationships
        {
          selector: 'edge[weight >= 0.7]',
          style: {
            'line-color': '#DC2626',
            'target-arrow-color': '#DC2626',
            'width': 2,
            'opacity': 0.8
          }
        }
      ],
      
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

  }, [overviewCyRef, mainCytoscapeInstance, isInitialized, events, causalRelationships])

  // Update viewport indicator
  const updateViewportIndicator = useCallback(() => {
    if (!overviewCyRef.current || !mainCytoscapeInstance || !isInitialized) return

    // Get main graph viewport
    const newViewport = mainCytoscapeInstance.extent()

    // Only update state if viewport actually changed (avoid unnecessary re-renders)
    setMainViewport(prev => {
      if (!prev ||
          prev.x1 !== newViewport.x1 || prev.x2 !== newViewport.x2 ||
          prev.y1 !== newViewport.y1 || prev.y2 !== newViewport.y2) {
        return newViewport
      }
      return prev
    })

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

  // Draw viewport rectangle overlay
  const drawViewportOverlay = useCallback(() => {
    if (!overviewCyRef.current || !mainViewport || !containerRef.current) return

    // Remove existing overlay
    const existingOverlay = containerRef.current.querySelector('.viewport-overlay')
    if (existingOverlay) {
      existingOverlay.remove()
    }

    // Calculate overlay position and size
    const overviewExtent = overviewCyRef.current.extent()
    const containerRect = containerRef.current.getBoundingClientRect()
    
    const scaleX = containerRect.width / (overviewExtent.x2 - overviewExtent.x1)
    const scaleY = containerRect.height / (overviewExtent.y2 - overviewExtent.y1)
    
    const overlayX = (mainViewport.x1 - overviewExtent.x1) * scaleX
    const overlayY = (mainViewport.y1 - overviewExtent.y1) * scaleY
    const overlayWidth = (mainViewport.x2 - mainViewport.x1) * scaleX
    const overlayHeight = (mainViewport.y2 - mainViewport.y1) * scaleY
    
    // Create overlay element
    const overlay = document.createElement('div')
    overlay.className = 'viewport-overlay'
    overlay.style.cssText = `
      position: absolute;
      left: ${overlayX}px;
      top: ${overlayY}px;
      width: ${overlayWidth}px;
      height: ${overlayHeight}px;
      border: 2px solid #EF4444;
      background-color: rgba(239, 68, 68, 0.1);
      pointer-events: none;
      z-index: 1000;
    `
    
    containerRef.current.appendChild(overlay)

  }, [mainViewport])

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

    // Listen to various events that change viewport
    mainCytoscapeInstance.on('pan zoom resize', handleViewportChange)
    mainCytoscapeInstance.on('layoutstop', handleViewportChange)

    // Initial update
    handleViewportChange()

    return () => {
      mainCytoscapeInstance.off('pan zoom resize', handleViewportChange)
      mainCytoscapeInstance.off('layoutstop', handleViewportChange)
    }
  }, [mainCytoscapeInstance, isInitialized, showMinimap]) // Removed callback deps - using refs instead

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
    <div className={`causal-graph-overview ${className}`}>
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-3">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-semibold text-gray-700">Graph Overview</h4>
          <div className="flex items-center space-x-1 text-xs text-gray-500">
            <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
            <span>Nodes</span>
            <div className="w-2 h-2 bg-red-500 rounded-full ml-2"></div>
            <span>Viewport</span>
          </div>
        </div>
        
        <div
          ref={containerRef}
          className="relative bg-gray-50 rounded border border-gray-200"
          style={{
            width: `${width}px`,
            height: `${height}px`,
            overflow: 'hidden',
            cursor: enableNavigation ? (isDragging ? 'grabbing' : 'grab') : 'default'
          }}
        />
        
        {/* Statistics */}
        <div className="mt-2 flex justify-between text-xs text-gray-500">
          <span>{events.length} nodes</span>
          <span>{causalRelationships.length} edges</span>
        </div>
        
        {/* Navigation hint */}
        {enableNavigation && (
          <div className="mt-1 text-xs text-gray-400 text-center">
            Click to navigate
          </div>
        )}
      </div>
    </div>
  )
}
