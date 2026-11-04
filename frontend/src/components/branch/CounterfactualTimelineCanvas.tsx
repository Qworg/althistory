import { memo, useMemo, useState, useCallback, useRef, useLayoutEffect, useEffect } from 'react'
import type React from 'react'
import * as d3 from 'd3'
import { Event, Arc } from '@/types'
import { formatHistoricalDate, formatHistoricalTimestamp } from '@/utils/historicalTime'
import {
  analyzeEventDivergence,
  PointOfDivergence,
  EventComparisonItem,
} from '@/utils/divergenceAnalysis'
import { layoutEventLabels, truncateLabel, LABEL_ROW_OFFSETS, type EventLabelPlacement, type LabelLayoutConfig } from '@/components/timeline/eventLabelLayout'

export interface CounterfactualTimelineCanvasProps {
  readonly baselineName: string
  readonly counterfactualName: string
  readonly baselineEvents: readonly Event[]
  readonly counterfactualEvents: readonly Event[]
  readonly baselineArcs?: readonly Arc[]
  readonly counterfactualArcs?: readonly Arc[]
  /**
   * Fallback width. The canvas fills its container, measured with a
   * ResizeObserver; this is used until (or where) it can be measured.
   */
  readonly width?: number
  readonly height?: number
  readonly margin?: { top: number; right: number; bottom: number; left: number }
  readonly onEventSelect?: (event: Event, lane: 'baseline' | 'counterfactual') => void
  readonly className?: string
  /**
   * Open on the years from just before the point of divergence when it falls
   * late in the history (the comparison modal does), instead of fitting all
   * of it; "All history" still shows everything.
   */
  focusDivergence?: boolean
}

interface HoveredItem {
  readonly event: Event
  readonly lane: 'baseline' | 'counterfactual'
  readonly status: 'shared' | 'divergent_added' | 'baseline_only' | 'modified'
  readonly x: number
  readonly y: number
}

const DEFAULT_MARGIN = { top: 32, right: 32, bottom: 48, left: 140 }
/** Below COMPACT_WIDTH (a phone's full-screen sheet) the margins give the plot more room. */
const COMPACT_MARGIN = { top: 32, right: 16, bottom: 36, left: 96 }
const COMPACT_WIDTH = 560

/** "Halifax Appointed, King → Halifax, May 10, 1940, 12:00 UTC (Halifax Government lane)". */
function eventLabel(event: Event, laneName: string): string {
  return `${event.description}, ${event.actor} → ${event.target}, ${formatHistoricalTimestamp(event.timestamp)} (${laneName} lane)`
}

/** Keyboard focus ring for an event mark, shown while its group is :focus-visible. */
function FocusRing() {
  return (
    <circle
      className="event-focus-ring opacity-0 group-focus-visible:opacity-100"
      r={14}
      fill="none"
      stroke="var(--accent-selected)"
      strokeWidth={2}
      pointerEvents="none"
    />
  )
}

/** Narrowest canvas drawn; below this the lanes are unreadable anyway. */
const MIN_WIDTH = 280

/** Event titles, axis dates and the divergence label: 12px, the floor for SVG text a user reads. */
const LABEL_FONT_PX = 12
/**
 * The lanes' label rows, measured at the size they are drawn: estimated at the
 * default 10px, a 12px label near the plot's edge was placed as if it fitted
 * and ran past the clip ("abbage completes…").
 */
const LANE_LABEL_CONFIG: LabelLayoutConfig = { rowOffsets: LABEL_ROW_OFFSETS, fontSize: LABEL_FONT_PX }
/** Advance of one character of the 12px monospace axis dates (0.6em). */
const TICK_CHAR_PX = 7.2
/** Clear space kept between two axis dates. */
const TICK_GAP_PX = 12
/** Width of the tooltip, which is clamped inside the canvas. */
const TOOLTIP_WIDTH_PX = 240

/**
 * Axis tick labels in the historical-date style used everywhere else. Ticks
 * that all fall on New Year's Day name the year alone; otherwise each tick is
 * a full UTC date ("May 10, 1940"), never shifted by the viewer's zone.
 */
