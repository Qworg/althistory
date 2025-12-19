import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react'
import { Event, Arc, TimeRange } from '@/types'
import { PressureWithContext } from '@/types/pressure'
import { ArcWithUIState, calculateArcHierarchy, processArcsWithUIState } from './arcHierarchyUtils'
import EventArcAssignment from './EventArcAssignment'
import PressureIndicators from './PressureIndicators'
import { useTimelineScales } from '@/hooks/useTimelineScales'
import { useTimelineEventHandlers } from '@/hooks/useTimelineEventHandlers'

export interface TimelineProps {
  events: Event[]
  arcs: Arc[]
  pressures?: PressureWithContext[]
  width?: number
  height?: number
  margin?: { top: number; right: number; bottom: number; left: number }
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
  showPressureIndicators?: boolean
  className?: string
}

const Timeline: React.FC<TimelineProps> = ({
  events,
  arcs,
  pressures = [],
  width = 1000,
  height = 420,
  margin = { top: 16, right: 16, bottom: 40, left: 56 },
  onEventSelect,
  onArcSelect,
  onPressureSelect,
  onPressureHover,
  onTimeRangeChange,
  onEventCreate,
  onEventAssignToArc,
  showPressureIndicators = true,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const [eventAssignmentModal, setEventAssignmentModal] = useState<{
    isOpen: boolean
    event: Event | null
    position: { x: number; y: number } | null
  }>({ isOpen: false, event: null, position: null })

  // Use custom hook for memoized scale calculations (Phase 2.2)
  const { xScale, innerWidth, innerHeight, xDomain } = useTimelineScales(
    events,
    arcs,
    width,
    height,
    margin
  )

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
    const withState: ArcWithUIState[] = processArcsWithUIState(arcs, events, new Set(), new Set()) as unknown as ArcWithUIState[]
    return calculateArcHierarchy(withState)
  }, [arcs, events])

  const arcLevelMap = useMemo(() => new Map(arcHierarchy.map(a => [a.id, a.renderLevel])), [arcHierarchy])

  // Y scale for arc levels
  const yScale = useMemo(() => {
    const levelHeight = 28
    return (level: number) => 10 + level * levelHeight
  }, [])

  // Event y position
  const eventY = innerHeight - 30

  // Use custom hook for stable event handlers (Phase 2.2)
  const { handleEventClick, handleArcClick, handleSvgDoubleClick } = useTimelineEventHandlers({
    onEventSelect,
    onArcSelect,
    onEventCreate,
    xScale,
    margin,
    innerWidth
  })

  // Context menu handler for event arc assignment
  const handleEventContextMenu = useCallback((evt: React.MouseEvent, ev: Event) => {
    evt.preventDefault()
    setEventAssignmentModal({ isOpen: true, event: ev, position: { x: evt.pageX, y: evt.pageY } })
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

  return (
    <div ref={containerRef} className={`timeline-container ${className}`}>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        role="img"
        aria-label={`Timeline with ${events.length} events and ${arcs.length} arcs`}
        onDoubleClick={handleSvgDoubleClick}
        style={{ border: '1px solid #e5e7eb', borderRadius: 4 }}
      >
        <g transform={`translate(${margin.left},${margin.top})`}>
          {/* Arcs */}
          {arcHierarchy.map(arc => {
            const x1 = xScale(new Date(arc.start_time))
            const x2 = xScale(new Date(arc.end_time))
            const y = yScale(arc.renderLevel)
            const w = Math.max(0, x2 - x1)
            return (
              <g key={arc.id} className="arc" data-arc-id={arc.id}>
                <rect
                  className="arc-main"
                  x={x1}
                  y={y}
                  width={w}
                  height={16}
                  fill={arc.isSelected ? '#60a5fa' : '#93c5fd'}
                  stroke="#6b7280"
                  strokeWidth={1}
                  rx={3}
                  onClick={() => handleArcClick(arc)}
                />
                <text x={x1 + 4} y={y - 2} fontSize={10} fill="#6b7280">{arc.name}</text>
              </g>
            )
          })}

          {/* Events */}
          {events.map(ev => {
            const x = xScale(new Date(ev.timestamp))
            return (
              <g
                key={ev.id}
                className="event"
                data-event-id={ev.id}
                transform={`translate(${x}, ${eventY})`}
                tabIndex={0}
                role="button"
                aria-label={`Event: ${ev.description} by ${ev.actor} targeting ${ev.target} at ${new Date(ev.timestamp).toLocaleString()}`}
              >
                <circle
                  className="event-marker"
                  r={6}
                  fill="#f59e0b"
                  stroke="#ffffff"
                  strokeWidth={2}
                  onClick={() => handleEventClick(ev)}
                  onContextMenu={(e) => handleEventContextMenu(e, ev)}
                />
                <line x1={0} y1={0} x2={0} y2={20} stroke="#6b7280" strokeWidth={1} />
              </g>
            )
          })}

          {/* Pressure indicators */}
          {showPressureIndicators && pressures.length > 0 && (
            <PressureIndicators
              pressures={pressures}
              arcs={arcs}
              timeScale={(d: Date) => xScale(d)}
              yScale={(level: number) => yScale(level)}
              arcLevelMap={arcLevelMap}
              svgRef={svgRef as unknown as React.RefObject<SVGSVGElement>}
              onPressureClick={onPressureSelect}
              onPressureHover={onPressureHover}
              showTooltips={true}
            />
          )}
        </g>
      </svg>

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
}

// Named export for tests, default export for general usage
export { Timeline }
export default Timeline