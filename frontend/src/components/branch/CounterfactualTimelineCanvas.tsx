import { memo, useMemo, useState, useCallback, useRef } from 'react'
import * as d3 from 'd3'
import { Event, Arc } from '@/types'
import {
  analyzeEventDivergence,
  PointOfDivergence,
  EventComparisonItem,
} from '@/utils/divergenceAnalysis'

export interface CounterfactualTimelineCanvasProps {
  readonly baselineName: string
  readonly counterfactualName: string
  readonly baselineEvents: readonly Event[]
  readonly counterfactualEvents: readonly Event[]
  readonly baselineArcs?: readonly Arc[]
  readonly counterfactualArcs?: readonly Arc[]
  readonly width?: number
  readonly height?: number
  readonly margin?: { top: number; right: number; bottom: number; left: number }
  readonly onEventSelect?: (event: Event, lane: 'baseline' | 'counterfactual') => void
  readonly className?: string
}

interface HoveredItem {
  readonly event: Event
  readonly lane: 'baseline' | 'counterfactual'
  readonly status: 'shared' | 'divergent_added' | 'baseline_only' | 'modified'
  readonly x: number
  readonly y: number
}

const DEFAULT_MARGIN = { top: 32, right: 32, bottom: 48, left: 140 }

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
  width = 960,
  height = 360,
  margin = DEFAULT_MARGIN,
  onEventSelect,
  className = '',
}: CounterfactualTimelineCanvasProps) {
  const [zoomFactor, setZoomFactor] = useState(1)
  const [panOffset, setPanOffset] = useState(0)
  const [hovered, setHovered] = useState<HoveredItem | null>(null)
  const [hoveredPod, setHoveredPod] = useState<PointOfDivergence | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

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

  // 4. D3 Scale calculation
  const xScale = useMemo(() => {
    return d3.scaleTime().domain(currentDomain).range([0, innerWidth])
  }, [currentDomain, innerWidth])

  // 5. Ticks for time axis
  const timeTicks = useMemo(() => {
    return xScale.ticks(6).map(date => ({
      date,
      x: xScale(date),
      label: d3.timeFormat('%Y-%m-%d')(date),
    }))
  }, [xScale])

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

  return (
    <div className={`counterfactual-timeline-container relative bg-white rounded-lg shadow-sm border border-gray-200 p-4 ${className}`}>
      {/* Top Action / Legend Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4 border-b border-gray-100 pb-3">
        <div className="flex flex-wrap items-center gap-4 text-xs font-medium">
          <div className="flex items-center gap-1.5 text-blue-700">
            <span className="w-3 h-3 rounded-full bg-blue-500 inline-block" />
            <span>Baseline: {baselineName}</span>
          </div>
          <div className="flex items-center gap-1.5 text-purple-700">
            <span className="w-3 h-3 rounded-full bg-purple-600 inline-block" />
            <span>Branch: {counterfactualName}</span>
          </div>
          {metrics.pointOfDivergence && (
            <div className="flex items-center gap-1.5 text-amber-700 font-semibold bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200">
              <span className="w-2.5 h-2.5 rotate-45 bg-amber-500 inline-block" />
              <span>PoD: {new Date(metrics.pointOfDivergence.timestamp).toLocaleDateString()}</span>
            </div>
          )}
        </div>

        {/* Zoom & Pan Controls */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handlePanLeft}
            className="p-1 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded"
            title="Pan Left"
          >
            ◀
          </button>
          <button
            type="button"
            onClick={handlePanRight}
            className="p-1 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded"
            title="Pan Right"
          >
            ▶
          </button>
          <button
            type="button"
            onClick={handleZoomIn}
            className="p-1 px-2 text-xs font-semibold text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded"
            title="Zoom In"
          >
            +
          </button>
          <button
            type="button"
            onClick={handleZoomOut}
            className="p-1 px-2 text-xs font-semibold text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded"
            title="Zoom Out"
          >
            -
          </button>
          <button
            type="button"
            onClick={handleResetZoom}
            className="p-1 px-2 text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded"
            title="Reset View"
          >
            Reset
          </button>
        </div>
      </div>

      {/* D3-driven SVG Dual-Lane Canvas */}
      <div className="overflow-x-auto">
        <svg
          ref={svgRef}
          width={width}
          height={height}
          className="select-none"
          role="img"
          aria-label={`Counterfactual divergence timeline between ${baselineName} and ${counterfactualName}`}
        >
          <defs>
            <clipPath id="dual-lane-clip">
              <rect x={0} y={0} width={innerWidth} height={innerHeight} />
            </clipPath>
            {/* Divergence Point Gradient */}
            <linearGradient id="pod-glow" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.8" />
              <stop offset="50%" stopColor="#FBBF24" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#F59E0B" stopOpacity="0.8" />
            </linearGradient>
          </defs>

          {/* Lane Labels in Left Margin */}
          <g transform={`translate(${margin.left - 12}, ${margin.top})`}>
            <text
              x={0}
              y={baselineLaneY + 4}
              textAnchor="end"
              className="text-xs font-semibold fill-blue-800"
              fontSize={12}
            >
              {baselineName}
            </text>
            <text
              x={0}
              y={counterfactualLaneY + 4}
              textAnchor="end"
              className="text-xs font-semibold fill-purple-800"
              fontSize={12}
            >
              {counterfactualName}
            </text>
          </g>

          <g transform={`translate(${margin.left}, ${margin.top})`}>
            {/* Background */}
            <rect
              x={0}
              y={0}
              width={innerWidth}
              height={innerHeight}
              fill="#F9FAFB"
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
                stroke="#DBEAFE"
                strokeWidth={2}
                strokeDasharray="4 4"
              />

              {/* Counterfactual Lane Guide */}
              <line
                x1={0}
                y1={counterfactualLaneY}
                x2={innerWidth}
                y2={counterfactualLaneY}
                stroke="#EDE9FE"
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
                  stroke="#E5E7EB"
                  strokeWidth={1.5}
                  strokeDasharray="2 2"
                />
              ))}

              {/* Point of Divergence Marker */}
              {podCoordinate && podCoordinate.isInView && (
                <g className="cursor-pointer" onClick={() => setHoveredPod(podCoordinate.pod)}>
                  {/* Glow band */}
                  <rect
                    x={podCoordinate.x - 12}
                    y={0}
                    width={24}
                    height={innerHeight}
                    fill="#FEF3C7"
                    opacity={0.35}
                  />

                  {/* Divergence Line */}
                  <line
                    x1={podCoordinate.x}
                    y1={0}
                    x2={podCoordinate.x}
                    y2={innerHeight}
                    stroke="#F59E0B"
                    strokeWidth={2.5}
                    strokeDasharray="6 3"
                  />

                  {/* Top PoD Fork Badge */}
                  <g transform={`translate(${podCoordinate.x}, 16)`}>
                    <polygon
                      points="0,-8 8,0 0,8 -8,0"
                      fill="#F59E0B"
                      stroke="#B45309"
                      strokeWidth={1.5}
                    />
                    <text
                      x={12}
                      y={4}
                      fontSize={11}
                      fontWeight="bold"
                      fill="#B45309"
                    >
                      Point of Divergence
                    </text>
                  </g>
                </g>
              )}

              {/* Baseline Lane Events */}
              {baselineEvents.map(event => {
                const x = xScale(new Date(event.timestamp))
                if (x < -20 || x > innerWidth + 20) return null

                const item = itemMap.get(event.id)
                const isShared = item?.status === 'shared'
                const isSuperseded = item?.status === 'baseline_only'

                return (
                  <g
                    key={`base-${event.id}`}
                    data-testid={`event-node-${event.id}`}
                    transform={`translate(${x}, ${baselineLaneY})`}
                    className="cursor-pointer"
                    onClick={() => onEventSelect?.(event, 'baseline')}
                    onMouseEnter={() =>
                      setHovered({
                        event,
                        lane: 'baseline',
                        status: item?.status ?? 'shared',
                        x: margin.left + x,
                        y: margin.top + baselineLaneY,
                      })
                    }
                    onMouseLeave={() => setHovered(null)}
                  >
                    <circle
                      r={isShared ? 6 : 7}
                      fill={isShared ? '#3B82F6' : '#9CA3AF'}
                      stroke={isShared ? '#1D4ED8' : '#4B5563'}
                      strokeWidth={1.5}
                      strokeDasharray={isSuperseded ? '2 2' : undefined}
                      opacity={isSuperseded ? 0.75 : 1}
                    />
                  </g>
                )
              })}

              {/* Counterfactual Lane Events */}
              {counterfactualEvents.map(event => {
                const x = xScale(new Date(event.timestamp))
                if (x < -20 || x > innerWidth + 20) return null

                const item = itemMap.get(event.id)
                const isDivergent = item?.status === 'divergent_added' || item?.status === 'modified'

                return (
                  <g
                    key={`cf-${event.id}`}
                    data-testid={`cf-event-node-${event.id}`}
                    transform={`translate(${x}, ${counterfactualLaneY})`}
                    className="cursor-pointer"
                    onClick={() => onEventSelect?.(event, 'counterfactual')}
                    onMouseEnter={() =>
                      setHovered({
                        event,
                        lane: 'counterfactual',
                        status: item?.status ?? 'divergent_added',
                        x: margin.left + x,
                        y: margin.top + counterfactualLaneY,
                      })
                    }
                    onMouseLeave={() => setHovered(null)}
                  >
                    {/* Golden halo for divergent milestone events */}
                    {isDivergent && (
                      <circle
                        r={11}
                        fill="none"
                        stroke="#F59E0B"
                        strokeWidth={1.5}
                        strokeDasharray="3 2"
                        opacity={0.8}
                      />
                    )}

                    <circle
                      r={isDivergent ? 7 : 6}
                      fill={isDivergent ? '#8B5CF6' : '#3B82F6'}
                      stroke={isDivergent ? '#6D28D9' : '#1D4ED8'}
                      strokeWidth={2}
                    />
                  </g>
                )
              })}
            </g>

            {/* Bottom Time Axis */}
            <g transform={`translate(0, ${innerHeight})`}>
              <line x1={0} y1={0} x2={innerWidth} y2={0} stroke="#D1D5DB" strokeWidth={1} />
              {timeTicks.map(tick => (
                <g key={`tick-${tick.label}-${tick.x}`} transform={`translate(${tick.x}, 0)`}>
                  <line x1={0} y1={0} x2={0} y2={6} stroke="#9CA3AF" strokeWidth={1} />
                  <text
                    x={0}
                    y={18}
                    textAnchor="middle"
                    fontSize={10}
                    fill="#6B7280"
                  >
                    {tick.label}
                  </text>
                </g>
              ))}
            </g>
          </g>
        </svg>
      </div>

      {/* Floating Hover Tooltip */}
      {hovered && (
        <div
          className="absolute z-30 pointer-events-none bg-gray-900 text-white rounded-lg p-2.5 shadow-xl text-xs max-w-xs transition-opacity duration-150"
          style={{
            left: `${Math.min(hovered.x + 12, width - 240)}px`,
            top: `${Math.max(hovered.y - 70, 10)}px`,
          }}
        >
          <div className="font-semibold text-white mb-0.5">{hovered.event.description}</div>
          <div className="text-gray-300">
            {hovered.event.actor} → {hovered.event.target}
          </div>
          <div className="text-gray-400 mt-1">
            {new Date(hovered.event.timestamp).toLocaleString()}
          </div>
          <div className="mt-1.5 pt-1.5 border-t border-gray-700 flex items-center gap-1.5 font-medium">
            {hovered.status === 'shared' && (
              <span className="text-blue-400">✓ Shared Continuity</span>
            )}
            {hovered.status === 'divergent_added' && (
              <span className="text-purple-400">★ Counterfactual Divergence</span>
            )}
            {hovered.status === 'modified' && (
              <span className="text-amber-400">✎ Modified in Branch</span>
            )}
            {hovered.status === 'baseline_only' && (
              <span className="text-gray-400">∅ Baseline Only (Prevented)</span>
            )}
          </div>
        </div>
      )}

      {/* Point of Divergence Click Detail Card */}
      {hoveredPod && (
        <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between text-xs text-amber-900">
          <div>
            <span className="font-bold mr-1">Point of Divergence:</span>
            <span>{hoveredPod.description}</span>
          </div>
          <button
            type="button"
            onClick={() => setHoveredPod(null)}
            className="text-amber-700 hover:text-amber-900 font-bold ml-2"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
})
