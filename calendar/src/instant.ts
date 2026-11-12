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

import { daysFromCivil, daysInMonth } from './gregorian'

/**
 * The calendar date, then optionally a time and a zone, in the forms of ISO
 * 8601 and RFC 3339 a person or a model writes: a year alone or a year and
 * month (reduced precision), a "T", "t" or space before the time, "Z" or "z",
 * an offset with or without its colon ("+05:45", "+0545", "+05"), and a
 * fraction after a full stop or a comma.
 */
const ISO_INSTANT =
  /^([+-]\d{6}|\d{4,6})(?:-(\d{2})(?:-(\d{2})(?:[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?(?:([Zz])|([+-])(\d{2})(?::?(\d{2}))?)?)?)?)?$/

/** A Date can hold ±8.64e15 ms from 1970. */
const MAX_TIME = 8.64e15

/** How much of an instant the text named: a year, a month, a day, or a time of day. */
export type InstantPrecision = 'year' | 'month' | 'day' | 'time'

export interface ParsedInstant {
  /** The first instant of what the text names. */
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
 *   ("-000043" is 44 BCE, as `toISOString` writes it).
 * A month, day, hour, minute, second or offset that does not exist, and an
 * instant beyond what a Date holds, are null.
 */
export function parseIsoInstant(text: string): ParsedInstant | null {
  const match = ISO_INSTANT.exec(text)
  if (!match) return null
  // The ninth group is "Z": an offset of 0, as no offset is.
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction, , sign, zoneHours, zoneMinutes] = match
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
  const time = daysFromCivil(year, month, day) * 86_400_000 + ((hour * 60 + minute - offset) * 60 + second) * 1000 + millisecond
  if (Math.abs(time) > MAX_TIME) return null
  const precision: InstantPrecision = hourText !== undefined ? 'time' : dayText !== undefined ? 'day' : monthText !== undefined ? 'month' : 'year'
  return { date: new Date(time), dateOnly: precision !== 'time', precision }
}

/**
 * A timestamp as a Date: a Date as it is, a number as milliseconds, and text
 * by {@link parseIsoInstant}. Text it cannot read is an invalid Date, never a
 * guess in the host's zone.
 */
export function toInstant(value: Date | string | number): Date {
  if (value instanceof Date) return value
  if (typeof value === 'number') return new Date(value)
  return parseIsoInstant(value.trim())?.date ?? new Date(NaN)
}

/**
 * A timestamp written by a person or a model, as the one spelling everything
 * downstream reads alike: `toISOString`'s ("1870-02-14T09:30:00.000Z"), which
 * every engine reads as the same instant in every zone. With it, how much the
 * text stated: "1871-03" is the month (stored as its first day), "1066" the
 * year, anything with a day the day. Null when the text is not a timestamp.
 */
export function readTimestamp(text: string): { iso: string; precision: 'day' | 'month' | 'year' } | null {
  const parsed = parseIsoInstant(text.trim())
  if (!parsed) return null
  const precision = parsed.precision === 'year' || parsed.precision === 'month' ? parsed.precision : 'day'
  return { iso: parsed.date.toISOString(), precision }
}
