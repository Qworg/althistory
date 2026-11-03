import { useCallback, useEffect, useId, useState, useRef } from 'react'
import { GRAPH_STYLESHEET_REPLACED_EVENT } from './causalGraphStylesheet'
import { Core } from 'cytoscape'
import { Event, CausalRelationship } from '@/types'

export interface PerformanceMetrics {
  nodeCount: number
  edgeCount: number
  renderTime: number
  layoutTime: number
  memoryUsage: number
  fps: number
  isOptimized: boolean
}

export interface CausalGraphPerformanceManagerProps {
  cytoscapeInstance: Core | null
  events: Event[]
  causalRelationships: CausalRelationship[]
  onPerformanceUpdate?: (metrics: PerformanceMetrics) => void
  enableOptimizations?: boolean
  maxNodes?: number
  maxEdges?: number
  levelOfDetailThreshold?: number
  className?: string
}

export function CausalGraphPerformanceManager({
  cytoscapeInstance,
  events,
  causalRelationships,
  onPerformanceUpdate,
  enableOptimizations = true,
  maxNodes = 1000,
  maxEdges = 2000,
  levelOfDetailThreshold = 500,
  className = ''
}: CausalGraphPerformanceManagerProps) {
  const [metrics, setMetrics] = useState<PerformanceMetrics>({
    nodeCount: 0,
    edgeCount: 0,
    renderTime: 0,
    layoutTime: 0,
    memoryUsage: 0,
    fps: 0,
    isOptimized: false
  })
  
  const [isMonitoring, setIsMonitoring] = useState(false)
  // A diagnostic, not part of reading the graph: collapsed until asked for.
  const [isExpanded, setIsExpanded] = useState(false)
  const panelId = useId()
  const [optimizationLevel, setOptimizationLevel] = useState<'none' | 'basic' | 'aggressive'>('none')
  
  const performanceObserver = useRef<PerformanceObserver | null>(null)
  const fpsCounter = useRef<{ frames: number; lastTime: number }>({ frames: 0, lastTime: 0 })
  const renderTimeRef = useRef<number>(0)
  const layoutTimeRef = useRef<number>(0)

  // Refs to store latest callback versions (fixes stale closure issues)
  const autoOptimizeRef = useRef<() => void>(() => {})
  const handleZoomLevelOfDetailRef = useRef<() => void>(() => {})

  // Calculate current performance metrics
  const calculateMetrics = useCallback((): PerformanceMetrics => {
    const nodeCount = events.length
    const edgeCount = causalRelationships.length
    const isOptimized = optimizationLevel !== 'none'
    
    // Estimate memory usage (rough calculation)
    const estimatedMemoryUsage = (nodeCount * 0.5 + edgeCount * 0.3) * 1024 // KB
    
    return {
      nodeCount,
      edgeCount,
      renderTime: renderTimeRef.current,
      layoutTime: layoutTimeRef.current,
      memoryUsage: estimatedMemoryUsage,
      fps: fpsCounter.current.frames,
      isOptimized
    }
  }, [events.length, causalRelationships.length, optimizationLevel])

  // Start performance monitoring
  const startMonitoring = useCallback(() => {
    if (!cytoscapeInstance || isMonitoring) return

    setIsMonitoring(true)

    // Monitor render performance
    if ('PerformanceObserver' in window) {
      performanceObserver.current = new PerformanceObserver((list) => {
        const entries = list.getEntries()
        entries.forEach((entry) => {
          if (entry.name.includes('cytoscape')) {
            renderTimeRef.current = entry.duration
          }
        })
      })
      
      try {
        performanceObserver.current.observe({ entryTypes: ['measure'] })
      } catch (error) {
        console.warn('Performance monitoring not supported:', error)
      }
    }

    // FPS monitoring. The sample window starts now: measured from 0, the
    // first frame of a page that has been open a while read as ~1 FPS.
    fpsCounter.current = { frames: 0, lastTime: performance.now() }
    const measureFPS = () => {
      const now = performance.now()
      fpsCounter.current.frames++
      
      if (now - fpsCounter.current.lastTime >= 1000) {
        const fps = Math.round((fpsCounter.current.frames * 1000) / (now - fpsCounter.current.lastTime))
        fpsCounter.current = { frames: 0, lastTime: now }
        
        // Update metrics
        const newMetrics = calculateMetrics()
        newMetrics.fps = fps
        setMetrics(newMetrics)
        onPerformanceUpdate?.(newMetrics)
      }
      
      if (isMonitoring) {
        requestAnimationFrame(measureFPS)
      }
    }
    
    requestAnimationFrame(measureFPS)

    // Monitor layout performance
    cytoscapeInstance.on('layoutstart', () => {
      performance.mark('layout-start')
    })
    
    cytoscapeInstance.on('layoutstop', () => {
      performance.mark('layout-end')
      performance.measure('layout-duration', 'layout-start', 'layout-end')
      
      const layoutMeasure = performance.getEntriesByName('layout-duration')[0]
      if (layoutMeasure) {
        layoutTimeRef.current = layoutMeasure.duration
      }
    })

  }, [cytoscapeInstance, isMonitoring, calculateMetrics, onPerformanceUpdate])

  // Stop performance monitoring
  const stopMonitoring = useCallback(() => {
    setIsMonitoring(false)
    
    if (performanceObserver.current) {
      performanceObserver.current.disconnect()
      performanceObserver.current = null
    }
  }, [])

  // The graph's own stylesheet, captured before this manager first reduces
  // detail. Reduced-detail rules are layered on top of it, and full detail
  // restores it exactly. Appending blanket "full detail" rules instead (as
  // this used to, on every zoom) overrode everything the graph styles per
  // node -- selected and highlighted borders, node sizes, and the label
  // culling that keeps labels from overprinting -- because in Cytoscape the
  // later rule wins regardless of selector.
  const baseStyleRef = useRef<unknown>(null)

  /** Start a reduced-detail style from the graph's own stylesheet. */
  const reducedStyle = useCallback(() => {
    if (!cytoscapeInstance) return null
    // Style#json exists at runtime but is missing from @types/cytoscape
    if (!baseStyleRef.current) baseStyleRef.current = (cytoscapeInstance.style() as unknown as { json(): unknown }).json()
    return cytoscapeInstance.style().fromJson(baseStyleRef.current)
  }, [cytoscapeInstance])

  /** Back to the graph's own stylesheet, if detail was reduced. */
  const restoreFullDetail = useCallback(() => {
    if (!cytoscapeInstance || !baseStyleRef.current) return
    cytoscapeInstance.style().fromJson(baseStyleRef.current).update()
    baseStyleRef.current = null
  }, [cytoscapeInstance])

  // Apply performance optimizations
  const applyOptimizations = useCallback((level: 'none' | 'basic' | 'aggressive') => {
    if (!cytoscapeInstance) return

    setOptimizationLevel(level)

    switch (level) {
      case 'none':
        restoreFullDetail()
        break

      case 'basic':
        // Basic optimizations
        reducedStyle()
          ?.selector('node')
          .style({
            'text-opacity': events.length > levelOfDetailThreshold ? 0 : 1,
            'border-width': events.length > levelOfDetailThreshold ? 1 : 2,
            'overlay-padding': '3px'
          })
          .selector('edge')
          .style({
            'opacity': causalRelationships.length > levelOfDetailThreshold ? 0.6 : 0.8,
            'curve-style': causalRelationships.length > levelOfDetailThreshold ? 'straight' : 'bezier',
            'text-opacity': causalRelationships.length > levelOfDetailThreshold ? 0 : 1
          })
          .update()
        break

      case 'aggressive':
        // Aggressive optimizations
        reducedStyle()
          ?.selector('node')
          .style({
            'text-opacity': 0,
            'border-width': 1,
            'overlay-padding': '2px',
            'width': 'mapData(weight, 0, 1, 20, 40)', // Smaller nodes
            'height': 'mapData(weight, 0, 1, 20, 40)'
          })
          .selector('edge')
          .style({
            'opacity': 0.4,
            'curve-style': 'straight',
            'text-opacity': 0,
            'width': 'mapData(weight, 0, 1, 1, 4)' // Thinner edges
          })
          .update()
        break
    }
  }, [cytoscapeInstance, events.length, causalRelationships.length, levelOfDetailThreshold, reducedStyle, restoreFullDetail])

  // Auto-optimize based on data size
  const autoOptimize = useCallback(() => {
    if (!enableOptimizations) return

    const nodeCount = events.length
    const edgeCount = causalRelationships.length

    if (nodeCount > maxNodes || edgeCount > maxEdges) {
      applyOptimizations('aggressive')
    } else if (nodeCount > levelOfDetailThreshold || edgeCount > levelOfDetailThreshold) {
      applyOptimizations('basic')
    } else {
      applyOptimizations('none')
    }
  }, [
    enableOptimizations,
    events.length,
    causalRelationships.length,
    maxNodes,
    maxEdges,
    levelOfDetailThreshold,
    applyOptimizations
  ])

  // Level of detail based on zoom
  const handleZoomLevelOfDetail = useCallback(() => {
    if (!cytoscapeInstance || !enableOptimizations) return

    const zoom = cytoscapeInstance.zoom()
    const nodeCount = events.length

    // Adjust detail level based on zoom
    if (zoom < 0.5 && nodeCount > levelOfDetailThreshold) {
      // Very zoomed out - minimal detail
      reducedStyle()
        ?.selector('node')
        .style({
          'text-opacity': 0,
          'border-width': 0,
          'width': 6,
          'height': 6
        })
        .selector('edge')
        .style({
          'opacity': 0.3,
          'width': 1,
          'text-opacity': 0
        })
        .update()
    } else if (zoom < 1.0 && nodeCount > levelOfDetailThreshold / 2) {
      // Medium zoom - basic detail
      reducedStyle()
        ?.selector('node')
        .style({
          'text-opacity': 0,
          'border-width': 1,
          'width': 'mapData(weight, 0, 1, 15, 30)',
          'height': 'mapData(weight, 0, 1, 15, 30)'
        })
        .selector('edge')
        .style({
          'opacity': 0.6,
          'width': 'mapData(weight, 0, 1, 1, 3)',
          'text-opacity': 0
        })
        .update()
    } else {
      // Zoomed in (or a graph small enough to need no reduction): the graph's
      // own stylesheet, untouched
      restoreFullDetail()
    }
  }, [cytoscapeInstance, enableOptimizations, events.length, levelOfDetailThreshold, reducedStyle, restoreFullDetail])

  /**
   * Release what this manager allocated, and nothing else.
   *
   * This used to remove every isolated node from the graph. That is the live
   * graph, not a layout: the manager is an overlay on someone else's
   * Cytoscape instance, and an event that happens to have no causal link yet
   * is exactly a node with no edges. Removing it deleted the user's data on
   * unmount -- and on the Cleanup button, which is not a data action.
   */
  const cleanupMemory = useCallback(() => {
    // Clear the performance marks this manager records.
    if ('performance' in window && performance.clearMarks) {
      performance.clearMarks()
      performance.clearMeasures()
    }
  }, [])

  // Keep refs in sync with latest callbacks
  useEffect(() => {
    autoOptimizeRef.current = autoOptimize
  }, [autoOptimize])

  useEffect(() => {
    handleZoomLevelOfDetailRef.current = handleZoomLevelOfDetail
  }, [handleZoomLevelOfDetail])

  // Initialize monitoring when cytoscape instance is available
  useEffect(() => {
    if (cytoscapeInstance && enableOptimizations) {
      startMonitoring()
      autoOptimizeRef.current()

      // Wrapper that calls current ref value
      const zoomHandler = () => handleZoomLevelOfDetailRef.current()
      cytoscapeInstance.on('zoom', zoomHandler)

      // A theme change replaced the graph's stylesheet. A snapshot taken
      // before it holds the old theme's colours: drop it, and reduce detail
      // again (if it was reduced) on top of the new sheet.
      const stylesheetReplacedHandler = () => {
        if (!baseStyleRef.current) return
        baseStyleRef.current = null
        autoOptimizeRef.current()
        handleZoomLevelOfDetailRef.current()
      }
      cytoscapeInstance.on(GRAPH_STYLESHEET_REPLACED_EVENT, stylesheetReplacedHandler)

      return () => {
        stopMonitoring()
        cytoscapeInstance.off('zoom', zoomHandler)
        cytoscapeInstance.off(GRAPH_STYLESHEET_REPLACED_EVENT, stylesheetReplacedHandler)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cytoscapeInstance, enableOptimizations]) // Removed callback deps - using refs instead

  // Auto-optimize when data size changes (not when callback recreates)
  useEffect(() => {
    autoOptimizeRef.current()
  }, [events.length, causalRelationships.length, enableOptimizations])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopMonitoring()
      cleanupMemory()
    }
  }, [stopMonitoring, cleanupMemory])

  // Performance status indicator. Until a frame rate has been measured there
  // is no status to report (0 FPS used to read as "poor").
  const performanceStatus: { label: string; dot: string } | null =
    metrics.fps <= 0 ? null
      : metrics.fps < 30 ? { label: 'Poor', dot: 'bg-red-600' }
        : metrics.fps < 50 ? { label: 'Fair', dot: 'bg-divergence' }
          : { label: 'Good', dot: 'bg-green-600' }

  const metricRows: Array<[string, string]> = [
    ['Nodes', metrics.nodeCount.toLocaleString()],
    ['Edges', metrics.edgeCount.toLocaleString()],
    ['FPS', metrics.fps > 0 ? String(metrics.fps) : '\u2014'],
    ['Render', `${metrics.renderTime.toFixed(1)} ms`],
    ['Layout', `${metrics.layoutTime.toFixed(1)} ms`],
    ['Memory', `${(metrics.memoryUsage / 1024).toFixed(1)} MB`]
  ]

  const quietButton =
    'flex-1 rounded-md border border-line px-2 py-1 text-xs font-medium text-ink-secondary transition-colors hover:bg-subtle hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-selected'

  return (
    <section className={`causal-graph-performance-manager ${className}`}>
      <h3 className="font-display text-xl font-semibold text-ink">
        <button
          type="button"
          aria-expanded={isExpanded}
          aria-controls={panelId}
          onClick={() => setIsExpanded(open => !open)}
          className="flex w-full items-center gap-2 rounded text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-selected"
        >
          <svg
            className={`h-3 w-3 flex-shrink-0 text-ink-secondary transition-transform ${isExpanded ? 'rotate-90' : ''}`}
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
          </svg>
          <span className="flex-1">Performance</span>
          {performanceStatus && (
            <span className="flex items-center gap-1 font-sans text-xs font-normal text-ink-secondary">
              <span className={`h-2 w-2 rounded-full ${performanceStatus.dot}`} aria-hidden="true" />
              {performanceStatus.label}
            </span>
          )}
        </button>
      </h3>

      {/* Large-data warnings matter even with the details collapsed. */}
      {(metrics.nodeCount > maxNodes || metrics.edgeCount > maxEdges) && (
        <p className="mt-2 text-xs text-ink-secondary" role="status">
          <span className="font-semibold text-ink">Large graph.</span>{' '}
          Turn on optimization or filter the events to keep it responsive.
        </p>
      )}

      {isExpanded && (
        <div id={panelId} className="mt-3 space-y-3">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            {metricRows.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-2">
                <dt className="text-ink-secondary">{label}</dt>
                <dd className="font-mono-code text-ink">{value}</dd>
              </div>
            ))}
          </dl>

          {metrics.fps < 30 && metrics.fps > 0 && (
            <p className="text-xs text-ink-secondary">
              <span className="font-semibold text-ink">Below 30 FPS.</span>{' '}
              Try aggressive optimization or filter the events.
            </p>
          )}

          {/* Optimization level */}
          <div role="group" aria-labelledby={`${panelId}-optimization`}>
            <p id={`${panelId}-optimization`} className="mb-1 text-xs font-medium text-ink-secondary">
              Optimization
            </p>
            <div className="flex divide-x divide-line overflow-hidden rounded-md border border-line">
              {(['none', 'basic', 'aggressive'] as const).map((level) => (
                <button
                  key={level}
                  type="button"
                  aria-pressed={optimizationLevel === level}
                  onClick={() => applyOptimizations(level)}
                  className={`flex-1 px-2 py-1 text-xs capitalize transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-selected ${
                    optimizationLevel === level
                      ? 'bg-selected/10 font-semibold text-ink'
                      : 'text-ink-secondary hover:bg-subtle hover:text-ink'
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={cleanupMemory}
              className={quietButton}
              title="Clear the timing marks this panel recorded"
            >
              Cleanup
            </button>
            <button
              type="button"
              onClick={() => setIsMonitoring(!isMonitoring)}
              className={quietButton}
              title={isMonitoring ? 'Stop monitoring' : 'Start monitoring'}
            >
              {isMonitoring ? 'Stop monitoring' : 'Start monitoring'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}