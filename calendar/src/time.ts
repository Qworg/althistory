/**
 * The one value a moment in history is: milliseconds on the axis, as a
 * bigint (docs/specs/deep-time.md, Req 1-6).
 *
 * The axis is the one the system always used: zero is 1970-01-01T00:00:00Z,
 * and a world's axis day n starts at n × dayLength × 1000 ms. Every instant a
 * JavaScript Date can hold (±8.64e15 ms, about ±275,760 years) is
 * `BigInt(date.getTime())`, so no stored value changes; this value reaches
 * further, ±9e18 ms (about ±285 million years), which still fits a signed
 * 64-bit integer and a Neo4j `datetime`.
 *
 * A Date cannot hold what lies beyond its range, so there the value travels
 * as an {@link AxisDate}: a Date that carries the exact axis time and answers
 * the Date methods the app uses (`getTime`, `toISOString`, the UTC fields) for
 * it. Anything that must be exact beyond ±2^53 ms (a double's whole-number
 * range, about ±285,000 years) reads `.axis`, with {@link axisOf}.
 */

import { civilFromDays, daysFromCivilLoose, daysInMonth } from './gregorian'

export type AxisTime = bigint

/** A Date holds ±8.64e15 ms from 1970. */
export const DATE_MAX_MS = 8.64e15

/**
 * The bound on the axis. About ±285 million Earth years, a thousand times
 * the 300,000 years a deep-time history is asked to span; it fits an int64
 * and keeps a world's axis days below 2^53 even with a one-second day, so
 * the engine can count days, years and parts in numbers after one bigint
 * split. Going past it needs a {day, msOfDay} pair, and this is the one
 * constant that says so.
 */
export const MAX_AXIS_MS: AxisTime = 9n * 10n ** 18n
export const MIN_AXIS_MS: AxisTime = -MAX_AXIS_MS

const DAY_MS = 86_400_000n

/** Whether an axis time is within the bound. */
export function inAxisRange(time: AxisTime): boolean {
  return time >= MIN_AXIS_MS && time <= MAX_AXIS_MS
}

/** Whether an axis time is one a Date holds. */
export function inDateRange(time: AxisTime): boolean {
  return time >= -8_640_000_000_000_000n && time <= 8_640_000_000_000_000n
}

/** -1, 0 or 1: how `a` orders against `b`. */
export function compareAxisTime(a: AxisTime, b: AxisTime): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0
}

/** `time` plus `ms` milliseconds (a whole number; fractions are cut), or null past the bound. */
export function addMs(time: AxisTime, ms: number | bigint): AxisTime | null {
  const sum = time + (typeof ms === 'bigint' ? ms : BigInt(Math.trunc(ms)))
  return inAxisRange(sum) ? sum : null
}

/** Milliseconds from `a` to `b`, as a number (exact while the difference is within ±2^53). */
export function msBetween(a: AxisTime, b: AxisTime): number {
  return Number(b - a)
}

/** A time as a number for a scale: its distance from `origin`, which keeps the digits where they matter. */
export function axisToNumber(time: AxisTime, origin: AxisTime = 0n): number {
  return Number(time - origin)
}

/** Floor division and modulo of bigints, as dates need them (toward negative infinity). */
export function floorDivMod(n: bigint, d: bigint): { quotient: bigint; remainder: bigint } {
  let quotient = n / d
  let remainder = n % d
  if (remainder < 0n) {
    quotient -= 1n
    remainder += d
  }
  return { quotient, remainder }
}

/** An axis time split into its UTC day (from 1970-01-01) and the milliseconds into that day. */
export function splitDay(time: AxisTime): { day: number; msOfDay: number } {
  const { quotient, remainder } = floorDivMod(time, DAY_MS)
  return { day: Number(quotient), msOfDay: Number(remainder) }
}

/** The axis time of a UTC day and the milliseconds into it. */
export function joinDay(day: number, msOfDay = 0): AxisTime {
  return BigInt(day) * DAY_MS + BigInt(msOfDay)
}

/**
 * The axis time of a proleptic Gregorian date, by arithmetic. The month may be
 * outside 1..12 and the day or the milliseconds beyond their month or day, as
 * `Date.UTC` allows: they carry. The year is astronomical (1 BCE is 0).
 */
export function axisTimeOfCivil(year: number, month: number, day: number, msOfDay = 0): AxisTime {
  return joinDay(daysFromCivilLoose(year, month, day), msOfDay)
}

/** The Gregorian fields of an axis time, UTC. */
export function civilOfAxisTime(time: AxisTime): {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  millisecond: number
  weekday: number
} {
  const { day: days, msOfDay } = splitDay(time)
  const { year, month, day } = civilFromDays(days)
  const hour = Math.floor(msOfDay / 3_600_000)
  const minute = Math.floor(msOfDay / 60_000) % 60
  const second = Math.floor(msOfDay / 1000) % 60
  // 1970-01-01 was a Thursday.
  const weekday = (((days + 4) % 7) + 7) % 7
  return { year, month, day, hour, minute, second, millisecond: msOfDay % 1000, weekday }
}

const pad = (value: number, width: number) => String(value).padStart(width, '0')

/**
 * The ISO 8601 text of an axis time. Within a Date's range it is exactly
 * `toISOString`'s, so real history reads as it always did; beyond 0000-9999 the
 * year is written expanded and signed with at least six digits ("+275761",
 * "-271822", "+300000", "+120000000"), by arithmetic.
 */
