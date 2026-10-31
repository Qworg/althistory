import React, { useRef, useEffect, useState, useCallback } from 'react'
import cytoscape, { Core, NodeSingular, EdgeSingular, EventObject } from 'cytoscape'
import '@/utils/cytoscapeSetup' // Register layout extensions (dagre, cose-bilkent)
import { Event, CausalRelationship, CausalRelationshipData, CausalPath, CausalSuggestion } from '@/types'
import { useGlobalStore } from '@/stores/globalStore'
import { apiClient } from '@/services/api'
import { toCytoscapeLayoutOptions } from '@/utils/layoutManagerUtils'
import { isCausalOrderValid, isTemporalInversion } from '@/utils/causalOrder'
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
  events?: Event[]
  causalRelationships?: CausalRelationship[]
  relationships?: CausalRelationship[]
  onNodeClick?: (event: Event) => void
  onNodeHover?: (event: Event | null) => void
  onEdgeClick?: (relationship: CausalRelationship) => void
  onEdgeHover?: (relationship: CausalRelationship | null) => void
  onPathSelect?: (path: CausalPath) => void
  onCausalLinkCreate?: (causeEvent: Event, effectEvent: Event) => void
  onRelationshipEdit?: (relationship: CausalRelationship) => void
  onRelationshipContextMenu?: (relationship: CausalRelationship, position: { x: number; y: number }) => void
  onNodeContextMenu?: (event: Event, position: { x: number; y: number }) => void
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
  divergenceEventIds?: string[]
}

export interface CausalNodeData {
  id: string
  event: Event
  label: string
  weight: number
  isSelected: boolean
  isHighlighted: boolean
  isForeign?: boolean
  isDivergencePoint?: boolean
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
  isCrossGraph?: boolean
  crossGraphLabel?: string
}

