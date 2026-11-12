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
  type WorldCalendarSet,
  calendarDefinitionIssues,
  calendarSetIssues,
  normalizeCalendarSet,
} from './definition'

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
    return legacy ? legacyCalendarSet(legacy) : null
  }
  if (calendarSetIssues(value).length === 0) return normalizeCalendarSet(value)
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
  return calendarSetIssues(kept).length === 0 ? normalizeCalendarSet(kept) : null
}

/** A calendar given in either form (a set, or the earlier one), as the set to store; throws on an unusable one. */
export function calendarSetFromInput(value: unknown): WorldCalendarSet {
  if (isCalendarSet(value)) return normalizeCalendarSet(value)
  // The earlier form is checked by its own rules, which throw with their messages.
  return legacyCalendarSet(normalizeCalendar(value))
}
