import React, { useCallback, useEffect, useState, useRef } from 'react'
import { Core } from 'cytoscape'
import { useGlobalStore } from '@/stores/globalStore'

export interface LayoutConfig {
  name: string
  label: string
  description: string
  icon: React.ReactNode
  options: any
  category: 'force' | 'hierarchical' | 'circular' | 'grid'
}

export interface CausalGraphLayoutManagerProps {
  cytoscapeInstance: Core | null
  className?: string
  onLayoutChange?: (layoutName: string) => void
  showLayoutPreview?: boolean
}

const layoutConfigs: LayoutConfig[] = [
  {
    name: 'cose',
    label: 'Force-Directed',
    description: 'Physics-based layout with node repulsion and edge attraction',
    category: 'force',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
      </svg>
    ),
    options: {
      name: 'cose',
      animationDuration: 1000,
      fit: true,
      padding: 50,
      nodeRepulsion: 400000,
      nodeOverlap: 10,
      idealEdgeLength: 100,
      edgeElasticity: 100,
      nestingFactor: 5,
      gravity: 80,
      numIter: 1000,
      initialTemp: 200,
      coolingFactor: 0.95,
      minTemp: 1.0,
      randomize: false
    }
  },
  {
    name: 'cose-bilkent',
    label: 'Enhanced Force',
    description: 'Advanced force-directed layout with better clustering',
    category: 'force',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
    options: {
      name: 'cose-bilkent',
      animationDuration: 1000,
      fit: true,
      padding: 50,
      nodeRepulsion: 4500,
      idealEdgeLength: 50,
      edgeElasticity: 0.45,
      nestingFactor: 0.1,
      gravity: 0.25,
      numIter: 2500,
      tile: true,
      tilingPaddingVertical: 10,
      tilingPaddingHorizontal: 10,
      gravityRangeCompound: 1.5,
      gravityCompound: 1.0,
      gravityRange: 3.8,
      initialEnergyOnIncremental: 0.5
    }
  },
  {
    name: 'breadthfirst',
    label: 'Hierarchical',
    description: 'Tree-like layout showing clear hierarchical relationships',
    category: 'hierarchical',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
      </svg>
    ),
    options: {
      name: 'breadthfirst',
      animationDuration: 1000,
      fit: true,
      padding: 50,
      directed: true,
      spacingFactor: 1.75,
      avoidOverlap: true,
      maximal: false,
      grid: false
    }
  },
  {
    name: 'dagre',
    label: 'Directed Graph',
    description: 'Optimized layout for directed acyclic graphs',
    category: 'hierarchical',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    ),
    options: {
      name: 'dagre',
      animationDuration: 1000,
      fit: true,
      padding: 50,
      rankDir: 'TB', // Top to bottom
      ranker: 'network-simplex',
      nodeSep: 50,
      edgeSep: 10,
      rankSep: 50
    }
  },
  {
    name: 'circle',
    label: 'Circular',
    description: 'Nodes arranged in a circle, good for showing connections',
    category: 'circular',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    options: {
      name: 'circle',
      animationDuration: 1000,
      fit: true,
      padding: 50,
      avoidOverlap: true,
      radius: undefined, // Auto-calculate
      startAngle: -Math.PI / 2, // Start at top
      sweep: 2 * Math.PI, // Full circle
      clockwise: true,
      sort: undefined,
      animate: true
    }
  },
  {
    name: 'concentric',
    label: 'Concentric',
    description: 'Concentric circles based on node importance',
    category: 'circular',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
      </svg>
    ),
    options: {
      name: 'concentric',
      animationDuration: 1000,
      fit: true,
      padding: 50,
      avoidOverlap: true,
      nodeDimensionsIncludeLabels: false,
      spacingFactor: 1.75,
      radius: undefined,
      startAngle: -Math.PI / 2,
      sweep: 2 * Math.PI,
      clockwise: true,
      equidistant: false,
      minNodeSpacing: 10,
      concentric: (node: any) => node.degree(), // Use node degree for concentricity
      levelWidth: () => 1
    }
  },
  {
    name: 'grid',
    label: 'Grid',
    description: 'Organized grid layout for systematic viewing',
    category: 'grid',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
      </svg>
    ),
    options: {
      name: 'grid',
      animationDuration: 1000,
      fit: true,
      padding: 50,
      avoidOverlap: true,
      avoidOverlapPadding: 10,
      nodeDimensionsIncludeLabels: false,
      spacingFactor: 1.75,
      condense: false,
      rows: undefined, // Auto-calculate
      cols: undefined, // Auto-calculate
      position: () => ({ row: undefined, col: undefined }), // Auto-position
      sort: undefined,
      animate: true
    }
  },
  {
    name: 'random',
    label: 'Random',
    description: 'Random positioning for exploring different perspectives',
    category: 'force',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4V2a1 1 0 011-1h8a1 1 0 011 1v2m-9 0h10m-9 0a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V6a2 2 0 00-2-2m-5 4h4m-4 4h4m-4 4h4" />
      </svg>
    ),
    options: {
      name: 'random',
      animationDuration: 1000,
      fit: true,
      padding: 50,
      animate: true
    }
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
  const currentLayoutRef = useRef<any>(null)

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
    }
  }, [])

  // Apply layout with smooth transition
  const applyLayout = useCallback(async (layoutName: string, options?: any) => {
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
      const layoutOptions = options || layoutConfig?.options || { name: layoutName }

      // Save current positions for potential rollback
      const currentPositions: Record<string, { x: number; y: number }> = {}
      cytoscapeInstance.nodes().forEach(node => {
        const pos = node.position()
        currentPositions[node.id()] = { x: pos.x, y: pos.y }
      })

      // Apply the layout
      const layout = cytoscapeInstance.layout(layoutOptions)
      currentLayoutRef.current = layout

      // Run layout and wait for completion
      await new Promise<void>((resolve) => {
        layout.on('layoutstop', () => {
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

    setPreviewLayout(layoutName)

    // Create a temporary preview with reduced animation
    const layoutConfig = layoutConfigs.find(config => config.name === layoutName)
    if (layoutConfig) {
      const previewOptions = {
        ...layoutConfig.options,
        animationDuration: 300,
        fit: false // Don't fit to prevent jarring movements
      }

      const layout = cytoscapeInstance.layout(previewOptions)
      layout.run()
    }

    // Clear preview after a delay - store ref for cleanup
    previewTimeoutRef.current = setTimeout(() => {
      setPreviewLayout(null)
      previewTimeoutRef.current = null
    }, 2000)
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

  // Group layouts by category
  const layoutsByCategory = React.useMemo(() => {
    const categories: Record<string, LayoutConfig[]> = {}
    layoutConfigs.forEach(config => {
      if (!categories[config.category]) {
        categories[config.category] = []
      }
      categories[config.category]!.push(config)
    })
    return categories
  }, [])

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      if (!cytoscapeInstance || isTransitioning) return

      // Only handle shortcuts when no input is focused
      if (event.target instanceof HTMLInputElement || 
          event.target instanceof HTMLTextAreaElement ||
          event.target instanceof HTMLSelectElement) {
        return
      }

      // Layout shortcuts (1-8 for different layouts)
      const layoutShortcuts: Record<string, string> = {
        '1': 'cose',
        '2': 'breadthfirst',
        '3': 'circle',
        '4': 'grid',
        '5': 'concentric',
        '6': 'dagre',
        '7': 'cose-bilkent',
        '8': 'random'
      }

      if (layoutShortcuts[event.key]) {
        event.preventDefault()
        const layoutName = layoutShortcuts[event.key]
        if (layoutName) {
          applyLayout(layoutName)
        }
      }

      // Fit to view (F key)
      if (event.key === 'f' || event.key === 'F') {
        event.preventDefault()
        cytoscapeInstance.fit(undefined, 50)
      }

      // Reset zoom (R key)
      if (event.key === 'r' || event.key === 'R') {
        event.preventDefault()
        cytoscapeInstance.zoom(1)
        cytoscapeInstance.center()
      }
    }

    document.addEventListener('keydown', handleKeyPress)
    return () => document.removeEventListener('keydown', handleKeyPress)
  }, [cytoscapeInstance, isTransitioning, applyLayout])

  const categoryLabels = {
    force: 'Force-Based',
    hierarchical: 'Hierarchical',
    circular: 'Circular',
    grid: 'Grid-Based'
  }

  return (
    <div className={`causal-graph-layout-manager ${className}`}>
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-900">Graph Layout</h3>
          {isTransitioning && (
            <div className="flex items-center space-x-2 text-xs text-blue-600">
              <div className="animate-spin rounded-full h-3 w-3 border-b border-blue-600"></div>
              <span>Applying layout...</span>
            </div>
          )}
        </div>

        <div className="space-y-4">
          {Object.entries(layoutsByCategory).map(([category, layouts]) => (
            <div key={category}>
              <h4 className="text-xs font-medium text-gray-700 mb-2 uppercase tracking-wide">
                {categoryLabels[category as keyof typeof categoryLabels]}
              </h4>
              <div className="grid grid-cols-2 gap-2">
                {layouts.map((layout) => {
                  const isActive = currentLayout === layout.name
                  const isPreviewing = previewLayout === layout.name

                  return (
                    <button
                      key={layout.name}
                      onClick={() => applyLayout(layout.name)}
                      onMouseEnter={() => showLayoutPreview && previewLayoutChange(layout.name)}
                      onMouseLeave={() => showLayoutPreview && cancelPreview()}
                      disabled={isTransitioning}
                      className={`
                        group relative flex items-center space-x-2 p-2 rounded-md text-sm
                        transition-all duration-200 ease-in-out
                        ${isActive
                          ? 'bg-blue-100 text-blue-700 border border-blue-300'
                          : isPreviewing
                          ? 'bg-yellow-50 text-yellow-700 border border-yellow-300'
                          : 'bg-gray-50 text-gray-700 border border-gray-200 hover:bg-gray-100'
                        }
                        ${isTransitioning ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                      `}
                      title={`${layout.description} (${layout.name === 'cose' ? '1' : 
                        layout.name === 'breadthfirst' ? '2' :
                        layout.name === 'circle' ? '3' :
                        layout.name === 'grid' ? '4' :
                        layout.name === 'concentric' ? '5' :
                        layout.name === 'dagre' ? '6' :
                        layout.name === 'cose-bilkent' ? '7' :
                        layout.name === 'random' ? '8' : ''})`}
                    >
                      <span className={`
                        ${isActive ? 'text-blue-600' : 
                          isPreviewing ? 'text-yellow-600' : 'text-gray-500'}
                      `}>
                        {layout.icon}
                      </span>
                      <span className="flex-1 text-left font-medium">
                        {layout.label}
                      </span>
                      
                      {isActive && (
                        <div className="w-2 h-2 bg-blue-500 rounded-full" />
                      )}
                      
                      {isPreviewing && (
                        <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse" />
                      )}

                      {/* Keyboard shortcut indicator */}
                      <span className="text-xs text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity">
                        {layout.name === 'cose' ? '1' : 
                         layout.name === 'breadthfirst' ? '2' :
                         layout.name === 'circle' ? '3' :
                         layout.name === 'grid' ? '4' :
                         layout.name === 'concentric' ? '5' :
                         layout.name === 'dagre' ? '6' :
                         layout.name === 'cose-bilkent' ? '7' :
                         layout.name === 'random' ? '8' : ''}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Quick actions */}
        <div className="mt-4 pt-4 border-t border-gray-200">
          <div className="flex items-center justify-between text-xs text-gray-600">
            <span>Quick Actions:</span>
            <div className="flex space-x-4">
              <button
                onClick={() => cytoscapeInstance?.fit(undefined, 50)}
                className="hover:text-gray-900 transition-colors"
                title="Fit to view (F)"
              >
                Fit (F)
              </button>
              <button
                onClick={() => {
                  cytoscapeInstance?.zoom(1)
                  cytoscapeInstance?.center()
                }}
                className="hover:text-gray-900 transition-colors"
                title="Reset zoom (R)"
              >
                Reset (R)
              </button>
            </div>
          </div>
        </div>

        {/* Layout description */}
        {currentLayout && (
          <div className="mt-3 p-2 bg-gray-50 rounded text-xs text-gray-600">
            {layoutConfigs.find(config => config.name === currentLayout)?.description}
          </div>
        )}
      </div>
    </div>
  )
}