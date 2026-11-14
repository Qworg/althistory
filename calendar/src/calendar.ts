/**
 * The earlier form of a graph's calendar, and the one set of rules that says
 * whether one is usable. A world's calendars are now sets of any shape
 * (world/); this form is still read (as the set it stands for, world/legacy.ts)
 * and still taken from the simple flags of the CLI and the tools.
 *
 * It is the Gregorian calendar with the world's own year count: with
 * `epochYear: 1000` and `eraLabel: "AR"`, the stored year 1000 is "1 AR" and
 * 1311 is "312 AR". It can also rename the twelve months (`monthNames`), so
 * March 4 reads "Thaw 4"; the months keep their lengths and order.
 *
 * The rules are written once, as {@link calendarIssues}. The API's messages
 * ({@link calendarProblems}) and the app form's (`calendarDraftErrors` in
 * draft.ts) are two phrasings of the same issues, so the form cannot accept
 * what the API refuses, or the other way round.
 */

import { FORBIDDEN_IN_LABEL, FORBIDDEN_IN_MONTH_NAME, bidiClosed, hasVisible, sameNameKey } from './text'
import { MAX_AXIS_MS, MIN_AXIS_MS, civilOfAxisTime } from './time'

export interface GraphCalendar {
  /** The stored (Gregorian) year that is year 1 of this world: an integer within what the axis holds ({@link MIN_EPOCH_YEAR}..{@link MAX_EPOCH_YEAR}), 0 and negative years being 1 BCE and before. */
  epochYear: number
  /** Written after the year: "AR" shows the year as "312 AR". Absent or empty shows "Year 312". */
  eraLabel?: string
  /** What the calendar is called, e.g. "the Reckoning of the Rising". Display only. */
  name?: string
  /**
   * The world's names for the twelve months, January's first. Absent shows the
   * stored months' names ("Mar"). Exactly twelve, distinct, none empty, and
   * none holding a character `FORBIDDEN_IN_MONTH_NAME` lists (a comma, a `|`,
   * brackets, a double quote, a control character).
   */
  monthNames?: string[]
}

/**
 * The years a world's year 1 can be: any whose 1 January the axis holds
 * (time.ts, about ±285 million years), computed from the bound, not written
 * down. A year outside 0000-9999 is written as an expanded ISO year.
 */
export const MAX_EPOCH_YEAR = civilOfAxisTime(MAX_AXIS_MS).year - 1
// The axis is symmetric about 1970, not about year 0, so its lower year is not the negative of its upper one.
export const MIN_EPOCH_YEAR = civilOfAxisTime(MIN_AXIS_MS).year + 1
export const MAX_ERA_LABEL_LENGTH = 16
export const MAX_CALENDAR_NAME_LENGTH = 80
export const MONTH_COUNT = 12
export const MAX_MONTH_NAME_LENGTH = 24

const FIELDS = ['epochYear', 'eraLabel', 'name', 'monthNames'] as const

/** One way a calendar can be unusable. Each surface words it its own way. */
export type CalendarIssue =
  | { field: 'calendar'; code: 'not-object' }
  | { field: 'calendar'; code: 'unknown-field'; key: string }
  | { field: 'epochYear'; code: 'not-integer' | 'out-of-range' }
  | { field: 'eraLabel' | 'name'; code: 'not-string' | 'too-long' | 'forbidden' | 'invisible' | 'bidi' }
  | { field: 'monthNames'; code: 'not-list' }
  | { field: 'monthNames'; code: 'count'; count: number }
  | { field: 'monthNames'; code: 'empty' | 'too-long' | 'forbidden' | 'bidi' }
  | { field: 'monthNames'; code: 'duplicate'; name: string }

/**
 * Every issue with a calendar from outside (a request body, a tool argument,
 * an import, the app's form). An empty list means it is usable.
 */
