import React, { useMemo, useRef, useState, useEffect } from 'react'
import * as d3 from 'd3'
import { Event, Arc, TimeRange } from '@/types'
import { PressureWithContext } from '@/types/pressure'
import { ArcWithUIState, calculateArcHierarchy, processArcsWithUIState } from './arcHierarchyUtils'
import EventArcAssignment from './EventArcAssignment'
import PressureIndicators from './PressureIndicators'

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

  const innerWidth = Math.max(0, width - margin.left - margin.right)
  const innerHeight = Math.max(0, height - margin.top - margin.bottom)

  // Compute x-domain from arcs and events
  const [xDomainStart, xDomainEnd] = useMemo(() => {
    const times: number[] = []
    for (const e of events) {
      const t = new Date(e.timestamp).getTime()
      if (!Number.isNaN(t)) times.push(t)
    }
    for (const a of arcs) {
      const s = new Date(a.start_time).getTime()
      const e = new Date(a.end_time).getTime()
      if (!Number.isNaN(s)) times.push(s)
      if (!Number.isNaN(e)) times.push(e)
    }
    if (times.length === 0) {
      const now = Date.now()
      return [new Date(now - 1000 * 60 * 60 * 24 * 30), new Date(now + 1000 * 60 * 60 * 24 * 30)] // ±30 days
    }
    return [new Date(Math.min(...times)), new Date(Math.max(...times))]
  }, [events, arcs])

  const xScale = useMemo(() => {
    return d3.scaleTime().domain([xDomainStart, xDomainEnd]).range([0, innerWidth]).nice()
  }, [xDomainStart, xDomainEnd, innerWidth])

  // Expose time range upwards
  useEffect(() => {
    onTimeRangeChange?.({ start: xDomainStart, end: xDomainEnd })
  }, [xDomainStart, xDomainEnd, onTimeRangeChange])

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

  // Handlers
  const handleEventContextMenu = (evt: React.MouseEvent, ev: Event) => {
    evt.preventDefault()
    setEventAssignmentModal({ isOpen: true, event: ev, position: { x: evt.pageX, y: evt.pageY } })
  }

  const handleEventAssignment = async (eventId: string, arcId: string | null) => {
    const ev = events.find(e => e.id === eventId)
    const arc = arcId ? arcs.find(a => a.id === arcId) : null
    if (ev && arc && onEventAssignToArc) await onEventAssignToArc(ev, arc)
    setEventAssignmentModal({ isOpen: false, event: null, position: null })
  }

  const handleEventAssignmentCancel = () => {
    setEventAssignmentModal({ isOpen: false, event: null, position: null })
  }

  // Optional: double click to create event at position
  const handleSvgDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!onEventCreate) return
    const svg = svgRef.current
    if (!svg) return
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const ctm = (e.target as SVGElement).ownerSVGElement?.getScreenCTM()
    if (!ctm) return
    const inv = ctm.inverse()
    const local = pt.matrixTransform(inv)
    const x = local.x - margin.left
    const t = xScale.invert(Math.max(0, Math.min(innerWidth, x)))
    onEventCreate(t)
  }

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
                  onClick={() => onArcSelect?.(arc)}
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
                  onClick={() => onEventSelect?.(ev)}
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

export default Timeline