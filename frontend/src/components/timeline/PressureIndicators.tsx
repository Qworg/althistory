import React, { useCallback, useId, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Arc } from '@/types'
import {
  PressureWithContext,
  PressureIndicatorData
} from '@/types/pressure'
import {
  generatePressureIndicators,
  formatPressureTooltip,
  calculatePressurePositions,
  formatPressureType,
  getPressureTypeIconPath
} from '@/utils/pressureVisualization'
import { formatHistoricalRange } from '@/utils/historicalTime'
// The arc bar's height (TimelineArc draws it from `yScale(level)` down). A
// pressure bar sits on the arc's lower edge, inside the arc's own lane.
import { ARC_BAR_HEIGHT } from './timelineLayout'

export interface PressureIndicatorsProps {
  pressures: PressureWithContext[]
  arcs: Arc[]
  timeScale: (date: Date) => number
  yScale: (level: number) => number
  arcLevelMap: Map<string, number>
  /**
   * The chart's <svg>. Its parent element (the positioned timeline container)
   * is where the HTML tooltip is portalled, since an HTML tooltip cannot live
   * inside the SVG's clipped plot group.
   */
  svgRef: React.RefObject<SVGSVGElement | null>
  onPressureClick?: (pressure: PressureWithContext) => void
  onPressureHover?: (pressure: PressureWithContext | null) => void
  showTooltips?: boolean
  className?: string
}

/** Rough tooltip width used to flip it left of the pointer near the right edge. */
const TOOLTIP_WIDTH = 300


/**
 * Where a pressure bar sits in the arc lane at `arcY` (the arc bar's top).
 *
 * `generatePressureIndicators` puts it 25px *above* the arc's top. With lanes
 * 28px apart from 10px, a top-level arc's bar landed at y = -15, outside the
 * plot's clip rectangle (which starts at 0): with "Show indicators on the
 * timeline" ticked, no indicator of a root arc was ever visible. Deeper arcs
 * fared no better, their bars landing on the arc of the lane above. Anchored to
 * the arc's own bar, the indicator is inside the plot for every level, and
 * stacked indicators (calculatePressurePositions moves each overlap 8px up)
 * stay over the arc they describe.
 */
function onArcLane(arcY: number, barHeight: number): number {
  return arcY + ARC_BAR_HEIGHT - barHeight
}

/** A tooltip anchored to a point in the portal container's coordinate space. */
interface TooltipState {
  indicator: PressureIndicatorData
  container: HTMLElement
  left: number
  top: number
}

/** Stroke icon for a pressure type, from the shared outline icon set. */
function PressureTypeIcon({ type, className = 'h-4 w-4' }: { type: string; className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d={getPressureTypeIconPath(type)} />
    </svg>
  )
}

/**
 * Pressure bars drawn over the arcs they affect.
 *
 * ADR-001 Tier 1: React renders every mark, the gradient and the tooltip; the
 * layout maths lives in utils/pressureVisualization. The tooltip used to be a
 * div appended to document.body by d3, outside the React tree.
 */
