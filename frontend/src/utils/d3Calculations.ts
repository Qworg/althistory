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
import { axisOf, calendarIn, compareInstants, formatBoundAt, gregorianTicks, instantOfAxisTime, msApart, toInstant, worldTicks } from '@althistory/calendar'
import { type InstantScale, type PositionScale, instantScale, usesArithmeticTicks } from '@/utils/timeScale'
import { thinTickLabels } from '@/utils/axisLabelFit'
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
  // Exact to the nearest double: a getTime() difference of two deep moments is off by up to a second.
  const diffMs = msApart(start, end)
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
  // A set of one: before 1 CE, in the typed syntax ("44 BCE"), never d3's "-0043".
  return formatTimeAxisTickSet([tick], timeSpanMs, utc)[0]!
}

/**
 * Labels for a set of ticks in the format the span calls for, tick by tick,
 * as d3 writes them; but a set with any tick before 1 CE is written whole in
 * the typed syntax (see {@link typedAxisLabels}), so one axis never mixes
 * "1 BCE" with d3's "0001" or "20s".
 */
export function formatTimeAxisTickSet(ticks: Date[], timeSpanMs: number, utc = false): string[] {
  const name = getTimeAxisFormat(timeSpanMs)
  if (!beforeCommonEra(ticks, utc)) return ticks.map((tick) => formatAxisLabel(name, tick, utc))
  const labels = typedAxisLabels(name, ticks, utc)
  return new Set(labels).size === labels.length ? labels : typedDateTimes(ticks, utc)
}

function formatAxisLabel(name: string, tick: Date, utc: boolean): string {
  const timeFormat = utc ? d3.utcFormat : d3.timeFormat
  const fullYear = utc ? tick.getUTCFullYear() : tick.getFullYear()
  if (name === 'decade') return `${Math.floor(fullYear / 10) * 10}s`
  return timeFormat(name)(tick)
}

/** Whether any tick falls in a year before 1 CE, read in UTC or in local time. */
function beforeCommonEra(ticks: readonly Date[], utc: boolean): boolean {
  return ticks.some((tick) => (utc ? tick.getUTCFullYear() : tick.getFullYear()) <= 0)
}

/** The precision each axis format names a date at; a time of day names none. */
const FORMAT_PRECISION: Record<string, 'year' | 'month' | 'day' | undefined> = {
  decade: 'year',
  '%Y': 'year',
  '%b %Y': 'month',
  '%b %d': 'day',
  '%a %d': 'day',
}

/** A tick's date in the typed syntax at a precision ("44 BCE", "1-10 BCE", "1-01-01"); in local time, the local date's. */
function typedDate(tick: Date, precision: 'year' | 'month' | 'day', utc: boolean): string {
  if (utc) return formatBoundAt(tick, precision)
  // The local wall-clock date, as a UTC one: the bound syntax is written in UTC.
  const at = new Date(0)
  at.setUTCFullYear(tick.getFullYear(), tick.getMonth(), tick.getDate())
  return formatBoundAt(at, precision)
}

const pad2 = (value: number) => String(value).padStart(2, '0')

type Clock = 'minute' | 'second' | 'millisecond'

/** A tick's hours, minutes, seconds and milliseconds, in UTC or local time. */
function clockOf(tick: Date, utc: boolean): [number, number, number, number] {
  return utc
    ? [tick.getUTCHours(), tick.getUTCMinutes(), tick.getUTCSeconds(), tick.getUTCMilliseconds()]
    : [tick.getHours(), tick.getMinutes(), tick.getSeconds(), tick.getMilliseconds()]
}

/** How finely a set's times must be written for each to be told apart and read back exactly. */
function clockFor(ticks: readonly Date[], utc: boolean): Clock {
  const clocks = ticks.map((tick) => clockOf(tick, utc))
  if (clocks.some(([, , , ms]) => ms !== 0)) return 'millisecond'
  return clocks.some(([, , seconds]) => seconds !== 0) ? 'second' : 'minute'
}

