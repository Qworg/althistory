import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import * as d3 from 'd3'
import { Event, Arc, TimeRange } from '@/types'
import { formatTimeAxisTick, getTimeAxisInterval } from '@/utils/d3Calculations'
import { formatHistoricalTimestamp } from '@/utils/historicalTime'
import { truncateToWidth } from '@/utils'
import { layoutEventLabels, type EventLabelPlacement, type LabelLayoutConfig } from './eventLabelLayout'

/** Two rows of 12px labels (the 12px floor); the pitch is the font plus leading. */
const ACTOR_LABEL_CONFIG: LabelLayoutConfig = { rowOffsets: [-16, -30], fontSize: 12 }
/** Rows under a mark, for a label with no room above it. */
const ACTOR_LABEL_BELOW_CONFIG: LabelLayoutConfig = { rowOffsets: [24, 38], fontSize: 12 }
/**
 * Arc names are drawn at 12px medium, which runs wider than the regular
 * weight the estimate assumes; measured at 13px so two neighbouring names do
 * not overprint ("The Calculating O… / Engines on the Wi…").
 */

export interface ActorEventData extends Event {
  role: 'actor' | 'target'
  isHighlighted: boolean
}

export interface ActorTimelineProps {
  events: ActorEventData[]
  arcs: Arc[]
  actor: string
  layoutMode: 'chronological' | 'thematic'
  width?: number
  height?: number
  margin?: { top: number; right: number; bottom: number; left: number }
  onEventSelect?: (event: Event) => void
  onTimeRangeChange?: (range: TimeRange) => void
  className?: string
}

export interface ActorTimelineState {
  zoomLevel: number
  visibleTimeRange: TimeRange
  selectedEventId: string | null
  hoveredEventId: string | null
}

const DEFAULT_MARGIN = { top: 20, right: 20, bottom: 60, left: 80 }

/** Approximate advance of one character of the 11px monospace tick labels. */
const TICK_CHAR_PX = 6.6
/** Clear space wanted between two upright tick labels. */
const TICK_GAP_PX = 8
/** Baseline of the first arc row's name, and the step to the next row. */
const ARC_LABEL_TOP = 15
const ARC_LABEL_ROW_STEP = 24
/** The arc lane takes at most this many rows; the event lanes own the space below. */
const ARC_LABEL_MAX_ROWS = 3
/** Height of an arc bar, which sits just under its name. */
const ARC_BAR_HEIGHT = 6
/** Least gap between two bars sharing a row. */
const ARC_BAR_GAP_PX = 4
/** A bar narrower than this is drawn without its name (it would be all ellipsis). */
const ARC_MIN_LABEL_PX = 40

/** Role colours: the data encoding of the chart, shared by marks and legend. */
/** Role colours (index.css tokens). Shape carries the role too: filled acts, ring is acted on. */
const ROLE_COLOR = { actor: 'var(--role-actor)', target: 'var(--role-target)' } as const
/** Lighter role colours for text on the (always dark) tooltip surface. */
const ROLE_TOOLTIP_COLOR = { actor: '#60a5fa', target: '#34d399' } as const

/** The element a mark is drawn for, and the position (inner-plot coordinates) it is drawn at. */
interface PlacedEvent {
  event: ActorEventData
  x: number
  y: number
}

/**
 * The actor-perspective chart.
 *
 * ADR-001 Tier 1 for structure: React renders the axes, grid, arc bands, event
 * marks, tooltip and Fit to View button; d3 supplies the scales and ticks.
 * Zoom/pan is Tier 2 -- d3.zoom is attached to the React-rendered <svg> and
 * the resulting domain is held in state. This component used to build all of
 * that imperatively with d3.select().append(), including a tooltip appended to
 * document.body.
 *
 * @see docs/adr-001-d3-react-integration.md
 */
