import React, { useMemo, useRef, useState, useEffect, useCallback, memo } from 'react'
import * as d3 from 'd3'
import { Event, Arc, TimeRange } from '@/types'
import { PressureWithContext } from '@/types/pressure'
import { type ArcWithUIState, calculateArcHierarchy, processArcsWithUIState } from './arcHierarchyUtils'
import { formatDuration, formatTimeAxisTick } from '@/utils/d3Calculations'
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

export interface TimelineProps {
  events: Event[]
  arcs: Arc[]
  pressures?: PressureWithContext[]
  width?: number
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
  showPressureIndicators?: boolean
  className?: string
}

/** The element currently under the pointer (or keyboard focus), with its inner-SVG position. */
type HoveredElement =
  | { kind: 'event'; event: Event; x: number; y: number }
  | { kind: 'arc'; arc: ArcWithUIState; x: number; y: number }

/** A gesture in progress, resolved against the shared time scale on mouseup. */
type TimelineDrag =
  | { type: 'event'; event: Event }
  | { type: 'arc-resize'; arc: Arc; edge: ArcResizeEdge }

/** Pointer travel (px) required before a mousedown is treated as a drag rather than a click. */
const DRAG_THRESHOLD_PX = 3

/** Inline-style highlight applied to the mark being dragged (see beginDrag). */
const DRAG_HIGHLIGHT_FILTER = 'drop-shadow(0 0 4px rgba(37, 99, 235, 0.95))'

/** Keep an inner-SVG x inside the plotted range, mirroring the double-click handler. */
function clampInnerX(innerX: number, innerWidth: number): number {
  return Math.max(0, Math.min(innerWidth, innerX))
}

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
 * @see impl/deferredplans/01-timeline-architecture-refactor.md (Phase 3.3)
 */
