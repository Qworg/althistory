/**
 * Reading an ISO 8601 timestamp as the instant it names, the same in every
 * time zone and every JavaScript engine.
 *
 * `new Date(text)` does not: a date-time without a zone ("2020-11-20T00:00")
 * is read in the host's zone, text that is not ISO ("Nov 20 2020") is read
 * leniently and locally, and V8 rolls a day that does not exist
 * ("2019-02-31") into the next month where other engines refuse it. Here the
 * fields are checked by arithmetic and the instant is built in UTC.
 */

import { daysFromCivil, daysInMonth } from './gregorian'

const ISO_INSTANT =
  /^([+-]\d{6}|\d{4,6})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|([+-])(\d{2}):(\d{2}))?)?$/

/** A Date can hold ±8.64e15 ms from 1970. */
const MAX_TIME = 8.64e15

/**
 * The instant an ISO 8601 timestamp names, or null when it names none:
 * - a date alone ("1843-11-20") is its UTC midnight;
 * - a date-time without a zone ("1843-11-20T14:30") is that UTC wall-clock
 *   time, as every historical date is read;
 * - one with a zone ("…Z", "…+05:45") is that instant;
 * - a year may be written with four to six digits, or expanded with a sign
 *   ("-000043" is 44 BCE, as `toISOString` writes it).
 * A month, day, hour, minute, second or offset that does not exist, and an
 * instant beyond what a Date holds, are null.
 */
export function parseIsoInstant(text: string): { date: Date; dateOnly: boolean } | null {
  const match = ISO_INSTANT.exec(text)
  if (!match) return null
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction, zone, sign, zoneHours, zoneMinutes] = match
  if (yearText === '-000000') return null // ISO 8601 has no negative zero year
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText ?? 0)
  const minute = Number(minuteText ?? 0)
  const second = Number(secondText ?? 0)
  if (day < 1 || day > daysInMonth(year, month)) return null
  if (hour > 23 || minute > 59 || second > 59) return null
  if (Number(zoneHours ?? 0) > 23 || Number(zoneMinutes ?? 0) > 59) return null
  const millisecond = fraction ? Number(fraction.slice(0, 3).padEnd(3, '0')) : 0
  const offset = zone && zone !== 'Z' ? (sign === '-' ? -1 : 1) * (Number(zoneHours) * 60 + Number(zoneMinutes)) : 0

  // By arithmetic: a Date built field by field goes invalid at the edge of
  // its range before the offset can bring the instant back inside it.
  const time = daysFromCivil(year, month, day) * 86_400_000 + ((hour * 60 + minute - offset) * 60 + second) * 1000 + millisecond
  if (Math.abs(time) > MAX_TIME) return null
  return { date: new Date(time), dateOnly: hourText === undefined }
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
