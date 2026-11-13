/**
 * The proleptic Gregorian calendar by arithmetic, for checking that a typed
 * date exists before a Date is made from it. A Date does not say: V8 reads
 * "2019-02-31" as March 3 and "T24:00" as the next day, where other engines
 * read them as invalid, so the check cannot be left to it.
 */

/** A leap year, on the astronomical numbering (1 BCE is 0, and a leap year). */
export function isLeapYear(year: number): boolean {
  const mod = (n: number, d: number) => ((n % d) + d) % d
  return (mod(year, 4) === 0 && mod(year, 100) !== 0) || mod(year, 400) === 0
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/** The days in a month (1 = January) of an astronomical year; 0 for a month that is not 1..12. */
export function daysInMonth(year: number, month: number): number {
  if (!Number.isInteger(month) || month < 1 || month > 12) return 0
  return month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1]!
}

/**
 * Days from 1970-01-01 to a date (astronomical year, month 1 = January), by
 * Howard Hinnant's days_from_civil: exact for every year, with no Date and so
 * no limit on its range.
 */
export function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year
  const era = Math.floor(y / 400)
  const yearOfEra = y - era * 400
  const dayOfYear = Math.floor((153 * ((month + 9) % 12) + 2) / 5) + day - 1
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear
  return era * 146097 + dayOfEra - 719468
}

/**
 * The inverse of {@link daysFromCivil}: the astronomical year, the month
 * (1 = January) and the day of the month of a day counted from 1970-01-01.
 * Howard Hinnant's civil_from_days, with no Date and so no limit on its
 * range; exact for every day a safe integer holds.
 */
export function civilFromDays(days: number): { year: number; month: number; day: number } {
  const z = days + 719468
  const era = Math.floor(z / 146097)
  const dayOfEra = z - era * 146097
  const yearOfEra = Math.floor((dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365)
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100))
  const shifted = Math.floor((5 * dayOfYear + 2) / 153)
  const day = dayOfYear - Math.floor((153 * shifted + 2) / 5) + 1
  const month = shifted < 10 ? shifted + 3 : shifted - 9
  const year = yearOfEra + era * 400 + (month <= 2 ? 1 : 0)
  return { year, month, day }
}

/** Days from 1970-01-01 to a date whose month may be outside 1..12 (a month 13 is the next year's January). */
export function daysFromCivilLoose(year: number, month: number, day: number): number {
  const zeroBased = month - 1
  const carry = Math.floor(zeroBased / 12)
  return daysFromCivil(year + carry, zeroBased - carry * 12 + 1, 1) + (day - 1)
}