export const ActorTimeline: React.FC<ActorTimelineProps> = ({
  events = [],
  arcs = [],
  actor,
  layoutMode = 'chronological',
  width = 800,
  height = 400,
  margin: marginProp = DEFAULT_MARGIN,
  onEventSelect,
  onTimeRangeChange,
  className = ''
}) => {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const zoomTransformRef = useRef<d3.ZoomTransform>(d3.zoomIdentity)

  // Calculate original time extent from events (memoized, doesn't change with zoom)
  const originalTimeExtent = useMemo(() => {
    if (events.length === 0) {
      return {
        start: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
        end: new Date()
      }
    }
    const times = events.map(e => new Date(e.timestamp).getTime())
    const first = Math.min(...times)
    const last = Math.max(...times)
    // Pad by a share of the span, not a fixed day: on a span of years one day
    // put the first and last events on the chart's edges.
    const padding = Math.max(86400000, (last - first) * 0.03)
    return {
      start: new Date(first - padding),
      end: new Date(last + padding)
    }
  }, [events])

  const [state, setState] = useState<ActorTimelineState>({
    zoomLevel: 1,
    visibleTimeRange: originalTimeExtent,
    selectedEventId: null,
    hoveredEventId: null
  })
  // The mark under the pointer or keyboard focus, which the tooltip describes.
  const [tooltipFor, setTooltipFor] = useState<PlacedEvent | null>(null)

  // Memoised by value: a caller (or the default) passing a fresh object each
  // render made every calculation that depends on the margin re-run every render.
  const { top: marginTop, right: marginRight, bottom: marginBottom, left: marginLeft } = marginProp
  const margin = useMemo(
    () => ({ top: marginTop, right: marginRight, bottom: marginBottom, left: marginLeft }),
    [marginTop, marginRight, marginBottom, marginLeft]
  )

  // Calculate dimensions
  const innerWidth = width - margin.left - margin.right
  const innerHeight = height - margin.top - margin.bottom

  // Reset visible range when original extent changes (e.g., new events loaded)
  useEffect(() => {
    setState(prev => ({
      ...prev,
      visibleTimeRange: originalTimeExtent,
      zoomLevel: 1
    }))
    zoomTransformRef.current = d3.zoomIdentity

    // Reset the stored zoom transform on the SVG silently (a fresh behaviour
    // has no listeners), so the next gesture starts from identity.
    if (svgRef.current) {
      d3.select(svgRef.current).call(d3.zoom<SVGSVGElement, unknown>().transform, d3.zoomIdentity)
    }
  }, [originalTimeExtent])

  // Time scale over the visible (zoomed) range
  const timeScale = useMemo(
    () => d3.scaleTime()
      .domain([state.visibleTimeRange.start, state.visibleTimeRange.end])
      .range([0, innerWidth]),
    [state.visibleTimeRange, innerWidth]
  )

  // Y scale: two tracks in chronological mode, one row per partner in thematic mode
  const yScale = useMemo(() => {
    if (layoutMode === 'chronological') {
      return d3.scaleOrdinal<string, number>()
        .domain(['actor', 'target'])
        .range([innerHeight * 0.3, innerHeight * 0.7])
    }
    const uniquePartners = new Set<string>()
    events.forEach(event => {
      uniquePartners.add(event.role === 'actor' ? event.target : event.actor)
    })
    const partners = Array.from(uniquePartners).sort()
    return d3.scaleOrdinal<string, number>()
      .domain(partners)
      .range(partners.map((_, i) => (i + 1) * (innerHeight / (partners.length + 1))))
  }, [layoutMode, events, innerHeight])

  // Events grouped by track (chronological) or by partner (thematic). The
  // group key is user data, so it is only ever an attribute value, never part
  // of a selector or class: `U.S.` or `Britain & France` is not a valid class.
  const groups = useMemo<Array<[string, ActorEventData[]]>>(() => {
    if (layoutMode === 'chronological') {
      return [
        ['actor', events.filter(e => e.role === 'actor')],
        ['target', events.filter(e => e.role === 'target')]
      ]
    }
    const byPartner = new Map<string, ActorEventData[]>()
    events.forEach(event => {
      const partner = event.role === 'actor' ? event.target : event.actor
      const list = byPartner.get(partner)
      if (list) list.push(event)
      else byPartner.set(partner, [event])
    })
    return Array.from(byPartner.entries())
  }, [events, layoutMode])

  const yFor = useCallback((event: ActorEventData) => {
    if (layoutMode === 'chronological') return yScale(event.role)
    return yScale(event.role === 'actor' ? event.target : event.actor)
  }, [layoutMode, yScale])

  // Axis ticks. The interval and labels follow the visible span, as the d3
  // axis did: scale.ticks(interval) is exactly what axisBottom computed.
  const xTicks = useMemo(() => {
    const timeSpanMs = state.visibleTimeRange.end.getTime() - state.visibleTimeRange.start.getTime()
    const interval = getTimeAxisInterval(timeSpanMs)
    return timeScale.ticks(interval).map(date => ({
      key: date.getTime(),
      x: timeScale(date),
      label: formatTimeAxisTick(date, timeSpanMs)
    }))
  }, [timeScale, state.visibleTimeRange])

  // Tick labels stand upright when they fit side by side, and turn 45° only
  // when the widest would run into its neighbour.
  const rotateTickLabels = useMemo(() => {
    if (xTicks.length < 2) return false
    const widest = Math.max(...xTicks.map(tick => tick.label.length)) * TICK_CHAR_PX
    let narrowestGap = Infinity
    for (let i = 1; i < xTicks.length; i++) {
      narrowestGap = Math.min(narrowestGap, xTicks[i]!.x - xTicks[i - 1]!.x)
    }
    return widest + TICK_GAP_PX > narrowestGap
  }, [xTicks])

  // Arcs as the main timeline draws them: bars in a lane at the top, packed
  // into rows so overlapping periods sit one above the other, each named over
  // its own bar (cut to the bar's width). Full-height bands overprinted each
  // other's names in the middle of the chart.
  const arcLabels = useMemo(() => {
    const rows: number[] = []
    const placed = new Map<string, { y: number; barY: number; text: string; startX: number; endX: number }>()
    const ordered = [...arcs].sort((a, b) => a.start_time.localeCompare(b.start_time) || b.end_time.localeCompare(a.end_time))
    for (const arc of ordered) {
      const startX = Math.min(innerWidth, Math.max(0, timeScale(new Date(arc.start_time))))
      const endX = Math.min(innerWidth, Math.max(0, timeScale(new Date(arc.end_time))))
      if (endX - startX < 1) continue
      let row = rows.findIndex((end) => startX >= end + ARC_BAR_GAP_PX)
      if (row === -1) {
        if (rows.length >= ARC_LABEL_MAX_ROWS) continue
        row = rows.length
        rows.push(endX)
      } else {
        rows[row] = endX
      }
      const y = ARC_LABEL_TOP + row * ARC_LABEL_ROW_STEP
      const width = endX - startX
      const text = width >= ARC_MIN_LABEL_PX ? truncateToWidth(arc.name, width, 12) : ''
      placed.set(arc.id, { y, barY: y + 4, text, startX, endX })
    }
    return placed
  }, [arcs, timeScale, innerWidth])

  // The lowest arc-label baseline: event labels of the top lane stop short of it.
  const arcLabelFloor = useMemo(() => {
    let floor = 0
    arcLabels.forEach(({ barY }) => { floor = Math.max(floor, barY + ARC_BAR_HEIGHT) })
    return floor
  }, [arcLabels])

  // Each mark is named by its event's title, placed by the same collision-free
  // layout the main timeline uses, one lane at a time. The role is carried by
  // the lane, the colour and the mark's accessible name -- it used to be a bare
  // "A" or "T" over every mark, which named nothing. A label that would reach
  // into the lane above is dropped (its mark keeps its tooltip and name).
  const markLabels = useMemo(() => {
    const placements = new Map<string, EventLabelPlacement>()
    if (events.length === 0) return placements
    const laneGap = layoutMode === 'chronological'
      ? innerHeight * 0.4
      : innerHeight / (groups.length + 1)
    for (const [groupKey, groupEvents] of groups) {
      // Not into the lane above, and not up into the arc names.
      const laneY = yScale(groupKey)
      const maxRise = Math.min(laneGap - 10, arcLabelFloor > 0 ? laneY - arcLabelFloor - 12 : Infinity)
      const lane = layoutEventLabels(
        groupEvents.map(event => ({
          id: event.id,
          x: timeScale(new Date(event.timestamp)),
          description: event.description,
          priority: event.id === state.selectedEventId,
        })),
        innerWidth,
        ACTOR_LABEL_CONFIG
      )
      const unplaced = new Set(groupEvents.map(event => event.id))
      lane.forEach((placement, id) => {
        if (-placement.offset <= maxRise) {
          placements.set(id, placement)
          unplaced.delete(id)
        }
      })
      // No room above (the arc lane is in the way, or the lane above): try
      // under the mark, still inside this lane. Two of an actor's three
      // marks were going unnamed.
      if (unplaced.size > 0) {
        const below = layoutEventLabels(
          groupEvents
            .filter(event => unplaced.has(event.id))
            .map(event => ({ id: event.id, x: timeScale(new Date(event.timestamp)), description: event.description })),
          innerWidth,
          ACTOR_LABEL_BELOW_CONFIG
        )
        below.forEach((placement, id) => {
          if (placement.offset <= laneGap - 10) placements.set(id, placement)
        })
      }
    }
    return placements
  }, [events.length, groups, layoutMode, innerHeight, innerWidth, timeScale, yScale, arcLabelFloor, state.selectedEventId])

  const selectEvent = useCallback((event: ActorEventData) => {
    setState(prev => ({
      ...prev,
      selectedEventId: prev.selectedEventId === event.id ? null : event.id
    }))
    onEventSelect?.(event)
  }, [onEventSelect])

  const showTooltip = useCallback((placed: PlacedEvent) => {
    setState(prev => ({ ...prev, hoveredEventId: placed.event.id }))
    setTooltipFor(placed)
  }, [])

  const hideTooltip = useCallback(() => {
    setState(prev => ({ ...prev, hoveredEventId: null }))
    setTooltipFor(null)
  }, [])

  // Stable ref so a caller's inline callback does not re-register zoom.
  const onTimeRangeChangeRef = useRef(onTimeRangeChange)
  onTimeRangeChangeRef.current = onTimeRangeChange

  // Zoom and pan (ADR-001 Tier 2): d3 owns the gesture on the React-rendered
  // <svg>; the domain it produces is React state.
  useEffect(() => {
    if (!svgRef.current) return

    const svg = d3.select(svgRef.current)

    // A base scale from the ORIGINAL extent (not the current visible range),
    // which prevents compounding zoom.
    const baseTimeScale = d3.scaleTime()
      .domain([originalTimeExtent.start, originalTimeExtent.end])
      .range([0, innerWidth])

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 10])
      .on('zoom', (event) => {
        const { transform } = event
        zoomTransformRef.current = transform

        const newDomain = transform.rescaleX(baseTimeScale).domain()

        setState(prev => ({
          ...prev,
          visibleTimeRange: { start: newDomain[0], end: newDomain[1] },
          zoomLevel: transform.k
        }))

        onTimeRangeChangeRef.current?.({ start: newDomain[0], end: newDomain[1] })
      })

    // A pan must not start on an event mark, or d3 swallows the mousedown and
    // the mark's own click/keyboard handling competes with the gesture. Wheel
    // zoom over a mark is still allowed.
    zoom.filter((event: MouseEvent) => {
      const onMark = event.target instanceof Element && event.target.closest('.actor-event') !== null
      if (onMark && event.type !== 'wheel') return false
      return (!event.ctrlKey || event.type === 'wheel') && !event.button
    })

    zoomRef.current = zoom
    svg.call(zoom)

    return () => {
      svg.on('.zoom', null)
    }
  }, [originalTimeExtent, innerWidth])

  const handleFitToView = useCallback(() => {
    if (!svgRef.current || !zoomRef.current) return
    d3.select(svgRef.current)
      .transition()
      .duration(300)
      .call(zoomRef.current.transform, d3.zoomIdentity)
  }, [])

  const roleLabel = (role: 'actor' | 'target') => (role === 'actor' ? 'Actor' : 'Target')

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* The legend sits above the chart: drawn over it, it covered the arc
          labels and the x-axis labels. (The layout is named by the view's own
          Layout control, so the chart does not repeat it.) */}
      <div className="mb-2 flex items-center gap-4 text-xs text-ink-secondary">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-1">
            <div className="w-3 h-3 bg-role-actor rounded-full" aria-hidden="true"></div>
            <span>As actor</span>
          </div>
          <div className="flex items-center space-x-1">
            <div className="w-3 h-3 border-2 border-role-target bg-card rounded-full" aria-hidden="true"></div>
            <span>As target</span>
          </div>
          {layoutMode === 'thematic' && (
            <div className="flex items-center space-x-1">
              <div className="w-4 h-0 border-t border-ink-muted border-dashed"></div>
              <span>Connections</span>
            </div>
          )}
        </div>
        {/* Fit to View, in the legend row: drawn over the chart it overlapped
              the frame's corner. React-rendered (it used to be appended by d3). */}
        <button
          type="button"
          onClick={handleFitToView}
          className="fit-to-view-button ml-auto flex items-center gap-1 rounded border border-line bg-card px-2 py-1 text-xs text-ink-secondary shadow-sm transition-colors hover:bg-subtle hover:text-ink"
          title="Fit all events in view"
        >
          <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
          </svg>
          Fit to View
        </button>
      </div>


      {/* The tooltip is positioned in this wrapper's coordinates. */}
      <div className="relative">
        <svg
          ref={svgRef}
          width={width}
          height={height}
          className="rounded-lg border border-line bg-card"
          role="group"
          aria-label={`Timeline for ${actor}: ${events.length} events`}
        >
          <g className="actor-timeline-plot" transform={`translate(${margin.left},${margin.top})`}>
            {/* Axes and grid */}
            <g className="axes-layer">
              {events.length > 0 && (
                <>
                  <g className="grid" pointerEvents="none">
                    {xTicks.map(tick => (
                      <line
                        key={tick.key}
                        x1={tick.x}
                        x2={tick.x}
                        y1={0}
                        y2={innerHeight}
                        strokeDasharray="2,2"
                        opacity={0.2}
                        style={{ stroke: 'var(--text-muted)' }}
                      />
                    ))}
                  </g>

                  <g className="x-axis" transform={`translate(0,${innerHeight})`}>
                    <line x1={0} x2={innerWidth} y1={0} y2={0} style={{ stroke: 'var(--text-muted)' }} />
                    {xTicks.map(tick => (
                      <g key={tick.key} className="tick" transform={`translate(${tick.x},0)`}>
                        <line y2={6} style={{ stroke: 'var(--text-muted)' }} />
                        <text
                          y={9}
                          dx={rotateTickLabels ? '-.8em' : undefined}
                          dy={rotateTickLabels ? '.15em' : '.71em'}
                          transform={rotateTickLabels ? 'rotate(-45)' : undefined}
                          textAnchor={rotateTickLabels ? 'end' : 'middle'}
                          fontSize={11}
                          className="font-mono-code"
                          style={{ fill: 'var(--text-secondary)' }}
                        >
                          {tick.label}
                        </text>
                      </g>
                    ))}
                  </g>

                  <g className="y-axis">
                    {layoutMode === 'chronological' && (
                      <line x1={0} x2={0} y1={0} y2={innerHeight} style={{ stroke: 'var(--text-muted)' }} />
                    )}
                    {groups.map(([key]) => (
                      <g key={key} className="y-tick" transform={`translate(0, ${yScale(key)})`}>
                        <line x1={-6} x2={0} style={{ stroke: 'var(--text-muted)' }} />
                        {layoutMode === 'chronological' ? (
                          // The heading above the chart already names the actor;
                          // repeating the name here overflowed the left margin.
                          <text
                            x={-9}
                            dy="0.32em"
                            textAnchor="end"
                            fontSize={12}
                            fontWeight={500}
                            style={{ fill: 'var(--text-secondary)' }}
                          >
                            {key === 'actor' ? 'As actor' : 'As target'}
                          </text>
                        ) : (
                          <text
                            x={-9}
                            dy="0.32em"
                            textAnchor="end"
                            fontSize={11}
                            style={{ fill: 'var(--text-secondary)' }}
                          >
                            {truncateToWidth(key, margin.left - 12, 11)}
                            <title>{key}</title>
                          </text>
                        )}
                      </g>
                    ))}
                  </g>
                </>
              )}
            </g>

            {/* The arc lane (see arcLabels) */}
            <g className="arcs-layer" pointerEvents="none">
              {arcs.map(arc => {
                const lane = arcLabels.get(arc.id)
                if (!lane) return null
                return (
                  <g key={arc.id} className="actor-arc">
                    <rect
                      x={lane.startX}
                      y={lane.barY}
                      width={Math.max(0, lane.endX - lane.startX)}
                      height={ARC_BAR_HEIGHT}
                      rx={2}
                      style={{ fill: 'var(--arc-fill)', stroke: 'var(--arc-stroke)' }}
                      strokeWidth={1}
                    />
                    {lane.text && (
                      <text
                        className="actor-arc-label"
                        x={lane.startX}
                        y={lane.y}
                        textAnchor="start"
                        fontSize={12}
                        fontWeight={500}
                        style={{ fill: 'var(--text-secondary)' }}
                      >
                        {lane.text}
                      </text>
                    )}
                  </g>
                )
              })}
            </g>

            {/* Event marks */}
            <g className="events-layer">
              {events.length > 0 && groups.map(([groupKey, groupEvents]) => {
                const sorted = layoutMode === 'thematic' && groupEvents.length > 1
                  ? [...groupEvents].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
                  : []
                const rowY = layoutMode === 'thematic' ? yScale(groupKey) : 0
                return (
                  <g key={groupKey} className="actor-event-group" data-group={groupKey}>
                    {/* Connection lines between consecutive events with the same partner */}
                    {sorted.slice(0, -1).map((current, i) => {
                      const next = sorted[i + 1]
                      if (!next) return null
                      return (
                        <line
                          key={`${current.id}-${next.id}`}
                          className="connection-line"
                          x1={timeScale(new Date(current.timestamp))}
                          y1={rowY}
                          x2={timeScale(new Date(next.timestamp))}
                          y2={rowY}
                          strokeWidth={1}
                          strokeDasharray="2,2"
                          opacity={0.5}
                          pointerEvents="none"
                          style={{ stroke: 'var(--text-muted)' }}
                        />
                      )
                    })}

                    {groupEvents.map(event => {
                      const x = timeScale(new Date(event.timestamp))
                      const y = yFor(event)
                      const isSelected = state.selectedEventId === event.id
                      const isHovered = state.hoveredEventId === event.id
                      const roleColor = ROLE_COLOR[event.role]
                      const placed = { event, x, y }
                      const label = markLabels.get(event.id)
                      return (
                        <g
                          key={event.id}
                          className="actor-event group"
                          data-event-id={event.id}
                          transform={`translate(${x}, ${y})`}
                          role="button"
                          tabIndex={0}
                          aria-pressed={isSelected}
                          aria-label={
                            `${event.description}, ${event.actor} → ${event.target}, ` +
                            `${formatHistoricalTimestamp(event.timestamp)} (${actor} as ${event.role})`
                          }
                          style={{ cursor: 'pointer', outline: 'none' }}
                          onClick={(e) => {
                            e.stopPropagation()
                            selectEvent(event)
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              // Space would otherwise scroll the page.
                              e.preventDefault()
                              selectEvent(event)
                            }
                          }}
                          onMouseEnter={() => showTooltip(placed)}
                          onMouseLeave={hideTooltip}
                          onFocus={() => showTooltip(placed)}
                          onBlur={hideTooltip}
                        >
                          {/* Keyboard focus ring: shown only for :focus-visible */}
                          <circle
                            className="event-focus-ring opacity-0 group-focus-visible:opacity-100"
                            r={13}
                            fill="none"
                            stroke="var(--accent-selected)"
                            strokeWidth={2}
                            pointerEvents="none"
                          />
                          <circle
                            className="event-marker"
                            data-role={event.role}
                            r={isSelected ? (isHovered ? 10 : 8) : (isHovered ? 8 : 6)}
                            // Selected is the indigo selection accent (not danger red).
                            // A target mark is a ring, so the role reads without colour.
                            fill={isSelected ? 'var(--accent-selected)' : event.role === 'target' ? 'var(--surface-card)' : roleColor}
                            stroke={isSelected || event.role === 'actor' ? 'var(--surface-card)' : roleColor}
                            strokeWidth={event.role === 'target' && !isSelected ? 2.5 : 2}
                            style={{
                              filter: isSelected
                                ? 'drop-shadow(0 0 6px rgba(79, 70, 229, 0.5))'
                                : isHovered
                                  ? 'drop-shadow(0 0 8px rgba(59, 130, 246, 0.6))'
                                  : 'none'
                            }}
                          />
                          {/* The event's title, where the lane has room for it */}
                          {label && (
                            <text
                              className="actor-event-label"
                              y={label.offset}
                              textAnchor={label.anchor}
                              fontSize={12}
                              fontWeight={isSelected ? 600 : 400}
                              fill={isSelected ? 'var(--accent-selected)' : 'var(--text-secondary)'}
                              pointerEvents="none"
                            >
                              {label.text}
                            </text>
                          )}
                        </g>
                      )
                    })}
                  </g>
                )
              })}
            </g>
          </g>
        </svg>

        {/* Hover/focus tooltip, rendered by React inside the component. A
            fixed inverse surface: the gray scale is inverted under html.dark. */}
        {tooltipFor && (
          <div
            role="tooltip"
            className="actor-timeline-tooltip pointer-events-none absolute z-20 max-w-[300px] rounded-md bg-[#0f172a]/95 p-3 text-xs text-[#f8fafc] shadow-lg ring-1 ring-white/10"
            style={{
              left: Math.min(margin.left + tooltipFor.x + 12, Math.max(0, width - 300)),
              top: margin.top + tooltipFor.y + 12
            }}
          >
            <div className="mb-1 font-semibold">{tooltipFor.event.description}</div>
            <div className="mb-2" style={{ color: ROLE_TOOLTIP_COLOR[tooltipFor.event.role] }}>
              {actor} as {roleLabel(tooltipFor.event.role)}
            </div>
            <div className="text-xs text-[#cbd5e1]">
              <div><strong>Actor:</strong> {tooltipFor.event.actor}</div>
              <div><strong>Target:</strong> {tooltipFor.event.target}</div>
              <div>
                <strong>Time:</strong>{' '}
                <span className="font-mono-code">{formatHistoricalTimestamp(tooltipFor.event.timestamp)}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
