/**
 * The timeline's time scale (docs/specs/deep-time.md, Req 12).
 *
 * d3's `scaleTime` and `scaleUtc` cannot draw an axis past what a JavaScript
 * Date holds (about ±275,760 years): their ticks, their `nice` and their
 * `invert` all make Dates. This scale is a facade over them. Inside a Date's
 * range it *is* the d3 scale (same pixels, same ticks, same `nice`), so a real
 * history's axis is exactly what it was. Beyond it, the position is linear over
 * the exact number of milliseconds from the domain's start (`bigint`
 * arithmetic, so a double's rounding never moves an event), `invert` makes an
 * `AxisDate`, and the ticks are the calendar package's.
 *
 * It answers what the app asks of a d3 time scale: calling it with a Date or
 * milliseconds, `domain`, `range`, `invert`, `ticks`, `nice` and `copy`.
 */

import * as d3 from 'd3'
import { type AxisTime, AxisDate, MAX_AXIS_MS, MIN_AXIS_MS, axisOf, clampedInstantOfMs, gregorianTicks, instantOfAxisTime, instantOfMs } from '@althistory/calendar'

export { clampedInstantOfMs, instantOfMs }

/** What a position on the axis needs of a scale: a Date to a pixel, and back (a d3 time scale is one, and so is an {@link InstantScale}). */
export interface PositionScale {
  (value: Date): number
  invert(pixel: number): Date
}

export interface InstantScale extends PositionScale {
  (value: Date | number): number
  domain(): [Date, Date]
  domain(domain: Iterable<Date | number>): InstantScale
  range(): [number, number]
  range(range: Iterable<number>): InstantScale
  /** The moment a pixel stands for: a Date, or an `AxisDate` beyond a Date's range. */
  invert(pixel: number): Date
  /** Round tick moments for about `count` ticks (or a d3 interval, inside a Date's range). */
  ticks(count?: number | d3.TimeInterval): Date[]
  /** Round the domain out to whole time units; unchanged beyond a Date's range, where the ticks are round already. */
  nice(): InstantScale
  copy(): InstantScale
}

/** Whether a moment is beyond what a Date holds. */
export function isDeepInstant(value: Date): boolean {
  return value instanceof AxisDate
}

/** The earliest and latest moments a Date holds, in milliseconds. */
const DATE_MIN_MS = -8_640_000_000_000_000
const DATE_MAX_MS = 8_640_000_000_000_000
/**
 * The first millisecond of year -9999: before it a year needs the signed six-digit form, and d3 labels it
 * astronomically ("-200000s" for 200,001 BCE). A history inside 0000-9999 is ticked by d3 as it always was.
 */
const SIX_DIGIT_YEARS_MS = -377_705_116_800_000

/**
 * Whether a Gregorian domain is better ticked by the calendar package than by
 * d3 (docs/specs/deep-time.md, Req 12). Beyond a Date's range d3 cannot tick at
 * all; but it fails before that too: `utcYear.every(k)` floors the domain's
 * start to a multiple of k, and near the lower bound that floor is an Invalid
 * Date, so the axis has no ticks; and before year -9999 its labels are astronomical
 * ("-200000s"). So: any domain that starts before year -9999, or comes within a
 * span of a Date's bounds, takes the calendar package's ticks ("200000 BCE").
 */
export function usesArithmeticTicks(first: Date, last: Date): boolean {
  if (isDeepInstant(first) || isDeepInstant(last)) return true
  const start = +first
  const end = +last
  if (Number.isNaN(start) || Number.isNaN(end)) return false
  if (Math.min(start, end) < SIX_DIGIT_YEARS_MS) return true
  const span = Math.abs(end - start)
  return Math.max(start, end) + span > DATE_MAX_MS || Math.min(start, end) - span < DATE_MIN_MS
}

function toDate(value: Date | number): Date {
  return value instanceof Date ? value : instantOfMs(value)
}

function axisOfValue(value: Date | number): AxisTime | null {
  return value instanceof Date ? axisOf(value) : Number.isFinite(value) ? BigInt(Math.trunc(value)) : null
}

/**
 * A time scale, over UTC when `utc` (the axis is read in UTC, like every
 * historical date) or the viewer's local time otherwise (what `scaleTime` did).
 */
