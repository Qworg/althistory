import { useCallback, useEffect, useState, useRef } from 'react'
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

    // FPS monitoring
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

  // Apply performance optimizations
  const applyOptimizations = useCallback((level: 'none' | 'basic' | 'aggressive') => {
    if (!cytoscapeInstance) return

    setOptimizationLevel(level)

    switch (level) {
      case 'none':
        // Reset to default settings
        cytoscapeInstance.style()
          .selector('node')
          .style({
            'text-opacity': 1,
            'border-width': 2,
            'overlay-padding': '6px'
          })
          .selector('edge')
          .style({
            'opacity': 0.8,
            'curve-style': 'bezier',
            'text-opacity': 1
          })
          .update()
        break

      case 'basic':
        // Basic optimizations
        cytoscapeInstance.style()
          .selector('node')
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
        cytoscapeInstance.style()
          .selector('node')
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
  }, [cytoscapeInstance, events.length, causalRelationships.length, levelOfDetailThreshold])

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
      cytoscapeInstance.style()
        .selector('node')
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
      cytoscapeInstance.style()
        .selector('node')
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
      // Zoomed in - full detail
      cytoscapeInstance.style()
        .selector('node')
        .style({
          'text-opacity': 1,
          'border-width': 2,
          'width': 'mapData(weight, 0, 1, 30, 60)',
          'height': 'mapData(weight, 0, 1, 30, 60)'
        })
        .selector('edge')
        .style({
          'opacity': 0.8,
          'width': 'mapData(weight, 0, 1, 2, 8)',
          'text-opacity': zoom > 1.5 ? 1 : 0
        })
        .update()
    }
  }, [cytoscapeInstance, enableOptimizations, events.length, levelOfDetailThreshold])

  // Memory cleanup
  const cleanupMemory = useCallback(() => {
    if (!cytoscapeInstance) return

    // Force garbage collection of unused elements
    cytoscapeInstance.elements().forEach(element => {
      // Remove elements that are disconnected
      if (element.isNode() && element.degree() === 0) {
        element.remove()
      }
    })

    // Clear performance marks
    if ('performance' in window && performance.clearMarks) {
      performance.clearMarks()
      performance.clearMeasures()
    }
  }, [cytoscapeInstance])

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

      return () => {
        stopMonitoring()
        cytoscapeInstance.off('zoom', zoomHandler)
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

  // Performance status indicator
  const getPerformanceStatus = () => {
    if (metrics.fps < 30) return { status: 'poor', color: 'red' }
    if (metrics.fps < 50) return { status: 'fair', color: 'yellow' }
    return { status: 'good', color: 'green' }
  }

  const performanceStatus = getPerformanceStatus()

  return (
    <div className={`causal-graph-performance-manager ${className}`}>
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-3">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-semibold text-gray-700">Performance</h4>
          <div className={`flex items-center space-x-1 text-xs text-${performanceStatus.color}-600`}>
            <div className={`w-2 h-2 bg-${performanceStatus.color}-500 rounded-full`}></div>
            <span className="capitalize">{performanceStatus.status}</span>
          </div>
        </div>

        {/* Metrics */}
        <div className="space-y-2 text-xs">
          <div className="flex justify-between">
            <span className="text-gray-600">Nodes:</span>
            <span className="font-medium">{metrics.nodeCount.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Edges:</span>
            <span className="font-medium">{metrics.edgeCount.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">FPS:</span>
            <span className="font-medium">{metrics.fps}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Render:</span>
            <span className="font-medium">{metrics.renderTime.toFixed(1)}ms</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Layout:</span>
            <span className="font-medium">{metrics.layoutTime.toFixed(1)}ms</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Memory:</span>
            <span className="font-medium">{(metrics.memoryUsage / 1024).toFixed(1)}MB</span>
          </div>
        </div>

        {/* Optimization controls */}
        <div className="mt-3 pt-3 border-t border-gray-200">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-gray-700">Optimization:</span>
            <span className={`text-xs px-2 py-1 rounded ${
              metrics.isOptimized ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
            }`}>
              {optimizationLevel}
            </span>
          </div>
          
          <div className="flex space-x-1">
            {(['none', 'basic', 'aggressive'] as const).map((level) => (
              <button
                key={level}
                onClick={() => applyOptimizations(level)}
                className={`flex-1 px-2 py-1 text-xs rounded transition-colors ${
                  optimizationLevel === level
                    ? 'bg-blue-100 text-blue-700 border border-blue-300'
                    : 'bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100'
                }`}
              >
                {level}
              </button>
            ))}
          </div>
        </div>

        {/* Quick actions */}
        <div className="mt-3 pt-3 border-t border-gray-200">
          <div className="flex space-x-2">
            <button
              onClick={cleanupMemory}
              className="flex-1 px-2 py-1 text-xs bg-gray-50 text-gray-600 border border-gray-200 rounded hover:bg-gray-100 transition-colors"
              title="Clean up memory"
            >
              Cleanup
            </button>
            <button
              onClick={() => setIsMonitoring(!isMonitoring)}
              className={`flex-1 px-2 py-1 text-xs rounded transition-colors ${
                isMonitoring
                  ? 'bg-red-100 text-red-700 border border-red-300'
                  : 'bg-green-100 text-green-700 border border-green-300'
              }`}
              title={isMonitoring ? 'Stop monitoring' : 'Start monitoring'}
            >
              {isMonitoring ? 'Stop' : 'Start'}
            </button>
          </div>
        </div>

        {/* Performance warnings */}
        {(metrics.nodeCount > maxNodes || metrics.edgeCount > maxEdges) && (
          <div className="mt-3 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-800">
            <div className="font-medium mb-1">Performance Warning</div>
            <div>
              Large dataset detected. Consider enabling optimizations or filtering data.
            </div>
          </div>
        )}

        {metrics.fps < 30 && metrics.fps > 0 && (
          <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-800">
            <div className="font-medium mb-1">Low Performance</div>
            <div>
              Frame rate is below 30 FPS. Try aggressive optimization or reduce data size.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}