const Timeline = memo(function Timeline({
  events,
  arcs,
  pressures = [],
  width = 1000,
  height = 420,
  margin = { top: 16, right: 16, bottom: 40, left: 56 },
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
  onEventAssignToArc,
  onEventContextMenu,
  onArcContextMenu,
  highlightedEventIds,
  showPressureIndicators = true,
  className = '',
}: TimelineProps) {
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

  // Use custom hook for memoized scale calculations (Phase 2.2)
  // This gives us the original domain from events/arcs
  const { innerWidth, innerHeight, xDomain } = useTimelineScales(
    events,
    arcs,
    width,
    height,
    margin,
    1 // Always fit to view for original extent
  )

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
    return d3.scaleTime()
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

  // Stable ref for time range callback to avoid infinite loops (Phase 2.3)
  // See: impl/deferredplans/ADR-001-d3-react-integration.md
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
  const innerWidthRef = useRef(innerWidth)
  innerWidthRef.current = innerWidth
  const marginLeftRef = useRef(margin.left)
  marginLeftRef.current = margin.left

  const onEventDragRef = useRef(onEventDrag)
  onEventDragRef.current = onEventDrag
  const onArcResizeRef = useRef(onArcResize)
  onArcResizeRef.current = onArcResize
  const onArcExpandRef = useRef(onArcExpand)
  onArcExpandRef.current = onArcExpand
  const onArcCollapseRef = useRef(onArcCollapse)
  onArcCollapseRef.current = onArcCollapse
  const expandedArcIdsRef = useRef(expandedArcIds)
  expandedArcIdsRef.current = expandedArcIds

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

  // Y scale for arc levels - constant function, memoized once
  const yScale = useMemo(() => {
    const levelHeight = 28
    return (level: number) => 10 + level * levelHeight
  }, [])

  // Event y position - memoized to avoid recalculation on every render
  const eventY = useMemo(() => innerHeight - 30, [innerHeight])

  // Memoized scale wrappers for PressureIndicators to prevent re-renders
  const timeScaleWrapper = useCallback((d: Date) => xScale(d), [xScale])
  const yScaleWrapper = useCallback((level: number) => yScale(level), [yScale])

  // Use custom hook for stable event handlers (Phase 2.2)
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

  // Context menu handler for events
  const handleEventContextMenu = useCallback((evt: React.MouseEvent, ev: Event) => {
    evt.preventDefault()
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
      const originInnerX = scale(new Date(event.timestamp))
      const nextInnerX = originInnerX + (currentInnerX - startInnerX)
      return scale.invert(clampInnerX(nextInnerX, innerWidthRef.current))
    },
    [clientXToInnerX]
  )

  // A mousedown only becomes a drag once the pointer travels past a threshold,
  // so a plain click never fires the drag/resize callbacks. `source` is the
  // element the gesture started on; its mark gets the transient drag highlight.
  const beginDrag = useCallback((drag: TimelineDrag, startClientX: number, source: Element | null) => {
    let moved = false
    let cleanup = () => {}

    const mark = source?.closest('[data-timeline-mark]') ?? source
    const restoreMark = highlightDraggedMark(mark)

    const handleMouseMove = (native: MouseEvent) => {
      if (!moved && Math.abs(native.clientX - startClientX) < DRAG_THRESHOLD_PX) return
      moved = true
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
        if (timestamp.getTime() === new Date(drag.event.timestamp).getTime()) return
        onEventDragRef.current?.(drag.event, timestamp)
        return
      }
      const timestamp = clientXToDate(native.clientX)
      if (!timestamp) return
      const start = new Date(drag.arc.start_time)
      const end = new Date(drag.arc.end_time)
      if (drag.edge === 'start') {
        onArcResizeRef.current?.(drag.arc, {
          start: timestamp.getTime() > end.getTime() ? end : timestamp,
          end
        })
      } else {
        onArcResizeRef.current?.(drag.arc, {
          start,
          end: timestamp.getTime() < start.getTime() ? start : timestamp
        })
      }
    }

    cleanup = () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      dragCleanupRef.current = null
      restoreMark()
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    dragCleanupRef.current = cleanup
  }, [clientXToDate, draggedTime])

  const handleEventDragStart = useCallback((event: Event, native: React.MouseEvent) => {
    if (native.button !== 0) return
    beginDrag({ type: 'event', event }, native.clientX, native.currentTarget)
  }, [beginDrag])

  const handleArcResizeStart = useCallback((arc: ArcWithUIState, edge: ArcResizeEdge, native: React.MouseEvent) => {
    if (native.button !== 0) return
    beginDrag({ type: 'arc-resize', arc, edge }, native.clientX, native.currentTarget)
  }, [beginDrag])

  const handleArcResizeKey = useCallback((arc: ArcWithUIState, edge: ArcResizeEdge, direction: -1 | 1) => {
    const start = new Date(arc.start_time)
    const end = new Date(arc.end_time)
    const span = Math.max(end.getTime() - start.getTime(), 1)
    const step = Math.max(span * 0.05, 60 * 60 * 1000)
    if (edge === 'start') {
      const nextStart = Math.min(start.getTime() + direction * step, end.getTime())
      onArcResizeRef.current?.(arc, { start: new Date(nextStart), end })
    } else {
      const nextEnd = Math.max(end.getTime() + direction * step, start.getTime())
      onArcResizeRef.current?.(arc, { start, end: new Date(nextEnd) })
    }
  }, [])

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
    const baseTimeScale = d3.scaleTime()
      .domain([originalExtent.start, originalExtent.end])
      .range([0, innerWidth])

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 20])
      .translateExtent([[0, 0], [width, height]])
      .extent([[0, 0], [width, height]])
      .on('zoom', (event) => {
        const { transform } = event

        // Calculate new domain from the ORIGINAL scale
        const newTimeScale = transform.rescaleX(baseTimeScale)
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

    return () => {
      svg.on('.zoom', null)
    }
  }, [originalExtent, innerWidth, width, height])

  // Check if zoomed (for showing reset button)
  const isZoomed = useMemo(() => {
    if (!visibleTimeRange) return false
    const origRange = originalExtent.end.getTime() - originalExtent.start.getTime()
    const visRange = visibleTimeRange.end.getTime() - visibleTimeRange.start.getTime()
    return Math.abs(origRange - visRange) > 1000 // More than 1 second difference
  }, [visibleTimeRange, originalExtent])

  // Keyboard navigation for timeline canvas (arrow keys pan, +/- zoom, 0 reset)
  const handleKeyDown = useCallback((event: React.KeyboardEvent<SVGSVGElement>) => {
    if (!svgRef.current || !zoomRef.current) return

    const svg = d3.select(svgRef.current)
    const panStep = 60

    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault()
        svg.call(zoomRef.current.translateBy, panStep, 0)
        break
      case 'ArrowRight':
        event.preventDefault()
        svg.call(zoomRef.current.translateBy, -panStep, 0)
        break
      case '+':
      case '=':
        event.preventDefault()
        svg.call(zoomRef.current.scaleBy, 1.25)
        break
      case '-':
      case '_':
        event.preventDefault()
        svg.call(zoomRef.current.scaleBy, 0.8)
        break
      case '0':
        event.preventDefault()
        handleResetZoom()
        break
      default:
        break
    }
  }, [handleResetZoom])

  return (
    <div ref={containerRef} className={`timeline-container relative ${className}`}>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        role="img"
        tabIndex={0}
        aria-label={`Timeline with ${events.length} events and ${arcs.length} arcs`}
        onKeyDown={handleKeyDown}
        onDoubleClick={handleSvgDoubleClickGuarded}
        style={{ border: '1px solid #e5e7eb', borderRadius: 4, background: '#fafafa', outline: 'none' }}
      >
        {/* Clip path to constrain content to inner area */}
        <defs>
          <clipPath id="timeline-clip">
            <rect x={0} y={0} width={innerWidth} height={innerHeight} />
          </clipPath>
        </defs>
        <g transform={`translate(${margin.left},${margin.top})`}>
          {/* Background */}
          <rect
            x={0}
            y={0}
            width={innerWidth}
            height={innerHeight}
            fill="#fafafa"
          />

          {/* Clipped content area - prevents elements from escaping when zooming */}
          <g clipPath="url(#timeline-clip)">
            {/* Event line (baseline where events appear) */}
            <line
              x1={0}
              y1={eventY}
              x2={innerWidth}
              y2={eventY}
              stroke="#d1d5db"
              strokeWidth={1}
              strokeDasharray="4,4"
            />

            {/* Arcs - using memoized TimelineArc component */}
            {visibleArcs.map(arc => {
              const x1 = xScale(new Date(arc.start_time))
              const x2 = xScale(new Date(arc.end_time))
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
                  onResizeKey={handleArcResizeKey}
                  onHoverEnter={handleArcHoverEnter}
                  onHoverLeave={handleHoverLeave}
                />
              )
            })}

            {/* Events - using memoized TimelineEvent component */}
            {visibleEvents.map(ev => {
              const x = xScale(new Date(ev.timestamp))
              return (
                <TimelineEvent
                  key={ev.id}
                  event={ev}
                  x={x}
                  y={eventY}
                  isHighlighted={highlightedEventIds?.has(ev.id) ?? false}
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
          </g>

          {/* Time axis */}
          <g transform={`translate(0,${innerHeight})`}>
            <line x1={0} y1={0} x2={innerWidth} y2={0} stroke="#9ca3af" strokeWidth={1} />
            {(() => {
              const range = currentRange
              const timeSpanMs = range.end.getTime() - range.start.getTime()
              const maxTicks = Math.min(10, Math.floor(innerWidth / 80))
              // Use count-based ticks for reliability, format based on time span
              const ticks = xScale.ticks(maxTicks > 0 ? maxTicks : 5)
              return ticks.map((tick, i) => (
                <g key={i} transform={`translate(${xScale(tick)},0)`}>
                  <line y1={0} y2={6} stroke="#9ca3af" strokeWidth={1} />
                  <text
                    y={20}
                    textAnchor="middle"
                    fontSize={10}
                    fill="#6b7280"
                  >
                    {formatTimeAxisTick(tick, timeSpanMs)}
                  </text>
                </g>
              ))
            })()}
          </g>
        </g>
      </svg>

      {/* Hover/focus tooltip (Tier 1: React owns the DOM per ADR-001) */}
      {hovered && (
        <div
          role="tooltip"
          className="timeline-tooltip pointer-events-none absolute z-10 rounded bg-gray-900/95 px-2 py-1 text-xs text-white shadow"
          style={{ left: margin.left + hovered.x + 8, top: margin.top + hovered.y + 8 }}
        >
          {hovered.kind === 'event' ? (
            <>
              <div className="font-semibold">{hovered.event.description}</div>
              <div>{hovered.event.actor} → {hovered.event.target}</div>
              <div>{new Date(hovered.event.timestamp).toLocaleString()}</div>
            </>
          ) : (
            <>
              <div className="font-semibold">{hovered.arc.name}</div>
              <div>
                {new Date(hovered.arc.start_time).toLocaleString()} – {new Date(hovered.arc.end_time).toLocaleString()}
              </div>
              <div>
                {formatDuration(new Date(hovered.arc.start_time), new Date(hovered.arc.end_time))}
                {' · '}
                {hovered.arc.eventCount} {hovered.arc.eventCount === 1 ? 'event' : 'events'}
              </div>
            </>
          )}
        </div>
      )}

      {/* Fit to View button (shown when zoomed) */}
      {isZoomed && (
        <button
          onClick={handleResetZoom}
          className="absolute top-2 right-2 px-3 py-1 text-xs bg-white border border-gray-300 rounded shadow-sm hover:bg-gray-50 transition-colors flex items-center gap-1"
          title="Fit all events in view (F)"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
          </svg>
          Fit to View
        </button>
      )}

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