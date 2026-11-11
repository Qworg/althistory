/**
 * A graph's own calendar, for invented worlds: the frontend copy of
 * `timeline/src/utils/worldCalendar.ts`. The arithmetic and the limits must
 * agree with the backend's, so a year reads the same in an export, the CLI and
 * the app.
 *
 * Every timestamp is still a UTC instant on the proleptic Gregorian calendar;
 * sorting, the time scales and validation read that and nothing here changes
 * it. A calendar only relabels the *year* when a date is shown: with
 * `epochYear: 1000` and `eraLabel: "AR"`, the stored year 1311 is "312 AR".
 * Months and days are shown as stored.
 */

import type { GraphCalendar } from '@/types'

export type { GraphCalendar }

export const MIN_EPOCH_YEAR = 1
export const MAX_EPOCH_YEAR = 9999
export const MAX_ERA_LABEL_LENGTH = 16
export const MAX_CALENDAR_NAME_LENGTH = 80

/** The world's year for a stored year: the epoch year is 1, the year before it 0. */
export function worldYear(storedYear: number, calendar: GraphCalendar): number {
  return storedYear - calendar.epochYear + 1
}

/** The stored year that shows as the given world year. */
export function storedYear(year: number, calendar: GraphCalendar): number {
  return year + calendar.epochYear - 1
}

/**
 * A world year as words: "312 AR", or "Year 312" without a label. A year before
 * year 1 counts back from it: the year before the epoch is "1 before AR" (or
 * "1 before Year 1"), because a year 0 or a minus sign reads as an error.
 *
 * Copied from the backend; keep the two identical. `formatNumber` (the
 * frontend's only addition) writes the numbers in a locale's digits; left
 * out, the output is the backend's.
 */
export function formatWorldYear(
  storedYearValue: number,
  calendar: GraphCalendar,
  formatNumber: (value: number) => string = String
): string {
  const year = worldYear(storedYearValue, calendar)
  const label = calendar.eraLabel?.trim()
  if (year >= 1) return label ? `${formatNumber(year)} ${label}` : `Year ${formatNumber(year)}`
  const before = 1 - year
  return label ? `${formatNumber(before)} before ${label}` : `${formatNumber(before)} before Year ${formatNumber(1)}`
}

/** One line saying how the calendar maps: "the Reckoning of Vael: stored year 1000 is 1 AR". */
export function describeCalendar(calendar: GraphCalendar): string {
  const named = calendar.name ? `${calendar.name}: ` : ''
  return `${named}stored year ${calendar.epochYear} is ${formatWorldYear(calendar.epochYear, calendar)}`
}

/** A calendar the formatters can use: an object with an integer epoch year. */
export function isUsableCalendar(value: unknown): value is GraphCalendar {
  if (typeof value !== 'object' || value === null) return false
  const epoch = (value as { epochYear?: unknown }).epochYear
  return typeof epoch === 'number' && Number.isInteger(epoch)
}

/** Two calendars that label every year the same (the name is display only, but compared too). */
export function sameCalendar(a: GraphCalendar | null | undefined, b: GraphCalendar | null | undefined): boolean {
  if (!a || !b) return !a && !b
  return (
    a.epochYear === b.epochYear &&
    (a.eraLabel?.trim() ?? '') === (b.eraLabel?.trim() ?? '') &&
    (a.name?.trim() ?? '') === (b.name?.trim() ?? '')
  )
}

/** The calendar form's fields, as typed. */
export interface CalendarDraft {
  epochYear: string
  eraLabel: string
  name: string
}

export const EMPTY_CALENDAR_DRAFT: CalendarDraft = { epochYear: '', eraLabel: '', name: '' }

export function draftFromCalendar(calendar: GraphCalendar | null | undefined): CalendarDraft {
  if (!calendar) return EMPTY_CALENDAR_DRAFT
  return {
    epochYear: String(calendar.epochYear),
    eraLabel: calendar.eraLabel ?? '',
    name: calendar.name ?? '',
  }
}

export type CalendarDraftErrors = Partial<Record<keyof CalendarDraft, string>>

/**
 * Check a draft the way the backend checks a calendar (`calendarProblems`), so
 * the form says what the API would refuse before it is sent.
 */
export function calendarDraftErrors(draft: CalendarDraft): CalendarDraftErrors {
  const errors: CalendarDraftErrors = {}
  const epochText = draft.epochYear.trim()
  if (!/^[+-]?\d+$/.test(epochText)) {
    errors.epochYear = 'Give the stored year that is year 1, as a whole number.'
  } else {
    const epoch = Number(epochText)
    if (epoch < MIN_EPOCH_YEAR || epoch > MAX_EPOCH_YEAR) {
      errors.epochYear = `The year 1 must be a stored year from ${MIN_EPOCH_YEAR} to ${MAX_EPOCH_YEAR}.`
    }
  }
  if (draft.eraLabel.trim().length > MAX_ERA_LABEL_LENGTH) {
    errors.eraLabel = `The era label can be at most ${MAX_ERA_LABEL_LENGTH} characters.`
  }
  if (draft.name.trim().length > MAX_CALENDAR_NAME_LENGTH) {
    errors.name = `The calendar name can be at most ${MAX_CALENDAR_NAME_LENGTH} characters.`
  }
  return errors
}

/** A valid draft as the calendar the API takes (trimmed, empty fields left out); null if invalid. */
export function calendarFromDraft(draft: CalendarDraft): GraphCalendar | null {
  if (Object.keys(calendarDraftErrors(draft)).length > 0) return null
  const calendar: GraphCalendar = { epochYear: Number(draft.epochYear.trim()) }
  const eraLabel = draft.eraLabel.trim()
  if (eraLabel) calendar.eraLabel = eraLabel
  const name = draft.name.trim()
  if (name) calendar.name = name
  return calendar
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
