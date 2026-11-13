/**
 * The Gregorian calendar as a world calendar definition, and calendars stored
 * in the earlier form (a relabelled Gregorian calendar) read as calendar sets
 * (docs/specs/world-calendars.md, Req 11, 12).
 */

import { type GraphCalendar, normalizeCalendar, storedCalendar } from '../calendar'
import { daysFromCivil } from '../gregorian'
import { SHORT_MONTHS } from '../years'
import {
  type CalendarDefinition,
  DEFAULT_NOTATION,
  DEFAULT_TIME,
  type WorldCalendarSet,
  calendarDefinitionIssues,
  calendarSetShapeIssues,
  trimCalendarSet,
} from './definition'
import { calendarSetIssues, normalizeCalendarSet } from './check'

const GREGORIAN_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/**
 * The proleptic Gregorian calendar, its year `epochYear` counted as year 1 of
 * the world: the leap rules fall on the stored years a Gregorian calendar
 * leaps in (offset by the epoch), and the epoch is that year's first day on
 * the axis (whose day 0 is 1970-01-01, with days of 86,400 seconds).
 */
export function gregorianDefinition(options: {
  id?: string
  name?: string
  epochYear?: number
  eraLabel?: string
  monthNames?: readonly string[]
}): CalendarDefinition {
  const epochYear = options.epochYear ?? 1
  // A line year Y is the stored year Y + epochYear - 1: it leaps when that does.
  const offset = 1 - epochYear
  const names = options.monthNames ?? SHORT_MONTHS
  return {
    id: options.id ?? 'calendar',
    name: options.name ?? 'Calendar',
    parts: GREGORIAN_DAYS.map((days, index) => ({ name: names[index]!, days })),
    leapRules: [
      { every: 4, offset, part: 1, days: 1 },
      { every: 100, offset, part: 1, days: -1 },
      { every: 400, offset, part: 1, days: 1 },
    ],
    epoch: daysFromCivil(epochYear, 1, 1),
    eras: [{ label: options.eraLabel ?? '', from: 1 }],
  }
}

/** A calendar in the earlier form as a set of one Gregorian-shaped calendar that shows every date as it did. */
export function legacyCalendarSet(calendar: GraphCalendar): WorldCalendarSet {
  return {
    version: 2,
    dayLength: 86_400,
    calendars: [
      gregorianDefinition({
        id: 'calendar',
        name: calendar.name ?? 'Calendar',
        epochYear: calendar.epochYear,
        ...(calendar.eraLabel ? { eraLabel: calendar.eraLabel } : {}),
        ...(calendar.monthNames ? { monthNames: calendar.monthNames } : {}),
      }),
    ],
    primary: 'calendar',
  }
}

/** Whether a stored calendar value is in the current form (a set) rather than the earlier one. */
export function isCalendarSet(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as { version?: unknown }).version === 2
}

/**
 * A graph's stored calendar as a set, keeping what still checks out: a
 * calendar in the earlier form is converted (Req 12); in a set, a calendar
 * that no longer checks out is left out rather than losing the others, and
 * the primary falls back to the first that remains. Null when there is no
 * usable calendar.
 */
