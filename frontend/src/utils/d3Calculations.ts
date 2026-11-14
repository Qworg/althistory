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
 * @see docs/adr-001-d3-react-integration.md
 */

import * as d3 from 'd3'
import { Event, Arc, GraphCalendar } from '@/types'
import { getActiveCalendar } from '@/stores/worldCalendarStore'
import { axisOf, calendarIn, compareInstants, gregorianTicks, instantOfAxisTime, toInstant, worldTicks } from '@althistory/calendar'
import { type InstantScale, type PositionScale, instantScale, usesArithmeticTicks } from '@/utils/timeScale'
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
): InstantScale {
  return instantScale()
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
  // The earliest and the latest moment, compared exactly: a history of a
  // million years has moments a double cannot tell apart from their neighbours.
  let first: Date | null = null
  let last: Date | null = null
  const see = (date: Date) => {
    if (Number.isNaN(date.getTime())) return
    if (first === null || compareInstants(date, first) < 0) first = date
    if (last === null || compareInstants(date, last) > 0) last = date
  }

  // Collect timestamps from events
  for (const e of events) see(toInstant(e.timestamp))

  // Collect start/end times from arcs
  for (const a of arcs) {
    see(toInstant(a.start_time))
    see(toInstant(a.end_time))
  }

  // Default to ±30 days if no data
  if (first === null || last === null) {
    const now = Date.now()
    const thirtyDays = 1000 * 60 * 60 * 24 * 30
    return [new Date(now - thirtyDays), new Date(now + thirtyDays)]
  }

  return [first, last]
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
  xScale: PositionScale,
  yPosition: number
): EventPosition[] {
  return events.map(event => ({
    id: event.id,
    x: xScale(toInstant(event.timestamp)),
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
  xScale: PositionScale,
  yScale: (level: number) => number
): ArcPosition[] {
  return arcs.map(arc => {
    const x = xScale(toInstant(arc.start_time))
    const endX = xScale(toInstant(arc.end_time))
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
  xScale: PositionScale,
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

/**
 * Time span thresholds in milliseconds for format selection.
 */
const TIME_THRESHOLDS = {
  ONE_DAY: 24 * 60 * 60 * 1000,
  TWO_WEEKS: 14 * 24 * 60 * 60 * 1000,
  TWO_MONTHS: 60 * 24 * 60 * 60 * 1000,
  TWO_YEARS: 730 * 24 * 60 * 60 * 1000,
  TWO_DECADES: 7300 * 24 * 60 * 60 * 1000,
}

/**
 * Determines the appropriate time axis format based on the visible time span.
 *
 * Format selection:
 * - Within 1 day: hours:minutes:seconds (HH:MM:SS)
 * - Within 2 weeks: weekday + day (Mon 24)
 * - Within 2 months: month + day (Dec 24)
 * - Within 2 years: month + year (Dec 2025)
 * - Within 2 decades: year (2025)
 * - Beyond 2 decades: decade (2020s)
 *
 * @param timeSpanMs - The time span in milliseconds
 * @returns D3 time format string
 */
export function getTimeAxisFormat(timeSpanMs: number): string {
  if (timeSpanMs <= TIME_THRESHOLDS.ONE_DAY) {
    return '%H:%M:%S'
  } else if (timeSpanMs <= TIME_THRESHOLDS.TWO_WEEKS) {
    return '%a %d'
  } else if (timeSpanMs <= TIME_THRESHOLDS.TWO_MONTHS) {
    return '%b %d'
  } else if (timeSpanMs <= TIME_THRESHOLDS.TWO_YEARS) {
    return '%b %Y'
  } else if (timeSpanMs <= TIME_THRESHOLDS.TWO_DECADES) {
    return '%Y'
  } else {
    // Decades - custom formatting needed
    return 'decade'
  }
}

/**
 * One tick label for a time axis without a world calendar, in the format the
 * visible span calls for. `utc` reads the tick in UTC, as the event labels
 * read every historical date (a world calendar's ticks come from
 * {@link axisTicks} instead).
 */
export function formatTimeAxisTick(tick: Date, timeSpanMs: number, utc = false): string {
  return formatAxisLabel(getTimeAxisFormat(timeSpanMs), tick, utc)
}

function formatAxisLabel(name: string, tick: Date, utc: boolean): string {
  const timeFormat = utc ? d3.utcFormat : d3.timeFormat
  const fullYear = utc ? tick.getUTCFullYear() : tick.getFullYear()
  if (name === 'decade') return `${Math.floor(fullYear / 10) * 10}s`
  return timeFormat(name)(tick)
}

/** The axis label formats from coarsest to finest. */
const TIME_AXIS_FORMAT_LADDER = ['decade', '%Y', '%b %Y', '%b %d', '%a %d', '%H:%M:%S'] as const

/**
 * Labels for a whole axis without a world calendar: the format the span
 * prefers, or the next finer one when two ticks would read the same. d3's
 * count-based `scale.ticks(n)` over ~35 years steps every 5 years, and
 * labelling those by decade printed "1840s" under both 1840 and 1845.
 *
 * @param ticks - The tick values, in order
 * @param timeSpanMs - The visible time span in milliseconds
 * @returns One label per tick
 */
export function formatTimeAxisTicks(ticks: Date[], timeSpanMs: number, utc = false): string[] {
  const preferred = getTimeAxisFormat(timeSpanMs)
  const start = Math.max(0, TIME_AXIS_FORMAT_LADDER.indexOf(preferred as (typeof TIME_AXIS_FORMAT_LADDER)[number]))
  for (const name of TIME_AXIS_FORMAT_LADDER.slice(start)) {
    const labels = ticks.map((tick) => formatAxisLabel(name, tick, utc))
    if (new Set(labels).size === labels.length) return labels
  }
  return ticks.map((tick) => formatAxisLabel('%H:%M:%S', tick, utc))
}

/**
 * A time axis's ticks and their labels. In a world calendar, its own: years,
 * months, days and hours of the world, labelled in its notation
 * (`worldTicks`, docs/specs/world-calendars.md Req 17). Otherwise d3's UTC
 * ticks, labelled by the span. At most about `count` ticks either way.
 */
export function axisTicks(
  domain: readonly [Date, Date] | readonly Date[],
  count: number,
  calendar: GraphCalendar | null = getActiveCalendar()
): Array<{ date: Date; label: string }> {
  const first = domain[0]!
  const last = domain[domain.length - 1]!
  const start = +first
  const end = +last
  // Exact beyond a Date's range, where a double has no whole milliseconds.
  const from = axisOf(first)
  const to = axisOf(last)
  if (calendar) {
    return worldTicks(calendarIn(calendar), [from ?? 0n, to ?? 0n], Math.max(2, count)).map((tick) => ({
      date: instantOfAxisTime(tick.position) ?? new Date(NaN),
      label: tick.label,
    }))
  }
  if (from !== null && to !== null && usesArithmeticTicks(first, last)) {
    // Past what d3's ticks reach, or where they floor out of a Date's range or label a BCE year
    // astronomically: the calendar package's, labelled in years ("300000 BCE").
    return gregorianTicks([from, to], Math.max(2, count)).map((tick) => ({
      date: instantOfAxisTime(tick.position) ?? new Date(NaN),
      label: tick.label,
    }))
  }
  const ticks = d3.scaleUtc().domain([new Date(start), new Date(end)]).ticks(Math.max(2, count))
  if (ticks.length === 0 && from !== null && to !== null && from !== to) {
    // d3 made none (its interval floored the start out of a Date's range).
    return gregorianTicks([from, to], Math.max(2, count)).map((tick) => ({
      date: instantOfAxisTime(tick.position) ?? new Date(NaN),
      label: tick.label,
    }))
  }
  const labels = formatTimeAxisTicks(ticks, Math.abs(end - start), true)
  return ticks.map((date, index) => ({ date, label: labels[index]! }))
}

/**
 * Returns appropriate D3 time interval for tick generation based on time span.
 *
 * @param timeSpanMs - The time span in milliseconds
 * @returns D3 time interval for tick generation
 */
export function getTimeAxisInterval(timeSpanMs: number, utc = false): d3.TimeInterval {
  // `utc` gives the UTC intervals, for an axis read in UTC like the event labels.
  if (timeSpanMs <= TIME_THRESHOLDS.ONE_DAY) {
    // Within a day: hourly ticks
    return utc ? d3.utcHour : d3.timeHour
  } else if (timeSpanMs <= TIME_THRESHOLDS.TWO_WEEKS) {
    // Within 2 weeks: daily ticks
    return utc ? d3.utcDay : d3.timeDay
  } else if (timeSpanMs <= TIME_THRESHOLDS.TWO_MONTHS) {
    // Within 2 months: weekly ticks
    return utc ? d3.utcWeek : d3.timeWeek
  } else if (timeSpanMs <= TIME_THRESHOLDS.TWO_YEARS) {
    // Within 2 years: monthly ticks
    return utc ? d3.utcMonth : d3.timeMonth
  } else if (timeSpanMs <= TIME_THRESHOLDS.TWO_DECADES) {
    // Within 2 decades: yearly ticks
    return utc ? d3.utcYear : d3.timeYear
  } else {
    // Beyond 2 decades: decade ticks (every 10 years)
    return (utc ? d3.utcYear.every(10) : d3.timeYear.every(10)) as d3.TimeInterval
  }
}
