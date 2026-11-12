/**
 * The app's calendar form: its fields as typed, what is wrong with them, and
 * what it sends.
 *
 * A draft is read into the same shape a request carries and checked by the
 * same rules (`calendarIssues`), then worded for a person. So the form accepts
 * exactly what the API accepts, and what it sends is what the API would store
 * (`normalizeCalendar`).
 */

import {
  type CalendarIssue,
  type GraphCalendar,
  MAX_CALENDAR_NAME_LENGTH,
  MAX_EPOCH_YEAR,
  MAX_ERA_LABEL_LENGTH,
  MAX_MONTH_NAME_LENGTH,
  MIN_EPOCH_YEAR,
  MONTH_COUNT,
  calendarIssues,
  hasTwelveMonthNames,
  normalizeCalendar,
  problemMessage,
  sameCalendar,
} from './calendar'
import { parseEpochYear, parseMonthNames } from './parse'

/** The calendar form's fields, as typed. */
export interface CalendarDraft {
  epochYear: string
  eraLabel: string
  name: string
  /** The month names as typed: one per line, or separated by commas on one line. Empty for none. */
  monthNames: string
}

export const EMPTY_CALENDAR_DRAFT: CalendarDraft = { epochYear: '', eraLabel: '', name: '', monthNames: '' }

export function draftFromCalendar(calendar: GraphCalendar | null | undefined): CalendarDraft {
  if (!calendar) return EMPTY_CALENDAR_DRAFT
  return {
    epochYear: String(calendar.epochYear),
    eraLabel: calendar.eraLabel ?? '',
    name: calendar.name ?? '',
    monthNames: hasTwelveMonthNames(calendar.monthNames) ? calendar.monthNames.join('\n') : '',
  }
}

/**
 * The draft as a request would carry it: the epoch read as a number (or left
 * as the text, which is then not one), and no month names when none are typed.
 */
function draftAsRequest(draft: CalendarDraft): Record<string, unknown> {
  const months = parseMonthNames(draft.monthNames)
  return {
    epochYear: parseEpochYear(draft.epochYear) ?? draft.epochYear,
    eraLabel: draft.eraLabel,
    name: draft.name,
    ...(months.length > 0 ? { monthNames: months } : {}),
  }
}

export type CalendarDraftErrors = Partial<Record<keyof CalendarDraft, string>>

/** Which of a field's issues the form shows, when it has several. */
const MONTH_ISSUE_ORDER: CalendarIssue['code'][] = ['not-list', 'count', 'empty', 'forbidden', 'bidi', 'too-long', 'duplicate']

/** What the form says is wrong with each field; empty when the API would take it. */
export function calendarDraftErrors(draft: CalendarDraft): CalendarDraftErrors {
  const errors: CalendarDraftErrors = {}
  const issues = calendarIssues(draftAsRequest(draft))
  for (const field of ['epochYear', 'eraLabel', 'name', 'monthNames'] as const) {
    const mine = issues.filter((issue) => issue.field === field)
    if (field === 'monthNames') mine.sort((a, b) => MONTH_ISSUE_ORDER.indexOf(a.code) - MONTH_ISSUE_ORDER.indexOf(b.code))
    const first = mine[0]
    if (first) errors[field] = formMessage(first)
  }
  return errors
}

/** An issue as the form words it. */
function formMessage(issue: CalendarIssue): string {
  const what = issue.field === 'eraLabel' ? 'The era label' : 'The calendar name'
  switch (issue.field) {
    case 'epochYear':
      return issue.code === 'not-integer'
        ? 'Give the stored year that is year 1, as a whole number.'
        : `The year 1 must be a stored year from ${MIN_EPOCH_YEAR} to ${MAX_EPOCH_YEAR}.`
    case 'eraLabel':
    case 'name':
      if (issue.code === 'too-long') {
        return `${what} can be at most ${issue.field === 'eraLabel' ? MAX_ERA_LABEL_LENGTH : MAX_CALENDAR_NAME_LENGTH} characters.`
      }
      if (issue.code === 'forbidden') return `${what} cannot contain a “|”, a tab or a line break.`
      if (issue.code === 'bidi') return `${what} has a text-direction control that is not closed.`
      if (issue.code === 'invisible') return `${what} cannot be made of invisible characters only.`
      return problemMessage(issue)
    case 'monthNames':
      switch (issue.code) {
        case 'count':
          return `Name all ${MONTH_COUNT} months, or none (${issue.count === 1 ? '1 name' : `${issue.count} names`} given).`
        case 'empty':
          return 'A month name cannot be empty or invisible.'
        case 'forbidden':
          return 'A month name cannot contain a comma, a “|”, brackets, a double quote, a tab or a line break.'
        case 'bidi':
          return 'A month name has a text-direction control that is not closed.'
        case 'too-long':
          return `A month name can be at most ${MAX_MONTH_NAME_LENGTH} characters.`
        case 'duplicate':
          return `“${issue.name}” names two months.`
        default:
          return problemMessage(issue)
      }
    default:
      return problemMessage(issue)
  }
}

/** A valid draft as the calendar the API takes (trimmed, empty fields left out); null if invalid. */
export function calendarFromDraft(draft: CalendarDraft): GraphCalendar | null {
  const request = draftAsRequest(draft)
  return calendarIssues(request).length > 0 ? null : normalizeCalendar(request)
}

/**
 * What a graph form sends for its calendar section: the calendar to set, `null`
 * to remove the one the graph had, or `undefined` to leave it as it is (no
 * section, or nothing changed). `ok: false` when the section is on but invalid.
 */
export function calendarRequest(
  enabled: boolean,
  draft: CalendarDraft,
  original: GraphCalendar | null | undefined
): { ok: true; calendar: GraphCalendar | null | undefined } | { ok: false } {
  if (!enabled) return { ok: true, calendar: original ? null : undefined }
  const calendar = calendarFromDraft(draft)
  if (!calendar) return { ok: false }
  return { ok: true, calendar: original && sameCalendar(original, calendar) ? undefined : calendar }
}
