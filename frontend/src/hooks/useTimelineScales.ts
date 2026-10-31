// frontend/src/hooks/useTimelineScales.ts
// See: docs/adr-001-d3-react-integration.md

import { useMemo } from 'react'
import * as d3 from 'd3'
import { Event, Arc } from '@/types'
import { TimelineMargin, UseTimelineScalesResult } from '@/types/timeline'

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
    const times: number[] = []

    // Collect timestamps from events
    for (const e of events) {
      const t = new Date(e.timestamp).getTime()
      if (!Number.isNaN(t)) times.push(t)
    }

    // Collect start/end times from arcs
    for (const a of arcs) {
      const s = new Date(a.start_time).getTime()
      const e = new Date(a.end_time).getTime()
      if (!Number.isNaN(s)) times.push(s)
      if (!Number.isNaN(e)) times.push(e)
    }

    // Default to ±30 days if no data
    if (times.length === 0) {
      const now = Date.now()
      return [
        new Date(now - 1000 * 60 * 60 * 24 * 30),
        new Date(now + 1000 * 60 * 60 * 24 * 30)
      ]
    }

    const minTime = Math.min(...times)
    const maxTime = Math.max(...times)
    const range = maxTime - minTime

    // Add small padding (2% on each side) so events don't sit at the very edge
    // This ensures events spread across ~96% of the width
    // Minimum padding is 10 seconds to avoid events touching the edge
    const padding = Math.max(range * 0.02, 1000 * 10) // At least 10 seconds padding

    return [new Date(minTime - padding), new Date(maxTime + padding)]
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
    d3.scaleTime()
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
