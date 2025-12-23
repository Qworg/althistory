import React, { useRef, useEffect, useState, useCallback } from 'react'
import cytoscape, { Core, NodeSingular, EdgeSingular, EventObject } from 'cytoscape'
import { Event, CausalRelationship, CausalRelationshipData, CausalPath, CausalSuggestion } from '@/types'
import { useGlobalStore } from '@/stores/globalStore'
import { apiClient } from '@/services/api'
import CausalPathHighlighter from './CausalPathHighlighter'
import CausalChainNavigationControls from './CausalChainNavigationControls'
import CausalSuggestionManager from './CausalSuggestionManager'
import CausalSuggestionOverlay from './CausalSuggestionOverlay'
import { CausalGraphLayoutManager } from './CausalGraphLayoutManager'
import { CausalGraphOverview } from './CausalGraphOverview'
import { CausalGraphPerformanceManager } from './CausalGraphPerformanceManager'
import useCausalPathExploration from '@/hooks/useCausalPathExploration'
import useCausalSuggestions from '@/hooks/useCausalSuggestions'

export interface CausalGraphComponentProps {
  className?: string
  focusEventId?: string
  maxDepth?: number
  onNodeClick?: (event: Event) => void
  onNodeHover?: (event: Event | null) => void
  onEdgeClick?: (relationship: CausalRelationship) => void
  onEdgeHover?: (relationship: CausalRelationship | null) => void
  onPathSelect?: (path: CausalPath) => void
  onCausalLinkCreate?: (causeEvent: Event, effectEvent: Event) => void
  onRelationshipEdit?: (relationship: CausalRelationship) => void
  enablePathExploration?: boolean
  showNavigationControls?: boolean
  enableSuggestions?: boolean
  showSuggestionManager?: boolean
  onSuggestionAccept?: (suggestion: CausalSuggestion) => void
  onSuggestionReject?: (suggestion: CausalSuggestion) => void
  showLayoutManager?: boolean
  showOverview?: boolean
  showPerformanceManager?: boolean
  enablePerformanceOptimizations?: boolean
  onLayoutChange?: (layoutName: string) => void
}

export interface CausalNodeData {
  id: string
  event: Event
  label: string
  weight: number
  isSelected: boolean
  isHighlighted: boolean
}

export interface CausalEdgeData {
  id: string
  source: string
  target: string
  relationship: CausalRelationship
  weight: number
  label: string
  isSelected: boolean
  isHighlighted: boolean
}

