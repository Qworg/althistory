/**
 * A graph's own calendar, for invented worlds: the frontend copy of
 * `timeline/src/utils/worldCalendar.ts`. The arithmetic and the limits must
 * agree with the backend's, so a year reads the same in an export, the CLI and
 * the app.
 *
 * Every timestamp is still a UTC instant on the proleptic Gregorian calendar;
 * sorting, the time scales and validation read that and nothing here changes
 * it. A calendar relabels the year when a date is shown: with
 * `epochYear: 1000` and `eraLabel: "AR"`, the stored year 1311 is "312 AR".
 * With `monthNames` it names the twelve months too ("Thaw 4, 312 AR"); they
 * keep their stored lengths and order, and the days their numbers.
 */

import type { GraphCalendar } from '@/types'

export type { GraphCalendar }

export const MIN_EPOCH_YEAR = 1
export const MAX_EPOCH_YEAR = 9999
export const MAX_ERA_LABEL_LENGTH = 16
export const MAX_CALENDAR_NAME_LENGTH = 80
export const MONTH_COUNT = 12
/**
 * What no month name may hold, as the backend checks: a comma (the list's
 * separator), a `|` (a Markdown table's), a line break or other control
 * character, and brackets and double quotes (a list pasted as text and split
 * in the wrong place). The era label and the name may hold a comma.
 */
const FORBIDDEN_IN_MONTH_NAME = /[,|"[\]\p{Cc}\p{Zl}\p{Zp}]/u
const FORBIDDEN_IN_LABEL = /[|\p{Cc}\p{Zl}\p{Zp}]/u
export const MAX_MONTH_NAME_LENGTH = 24

/** The world's name for a month (0 = January), or null when the calendar does not name its months. */
export function worldMonthName(monthIndex: number, calendar: GraphCalendar | null | undefined): string | null {
  const months = calendar?.monthNames
  return hasUsableMonths(months) ? months[monthIndex] || null : null
}

/** Twelve strings: month names the formatters can use. The backend checks the rest. */
function hasUsableMonths(months: unknown): months is string[] {
  return Array.isArray(months) && months.length === MONTH_COUNT && months.every((month) => typeof month === 'string')
}

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

/** A calendar the formatters can use: an object with an integer epoch year. */
export function isUsableCalendar(value: unknown): value is GraphCalendar {
  if (typeof value !== 'object' || value === null) return false
  const epoch = (value as { epochYear?: unknown }).epochYear
  return typeof epoch === 'number' && Number.isInteger(epoch)
}

/**
 * The calendar as the app uses it, or null when there is none to use. A field
 * that does not check out (month names that are not twelve good names, a
 * label with a "|") is left out rather than losing the world's years with it,
 * which is what the backend keeps of the same calendar when it reads one back
 * (`storedCalendar`), so an import's preview shows what the import keeps.
 */
export function usableCalendar(value: unknown): GraphCalendar | null {
  if (!isUsableCalendar(value)) return null
  if (value.epochYear < MIN_EPOCH_YEAR || value.epochYear > MAX_EPOCH_YEAR) return null
  // Trimmed, and empty text left out, as the backend stores it.
  const usable: GraphCalendar = { epochYear: value.epochYear }
  const eraLabel = goodText(value.eraLabel, MAX_ERA_LABEL_LENGTH)
  if (eraLabel) usable.eraLabel = eraLabel
  const name = goodText(value.name, MAX_CALENDAR_NAME_LENGTH)
  if (name) usable.name = name
  if (hasUsableMonths(value.monthNames)) {
    const monthNames = value.monthNames.map((month) => month.trim())
    if (monthNamesError(monthNames) === null) usable.monthNames = monthNames
  }
  // The same object when nothing changed, so a caller comparing by identity sees no change.
  const unchanged =
    Object.keys(value).length === Object.keys(usable).length &&
    usable.eraLabel === value.eraLabel &&
    usable.name === value.name &&
    (usable.monthNames === undefined
      ? value.monthNames === undefined
      : usable.monthNames.every((month, index) => month === value.monthNames![index]))
  return unchanged ? value : usable
}

/** Text the backend would keep, trimmed; undefined when it would drop it (or it is empty). */
function goodText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length <= maxLength && !FORBIDDEN_IN_LABEL.test(trimmed) ? trimmed || undefined : undefined
}

function sameMonthNames(a: string[] | undefined, b: string[] | undefined): boolean {
  if (!a || !b) return !a && !b
  return a.length === b.length && a.every((month, index) => month.trim() === b[index]?.trim())
}

