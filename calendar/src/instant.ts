/**
 * Reading an ISO 8601 timestamp as the instant it names, the same in every
 * time zone and every JavaScript engine.
 *
 * `new Date(text)` does not: a date-time without a zone ("2020-11-20T00:00")
 * is read in the host's zone, text that is not ISO ("Nov 20 2020") is read
 * leniently and locally, and V8 rolls a day that does not exist
 * ("2019-02-31") into the next month where other engines refuse it. Here the
 * fields are checked and the instant built by arithmetic, in UTC.
 */

import { daysInMonth } from './gregorian'
import { type AxisTime, axisOf, axisTimeOfCivil, inAxisRange, instantOfAxisTime, isoOfAxisTime } from './time'

/**
 * The calendar date, then optionally a time and a zone, in the forms of ISO
 * 8601 and RFC 3339 a person or a model writes, and the near spellings other
 * programs write: a year alone or a year and month (reduced precision), a
 * month or day of one digit ("2023-1-5"), a "T", "t" or space before the
 * time, "Z", "z", "UTC" or "GMT", an offset with or without its colon
 * ("+05:45", "+0545", "+05"), set off by a space or followed by "UTC" (Go's
 * "+0000 UTC"), and a fraction after a full stop or a comma. Every one is
 * read the same way on every machine: no zone is UTC.
 */
const ISO_INSTANT =
  /^([+-]\d{6,9}|\d{4,6})(?:-(\d{1,2})(?:-(\d{1,2})(?:[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?)?(?: ?(?:([Zz])|(UTC|GMT)|([+-])(\d{2})(?::?(\d{2}))?(?: (?:UTC|GMT))?))?)?)?$/

/** How much of an instant the text named: a year, a month, a day, or a time of day. */
export type InstantPrecision = 'year' | 'month' | 'day' | 'time'

export interface ParsedInstant {
  /** The first instant of what the text names, on the axis (time.ts). */
  time: AxisTime
  /** The same as a Date: a plain one within a Date's range, an `AxisDate` beyond it. */
  date: Date
  /** True when the text has no time of day (a year, a month or a day). */
  dateOnly: boolean
  precision: InstantPrecision
}

/**
 * The instant an ISO 8601 timestamp names, or null when it names none:
 * - a year ("1066"), a month ("1871-03") or a day ("1843-11-20") is its first
 *   moment, UTC;
 * - a date-time without a zone ("1843-11-20T14:30") is that UTC wall-clock
 *   time, as every historical date is read;
 * - one with a zone ("…Z", "…+05:45") is that instant;
 * - a year may be written with four to six digits, or expanded with a sign
 *   and six to nine digits ("-000043" is 44 BCE, as `toISOString` writes it;
 *   "+300000" is the year 300,000, which no Date holds).
 * A month, day, hour, minute, second or offset that does not exist, and an
 * instant beyond the axis's bound (`MAX_AXIS_MS`), are null.
 */
export function parseIsoInstant(text: string): ParsedInstant | null {
  const scanned = scanIsoInstant(text)
  return scanned === 'beyond' ? null : scanned
}

/** Whether text is a well-formed ISO 8601 timestamp that names an instant past the axis's bound (and so is refused for that). */
export function isoBeyondRange(text: string): boolean {
  return scanIsoInstant(text) === 'beyond'
}

function scanIsoInstant(text: string): ParsedInstant | 'beyond' | null {
  const match = ISO_INSTANT.exec(text)
  if (!match) return null
  // Groups 8 and 9 are "Z" and "UTC"/"GMT": an offset of 0, as no offset is.
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction, , , sign, zoneHours, zoneMinutes] = match
  if (yearText === '-000000') return null // ISO 8601 has no negative zero year
  const year = Number(yearText)
  const month = Number(monthText ?? 1)
  const day = Number(dayText ?? 1)
  const hour = Number(hourText ?? 0)
  const minute = Number(minuteText ?? 0)
  const second = Number(secondText ?? 0)
  if (month < 1 || month > 12) return null
  if (day < 1 || day > daysInMonth(year, month)) return null
  if (hour > 23 || minute > 59 || second > 59) return null
  if (Number(zoneHours ?? 0) > 23 || Number(zoneMinutes ?? 0) > 59) return null
  // Milliseconds are the first three digits, as V8 reads them: ".5" is 500.
  const millisecond = fraction ? Number(fraction.slice(0, 3).padEnd(3, '0')) : 0
  const offset = sign ? (sign === '-' ? -1 : 1) * (Number(zoneHours) * 60 + Number(zoneMinutes ?? 0)) : 0

  // By arithmetic: a Date built field by field goes invalid at the edge of
  // its range before the offset can bring the instant back inside it.
  const time = axisTimeOfCivil(year, month, day, ((hour * 60 + minute - offset) * 60 + second) * 1000 + millisecond)
  const instant = instantOfAxisTime(time)
  if (!instant) return 'beyond'
  const precision: InstantPrecision = hourText !== undefined ? 'time' : dayText !== undefined ? 'day' : monthText !== undefined ? 'month' : 'year'
  return { time, date: instant, dateOnly: precision !== 'time', precision }
}