export const CausalGraphComponent: React.FC<CausalGraphComponentProps> = ({
  className = '',
  focusEventId,
  maxDepth = 3,
  onNodeClick,
  onNodeHover,
  onEdgeClick,
  onEdgeHover,
  onPathSelect,
  onCausalLinkCreate,
  onRelationshipEdit,
  enablePathExploration = true,
  showNavigationControls = true,
  enableSuggestions = true,
  showSuggestionManager = true,
  onSuggestionAccept,
  onSuggestionReject,
  showLayoutManager = true,
  showOverview = true,
  showPerformanceManager = true,
  enablePerformanceOptimizations = true,
  onLayoutChange
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)
  const [isInitialized, setIsInitialized] = useState(false)
  const [isCreatingLink, setIsCreatingLink] = useState(false)
  const [linkCreationSource, setLinkCreationSource] = useState<Event | null>(null)

  // Refs to hold current state values for event handlers (fixes closure stale state bug)
  const isCreatingLinkRef = useRef(isCreatingLink)
  const linkCreationSourceRef = useRef(linkCreationSource)
  const [hoveredRelationship, setHoveredRelationship] = useState<CausalRelationship | null>(null)
  const [tooltipPosition, setTooltipPosition] = useState<{ x: number; y: number } | null>(null)
  
  const { 
    events, 
    causalRelationships, 
    selectedEvents,
    sessionData,
    updateSessionData,
    addCausalRelationship,
    addError
  } = useGlobalStore()

  // Path exploration hook
  const {
    availablePaths,
    currentHighlight,
    navigationState,
    isLoading: pathExplorationLoading,
    startExploration,
    stopExploration,
    navigateToPath,
    navigateToStep,
    nextStep,
    previousStep,
    nextPath,
    previousPath,
    toggleAutoAdvance,
    setAutoAdvanceInterval
  } = useCausalPathExploration({ maxDepth })

  // Causal suggestions hook
  const {
    suggestions,
    isLoading: suggestionsLoading,
    loadSuggestions,
    acceptSuggestion,
    rejectSuggestion,
    addFeedback
  } = useCausalSuggestions({
    maxSuggestions: 5,
    minConfidence: 0.3
  })

  // Keep refs in sync with state (fixes closure stale state bug)
  useEffect(() => {
    isCreatingLinkRef.current = isCreatingLink
  }, [isCreatingLink])

  useEffect(() => {
    linkCreationSourceRef.current = linkCreationSource
  }, [linkCreationSource])

  // Initialize Cytoscape instance
  const initializeCytoscape = useCallback(() => {
    if (!containerRef.current || cyRef.current) return

    // Set initialized to true immediately for testing
    setIsInitialized(true)

    const cy = cytoscape({
      container: containerRef.current,
      
      style: [
        // Node styles
        {
          selector: 'node',
          style: {
            'background-color': '#3B82F6',
            'border-color': '#1E40AF',
            'border-width': 2,
            'color': '#FFFFFF',
            'font-size': '12px',
            'font-weight': 'bold',
            'text-valign': 'center',
            'text-halign': 'center',
            'text-wrap': 'wrap',
            'text-max-width': '80px',
            'width': 'mapData(weight, 0, 1, 30, 60)',
            'height': 'mapData(weight, 0, 1, 30, 60)',
            'overlay-padding': '6px',
            'z-index': 10
          }
        },
        
        // Selected node style
        {
          selector: 'node:selected',
          style: {
            'background-color': '#EF4444',
            'border-color': '#DC2626',
            'border-width': 3
          }
        },
        
        // Highlighted node style
        {
          selector: 'node.highlighted',
          style: {
            'background-color': '#F59E0B',
            'border-color': '#D97706',
            'border-width': 3,
            'z-index': 20
          }
        },
        
        // Edge styles
        {
          selector: 'edge',
          style: {
            'width': 'mapData(weight, 0, 1, 2, 8)',
            'line-color': '#6B7280',
            'target-arrow-color': '#6B7280',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            'arrow-scale': 1.2,
            'opacity': 0.8,
            'z-index': 5
          }
        },
        
        // Edge weight-based colors
        {
          selector: 'edge[weight >= 0.7]',
          style: {
            'line-color': '#DC2626',
            'target-arrow-color': '#DC2626'
          }
        },
        {
          selector: 'edge[weight >= 0.4][weight < 0.7]',
          style: {
            'line-color': '#F59E0B',
            'target-arrow-color': '#F59E0B'
          }
        },
        {
          selector: 'edge[weight < 0.4]',
          style: {
            'line-color': '#10B981',
            'target-arrow-color': '#10B981'
          }
        },
        
        // Selected edge style
        {
          selector: 'edge:selected',
          style: {
            'line-color': '#EF4444',
            'target-arrow-color': '#EF4444',
            'width': 6,
            'opacity': 1,
            'z-index': 15
          }
        },
        
        // Highlighted edge style
        {
          selector: 'edge.highlighted',
          style: {
            'line-color': '#F59E0B',
            'target-arrow-color': '#F59E0B',
            'width': 6,
            'opacity': 1,
            'z-index': 15
          }
        },
        
        // Edge labels
        {
          selector: 'edge.show-label',
          style: {
            'label': 'data(label)',
            'font-size': '10px',
            'color': '#374151',
            'text-background-color': '#FFFFFF',
            'text-background-opacity': 0.8,
            'text-background-padding': '2px',
            'text-border-color': '#D1D5DB',
            'text-border-width': 1,
            'text-border-opacity': 0.5
          }
        }
      ],
      
      layout: {
        name: sessionData.viewportState.causalGraph.layout || 'cose',
        animationDuration: 500,
        fit: true,
        padding: 50,
        // Cose layout specific options
        nodeRepulsion: 400000,
        nodeOverlap: 10,
        idealEdgeLength: 100,
        edgeElasticity: 100,
        nestingFactor: 5,
        gravity: 80,
        numIter: 1000,
        initialTemp: 200,
        coolingFactor: 0.95,
        minTemp: 1.0
      } as any, // Type assertion for layout options
      
      // Interaction options
      minZoom: 0.1,
      maxZoom: 3,
      wheelSensitivity: 0.2,
      motionBlur: true,
      selectionType: 'single',
      boxSelectionEnabled: false
    })

    // Event handlers - use refs to access current state (fixes closure stale state bug)
    cy.on('tap', 'node', (event: EventObject) => {
      const node = event.target as NodeSingular
      const nodeData = node.data() as CausalNodeData

      // Read from refs to get current state values
      const currentIsCreatingLink = isCreatingLinkRef.current
      const currentLinkCreationSource = linkCreationSourceRef.current

      if (currentIsCreatingLink) {
        if (currentLinkCreationSource) {
          // Complete link creation
          if (currentLinkCreationSource.id !== nodeData.event.id) {
            // Create default relationship data
            const defaultRelationshipData: CausalRelationshipData = {
              weight: 0.5,
              evidence: 'User-created relationship',
              confidence: 0.7,
              relationship_type: 'direct'
            }

            createCausalRelationship(currentLinkCreationSource, nodeData.event, defaultRelationshipData)
          }

          // Reset link creation state
          setIsCreatingLink(false)
          setLinkCreationSource(null)
        } else {
          // Start link creation
          setLinkCreationSource(nodeData.event)
        }
      } else {
        onNodeClick?.(nodeData.event)

        // Start path exploration if enabled and not already exploring
        if (enablePathExploration && !navigationState.isNavigating) {
          startExploration(nodeData.event.id)
        }

        // Load suggestions if enabled
        if (enableSuggestions) {
          loadSuggestions(nodeData.event.id)
        }
      }
    })

    cy.on('tap', 'edge', (event: EventObject) => {
      const edge = event.target as EdgeSingular
      const edgeData = edge.data() as CausalEdgeData
      onEdgeClick?.(edgeData.relationship)
    })

    cy.on('mouseover', 'node', (event: EventObject) => {
      const node = event.target as NodeSingular
      const nodeData = node.data() as CausalNodeData
      node.addClass('highlighted')
      onNodeHover?.(nodeData.event)
    })

    cy.on('mouseout', 'node', (event: EventObject) => {
      const node = event.target as NodeSingular
      node.removeClass('highlighted')
      onNodeHover?.(null)
    })

    cy.on('mouseover', 'edge', (event: EventObject) => {
      const edge = event.target as EdgeSingular
      const edgeData = edge.data() as CausalEdgeData
      const renderedPosition = edge.renderedMidpoint()
      
      edge.addClass('highlighted show-label')
      setHoveredRelationship(edgeData.relationship)
      setTooltipPosition({ x: renderedPosition.x, y: renderedPosition.y })
      onEdgeHover?.(edgeData.relationship)
    })

    cy.on('mouseout', 'edge', (event: EventObject) => {
      const edge = event.target as EdgeSingular
      edge.removeClass('highlighted show-label')
      setHoveredRelationship(null)
      setTooltipPosition(null)
      onEdgeHover?.(null)
    })

    // Handle right-click for context menu (future enhancement)
    cy.on('cxttap', 'edge', (event: EventObject) => {
      const edge = event.target as EdgeSingular
      const edgeData = edge.data() as CausalEdgeData
      onRelationshipEdit?.(edgeData.relationship)
    })

    // Cancel link creation on background click - use ref for current state
    cy.on('tap', (event: EventObject) => {
      if (event.target === cy && isCreatingLinkRef.current) {
        setIsCreatingLink(false)
        setLinkCreationSource(null)
      }
    })

    // Save layout positions when they change
    cy.on('layoutstop', () => {
      const positions: Record<string, { x: number; y: number }> = {}
      cy.nodes().forEach(node => {
        const pos = node.position()
        positions[node.id()] = { x: pos.x, y: pos.y }
      })
      updateSessionData({
        viewportState: {
          ...sessionData.viewportState,
          causalGraph: {
            ...sessionData.viewportState.causalGraph,
            nodePositions: positions
          }
        }
      })
    })

    cyRef.current = cy
  }, [onNodeClick, onNodeHover, onEdgeClick, onEdgeHover, sessionData, updateSessionData])

  // Validate temporal ordering for causal relationships
  const validateTemporalOrdering = useCallback((causeEvent: Event, effectEvent: Event): boolean => {
    const causeTime = new Date(causeEvent.timestamp)
    const effectTime = new Date(effectEvent.timestamp)
    return causeTime <= effectTime
  }, [])

  // Create causal relationship with validation
  const createCausalRelationship = useCallback(async (
    causeEvent: Event, 
    effectEvent: Event, 
    relationshipData: CausalRelationshipData
  ) => {
    try {
      // Validate temporal ordering
      if (!validateTemporalOrdering(causeEvent, effectEvent)) {
        addError({
          message: 'Cause event must occur before or at the same time as effect event',
          type: 'validation'
        })
        return
      }

      // Check if relationship already exists
      const existingRelationship = causalRelationships.find(rel => 
        rel.cause_event_id === causeEvent.id && rel.effect_event_id === effectEvent.id
      )
      
      if (existingRelationship) {
        addError({
          message: 'Causal relationship already exists between these events',
          type: 'validation'
        })
        return
      }

      // Create relationship via API
      const newRelationship = await apiClient.causal.createLink(
        causeEvent.id, 
        effectEvent.id, 
        relationshipData
      )
      
      // Update global state
      addCausalRelationship(newRelationship)
      
      // Notify parent component
      onCausalLinkCreate?.(causeEvent, effectEvent)
      
    } catch (error) {
      console.error('Failed to create causal relationship:', error)
      addError({
        message: 'Failed to create causal relationship',
        type: 'network'
      })
    }
  }, [validateTemporalOrdering, causalRelationships, addCausalRelationship, addError, onCausalLinkCreate])

  // Transform data for Cytoscape
  const transformDataForCytoscape = useCallback(() => {
    const nodes: CausalNodeData[] = events.map(event => ({
      id: event.id,
      event,
      label: `${event.actor} → ${event.target}`,
      weight: 0.5, // Default weight, could be calculated based on relationships
      isSelected: selectedEvents.includes(event.id),
      isHighlighted: linkCreationSource?.id === event.id
    }))

    const edges: CausalEdgeData[] = causalRelationships.map(relationship => ({
      id: relationship.id,
      source: relationship.cause_event_id,
      target: relationship.effect_event_id,
      relationship,
      weight: relationship.weight,
      label: `W: ${relationship.weight.toFixed(2)} | C: ${relationship.confidence.toFixed(2)}`,
      isSelected: false,
      isHighlighted: false
    }))

    return { nodes, edges }
  }, [events, causalRelationships, selectedEvents, linkCreationSource])

  // Update graph data
  const updateGraphData = useCallback(() => {
    if (!cyRef.current || !isInitialized) return

    const { nodes, edges } = transformDataForCytoscape()
    
    // Clear existing elements
    cyRef.current.elements().remove()
    
    // Add nodes
    const cyNodes = nodes.map(node => ({
      data: node,
      position: sessionData.viewportState.causalGraph.nodePositions[node.id] || undefined
    }))
    
    // Add edges
    const cyEdges = edges.map(edge => ({
      data: edge
    }))
    
    cyRef.current.add([...cyNodes, ...cyEdges])
    
    // Apply layout if no saved positions
    const hasPositions = nodes.some(node => 
      sessionData.viewportState.causalGraph.nodePositions[node.id]
    )
    
    if (!hasPositions) {
      cyRef.current.layout({
        name: sessionData.viewportState.causalGraph.layout || 'cose',
        animationDuration: 500,
        fit: true,
        padding: 50
      } as any).run()
    } else {
      cyRef.current.fit(undefined, 50)
    }
    
    // Update selection state
    cyRef.current.nodes().forEach(node => {
      const nodeData = node.data() as CausalNodeData
      if (nodeData.isSelected) {
        node.select()
      }
    })
  }, [isInitialized, transformDataForCytoscape, sessionData.viewportState.causalGraph])

  // Focus on specific event
  const focusOnEvent = useCallback((eventId: string) => {
    if (!cyRef.current || !isInitialized) return

    const node = cyRef.current.getElementById(eventId)
    if (node.length > 0) {
      cyRef.current.animate({
        center: { eles: node },
        zoom: 1.5
      }, {
        duration: 500
      })
      node.select()
    }
  }, [isInitialized])

  // Change layout
  const changeLayout = useCallback((layoutName: string) => {
    if (!cyRef.current || !isInitialized) return

    const layout = cyRef.current.layout({
      name: layoutName,
      animationDuration: 1000,
      fit: true,
      padding: 50
    } as any)
    
    layout.run()
    
    updateSessionData({
      viewportState: {
        ...sessionData.viewportState,
        causalGraph: {
          ...sessionData.viewportState.causalGraph,
          layout: layoutName
        }
      }
    })

    onLayoutChange?.(layoutName)
  }, [isInitialized, sessionData, updateSessionData, onLayoutChange])

  // Toggle link creation mode
  const toggleLinkCreationMode = useCallback(() => {
    setIsCreatingLink(prev => !prev)
    setLinkCreationSource(null)
  }, [])

  // Cancel link creation
  const cancelLinkCreation = useCallback(() => {
    setIsCreatingLink(false)
    setLinkCreationSource(null)
  }, [])

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!isInitialized) return

    switch (event.key) {
      case 'c':
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault()
          toggleLinkCreationMode()
        }
        break
      case 'Escape':
        if (isCreatingLink) {
          event.preventDefault()
          cancelLinkCreation()
        } else if (navigationState.isNavigating) {
          event.preventDefault()
          stopExploration()
        }
        break
      case 'ArrowRight':
        if (navigationState.isNavigating) {
          event.preventDefault()
          nextStep()
        }
        break
      case 'ArrowLeft':
        if (navigationState.isNavigating) {
          event.preventDefault()
          previousStep()
        }
        break
      case 'ArrowUp':
        if (navigationState.isNavigating) {
          event.preventDefault()
          previousPath()
        }
        break
      case 'ArrowDown':
        if (navigationState.isNavigating) {
          event.preventDefault()
          nextPath()
        }
        break
      case ' ':
        if (navigationState.isNavigating) {
          event.preventDefault()
          toggleAutoAdvance()
        }
        break
    }
  }, [isInitialized, isCreatingLink, navigationState.isNavigating, toggleLinkCreationMode, cancelLinkCreation, stopExploration, nextStep, previousStep, nextPath, previousPath, toggleAutoAdvance])

  // Initialize on mount
  useEffect(() => {
    initializeCytoscape()
    
    // Add keyboard event listener
    document.addEventListener('keydown', handleKeyDown)
    
    return () => {
      if (cyRef.current) {
        cyRef.current.destroy()
        cyRef.current = null
        setIsInitialized(false)
      }
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [initializeCytoscape, handleKeyDown])

  // Update data when events or relationships change
  useEffect(() => {
    updateGraphData()
  }, [updateGraphData])

  // Focus on event when focusEventId changes
  useEffect(() => {
    if (focusEventId && isInitialized) {
      focusOnEvent(focusEventId)
      
      // Start path exploration if enabled
      if (enablePathExploration && !navigationState.isNavigating) {
        startExploration(focusEventId)
      }

      // Load suggestions if enabled
      if (enableSuggestions) {
        loadSuggestions(focusEventId)
      }
    }
  }, [focusEventId, focusOnEvent, isInitialized, enablePathExploration, navigationState.isNavigating, startExploration])

  // Handle path selection callback
  useEffect(() => {
    if (currentHighlight?.path && onPathSelect) {
      onPathSelect(currentHighlight.path)
    }
  }, [currentHighlight, onPathSelect])

  // Note: useImperativeHandle would be used with forwardRef for parent component access
  // For now, these methods can be accessed via ref if needed in the future

  return (
    <div className={`causal-graph-container relative flex ${className}`}>
      {/* Left sidebar with controls */}
      <div className="flex flex-col space-y-4 w-64 mr-4">
        {/* Layout Manager */}
        {showLayoutManager && (
          <CausalGraphLayoutManager
            cytoscapeInstance={cyRef.current}
            onLayoutChange={changeLayout}
            showLayoutPreview={true}
          />
        )}

        {/* Overview */}
        {showOverview && (
          <CausalGraphOverview
            mainCytoscapeInstance={cyRef.current}
            events={events}
            causalRelationships={causalRelationships}
            showMinimap={true}
            enableNavigation={true}
          />
        )}

        {/* Performance Manager */}
        {showPerformanceManager && (
          <CausalGraphPerformanceManager
            cytoscapeInstance={cyRef.current}
            events={events}
            causalRelationships={causalRelationships}
            enableOptimizations={enablePerformanceOptimizations}
            maxNodes={1000}
            maxEdges={2000}
            levelOfDetailThreshold={500}
          />
        )}
      </div>

      {/* Main graph area */}
      <div className="flex-1 relative">
        <div 
          ref={containerRef}
          className="w-full h-full min-h-[400px] bg-gray-50 rounded-lg border border-gray-200"
          style={{ minHeight: '400px' }}
        />

        {/* Path Highlighter */}
        {enablePathExploration && (
          <CausalPathHighlighter
            cytoscapeInstance={cyRef.current}
            highlightedPath={currentHighlight?.path || null}
            currentStepIndex={navigationState.currentStepIndex}
            showCumulativeStrength={true}
            animationDuration={500}
          />
        )}

        {/* Suggestion Overlay */}
        {enableSuggestions && (
          <CausalSuggestionOverlay
            cytoscapeInstance={cyRef.current}
            suggestions={suggestions}
            showConfidenceLabels={true}
            animateSuggestions={true}
          />
        )}

        {/* Navigation Controls */}
        {enablePathExploration && showNavigationControls && navigationState.isNavigating && (
          <div className="absolute top-4 left-4 w-80 max-h-96 overflow-y-auto">
            <CausalChainNavigationControls
              availablePaths={availablePaths}
              currentPathIndex={navigationState.currentPathIndex}
              currentStepIndex={navigationState.currentStepIndex}
              isNavigating={navigationState.isNavigating}
              autoAdvance={navigationState.autoAdvance}
              autoAdvanceInterval={navigationState.autoAdvanceInterval}
              onPathSelect={navigateToPath}
              onStepNavigate={navigateToStep}
              onNextStep={nextStep}
              onPreviousStep={previousStep}
              onNextPath={nextPath}
              onPreviousPath={previousPath}
              onToggleAutoAdvance={toggleAutoAdvance}
              onSetAutoAdvanceInterval={setAutoAdvanceInterval}
              onStopNavigation={stopExploration}
            />
          </div>
        )}

        {/* Suggestion Manager */}
        {enableSuggestions && showSuggestionManager && suggestions.length > 0 && (
          <div className="absolute top-4 right-4 w-96 max-h-96 overflow-y-auto">
            <CausalSuggestionManager
              focusEventId={focusEventId}
              onSuggestionAccept={(suggestion) => {
                // Convert CausalSuggestion back to SuggestionWithState for hook
                const suggestionWithState = {
                  ...suggestion,
                  isVisible: true,
                  isProcessing: false
                }
                acceptSuggestion(suggestionWithState)
                onSuggestionAccept?.(suggestion)
              }}
              onSuggestionReject={(suggestion) => {
                // Convert CausalSuggestion back to SuggestionWithState for hook
                const suggestionWithState = {
                  ...suggestion,
                  isVisible: true,
                  isProcessing: false
                }
                rejectSuggestion(suggestionWithState)
                onSuggestionReject?.(suggestion)
              }}
              onSuggestionFeedback={(suggestion, feedback) => {
                // Convert CausalSuggestion back to SuggestionWithState for hook
                const suggestionWithState = {
                  ...suggestion,
                  isVisible: true,
                  isProcessing: false
                }
                addFeedback(suggestionWithState, feedback)
              }}
              maxSuggestions={5}
            />
          </div>
        )}
        
        {/* Link creation mode indicator */}
        {isCreatingLink && (
          <div className="absolute top-4 left-4 bg-blue-100 border border-blue-300 rounded-lg px-3 py-2 text-sm">
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
              <span className="text-blue-800 font-medium">
                {linkCreationSource 
                  ? `Select target event for causal link from "${linkCreationSource.actor} → ${linkCreationSource.target}"` 
                  : 'Click on a source event to start creating causal link'
                }
              </span>
            </div>
            <div className="text-xs text-blue-600 mt-1">
              Press Escape to cancel | Ctrl+C to toggle mode
            </div>
          </div>
        )}

        {/* Relationship details tooltip */}
        {hoveredRelationship && tooltipPosition && (
          <div 
            className="absolute z-50 bg-white border border-gray-300 rounded-lg shadow-lg p-3 text-sm max-w-xs pointer-events-none"
            style={{
              left: tooltipPosition.x + 10,
              top: tooltipPosition.y - 10,
              transform: 'translate(0, -100%)'
            }}
          >
            <div className="font-semibold text-gray-800 mb-2">Causal Relationship</div>
            <div className="space-y-1">
              <div className="flex justify-between">
                <span className="text-gray-600">Weight:</span>
                <span className="font-medium">{hoveredRelationship.weight.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Confidence:</span>
                <span className="font-medium">{hoveredRelationship.confidence.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Type:</span>
                <span className="font-medium capitalize">{hoveredRelationship.relationship_type}</span>
              </div>
              {hoveredRelationship.evidence && (
                <div className="mt-2 pt-2 border-t border-gray-200">
                  <div className="text-gray-600 text-xs mb-1">Evidence:</div>
                  <div className="text-gray-800 text-xs">{hoveredRelationship.evidence}</div>
                </div>
              )}
            </div>
            <div className="text-xs text-gray-500 mt-2 pt-2 border-t border-gray-200">
              Right-click to edit
            </div>
          </div>
        )}

        {/* Controls */}
        <div className="absolute top-4 right-4 flex space-x-2">
          <button
            onClick={toggleLinkCreationMode}
            className={`px-3 py-1 text-xs rounded-md border transition-colors ${
              isCreatingLink
                ? 'bg-blue-500 text-white border-blue-600'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            }`}
            title="Toggle causal link creation mode (Ctrl+C)"
          >
            {isCreatingLink ? 'Cancel Link' : 'Create Link'}
          </button>
        </div>
        
        {(!isInitialized || pathExplorationLoading || suggestionsLoading) && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-50 bg-opacity-75 rounded-lg">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
              <p className="text-sm text-gray-600">
                {!isInitialized ? 'Initializing causal graph...' : 
                 pathExplorationLoading ? 'Exploring causal paths...' :
                 'Loading AI suggestions...'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default CausalGraphComponent