export const PressureIndicators: React.FC<PressureIndicatorsProps> = ({
  pressures,
  arcs,
  timeScale,
  yScale,
  arcLevelMap,
  svgRef,
  onPressureClick,
  onPressureHover,
  showTooltips = true,
  className = ''
}) => {
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  // useId is unique per instance; strip the characters that are awkward
  // inside url(#…) references.
  const gradientId = `confidenceGradient-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`

  const indicatorData = useMemo(() => {
    const rawIndicators = generatePressureIndicators(
      pressures,
      arcs,
      timeScale,
      yScale,
      arcLevelMap
    ).map(indicator => {
      // generatePressureIndicators only emits arcs that are in arcLevelMap.
      const level = arcLevelMap.get(indicator.arc.id) ?? 0
      return { ...indicator, y: onArcLane(yScale(level), indicator.height) }
    })
    return calculatePressurePositions(rawIndicators)
  }, [pressures, arcs, timeScale, yScale, arcLevelMap])

  // Place the tooltip next to a viewport point, relative to the container it
  // is portalled into, flipping it left near the container's right edge.
  const showTooltipAt = useCallback((indicator: PressureIndicatorData, clientX: number, clientY: number) => {
    if (!showTooltips) return
    const container = svgRef.current?.parentElement
    if (!container) return
    const rect = container.getBoundingClientRect()
    const localX = clientX - rect.left
    const localY = clientY - rect.top
    const flip = rect.width > 0 && localX + TOOLTIP_WIDTH + 10 > rect.width
    setTooltip({
      indicator,
      container,
      left: flip ? Math.max(0, localX - TOOLTIP_WIDTH - 10) : localX + 10,
      top: localY + 10
    })
  }, [showTooltips, svgRef])

  const enter = useCallback((indicator: PressureIndicatorData, clientX: number, clientY: number) => {
    setHoveredId(indicator.id)
    showTooltipAt(indicator, clientX, clientY)
    onPressureHover?.(indicator.pressure)
  }, [showTooltipAt, onPressureHover])

  const leave = useCallback(() => {
    setHoveredId(null)
    setTooltip(null)
    onPressureHover?.(null)
  }, [onPressureHover])

  const activate = useCallback((indicator: PressureIndicatorData) => {
    onPressureClick?.(indicator.pressure)
  }, [onPressureClick])

  const tooltipData = tooltip ? formatPressureTooltip(tooltip.indicator.pressure, { x: tooltip.left, y: tooltip.top }) : null

  return (
    <g
      className={`pressure-indicators ${className}`}
      data-testid="pressure-indicators"
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity={0.8} />
          <stop offset="100%" stopColor="#ffffff" stopOpacity={0.2} />
        </linearGradient>
      </defs>

      {indicatorData.map(d => {
        const hovered = hoveredId === d.id
        const label =
          `${formatPressureType(d.pressure.pressure_type)} pressure on ${d.arc.name}: ` +
          `${d.pressure.description} (confidence ${Math.round(d.pressure.confidence_score * 100)}%)`
        return (
          <g
            key={d.id}
            className="pressure-indicator group"
            data-pressure-id={d.pressure.id}
            data-arc-id={d.arc.id}
            data-timeline-mark="pressure"
            role="button"
            // Out of the tab order: the timeline is one tab stop with arrow-key
            // navigation over events and arcs. The keyboard path to a pressure
            // is the Pressure Analysis list under the timeline, which opens the
            // same detail.
            tabIndex={-1}
            aria-label={label}
            style={{ cursor: 'pointer', outline: 'none' }}
            onClick={(e) => {
              e.stopPropagation()
              activate(d)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                e.stopPropagation()
                activate(d)
              }
            }}
            onMouseEnter={(e) => enter(d, e.clientX, e.clientY)}
            onMouseLeave={leave}
            onFocus={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              enter(d, r.left, r.bottom)
            }}
            onBlur={leave}
          >
            {/* Keyboard focus outline; the bar itself is only 4px tall. */}
            <rect
              className="pressure-focus-ring opacity-0 group-focus-visible:opacity-100"
              x={d.x - 3}
              y={d.y - 3}
              width={d.width + 6}
              height={d.height + 6}
              rx={3}
              fill="none"
              stroke="var(--accent-selected)"
              strokeWidth={2}
              pointerEvents="none"
            />
            <rect
              className="pressure-bar"
              x={d.x}
              y={d.y}
              width={d.width}
              height={d.height}
              fill={d.color}
              opacity={hovered ? Math.min(d.opacity + 0.2, 1) : d.opacity}
              stroke={hovered ? 'var(--text-primary)' : d.strokeColor}
              strokeWidth={hovered ? 2 : d.strokeWidth}
              rx={2}
              style={{ transition: 'opacity 150ms ease, stroke-width 150ms ease' }}
            />
            <circle
              className="pressure-type-indicator"
              cx={d.x + 6}
              cy={d.y + d.height / 2}
              r={3}
              fill={d.color}
              stroke="var(--surface-card)"
              strokeWidth={1}
            />
            <rect
              className="confidence-indicator"
              x={d.x}
              y={d.y}
              width={d.width * d.pressure.confidence_score}
              height={d.height}
              fill={`url(#${gradientId})`}
              opacity={0.3}
              rx={2}
              pointerEvents="none"
            />
          </g>
        )
      })}

      {tooltip && tooltipData && createPortal(
        <div
          role="tooltip"
          className="pressure-tooltip pointer-events-none absolute z-20 max-w-[300px] rounded-lg bg-[#0f172a]/95 p-3 text-xs text-[#f8fafc] shadow-lg"
          style={{ left: tooltip.left, top: tooltip.top, border: `2px solid ${tooltip.indicator.color}` }}
        >
          <div className="mb-2 flex items-center gap-2">
            <span style={{ color: tooltip.indicator.color }}>
              <PressureTypeIcon type={tooltipData.pressure.pressure_type} />
            </span>
            <div>
              <div className="font-semibold" style={{ color: tooltip.indicator.color }}>
                {formatPressureType(tooltipData.pressure.pressure_type)} Pressure
              </div>
              <div className="text-xs text-[#cbd5e1]">
                {/* 0–1, the scale of the Timeline view's confidence thresholds */}
                Confidence: <span className="font-mono-code">{tooltipData.pressure.confidence_score.toFixed(2)}</span> ({tooltipData.confidenceLevel})
              </div>
            </div>
          </div>

          <div className="mb-2 leading-snug">{tooltipData.pressure.description}</div>

          <div className="space-y-1 border-t border-[#334155] pt-2 text-xs text-[#cbd5e1]">
            <div><strong>Evidence Events:</strong> <span className="font-mono-code">{tooltipData.evidenceCount}</span></div>
            {/* The period the pressure was inferred over. "Influence strength"
                used to sit here, but it is confidence scaled up by the
                evidence count and capped at 1, so it read 100% for nearly
                every pressure and said nothing confidence did not. */}
            {tooltipData.pressure.time_range && (
              <div>
                <strong>Period:</strong>{' '}
                <span className="font-mono-code">
                  {formatHistoricalRange(tooltipData.pressure.time_range.start, tooltipData.pressure.time_range.end)}
                </span>
              </div>
            )}
            <div><strong>Affected Arcs:</strong> <span className="font-mono-code">{tooltipData.pressure.affectedArcs.length}</span></div>
            <div className="mt-2 italic text-[#94a3b8]">Click or press Enter to explore evidence and relationships</div>
          </div>
        </div>,
        tooltip.container
      )}
    </g>
  )
}

export default PressureIndicators
