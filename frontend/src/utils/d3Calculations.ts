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
import { formatWorldYear, worldYear } from '@/utils/worldCalendar'
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
 * Formats a tick value based on the visible time span.
 * Handles standard D3 formats and special cases like decades.
 *
 * @param tick - The Date to format
 * @param timeSpanMs - The visible time span in milliseconds
 * @returns Formatted string for the tick label
 */
export function formatTimeAxisTick(
  tick: Date,
  timeSpanMs: number,
  calendar: GraphCalendar | null = getActiveCalendar()
): string {
  return formatAxisLabel(getTimeAxisFormat(timeSpanMs), tick, calendar)
}

/**
 * One tick label in a named format. With a world calendar the year is the
 * world's ("312 AR", "Mar 312 AR"), so the axis says what the event labels say
 * (see utils/historicalTime.ts); a decade becomes the tick's own world year,
 * since the world's decades do not start where the Gregorian ones do (the
 * ticks are moved onto them by {@link alignYearTicksToCalendar}).
 *
 * The axis reads the tick's year as d3's local-time scale and format do, so a
 * label always agrees with the other labels on its axis.
 */
function formatAxisLabel(name: string, tick: Date, calendar: GraphCalendar | null): string {
  if (calendar) {
    const year = formatWorldYear(tick.getFullYear(), calendar)
    if (name === 'decade' || name === '%Y') return year
    if (name === '%b %Y') return `${d3.timeFormat('%b')(tick)} ${year}`
    return d3.timeFormat(name)(tick)
  }
  if (name === 'decade') return `${Math.floor(tick.getFullYear() / 10) * 10}s`
  return d3.timeFormat(name)(tick)
}

/** Axis label formats, coarsest first. */
const TIME_AXIS_FORMAT_LADDER = ['decade', '%Y', '%b %Y', '%b %d', '%a %d', '%H:%M:%S'] as const

/**
 * Labels for a whole set of axis ticks.
 *
 * The span decides the preferred format, but the ticks decide whether it can
 * be used: a count-based `scale.ticks(n)` over ~35 years steps every 5 years,
 * and labelling those by decade printed "1840s" under both 1840 and 1845. The
 * preferred format is used when it gives every tick a distinct label;
 * otherwise the next finer format that does.
 *
 * @param ticks - The tick values, in order
 * @param timeSpanMs - The visible time span in milliseconds
 * @returns One label per tick
 */
export function formatTimeAxisTicks(
  ticks: Date[],
  timeSpanMs: number,
  calendar: GraphCalendar | null = getActiveCalendar()
): string[] {
  const preferred = getTimeAxisFormat(timeSpanMs)
  const start = Math.max(0, TIME_AXIS_FORMAT_LADDER.indexOf(preferred as (typeof TIME_AXIS_FORMAT_LADDER)[number]))
  const format = (name: string, tick: Date) => formatAxisLabel(name, tick, calendar)

  for (const name of TIME_AXIS_FORMAT_LADDER.slice(start)) {
    const labels = ticks.map((tick) => format(name, tick))
    if (new Set(labels).size === labels.length) return labels
  }
  return ticks.map((tick) => format('%H:%M:%S', tick))
}

/**
 * Move year ticks onto the world's round years.
 *
 * d3 steps multi-year ticks on Gregorian multiples (1840, 1850, ...). With a
 * world calendar whose year 1 is stored 1000, those are world years 841 and
 * 851; the same step moved to stored 1849, 1859 gives 850 and 860, which is
 * what an axis should read. Ticks that are not all New Year's Days at an even
 * step of two or more years (months, days, hours) are returned unchanged, as
 * they are without a calendar.
 *
 * @param ticks - The scale's ticks, in order
 * @param domain - The visible domain; moved ticks outside it are dropped
 * @param calendar - The world calendar (default: the active graph's)
 * @param utc - Whether the scale is a UTC scale (`d3.scaleUtc`) or local time (`d3.scaleTime`)
 */
export function alignYearTicksToCalendar(
  ticks: Date[],
  domain: [Date, Date] | Date[],
  calendar: GraphCalendar | null = getActiveCalendar(),
  utc = false
): Date[] {
  if (!calendar || ticks.length < 2) return ticks
  const yearOf = (d: Date) => (utc ? d.getUTCFullYear() : d.getFullYear())
  const isYearStart = (d: Date) =>
    utc
      ? d.getUTCMonth() === 0 && d.getUTCDate() === 1 && d.getUTCHours() === 0 && d.getUTCMinutes() === 0
      : d.getMonth() === 0 && d.getDate() === 1 && d.getHours() === 0 && d.getMinutes() === 0
  if (!ticks.every(isYearStart)) return ticks
  const step = yearOf(ticks[1]!) - yearOf(ticks[0]!)
  if (step < 2) return ticks
  for (let i = 2; i < ticks.length; i++) {
    if (yearOf(ticks[i]!) - yearOf(ticks[i - 1]!) !== step) return ticks
  }

  const yearStart = (year: number) => {
    const date = new Date(0)
    if (utc) {
      date.setUTCFullYear(year, 0, 1)
    } else {
      date.setFullYear(year, 0, 1)
      date.setHours(0, 0, 0, 0)
    }
    return date
  }
  const [lo, hi] = [Math.min(+domain[0]!, +domain[domain.length - 1]!), Math.max(+domain[0]!, +domain[domain.length - 1]!)]
  // The first stored year at or before the first tick whose world year is a multiple of the step.
  const firstYear = yearOf(ticks[0]!)
  const offset = ((worldYear(firstYear, calendar) % step) + step) % step
  const aligned: Date[] = []
  for (let year = firstYear - offset; year <= yearOf(ticks[ticks.length - 1]!) + step; year += step) {
    const date = yearStart(year)
    if (+date >= lo && +date <= hi) aligned.push(date)
  }
  return aligned.length > 0 ? aligned : ticks
}

/**
 * Returns appropriate D3 time interval for tick generation based on time span.
 *
 * @param timeSpanMs - The time span in milliseconds
 * @returns D3 time interval for tick generation
 */
export function getTimeAxisInterval(timeSpanMs: number): d3.TimeInterval {
  if (timeSpanMs <= TIME_THRESHOLDS.ONE_DAY) {
    // Within a day: hourly ticks
    return d3.timeHour
  } else if (timeSpanMs <= TIME_THRESHOLDS.TWO_WEEKS) {
    // Within 2 weeks: daily ticks
    return d3.timeDay
  } else if (timeSpanMs <= TIME_THRESHOLDS.TWO_MONTHS) {
    // Within 2 months: weekly ticks
    return d3.timeWeek
  } else if (timeSpanMs <= TIME_THRESHOLDS.TWO_YEARS) {
    // Within 2 years: monthly ticks
    return d3.timeMonth
  } else if (timeSpanMs <= TIME_THRESHOLDS.TWO_DECADES) {
    // Within 2 decades: yearly ticks
    return d3.timeYear
  } else {
    // Beyond 2 decades: decade ticks (every 10 years)
    return d3.timeYear.every(10) as d3.TimeInterval
  }
}