function formatTicks(dates: readonly Date[]): string[] {
  const allYearStarts = dates.every(
    d =>
      d.getUTCMonth() === 0 &&
      d.getUTCDate() === 1 &&
      d.getUTCHours() === 0 &&
      d.getUTCMinutes() === 0
  )
  return dates.map(d => (allYearStarts ? String(d.getUTCFullYear()) : formatHistoricalDate(d)))
}

/**
 * Drop axis ticks whose dates would overprint their neighbour's. d3 picks
 * "nice" ticks for a count it treats as a hint, so a narrow axis can get more
 * than fit; keep them left to right while each clears the last one kept.
 */
function thinTicks<T extends { x: number; label: string }>(ticks: readonly T[]): T[] {
  const kept: T[] = []
  let lastRight = -Infinity
  for (const tick of ticks) {
    const half = (tick.label.length * TICK_CHAR_PX) / 2
    if (tick.x - half < lastRight + TICK_GAP_PX) continue
    kept.push(tick)
    lastRight = tick.x + half
  }
  return kept
}

/** Lane label: 12px semibold, about 7px a character. */
const LANE_LABEL_CHAR_PX = 7
const LANE_LABEL_LINE_HEIGHT = 14

/**
 * Split a lane name into at most two lines that fit `maxChars`, truncating the
 * last with an ellipsis. The full name stays in the <title> and aria-label.
 */
function wrapLaneLabel(name: string, maxChars: number): string[] {
  if (name.length <= maxChars) return [name]
  const words = name.split(/\s+/).filter(Boolean)
  let first = ''
  let index = 0
  while (index < words.length) {
    const word = words[index] ?? ''
    const candidate = first ? `${first} ${word}` : word
    if (candidate.length > maxChars) break
    first = candidate
    index++
  }
  if (!first) {
    // A single word longer than a line: cut it.
    return [truncateLabel(name, maxChars)]
  }
  const rest = words.slice(index).join(' ')
  return rest ? [first, truncateLabel(rest, maxChars)] : [first]
}

type MarkStatus = 'shared' | 'divergent_added' | 'baseline_only' | 'modified'

const STATUS_TEXT: Record<MarkStatus, string> = {
  shared: 'In both histories',
  divergent_added: 'Added in branch',
  modified: 'Changed in branch',
  baseline_only: 'Only in baseline',
}

/**
 * The mark drawn for an event, by status. Shape and fill carry the status as
 * well as colour, so it reads without colour vision: a circle is an event the
 * baseline has (filled when the branch shares it, dashed and hollow when only
 * the baseline does); a square is the branch's own (filled when it is new,
 * hollow when it changes a shared event). Shared by the canvas, its legend and
 * the tooltip. `r` is the circle's radius; the square has about the same area.
 */
function EventMark({ status, r }: { status: MarkStatus; r: number }) {
  switch (status) {
    case 'divergent_added':
    case 'modified': {
      const side = r * 1.8
      const filled = status === 'divergent_added'
      return (
        <rect
          x={-side / 2}
          y={-side / 2}
          width={side}
          height={side}
          rx={1.5}
          style={{
            fill: filled ? 'var(--accent-divergence)' : 'var(--surface-card)',
            stroke: filled ? 'var(--surface-card)' : 'var(--accent-divergence)',
          }}
          strokeWidth={filled ? 1.5 : 2.5}
        />
      )
    }
    case 'baseline_only':
      return (
        <circle
          r={r}
          style={{ fill: 'var(--surface-card)', stroke: 'var(--text-muted)' }}
          strokeWidth={1.5}
          strokeDasharray="2 2"
        />
      )
    default:
      return <circle r={r} style={{ fill: 'var(--accent-baseline)', stroke: 'var(--surface-card)' }} strokeWidth={1.5} />
  }
}

/** A legend or tooltip swatch: the event mark at small size. */
function LegendMark({ status }: { status: MarkStatus }) {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="-8 -8 16 16" aria-hidden="true">
      {status === 'shared' && (
        // The dotted rule that joins a shared event across the two lanes.
        <line x1={0} y1={-8} x2={0} y2={8} style={{ stroke: 'var(--text-muted)' }} strokeWidth={1} strokeDasharray="2 2" />
      )}
      <EventMark status={status} r={4.5} />
    </svg>
  )
}

