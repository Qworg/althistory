import React, { useMemo, useRef, useState, useEffect, useCallback, memo } from 'react'
import * as d3 from 'd3'
import { Event, Arc, TimeRange } from '@/types'
import { PressureWithContext } from '@/types/pressure'
import { calculateArcHierarchy, processArcsWithUIState } from './arcHierarchyUtils'
import { formatTimeAxisTick } from '@/utils/d3Calculations'
import EventArcAssignment from './EventArcAssignment'
import PressureIndicators from './PressureIndicators'
import { TimelineEvent } from './TimelineEvent'
import { TimelineArc } from './TimelineArc'
import { useTimelineScales } from '@/hooks/useTimelineScales'
import { useTimelineEventHandlers } from '@/hooks/useTimelineEventHandlers'

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
  showPressureIndicators?: boolean
  className?: string
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
  onEventAssignToArc,
  onEventContextMenu,
  onArcContextMenu,
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

  // Create xScale based on visible range (or original if not set)
  const xScale = useMemo(() => {
    const range = visibleTimeRange || originalExtent
    return d3.scaleTime()
      .domain([range.start, range.end])
      .range([0, innerWidth])
  }, [visibleTimeRange, originalExtent, innerWidth])

  // Stable ref for time range callback to avoid infinite loops (Phase 2.3)
  // See: impl/deferredplans/ADR-001-d3-react-integration.md
  const onTimeRangeChangeRef = useRef(onTimeRangeChange)
  onTimeRangeChangeRef.current = onTimeRangeChange

  // Expose time range upwards - callback NOT in dependencies to prevent infinite loops
  useEffect(() => {
    onTimeRangeChangeRef.current?.({ start: xDomain[0], end: xDomain[1] })
  }, [xDomain[0]?.getTime(), xDomain[1]?.getTime()])

  // Arc hierarchy and levels
  const { arcHierarchy } = useMemo(() => {
    const withState = processArcsWithUIState(arcs, events, new Set(), new Set())
    return calculateArcHierarchy(withState)
  }, [arcs, events])

  const arcLevelMap = useMemo(() => new Map(arcHierarchy.map(a => [a.id, a.renderLevel])), [arcHierarchy])

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

    zoomRef.current = zoom
    svg.call(zoom)

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

  return (
    <div ref={containerRef} className={`timeline-container relative ${className}`}>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        role="img"
        aria-label={`Timeline with ${events.length} events and ${arcs.length} arcs`}
        onDoubleClick={handleSvgDoubleClick}
        style={{ border: '1px solid #e5e7eb', borderRadius: 4, background: '#fafafa' }}
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
            {arcHierarchy.map(arc => {
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
                  onClick={handleArcClick}
                  onContextMenu={handleArcContextMenu}
                />
              )
            })}

            {/* Events - using memoized TimelineEvent component */}
            {events.map(ev => {
              const x = xScale(new Date(ev.timestamp))
              return (
                <TimelineEvent
                  key={ev.id}
                  event={ev}
                  x={x}
                  y={eventY}
                  onClick={handleEventClick}
                  onContextMenu={handleEventContextMenu}
                />
              )
            })}

            {/* Pressure indicators */}
            {showPressureIndicators && pressures.length > 0 && (
              <PressureIndicators
                pressures={pressures}
                arcs={arcs}
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
              const range = visibleTimeRange || originalExtent
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