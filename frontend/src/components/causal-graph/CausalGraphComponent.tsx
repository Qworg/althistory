import React, { useRef, useEffect, useState, useCallback, useId } from 'react'
import { shouldIgnoreAppShortcut } from '@/utils/keyboardShortcuts'
import cytoscape, { Core, NodeSingular, EdgeSingular, EventObject } from 'cytoscape'
import '@/utils/cytoscapeSetup' // Register layout extensions (dagre, cose-bilkent)
import { Event, CausalRelationship, CausalRelationshipData, CausalPath, CausalSuggestion, GraphCalendar } from '@/types'
import { useGlobalStore } from '@/stores/globalStore'
import { apiClient } from '@/services/api'
import {
  toCytoscapeLayoutOptions,
  mergeLayoutOptions,
  canvasStretch,
  CANVAS_STRETCH_LAYOUTS,
  DEFAULT_CAUSAL_LAYOUT,
  FIT_PADDING
} from '@/utils/layoutManagerUtils'
import { isCausalOrderValid, isTemporalInversion } from '@/utils/causalOrder'
import CausalPathHighlighter from './CausalPathHighlighter'
import { computeRipple, computeReach } from '@/components/timeline/timelineLinks'
import CausalChainNavigationControls from './CausalChainNavigationControls'
import CausalSuggestionManager from './CausalSuggestionManager'
import CausalSuggestionOverlay from './CausalSuggestionOverlay'
import { CausalGraphLayoutManager } from './CausalGraphLayoutManager'
import { CausalGraphOverview } from './CausalGraphOverview'
import { CausalGraphPerformanceManager } from './CausalGraphPerformanceManager'
import useCausalPathExploration from '@/hooks/useCausalPathExploration'
import useCausalSuggestions from '@/hooks/useCausalSuggestions'
import { CausalRelationshipModal } from '@/components/modals/CausalRelationshipModal'
import { formatEventDate } from '@/utils/historicalTime'
import {
  eventNodeLabel,
  eventNodeCanvasLabel,
  hoverReadoutPlacement,
  formatActorTarget,
  describeEvent,
  readGraphCanvasTheme,
  nodeLabelSizing,
  pickVisibleLabels,
  RELATIONSHIP_LINE_STYLES,
  type GraphCanvasTheme,
  type LabelBox
} from './causalGraphPresentation'
import { buildCausalGraphStylesheet, GRAPH_STYLESHEET_REPLACED_EVENT } from './causalGraphStylesheet'

export interface CausalGraphComponentProps {
  className?: string
  /**
   * Sizing for the graph canvas itself. Defaults to filling its parent
   * (`h-full`); a page that is not height-constrained passes a viewport-based
   * height so the canvas neither collapses nor runs off the screen.
   */
  canvasClassName?: string
  /**
   * The canvas's least height (px). 400 by default; an embedding that sizes
   * the canvas itself (the comparison's tab) passes less, or the canvas ran
   * past its box and the fit put the lowest events below the visible edge.
   */
  canvasMinHeight?: number
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
  /**
   * Events and links (by id) that only the branch has, drawn in the
   * divergence amber: the comparison's causal tab is a diff, not a picture
   * of the branch alone.
   */
  branchAddedIds?: string[]
  /**
   * View-only graph (e.g. the Compare dialog): hides Draw Link, Explore
   * Paths and Suggest Links, ignores the D shortcut, and opens no edit
   * affordance (no right-click edit, no relationship form).
   */
  readOnly?: boolean
  /**
   * The world calendar the graph's dates read in, when it is not the open
   * graph (the Compare dialog shows a branch); left out, the open graph's.
   */
  calendar?: GraphCalendar | null
}

/** Past this many events or links the graph needs its level-of-detail controls. */
export const PERFORMANCE_PANEL_THRESHOLD = 500
/** Events at which the overview map starts to earn its place beside the canvas. */
export const OVERVIEW_THRESHOLD = 40

export interface CausalNodeData {
  id: string
  event: Event
  label: string
  /** 0–1: the node's reach relative to the graph's furthest-reaching event. Drawn as size. */
  weight: number
  /** How many events this one sets in motion (the timeline's reach). */
  reach?: number
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
  /** The relationship type, which the stylesheet draws as colour and line style. */
  relationshipType: CausalRelationship['relationship_type']
  weight: number
  label: string
  isSelected: boolean
  isHighlighted: boolean
  isCrossGraph?: boolean
  crossGraphLabel?: string
}