export function calendarIssues(value: unknown): CalendarIssue[] {
  if (!isRecord(value)) return [{ field: 'calendar', code: 'not-object' }]
  const issues: CalendarIssue[] = []
  for (const key of Object.keys(value)) {
    if (!(FIELDS as readonly string[]).includes(key)) issues.push({ field: 'calendar', code: 'unknown-field', key })
  }
  const epoch = value.epochYear
  if (typeof epoch !== 'number' || !Number.isInteger(epoch)) {
    issues.push({ field: 'epochYear', code: 'not-integer' })
  } else if (epoch < MIN_EPOCH_YEAR || epoch > MAX_EPOCH_YEAR) {
    issues.push({ field: 'epochYear', code: 'out-of-range' })
  }
  issues.push(...textIssues('eraLabel', value.eraLabel, MAX_ERA_LABEL_LENGTH))
  issues.push(...textIssues('name', value.name, MAX_CALENDAR_NAME_LENGTH))
  if (value.monthNames !== undefined) issues.push(...monthNameIssues(value.monthNames))
  return issues
}

/** The era label or the name: optional text, read trimmed. */
function textIssues(field: 'eraLabel' | 'name', value: unknown, maxLength: number): CalendarIssue[] {
  if (value === undefined) return []
  if (typeof value !== 'string') return [{ field, code: 'not-string' }]
  const text = value.trim()
  if (text.length > maxLength) return [{ field, code: 'too-long' }]
  if (FORBIDDEN_IN_LABEL.test(text)) return [{ field, code: 'forbidden' }]
  if (!bidiClosed(text)) return [{ field, code: 'bidi' }]
  // Empty is fine (it is dropped); text that only looks empty is not.
  if (text.length > 0 && !hasVisible(text)) return [{ field, code: 'invisible' }]
  return []
}

function monthNameIssues(value: unknown): CalendarIssue[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    return [{ field: 'monthNames', code: 'not-list' }]
  }
  const names = (value as string[]).map((entry) => entry.trim())
  if (names.length !== MONTH_COUNT) return [{ field: 'monthNames', code: 'count', count: names.length }]
  const issues: CalendarIssue[] = []
  if (names.some((name) => !hasVisible(name))) issues.push({ field: 'monthNames', code: 'empty' })
  if (names.some((name) => name.length > MAX_MONTH_NAME_LENGTH)) issues.push({ field: 'monthNames', code: 'too-long' })
  if (names.some((name) => FORBIDDEN_IN_MONTH_NAME.test(name))) issues.push({ field: 'monthNames', code: 'forbidden' })
  if (names.some((name) => !bidiClosed(name))) issues.push({ field: 'monthNames', code: 'bidi' })
  const seen = new Set<string>()
  for (const name of names) {
    const key = sameNameKey(name)
    if (key && seen.has(key)) {
      issues.push({ field: 'monthNames', code: 'duplicate', name })
      break
    }
    seen.add(key)
  }
  return issues
}

/** An issue as the API, the CLI and the MCP tools word it. */
export function problemMessage(issue: CalendarIssue): string {
  switch (issue.code) {
    case 'not-object':
      return 'calendar must be an object with an epochYear'
    case 'unknown-field':
      return `calendar has an unknown field "${issue.key}"`
    case 'not-integer':
      return 'calendar.epochYear must be an integer year'
    case 'out-of-range':
      return `calendar.epochYear must be between ${MIN_EPOCH_YEAR} and ${MAX_EPOCH_YEAR}`
    case 'not-string':
      return `calendar.${issue.field} must be a string`
    case 'too-long':
      if (issue.field === 'monthNames') return `calendar.monthNames must each be at most ${MAX_MONTH_NAME_LENGTH} characters`
      return `calendar.${issue.field} must be at most ${issue.field === 'eraLabel' ? MAX_ERA_LABEL_LENGTH : MAX_CALENDAR_NAME_LENGTH} characters`
    case 'forbidden':
      if (issue.field === 'monthNames') {
        return 'calendar.monthNames cannot contain a comma, a "|", brackets, a double quote, or a line break or other control character'
      }
      return `calendar.${issue.field} cannot contain a "|" or a line break or other control character`
    case 'not-list':
      return `calendar.monthNames must be a list of ${MONTH_COUNT} names`
    case 'count':
      return `calendar.monthNames must name all ${MONTH_COUNT} months (got ${issue.count})`
    case 'empty':
      return 'calendar.monthNames cannot have an empty name (or one of invisible characters only)'
    case 'bidi':
      return `calendar.${issue.field} has a text-direction control (U+202A to U+202E, U+2066 to U+2069) left open, which would reorder the text after it`
    case 'invisible':
      return `calendar.${issue.field} cannot be made of invisible characters only`
    case 'duplicate':
      return `calendar.monthNames names "${issue.name}" twice`
  }
}

