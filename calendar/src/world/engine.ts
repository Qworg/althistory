/**
 * Converting between positions on a world's timeline and the dates a
 * calendar names them by (docs/specs/world-calendars.md, Req 1-9, 13).
 *
 * A definition is compiled once into tables over one leap cycle: the day
 * each year of the cycle begins on, and the festival days before it. A
 * position then converts to a date, and a date to a position, with a division
 * and a binary search, for any year a Date can hold.
 */

import {
  type CalendarDefinition,
  type CalendarTime,
  DEFAULT_TIME,
  MAX_TIME,
  type WorldCalendarSet,
  cycleYears,
  partLengthsIn,
} from './definition'

export interface CompiledCalendar {
  readonly definition: CalendarDefinition
  readonly dayMs: number
  readonly time: CalendarTime
  /** The calendar's seconds in a day: hoursPerDay × minutesPerHour × secondsPerMinute. */
  readonly secondsPerDay: number
  readonly cycleYears: number
  readonly cycleDays: number
  /** Days from the cycle's start to the start of each of its years, and the cycle's length at the end. */
  readonly yearStarts: Float64Array
  /** Festival days left out of the week before each year of the cycle, and the cycle's total at the end. */
  readonly skippedStarts: Float64Array
}

/** A position named in a calendar. `year` is the line year (Req 6); `part` an index into the parts. */
export interface WorldDateFields {
  year: number
  part: number
  day: number
  hour: number
  minute: number
  second: number
}

export interface WorldDate extends WorldDateFields {
  calendar: string
  /** The weekday's index, or null for a festival day the week leaves out (or a calendar with no week). */
  weekday: number | null
}

const mod = (n: number, d: number) => ((n % d) + d) % d

const compiled = new WeakMap<CalendarDefinition, Map<number, CompiledCalendar>>()

/** A definition's tables, built once per definition and day length. The definition must be valid. */
export function compileCalendar(definition: CalendarDefinition, dayLength: number): CompiledCalendar {
  let byLength = compiled.get(definition)
  if (!byLength) compiled.set(definition, (byLength = new Map()))
  const known = byLength.get(dayLength)
  if (known) return known

  const cycle = cycleYears(definition.leapRules)
  const yearStarts = new Float64Array(cycle + 1)
  const skippedStarts = new Float64Array(cycle + 1)
  const skipsIntercalary = Boolean(definition.week?.skipsIntercalary)
  for (let r = 0; r < cycle; r++) {
    const lengths = partLengthsIn(1 + r, definition.parts, definition.leapRules)
    yearStarts[r + 1] = yearStarts[r]! + lengths.reduce((sum, days) => sum + days, 0)
    const skipped = skipsIntercalary ? lengths.reduce((sum, days, index) => sum + (definition.parts[index]!.intercalary ? days : 0), 0) : 0
    skippedStarts[r + 1] = skippedStarts[r]! + skipped
  }
  const time = { ...DEFAULT_TIME, ...definition.time }
  const result: CompiledCalendar = {
    definition,
    dayMs: dayLength * 1000,
    time,
    secondsPerDay: time.hoursPerDay * time.minutesPerHour * time.secondsPerMinute,
    cycleYears: cycle,
    cycleDays: yearStarts[cycle]!,
    yearStarts,
    skippedStarts,
  }
  byLength.set(dayLength, result)
  return result
}

/** The compiled calendar with this id in a set, or its primary. */
export function calendarIn(set: WorldCalendarSet, id?: string): CompiledCalendar {
  const definition = set.calendars.find((candidate) => candidate.id === (id ?? set.primary)) ?? set.calendars[0]!
  return compileCalendar(definition, set.dayLength)
}

/** Days from the epoch to the first day of a line year. */
export function daysBeforeYear(calendar: CompiledCalendar, year: number): number {
  const k = year - 1
  const cycles = Math.floor(k / calendar.cycleYears)
  return cycles * calendar.cycleDays + calendar.yearStarts[k - cycles * calendar.cycleYears]!
}

/** The line year a day (counted from the epoch) falls in, and the day's index within it. */
function yearOfDay(calendar: CompiledCalendar, day: number): { year: number; dayOfYear: number; cycleIndex: number; cycles: number } {
  const cycles = Math.floor(day / calendar.cycleDays)
  const rest = day - cycles * calendar.cycleDays
  let lo = 0
  let hi = calendar.cycleYears - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (calendar.yearStarts[mid]! <= rest) lo = mid
    else hi = mid - 1
  }
  return { year: 1 + cycles * calendar.cycleYears + lo, dayOfYear: rest - calendar.yearStarts[lo]!, cycleIndex: lo, cycles }
}

/** The parts' lengths in a line year. */
export function partLengths(calendar: CompiledCalendar, year: number): number[] {
  return partLengthsIn(year, calendar.definition.parts, calendar.definition.leapRules)
}