export const CausalGraphComponent: React.FC<CausalGraphComponentProps> = ({
  className = '',
  focusEventId,
  maxDepth = 3,
  events: propEvents,
  causalRelationships: propCausalRelationships,
  relationships: propRelationships,
  onNodeClick,
  onNodeHover,
  onEdgeClick,
  onEdgeHover,
  onPathSelect,
  onCausalLinkCreate,
  onRelationshipEdit,
  onRelationshipContextMenu,
  onNodeContextMenu,
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
  onLayoutChange,
  divergenceEventIds
}) => {
  // DEBUG: Render counter to detect infinite loops
  const renderCountRef = useRef(0)
  useEffect(() => {
    renderCountRef.current++
    if (import.meta.env.DEV) {
      console.log(`[CausalGraph] Render #${renderCountRef.current}`)
      if (renderCountRef.current > 50) {
        console.error('[CausalGraph] Excessive render count detected')
      }
    }
  })

  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)
  const [isInitialized, setIsInitialized] = useState(false)
  const [isCreatingLink, setIsCreatingLink] = useState(false)
  const [linkCreationSource, setLinkCreationSource] = useState<Event | null>(null)

  // Refs to hold current state values for event handlers (fixes closure stale state bug)
  const isCreatingLinkRef = useRef(isCreatingLink)
  const linkCreationSourceRef = useRef(linkCreationSource)
  const handleKeyDownRef = useRef<(event: KeyboardEvent) => void>(() => {})

  // Suppresses background-tap cancellation for taps that arrive in the same task
  // as a link-mode transition or a graph rebuild. A tap delivered in that same
  // task cannot be a fresh, deliberate background tap (a real user tap is always
  // dispatched as a new task); it is gesture / re-render fallout, such as the tap
  // that selected a node being reprocessed after the graph is rebuilt. The guard
  // is cleared once the task queue next drains.
  const backgroundTapGuardRef = useRef(false)
  const backgroundTapGuardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [hoveredRelationship, setHoveredRelationship] = useState<CausalRelationship | null>(null)
  const [tooltipPosition, setTooltipPosition] = useState<{ x: number; y: number } | null>(null)
  const [hoveredNode, setHoveredNode] = useState<Event | null>(null)
  const [nodeTooltipPosition, setNodeTooltipPosition] = useState<{ x: number; y: number } | null>(null)
  
  // Use props if provided, otherwise fallback to store
  const storeEvents = useGlobalStore(state => state.events)
  const storeCausalRelationships = useGlobalStore(state => state.causalRelationships)
  const events = propEvents ?? storeEvents
  const causalRelationships = propCausalRelationships ?? propRelationships ?? storeCausalRelationships
  const selectedEvents = useGlobalStore(state => state.selectedEvents)
  const setSelectedEvents = useGlobalStore(state => state.setSelectedEvents)
  const updateSessionData = useGlobalStore(state => state.updateSessionData)
  const addCausalRelationship = useGlobalStore(state => state.addCausalRelationship)
  const addError = useGlobalStore(state => state.addError)

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
    console.log('[CausalGraph] Syncing isCreatingLinkRef:', isCreatingLink)
    isCreatingLinkRef.current = isCreatingLink
  }, [isCreatingLink])

  useEffect(() => {
    console.log('[CausalGraph] Syncing linkCreationSourceRef:', linkCreationSource?.id || null)
    linkCreationSourceRef.current = linkCreationSource
  }, [linkCreationSource])

  // Arm the same-task background-tap guard. Anything delivered before the task
  // queue drains belongs to the programmatic transition / re-render that is
  // happening now, not to a new user gesture, so it must not cancel link creation.
  const armBackgroundTapGuard = useCallback(() => {
    backgroundTapGuardRef.current = true
    if (backgroundTapGuardTimerRef.current !== null) return
    backgroundTapGuardTimerRef.current = setTimeout(() => {
      backgroundTapGuardTimerRef.current = null
      backgroundTapGuardRef.current = false
    }, 0)
  }, [])

  // Clear any pending guard timer on unmount.
  useEffect(() => {
    return () => {
      if (backgroundTapGuardTimerRef.current !== null) {
        clearTimeout(backgroundTapGuardTimerRef.current)
        backgroundTapGuardTimerRef.current = null
      }
    }
  }, [])

  // Initialize Cytoscape instance
  // Validate temporal ordering for causal relationships
  const validateTemporalOrdering = useCallback((causeEvent: Event, effectEvent: Event): boolean => {
    const causeTime = new Date(causeEvent.timestamp)
    const effectTime = new Date(effectEvent.timestamp)
    return isCausalOrderValid(causeTime, effectTime)
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

  const initializeCytoscape = useCallback(() => {
    if (!containerRef.current || cyRef.current) return

    // Read session data from store (not from closure) to get current layout preference
    const currentSessionData = useGlobalStore.getState().sessionData
    const savedLayout = currentSessionData.viewportState.causalGraph.layout || 'cose'

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
            // Every node carries a `label` ("actor → target"), but the style
            // never mapped it, so the graph drew anonymous circles. The label
            // sits under the node in dark text: centred white text overflowed
            // a 45px node onto the light canvas and could not be read.
            'label': 'data(label)',
            'color': '#1F2937',
            'font-size': '11px',
            'font-weight': 600,
            'text-valign': 'bottom',
            'text-halign': 'center',
            'text-margin-y': 6,
            'text-wrap': 'wrap',
            'text-max-width': '140px',
            'text-background-color': '#FFFFFF',
            'text-background-opacity': 0.85,
            'text-background-padding': '2px',
            'text-background-shape': 'roundrectangle',
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

        // Link source node style (when creating causal links)
        {
          selector: 'node.link-source',
          style: {
            'background-color': '#8B5CF6',
            'border-color': '#7C3AED',
            'border-width': 4,
            'z-index': 25
          }
        },

        // Invalid target node style (events that occurred before/same time as source - can't be effects)
        {
          selector: 'node.invalid-target',
          style: {
            'background-color': '#9CA3AF',
            'border-color': '#6B7280',
            'border-width': 2,
            'opacity': 0.5,
            'z-index': 5
          }
        },

        // Foreign placeholder node style (for cross-graph target/source events)
        {
          selector: 'node.foreign-node',
          style: {
            'background-color': '#7C3AED',
            'border-color': '#5B21B6',
            'border-style': 'dashed',
            'border-width': 3,
            'opacity': 0.85,
            'shape': 'round-rectangle',
            'z-index': 12
          }
        },

        // Divergence point node style (Point of Divergence / Counterfactual branch fork)
        {
          selector: 'node.divergence-point',
          style: {
            'background-color': '#D97706',
            'border-color': '#F59E0B',
            'border-width': 4,
            'shape': 'diamond',
            'color': '#FFFFFF',
            'font-weight': 'bold',
            'overlay-color': '#FBBF24',
            'overlay-padding': '5px',
            'overlay-opacity': 0.35,
            'z-index': 24
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

        // Cross-graph edge styles (distinct styling: dashed purple edge with foreign indicator pill)
        {
          selector: 'edge.cross-graph',
          style: {
            'line-style': 'dashed',
            'line-dash-pattern': [6, 3],
            'line-color': '#8B5CF6',
            'target-arrow-color': '#8B5CF6',
            'opacity': 0.9,
            'label': 'data(crossGraphLabel)',
            'font-size': '10px',
            'color': '#5B21B6',
            'text-background-color': '#EDE9FE',
            'text-background-opacity': 0.9,
            'text-background-padding': '3px',
            'text-border-color': '#C4B5FD',
            'text-border-width': 1,
            'text-border-opacity': 0.8,
            'z-index': 10
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
      
      layout: toCytoscapeLayoutOptions({
        name: savedLayout,
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
      }),
      
      // Interaction options
      minZoom: 0.1,
      maxZoom: 3,
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

      console.log('[CausalGraph] Node tap:', {
        nodeId: nodeData.id,
        isCreatingLink: currentIsCreatingLink,
        linkCreationSource: currentLinkCreationSource?.id || null
      })

      if (currentIsCreatingLink) {
        if (currentLinkCreationSource) {
          // Check if target is a valid effect (must not occur before the cause)
          if (node.hasClass('invalid-target')) {
            console.log('[CausalGraph] Cannot create link - target event occurs before the source')
            // Just ignore the click on invalid targets - they're greyed out to indicate they can't be selected
            return
          }

          console.log('[CausalGraph] Creating link from', currentLinkCreationSource.id, 'to', nodeData.event.id)
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
          console.log('[CausalGraph] Setting link source to', nodeData.event.id)
          // Selecting the source re-renders the graph; guard against a tap the
          // re-render emits in this same task cancelling the interaction.
          armBackgroundTapGuard()
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
      const renderedPosition = node.renderedPosition()
      node.addClass('highlighted')
      setHoveredNode(nodeData.event)
      setNodeTooltipPosition({ x: renderedPosition.x, y: renderedPosition.y })
      onNodeHover?.(nodeData.event)
    })

    cy.on('mouseout', 'node', (event: EventObject) => {
      const node = event.target as NodeSingular
      node.removeClass('highlighted')
      setHoveredNode(null)
      setNodeTooltipPosition(null)
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

    // Handle right-click for context menu on edges
    cy.on('cxttap', 'edge', (event: EventObject) => {
      const edge = event.target as EdgeSingular
      const edgeData = edge.data() as CausalEdgeData
      if (onRelationshipContextMenu) {
        // Use original DOM event coordinates for accurate positioning
        const originalEvent = event.originalEvent as MouseEvent
        const x = originalEvent.clientX
        const y = originalEvent.clientY
        onRelationshipContextMenu(edgeData.relationship, { x, y })
      } else {
        onRelationshipEdit?.(edgeData.relationship)
      }
    })

    // Handle right-click for context menu on nodes
    cy.on('cxttap', 'node', (event: EventObject) => {
      const node = event.target as NodeSingular
      const nodeData = node.data() as CausalNodeData
      if (onNodeContextMenu) {
        // Use original DOM event coordinates for accurate positioning
        const originalEvent = event.originalEvent as MouseEvent
        const x = originalEvent.clientX
        const y = originalEvent.clientY
        onNodeContextMenu(nodeData.event, { x, y })
      }
    })

    // A deliberate background tap cancels link creation. Taps that arrive in the
    // same task as a link-mode transition or a graph rebuild are gesture / re-render
    // fallout rather than a new user gesture, so they are ignored. Escape and the
    // Cancel Link button remain the other cancellation paths.
    cy.on('tap', (event: EventObject) => {
      if (event.target !== cy || !isCreatingLinkRef.current) return
      if (backgroundTapGuardRef.current) {
        console.log('[CausalGraph] Ignoring background tap from the same task as a link-mode transition or graph rebuild')
        return
      }
      setIsCreatingLink(false)
      setLinkCreationSource(null)
    })

    // Save layout positions when they change
    cy.on('layoutstop', () => {
      const positions: Record<string, { x: number; y: number }> = {}
      cy.nodes().forEach(node => {
        const pos = node.position()
        positions[node.id()] = { x: pos.x, y: pos.y }
      })
      // Read current session data from store to avoid stale closure
      const currentSessionData = useGlobalStore.getState().sessionData
      updateSessionData({
        viewportState: {
          ...currentSessionData.viewportState,
          causalGraph: {
            ...currentSessionData.viewportState.causalGraph,
            nodePositions: positions
          }
        }
      })
    })

    cyRef.current = cy
  }, [
    onNodeClick, onNodeHover, onEdgeClick, onEdgeHover, updateSessionData,
    createCausalRelationship, enablePathExploration, enableSuggestions, loadSuggestions,
    navigationState.isNavigating, onNodeContextMenu, onRelationshipContextMenu,
    onRelationshipEdit, startExploration, armBackgroundTapGuard
  ])


  // Transform data for Cytoscape
  // NOTE: linkCreationSource is intentionally NOT a dependency here to prevent
  // graph rebuilds when selecting link source (which causes spurious background taps)
  const transformDataForCytoscape = useCallback(() => {
    const eventMap = new Map(events.map(event => [event.id, event]))
    const nodes: CausalNodeData[] = events.map(event => ({
      id: event.id,
      event,
      label: `${event.actor} → ${event.target}`,
      weight: 0.5, // Default weight, could be calculated based on relationships
      isSelected: selectedEvents.includes(event.id),
      isHighlighted: false, // Highlighting handled separately via useEffect
      isDivergencePoint: Boolean(divergenceEventIds && divergenceEventIds.includes(event.id))
    }))

    // Synthesize placeholder nodes for foreign / missing event references
    causalRelationships.forEach(relationship => {
      const isCrossCause = Boolean(relationship.isCrossGraph || relationship.causeGraphId)
      const isCrossEffect = Boolean(relationship.isCrossGraph || relationship.effectGraphId)
      if (!eventMap.has(relationship.cause_event_id)) {
        const placeholderEvent: Event = {
          id: relationship.cause_event_id,
          actor: relationship.causeGraphId
            ? `[Graph: ${relationship.causeGraphId.slice(0, 8)}]`
            : (isCrossCause ? '[Foreign]' : '[Broken Reference]'),
          target: 'Event',
          description: isCrossCause
            ? 'Cross-graph referenced cause event'
            : 'Broken local reference (missing cause event)',
          timestamp: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
        eventMap.set(relationship.cause_event_id, placeholderEvent)
        nodes.push({
          id: relationship.cause_event_id,
          event: placeholderEvent,
          label: relationship.causeGraphId
            ? `⇥ ${relationship.causeGraphId.slice(0, 8)}: ${relationship.cause_event_id.slice(0, 6)}`
            : (isCrossCause
              ? `⇥ Foreign: ${relationship.cause_event_id.slice(0, 6)}`
              : `⚠ Missing: ${relationship.cause_event_id.slice(0, 6)}`),
          weight: 0.5,
          isSelected: selectedEvents.includes(relationship.cause_event_id),
          isHighlighted: false,
          isForeign: true
        })
      }
      if (!eventMap.has(relationship.effect_event_id)) {
        const placeholderEvent: Event = {
          id: relationship.effect_event_id,
          actor: relationship.effectGraphId
            ? `[Graph: ${relationship.effectGraphId.slice(0, 8)}]`
            : (isCrossEffect ? '[Foreign]' : '[Broken Reference]'),
          target: 'Event',
          description: isCrossEffect
            ? 'Cross-graph referenced effect event'
            : 'Broken local reference (missing effect event)',
          timestamp: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
        eventMap.set(relationship.effect_event_id, placeholderEvent)
        nodes.push({
          id: relationship.effect_event_id,
          event: placeholderEvent,
          label: relationship.effectGraphId
            ? `⇤ ${relationship.effectGraphId.slice(0, 8)}: ${relationship.effect_event_id.slice(0, 6)}`
            : (isCrossEffect
              ? `⇤ Foreign: ${relationship.effect_event_id.slice(0, 6)}`
              : `⚠ Missing: ${relationship.effect_event_id.slice(0, 6)}`),
          weight: 0.5,
          isSelected: selectedEvents.includes(relationship.effect_event_id),
          isHighlighted: false,
          isForeign: true
        })
      }
    })

    const edges: CausalEdgeData[] = causalRelationships.map(relationship => {
      const isCross = Boolean(relationship.isCrossGraph || relationship.causeGraphId || relationship.effectGraphId)
      const foreignGraph = relationship.effectGraphId || relationship.causeGraphId
      const crossGraphLabel = isCross && foreignGraph
        ? `⚡ [${foreignGraph.slice(0, 8)}]`
        : (isCross ? '⚡ Cross-Graph' : undefined)

      return {
        id: relationship.id,
        source: relationship.cause_event_id,
        target: relationship.effect_event_id,
        relationship,
        weight: relationship.weight,
        label: `W: ${relationship.weight.toFixed(2)} | C: ${relationship.confidence.toFixed(2)}`,
        isSelected: false,
        isHighlighted: false,
        isCrossGraph: isCross,
        crossGraphLabel
      }
    })

    return { nodes, edges }
  }, [events, causalRelationships, selectedEvents, divergenceEventIds]) // linkCreationSource removed

  // Update graph data
  const updateGraphData = useCallback(() => {
    if (!cyRef.current || !isInitialized) return

    // Rebuilding the graph can emit a background tap in this task; suppress it so
    // it is not mistaken for a deliberate background tap.
    armBackgroundTapGuard()

    const { nodes, edges } = transformDataForCytoscape()

    // Read session data directly from store to avoid dependency cycle
    // (layoutstop updates sessionData -> updateGraphData recreates -> effect runs -> loop)
    const currentSessionData = useGlobalStore.getState().sessionData
    const causalGraphState = currentSessionData.viewportState.causalGraph

    // Clear existing elements
    cyRef.current.elements().remove()

    // Add nodes
    const cyNodes = nodes.map(node => {
      const classes: string[] = []
      if (node.isForeign) classes.push('foreign-node')
      if (node.isDivergencePoint || (divergenceEventIds && divergenceEventIds.includes(node.id))) {
        classes.push('divergence-point')
      }
      return {
        data: node,
        classes: classes.length > 0 ? classes.join(' ') : undefined,
        position: causalGraphState.nodePositions[node.id] || undefined
      }
    })

    // Add edges
    const cyEdges = edges.map(edge => ({
      data: edge,
      classes: edge.isCrossGraph ? 'cross-graph' : undefined
    }))

    cyRef.current.add([...cyNodes, ...cyEdges])

    // Apply layout if no saved positions
    const hasPositions = nodes.some(node =>
      causalGraphState.nodePositions[node.id]
    )

    if (!hasPositions) {
      cyRef.current.layout(toCytoscapeLayoutOptions({
        name: causalGraphState.layout || 'cose',
        animationDuration: 500,
        fit: true,
        padding: 50
      })).run()
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
  }, [isInitialized, transformDataForCytoscape, armBackgroundTapGuard, divergenceEventIds]) // Removed sessionData dependency to break update cycle

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

    const layout = cyRef.current.layout(toCytoscapeLayoutOptions({
      name: layoutName,
      animationDuration: 1000,
      fit: true,
      padding: 50
    }))

    layout.run()

    // Read current session data from store to avoid stale closure
    const currentSessionData = useGlobalStore.getState().sessionData
    updateSessionData({
      viewportState: {
        ...currentSessionData.viewportState,
        causalGraph: {
          ...currentSessionData.viewportState.causalGraph,
          layout: layoutName
        }
      }
    })

    onLayoutChange?.(layoutName)
  }, [isInitialized, updateSessionData, onLayoutChange])

  // Toggle link creation mode
  const toggleLinkCreationMode = useCallback(() => {
    // Entering (or leaving) link mode re-renders; ignore a background tap emitted
    // in this same task so it cannot immediately cancel the mode just entered.
    armBackgroundTapGuard()
    setIsCreatingLink(prev => !prev)
    setLinkCreationSource(null)
  }, [armBackgroundTapGuard])

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

  // Keep keyboard handler ref in sync (fixes stale closure in event listener)
  useEffect(() => {
    handleKeyDownRef.current = handleKeyDown
  }, [handleKeyDown])

  // Initialize Cytoscape on mount (runs once)
  useEffect(() => {
    initializeCytoscape()

    return () => {
      if (cyRef.current) {
        cyRef.current.destroy()
        cyRef.current = null
        setIsInitialized(false)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only run on mount - initializeCytoscape is stable enough

  // Keyboard event listener (separate from initialization to avoid re-init loops)
  useEffect(() => {
    const keydownHandler = (event: KeyboardEvent) => {
      handleKeyDownRef.current(event)
    }

    document.addEventListener('keydown', keydownHandler)
    return () => {
      document.removeEventListener('keydown', keydownHandler)
    }
  }, []) // Stable - uses ref internally

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
  }, [focusEventId, focusOnEvent, isInitialized, enablePathExploration, navigationState.isNavigating, startExploration, enableSuggestions, loadSuggestions])

  // Handle path selection callback
  useEffect(() => {
    if (currentHighlight?.path && onPathSelect) {
      onPathSelect(currentHighlight.path)
    }
  }, [currentHighlight, onPathSelect])

  // Highlight link source node and mark invalid targets without rebuilding graph
  // This uses Cytoscape's class system instead of recreating elements
  // Dependencies include events/causalRelationships to reapply after graph rebuilds
  useEffect(() => {
    if (!cyRef.current || !isInitialized) return

    const cy = cyRef.current
    const nodes = cy.nodes()

    // Guard against empty graph
    if (nodes.length === 0) return

    // Remove all link-related classes from nodes first
    nodes.removeClass('link-source invalid-target')

    // Add highlight to the source node if one is selected
    if (linkCreationSource) {
      const sourceNode = cy.getElementById(linkCreationSource.id)
      if (sourceNode.length > 0) {
        sourceNode.addClass('link-source')
      }

      // Mark nodes that can't be valid targets (events that occurred before
      // the source). The names say which is which, so that a comparison
      // between the two is recognisable as a causal-order comparison.
      const causeTimestamp = new Date(linkCreationSource.timestamp).getTime()

      // Guard against invalid timestamp
      if (isNaN(causeTimestamp)) {
        console.warn('[CausalGraph] Invalid source timestamp:', linkCreationSource.timestamp)
        return
      }

      nodes.forEach(node => {
        const nodeData = node.data() as CausalNodeData
        // Skip if node data is missing or if this is the source node
        if (!nodeData?.event || nodeData.event.id === linkCreationSource.id) {
          return
        }

        const effectTimestamp = new Date(nodeData.event.timestamp).getTime()

        // Skip if timestamp is invalid
        if (isNaN(effectTimestamp)) {
          console.warn('[CausalGraph] Invalid node timestamp:', nodeData.event.timestamp)
          return
        }

        // The rule the whole project uses: the cause may not follow the
        // effect, but it may happen at the same moment. A target at the
        // same moment is a valid effect.
        if (isTemporalInversion(causeTimestamp, effectTimestamp)) {
          node.addClass('invalid-target')
        }
      })
    }
  }, [linkCreationSource, isInitialized])

  // Dynamically update divergence point styling when divergenceEventIds prop changes
  useEffect(() => {
    if (!cyRef.current || !isInitialized) return
    const cy = cyRef.current
    cy.nodes().forEach(node => {
      if (divergenceEventIds && divergenceEventIds.includes(node.id())) {
        node.addClass('divergence-point')
      } else {
        node.removeClass('divergence-point')
      }
    })
  }, [divergenceEventIds, isInitialized])

  // Note: useImperativeHandle would be used with forwardRef for parent component access
  // For now, these methods can be accessed via ref if needed in the future

  // State for mobile sidebar visibility
  const [showMobileSidebar, setShowMobileSidebar] = useState(false)

  // Keyboard navigation and selection for causal graph nodes
  const handleGraphKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (events.length === 0) return

    const currentIndex = selectedEvents.length > 0
      ? events.findIndex(e => e.id === selectedEvents[0])
      : -1

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      const nextIndex = (currentIndex + 1) % events.length
      const nextEvent = events[nextIndex]
      if (nextEvent) {
        setSelectedEvents?.([nextEvent.id])
        onNodeClick?.(nextEvent)
      }
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      const prevIndex = currentIndex <= 0 ? events.length - 1 : currentIndex - 1
      const prevEvent = events[prevIndex]
      if (prevEvent) {
        setSelectedEvents?.([prevEvent.id])
        onNodeClick?.(prevEvent)
      }
    } else if (event.key === 'Enter' && currentIndex >= 0) {
      event.preventDefault()
      const activeEvent = events[currentIndex]
      if (activeEvent) {
        onNodeClick?.(activeEvent)
      }
    }
  }, [events, selectedEvents, setSelectedEvents, onNodeClick])

  return (
    <div className={`causal-graph-container relative flex flex-col lg:flex-row ${className}`}>
      {/* Mobile toggle button */}
      <button
        onClick={() => setShowMobileSidebar(!showMobileSidebar)}
        className="lg:hidden flex items-center justify-center gap-2 mb-2 px-3 py-2 bg-white rounded-lg shadow-sm border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50"
        aria-expanded={showMobileSidebar}
        aria-controls="graph-sidebar"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
        </svg>
        {showMobileSidebar ? 'Hide Controls' : 'Show Controls'}
      </button>

      {/* Left sidebar with controls - hidden on mobile unless toggled */}
      <div
        id="graph-sidebar"
        className={`flex flex-col space-y-4 lg:w-64 lg:mr-4 lg:flex-shrink-0 ${
          showMobileSidebar ? 'block mb-4' : 'hidden lg:flex'
        }`}
      >
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
          tabIndex={0}
          role="application"
          aria-label={`Causal graph with ${events.length} events and ${causalRelationships.length} causal relationships`}
          onKeyDown={handleGraphKeyDown}
          className="w-full h-full min-h-[400px] bg-gray-50 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
              events={events}
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
          <div className="absolute bottom-4 left-4 bg-blue-100 border border-blue-300 rounded-lg px-3 py-2 text-sm">
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

        {/* Node details tooltip */}
        {hoveredNode && nodeTooltipPosition && (
          <div
            className="absolute z-50 bg-white border border-gray-300 rounded-lg shadow-lg p-3 text-sm max-w-xs pointer-events-none"
            style={{
              left: nodeTooltipPosition.x + 10,
              top: nodeTooltipPosition.y - 10,
              transform: 'translate(0, -100%)'
            }}
          >
            <div className="font-semibold text-gray-800 mb-2">Event Details</div>
            <div className="space-y-1">
              <div>
                <span className="text-gray-600">Actor:</span>
                <span className="font-medium ml-2">{hoveredNode.actor}</span>
              </div>
              <div>
                <span className="text-gray-600">Target:</span>
                <span className="font-medium ml-2">{hoveredNode.target}</span>
              </div>
              <div className="mt-2 pt-2 border-t border-gray-200">
                <div className="text-gray-600 text-xs mb-1">Description:</div>
                <div className="text-gray-800 text-xs">{hoveredNode.description}</div>
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {new Date(hoveredNode.timestamp).toLocaleString()}
              </div>
            </div>
            {isCreatingLink && (
              <div className={`text-xs mt-2 pt-2 border-t border-gray-200 font-medium ${
                linkCreationSource && isTemporalInversion(
                  new Date(linkCreationSource.timestamp).getTime(),
                  new Date(hoveredNode.timestamp).getTime()
                )
                  ? 'text-gray-500'
                  : 'text-blue-600'
              }`}>
                {linkCreationSource
                  ? (isTemporalInversion(
                      new Date(linkCreationSource.timestamp).getTime(),
                      new Date(hoveredNode.timestamp).getTime()
                    )
                    ? 'Cannot link - this event occurs before the source'
                    : 'Click to create link to this event')
                  : 'Click to select as link source'}
              </div>
            )}
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
            {Boolean(hoveredRelationship.isCrossGraph || hoveredRelationship.effectGraphId || hoveredRelationship.causeGraphId) && (
              <div className="mb-2 px-2 py-0.5 rounded text-xs bg-purple-100 text-purple-800 font-medium inline-block">
                ⚡ Cross-Graph Reference {hoveredRelationship.effectGraphId ? `(${hoveredRelationship.effectGraphId.slice(0, 8)})` : ''}
              </div>
            )}
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
        <div className="absolute top-4 right-4 flex space-x-2" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleLinkCreationMode();
            }}
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