/**
 * Check a calendar from outside (a request body, a tool argument, an import).
 * Returns the problems found; an empty list means it is usable.
 */
export function calendarProblems(value: unknown): string[] {
  return calendarIssues(value).map(problemMessage)
}

/** A checked calendar, trimmed, with empty optional fields dropped. Throws on a bad one. */
export function normalizeCalendar(value: unknown): GraphCalendar {
  const problems = calendarProblems(value)
  if (problems.length > 0) {
    throw new Error(problems.join('; '))
  }
  const record = value as GraphCalendar
  const calendar: GraphCalendar = { epochYear: record.epochYear }
  const eraLabel = record.eraLabel?.trim()
  if (eraLabel) calendar.eraLabel = eraLabel
  const name = record.name?.trim()
  if (name) calendar.name = name
  if (record.monthNames) calendar.monthNames = record.monthNames.map((month) => month.trim())
  return calendar
}

/**
 * A calendar read back from where it was stored or carried (the graph index,
 * an export being imported, an answer from the API), keeping what still
 * checks out. A calendar written before a rule was added (a "|" in its label,
 * a comma in a month name) loses that field, not its epoch: dropping the whole
 * calendar would turn the world's years back into stored ones without a word.
 * Without a usable epoch there is no calendar. Writes refuse a bad calendar
 * outright (`calendarProblems`); this is only for reading.
 */
export function storedCalendar(value: unknown): GraphCalendar | undefined {
  if (!isRecord(value)) return undefined
  const base = { epochYear: value.epochYear }
  if (calendarIssues(base).length > 0) return undefined
  const kept: Record<string, unknown> = { ...base }
  for (const field of ['eraLabel', 'name', 'monthNames'] as const) {
    if (value[field] !== undefined && calendarIssues({ ...base, [field]: value[field] }).length === 0) {
      kept[field] = value[field]
    }
  }
  return normalizeCalendar(kept)
}

/**
 * {@link storedCalendar} for the app's state: null when there is none, and the
 * very object it was given when nothing about it changes, so a caller
 * comparing by identity sees no change.
 */
export function usableCalendar(value: unknown): GraphCalendar | null {
  const usable = storedCalendar(value)
  if (!usable) return null
  const given = value as Record<string, unknown>
  const givenMonths = given.monthNames
  const unchanged =
    Object.keys(given).length === Object.keys(usable).length &&
    usable.eraLabel === given.eraLabel &&
    usable.name === given.name &&
    (usable.monthNames === undefined
      ? givenMonths === undefined
      : Array.isArray(givenMonths) && usable.monthNames.every((month, index) => month === givenMonths[index]))
  return unchanged ? (value as GraphCalendar) : usable
}

function sameMonthNames(a: string[] | undefined, b: string[] | undefined): boolean {
  if (!a || !b) return !a && !b
  return a.length === b.length && a.every((month, index) => month.trim() === b[index]?.trim())
}

/** Two calendars that label every date the same (the name is display only, but compared too). */
export function sameCalendar(a: GraphCalendar | null | undefined, b: GraphCalendar | null | undefined): boolean {
  if (!a || !b) return !a && !b
  return (
    a.epochYear === b.epochYear &&
    (a.eraLabel?.trim() ?? '') === (b.eraLabel?.trim() ?? '') &&
    (a.name?.trim() ?? '') === (b.name?.trim() ?? '') &&
    sameMonthNames(a.monthNames, b.monthNames)
  )
}

/** Twelve strings: month names a formatter can use. Whether they are good names is `calendarIssues`'s job. */
export function hasTwelveMonthNames(months: unknown): months is string[] {
  return Array.isArray(months) && months.length === MONTH_COUNT && months.every((month) => typeof month === 'string')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
