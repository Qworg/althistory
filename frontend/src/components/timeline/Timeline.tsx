import React, { useMemo, useRef, useState, useEffect, useCallback, useId, memo } from 'react'
import * as d3 from 'd3'
import { instantOfMs, instantScale, rescaleInstantX } from '@/utils/timeScale'
import { Event, Arc, TimeRange } from '@/types'
import { PressureWithContext } from '@/types/pressure'
import { type ArcWithUIState, calculateArcHierarchy, processArcsWithUIState } from './arcHierarchyUtils'
import { axisTicks, formatDuration } from '@/utils/d3Calculations'
import { useWorldCalendar } from '@/stores/worldCalendarStore'
import EventArcAssignment from './EventArcAssignment'
import PressureIndicators from './PressureIndicators'
import { TimelineEvent } from './TimelineEvent'
import { TimelineArc, type ArcResizeEdge } from './TimelineArc'
import { useTimelineScales } from '@/hooks/useTimelineScales'
import { useTimelineEventHandlers } from '@/hooks/useTimelineEventHandlers'
import {
  computeTimeWindow,
  filterArcsInWindow,
  filterEventsInWindow,
  filterPressuresInWindow
} from './timelineVirtualization'
import { formatHistoricalTimestamp, formatEventDate, formatHistoricalEnd } from '@/utils/historicalTime'
import { layoutEventLabels, LABEL_FONT_SIZE, TIMELINE_LABEL_CONFIG } from './eventLabelLayout'
import { tooltipPlacement } from './tooltipPlacement'
import {
  ARC_BAR_HEIGHT,
  DEFAULT_TIMELINE_MARGIN,
  DIVERGENCE_BAND_HEIGHT,
  EVENT_STEM_LENGTH,
  arcRowY,
  computeTimelineLayout,
} from './timelineLayout'
import {
  computeRipple,
  computeReach,
  reachRadius,
  restingLinkOpacity,
  linkPath,
  linkStrokeWidth,
  LINK_DASH,
  type TimelineLink,
} from './timelineLinks'
import {
  buildNavModel,
  keyboardTimeStep,
  markSpan,
  navigate,
  offsetByStep,
  parseMarkKey,
  eventMarkKey,
  arcMarkKey,
  type MarkKey,
  type NavMove,
} from './timelineNavigation'
import { toInstant } from '@althistory/calendar'

/**
 * A branch's baseline, drawn as a ghosted lane under the active events.
 *
 * `events` is the baseline's history on the same time scale; `divergence` is
 * the point where the branch departs from it, drawn as a permanent amber
 * landmark. Active events after the divergence with no counterpart in
 * `events` are drawn as the branch's own.
 */
export interface TimelineGhost {
  /** The baseline's name, shown on its lane ("Baseline: <label>"). */
  label: string
  events: Event[]
  divergence?: Date | null
}

export interface TimelineProps {
  events: Event[]
  arcs: Arc[]
  pressures?: PressureWithContext[]
  width?: number
  /**
   * Minimum SVG height. The canvas always grows to fit what it draws (arc
   * rows, label rows, the event track, the baseline lane, the axis), so a
   * parent can omit this; see timelineContentHeight() in timelineLayout.ts.
   * Height beyond the content is left below the axis, never between the arcs
   * and the event track.
   */
  height?: number
  margin?: { top: number; right: number; bottom: number; left: number }
  fitToViewTrigger?: number
  onEventSelect?: (event: Event) => void
  onArcSelect?: (arc: Arc) => void
  onPressureSelect?: (pressure: PressureWithContext) => void
  onPressureHover?: (pressure: PressureWithContext | null) => void
  onTimeRangeChange?: (range: TimeRange) => void
  onEventCreate?: (timestamp: Date) => void
  onEventDrag?: (event: Event, newTimestamp: Date) => void
  onArcExpand?: (arc: Arc) => void
  onArcCollapse?: (arc: Arc) => void
  onArcCreate?: (timeRange: TimeRange) => void
  onArcResize?: (arc: Arc, newBounds: { start: Date; end: Date }) => void
  /**
   * Live guardrail for the drag preview: given a prospective drop, return why
   * it would be refused (shown on the preview before release) or null if it is
   * valid. The commit itself is still decided by onEventDrag / onArcResize.
   */
  getEventDragViolation?: (event: Event, newTimestamp: Date) => string | null
  getArcResizeViolation?: (arc: Arc, newBounds: { start: Date; end: Date }) => string | null
  onEventAssignToArc?: (event: Event, arc: Arc) => void
  onEventContextMenu?: (event: Event, position: { x: number; y: number }) => void
  onArcContextMenu?: (arc: Arc, position: { x: number; y: number }) => void
  /**
   * The ids of the events that are the evidence of the selected pressure.
   *
   * The exploration panel's "highlight evidence" button sets them; without a
   * mark for them the button changed nothing anyone could see.
   */
  highlightedEventIds?: Set<string>
  selectedEventId?: string | null
  showPressureIndicators?: boolean
  /** When the active graph is a branch: its baseline, ghosted beneath (see TimelineGhost). */
  ghost?: TimelineGhost
  /**
   * The causal links between the events. Drawn in a band under the track;
   * selecting an event traces its ripple through them (see timelineLinks.ts).
   */
  links?: TimelineLink[]
  /**
   * Where the open graph's branches depart from it: an outlined amber diamond
   * each, in the divergence band. Lighter than the open branch's own full-height
   * divergence line, so "a what-if splits off here" and "you are in a what-if"
   * stay distinct.
   */
  branchMarks?: Array<{ id: string; label: string; date: Date }>
  className?: string
}

/** The element currently under the pointer (or keyboard focus), with its inner-SVG position. */
type HoveredElement =
  | { kind: 'event'; event: Event; x: number; y: number }
  | { kind: 'arc'; arc: ArcWithUIState; x: number; y: number }

/** A gesture in progress, resolved against the shared time scale on mouseup. */
type TimelineDrag =
  | { type: 'event'; event: Event }
  | { type: 'arc-resize'; arc: Arc; edge: ArcResizeEdge; y: number }

/**
 * Where an in-progress drag would land, drawn as a ghost over the canvas so
 * the user sees the target date (and any guardrail it would hit) before
 * releasing. Positions are inner-SVG coordinates.
 */
type DragPreview =
  | { kind: 'event'; event: Event; x: number; timestamp: Date; violation: string | null }
  | {
      kind: 'arc-resize'
      arc: Arc
      edge: ArcResizeEdge
      x1: number
      x2: number
      y: number
      bounds: { start: Date; end: Date }
      violation: string | null
    }

/** Clamp an arc resize so the moved edge never crosses the other one. */
function resizedBounds(arc: Arc, edge: ArcResizeEdge, timestamp: Date): { start: Date; end: Date } {
  const start = toInstant(arc.start_time)
  const end = toInstant(arc.end_time)
  if (edge === 'start') {
    return { start: timestamp.getTime() > end.getTime() ? end : timestamp, end }
  }
  return { start, end: timestamp.getTime() < start.getTime() ? start : timestamp }
}

/** Pointer travel (px) required before a mousedown is treated as a drag rather than a click. */
/** Below this canvas width the timeline opens zoomed in rather than fitted. */
const NARROW_CANVAS_PX = 600
/** The spacing per event that zoom aims for on a narrow canvas: a touch target. */
const TOUCH_SPACING_PX = 44

const DRAG_THRESHOLD_PX = 3

/** Inline-style highlight applied to the mark being dragged (see beginDrag). */
const DRAG_HIGHLIGHT_FILTER = 'drop-shadow(0 0 4px rgba(37, 99, 235, 0.95))'

/** Keep an inner-SVG x inside the plotted range, mirroring the double-click handler. */
function clampInnerX(innerX: number, innerWidth: number): number {
  return Math.max(0, Math.min(innerWidth, innerX))
}

/**
 * Same instant and description: how a baseline event is recognised in the
 * branch when the copy gave it a new id.
 */
function eventSignature(ev: Event): string {
  return `${toInstant(ev.timestamp).getTime()}|${ev.description}`
}

/** How long after a keyboard-opened menu a native contextmenu event counts as its echo. */
const KEYBOARD_MENU_ECHO_MS = 1000

/**
 * Zoom keys, honoured on a focused mark as well as on the canvas. On a mark
 * they zoom around it, so the mark keeps its place (and its focus). Panning
 * keys are the canvas's only: a pan could carry the focused mark out of view.
 */
const MARK_ZOOM_KEYS = new Set(['+', '=', '-', '_', '0'])

/**
 * Shows that a mark is being dragged by mutating its inline style directly.
 *
 * The marks are React.memo'd and the repo's ref pattern keeps the gesture
 * callbacks stable, so writing to the DOM here is what lets the drag have live
 * feedback without re-rendering the whole timeline on every pointer move.
 * Returns the restore function for the end of the gesture (or unmount).
 */
function highlightDraggedMark(mark: Element | null): () => void {
  if (!(mark instanceof SVGElement)) return () => {}
  const previousFilter = mark.style.filter
  const previousCursor = mark.style.cursor
  mark.style.filter = DRAG_HIGHLIGHT_FILTER
  mark.style.cursor = 'grabbing'
  return () => {
    mark.style.filter = previousFilter
    mark.style.cursor = previousCursor
  }
}

