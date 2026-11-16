// frontend/src/hooks/useTimelineScales.ts
// See: docs/adr-001-d3-react-integration.md

import { useMemo } from 'react'
import { clampedAddInstantMs, instantExtent, instantScale } from '@/utils/timeScale'
import { Event, Arc } from '@/types'
import { TimelineMargin, UseTimelineScalesResult } from '@/types/timeline'
import { msApart, toInstant } from '@althistory/calendar'

/**
 * Custom hook for memoized timeline scale calculations.
 *
 * This hook extracts scale calculation logic from the Timeline component,
 * providing properly memoized D3 scale objects that only recalculate
 * when their dependencies actually change.
 *
 * @param events - Array of timeline events
 * @param arcs - Array of timeline arcs
 * @param width - Total SVG width
 * @param height - Total SVG height
 * @param margin - Margin configuration
 * @param zoomLevel - Zoom level (1 = fit to view, >1 = zoomed in)
 * @returns Memoized scale objects and dimensions
 */
export function useTimelineScales(
  events: Event[],
  arcs: Arc[],
  width: number,
  height: number,
  margin: TimelineMargin,
  zoomLevel: number = 1
): UseTimelineScalesResult {
  // Calculate inner dimensions (memoized)
  const innerWidth = useMemo(() => 
    Math.max(0, width - margin.left - margin.right),
    [width, margin.left, margin.right]
  )

  const innerHeight = useMemo(() => 
    Math.max(0, height - margin.top - margin.bottom),
    [height, margin.top, margin.bottom]
  )

  // Calculate x-axis domain from events and arcs (memoized)
  const xDomain = useMemo((): [Date, Date] => {
    // The first and last moment of the events and arcs, compared exactly.
    const extent = instantExtent([
      ...events.map(e => toInstant(e.timestamp)),
      ...arcs.flatMap(a => [toInstant(a.start_time), toInstant(a.end_time)]),
    ])

    // Default to ±30 days if no data
    if (!extent) {
      const now = Date.now()
      return [
        new Date(now - 1000 * 60 * 60 * 24 * 30),
        new Date(now + 1000 * 60 * 60 * 24 * 30)
      ]
    }

    const [first, last] = extent
    const range = msApart(first, last)

    // Add small padding (2% on each side) so events don't sit at the very edge
    // This ensures events spread across ~96% of the width
    // Minimum padding is 10 seconds to avoid events touching the edge
    const padding = Math.max(range * 0.02, 1000 * 10) // At least 10 seconds padding

    return [clampedAddInstantMs(first, -padding), clampedAddInstantMs(last, padding)]
  }, [events, arcs])

  // Calculate zoomed width - when zoomLevel > 1, content is wider than container
  const zoomedWidth = useMemo(() =>
    innerWidth * zoomLevel,
    [innerWidth, zoomLevel]
  )

  // Create D3 time scale (memoized)
  // When zoomLevel = 1, all events fit in innerWidth
  // When zoomLevel > 1, events spread out more (zoomed in)
  const xScale = useMemo(() =>
    instantScale()
      .domain(xDomain)
      .range([0, zoomedWidth]),
    [xDomain, zoomedWidth]
  )

  return {
    xScale,
    innerWidth,
    innerHeight,
    xDomain,
    zoomedWidth
  }
}

export default useTimelineScales