/** The point-of-divergence swatch: the amber diamond on its dashed rule. */
function DivergenceMark() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="-8 -8 16 16" aria-hidden="true">
      <line x1={0} y1={-8} x2={0} y2={8} style={{ stroke: 'var(--accent-divergence)' }} strokeWidth={1.5} strokeDasharray="3 2" />
      <polygon points="0,-5 5,0 0,5 -5,0" style={{ fill: 'var(--accent-divergence)' }} />
    </svg>
  )
}

function Chevron({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d={direction === 'left' ? 'M15 19l-7-7 7-7' : 'M9 5l7 7-7 7'} />
    </svg>
  )
}

const CONTROL_BUTTON =
  'inline-flex items-center justify-center h-7 min-w-7 px-1.5 text-ink-secondary hover:text-ink hover:bg-subtle rounded-md'

/** Enter and Space activate an SVG role="button" the way they do a <button>. */
function activateOnKey(e: React.KeyboardEvent, activate: () => void) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    activate()
  }
}

/**
 * The container's content width, kept current with a ResizeObserver. Null
 * until measured, and where it cannot be (no ResizeObserver, or a zero width
 * as in jsdom), so the caller falls back to its fixed width.
 */
function useContainerWidth(ref: React.RefObject<HTMLDivElement | null>): number | null {
  const [measured, setMeasured] = useState<number | null>(null)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const update = (next: number) => setMeasured(next > 0 ? Math.floor(next) : null)
    update(element.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => {
      const entry = entries[0]
      if (entry) update(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return measured
}

/**
 * Interactive D3 dual-lane timeline visualizing divergence between a baseline
 * timeline and a counterfactual branch.
 *
 * Implements strict "React owns the DOM" pattern (D3 for scale calculations only).
 */
export const CounterfactualTimelineCanvas = memo(function CounterfactualTimelineCanvas({
  baselineName,
  counterfactualName,
  baselineEvents,
  counterfactualEvents,
  width: fallbackWidth = 960,
  height = 360,
  margin: marginProp,
  onEventSelect,
  className = '',
  focusDivergence = false,
}: CounterfactualTimelineCanvasProps) {
  const [zoomFactor, setZoomFactor] = useState(1)
  const [panOffset, setPanOffset] = useState(0)
  const [hovered, setHovered] = useState<HoveredItem | null>(null)
  const [hoveredPod, setHoveredPod] = useState<PointOfDivergence | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const measuredWidth = useContainerWidth(canvasRef)
  const width = Math.max(MIN_WIDTH, measuredWidth ?? fallbackWidth)
  const margin = marginProp ?? (width < COMPACT_WIDTH ? COMPACT_MARGIN : DEFAULT_MARGIN)

  const innerWidth = Math.max(100, width - margin.left - margin.right)
  const innerHeight = Math.max(100, height - margin.top - margin.bottom)

  const baselineLaneY = innerHeight * 0.32
  const counterfactualLaneY = innerHeight * 0.76

  // 1. Analyze divergence between the two sets of events
  const { items, metrics } = useMemo(() => {
    return analyzeEventDivergence(baselineEvents, counterfactualEvents)
  }, [baselineEvents, counterfactualEvents])

  const itemMap = useMemo(() => {
    const map = new Map<string, EventComparisonItem>()
    items.forEach(i => map.set(i.id, i))
    return map
  }, [items])

  // 2. Compute unified time domain across both timelines
  const baseDomain = useMemo<[Date, Date]>(() => {
    const allTimestamps: number[] = [
      ...baselineEvents.map(e => new Date(e.timestamp).getTime()),
      ...counterfactualEvents.map(e => new Date(e.timestamp).getTime()),
    ].filter(t => !isNaN(t))

    if (allTimestamps.length === 0) {
      const now = Date.now()
      return [new Date(now - 30 * 86400000), new Date(now + 30 * 86400000)]
    }

    const min = Math.min(...allTimestamps)
    const max = Math.max(...allTimestamps)

    // Add padding to domain edges so boundary events aren't clipped
    const span = Math.max(86400000, max - min)
    const pad = span * 0.06
    return [new Date(min - pad), new Date(max + pad)]
  }, [baselineEvents, counterfactualEvents])

  // 3. Compute scaled domain accounting for zoom and pan
  const currentDomain = useMemo<[Date, Date]>(() => {
    const [start, end] = baseDomain
    const totalDuration = end.getTime() - start.getTime()
    const zoomedDuration = totalDuration / zoomFactor

    const currentStartMs = start.getTime() + panOffset
    const currentEndMs = currentStartMs + zoomedDuration
    return [new Date(currentStartMs), new Date(currentEndMs)]
  }, [baseDomain, zoomFactor, panOffset])

  // 4. D3 Scale calculation. UTC, so ticks fall on UTC day boundaries and
  // the labels match the stored (UTC) historical dates.
  const xScale = useMemo(() => {
    return d3.scaleUtc().domain(currentDomain).range([0, innerWidth])
  }, [currentDomain, innerWidth])

  // 5. Ticks for time axis
  const timeTicks = useMemo(() => {
    const dates = xScale.ticks(Math.max(2, Math.min(6, Math.floor(innerWidth / 110))))
    const labels = formatTicks(dates)
    const kept = thinTicks(
      dates.map((date, i) => ({
        date,
        x: xScale(date),
        label: labels[i] ?? '',
      }))
    )
    // A date centred on an end tick would run off the SVG: anchor it inward.
    return kept.map(tick => {
      const half = (tick.label.length * TICK_CHAR_PX) / 2
      const anchor: 'start' | 'middle' | 'end' =
        tick.x + half > innerWidth + margin.right ? 'end' : tick.x - half < -margin.left ? 'start' : 'middle'
      return { ...tick, anchor }
    })
  }, [xScale, innerWidth, margin.left, margin.right])

  // Zoom controls
  const handleZoomIn = useCallback(() => {
    setZoomFactor(z => Math.min(10, z * 1.35))
  }, [])

  const handleZoomOut = useCallback(() => {
    setZoomFactor(z => Math.max(0.5, z / 1.35))
  }, [])

  const handleResetZoom = useCallback(() => {
    setZoomFactor(1)
    setPanOffset(0)
  }, [])

  // Open on what differs. Fitting the whole history gave a branch that splits
  // late most of the lanes to years the two share, and stacked its own events
  // at the divergence. When the split falls past the first third, the view
  // starts a little before it (a quarter of what follows, as shared context);
  // "All history" shows the rest.
  const divergenceFocus = useMemo(() => {
    const pod = metrics.pointOfDivergence
    if (!focusDivergence || !pod) return null
    const [start, end] = baseDomain
    const total = end.getTime() - start.getTime()
    const podMs = new Date(pod.timestamp).getTime()
    if (!(total > 0) || (podMs - start.getTime()) / total < 0.35) return null
    const from = Math.max(start.getTime(), podMs - (end.getTime() - podMs) * 0.25)
    return { zoom: total / (end.getTime() - from), pan: from - start.getTime(), key: `${podMs}:${total}` }
  }, [focusDivergence, metrics.pointOfDivergence, baseDomain])

  const focusedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!divergenceFocus || focusedFor.current === divergenceFocus.key) return
    focusedFor.current = divergenceFocus.key
    setZoomFactor(divergenceFocus.zoom)
    setPanOffset(divergenceFocus.pan)
  }, [divergenceFocus])

  const handleFocusDivergence = useCallback(() => {
    if (!divergenceFocus) return
    setZoomFactor(divergenceFocus.zoom)
    setPanOffset(divergenceFocus.pan)
  }, [divergenceFocus])

  const handlePanLeft = useCallback(() => {
    const span = currentDomain[1].getTime() - currentDomain[0].getTime()
    setPanOffset(p => p - span * 0.2)
  }, [currentDomain])

  const handlePanRight = useCallback(() => {
    const span = currentDomain[1].getTime() - currentDomain[0].getTime()
    setPanOffset(p => p + span * 0.2)
  }, [currentDomain])

  // Point of Divergence coordinate
  const podCoordinate = useMemo(() => {
    if (!metrics.pointOfDivergence) return null
    const podTime = new Date(metrics.pointOfDivergence.timestamp)
    const x = xScale(podTime)
    return {
      x,
      pod: metrics.pointOfDivergence,
      isInView: x >= 0 && x <= innerWidth,
    }
  }, [metrics.pointOfDivergence, xScale, innerWidth])

  // The divergence marker's label goes on whichever side of the line has
  // room; a narrow plot gets the short form.
  const podLabel = innerWidth < 360 ? 'Divergence' : 'Point of divergence'
  const podLabelWidth = podLabel.length * 7 + 12
  const podLabelOnLeft =
    podCoordinate !== null &&
    podCoordinate.x + podLabelWidth > innerWidth &&
    podCoordinate.x > innerWidth - podCoordinate.x

  // Shared event pairs for vertical alignment connectors
  const sharedAlignmentLines = useMemo(() => {
    const pairs: { id: string; x: number }[] = []
    baselineEvents.forEach(bEvent => {
      const item = itemMap.get(bEvent.id)
      if (item && item.status === 'shared') {
        const x = xScale(new Date(bEvent.timestamp))
        if (x >= 0 && x <= innerWidth) {
          pairs.push({ id: bEvent.id, x })
        }
      }
    })
    return pairs
  }, [baselineEvents, itemMap, xScale, innerWidth])

  // Collision-free event titles, laid out per lane. The point-of-divergence
  // event is named first, so the mark the comparison turns on is never the
  // one left unlabelled.
  const podEventId = metrics.pointOfDivergence?.event?.id
  const baselineLabels = useMemo<Map<string, EventLabelPlacement>>(
    () =>
      layoutEventLabels(
        baselineEvents.map(event => ({
          id: event.id,
          x: xScale(new Date(event.timestamp)),
          description: event.description,
          priority: event.id === podEventId,
        })),
        innerWidth,
        LANE_LABEL_CONFIG
      ),
    [baselineEvents, xScale, innerWidth, podEventId]
  )
  const counterfactualLabels = useMemo<Map<string, EventLabelPlacement>>(
    () =>
      layoutEventLabels(
        counterfactualEvents.map(event => ({
          id: event.id,
          x: xScale(new Date(event.timestamp)),
          description: event.description,
          priority: event.id === podEventId,
        })),
        innerWidth,
        LANE_LABEL_CONFIG
      ),
    [counterfactualEvents, xScale, innerWidth, podEventId]
  )

  const laneLabelMaxChars = Math.max(6, Math.floor((margin.left - 16) / LANE_LABEL_CHAR_PX))
  const baselineLaneLines = wrapLaneLabel(baselineName, laneLabelMaxChars)
  const counterfactualLaneLines = wrapLaneLabel(counterfactualName, laneLabelMaxChars)

  const renderLaneLabel = (lines: string[], fullName: string, laneY: number, swatch: string) => (
    <g>
      <text
        x={0}
        y={laneY + (lines.length > 1 ? -3 : 4)}
        textAnchor="end"
        fontSize={12}
        fontWeight={600}
        style={{ fill: 'var(--text-primary)' }}
      >
        <title>{fullName}</title>
        {lines.map((line, i) => (
          <tspan key={i} x={0} dy={i === 0 ? 0 : LANE_LABEL_LINE_HEIGHT}>
            {line}
          </tspan>
        ))}
      </text>
      <circle cx={7} cy={laneY} r={3.5} style={{ fill: swatch }} />
    </g>
  )

  const renderEventLabels = (
    events: readonly Event[],
    placements: Map<string, EventLabelPlacement>,
    laneY: number,
    lane: 'baseline' | 'counterfactual'
  ) =>
    events.map(event => {
      const placement = placements.get(event.id)
      if (!placement) return null
      return (
        <text
          key={`${lane}-label-${event.id}`}
          data-testid={`${lane === 'baseline' ? 'event' : 'cf-event'}-label-${event.id}`}
          x={xScale(new Date(event.timestamp))}
          y={laneY + placement.offset}
          textAnchor={placement.anchor}
          fontSize={LABEL_FONT_PX}
          fontWeight={placement.emphasis ? 600 : 400}
          pointerEvents="none"
          style={{
            fill: placement.emphasis ? 'var(--text-primary)' : 'var(--text-secondary)',
            paintOrder: 'stroke',
            stroke: 'var(--surface-subtle)',
            strokeWidth: 3,
            strokeLinejoin: 'round',
          }}
        >
          {placement.text}
        </text>
      )
    })

  return (
    // A plain region, not a card: it sits inside a dialog that is already one.
    <div className={`counterfactual-timeline-container relative min-w-0 ${className}`}>
      {/* Legend (every mark the canvas draws) and the view controls */}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 mb-3">
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-secondary min-w-0" aria-label="Legend">
          {(['shared', 'divergent_added', 'modified', 'baseline_only'] as const).map(status => (
            <li key={status} className="flex items-center gap-1.5">
              <LegendMark status={status} />
              {STATUS_TEXT[status]}
            </li>
          ))}
          {metrics.pointOfDivergence && (
            <li className="flex items-center gap-1.5 text-ink">
              <DivergenceMark />
              <span>
                Point of divergence,{' '}
                <span className="font-mono-code">{formatHistoricalDate(metrics.pointOfDivergence.timestamp)}</span>
              </span>
            </li>
          )}
        </ul>

        {/* Zoom & Pan Controls */}
        <div className="flex items-center gap-0.5 ml-auto" role="group" aria-label="Timeline view">
          <button type="button" onClick={handlePanLeft} className={CONTROL_BUTTON} title="Pan left" aria-label="Pan left">
            <Chevron direction="left" />
          </button>
          <button type="button" onClick={handlePanRight} className={CONTROL_BUTTON} title="Pan right" aria-label="Pan right">
            <Chevron direction="right" />
          </button>
          <button type="button" onClick={handleZoomIn} className={CONTROL_BUTTON} title="Zoom in" aria-label="Zoom in">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <button type="button" onClick={handleZoomOut} className={CONTROL_BUTTON} title="Zoom out" aria-label="Zoom out">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" d="M5 12h14" />
            </svg>
          </button>
          {divergenceFocus && (
            <button type="button" onClick={handleFocusDivergence} className={`${CONTROL_BUTTON} text-xs font-medium`} title="Show the years from just before the divergence">
              From divergence
            </button>
          )}
          <button type="button" onClick={handleResetZoom} className={`${CONTROL_BUTTON} text-xs font-medium`} title="Reset view: both histories from start to end">
            All history
          </button>
        </div>
      </div>

      {/* Dual-lane canvas: React renders the SVG, d3 supplies the scale. The
          wrapper is measured for the width and positions the tooltip. */}
      <div ref={canvasRef} className="relative">
        <svg
          ref={svgRef}
          width={width}
          height={height}
          className="block select-none"
          role="img"
          aria-label={`Timelines of ${baselineName} (baseline) and ${counterfactualName} (branch), aligned at the point of divergence`}
        >
          <defs>
            <clipPath id="dual-lane-clip">
              <rect x={0} y={0} width={innerWidth} height={innerHeight} />
            </clipPath>
          </defs>

          {/* Lane labels in the left margin, wrapped and truncated to fit it */}
          <g transform={`translate(${margin.left - 16}, ${margin.top})`}>
            {renderLaneLabel(baselineLaneLines, baselineName, baselineLaneY, 'var(--accent-baseline)')}
            {renderLaneLabel(counterfactualLaneLines, counterfactualName, counterfactualLaneY, 'var(--accent-divergence)')}
          </g>

          <g transform={`translate(${margin.left}, ${margin.top})`}>
            {/* Background */}
            <rect
              x={0}
              y={0}
              width={innerWidth}
              height={innerHeight}
              style={{ fill: 'var(--surface-subtle)' }}
              rx={6}
            />

            {/* Clipped Canvas Content */}
            <g clipPath="url(#dual-lane-clip)">
              {/* Baseline Lane Guide */}
              <line
                x1={0}
                y1={baselineLaneY}
                x2={innerWidth}
                y2={baselineLaneY}
                style={{ stroke: 'var(--accent-baseline)' }}
                strokeOpacity={0.35}
                strokeWidth={2}
                strokeDasharray="4 4"
              />

              {/* Counterfactual Lane Guide */}
              <line
                x1={0}
                y1={counterfactualLaneY}
                x2={innerWidth}
                y2={counterfactualLaneY}
                style={{ stroke: 'var(--accent-divergence)' }}
                strokeOpacity={0.45}
                strokeWidth={2}
                strokeDasharray="4 4"
              />

              {/* Shared Continuity Vertical Alignment Links */}
              {sharedAlignmentLines.map(pair => (
                <line
                  key={`link-${pair.id}`}
                  x1={pair.x}
                  y1={baselineLaneY}
                  x2={pair.x}
                  y2={counterfactualLaneY}
                  style={{ stroke: 'var(--text-muted)' }}
                  strokeOpacity={0.5}
                  strokeWidth={1}
                  strokeDasharray="2 2"
                />
              ))}

              {/* Point of Divergence Marker */}
              {podCoordinate && podCoordinate.isInView && (
                <g
                  className="pod-marker group cursor-pointer"
                  role="button"
                  tabIndex={0}
                  aria-label={`Point of divergence: ${podCoordinate.pod.description}, ${formatHistoricalTimestamp(podCoordinate.pod.timestamp)}`}
                  style={{ outline: 'none' }}
                  onClick={() => setHoveredPod(podCoordinate.pod)}
                  onKeyDown={e => activateOnKey(e, () => setHoveredPod(podCoordinate.pod))}
                >
                  {/* Band */}
                  <rect
                    x={podCoordinate.x - 12}
                    y={0}
                    width={24}
                    height={innerHeight}
                    style={{ fill: 'var(--accent-divergence)' }}
                    opacity={0.1}
                  />

                  {/* Divergence Line */}
                  <line
                    x1={podCoordinate.x}
                    y1={0}
                    x2={podCoordinate.x}
                    y2={innerHeight}
                    style={{ stroke: 'var(--accent-divergence)' }}
                    strokeWidth={2}
                    strokeDasharray="6 3"
                  />

                  {/* Diamond badge */}
                  <g transform={`translate(${podCoordinate.x}, 16)`}>
                    <circle
                      className="opacity-0 group-focus-visible:opacity-100"
                      r={13}
                      fill="none"
                      stroke="var(--accent-selected)"
                      strokeWidth={2}
                    />
                    <polygon
                      points="0,-8 8,0 0,8 -8,0"
                      style={{ fill: 'var(--accent-divergence)', stroke: 'var(--surface-card)' }}
                      strokeWidth={1.5}
                    />
                    <text
                      x={podLabelOnLeft ? -12 : 12}
                      y={4}
                      textAnchor={podLabelOnLeft ? 'end' : 'start'}
                      fontSize={LABEL_FONT_PX}
                      fontWeight={600}
                      style={{
                        fill: 'var(--text-primary)',
                        paintOrder: 'stroke',
                        stroke: 'var(--surface-subtle)',
                        strokeWidth: 3,
                        strokeLinejoin: 'round',
                      }}
                    >
                      {podLabel}
                    </text>
                  </g>
                </g>
              )}

              {/* Baseline Lane Events */}
              {baselineEvents.map(event => {
                const x = xScale(new Date(event.timestamp))
                if (x < -20 || x > innerWidth + 20) return null

                const item = itemMap.get(event.id)
                const status: MarkStatus = item?.status === 'baseline_only' ? 'baseline_only' : 'shared'
                const select = () => onEventSelect?.(event, 'baseline')
                const show = () =>
                  setHovered({
                    event,
                    lane: 'baseline',
                    status: item?.status ?? 'shared',
                    x: margin.left + x,
                    y: margin.top + baselineLaneY,
                  })

                return (
                  <g
                    key={`base-${event.id}`}
                    data-testid={`event-node-${event.id}`}
                    transform={`translate(${x}, ${baselineLaneY})`}
                    className="group cursor-pointer"
                    role="button"
                    tabIndex={0}
                    aria-label={eventLabel(event, baselineName)}
                    style={{ outline: 'none' }}
                    onClick={select}
                    onKeyDown={e => activateOnKey(e, select)}
                    onMouseEnter={show}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={show}
                    onBlur={() => setHovered(null)}
                  >
                    <FocusRing />
                    <EventMark status={status} r={6.5} />
                  </g>
                )
              })}

              {/* Counterfactual Lane Events */}
              {counterfactualEvents.map(event => {
                const x = xScale(new Date(event.timestamp))
                if (x < -20 || x > innerWidth + 20) return null

                const item = itemMap.get(event.id)
                const status: MarkStatus =
                  item?.status === 'modified'
                    ? 'modified'
                    : item?.status === 'shared'
                      ? 'shared'
                      : 'divergent_added'
                const select = () => onEventSelect?.(event, 'counterfactual')
                const show = () =>
                  setHovered({
                    event,
                    lane: 'counterfactual',
                    status: item?.status ?? 'divergent_added',
                    x: margin.left + x,
                    y: margin.top + counterfactualLaneY,
                  })

                return (
                  <g
                    key={`cf-${event.id}`}
                    data-testid={`cf-event-node-${event.id}`}
                    transform={`translate(${x}, ${counterfactualLaneY})`}
                    className="group cursor-pointer"
                    role="button"
                    tabIndex={0}
                    aria-label={eventLabel(event, counterfactualName)}
                    style={{ outline: 'none' }}
                    onClick={select}
                    onKeyDown={e => activateOnKey(e, select)}
                    onMouseEnter={show}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={show}
                    onBlur={() => setHovered(null)}
                  >
                    <FocusRing />
                    <EventMark status={status} r={status === 'shared' ? 6.5 : 7} />
                  </g>
                )
              })}

              {/* Event titles: decorative (each mark carries its full name
                  in its aria-label), so hidden from assistive technology. */}
              <g aria-hidden="true">
                {renderEventLabels(baselineEvents, baselineLabels, baselineLaneY, 'baseline')}
                {renderEventLabels(counterfactualEvents, counterfactualLabels, counterfactualLaneY, 'counterfactual')}
              </g>
            </g>

            {/* Bottom Time Axis */}
            <g transform={`translate(0, ${innerHeight})`}>
              <line x1={0} y1={0} x2={innerWidth} y2={0} style={{ stroke: 'var(--text-muted)' }} strokeWidth={1} />
              {timeTicks.map(tick => (
                <g key={`tick-${tick.label}-${tick.x}`} transform={`translate(${tick.x}, 0)`}>
                  <line x1={0} y1={0} x2={0} y2={6} style={{ stroke: 'var(--text-muted)' }} strokeWidth={1} />
                  <text
                    x={0}
                    y={18}
                    textAnchor={tick.anchor}
                    fontSize={LABEL_FONT_PX}
                    className="font-mono-code"
                    style={{ fill: 'var(--text-secondary)' }}
                  >
                    {tick.label}
                  </text>
                </g>
              ))}
            </g>
          </g>
        </svg>

        {/* Hover/focus tooltip, positioned in the canvas wrapper's coordinates. */}
        {hovered && (
          <div
            role="tooltip"
            className="absolute z-30 pointer-events-none bg-card text-ink border border-line rounded-md p-2.5 shadow-lg text-xs"
            style={{
              maxWidth: `${TOOLTIP_WIDTH_PX}px`,
              // Kept inside the canvas, so it never widens a narrow sheet.
              left: `${Math.max(4, Math.min(hovered.x + 12, width - TOOLTIP_WIDTH_PX - 4))}px`,
              // Above the mark where there is room, otherwise below it.
              top: `${hovered.y >= 104 ? hovered.y - 100 : hovered.y + 16}px`,
            }}
          >
            <div className="font-semibold mb-0.5">{hovered.event.description}</div>
            <div className="text-ink-secondary">
              {hovered.event.actor} → {hovered.event.target}
            </div>
            <div className="font-mono-code text-ink-muted mt-1">
              {formatHistoricalTimestamp(hovered.event.timestamp)}
            </div>
            <div className="mt-1.5 pt-1.5 border-t border-line flex items-center gap-1.5 font-medium">
              <LegendMark status={hovered.status} />
              {STATUS_TEXT[hovered.status]}
            </div>
          </div>
        )}
      </div>

      {/* Point of divergence detail, opened from the marker */}
      {hoveredPod && (
        <div className="mt-4 p-3 bg-divergence/10 border border-divergence/40 rounded-md flex items-center justify-between gap-2 text-sm text-ink">
          <div>
            <span className="font-semibold mr-1">Point of divergence:</span>
            <span>{hoveredPod.description}</span>
          </div>
          <button
            type="button"
            onClick={() => setHoveredPod(null)}
            aria-label="Dismiss point of divergence details"
            className={CONTROL_BUTTON}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
})