/**
 * A timestamp as a Date, read the one way every part of the app reads one:
 * a Date as it is; a number as milliseconds; text in ISO 8601 by
 * {@link parseIsoInstant}, exactly (UTC when it names no zone); and anything
 * else invalid. Text that is not ISO 8601 is read as JavaScript always read
 * it (`new Date(text)`, in the host's zone), unless it starts like an ISO
 * date ("2019-2-31", which V8 would roll into March): the app writes only ISO, but data
 * stored before, and API clients, may hold "January 1, 2023", and refusing it
 * here would make it unreadable rather than right. Where text first enters
 * from a person or a model, read it with {@link readTimestamp}, which refuses
 * anything but ISO 8601.
 */
export function toInstant(value: unknown): Date {
  if (value instanceof Date) return value
  if (typeof value === 'number') return new Date(value)
  if (typeof value === 'bigint') return instantOfAxisTime(value) ?? new Date(NaN)
  if (typeof value !== 'string') return new Date(NaN)
  const text = value.trim()
  const parsed = parseIsoInstant(text)
  if (parsed) return parsed.date
  // Text that starts like an ISO date is that or nothing: V8 would roll a
  // day that does not exist into the next month ("2019-2-31") and read a
  // spelling it half knows in the host's zone ("1871-3"). Only text of
  // another shape ("January 1, 2023") is read as JavaScript always read it.
  if (STARTS_LIKE_ISO.test(text)) return new Date(NaN)
  return new Date(text)
}

/** Text that starts as an ISO date does: a year of four or more digits (or signed six), a hyphen and a digit. */
const STARTS_LIKE_ISO = /^[+-]?\d{4,6}-\d/

/**
 * A stored or sent timestamp as the axis time it names (time.ts), read the
 * one way everything reads one: exactly as {@link toInstant} reads it for
 * every value a Date holds (`toAxisTime(x) === BigInt(toInstant(x).getTime())`),
 * and beyond a Date's range for ISO 8601 text with an expanded year, a bigint,
 * and an `AxisDate`. Null when it names no instant or one past the bound.
 */
export function toAxisTime(value: unknown): AxisTime | null {
  if (typeof value === 'bigint') return inAxisRange(value) ? value : null
  if (value instanceof Date) return axisOf(value)
  return axisOf(toInstant(value))
}

/**
 * A timestamp written by a person or a model, as the one spelling everything
 * downstream reads alike: `toISOString`'s ("1870-02-14T09:30:00.000Z"), which
 * every engine reads as the same instant in every zone; beyond a Date's
 * range, the same with an expanded year ("+300000-01-01T00:00:00.000Z"). With
 * it, how much the text stated: "1871-03" is the month (stored as its first
 * day), "1066" the year, anything with a day the day. Null when the text is
 * not a timestamp.
 */
export function readTimestamp(text: string): { iso: string; time: AxisTime; precision: 'day' | 'month' | 'year' } | null {
  const parsed = parseIsoInstant(text.trim())
  if (!parsed) return null
  const precision = parsed.precision === 'year' || parsed.precision === 'month' ? parsed.precision : 'day'
  return { iso: isoOfAxisTime(parsed.time), time: parsed.time, precision }
}