export function isoOfAxisTime(time: AxisTime): string {
  const { year, month, day, hour, minute, second, millisecond } = civilOfAxisTime(time)
  const yearText = year >= 0 && year <= 9999 ? pad(year, 4) : `${year < 0 ? '-' : '+'}${pad(Math.abs(year), 6)}`
  return `${yearText}-${pad(month, 2)}-${pad(day, 2)}T${pad(hour, 2)}:${pad(minute, 2)}:${pad(second, 2)}.${pad(millisecond, 3)}Z`
}

const ISO_FULL = /^([+-]\d{6,9}|\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/

/**
 * The axis time of text {@link isoOfAxisTime} (or `toISOString`) wrote, any
 * year. Null for anything else, or a time past the bound. Looser spellings
 * ("1871-03", a zone offset) are read by `parseIsoInstant`.
 */
export function axisTimeOfIso(text: string): AxisTime | null {
  const match = ISO_FULL.exec(text)
  if (!match) return null
  const [year, month, day, hour, minute, second, millisecond] = match.slice(1).map(Number) as [number, number, number, number, number, number, number]
  if (match[1] === '-000000') return null
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month) || hour > 23 || minute > 59 || second > 59) return null
  const time = axisTimeOfCivil(year, month, day, ((hour * 60 + minute) * 60 + second) * 1000 + millisecond)
  return inAxisRange(time) ? time : null
}

/**
 * A Date for an instant beyond what a Date holds. Its own time value is
 * invalid (a Date cannot be otherwise), so every method that has not been
 * given an answer here would say NaN; `getTime`, `valueOf`, `toISOString`,
 * `toJSON` and the UTC fields are answered from the exact axis time. `getTime`
 * and `valueOf` are the nearest double: right to about a second at the
 * bound, so anything that orders or compares exactly reads {@link axisOf}.
 */
export class AxisDate extends Date {
  readonly axis: AxisTime

  constructor(axis: AxisTime) {
    super(NaN)
    this.axis = axis
  }

  override getTime(): number {
    return Number(this.axis)
  }

  override valueOf(): number {
    return Number(this.axis)
  }

  override toISOString(): string {
    return isoOfAxisTime(this.axis)
  }

  override toJSON(): string {
    return isoOfAxisTime(this.axis)
  }

  override getUTCFullYear(): number {
    return civilOfAxisTime(this.axis).year
  }
  override getUTCMonth(): number {
    return civilOfAxisTime(this.axis).month - 1
  }
  override getUTCDate(): number {
    return civilOfAxisTime(this.axis).day
  }
  override getUTCDay(): number {
    return civilOfAxisTime(this.axis).weekday
  }
  override getUTCHours(): number {
    return civilOfAxisTime(this.axis).hour
  }
  override getUTCMinutes(): number {
    return civilOfAxisTime(this.axis).minute
  }
  override getUTCSeconds(): number {
    return civilOfAxisTime(this.axis).second
  }
  override getUTCMilliseconds(): number {
    return civilOfAxisTime(this.axis).millisecond
  }

  override toString(): string {
    return isoOfAxisTime(this.axis)
  }
}

/**
 * The instant an axis time names, as a Date: a plain one within a Date's
 * range, an {@link AxisDate} beyond it. Null when it is past the bound.
 */
export function instantOfAxisTime(time: AxisTime): Date | null {
  if (!inAxisRange(time)) return null
  return inDateRange(time) ? new Date(Number(time)) : new AxisDate(time)
}

/** The plain Date of an axis time, or null beyond a Date's range. */
export function dateOfAxisTime(time: AxisTime): Date | null {
  return inDateRange(time) ? new Date(Number(time)) : null
}

/** The axis time of a Date (exact for an {@link AxisDate}), or null for an invalid Date. */
export function axisOf(date: Date): AxisTime | null {
  if (date instanceof AxisDate) return date.axis
  const ms = date.getTime()
  return Number.isNaN(ms) ? null : BigInt(ms)
}

/**
 * The axis time of a Date, a number of milliseconds, a bigint or ISO text of
 * any year; null when it names none or is past the bound. Text that is not
 * ISO is `toAxisTime`'s (instant.ts) business, which reads stored text.
 */
export function axisTimeOf(value: Date | number | bigint | string): AxisTime | null {
  if (typeof value === 'bigint') return inAxisRange(value) ? value : null
  if (typeof value === 'number') return Number.isFinite(value) ? axisTimeOf(BigInt(Math.trunc(value))) : null
  if (typeof value === 'string') return axisTimeOfIso(value)
  return axisOf(value)
}

// ── Dates as the app holds them ──────────────────────────────────────────
//
// An event's or an arc's moment is held as a Date (a plain one, or an
// AxisDate beyond a Date's range). These compare and step such values
// exactly, where `a.getTime() - b.getTime()` would round beyond ±2^53 ms.

/** -1, 0 or 1: how the instant `a` orders against `b`, exactly. An invalid Date orders before every valid one, and equal to another. */
export function compareInstants(a: Date, b: Date): -1 | 0 | 1 {
  const x = axisOf(a)
  const y = axisOf(b)
  if (x === null || y === null) return x === y ? 0 : x === null ? -1 : 1
  return compareAxisTime(x, y)
}

/** The instant `ms` milliseconds from `date` (fractions cut), or an invalid Date past the bound. */
export function addInstantMs(date: Date, ms: number): Date {
  const time = axisOf(date)
  const sum = time === null ? null : addMs(time, ms)
  return sum === null ? new Date(NaN) : (instantOfAxisTime(sum) as Date)
}

/** Milliseconds from `a` to `b` as a number: exact while the gap is within ±2^53, the nearest double beyond; NaN if either is invalid. */
export function msApart(a: Date, b: Date): number {
  const x = axisOf(a)
  const y = axisOf(b)
  return x === null || y === null ? NaN : msBetween(x, y)
}