export function storedCalendarSet(value: unknown): WorldCalendarSet | null {
  if (!isCalendarSet(value)) {
    const legacy = storedCalendar(value)
    if (!legacy) return null
    // The earlier form allowed era labels and month names a world calendar
    // cannot read back ("1A", "before"): keep the rest of what it says.
    const { eraLabel, monthNames, ...years } = legacy
    const candidates = [legacy, { ...years, ...(monthNames ? { monthNames } : {}) }, { ...years, ...(eraLabel ? { eraLabel } : {}) }, years]
    for (const candidate of candidates) {
      const set = legacyCalendarSet(candidate)
      if (calendarSetShapeIssues(set).length === 0) return set
    }
    return null
  }
  // A stored set is read for display: its shape must check out, but text it
  // would not read back (a rule added after it was stored) does not hide it.
  if (calendarSetShapeIssues(value).length === 0) return trimCalendarSet(value as WorldCalendarSet)
  const record = value as Partial<WorldCalendarSet>
  const dayLength = record.dayLength
  if (typeof dayLength !== 'number' || !Number.isInteger(dayLength) || dayLength < 1) return null
  const calendars = (Array.isArray(record.calendars) ? record.calendars : []).filter(
    (definition, index, all) =>
      calendarDefinitionIssues(definition, 'calendar', dayLength).length === 0 &&
      all.findIndex((other) => (other as CalendarDefinition)?.id === (definition as CalendarDefinition).id) === index
  )
  if (calendars.length === 0) return null
  const primary = calendars.some((definition) => definition.id === record.primary) ? record.primary! : calendars[0]!.id
  const kept = { version: 2 as const, dayLength, calendars: calendars.slice(0, 8), primary }
  return calendarSetShapeIssues(kept).length === 0 ? trimCalendarSet(kept) : null
}

/** A calendar given in either form (a set, or the earlier one), as the set to store; throws on an unusable one. */
export function calendarSetFromInput(value: unknown): WorldCalendarSet {
  if (isCalendarSet(value)) return normalizeCalendarSet(value)
  // The earlier form is checked by its own rules, then by a set's (which
  // refuse an era label a date could not be read back with), each throwing
  // with its messages.
  return normalizeCalendarSet(legacyCalendarSet(normalizeCalendar(value)))
}

/**
 * A set as text that two sets share exactly when they say the same: keys in
 * order, and what is the same as its absence left out (no leap rules, a
 * false flag, a zero offset or first weekday, a default time unit or
 * template).
 */
function canonicalText(set: WorldCalendarSet | null): string {
  return JSON.stringify(set, (key, value: unknown) => {
    if (key === 'leapRules' && Array.isArray(value) && value.length === 0) return undefined
    if ((key === 'intercalary' || key === 'skipsIntercalary') && value === false) return undefined
    if ((key === 'offset' || key === 'epochWeekday') && value === 0) return undefined
    // One unlabelled era from year 1 is what no eras means.
    if (key === 'eras' && Array.isArray(value) && value.length === 1 && value[0]?.label === '' && value[0]?.from === 1) return undefined
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return value
    let entries = Object.entries(value as Record<string, unknown>)
    if (key === 'time') entries = entries.filter(([unit, count]) => DEFAULT_TIME[unit as keyof typeof DEFAULT_TIME] !== count)
    if (key === 'notation') entries = entries.filter(([form, template]) => DEFAULT_NOTATION[form as keyof typeof DEFAULT_NOTATION] !== template)
    if ((key === 'time' || key === 'notation') && entries.length === 0) return undefined
    return Object.fromEntries(entries.sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)))
  })
}

/** Two calendars (in either stored form, or none) that say the same of every position. */
export function sameCalendarSet(a: unknown, b: unknown): boolean {
  // A set is compared as it is (checking it again is the costly part); the earlier form, as the set it stands for.
  const asSet = (value: unknown) => {
    if (!isCalendarSet(value)) return storedCalendarSet(value)
    try {
      return trimCalendarSet(value as WorldCalendarSet)
    } catch {
      return value as WorldCalendarSet
    }
  }
  return canonicalText(asSet(a)) === canonicalText(asSet(b))
}

/**
 * A calendar from outside (an import) as a new graph takes it: what of it a
 * set can hold, provided its dates read back (the rules every new calendar
 * meets). One of the earlier form whose month names cannot be held (a digit)
 * keeps its year count without them. Null when nothing can be kept.
 */
export function adoptableCalendarSet(value: unknown): WorldCalendarSet | null {
  const set = storedCalendarSet(value)
  if (set && calendarSetIssues(set).length === 0) return set
  if (!isCalendarSet(value) && typeof value === 'object' && value !== null && 'monthNames' in value) {
    const { monthNames: _dropped, ...years } = value as Record<string, unknown>
    const plain = storedCalendarSet(years)
    if (plain && calendarSetIssues(plain).length === 0) return plain
  }
  return null
}