/** A tick's time of day, "14:30", "14:30:05" or "14:30:05.250", which the date reader takes back after a date. */
function typedTime(tick: Date, utc: boolean, clock: Clock): string {
  const [hours, minutes, seconds, ms] = clockOf(tick, utc)
  const text = `${pad2(hours)}:${pad2(minutes)}`
  if (clock === 'minute') return text
  return clock === 'second' ? `${text}:${pad2(seconds)}` : `${text}:${pad2(seconds)}.${String(ms).padStart(3, '0')}`
}

/** Whether a tick is a day's first moment: no hours, minutes, seconds or milliseconds. */
function isDayStart(tick: Date, utc: boolean): boolean {
  return clockOf(tick, utc).every((part) => part === 0)
}

/** Every tick as its date and time, "44-03-14 BCE 12:00": what is left when shorter labels repeat. */
function typedDateTimes(ticks: readonly Date[], utc: boolean): string[] {
  const clock = clockFor(ticks, utc)
  return ticks.map((tick) => `${typedDate(tick, 'day', utc)} ${typedTime(tick, utc, clock)}`)
}

/**
 * A tick set in the syntax a person types and the date reader takes back, at
 * the format's precision: "81 BCE", "20", "1-10 BCE", "1-01-01". d3 writes a
 * year before 1 CE astronomically ("-0043", "-50s"), which no reader takes
 * back. At a time of day, as the calendar package's Gregorian ticks are: a
 * day's first moment by its date, the rest by their time ("44-03-15 BCE",
 * "12:00").
 */
function typedAxisLabels(name: string, ticks: readonly Date[], utc: boolean): string[] {
  const precision = FORMAT_PRECISION[name]
  if (precision) return ticks.map((tick) => typedDate(tick, precision, utc))
  const clock = clockFor(ticks, utc)
  const labels = ticks.map((tick) => (isDayStart(tick, utc) ? typedDate(tick, 'day', utc) : typedTime(tick, utc, clock)))
  // No tick at a day's start: the first names its day too, so the axis says which.
  if (ticks.length > 0 && !ticks.some((tick) => isDayStart(tick, utc))) {
    labels[0] = `${typedDate(ticks[0]!, 'day', utc)} ${labels[0]}`
  }
  return labels
}

/** How wide a character of the timeline's 12px monospace tick labels is. */
export const AXIS_LABEL_CHAR_PX = 7.2
/** The clear space kept between two tick labels. */
const AXIS_LABEL_GAP_PX = 4

/**
 * The ticks of a main-timeline axis whose labels fit. A Gregorian set with a
 * tick before 1 CE (typed labels such as "9000-03-01 BCE", far wider than
 * d3's "Fri 01" for the same step) is thinned to the first, the last and a
 * regular stride between ({@link thinTickLabels}). A set entirely after 1 CE
 * is returned as it is, so a real history's axis is drawn exactly as before;
 * so is a world calendar's, whose labels do not depend on the Gregorian year.
 */
export function fitAxisLabels<T extends { date: Date; x: number; label: string }>(
  ticks: readonly T[],
  calendar: GraphCalendar | null,
  charPx = AXIS_LABEL_CHAR_PX
): readonly T[] {
  if (calendar || !ticks.some((tick) => tick.date.getUTCFullYear() <= 0)) return ticks
  return thinTickLabels(ticks, { charPx, gapPx: AXIS_LABEL_GAP_PX })
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
  // Decided for the whole set: one tick before 1 CE puts every label in the typed syntax.
  const typed = beforeCommonEra(ticks, utc)
  const label = (name: string) => (typed ? typedAxisLabels(name, ticks, utc) : ticks.map((tick) => formatAxisLabel(name, tick, utc)))
  for (const name of TIME_AXIS_FORMAT_LADDER.slice(start)) {
    const labels = label(name)
    if (new Set(labels).size === labels.length) return labels
  }
  return typed ? typedDateTimes(ticks, utc) : label('%H:%M:%S')
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
    // astronomically: the calendar package's, labelled as a person types a year ("300000 BCE").
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