/** Two calendars that label every year the same (the name is display only, but compared too). */
export function sameCalendar(a: GraphCalendar | null | undefined, b: GraphCalendar | null | undefined): boolean {
  if (!a || !b) return !a && !b
  return (
    a.epochYear === b.epochYear &&
    (a.eraLabel?.trim() ?? '') === (b.eraLabel?.trim() ?? '') &&
    (a.name?.trim() ?? '') === (b.name?.trim() ?? '') &&
    sameMonthNames(a.monthNames, b.monthNames)
  )
}

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
    monthNames: hasUsableMonths(calendar.monthNames) ? calendar.monthNames.join('\n') : '',
  }
}

/**
 * The month names a draft holds: a pasted JSON list, one per line, or, typed
 * on a single line, separated by commas. Blank lines around them are ignored;
 * none at all is an empty list (no month names). One per line, a comma ending
 * a line is a separator typed out of habit ("Thaw,"), not part of the name.
 * The backend reads `--month-names` and the MCP tools' text the same way
 * (`splitMonthNames` in timeline/src/cli/utils/calendarOptions.ts).
 */
export function parseMonthNames(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  // A JSON list pasted in ('["Lowtide", …]') is the list. Brackets that are
  // not JSON stay in the names, which refuse them.
  if (/^\[[\s\S]*\]$/.test(trimmed)) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (Array.isArray(parsed) && parsed.every((name) => typeof name === 'string')) {
        return parsed.map((name: string) => name.trim())
      }
    } catch {
      // Not JSON: read as text below.
    }
  }
  // A blank line in the middle is kept, and refused as an empty name.
  // A comma after the last name ends the list; it is not a thirteenth, empty
  // name. A line with no names in it ("," alone) has none.
  if (!trimmed.includes('\n')) {
    const list = trimmed.replace(/,\s*$/, '')
    return list.trim() === '' ? [] : list.split(',').map((part) => part.trim())
  }
  return trimmed.split(/\r?\n/).map((line) => line.trim().replace(/,$/, '').trim())
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
  } else if (FORBIDDEN_IN_LABEL.test(draft.eraLabel.trim())) {
    errors.eraLabel = 'The era label cannot contain a “|”, a tab or a line break.'
  }
  if (draft.name.trim().length > MAX_CALENDAR_NAME_LENGTH) {
    errors.name = `The calendar name can be at most ${MAX_CALENDAR_NAME_LENGTH} characters.`
  } else if (FORBIDDEN_IN_LABEL.test(draft.name.trim())) {
    errors.name = 'The calendar name cannot contain a “|”, a tab or a line break.'
  }
  const monthError = monthNamesError(parseMonthNames(draft.monthNames))
  if (monthError) errors.monthNames = monthError
  return errors
}

/** What is wrong with a list of month names, as the backend's `calendarProblems` would refuse it; null if fine. */
function monthNamesError(names: string[]): string | null {
  if (names.length === 0) return null
  if (names.length !== MONTH_COUNT) {
    return `Name all ${MONTH_COUNT} months, or none (${names.length === 1 ? '1 name' : `${names.length} names`} given).`
  }
  if (names.some((name) => name.length === 0)) return 'A month name cannot be empty.'
  if (names.some((name) => FORBIDDEN_IN_MONTH_NAME.test(name))) {
    return 'A month name cannot contain a comma, a “|”, brackets, a double quote, a tab or a line break.'
  }
  if (names.some((name) => name.length > MAX_MONTH_NAME_LENGTH)) {
    return `A month name can be at most ${MAX_MONTH_NAME_LENGTH} characters.`
  }
  const seen = new Set<string>()
  for (const name of names) {
    const key = name.toLowerCase()
    if (seen.has(key)) return `“${name}” names two months.`
    seen.add(key)
  }
  return null
}

/** A valid draft as the calendar the API takes (trimmed, empty fields left out); null if invalid. */
export function calendarFromDraft(draft: CalendarDraft): GraphCalendar | null {
  if (Object.keys(calendarDraftErrors(draft)).length > 0) return null
  const calendar: GraphCalendar = { epochYear: Number(draft.epochYear.trim()) }
  const eraLabel = draft.eraLabel.trim()
  if (eraLabel) calendar.eraLabel = eraLabel
  const name = draft.name.trim()
  if (name) calendar.name = name
  const monthNames = parseMonthNames(draft.monthNames)
  if (monthNames.length > 0) calendar.monthNames = monthNames
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