export const CausalGraphComponent: React.FC<CausalGraphComponentProps> = ({
  className = '',
  canvasClassName = 'h-full',
  canvasMinHeight = 400,
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
  divergenceEventIds,
  branchAddedIds,
  readOnly = false,
  calendar
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)
  const [isInitialized, setIsInitialized] = useState(false)
  const [isCreatingLink, setIsCreatingLink] = useState(false)
  const [linkCreationSource, setLinkCreationSource] = useState<Event | null>(null)

  // Refs to hold current state values for event handlers (fixes closure stale state bug)
  const isCreatingLinkRef = useRef(isCreatingLink)
  const linkCreationSourceRef = useRef(linkCreationSource)
  const readOnlyRef = useRef(readOnly)
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

  const toolHintId = useId()
  // The event the Explore Paths / Suggest Links tools act on: the node tapped
  // (or keyboard-selected) last, else the focused event.
  const [toolTargetId, setToolTargetId] = useState<string | null>(null)
  // Which analysis overlay is open. Only one is open at a time.
  const [activeTool, setActiveTool] = useState<'paths' | 'suggestions' | null>(null)
  // A cause/effect pair drawn on the canvas, awaiting the relationship form.
  const [pendingLink, setPendingLink] = useState<{ cause: Event; effect: Event } | null>(null)
  // The resolved theme the canvas is drawn with (the legend draws its swatches from it)
  const [graphTheme, setGraphTheme] = useState<GraphCanvasTheme>(() => readGraphCanvasTheme())
  
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
    isCreatingLinkRef.current = isCreatingLink
  }, [isCreatingLink])

  useEffect(() => {
    linkCreationSourceRef.current = linkCreationSource
  }, [linkCreationSource])

  useEffect(() => {
    readOnlyRef.current = readOnly
  }, [readOnly])

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

  // Whether cause -> effect may be linked: the cause must not follow the
  // effect, and the pair must not already be linked. Reports why not.
  const checkLinkCandidate = useCallback((causeEvent: Event, effectEvent: Event): boolean => {
    if (!validateTemporalOrdering(causeEvent, effectEvent)) {
      addError({
        message: 'Cause event must occur before or at the same time as effect event',
        type: 'validation'
      })
      return false
    }

    const existingRelationship = causalRelationships.find(rel =>
      rel.cause_event_id === causeEvent.id && rel.effect_event_id === effectEvent.id
    )
    if (existingRelationship) {
      addError({
        message: 'Causal relationship already exists between these events',
        type: 'validation'
      })
      return false
    }
    return true
  }, [validateTemporalOrdering, causalRelationships, addError])

  // The Cytoscape handlers are bound once, on mount; they reach the current
  // validation (and its current relationship list) through this ref.
  const checkLinkCandidateRef = useRef(checkLinkCandidate)
  useEffect(() => {
    checkLinkCandidateRef.current = checkLinkCandidate
  }, [checkLinkCandidate])

  // Create causal relationship with validation
  const createCausalRelationship = useCallback(async (
    causeEvent: Event,
    effectEvent: Event,
    relationshipData: CausalRelationshipData
  ) => {
    try {
      if (!checkLinkCandidate(causeEvent, effectEvent)) return

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
  }, [checkLinkCandidate, addCausalRelationship, addError, onCausalLinkCreate])

  const initializeCytoscape = useCallback(() => {
    if (!containerRef.current || cyRef.current) return

    // Read session data from store (not from closure) to get current layout preference
    const currentSessionData = useGlobalStore.getState().sessionData
    const savedLayout = currentSessionData.viewportState.causalGraph.layout || DEFAULT_CAUSAL_LAYOUT

    // Set initialized to true immediately for testing
    setIsInitialized(true)

    // Cytoscape draws on a canvas and cannot read CSS variables: resolve the
    // theme tokens now (and again whenever the theme changes, below).
    const theme = readGraphCanvasTheme()

    const cy = cytoscape({
      container: containerRef.current,

      style: buildCausalGraphStylesheet(theme),

      // The same tuned options the layout panel uses (layoutManagerUtils)
      layout: toCytoscapeLayoutOptions(mergeLayoutOptions(savedLayout, { animationDuration: 500 })),
      
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

      if (currentIsCreatingLink) {
        if (currentLinkCreationSource) {
          // Check if target is a valid effect (must not occur before the cause).
          // Invalid targets are greyed out, so a click on one is ignored.
          if (node.hasClass('invalid-target')) {
            return
          }

          // Picking the effect does not save anything: it opens the
          // relationship form, prefilled with the cause and effect, so the
          // weight, type and evidence are the user's choice rather than
          // hardcoded defaults.
          if (
            currentLinkCreationSource.id !== nodeData.event.id &&
            checkLinkCandidateRef.current(currentLinkCreationSource, nodeData.event)
          ) {
            setPendingLink({ cause: currentLinkCreationSource, effect: nodeData.event })
          }

          // Reset link creation state
          setIsCreatingLink(false)
          setLinkCreationSource(null)
        } else {
          // Selecting the source re-renders the graph; guard against a tap the
          // re-render emits in this same task cancelling the interaction.
          armBackgroundTapGuard()
          setLinkCreationSource(nodeData.event)
        }
      } else {
        // A tap selects and inspects the node. Path exploration and link
        // suggestions are opt-in tools (the Explore Paths / Suggest Links
        // buttons), which act on the node tapped last.
        setToolTargetId(nodeData.event.id)
        onNodeClick?.(nodeData.event)
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
      } else if (!readOnlyRef.current) {
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
      if (backgroundTapGuardRef.current) return
      setIsCreatingLink(false)
      setLinkCreationSource(null)
    })

    // Keep node labels readable at the zoom the graph is actually viewed at
    // (see nodeLabelSizing). Coalesced to one restyle per frame.
    let labelPending = false
    const scheduleLabelSizing = () => {
      if (labelPending) return
      labelPending = true
      const run = () => {
        labelPending = false
        if (cy.destroyed?.()) return
        const zoom = cy.zoom()
        const sizing = nodeLabelSizing(zoom)
        cy.batch(() => {
          cy.nodes().style(sizing)
        })
        // Then hide labels that would overprint a more important one (see
        // pickVisibleLabels). Boxes are read after the sizing above applies.
        const boxes: LabelBox[] = []
        const bodies: Array<{ id: string; box: LabelBox['box'] }> = []
        const measured: NodeSingular[] = []
        cy.nodes().forEach(node => {
          if (typeof node.boundingBox !== 'function') return
          measured.push(node)
          const bb = node.boundingBox({ includeNodes: false, includeEdges: false, includeLabels: true })
          const body = node.boundingBox({ includeNodes: true, includeEdges: false, includeLabels: false })
          boxes.push({
            id: node.id(),
            // Selected first, then the traced ripple, then the further-reaching
            // events keep their names.
            priority:
              (node.selected() ? 10_000 : 0) +
              (node.hasClass?.('ripple') ? 5_000 : 0) +
              (node.hasClass?.('ripple-faded') ? -5_000 : 0) +
              (Number(node.data('reach')) || 0) * 10 +
              node.degree(false),
            box: { x1: bb.x1, y1: bb.y1, x2: bb.x2, y2: bb.y2 }
          })
          if (body && Number.isFinite(body.x1)) bodies.push({ id: node.id(), box: { x1: body.x1, y1: body.y1, x2: body.x2, y2: body.y2 } })
        })
        const visible = pickVisibleLabels(boxes, 3 / (zoom > 0 ? zoom : 1), bodies)
        cy.batch(() => {
          measured.forEach(node => {
            if (visible.has(node.id())) node.removeClass('label-culled')
            else node.addClass('label-culled')
          })
        })
      }
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(run)
      } else {
        run()
      }
    }
    cy.on('zoom', scheduleLabelSizing)
    cy.on('add', 'node', scheduleLabelSizing)
    // Moving a node or changing the selection changes which labels collide
    cy.on('dragfree select unselect', 'node', scheduleLabelSizing)
    scheduleLabelSizing()

    // Save layout positions when they change, then frame the result. An
    // animated layout can end with nodes outside the viewport it fitted at
    // its start (the container may have been resized meanwhile), so the graph
    // is refitted once it has settled.
    cy.on('layoutstop', (event?: EventObject) => {
      // A force layout settles into a round cloud; spread it to the canvas's
      // aspect first, so the fit below fills the canvas rather than its middle.
      const layoutName = (event?.layout as { options?: { name?: string } } | undefined)?.options?.name
        ?? useGlobalStore.getState().sessionData.viewportState.causalGraph.layout
        ?? 'cose'
      if (CANVAS_STRETCH_LAYOUTS.includes(layoutName)) stretchToCanvas(cy)
      scheduleLabelSizing()
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
      if (cy.nodes().length === 0) return
      cy.fit(undefined, FIT_PADDING)
    })

    cyRef.current = cy
  }, [
    onNodeClick, onNodeHover, onEdgeClick, onEdgeHover, updateSessionData,
    onNodeContextMenu, onRelationshipContextMenu, onRelationshipEdit, armBackgroundTapGuard
  ])


  // Transform data for Cytoscape
  // NOTE: linkCreationSource is intentionally NOT a dependency here to prevent
  // graph rebuilds when selecting link source (which causes spurious background taps)
  const transformDataForCytoscape = useCallback(() => {
    const eventMap = new Map(events.map(event => [event.id, event]))
    // Size by reach, as the timeline does, so the same events stand out in
    // both lenses before anything is selected.
    const reach = computeReach(
      causalRelationships.map(r => ({
        id: r.id,
        causeId: r.cause_event_id,
        effectId: r.effect_event_id,
        type: r.relationship_type,
        weight: r.weight,
      }))
    )
    const maxReach = Math.max(0, ...reach.values())
    const nodes: CausalNodeData[] = events.map(event => ({
      id: event.id,
      event,
      label: eventNodeCanvasLabel(event, calendar),
      reach: reach.get(event.id) ?? 0,
      weight: maxReach > 0 ? Math.pow((reach.get(event.id) ?? 0) / maxReach, 0.75) : 0.5,
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
        relationshipType: relationship.relationship_type,
        weight: relationship.weight,
        label: `W: ${relationship.weight.toFixed(2)} | C: ${relationship.confidence.toFixed(2)}`,
        isSelected: false,
        isHighlighted: false,
        isCrossGraph: isCross,
        crossGraphLabel
      }
    })

    return { nodes, edges }
  }, [events, causalRelationships, selectedEvents, divergenceEventIds, calendar]) // linkCreationSource removed

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
      if (branchAddedIds?.includes(node.id)) classes.push('branch-added')
      return {
        data: node,
        classes: classes.length > 0 ? classes.join(' ') : undefined,
        position: causalGraphState.nodePositions[node.id] || undefined
      }
    })

    // Add edges
    const cyEdges = edges.map(edge => {
      const classes = [edge.isCrossGraph ? 'cross-graph' : '', branchAddedIds?.includes(edge.id) ? 'branch-added' : '']
        .filter(Boolean)
        .join(' ')
      return { data: edge, classes: classes || undefined }
    })

    cyRef.current.add([...cyNodes, ...cyEdges])

    // Apply layout if no saved positions
    const hasPositions = nodes.some(node =>
      causalGraphState.nodePositions[node.id]
    )

    if (!hasPositions) {
      cyRef.current.layout(toCytoscapeLayoutOptions(
        mergeLayoutOptions(causalGraphState.layout || DEFAULT_CAUSAL_LAYOUT, { animationDuration: 500 })
      )).run()
    } else {
      cyRef.current.fit(undefined, FIT_PADDING)
    }

    // Update selection state
    cyRef.current.nodes().forEach(node => {
      const nodeData = node.data() as CausalNodeData
      if (nodeData.isSelected) {
        node.select()
      }
    })
  }, [isInitialized, transformDataForCytoscape, armBackgroundTapGuard, divergenceEventIds, branchAddedIds]) // Removed sessionData dependency to break update cycle

  // Focus on specific event
  const focusOnEvent = useCallback((eventId: string) => {
    if (!cyRef.current || !isInitialized) return

    const cy = cyRef.current
    const node = cy.getElementById(eventId)
    if (node.length > 0) {
      // The zoom is the user's: selecting an event keeps it, and pans only
      // when the event is out of view. (Jumping to a fixed zoom on every
      // click threw away the overview the user had framed.)
      const extent = cy.extent()
      const p = node.position()
      const margin = 40 / cy.zoom()
      const inView =
        p.x > extent.x1 + margin && p.x < extent.x2 - margin && p.y > extent.y1 + margin && p.y < extent.y2 - margin
      if (!inView) cy.animate({ center: { eles: node } }, { duration: 300 })
      node.select()
    }
  }, [isInitialized])

  // The ripple of the focused event, as on the timeline: its direct causes
  // and what it sets in motion up to RIPPLE_DEPTH steps on stay at full
  // strength; everything else fades back.
  const applyRipple = useCallback((eventId: string | null) => {
    const cy = cyRef.current
    if (!cy || !isInitialized) return
    cy.batch(() => {
      cy.elements().removeClass('ripple ripple-faded')
      if (!eventId) return
      const links = cy.edges().map(edge => ({
        id: edge.id(),
        causeId: String(edge.data('source')),
        effectId: String(edge.data('target')),
        type: 'direct' as const,
        weight: 0,
      }))
      const ripple = computeRipple(eventId, links)
      if (ripple.links.size === 0) return
      const keep = new Set<string>([eventId, ...ripple.causes, ...ripple.effects.keys(), ...ripple.links.keys()])
      cy.elements().forEach(element => {
        element.addClass(keep.has(element.id()) ? 'ripple' : 'ripple-faded')
      })
    })
  }, [isInitialized])


  // The pair Draw Link links straight away when exactly two events of this
  // graph are selected: the earlier is the cause (on a tie, the one selected
  // first).
  const selectedPair = React.useMemo<{ cause: Event; effect: Event } | null>(() => {
    if (selectedEvents.length !== 2) return null
    const first = events.find(e => e.id === selectedEvents[0])
    const second = events.find(e => e.id === selectedEvents[1])
    if (!first || !second || first.id === second.id) return null
    return isTemporalInversion(new Date(first.timestamp).getTime(), new Date(second.timestamp).getTime())
      ? { cause: second, effect: first }
      : { cause: first, effect: second }
  }, [selectedEvents, events])

  // Draw Link: the single way to make a link. With two events selected it
  // opens the relationship form for that pair; otherwise it toggles the
  // click-the-cause-then-the-effect mode.
  const toggleLinkCreationMode = useCallback(() => {
    if (readOnly) return
    // Entering (or leaving) link mode re-renders; ignore a background tap emitted
    // in this same task so it cannot immediately cancel the mode just entered.
    armBackgroundTapGuard()
    if (!isCreatingLink && selectedPair) {
      if (checkLinkCandidate(selectedPair.cause, selectedPair.effect)) {
        setPendingLink(selectedPair)
      }
      return
    }
    setIsCreatingLink(prev => !prev)
    setLinkCreationSource(null)
  }, [readOnly, armBackgroundTapGuard, isCreatingLink, selectedPair, checkLinkCandidate])

  // Cancel link creation
  const cancelLinkCreation = useCallback(() => {
    setIsCreatingLink(false)
    setLinkCreationSource(null)
  }, [])

  // A graph made read-only mid-drawing leaves the drawing mode
  useEffect(() => {
    if (!readOnly) return
    setIsCreatingLink(false)
    setLinkCreationSource(null)
    setActiveTool(null)
  }, [readOnly])

  // The analysis tools act on a real event of this graph (not a foreign or
  // broken-reference placeholder).
  const toolTargetEvent = React.useMemo<Event | null>(() => {
    const id = toolTargetId ?? focusEventId ?? selectedEvents[0] ?? null
    if (!id) return null
    return events.find(e => e.id === id) ?? null
  }, [toolTargetId, focusEventId, selectedEvents, events])
  const toolTargetEventId = toolTargetEvent?.id ?? null

  const closeTool = useCallback(() => {
    if (activeTool === 'paths' || navigationState.isNavigating) {
      stopExploration()
    }
    setActiveTool(null)
  }, [activeTool, navigationState.isNavigating, stopExploration])

  const toggleTool = useCallback((tool: 'paths' | 'suggestions') => {
    if (activeTool === tool) {
      closeTool()
      return
    }
    if (!toolTargetEventId) return
    // Opening one tool closes the other.
    if (activeTool === 'paths') stopExploration()
    setActiveTool(tool)
  }, [activeTool, closeTool, toolTargetEventId, stopExploration])

  // Run the open tool against its target, and re-run it when the target
  // changes (tapping another node while a tool is open retargets it). The
  // hook functions are read through a ref so their identity does not re-run it.
  const toolRunnersRef = useRef({ startExploration, loadSuggestions })
  useEffect(() => {
    toolRunnersRef.current = { startExploration, loadSuggestions }
  }, [startExploration, loadSuggestions])
  useEffect(() => {
    if (!activeTool) return
    if (!toolTargetEventId) {
      setActiveTool(null)
      return
    }
    if (activeTool === 'paths') {
      void toolRunnersRef.current.startExploration(toolTargetEventId)
    } else {
      void toolRunnersRef.current.loadSuggestions(toolTargetEventId)
    }
  }, [activeTool, toolTargetEventId])

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!isInitialized) return
    // Not while typing, composing, or with a modal dialog open (including the
    // relationship form Draw Link opens)
    if (shouldIgnoreAppShortcut(event)) return

    switch (event.key) {
      // D is Draw Link (a bare key; Ctrl+C is left to copy). Not on a
      // read-only graph.
      case 'd':
      case 'D':
        if (!readOnly && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
          event.preventDefault()
          toggleLinkCreationMode()
        }
        break
      case 'Escape':
        if (isCreatingLink) {
          event.preventDefault()
          cancelLinkCreation()
        } else if (activeTool || navigationState.isNavigating) {
          event.preventDefault()
          closeTool()
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
  }, [isInitialized, readOnly, isCreatingLink, activeTool, navigationState.isNavigating, toggleLinkCreationMode, cancelLinkCreation, closeTool, nextStep, previousStep, nextPath, previousPath, toggleAutoAdvance])

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

  // Keep the canvas sized to its container, and the graph framed in it.
  // Cytoscape measures its container once; when the container changes size
  // (first paint, a window resize, the controls column appearing) it went on
  // drawing for the old size, so the fitted graph spilled off one edge and left
  // the other empty. jsdom has no real ResizeObserver, hence the guard.
  useEffect(() => {
    const container = containerRef.current
    if (!isInitialized || !container || typeof ResizeObserver === 'undefined') return

    let frame: number | null = null
    let lastSize: { width: number; height: number } | null = null

    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect
      if (!rect || rect.width === 0 || rect.height === 0) return // hidden
      if (lastSize && lastSize.width === rect.width && lastSize.height === rect.height) return
      lastSize = { width: rect.width, height: rect.height }

      if (frame !== null) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = null
        const cy = cyRef.current
        if (!cy) return
        cy.resize()
        if (cy.nodes().length > 0) cy.fit(undefined, FIT_PADDING)
      })
    })
    observer.observe(container)

    return () => {
      observer.disconnect()
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [isInitialized])

  // Follow the theme. Every canvas colour is concrete, so a change of the
  // classes on <html> -- .dark, .high-contrast, or both -- re-reads the theme
  // and, when it changed, replaces the whole stylesheet: nodes, edges, states
  // and labels all follow, not only the label text.
  useEffect(() => {
    if (!isInitialized || typeof MutationObserver === 'undefined') return

    let applied = JSON.stringify(readGraphCanvasTheme())
    const observer = new MutationObserver(() => {
      const cy = cyRef.current
      if (!cy) return
      const theme = readGraphCanvasTheme()
      const key = JSON.stringify(theme)
      if (key === applied) return
      applied = key
      cy.style(buildCausalGraphStylesheet(theme))
      if (typeof cy.emit === 'function') cy.emit(GRAPH_STYLESHEET_REPLACED_EVENT)
      setGraphTheme(theme)
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [isInitialized])

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
      // Focusing centres and selects the event; it does not open the path or
      // suggestion tools, which the user opens explicitly.
      focusOnEvent(focusEventId)
      setToolTargetId(focusEventId)
    } else if (!focusEventId && isInitialized) {
      // The view cleared its selection (Escape, a delete): drop the canvas's
      // selection ring too, so the two agree.
      cyRef.current?.$('node:selected').unselect()
      setToolTargetId(null)
    }
  }, [focusEventId, focusOnEvent, isInitialized])

  // Re-applied when the graph's elements are rebuilt, so the trace survives
  // a data refresh.
  useEffect(() => {
    applyRipple(focusEventId ?? null)
  }, [focusEventId, applyRipple, events, causalRelationships])

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
  const layoutTriggerRef = useRef<HTMLButtonElement>(null)
  const layoutPanelRef = useRef<HTMLDivElement>(null)

  // The Layout panel behaves as a popover: focus moves into it when it opens
  // (to the chosen layout), Escape anywhere closes it and returns focus to
  // its button, and a press outside it closes it. It stayed open over a
  // quarter of the graph through canvas clicks and node selections.
  useEffect(() => {
    if (!showMobileSidebar) return
    const panel = layoutPanelRef.current
    const first =
      panel?.querySelector<HTMLElement>('[aria-pressed="true"], [aria-checked="true"]') ??
      panel?.querySelector<HTMLElement>('button:not([disabled])') ??
      panel
    first?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      setShowMobileSidebar(false)
      layoutTriggerRef.current?.focus()
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && (panel?.contains(target) || layoutTriggerRef.current?.contains(target))) return
      setShowMobileSidebar(false)
    }
    // Capture, so this runs before the canvas's own Escape and taps.
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [showMobileSidebar])

  const nodeTooltipId = useId()

  // The event keyboard navigation last moved to, announced in full.
  const [keyboardEventId, setKeyboardEventId] = useState<string | null>(null)
  const keyboardEvent = React.useMemo(
    () => (keyboardEventId ? events.find(e => e.id === keyboardEventId) ?? null : null),
    [keyboardEventId, events]
  )

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
        setToolTargetId(nextEvent.id)
        setKeyboardEventId(nextEvent.id)
        setSelectedEvents?.([nextEvent.id])
        onNodeClick?.(nextEvent)
      }
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      const prevIndex = currentIndex <= 0 ? events.length - 1 : currentIndex - 1
      const prevEvent = events[prevIndex]
      if (prevEvent) {
        setToolTargetId(prevEvent.id)
        setKeyboardEventId(prevEvent.id)
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

  // The canvas's size, for placing the hover readout (see hoverReadoutPlacement).
  const canvasSize = () => ({
    width: containerRef.current?.clientWidth ?? 0,
    height: containerRef.current?.clientHeight ?? 0,
  })

  return (
    <div className={`causal-graph-container relative flex flex-col ${className}`}>
      {/* The layout and overview controls open over the canvas from this
          button at every width. As a column of their own they took ~270px,
          and beside the inspector left the graph about 40% of the window. The
          panel stays mounted while closed so its layout keys (9, 1, 6) work. */}
      <button
        ref={layoutTriggerRef}
        type="button"
        onClick={() => setShowMobileSidebar(!showMobileSidebar)}
        className="self-start flex items-center justify-center gap-2 mb-2 px-3 py-1.5 bg-card rounded-md border border-line text-sm font-medium text-ink-secondary hover:bg-subtle hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-selected"
        aria-expanded={showMobileSidebar}
        aria-controls="graph-sidebar"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
        </svg>
        Layout
        <svg className={`w-3.5 h-3.5 transition-transform ${showMobileSidebar ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <div
        ref={layoutPanelRef}
        tabIndex={-1}
        id="graph-sidebar"
        role="group"
        aria-label="Graph layout"
        className={`absolute left-0 top-11 z-30 w-[min(20rem,calc(100%-1rem))] max-h-[min(36rem,calc(100%-3rem))] overflow-y-auto rounded-lg border border-line bg-card p-4 shadow-lg flex-col divide-y divide-line [&>*]:py-4 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0 ${
          showMobileSidebar ? 'flex' : 'hidden'
        }`}
      >
        {/* Layout Manager */}
        {showLayoutManager && (
          <CausalGraphLayoutManager
            cytoscapeInstance={cyRef.current}
            // The panel runs the layout and records it itself; the canvas
            // only passes the news on (running it again here ran every
            // chosen layout twice)
            onLayoutChange={onLayoutChange}
            showLayoutPreview={true}
          />
        )}

        {/* Overview. A small graph fits the canvas whole (and F refits it),
            so below OVERVIEW_THRESHOLD events a map of it only repeated the
            canvas beside it and took width the graph needed. */}
        {showOverview && events.length >= OVERVIEW_THRESHOLD && (
          <CausalGraphOverview
            mainCytoscapeInstance={cyRef.current}
            events={events}
            causalRelationships={causalRelationships}
            showMinimap={true}
            enableNavigation={true}
          />
        )}

        {/* Performance Manager. Its level-of-detail switches act only past
            PERFORMANCE_PANEL_THRESHOLD events or links, so below that it had
            nothing to offer and only took room from the graph. */}
        {showPerformanceManager &&
          (events.length > PERFORMANCE_PANEL_THRESHOLD ||
            causalRelationships.length > PERFORMANCE_PANEL_THRESHOLD) && (
          <CausalGraphPerformanceManager
            cytoscapeInstance={cyRef.current}
            events={events}
            causalRelationships={causalRelationships}
            enableOptimizations={enablePerformanceOptimizations}
            maxNodes={1000}
            maxEdges={2000}
            levelOfDetailThreshold={PERFORMANCE_PANEL_THRESHOLD}
          />
        )}
      </div>

      {/* Main graph area. min-h-0: a flex item's minimum height is its
          content's, and the canvas sizes itself from this box, so without it
          the two grew each other (the comparison's preview reached 3700px). */}
      <div className="flex-1 min-h-0 relative">
        <div
          ref={containerRef}
          tabIndex={0}
          role="application"
          aria-label={`Causal graph with ${events.length} events and ${causalRelationships.length} causal relationships`}
          aria-describedby={hoveredNode ? nodeTooltipId : undefined}
          onKeyDown={handleGraphKeyDown}
          className={`w-full ${canvasClassName} bg-canvas rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-selected`}
          style={{ minHeight: `${canvasMinHeight}px` }}
        />

        {/* The canvas draws nodes, not DOM: announce the event the keyboard
            moves to, in full, the way the hover tooltip shows it. */}
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {keyboardEvent ? describeEvent(keyboardEvent, calendar) : ''}
        </p>

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

        {/* Suggestion Overlay: suggested edges are drawn only while Suggest Links is open */}
        {enableSuggestions && (
          <CausalSuggestionOverlay
            cytoscapeInstance={cyRef.current}
            suggestions={activeTool === 'suggestions' ? suggestions : NO_SUGGESTIONS}
            showConfidenceLabels={true}
            animateSuggestions={true}
          />
        )}

        {/* Path Navigation panel (Explore Paths) */}
        {enablePathExploration && showNavigationControls && activeTool === 'paths' && !pathExplorationLoading && (
          <div className="absolute top-14 right-4 z-20 w-80 max-w-[calc(100%-2rem)] max-h-96 overflow-y-auto">
            {navigationState.isNavigating ? (
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
                onStopNavigation={closeTool}
              />
            ) : (
              <ToolEmptyState onClose={closeTool}>
                No causal paths lead on from this event.
              </ToolEmptyState>
            )}
          </div>
        )}

        {/* Suggestion Manager panel (Suggest Links) */}
        {enableSuggestions && showSuggestionManager && activeTool === 'suggestions' && toolTargetEventId && !suggestionsLoading && (
          <div className="absolute top-14 right-4 z-20 w-96 max-w-[calc(100%-2rem)] max-h-96 overflow-y-auto">
            {suggestions.length > 0 ? (
              <CausalSuggestionManager
                focusEventId={toolTargetEventId}
                onSuggestionAccept={(suggestion) => {
                  // Convert CausalSuggestion back to SuggestionWithState for hook
                  acceptSuggestion({ ...suggestion, isVisible: true, isProcessing: false })
                  onSuggestionAccept?.(suggestion)
                }}
                onSuggestionReject={(suggestion) => {
                  rejectSuggestion({ ...suggestion, isVisible: true, isProcessing: false })
                  onSuggestionReject?.(suggestion)
                }}
                onSuggestionFeedback={(suggestion, feedback) => {
                  addFeedback({ ...suggestion, isVisible: true, isProcessing: false }, feedback)
                }}
                maxSuggestions={5}
              />
            ) : (
              <ToolEmptyState onClose={closeTool}>
                No suggested links for this event.
              </ToolEmptyState>
            )}
          </div>
        )}

        {/* Draw Link instructions, on the canvas for as long as the mode is on */}
        {isCreatingLink && (
          <div
            className="absolute top-4 left-4 z-20 max-w-[calc(50%-1.5rem)] bg-card border border-selected rounded-md px-3 py-2 text-sm shadow-sm"
            role="status"
          >
            <p className="flex items-start gap-2 text-ink">
              <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-selected" aria-hidden="true" />
              <span>
                <span className="font-semibold">
                  {linkCreationSource
                    ? `Cause: “${eventNodeLabel(linkCreationSource)}”. Now click the effect`
                    : 'Click the cause, then the effect'}
                </span>
                <span className="text-ink-secondary"> · Esc to cancel</span>
              </span>
            </p>
          </div>
        )}

        {/* Legend: the link type is drawn as a line style as well as a colour.
            A row under the canvas, not an overlay on it: overlaid, it covered
            the nodes the fit placed near the bottom edge. */}
        <div
          role="note"
          aria-label="Legend"
          className="mt-2 px-1 text-xs text-ink-secondary"
        >
          <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {(Object.keys(RELATIONSHIP_LINE_STYLES) as (keyof typeof RELATIONSHIP_LINE_STYLES)[]).map(type => {
              const line = RELATIONSHIP_LINE_STYLES[type]
              return (
                <li key={type} className="flex items-center gap-1.5">
                  <svg width="26" height="8" viewBox="0 0 26 8" aria-hidden="true" className="flex-shrink-0">
                    <line
                      x1="2" y1="4" x2="24" y2="4"
                      stroke={graphTheme.colors[line.paletteKey]}
                      strokeWidth="2.5"
                      strokeLinecap={line.cap}
                      strokeDasharray={line.dash ? line.dash.map(n => n * 0.6).join(' ') : undefined}
                    />
                  </svg>
                  <span>{line.label.toLowerCase()} ({line.pattern})</span>
                </li>
              )
            })}
            <li>thicker = stronger</li>
            {divergenceEventIds && divergenceEventIds.length > 0 && (
              <li className="flex items-center gap-1.5">
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className="flex-shrink-0">
                  <path d="M5 0.5 9.5 5 5 9.5 0.5 5Z" fill={graphTheme.colors.divergenceFill} />
                </svg>
                <span>Point of divergence</span>
              </li>
            )}
          </ul>
        </div>

        {/* Node details tooltip: the full description the label shortens,
            who acted on whom, and when. */}
        {hoveredNode && nodeTooltipPosition && (
          <div
            id={nodeTooltipId}
            role="tooltip"
            className="absolute z-50 bg-card border border-line rounded-lg shadow-lg p-3 text-sm text-ink max-w-xs pointer-events-none"
            style={hoverReadoutPlacement(nodeTooltipPosition, canvasSize())}
          >
            <p className="font-semibold text-ink leading-snug">
              {hoveredNode.description || formatActorTarget(hoveredNode)}
            </p>
            {formatActorTarget(hoveredNode) && (
              <p className="mt-1 text-ink-secondary">{formatActorTarget(hoveredNode)}</p>
            )}
            <p className="mt-1 text-xs text-ink-secondary font-mono-code">
              {formatEventDate(hoveredNode, undefined, calendar)}
            </p>
            {isCreatingLink && (
              <div className={`text-xs mt-2 pt-2 border-t border-line font-medium ${
                linkCreationSource && isTemporalInversion(
                  new Date(linkCreationSource.timestamp).getTime(),
                  new Date(hoveredNode.timestamp).getTime()
                )
                  ? 'text-ink-muted'
                  : 'text-selected'
              }`}>
                {linkCreationSource
                  ? (isTemporalInversion(
                      new Date(linkCreationSource.timestamp).getTime(),
                      new Date(hoveredNode.timestamp).getTime()
                    )
                    ? 'Cannot link - this event occurs before the source'
                    : 'Click to make this the effect'
                  )
                  : 'Click to make this the cause'}
              </div>
            )}
          </div>
        )}

        {/* Relationship details tooltip */}
        {hoveredRelationship && tooltipPosition && (
          <div
            className="absolute z-50 bg-card border border-line rounded-lg shadow-lg p-3 text-sm text-ink max-w-xs pointer-events-none"
            style={hoverReadoutPlacement(tooltipPosition, canvasSize())}
          >
            <div className="font-semibold text-ink mb-2">Causal Relationship</div>
            {Boolean(hoveredRelationship.isCrossGraph || hoveredRelationship.effectGraphId || hoveredRelationship.causeGraphId) && (
              <div className="mb-2 px-2 py-0.5 rounded text-xs bg-purple-100 text-purple-800 font-medium inline-block">
                ⚡ Cross-Graph Reference {hoveredRelationship.effectGraphId ? `(${hoveredRelationship.effectGraphId.slice(0, 8)})` : ''}
              </div>
            )}
            <div className="space-y-1">
              <div className="flex justify-between">
                <span className="text-ink-muted">Weight:</span>
                <span className="font-medium font-mono-code">{hoveredRelationship.weight.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-muted">Confidence:</span>
                <span className="font-medium font-mono-code">{hoveredRelationship.confidence.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-muted">Type:</span>
                <span className="font-medium capitalize">{hoveredRelationship.relationship_type}</span>
              </div>
              {hoveredRelationship.evidence && (
                <div className="mt-2 pt-2 border-t border-line">
                  <div className="text-ink-muted text-xs mb-1">Evidence:</div>
                  <div className="text-ink-secondary text-xs">{hoveredRelationship.evidence}</div>
                </div>
              )}
            </div>
            {!readOnly && (
              <div className="text-xs text-ink-muted mt-2 pt-2 border-t border-line">
                Right-click to edit
              </div>
            )}
          </div>
        )}

        {/* Canvas controls */}
        <div
          className="absolute top-4 right-4 z-20 flex flex-wrap justify-end gap-1.5"
          role="group"
          aria-label="Graph tools"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Said on screen, not only in a tooltip: the two tools act on a
              selected event, and without one they look switched off. */}
          {!readOnly && !toolTargetEvent && (enablePathExploration || enableSuggestions) && (
            // Plain text, not a pill: as a rounded chip beside the buttons it
            // read as one more button.
            <span id={toolHintId} className="self-center px-1 text-xs italic text-ink-muted">
              Select an event to use these
            </span>
          )}
          {!readOnly && enablePathExploration && (
            <CanvasToolButton
              label="Explore Paths"
              pressed={activeTool === 'paths'}
              unavailableReason={toolTargetEvent ? null : 'Select an event on the graph to explore the causal paths leading from it'}
              describedBy={toolTargetEvent ? undefined : toolHintId}
              title={toolTargetEvent
                ? `Explore the causal paths leading from “${eventNodeLabel(toolTargetEvent)}”`
                : ''}
              onClick={() => toggleTool('paths')}
            />
          )}
          {!readOnly && enableSuggestions && (
            <CanvasToolButton
              label="Suggest Links"
              pressed={activeTool === 'suggestions'}
              unavailableReason={toolTargetEvent ? null : 'Select an event on the graph to see suggested causal links for it'}
              describedBy={toolTargetEvent ? undefined : toolHintId}
              title={toolTargetEvent
                ? `Suggest causal links for “${eventNodeLabel(toolTargetEvent)}”`
                : ''}
              onClick={() => toggleTool('suggestions')}
            />
          )}
          {!readOnly && (
            <CanvasToolButton
              label={isCreatingLink ? 'Cancel Link' : 'Draw Link'}
              pressed={isCreatingLink}
              // The label already says which state it is in.
              exposePressed={false}
              unavailableReason={null}
              title={isCreatingLink
                ? 'Stop drawing a link (Esc)'
                : selectedPair
                  ? `Link the two selected events: “${eventNodeLabel(selectedPair.cause)}” → “${eventNodeLabel(selectedPair.effect)}”, then set its weight, type and evidence (D)`
                  : 'Draw a causal link: click the cause, then the effect, then set its weight, type and evidence (D)'}
              onClick={toggleLinkCreationMode}
            />
          )}
        </div>

        {(!isInitialized || pathExplorationLoading || suggestionsLoading) && (
          <div className="absolute inset-0 flex items-center justify-center bg-canvas/75 rounded-lg" role="status">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-baseline mx-auto mb-2" aria-hidden="true"></div>
              <p className="text-sm text-ink-secondary">
                {!isInitialized ? 'Initializing causal graph...' :
                 pathExplorationLoading ? 'Exploring causal paths...' :
                 'Loading AI suggestions...'}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Relationship form for a link drawn on the canvas */}
      {!readOnly && <CausalRelationshipModal
        relationship={null}
        isOpen={pendingLink !== null}
        onClose={() => setPendingLink(null)}
        causeEventId={pendingLink?.cause.id}
        effectEventId={pendingLink?.effect.id}
        eventPool={events}
        onCreate={async (_causeId, _effectId, data) => {
          if (pendingLink) {
            await createCausalRelationship(pendingLink.cause, pendingLink.effect, data)
          }
        }}
      />}
    </div>
  )
}

/**
 * Spread a force layout's node positions to the canvas's aspect (see
 * canvasStretch), about their centre, before the graph is fitted.
 */
function stretchToCanvas(cy: Core) {
  if (typeof cy.width !== 'function' || typeof cy.height !== 'function') return
  const nodes = cy.nodes()
  if (!(nodes.length >= 2)) return
  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity
  nodes.forEach(node => {
    const { x, y } = node.position()
    x1 = Math.min(x1, x)
    y1 = Math.min(y1, y)
    x2 = Math.max(x2, x)
    y2 = Math.max(y2, y)
  })
  const { sx, sy } = canvasStretch(
    { w: x2 - x1, h: y2 - y1 },
    { width: cy.width() - 2 * FIT_PADDING, height: cy.height() - 2 * FIT_PADDING }
  )
  if (sx === 1 && sy === 1) return
  const cx = (x1 + x2) / 2
  const cyMid = (y1 + y2) / 2
  cy.batch(() => {
    nodes.forEach(node => {
      const { x, y } = node.position()
      node.position({ x: cx + (x - cx) * sx, y: cyMid + (y - cyMid) * sy })
    })
  })
}

/** Stable empty list, so the overlay is not re-run by a fresh `[]` each render. */
const NO_SUGGESTIONS: CausalSuggestion[] = []

interface CanvasToolButtonProps {
  label: string
  pressed: boolean
  /** Report `pressed` as aria-pressed (false when the label itself changes). */
  exposePressed?: boolean
  /** Why the tool cannot be used now, or null when it can. */
  unavailableReason: string | null
  /** An on-screen note that explains why the tool is unavailable. */
  describedBy?: string
  title: string
  onClick: () => void
}

/**
 * A toggle on the graph canvas. An unavailable tool stays focusable and keeps
 * its explanatory title (a `disabled` button shows no tooltip in most
 * browsers), and is marked `aria-disabled`.
 */
function CanvasToolButton({ label, pressed, exposePressed = true, unavailableReason, describedBy, title, onClick }: CanvasToolButtonProps) {
  const unavailable = unavailableReason !== null
  return (
    <button
      type="button"
      aria-pressed={exposePressed ? pressed : undefined}
      aria-disabled={unavailable || undefined}
      aria-describedby={describedBy}
      title={unavailableReason ?? title}
      onClick={(e) => {
        e.stopPropagation()
        if (!unavailable) onClick()
      }}
      className={`px-3 py-1 text-xs font-medium rounded-md border shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-selected ${
        unavailable
          ? 'bg-card text-ink-muted border-line opacity-60 cursor-not-allowed'
          : pressed
            ? 'bg-selected text-on-accent border-selected'
            : 'bg-card text-ink-secondary border-line hover:bg-subtle hover:text-ink'
      }`}
    >
      {label}
    </button>
  )
}

/** The panel shown when an open tool has nothing to show. */
function ToolEmptyState({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="bg-card border border-line rounded-lg shadow-lg p-3 text-sm text-ink-secondary flex items-start justify-between gap-3">
      <p>{children}</p>
      <button
        type="button"
        onClick={onClose}
        className="text-xs font-medium text-ink-muted hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-selected rounded"
      >
        Close
      </button>
    </div>
  )
}

export default CausalGraphComponent
