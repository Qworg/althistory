/**
 * Pure D3 calculation functions for Timeline component.
 *
 * These functions perform D3-based calculations without any DOM manipulation.
 * They are designed to be used with React's memoization (useMemo) to prevent
 * unnecessary recalculations.
 *
 * Current usage:
 * - formatDuration: Re-exported from arcHierarchyUtils.ts for duration display
 *
 * Available utilities for advanced use cases:
 * - createTimeScale: Create a D3 time scale with nice() applied
 * - calculateTimeDomain: Calculate min/max dates from events and arcs
 * - calculateEventPositions: Compute x,y positions for event markers
 * - calculateArcPositions: Compute x,y,width for arc rectangles
 * - createArcYScale: Create a y-scale function for arc levels
 * - pixelToTimestamp: Convert pixel position to Date
 * - calculateInnerDimensions: Compute inner dimensions accounting for margins
 *
 * Note: Some functions may have equivalent logic in useTimelineScales hook.
 * This file serves as a utility library for:
 * 1. Direct use when hook patterns aren't needed
 * 2. Testing D3 calculations in isolation
 * 3. Future features that need these calculations
 *
 * @see impl/deferredplans/01-timeline-architecture-refactor.md (Phase 3.1)
 * @see impl/deferredplans/ADR-001-d3-react-integration.md
 */

import * as d3 from 'd3'
import { Event, Arc } from '@/types'
import { ArcWithUIState } from '@/components/timeline/arcHierarchyUtils'

/**
 * Position of an event on the timeline (calculated)
 */
export interface EventPosition {
  id: string
  x: number
  y: number
  event: Event
}

/**
 * Position of an arc on the timeline (calculated)
 */
export interface ArcPosition {
  id: string
  x: number
  y: number
  width: number
  arc: ArcWithUIState
}

/**
 * Creates a D3 time scale with the given domain and range.
 *
 * @param domain - [startDate, endDate] tuple
 * @param range - [startPixel, endPixel] tuple
 * @returns Configured D3 time scale
 */
export function createTimeScale(
  domain: [Date, Date],
  range: [number, number]
): d3.ScaleTime<number, number> {
  return d3.scaleTime()
    .domain(domain)
    .range(range)
    .nice()
}

/**
 * Calculates the time domain from events and arcs.
 *
 * @param events - Array of events
 * @param arcs - Array of arcs
 * @returns [minDate, maxDate] tuple, or default ±30 days if no data
 */
export function calculateTimeDomain(
  events: Event[],
  arcs: Arc[]
): [Date, Date] {
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
    const thirtyDays = 1000 * 60 * 60 * 24 * 30
    return [new Date(now - thirtyDays), new Date(now + thirtyDays)]
  }

  return [new Date(Math.min(...times)), new Date(Math.max(...times))]
}

/**
 * Calculates event positions on the timeline.
 *
 * @param events - Array of events to position
 * @param xScale - D3 time scale for x positioning
 * @param yPosition - Fixed y position for all events
 * @returns Array of event positions
 */
export function calculateEventPositions(
  events: Event[],
  xScale: d3.ScaleTime<number, number>,
  yPosition: number
): EventPosition[] {
  return events.map(event => ({
    id: event.id,
    x: xScale(new Date(event.timestamp)),
    y: yPosition,
    event
  }))
}

/**
 * Calculates arc positions on the timeline.
 *
 * @param arcs - Array of arcs with UI state to position
 * @param xScale - D3 time scale for x positioning
 * @param yScale - Function to calculate y position from render level
 * @returns Array of arc positions
 */
export function calculateArcPositions(
  arcs: ArcWithUIState[],
  xScale: d3.ScaleTime<number, number>,
  yScale: (level: number) => number
): ArcPosition[] {
  return arcs.map(arc => {
    const x = xScale(new Date(arc.start_time))
    const endX = xScale(new Date(arc.end_time))
    return {
      id: arc.id,
      x,
      width: Math.max(0, endX - x),
      y: yScale(arc.renderLevel),
      arc
    }
  })
}

/**
 * Creates a y-scale function for arc levels.
 *
 * @param levelHeight - Height of each level in pixels (default: 28)
 * @param startY - Starting y position (default: 10)
 * @returns Function that maps level to y position
 */
export function createArcYScale(
  levelHeight: number = 28,
  startY: number = 10
): (level: number) => number {
  return (level: number) => startY + level * levelHeight
}

/**
 * Converts a pixel position to a timestamp using scale inversion.
 *
 * @param x - Pixel position
 * @param xScale - D3 time scale
 * @param marginLeft - Left margin offset
 * @param innerWidth - Inner width for clamping
 * @returns Date corresponding to the position
 */
export function pixelToTimestamp(
  x: number,
  xScale: d3.ScaleTime<number, number>,
  marginLeft: number,
  innerWidth: number
): Date {
  // Adjust for margin and clamp to valid range
  const adjustedX = x - marginLeft
  const clampedX = Math.max(0, Math.min(innerWidth, adjustedX))
  return xScale.invert(clampedX)
}

/**
 * Calculates inner dimensions after accounting for margins.
 *
 * @param width - Total width
 * @param height - Total height
 * @param margin - Margin configuration
 * @returns Inner dimensions
 */
export function calculateInnerDimensions(
  width: number,
  height: number,
  margin: { top: number; right: number; bottom: number; left: number }
): { innerWidth: number; innerHeight: number } {
  return {
    innerWidth: Math.max(0, width - margin.left - margin.right),
    innerHeight: Math.max(0, height - margin.top - margin.bottom)
  }
}

/**
 * Formats a duration between two dates for display.
 *
 * @param start - Start date
 * @param end - End date
 * @returns Human-readable duration string
 */
export function formatDuration(start: Date, end: Date): string {
  const diffMs = end.getTime() - start.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays < 1) {
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    return `${diffHours} hours`
  } else if (diffDays < 30) {
    return `${diffDays} days`
  } else if (diffDays < 365) {
    const diffMonths = Math.floor(diffDays / 30)
    return `${diffMonths} months`
  } else {
    const diffYears = Math.floor(diffDays / 365)
    return `${diffYears} years`
  }
}