/**
 * Timeline component for visualizing events and arcs over time.
 *
 * This component is wrapped in React.memo to prevent unnecessary re-renders
 * from parent component updates that don't affect Timeline's props.
 *
 */
const Timeline = memo(function Timeline({
  events,
  arcs,
  pressures = [],
  width = 1000,
  height,
  margin = DEFAULT_TIMELINE_MARGIN,
  fitToViewTrigger = 0,
  onEventSelect,
  onArcSelect,
  onPressureSelect,
  onPressureHover,
  onTimeRangeChange,
  onEventCreate,
  onEventDrag,
  onArcExpand,
  onArcCollapse,
  onArcResize,
  getEventDragViolation,
  getArcResizeViolation,
  onEventAssignToArc,
  onEventContextMenu,
  onArcContextMenu,
  highlightedEventIds,
  selectedEventId = null,
  showPressureIndicators = true,
  ghost,
  branchMarks,
  links,
  className = '',
}: TimelineProps) {
  // The graph's world calendar, if any: the axis labels its years as the event labels do.
  const worldCalendar = useWorldCalendar()
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null)

  const [eventAssignmentModal, setEventAssignmentModal] = useState<{
    isOpen: boolean
    event: Event | null
    position: { x: number; y: number } | null
  }>({ isOpen: false, event: null, position: null })

  // Expanded arc ids drive isExpanded (and thus which descendants enter the
  // hierarchy); selected arc ids drive the isSelected visual highlight.
  const [expandedArcIds, setExpandedArcIds] = useState<Set<string>>(() => new Set())
  const [selectedArcIds, setSelectedArcIds] = useState<Set<string>>(() => new Set())
  const [hovered, setHovered] = useState<HoveredElement | null>(null)
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null)

  // Arc hierarchy and levels.
  //
  // OUTSTANDING COST PROBLEM, not fixed here: this runs over the WHOLE arc and
  // event sets before any windowing, and it reruns whenever arcs, events or the
  // selection/expansion sets change -- i.e. on every arc click and every
  // expand/collapse. Measured on this machine (vitest, node): 300 arcs against
  // 10,000 events costs ~1.0s in processArcsWithUIState (it parses two Dates
  // per arc-event pair) plus ~20ms in calculateArcHierarchy; 2,000 arcs with no
  // events costs ~3.0s in calculateArcHierarchy alone (its overlap scan re-parses
  // bounds and does a linear lookup per comparison). Either way a click that
  // moves the selection blocks the main thread for that long. Windowing does not
  // help: the full sets are still processed upstream of the window, and only the
  // number of DOM nodes is reduced. Both need pre-parsed timestamps and an
  // index/incremental pass; until then this is a known limit, not a solved one.
  const { arcHierarchy } = useMemo(() => {
    const withState = processArcsWithUIState(arcs, events, expandedArcIds, selectedArcIds)
    return calculateArcHierarchy(withState)
  }, [arcs, events, expandedArcIds, selectedArcIds])

  const maxArcLevel = useMemo(
    () => arcHierarchy.reduce((max, arc) => Math.max(max, arc.renderLevel), -1),
    [arcHierarchy]
  )

  // Top-down layout: the event track sits just below the deepest arc row that
  // is drawn, and the canvas is as tall as its content (see timelineLayout.ts).
  // Everything below keys on the ghost's parts, not the object, so a parent
  // that rebuilds `ghost` on each render does not reset the zoom (a new
  // domain resets the viewport). Its `events` array should be stable.
  const ghostEvents = ghost?.events
  const hasGhost = ghostEvents !== undefined
  const divergence = ghost?.divergence ?? null
  const hasBranchMarks = (branchMarks?.length ?? 0) > 0
  // The band at the top holds the open branch's divergence and its branches' marks.
  const hasDivergence = divergence !== null || hasBranchMarks
  // Only links between two events on this canvas can be drawn.
  const drawableLinks = useMemo(() => {
    if (!links || links.length === 0) return []
    const ids = new Set(events.map(ev => ev.id))
    return links.filter(link => ids.has(link.causeId) && ids.has(link.effectId))
  }, [links, events])
  const hasLinks = drawableLinks.length > 0
  const layout = useMemo(
    () =>
      computeTimelineLayout({
        maxArcLevel,
        hasGhostLane: hasGhost,
        hasDivergence,
        hasLinks,
        margin,
      }),
    [maxArcLevel, hasGhost, hasDivergence, hasLinks, margin]
  )
  const ripple = useMemo(() => computeRipple(selectedEventId, drawableLinks), [selectedEventId, drawableLinks])
  // What each event sets in motion, shown at rest as mark size and link
  // weight, so the consequential events stand out before anything is clicked.
  const reach = useMemo(() => computeReach(drawableLinks), [drawableLinks])
  const maxReach = useMemo(() => Math.max(0, ...reach.values()), [reach])
  const isTracing = selectedEventId !== null && ripple.links.size > 0
  const svgHeight = Math.max(height ?? 0, layout.height)

  // The baseline shares the time scale, so its events count toward the extent.
  const domainEvents = useMemo(
    () => (ghostEvents ? [...events, ...ghostEvents] : events),
    [events, ghostEvents]
  )

  // Use custom hook for memoized scale calculations
  // This gives us the original domain from events/arcs
  const { innerWidth, xDomain } = useTimelineScales(
    domainEvents,
    arcs,
    width,
    svgHeight,
    margin,
    1 // Always fit to view for original extent
  )
  const { eventY, axisY } = layout

  // Narrow canvases open zoomed in (see the zoom effect); applied once per extent.
  const narrowZoomAppliedRef = useRef<string | null>(null)
  const domainEventCount = domainEvents.length

  // State for visible time range (for zoom/pan)
  const [visibleTimeRange, setVisibleTimeRange] = useState<TimeRange | null>(null)

  // Original time extent (memoized, doesn't change with zoom)
  const originalExtent = useMemo(() => ({
    start: xDomain[0],
    end: xDomain[1]
  }), [xDomain])

  // Reset visible range when original extent changes
  useEffect(() => {
    setVisibleTimeRange(originalExtent)
  }, [originalExtent])

  // Respond to external fit-to-view trigger (from toolbar button)
  const prevTriggerRef = useRef(fitToViewTrigger)
  useEffect(() => {
    if (fitToViewTrigger !== prevTriggerRef.current) {
      prevTriggerRef.current = fitToViewTrigger
      // Reset zoom
      setVisibleTimeRange(originalExtent)
      if (svgRef.current && zoomRef.current) {
        const svg = d3.select(svgRef.current)
        svg.transition()
          .duration(300)
          .call(zoomRef.current.transform, d3.zoomIdentity)
      }
    }
  }, [fitToViewTrigger, originalExtent])

  // The visible range is the single source of truth for the viewport: the x
  // scale is built from it and the render window is derived from it, so panning
  // and zooming move both together.
  const currentRange = visibleTimeRange || originalExtent

  // Create xScale based on visible range (or original if not set)
  const xScale = useMemo(() => {
    return instantScale()
      .domain([currentRange.start, currentRange.end])
      .range([0, innerWidth])
  }, [currentRange, innerWidth])

  // Windowing: render only the marks whose time falls inside the current
  // viewport (plus a fixed multiple of the visible span either side). This
  // culls marks that are drawn off-screen and invisible under the clip path.
  //
  // It is NOT a bound on the mounted count independent of the dataset: the
  // window admits (local mark density) x (window span), which stays
  // proportional to N. d3-zoom is capped at 20x below, so even fully zoomed a
  // uniform dataset of N events still mounts about N/10. Nothing is culled
  // while the window still covers the whole extent (about 2x with the default
  // overscan, a little earlier off-centre). See timelineVirtualization.ts.
  const timeWindow = useMemo(() => computeTimeWindow(currentRange), [currentRange])

  // Stable ref for time range callback to avoid infinite loops
  // See: docs/adr-001-d3-react-integration.md
  const onTimeRangeChangeRef = useRef(onTimeRangeChange)
  onTimeRangeChangeRef.current = onTimeRangeChange

  const startDomain = xDomain[0]
  const endDomain = xDomain[1]

  // Expose time range upwards - callback NOT in dependencies to prevent infinite loops
  useEffect(() => {
    onTimeRangeChangeRef.current?.({ start: startDomain, end: endDomain })
  }, [startDomain, endDomain])

  // Refs keep pointer handlers stable across renders so the memoized mark
  // components do not re-render on every Timeline update.
  const xScaleRef = useRef(xScale)
  xScaleRef.current = xScale
  const selectedEventIdRef = useRef(selectedEventId)
  selectedEventIdRef.current = selectedEventId
  const innerWidthRef = useRef(innerWidth)
  innerWidthRef.current = innerWidth
  const marginLeftRef = useRef(margin.left)
  marginLeftRef.current = margin.left

  const onEventDragRef = useRef(onEventDrag)
  onEventDragRef.current = onEventDrag
  const onArcResizeRef = useRef(onArcResize)
  onArcResizeRef.current = onArcResize
  const getEventDragViolationRef = useRef(getEventDragViolation)
  getEventDragViolationRef.current = getEventDragViolation
  const getArcResizeViolationRef = useRef(getArcResizeViolation)
  getArcResizeViolationRef.current = getArcResizeViolation
  const onArcExpandRef = useRef(onArcExpand)
  onArcExpandRef.current = onArcExpand
  const onArcCollapseRef = useRef(onArcCollapse)
  onArcCollapseRef.current = onArcCollapse
  const expandedArcIdsRef = useRef(expandedArcIds)
  expandedArcIdsRef.current = expandedArcIds

  const arcLevelMap = useMemo(() => new Map(arcHierarchy.map(a => [a.id, a.renderLevel])), [arcHierarchy])

  const visibleEvents = useMemo(
    () => filterEventsInWindow(events, timeWindow),
    [events, timeWindow]
  )
  const visibleArcs = useMemo(
    () => filterArcsInWindow(arcHierarchy, timeWindow),
    [arcHierarchy, timeWindow]
  )
  // Pressure indicators are a DOM group per (pressure, affected arc) pair, so
  // they need their own windowing pass or the pressure node count keeps scaling
  // with the full arc set however far the view is zoomed in.
  const visiblePressures = useMemo(
    () => filterPressuresInWindow(pressures, timeWindow),
    [pressures, timeWindow]
  )

  // Y position of an arc row's bar, from the layout's arc top.
  const arcTop = layout.arcTop
  const yScale = useCallback((level: number) => arcRowY(level, arcTop), [arcTop])

  // A mark's radius at rest. On a narrow canvas the marks sit close, so the
  // whole reach scale shrinks rather than letting the large marks overlap.
  const markScale = innerWidth < 640 ? 0.7 : 1
  const markBaseRadius = useCallback(
    (id: string) => (hasLinks ? reachRadius(reach.get(id) ?? 0, maxReach) * markScale : 6 * markScale),
    [hasLinks, reach, maxReach, markScale]
  )

  // Which visible events get a label, and where. The selected and highlighted
  // events are placed first so they are always named; the rest are labelled
  // only where there is room (see eventLabelLayout.ts).
  const eventLabels = useMemo(
    () =>
      layoutEventLabels(
        visibleEvents.map(ev => ({
          id: ev.id,
          x: xScale(toInstant(ev.timestamp)),
          description: ev.description,
          // The selection's ripple is named first, so the trace reads as words.
          priority:
            ev.id === selectedEventId ||
            (highlightedEventIds?.has(ev.id) ?? false) ||
            ripple.causes.has(ev.id) ||
            ripple.effects.has(ev.id),
          weight: reach.get(ev.id) ?? 0,
        })),
        innerWidth,
        TIMELINE_LABEL_CONFIG
      ),
    [visibleEvents, xScale, innerWidth, selectedEventId, highlightedEventIds, ripple, reach]
  )

  // ── Branch baseline (ghost) ──────────────────────────────────────────────
  // A baseline event has a counterpart in the branch when the branch holds the
  // same id, or the same instant and description (a copy with a new id).
  // Active events after the divergence without a counterpart are the branch's
  // own; baseline events after it without one are what the branch dropped.
  const divergenceMs = divergence ? divergence.getTime() : null
  const ghostComparison = useMemo(() => {
    if (!ghostEvents) return null
    const after = (ev: Event) => divergenceMs === null || toInstant(ev.timestamp).getTime() >= divergenceMs
    const activeIds = new Set(events.map(ev => ev.id))
    const activeSignatures = new Set(events.map(eventSignature))
    const baselineIds = new Set(ghostEvents.map(ev => ev.id))
    const baselineSignatures = new Set(ghostEvents.map(eventSignature))
    const branchOwn = new Set<string>()
    for (const ev of events) {
      if (after(ev) && !baselineIds.has(ev.id) && !baselineSignatures.has(eventSignature(ev))) branchOwn.add(ev.id)
    }
    const dropped = new Set<string>()
    for (const ev of ghostEvents) {
      if (after(ev) && !activeIds.has(ev.id) && !activeSignatures.has(eventSignature(ev))) dropped.add(ev.id)
    }
    return { branchOwn, dropped }
  }, [ghostEvents, events, divergenceMs])
  const branchOwnIds = ghostComparison?.branchOwn

  const visibleGhostEvents = useMemo(
    () => (ghostEvents ? filterEventsInWindow(ghostEvents, timeWindow) : []),
    [ghostEvents, timeWindow]
  )

  // ── Keyboard model: one tab stop, arrow keys between marks ───────────────
  const navModel = useMemo(() => buildNavModel(events, arcHierarchy), [events, arcHierarchy])
  const eventsById = useMemo(() => new Map(events.map(ev => [ev.id, ev])), [events])
  const arcsById = useMemo(() => new Map(arcHierarchy.map(arc => [arc.id, arc])), [arcHierarchy])

  // The mark that last had focus; the tab stop follows it.
  const [activeMarkKey, setActiveMarkKey] = useState<MarkKey | null>(null)

  // Exactly one mounted mark is tabbable. It is the last-focused mark while it
  // is still drawn; otherwise the selected event, then the earliest event in
  // view, then the first arc in view. With no marks the canvas itself is the
  // tab stop.
  const tabStopKey = useMemo((): MarkKey | null => {
    const mounted = new Set<MarkKey>()
    for (const ev of visibleEvents) mounted.add(eventMarkKey(ev.id))
    for (const arc of visibleArcs) mounted.add(arcMarkKey(arc.id))
    if (activeMarkKey && mounted.has(activeMarkKey)) return activeMarkKey
    if (selectedEventId && mounted.has(eventMarkKey(selectedEventId))) return eventMarkKey(selectedEventId)
    let earliest: { key: MarkKey; t: number } | null = null
    for (const ev of visibleEvents) {
      const x = xScale(toInstant(ev.timestamp))
      if (x < 0 || x > innerWidth) continue
      const t = toInstant(ev.timestamp).getTime()
      if (!earliest || t < earliest.t) earliest = { key: eventMarkKey(ev.id), t }
    }
    if (earliest) return earliest.key
    const firstArc = visibleArcs.find(arc => {
      const x1 = xScale(toInstant(arc.start_time))
      const x2 = xScale(toInstant(arc.end_time))
      return x2 >= 0 && x1 <= innerWidth
    })
    if (firstArc) return arcMarkKey(firstArc.id)
    const anyMounted = mounted.values().next()
    return anyMounted.done ? null : anyMounted.value
  }, [activeMarkKey, selectedEventId, visibleEvents, visibleArcs, xScale, innerWidth])

  // Memoized scale wrappers for PressureIndicators to prevent re-renders
  const timeScaleWrapper = useCallback((d: Date) => xScale(d), [xScale])
  const yScaleWrapper = useCallback((level: number) => yScale(level), [yScale])

  // Use custom hook for stable event handlers
  const { handleEventClick, handleArcClick, handleSvgDoubleClick } = useTimelineEventHandlers({
    onEventSelect,
    onArcSelect,
    onEventCreate,
    xScale,
    margin,
    innerWidth
  })

  // Double-click on the BACKGROUND (not on a mark) creates an event, prefilled
  // with the timestamp under the pointer.
  const handleSvgDoubleClickGuarded = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const target = e.target
    if (target instanceof Element && target.closest('[data-timeline-mark]')) return
    handleSvgDoubleClick(e)
  }, [handleSvgDoubleClick])

  // When the keyboard opened a mark's menu (Shift+F10 / the menu key), the
  // browser may still deliver its own contextmenu event for the same press;
  // that one is swallowed so the menu does not open twice.
  const keyboardMenuAtRef = useRef(0)

  // Context menu handler for events
  const handleEventContextMenu = useCallback((evt: React.MouseEvent, ev: Event) => {
    evt.preventDefault()
    if (Date.now() - keyboardMenuAtRef.current < KEYBOARD_MENU_ECHO_MS) return
    // The hover tooltip would sit on top of the menu it opened.
    setHovered(null)
    if (onEventContextMenu) {
      // Use the new context menu callback
      onEventContextMenu(ev, { x: evt.clientX, y: evt.clientY })
    } else {
      // Fall back to event arc assignment modal
      setEventAssignmentModal({ isOpen: true, event: ev, position: { x: evt.pageX, y: evt.pageY } })
    }
  }, [onEventContextMenu])

  // Context menu handler for arcs
  const handleArcContextMenu = useCallback((evt: React.MouseEvent, arc: Arc) => {
    evt.preventDefault()
    if (Date.now() - keyboardMenuAtRef.current < KEYBOARD_MENU_ECHO_MS) return
    setHovered(null)
    if (onArcContextMenu) {
      onArcContextMenu(arc, { x: evt.clientX, y: evt.clientY })
    }
  }, [onArcContextMenu])

  // Expand/collapse an arc. Reading from a ref keeps the callback stable so
  // every memoized TimelineArc does not re-render on each Timeline render.
  const handleArcToggle = useCallback((arc: ArcWithUIState) => {
    const willExpand = !expandedArcIdsRef.current.has(arc.id)
    setExpandedArcIds(prev => {
      const next = new Set(prev)
      if (willExpand) {
        next.add(arc.id)
      } else {
        next.delete(arc.id)
      }
      return next
    })
    if (willExpand) {
      onArcExpandRef.current?.(arc)
    } else {
      onArcCollapseRef.current?.(arc)
    }
  }, [])

  // Arc selection also feeds the selectedElements set consumed by
  // processArcsWithUIState (the arc highlight), not just the outward callback.
  const handleArcClickWithSelection = useCallback((arc: ArcWithUIState) => {
    setSelectedArcIds(prev => (prev.size === 1 && prev.has(arc.id) ? prev : new Set([arc.id])))
    handleArcClick(arc)
  }, [handleArcClick])

  const handleEventHoverEnter = useCallback((event: Event, position: { x: number; y: number }) => {
    setHovered({ kind: 'event', event, x: position.x, y: position.y })
  }, [])

  const handleArcHoverEnter = useCallback((arc: ArcWithUIState, position: { x: number; y: number }) => {
    setHovered({ kind: 'arc', arc, x: position.x, y: position.y })
  }, [])

  const handleHoverLeave = useCallback(() => {
    setHovered(null)
  }, [])

  // Convert a viewport clientX into the plot's inner-SVG x (px from the left
  // edge of the time scale's range). Mirrors the double-click handler's
  // coordinate conversion so both paths use d3's invert.
  const clientXToInnerX = useCallback((clientX: number): number | null => {
    const svg = svgRef.current
    if (!svg) return null
    if (typeof svg.getScreenCTM !== 'function' || typeof svg.createSVGPoint !== 'function') return null
    const ctm = svg.getScreenCTM()
    if (!ctm) return null
    const point = svg.createSVGPoint()
    point.x = clientX
    point.y = 0
    const local = point.matrixTransform(ctm.inverse())
    return local.x - marginLeftRef.current
  }, [])

  // A resize grabs an edge, so the edge simply follows the pointer.
  const clientXToDate = useCallback((clientX: number): Date | null => {
    const scale = xScaleRef.current
    const innerX = clientXToInnerX(clientX)
    if (!scale || innerX === null) return null
    return scale.invert(clampInnerX(innerX, innerWidthRef.current))
  }, [clientXToInnerX])

  // A retime preserves the grab offset: the mark keeps its distance from the
  // pointer that started the gesture, instead of snapping its start to the
  // cursor. The new time is the original time advanced by the pointer's own
  // travel, converted through the same scale.
  const draggedTime = useCallback(
    (event: Event, startClientX: number, clientX: number): Date | null => {
      const scale = xScaleRef.current
      const startInnerX = clientXToInnerX(startClientX)
      const currentInnerX = clientXToInnerX(clientX)
      if (!scale || startInnerX === null || currentInnerX === null) return null
      const originInnerX = scale(toInstant(event.timestamp))
      const nextInnerX = originInnerX + (currentInnerX - startInnerX)
      return scale.invert(clampInnerX(nextInnerX, innerWidthRef.current))
    },
    [clientXToInnerX]
  )

  // A mousedown only becomes a drag once the pointer travels past a threshold,
  // so a plain click never fires the drag/resize callbacks. `source` is the
  // element the gesture started on; its mark gets the transient drag highlight.
  // While dragging, a ghost preview shows where the mark would land (updated at
  // most once per animation frame), and Escape abandons the gesture unsaved.
  const beginDrag = useCallback((drag: TimelineDrag, startClientX: number, source: Element | null) => {
    let moved = false
    let lastClientX = startClientX
    let frame: number | null = null
    let cleanup = () => {}

    const mark = source?.closest('[data-timeline-mark]') ?? source
    const restoreMark = highlightDraggedMark(mark)

    const computePreview = (clientX: number): DragPreview | null => {
      const scale = xScaleRef.current
      if (drag.type === 'event') {
        const timestamp = draggedTime(drag.event, startClientX, clientX)
        if (!timestamp) return null
        return {
          kind: 'event',
          event: drag.event,
          x: scale(timestamp),
          timestamp,
          violation: getEventDragViolationRef.current?.(drag.event, timestamp) ?? null,
        }
      }
      const timestamp = clientXToDate(clientX)
      if (!timestamp) return null
      const bounds = resizedBounds(drag.arc, drag.edge, timestamp)
      return {
        kind: 'arc-resize',
        arc: drag.arc,
        edge: drag.edge,
        x1: scale(bounds.start),
        x2: scale(bounds.end),
        y: drag.y,
        bounds,
        violation: getArcResizeViolationRef.current?.(drag.arc, bounds) ?? null,
      }
    }

    const flushPreview = () => {
      frame = null
      setDragPreview(computePreview(lastClientX))
    }

    const handleMouseMove = (native: MouseEvent) => {
      if (!moved && Math.abs(native.clientX - startClientX) < DRAG_THRESHOLD_PX) return
      moved = true
      lastClientX = native.clientX
      if (typeof window.requestAnimationFrame !== 'function') {
        flushPreview()
      } else if (frame === null) {
        frame = window.requestAnimationFrame(flushPreview)
      }
    }

    const handleMouseUp = (native: MouseEvent) => {
      const wasMoved = moved
      cleanup()
      if (!wasMoved) return
      if (drag.type === 'event') {
        const timestamp = draggedTime(drag.event, startClientX, native.clientX)
        if (!timestamp) return
        // Move away and back lands on the original timestamp; that write would
        // change nothing, so it is skipped rather than sent to the API.
        if (timestamp.getTime() === toInstant(drag.event.timestamp).getTime()) return
        onEventDragRef.current?.(drag.event, timestamp)
        return
      }
      const timestamp = clientXToDate(native.clientX)
      if (!timestamp) return
      onArcResizeRef.current?.(drag.arc, resizedBounds(drag.arc, drag.edge, timestamp))
    }

    // Capture phase, so the toolbar's document-level Escape (clear selection)
    // does not also fire for the key that only meant "cancel this drag".
    const handleKeyDown = (native: KeyboardEvent) => {
      if (native.key !== 'Escape') return
      native.preventDefault()
      native.stopPropagation()
      cleanup()
    }

    cleanup = () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      window.removeEventListener('keydown', handleKeyDown, true)
      if (frame !== null && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(frame)
      }
      frame = null
      dragCleanupRef.current = null
      setDragPreview(null)
      restoreMark()
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    window.addEventListener('keydown', handleKeyDown, true)
    dragCleanupRef.current = cleanup
  }, [clientXToDate, draggedTime])

  const handleEventDragStart = useCallback((event: Event, native: React.MouseEvent) => {
    if (native.button !== 0) return
    beginDrag({ type: 'event', event }, native.clientX, native.currentTarget)
  }, [beginDrag])

  const handleArcResizeStart = useCallback((arc: ArcWithUIState, edge: ArcResizeEdge, native: React.MouseEvent) => {
    if (native.button !== 0) return
    beginDrag({ type: 'arc-resize', arc, edge, y: yScale(arc.renderLevel) }, native.clientX, native.currentTarget)
  }, [beginDrag, yScale])

  // Clear any in-flight window listeners if Timeline unmounts mid-gesture.
  useEffect(() => () => {
    dragCleanupRef.current?.()
  }, [])

  const handleEventAssignment = useCallback(async (eventId: string, arcId: string | null) => {
    const ev = events.find(e => e.id === eventId)
    const arc = arcId ? arcs.find(a => a.id === arcId) : null
    if (ev && arc && onEventAssignToArc) await onEventAssignToArc(ev, arc)
    setEventAssignmentModal({ isOpen: false, event: null, position: null })
  }, [events, arcs, onEventAssignToArc])

  const handleEventAssignmentCancel = useCallback(() => {
    setEventAssignmentModal({ isOpen: false, event: null, position: null })
  }, [])

  // Keep the selected event on screen. Selecting one from the inspector, a
  // list or the keyboard (or during the fit animation) could leave it outside
  // the zoomed window; the window pans to centre it, keeping the zoom level.
  useEffect(() => {
    if (!selectedEventId || !svgRef.current || !zoomRef.current) return
    const selected = events.find((ev) => ev.id === selectedEventId)
    if (!selected) return
    const t = toInstant(selected.timestamp).getTime()
    const start = currentRange.start.getTime()
    const end = currentRange.end.getTime()
    if (!Number.isFinite(t) || (t >= start && t <= end)) return
    const fullStart = originalExtent.start.getTime()
    const fullEnd = originalExtent.end.getTime()
    const span = end - start
    const from = Math.min(Math.max(t - span / 2, fullStart), Math.max(fullStart, fullEnd - span))
    const base = instantScale().domain([originalExtent.start, originalExtent.end]).range([0, innerWidth])
    const k = (fullEnd - fullStart) / span
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    d3.select(svgRef.current)
      .transition()
      .duration(reduce ? 0 : 300)
      .call(zoomRef.current.transform, d3.zoomIdentity.translate(-base(instantOfMs(from)) * k, 0).scale(k))
    // Only on a new selection: panning away afterwards is the user's choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEventId])

  // Reset zoom handler
  const handleResetZoom = useCallback(() => {
    setVisibleTimeRange(originalExtent)
    if (svgRef.current && zoomRef.current) {
      const svg = d3.select(svgRef.current)
      svg.transition()
        .duration(300)
        .call(zoomRef.current.transform, d3.zoomIdentity)
    }
  }, [originalExtent])

  // Set up zoom and pan behavior
  useEffect(() => {
    if (!svgRef.current) return

    const svg = d3.select(svgRef.current)

    // Create base scale from original extent (prevents zoom compounding)
    const baseTimeScale = instantScale()
      .domain([originalExtent.start, originalExtent.end])
      .range([0, innerWidth])

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 20])
      .translateExtent([[0, 0], [width, svgHeight]])
      .extent([[0, 0], [width, svgHeight]])
      .on('zoom', (event) => {
        const { transform } = event

        // Calculate new domain from the ORIGINAL scale
        const newTimeScale = rescaleInstantX(transform, baseTimeScale)
        const newDomain = newTimeScale.domain()

        setVisibleTimeRange({
          start: newDomain[0],
          end: newDomain[1]
        })

        onTimeRangeChangeRef.current?.({
          start: newDomain[0],
          end: newDomain[1]
        })
      })

    // Keep zoom/pan from starting on a timeline mark: otherwise d3 calls
    // stopImmediatePropagation on mousedown and React never sees the gesture.
    // Wheel-zoom over a mark is still allowed. `.filter` is public d3 API and
    // every d3 test double registers it, so this is a direct call: an optional
    // call would silently run a different interaction model in a suite whose
    // mock omitted it.
    zoom.filter((event: MouseEvent) => {
      const onMark =
        event.target instanceof Element && event.target.closest('[data-timeline-mark]') !== null
      if (onMark && event.type !== 'wheel') return false
      return (!event.ctrlKey || event.type === 'wheel') && !event.button
    })

    zoomRef.current = zoom
    svg.call(zoom)
    // Double-click is reserved for event creation, so drop d3's double-click zoom.
    svg.on('dblclick.zoom', null)

    // A phone fitted the whole history into ~300px: nineteen marks in 230px,
    // overlapping, too close to tap. On a narrow canvas open zoomed in to about
    // a touch target per event, once per extent; panning reaches the rest and
    // Fit to View still shows it all. A branch opens on its point of
    // divergence, a third of the way in, because that is where it differs from
    // the history it came from; anything else opens at the start.
    const extentKey = `${originalExtent.start.getTime()}-${originalExtent.end.getTime()}-${divergenceMs ?? ''}`
    if (innerWidth < NARROW_CANVAS_PX && narrowZoomAppliedRef.current !== extentKey) {
      narrowZoomAppliedRef.current = extentKey
      const k = Math.min(20, (domainEventCount * TOUCH_SPACING_PX) / innerWidth)
      if (k > 1.2) {
        let tx = 0
        if (divergenceMs !== null) {
          const base = instantScale().domain([originalExtent.start, originalExtent.end]).range([0, innerWidth])
          const wanted = -base(instantOfMs(divergenceMs)) * k + innerWidth / 3
          tx = Math.min(0, Math.max(innerWidth - innerWidth * k, wanted))
        }
        svg.call(zoom.transform, d3.zoomIdentity.translate(tx, 0).scale(k))
      }
    }

    return () => {
      svg.on('.zoom', null)
    }
  }, [originalExtent, innerWidth, width, svgHeight, domainEventCount, divergenceMs])

  // Pan/zoom keys of the canvas (arrow keys and PageUp/PageDown pan, +/-
  // zoom, 0 resets). Returns whether the key was one of them.
  // `focus` is the inner-SVG x of a focused mark to zoom around (canvas keys
  // zoom around the centre).
  const handleViewportKey = useCallback((event: React.KeyboardEvent<SVGSVGElement>, focusX?: number): boolean => {
    const zoom = zoomRef.current
    if (!svgRef.current || !zoom) return false

    const svg = d3.select(svgRef.current)
    const panStep = 60
    const pageStep = 240
    const zoomAt = (factor: number) => {
      if (focusX === undefined) {
        svg.call(zoom.scaleBy, factor)
      } else {
        svg.call(zoom.scaleBy, factor, [marginLeftRef.current + focusX, 0])
      }
    }

    switch (event.key) {
      case 'ArrowLeft':
        svg.call(zoom.translateBy, panStep, 0)
        break
      case 'ArrowRight':
        svg.call(zoom.translateBy, -panStep, 0)
        break
      case 'PageUp':
        svg.call(zoom.translateBy, pageStep, 0)
        break
      case 'PageDown':
        svg.call(zoom.translateBy, -pageStep, 0)
        break
      case '+':
      case '=':
        zoomAt(1.25)
        break
      case '-':
      case '_':
        zoomAt(0.8)
        break
      case '0':
        handleResetZoom()
        break
      default:
        return false
    }
    event.preventDefault()
    return true
  }, [handleResetZoom])

  // Focus that waits for a mark to mount: moving to a mark outside the render
  // window pans the view first, and the mark only exists after that render.
  // A request that has not resolved after a couple of renders is dropped, so
  // a mark that never mounts cannot pull focus away later.
  const pendingFocusRef = useRef<{ key: MarkKey; attempts: number } | null>(null)
  const focusPendingMark = useCallback((): boolean => {
    const pending = pendingFocusRef.current
    const svg = svgRef.current
    if (!pending || !svg) return false
    for (const el of svg.querySelectorAll('[data-mark-key]')) {
      if (el.getAttribute('data-mark-key') === pending.key && el instanceof SVGElement) {
        pendingFocusRef.current = null
        el.focus()
        return true
      }
    }
    pending.attempts += 1
    if (pending.attempts > 2) pendingFocusRef.current = null
    return false
  }, [])
  // Whether keyboard focus is inside the canvas. A focused mark that a
  // pointer pan or zoom culls from the window is removed from the DOM, and
  // browsers drop focus to <body> without a blur; focus then returns to the
  // canvas instead of leaving the timeline.
  const focusWithinRef = useRef(false)
  useEffect(() => {
    if (focusPendingMark()) return
    const active = document.activeElement
    if (focusWithinRef.current && (active === null || active === document.body)) {
      svgRef.current?.focus({ preventScroll: true })
    }
  })

  // Move keyboard focus to a mark, panning it into view first when it is off
  // screen (or not mounted at all) so focus is never invisible.
  const focusMark = useCallback((key: MarkKey) => {
    setActiveMarkKey(key)
    pendingFocusRef.current = { key, attempts: 0 }
    const span = markSpan(navModel, key)
    const svg = svgRef.current
    const zoom = zoomRef.current
    if (span && svg && zoom) {
      const scale = xScaleRef.current
      const iw = innerWidthRef.current
      const x1 = scale(instantOfMs(span.start))
      const x2 = scale(instantOfMs(span.end))
      if (x2 < 0 || x1 > iw) {
        // translateBy works in untransformed units, so a screen shift of dx is
        // dx / k, where k is how far the view is zoomed in from the extent.
        const [d0, d1] = scale.domain() as [Date, Date]
        const visibleSpan = d1.getTime() - d0.getTime()
        const fullSpan = originalExtent.end.getTime() - originalExtent.start.getTime()
        const k = visibleSpan > 0 ? fullSpan / visibleSpan : 1
        // Centre an event (or a short arc); a long arc brings its start in.
        const target = x2 - x1 > iw * 0.8 ? x1 - iw * 0.1 : (x1 + x2) / 2 - iw / 2
        d3.select(svg).call(zoom.translateBy, -target / k, 0)
      }
    }
    focusPendingMark()
  }, [navModel, originalExtent, focusPendingMark])

  // The step a keyboard retime/resize moves by, from what is on screen.
  const keyboardStep = useCallback(() => {
    const [d0, d1] = xScaleRef.current.domain() as [Date, Date]
    return keyboardTimeStep(d1.getTime() - d0.getTime())
  }, [])

  // Open a mark's context menu from the keyboard, anchored under the mark.
  const openMarkMenu = useCallback((key: MarkKey, element: Element) => {
    const parsed = parseMarkKey(key)
    if (!parsed) return
    keyboardMenuAtRef.current = Date.now()
    const rect = element.getBoundingClientRect()
    const position = { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.bottom) }
    if (parsed.kind === 'event') {
      const ev = eventsById.get(parsed.id)
      if (!ev) return
      if (onEventContextMenu) {
        onEventContextMenu(ev, position)
      } else {
        setEventAssignmentModal({
          isOpen: true,
          event: ev,
          position: { x: position.x + window.scrollX, y: position.y + window.scrollY },
        })
      }
      return
    }
    const arc = arcsById.get(parsed.id)
    if (arc) onArcContextMenu?.(arc, position)
  }, [eventsById, arcsById, onEventContextMenu, onArcContextMenu])

  // Retime an event, or move an arc, by whole keyboard steps. Both go through
  // the same callbacks as a drag, so validation and undo apply unchanged.
  const moveMarkInTime = useCallback((key: MarkKey, direction: -1 | 1) => {
    const parsed = parseMarkKey(key)
    if (!parsed) return
    const step = keyboardStep()
    if (parsed.kind === 'event') {
      const ev = eventsById.get(parsed.id)
      if (!ev) return
      onEventDragRef.current?.(ev, offsetByStep(toInstant(ev.timestamp), step, direction))
      return
    }
    const arc = arcsById.get(parsed.id)
    if (!arc) return
    // The arc moves whole: its start by the step, its end by as much, so a
    // move never stretches or shrinks it (months, and a world's festivals,
    // differ in length).
    const start = toInstant(arc.start_time)
    const movedStart = offsetByStep(start, step, direction)
    onArcResizeRef.current?.(arc, {
      start: movedStart,
      end: instantOfMs(toInstant(arc.end_time).getTime() + (movedStart.getTime() - start.getTime())),
    })
  }, [eventsById, arcsById, keyboardStep])

  // Move one edge of an arc by a keyboard step; the edge never crosses the other.
  const resizeArcEdge = useCallback((arcId: string, edge: ArcResizeEdge, direction: -1 | 1) => {
    const arc = arcsById.get(arcId)
    if (!arc) return
    const moved = offsetByStep(toInstant(edge === 'start' ? arc.start_time : arc.end_time), keyboardStep(), direction)
    onArcResizeRef.current?.(arc, resizedBounds(arc, edge, moved))
  }, [arcsById, keyboardStep])

  // Keys on a focused mark. Enter/Space (select) and Shift+Enter (expand an
  // arc) are answered by the mark itself; everything else lands here.
  const handleMarkKey = useCallback((event: React.KeyboardEvent<SVGSVGElement>, key: MarkKey, element: Element) => {
    const isArc = key.startsWith('arc:')
    const move = (to: NavMove) => {
      const range = xScaleRef.current.domain() as [Date, Date]
      const next = navigate(navModel, key, to, { start: range[0].getTime(), end: range[1].getTime() })
      if (next) focusMark(next)
    }

    if ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu') {
      event.preventDefault()
      openMarkMenu(key, element)
      return
    }

    if (event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault()
      moveMarkInTime(key, event.key === 'ArrowLeft' ? -1 : 1)
      return
    }

    // [ moves the start edge, ] the end edge: bare keys grow the arc outward,
    // Shift shrinks it inward. Matched by physical key so Shift+[ (which
    // types "{" on many layouts) still reads as the start edge.
    const bracket =
      event.code === 'BracketLeft' || event.key === '[' || event.key === '{'
        ? 'start'
        : event.code === 'BracketRight' || event.key === ']' || event.key === '}'
          ? 'end'
          : null
    if (bracket) {
      if (!isArc) return
      event.preventDefault()
      const outward = bracket === 'start' ? -1 : 1
      resizeArcEdge(key.slice('arc:'.length), bracket, (event.shiftKey ? -outward : outward) as -1 | 1)
      return
    }

    if (event.shiftKey) return

    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault()
        move('prev')
        return
      case 'ArrowRight':
        event.preventDefault()
        move('next')
        return
      case 'ArrowUp':
        event.preventDefault()
        move('up')
        return
      case 'ArrowDown':
        event.preventDefault()
        move('down')
        return
      case 'Home':
        event.preventDefault()
        move('first')
        return
      case 'End':
        event.preventDefault()
        move('last')
        return
      case 'Escape':
        // With an event selected, Escape clears it first (the view's
        // document-level handler does that), focus staying on the mark: the
        // legend promises "Esc clears", and moving focus instead made it take
        // two presses. With nothing selected, Escape steps back to the canvas,
        // where the arrow keys pan; stopped so nothing else acts on it.
        if (selectedEventIdRef.current) return
        event.preventDefault()
        event.stopPropagation()
        svgRef.current?.focus()
        return
      default:
        if (MARK_ZOOM_KEYS.has(event.key)) {
          const span = markSpan(navModel, key)
          const scale = xScaleRef.current
          const x = span ? scale(instantOfMs((span.start + span.end) / 2)) : undefined
          handleViewportKey(event, x !== undefined ? clampInnerX(x, innerWidthRef.current) : undefined)
        }
    }
  }, [navModel, focusMark, openMarkMenu, moveMarkInTime, resizeArcEdge, handleViewportKey])

  // One keydown handler for the whole canvas: keys on a mark navigate or act
  // on it; keys on the canvas itself pan and zoom, and Enter/Home/End step
  // into the marks. Ctrl/Cmd/Alt combinations belong to the browser and the
  // app (view switching is Alt+1/2/3), so they are never handled here.
  const handleKeyDown = useCallback((event: React.KeyboardEvent<SVGSVGElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const target = event.target
    const mark = target instanceof Element ? target.closest('[data-mark-key]') : null
    const markKey = mark?.getAttribute('data-mark-key')
    if (mark && markKey) {
      handleMarkKey(event, markKey, mark)
      return
    }
    if (target !== svgRef.current) return

    if (event.key === 'Enter' || event.key === ' ') {
      if (tabStopKey) {
        event.preventDefault()
        focusMark(tabStopKey)
      }
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      const track = navModel.lanes[navModel.lanes.length - 1]
      const item = event.key === 'Home' ? track?.[0] : track?.[track.length - 1]
      if (item) {
        event.preventDefault()
        focusMark(item.key)
      }
      return
    }
    handleViewportKey(event)
  }, [handleMarkKey, handleViewportKey, focusMark, tabStopKey, navModel])

  const handleBlur = useCallback((event: React.FocusEvent<SVGSVGElement>) => {
    const next = event.relatedTarget
    if (!(next instanceof Node && svgRef.current?.contains(next))) focusWithinRef.current = false
  }, [])

  // Remember which mark has focus, so it stays the tab stop.
  const handleFocusCapture = useCallback((event: React.FocusEvent<SVGSVGElement>) => {
    focusWithinRef.current = true
    const target = event.target
    const key = target instanceof Element ? target.closest('[data-mark-key]')?.getAttribute('data-mark-key') : null
    if (key) setActiveMarkKey(key)
  }, [])

  const instructionsId = useId()
  // Per-instance clip id: two timelines on one page must not share one.
  const clipId = `timeline-clip-${instructionsId.replace(/:/g, '')}`
  const ghostLabel = ghost?.label
  const canvasLabel = useMemo(() => {
    const base = `Timeline with ${events.length} events and ${arcs.length} arcs`
    if (ghostLabel === undefined || !ghostEvents) return base
    const diverges = divergenceMs !== null ? `, diverging ${formatHistoricalTimestamp(instantOfMs(divergenceMs))}` : ''
    return `${base}. Branch of ${ghostLabel}${diverges}; the baseline's ${ghostEvents.length} events are drawn faintly beneath for comparison`
  }, [events.length, arcs.length, ghostLabel, ghostEvents, divergenceMs])

  return (
    <div ref={containerRef} className={`timeline-container relative ${className}`}>
      {/* Read by assistive tech when the canvas takes focus. */}
      <p id={`${instructionsId}-keys`} className="sr-only">
        Arrow keys pan the timeline, plus and minus zoom, 0 resets. Tab or Enter moves into the marks. On a
        mark: left and right arrows step through its lane in time order, up and down move between arc rows and
        the event track, Home and End jump to the ends of the lane, Enter selects, Shift with left or right
        arrow moves the mark in time, Shift+F10 opens its actions, and Escape returns to the canvas. On an arc,
        Shift+Enter expands or collapses its sub-arcs, left bracket moves its start and right bracket its end
        outward, and with Shift inward.
      </p>
      {/* A composite widget, not an image: role="img" made the marks
          presentational. The canvas is focusable for pan/zoom (Escape from a
          mark returns here); the one tab stop is a mark (roving tabindex),
          and the canvas only takes Tab itself when there are no marks. */}
      <svg
        ref={svgRef}
        width={width}
        height={svgHeight}
        role="application"
        aria-roledescription="timeline"
        data-timeline-canvas=""
        tabIndex={tabStopKey ? -1 : 0}
        aria-label={canvasLabel}
        aria-describedby={`${instructionsId}-keys`}
        onKeyDown={handleKeyDown}
        onFocus={handleFocusCapture}
        onBlur={handleBlur}
        onDoubleClick={handleSvgDoubleClickGuarded}
        // Chrome colours are theme tokens so the canvas follows html.dark. No
        // inline outline: the global :focus-visible ring (index.css) marks
        // keyboard focus on the canvas itself.
        style={{ border: '1px solid var(--border-subtle)', borderRadius: 4, background: 'var(--surface-card)' }}
      >
        {/* Clip path to constrain content to inner area */}
        <defs>
          <clipPath id={clipId}>
            <rect x={0} y={0} width={innerWidth} height={axisY} />
          </clipPath>
        </defs>
        <g transform={`translate(${margin.left},${margin.top})`}>
          {/* Background */}
          <rect
            x={0}
            y={0}
            width={innerWidth}
            height={axisY}
            style={{ fill: 'var(--surface-card)' }}
          />

          {/* Clipped content area - prevents elements from escaping when zooming */}
          <g clipPath={`url(#${clipId})`}>
            {/* After the split: the branch's own history, washed in the
                divergence amber so "before" and "after" read at a glance. */}
            {divergence && (() => {
              const x = Math.max(0, xScale(divergence))
              if (x >= innerWidth) return null
              return (
                <rect
                  className="timeline-after-divergence"
                  data-testid="timeline-after-divergence"
                  x={x}
                  y={0}
                  width={innerWidth - x}
                  height={axisY}
                  style={{ fill: 'var(--accent-divergence)', fillOpacity: 'var(--divergence-wash)' }}
                  pointerEvents="none"
                  aria-hidden="true"
                />
              )
            })()}

            {/* Point of divergence: a permanent landmark, the full height of the plot. */}
            {divergence && (() => {
              const x = xScale(divergence)
              if (x < -40 || x > innerWidth + 40) return null
              const diamondY = DIVERGENCE_BAND_HEIGHT / 2
              const anchorEnd = x > innerWidth * 0.6
              return (
                <g className="timeline-divergence" data-testid="timeline-divergence" aria-hidden="true" pointerEvents="none">
                  <line
                    x1={x}
                    x2={x}
                    y1={diamondY}
                    y2={axisY}
                    style={{ stroke: 'var(--accent-divergence)' }}
                    strokeWidth={1.5}
                    strokeDasharray="5 4"
                  />
                  <path
                    d={`M ${x} ${diamondY - 6} L ${x + 6} ${diamondY} L ${x} ${diamondY + 6} L ${x - 6} ${diamondY} Z`}
                    style={{ fill: 'var(--accent-divergence)', stroke: 'var(--surface-card)' }}
                    strokeWidth={1.5}
                  />
                  {/* Ink, not amber: amber text at 12px fails contrast on the card. */}
                  <text
                    x={anchorEnd ? x - 10 : x + 10}
                    y={diamondY + 4}
                    textAnchor={anchorEnd ? 'end' : 'start'}
                    fontSize={LABEL_FONT_SIZE}
                    fontWeight={600}
                    style={{ fill: 'var(--text-primary)' }}
                  >
                    Diverges {formatHistoricalTimestamp(divergence)}
                  </text>
                </g>
              )
            })()}

            {/* Where this history's branches split off (see the branchMarks prop).
                The marks are named in the legend below the canvas, which is
                also where they can be opened, so here they are decoration. */}
            {branchMarks && branchMarks.length > 0 && (() => {
              const diamondY = DIVERGENCE_BAND_HEIGHT / 2
              const taken: Array<[number, number]> = []
              return (
                <g className="timeline-branch-marks" data-testid="timeline-branch-marks" aria-hidden="true" pointerEvents="none">
                  {[...branchMarks]
                    .sort((a, b) => a.date.getTime() - b.date.getTime())
                    .map((mark) => {
                      const x = xScale(mark.date)
                      if (x < -10 || x > innerWidth + 10) return null
                      const anchorEnd = x > innerWidth * 0.7
                      const textWidth = mark.label.length * LABEL_FONT_SIZE * 0.56
                      const left = anchorEnd ? x - 10 - textWidth : x + 10
                      const clear = !taken.some(([l, r]) => left < r + 8 && left + textWidth + 8 > l)
                      if (clear) taken.push([left, left + textWidth])
                      return (
                        <g key={mark.id} className="timeline-branch-mark">
                          <line
                            x1={x}
                            x2={x}
                            y1={diamondY + 6}
                            y2={eventY}
                            style={{ stroke: 'var(--accent-divergence)' }}
                            strokeOpacity={0.45}
                            strokeWidth={1}
                            strokeDasharray="1 3"
                          />
                          <path
                            d={`M ${x} ${diamondY - 5} L ${x + 5} ${diamondY} L ${x} ${diamondY + 5} L ${x - 5} ${diamondY} Z`}
                            style={{ fill: 'var(--surface-card)', stroke: 'var(--accent-divergence)' }}
                            strokeWidth={1.75}
                          />
                          {clear && (
                            <text
                              x={anchorEnd ? x - 10 : x + 10}
                              y={diamondY + 4}
                              textAnchor={anchorEnd ? 'end' : 'start'}
                              fontSize={LABEL_FONT_SIZE}
                              style={{ fill: 'var(--text-secondary)' }}
                            >
                              {mark.label}
                            </text>
                          )}
                        </g>
                      )
                    })}
                </g>
              )
            })()}

            {/* Event line (baseline where events appear) */}
            <line
              x1={0}
              y1={eventY}
              x2={innerWidth}
              y2={eventY}
              style={{ stroke: 'var(--border-subtle)' }}
              strokeWidth={1}
              strokeDasharray="4,4"
            />

            {/* The branch's baseline, ghosted beneath the active track: same time
                scale, no interaction. Its marks are hidden from assistive tech;
                the canvas label summarises the comparison instead. */}
            {ghost && layout.ghostY !== null && (
              <g className="timeline-ghost-lane" data-testid="timeline-ghost-lane" pointerEvents="none">
                <line
                  x1={0}
                  x2={innerWidth}
                  y1={layout.ghostY}
                  y2={layout.ghostY}
                  style={{ stroke: 'var(--accent-baseline)' }}
                  strokeOpacity={0.35}
                  strokeWidth={1}
                  strokeDasharray="2 4"
                />
                <text
                  x={4}
                  y={layout.ghostY - 10}
                  fontSize={LABEL_FONT_SIZE}
                  style={{ fill: 'var(--accent-baseline)', stroke: 'var(--surface-card)' }}
                  strokeWidth={3}
                  strokeLinejoin="round"
                  paintOrder="stroke"
                >
                  Baseline: {ghost.label}
                </text>
                <g aria-hidden="true" className="opacity-50 [.high-contrast_&]:opacity-90">
                  {visibleGhostEvents.map(ev => {
                    const dropped = ghostComparison?.dropped.has(ev.id) ?? false
                    return (
                      <circle
                        key={ev.id}
                        className="timeline-ghost-event"
                        data-ghost-event-id={ev.id}
                        data-dropped={dropped ? 'true' : undefined}
                        cx={xScale(toInstant(ev.timestamp))}
                        cy={layout.ghostY ?? 0}
                        r={4}
                        // Hollow: a baseline event the branch no longer has.
                        style={
                          dropped
                            ? { fill: 'var(--surface-card)', stroke: 'var(--accent-baseline)' }
                            : { fill: 'var(--accent-baseline)', stroke: 'none' }
                        }
                        strokeWidth={1.5}
                      />
                    )
                  })}
                </g>
              </g>
            )}

            {/* Causal links, in the band under the stems (timelineLinks.ts).
                Decorative to assistive tech: the inspector lists the causes
                and effects of the selection in words. */}
            {layout.linkBand && (
              <g className="timeline-links" data-testid="timeline-links" aria-hidden="true" pointerEvents="none">
                {drawableLinks.map(link => {
                  const cause = eventsById.get(link.causeId)
                  const effect = eventsById.get(link.effectId)
                  if (!cause || !effect) return null
                  const x1 = xScale(toInstant(cause.timestamp))
                  const x2 = xScale(toInstant(effect.timestamp))
                  if (Math.max(x1, x2) < -40 || Math.min(x1, x2) > innerWidth + 40) return null
                  const role = ripple.links.get(link.id)
                  const onRipple = role !== undefined
                  // At rest a link is coloured by its type, as in the causal
                  // graph; a trace recolours it by its role in the ripple.
                  const stroke = !isTracing
                    ? `var(--link-${link.type})`
                    : role === 'cause'
                      ? 'var(--text-primary)'
                      : onRipple
                        ? 'var(--accent-selected)'
                        : 'var(--text-muted)'
                  const opacity = !isTracing
                    ? restingLinkOpacity(reach.get(link.causeId) ?? 0, maxReach)
                    : role === 'cause'
                      ? 0.85
                      : typeof role === 'number'
                        ? [1, 0.72, 0.5][role - 1] ?? 0.5
                        : 0.08
                  return (
                    <path
                      key={link.id}
                      className="timeline-link"
                      data-link-id={link.id}
                      data-ripple={role === undefined ? undefined : String(role)}
                      d={linkPath(x1, x2, layout.linkBand!.top, layout.linkBand!.height, innerWidth)}
                      fill="none"
                      style={{ stroke }}
                      strokeOpacity={opacity}
                      strokeWidth={linkStrokeWidth(link.weight)}
                      strokeDasharray={LINK_DASH[link.type]}
                      strokeLinecap="round"
                    />
                  )
                })}
              </g>
            )}

            {/* Arcs - using memoized TimelineArc component */}
            {visibleArcs.map(arc => {
              const x1 = xScale(toInstant(arc.start_time))
              const x2 = xScale(toInstant(arc.end_time))
              const y = yScale(arc.renderLevel)
              const w = Math.max(0, x2 - x1)
              return (
                <TimelineArc
                  key={arc.id}
                  arc={arc}
                  x={x1}
                  y={y}
                  width={w}
                  onClick={handleArcClickWithSelection}
                  onContextMenu={handleArcContextMenu}
                  onToggleExpand={handleArcToggle}
                  onResizeStart={handleArcResizeStart}
                  isTabStop={tabStopKey === arcMarkKey(arc.id)}
                  onHoverEnter={handleArcHoverEnter}
                  onHoverLeave={handleHoverLeave}
                />
              )
            })}

            {/* Label leaders: a hairline from each label above the first row
                down to its mark. One layer under every mark and label, so a
                label's halo knocks out any leader that passes behind it. */}
            <g className="timeline-label-leaders" aria-hidden="true" pointerEvents="none">
              {visibleEvents.map(ev => {
                const placement = eventLabels.get(ev.id)
                const firstRow = TIMELINE_LABEL_CONFIG.rowOffsets[0] ?? -20
                if (!placement || placement.offset >= firstRow) return null
                const base = markBaseRadius(ev.id)
                const radius =
                  base + ((highlightedEventIds?.has(ev.id) ?? false) ? 3 : selectedEventId === ev.id ? 2 : 0)
                const x = xScale(toInstant(ev.timestamp))
                const dimmed =
                  isTracing && ev.id !== selectedEventId && !ripple.causes.has(ev.id) && !ripple.effects.has(ev.id)
                return (
                  <line
                    key={ev.id}
                    className="event-label-leader"
                    x1={x}
                    x2={x}
                    y1={eventY + placement.offset + 4}
                    y2={eventY - radius - 2}
                    stroke="var(--text-muted)"
                    strokeOpacity={dimmed ? 0.12 : 0.45}
                    strokeWidth={1}
                  />
                )
              })}
            </g>

            {/* Events - using memoized TimelineEvent component */}
            {visibleEvents.map(ev => {
              const x = xScale(toInstant(ev.timestamp))
              return (
                <TimelineEvent
                  key={ev.id}
                  event={ev}
                  x={x}
                  y={eventY}
                  isHighlighted={highlightedEventIds?.has(ev.id) ?? false}
                  isSelected={selectedEventId === ev.id}
                  isDimmed={
                    isTracing &&
                    ev.id !== selectedEventId &&
                    !ripple.causes.has(ev.id) &&
                    !ripple.effects.has(ev.id)
                  }
                  isBranchOwn={branchOwnIds?.has(ev.id) ?? false}
                  reach={reach.get(ev.id) ?? 0}
                  baseRadius={markBaseRadius(ev.id)}
                  isTabStop={tabStopKey === eventMarkKey(ev.id)}
                  label={eventLabels.get(ev.id) ?? null}
                  onClick={handleEventClick}
                  onContextMenu={handleEventContextMenu}
                  onDragStart={handleEventDragStart}
                  onHoverEnter={handleEventHoverEnter}
                  onHoverLeave={handleHoverLeave}
                />
              )
            })}

            {/* Pressure indicators */}
            {showPressureIndicators && visiblePressures.length > 0 && (
              <PressureIndicators
                pressures={visiblePressures}
                arcs={visibleArcs}
                timeScale={timeScaleWrapper}
                yScale={yScaleWrapper}
                arcLevelMap={arcLevelMap}
                svgRef={svgRef as React.RefObject<SVGSVGElement>}
                onPressureClick={onPressureSelect}
                onPressureHover={onPressureHover}
                showTooltips={true}
              />
            )}

            {/* Drag preview ghost: where the mark would land on release */}
            {dragPreview && (
              <g
                className="timeline-drag-preview"
                data-testid="timeline-drag-preview"
                data-invalid={dragPreview.violation ? 'true' : undefined}
                pointerEvents="none"
              >
                {(() => {
                  const stroke = dragPreview.violation ? '#dc2626' : 'var(--accent-selected)'
                  if (dragPreview.kind === 'event') {
                    return (
                      <>
                        <line
                          x1={dragPreview.x}
                          x2={dragPreview.x}
                          y1={0}
                          y2={axisY}
                          style={{ stroke }}
                          strokeWidth={1}
                          strokeDasharray="3 3"
                        />
                        <circle
                          cx={dragPreview.x}
                          cy={eventY}
                          r={8}
                          fill="none"
                          style={{ stroke }}
                          strokeWidth={2}
                          strokeDasharray="3 2"
                        />
                      </>
                    )
                  }
                  const edgeX = dragPreview.edge === 'start' ? dragPreview.x1 : dragPreview.x2
                  return (
                    <>
                      <line
                        x1={edgeX}
                        x2={edgeX}
                        y1={0}
                        y2={axisY}
                        style={{ stroke }}
                        strokeWidth={1}
                        strokeDasharray="3 3"
                      />
                      <rect
                        x={dragPreview.x1}
                        y={dragPreview.y}
                        width={Math.max(0, dragPreview.x2 - dragPreview.x1)}
                        height={ARC_BAR_HEIGHT}
                        rx={3}
                        fill="none"
                        style={{ stroke }}
                        strokeWidth={2}
                        strokeDasharray="4 2"
                      />
                    </>
                  )
                })()}
              </g>
            )}
          </g>

          {/* Time axis */}
          <g transform={`translate(0,${axisY})`}>
            <line x1={0} y1={0} x2={innerWidth} y2={0} style={{ stroke: 'var(--text-muted)' }} strokeWidth={1} />
            {(() => {
              // 12px monospace labels need about 96px each.
              const maxTicks = Math.min(10, Math.floor(innerWidth / 96))
              // Ticks and labels in UTC, as the event labels read every date
              // (local-time ticks put 1 January 1843 (UTC) on the wrong side
              // of the "1843" tick west of Greenwich); in a world calendar, on
              // its own years, months, days and hours. Labelled as a set, so
              // two ticks never share a label.
              const ticks = axisTicks(xScale.domain(), maxTicks > 0 ? maxTicks : 5, worldCalendar)
              return ticks.map(({ date: tick, label }, i) => (
                <g key={i} transform={`translate(${xScale(tick)},0)`}>
                  <line y1={0} y2={6} style={{ stroke: 'var(--text-muted)' }} strokeWidth={1} />
                  <text
                    y={20}
                    textAnchor="middle"
                    fontSize={LABEL_FONT_SIZE}
                    className="font-mono-code"
                    style={{ fill: 'var(--text-muted)' }}
                  >
                    {label}
                  </text>
                </g>
              ))
            })()}
          </g>
        </g>
      </svg>

      {/* Hover/focus tooltip (Tier 1: React owns the DOM per ADR-001). An
          inverse surface in a fixed colour: the gray scale is inverted under
          html.dark, so bg-gray-900 would turn light there. */}
      {/* Drag preview readout: the date the mark would land on, and the
          guardrail it would hit, before the user lets go. */}
      {dragPreview && (() => {
        const anchorX = dragPreview.kind === 'event'
          ? dragPreview.x
          : dragPreview.edge === 'start' ? dragPreview.x1 : dragPreview.x2
        const anchorY = dragPreview.kind === 'event' ? eventY - 44 : dragPreview.y - 30
        const label = dragPreview.kind === 'event'
          ? formatHistoricalTimestamp(dragPreview.timestamp)
          : `${formatHistoricalTimestamp(dragPreview.bounds.start)} – ${formatHistoricalEnd(dragPreview.bounds.end)}`
        return (
          <div
            data-testid="timeline-drag-readout"
            className={`pointer-events-none absolute z-20 w-max max-w-md -translate-x-1/2 rounded-md border px-2 py-1 text-xs shadow-sm ${
              dragPreview.violation
                ? 'border-red-300 bg-red-50 text-red-900 dark:border-red-400/60 dark:bg-red-950 dark:text-red-100'
                : 'border-line bg-card text-ink'
            }`}
            style={{
              left: Math.min(Math.max(margin.left + anchorX, 80), width - 80),
              top: Math.max(0, margin.top + anchorY),
            }}
          >
            <div className="font-mono-code whitespace-nowrap">
              {dragPreview.kind === 'event' ? 'Move to ' : dragPreview.edge === 'start' ? 'Start → ' : 'End → '}
              {label}
            </div>
            {dragPreview.violation ? (
              <div className="mt-0.5 font-medium">{dragPreview.violation}</div>
            ) : (
              <div className="mt-0.5 text-ink-muted">Release to save · Esc to cancel</div>
            )}
          </div>
        )
      })()}

      {hovered && !dragPreview && (
        <div
          role="tooltip"
          // The same readout as the causal graph's: a card on the theme's
          // surfaces, not a fixed dark slab, so a hover looks the same in
          // every lens and in both themes.
          className="timeline-tooltip pointer-events-none absolute z-10 max-w-xs rounded-md border border-line bg-card px-3 py-2 text-xs text-ink shadow-lg"
          style={tooltipPlacement(
            hovered,
            margin,
            width,
            layout.linkBand ? EVENT_STEM_LENGTH + layout.linkBand.height : 0
          )}
        >
          {hovered.kind === 'event' ? (
            <>
              <div className="text-sm font-semibold">{hovered.event.description}</div>
              <div className="mt-0.5 text-ink-secondary">{hovered.event.actor} → {hovered.event.target}</div>
              <div className="font-mono-code text-ink-muted">{formatEventDate(hovered.event)}</div>
            </>
          ) : (
            <>
              <div className="text-sm font-semibold">{hovered.arc.name}</div>
              <div className="mt-0.5 font-mono-code text-ink-muted">
                {formatHistoricalTimestamp(hovered.arc.start_time)} – {formatHistoricalEnd(hovered.arc.end_time)}
              </div>
              <div className="tabular-nums">
                {formatDuration(toInstant(hovered.arc.start_time), toInstant(hovered.arc.end_time))}
                {' · '}
                {hovered.arc.eventCount} {hovered.arc.eventCount === 1 ? 'event' : 'events'}
              </div>
            </>
          )}
        </div>
      )}

      {/* No Fit to View chip inside the canvas: the toolbar's Fit to View (and
          F) always does it, and the chip, wherever it went, covered something:
          the arc lane at the top, an axis year at the bottom. */}

      {/* Event Arc Assignment Modal */}
      {eventAssignmentModal.isOpen && eventAssignmentModal.event && (
        <div className="fixed z-50" style={{ left: eventAssignmentModal.position?.x ?? 0, top: eventAssignmentModal.position?.y ?? 0 }}>
          <EventArcAssignment
            event={eventAssignmentModal.event}
            availableArcs={arcs}
            onAssign={handleEventAssignment}
            onCancel={handleEventAssignmentCancel}
          />
        </div>
      )}
    </div>
  )
})

// Named export for tests, default export for general usage
export { Timeline }
export default Timeline