export function instantScale(utc = false): InstantScale {
  let d0 = new Date(0)
  let d1 = new Date(1)
  let r0 = 0
  let r1 = 1
  let inner: d3.ScaleTime<number, number> | null = null

  const make = (): d3.ScaleTime<number, number> => (utc ? d3.scaleUtc() : d3.scaleTime()).domain([d0, d1]).range([r0, r1])
  const deep = () => isDeepInstant(d0) || isDeepInstant(d1)
  const d3Scale = () => (inner ??= make())

  const scale = ((value: Date | number): number => {
    if (!deep()) return d3Scale()(value instanceof Date ? value : new Date(value))
    const at = axisOfValue(value)
    const a0 = axisOf(d0)
    const a1 = axisOf(d1)
    if (at === null || a0 === null || a1 === null) return NaN
    const span = a1 - a0
    // The distance from the start, in exact milliseconds; the only double is the ratio.
    const fraction = span === 0n ? 0 : Number(at - a0) / Number(span)
    return r0 * (1 - fraction) + r1 * fraction
  }) as InstantScale

  scale.domain = ((domain?: Iterable<Date | number>) => {
    if (domain === undefined) return [d0, d1]
    const [a, b] = Array.from(domain)
    d0 = toDate(a ?? 0)
    d1 = toDate(b ?? 1)
    inner = null
    return scale
  }) as InstantScale['domain']

  scale.range = ((range?: Iterable<number>) => {
    if (range === undefined) return [r0, r1]
    const [a, b] = Array.from(range)
    r0 = a ?? 0
    r1 = b ?? 1
    inner = null
    return scale
  }) as InstantScale['range']

  scale.invert = (pixel: number): Date => {
    if (!deep()) {
      const inside = d3Scale().invert(pixel)
      // d3 makes an Invalid Date for a pixel past a Date's range (a view zoomed out beyond the domain);
      // the exact arithmetic below turns that into an AxisDate.
      if (!Number.isNaN(inside.getTime())) return inside
    }
    const a0 = axisOf(d0) ?? 0n
    const a1 = axisOf(d1) ?? 0n
    const fraction = r1 === r0 ? 0 : (pixel - r0) / (r1 - r0)
    // The ratio is a double; applied to the exact span it is right to a part in 10^15 of the domain.
    const offset = BigInt(Math.round(fraction * Number(a1 - a0)))
    // A view zoomed out past the axis's bound stops at the bound: an Invalid Date would turn every position NaN.
    const at = a0 + offset
    return instantOfAxisTime(at < MIN_AXIS_MS ? MIN_AXIS_MS : at > MAX_AXIS_MS ? MAX_AXIS_MS : at) ?? new Date(NaN)
  }

  scale.ticks = (count?: number | d3.TimeInterval): Date[] => {
    if (!usesArithmeticTicks(d0, d1)) {
      const dates = count === undefined ? d3Scale().ticks() : typeof count === 'number' ? d3Scale().ticks(count) : d3Scale().ticks(count)
      // d3 can make none where its interval floors out of a Date's range; the calendar package's below.
      // (A given interval may legitimately have no tick inside the domain.)
      if (dates.length > 0 || typeof count === 'function') return dates
    }
    const a0 = axisOf(d0)
    const a1 = axisOf(d1)
    if (a0 === null || a1 === null) return []
    return gregorianTicks([a0, a1], typeof count === 'number' ? Math.max(2, count) : 8).map((tick) => instantOfAxisTime(tick.position) as Date)
  }

  scale.nice = () => {
    if (deep()) return scale
    const [a, b] = d3Scale().nice().domain()
    d0 = a!
    d1 = b!
    inner = null
    return scale
  }

  scale.copy = () => {
    const copy = instantScale(utc)
    copy.domain([d0, d1]).range([r0, r1])
    return copy
  }

  return scale
}

/**
 * The scale a zoom transform makes of `base`: its pixels stand for what the
 * transform's inverse maps them to (d3's `transform.rescaleX`, which a facade
 * is not typed for).
 */
export function rescaleInstantX(transform: { invertX(x: number): number }, base: InstantScale): InstantScale {
  const [start, end] = base.range()
  return base
    .copy()
    .domain([base.invert(transform.invertX(start)), base.invert(transform.invertX(end))])
}