/** The date of a position (Req 13). */
export function dateAt(calendar: CompiledCalendar, position: number): WorldDate {
  const axisDay = Math.floor(position / calendar.dayMs)
  const msInDay = position - axisDay * calendar.dayMs
  const fromEpoch = axisDay - calendar.definition.epoch
  const { year, dayOfYear, cycleIndex, cycles } = yearOfDay(calendar, fromEpoch)
  const lengths = partLengths(calendar, year)
  let part = 0
  let rest = dayOfYear
  while (rest >= lengths[part]!) rest -= lengths[part++]!

  const { minutesPerHour, secondsPerMinute } = calendar.time
  const secondIndex = Math.floor((msInDay * calendar.secondsPerDay) / calendar.dayMs)
  const hour = Math.floor(secondIndex / (minutesPerHour * secondsPerMinute))
  const minute = Math.floor(secondIndex / secondsPerMinute) % minutesPerHour
  const second = secondIndex % secondsPerMinute

  let weekday: number | null = null
  const week = calendar.definition.week
  const partDef = calendar.definition.parts[part]!
  if (week && !(week.skipsIntercalary && partDef.intercalary)) {
    // Festival days before this one in its year, which the week left out.
    const skippedThisYear = week.skipsIntercalary
      ? lengths.slice(0, part).reduce((sum, days, index) => sum + (calendar.definition.parts[index]!.intercalary ? days : 0), 0)
      : 0
    const skipped = cycles * calendar.skippedStarts[calendar.cycleYears]! + calendar.skippedStarts[cycleIndex]! + skippedThisYear
    weekday = mod((week.epochWeekday ?? 0) + fromEpoch - skipped, week.days.length)
  }
  return { calendar: calendar.definition.id, year, part, day: rest + 1, hour, minute, second, weekday }
}

/** Why fields name no position, or null when they do. */
export function fieldsProblem(calendar: CompiledCalendar, fields: WorldDateFields): string | null {
  const { year, part, day, hour, minute, second } = fields
  const parts = calendar.definition.parts
  for (const [name, value] of Object.entries({ year, part, day, hour, minute, second })) {
    if (!Number.isInteger(value)) return `the ${name} must be a whole number`
  }
  if (part < 0 || part >= parts.length) return `the calendar has no month ${part + 1}`
  const length = partLengths(calendar, year)[part]!
  if (day < 1 || day > length) return `${parts[part]!.name} has ${length} day${length === 1 ? '' : 's'} that year, so no day ${day}`
  const { hoursPerDay, minutesPerHour, secondsPerMinute } = calendar.time
  if (hour < 0 || hour >= hoursPerDay) return `a day has hours 0 to ${hoursPerDay - 1}`
  if (minute < 0 || minute >= minutesPerHour) return `an hour has minutes 0 to ${minutesPerHour - 1}`
  if (second < 0 || second >= secondsPerMinute) return `a minute has seconds 0 to ${secondsPerMinute - 1}`
  return null
}

/** The axis day a date falls on. The fields must name a date (see {@link fieldsProblem}). */
export function axisDayOf(calendar: CompiledCalendar, fields: Pick<WorldDateFields, 'year' | 'part' | 'day'>): number {
  const lengths = partLengths(calendar, fields.year)
  let dayOfYear = fields.day - 1
  for (let index = 0; index < fields.part; index++) dayOfYear += lengths[index]!
  return calendar.definition.epoch + daysBeforeYear(calendar, fields.year) + dayOfYear
}

/**
 * The first position of a date's second (Req 13), or null when the fields
 * name no date or one beyond what a Date holds.
 */
export function positionOf(calendar: CompiledCalendar, fields: WorldDateFields): number | null {
  if (fieldsProblem(calendar, fields)) return null
  const { minutesPerHour, secondsPerMinute } = calendar.time
  const secondIndex = (fields.hour * minutesPerHour + fields.minute) * secondsPerMinute + fields.second
  // The first millisecond whose second is this one: dateAt reads it back unchanged.
  const position = axisDayOf(calendar, fields) * calendar.dayMs + Math.ceil((secondIndex * calendar.dayMs) / calendar.secondsPerDay)
  return Math.abs(position) <= MAX_TIME ? position : null
}

/** The line year an era names `count` in (a count back when `before`). */
export function lineYear(definition: CalendarDefinition, era: number | 'before', count: number): number {
  const eras = definition.eras ?? [{ label: '', from: 1 }]
  if (era === 'before') return eras[0]!.from - count
  return eras[era]!.from + count - 1
}

/** The era a line year is in, and its count there: `before` counts back from the first era. */
export function eraOf(definition: CalendarDefinition, year: number): { era: number | 'before'; count: number } {
  const eras = definition.eras ?? [{ label: '', from: 1 }]
  if (year < eras[0]!.from) return { era: 'before', count: eras[0]!.from - year }
  let index = eras.length - 1
  while (eras[index]!.from > year) index--
  return { era: index, count: year - eras[index]!.from + 1 }
}
