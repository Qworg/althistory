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
import { type AxisTime, AxisDate, axisOf, gregorianTicks, instantOfAxisTime, instantOfMs } from '@althistory/calendar'

export { instantOfMs }

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
    if (!deep()) return d3Scale().invert(pixel)
    const a0 = axisOf(d0) ?? 0n
    const a1 = axisOf(d1) ?? 0n
    const fraction = r1 === r0 ? 0 : (pixel - r0) / (r1 - r0)
    // The ratio is a double; applied to the exact span it is right to a part in 10^15 of the domain.
    const offset = BigInt(Math.round(fraction * Number(a1 - a0)))
    return instantOfAxisTime(a0 + offset) ?? new Date(NaN)
  }

  scale.ticks = (count?: number | d3.TimeInterval): Date[] => {
    if (!deep()) return count === undefined ? d3Scale().ticks() : typeof count === 'number' ? d3Scale().ticks(count) : d3Scale().ticks(count)
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
