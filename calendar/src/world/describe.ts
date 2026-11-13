/**
 * A world's calendars in plain words, for exports, tool output and what a
 * language model is told; and reading a date that may be written in the
 * world's notation or as an ISO timestamp (docs/specs/world-calendars.md,
 * Req 18).
 */

import { parseIsoInstant } from '../instant'
import { type CalendarDefinition, MAX_TIME, type WorldCalendarSet } from './definition'
import { calendarIn, dateAt } from './engine'
import { type WorldPrecision, formatWorldFields, formatWorldPosition, parseWorldText, worldPeriod } from './notation'

/** A position in a world's calendar (its primary unless another is named), at a precision. */
export function formatInWorld(set: WorldCalendarSet, position: number, precision: WorldPrecision = 'day', calendarId?: string): string {
  return formatWorldPosition(calendarIn(set, calendarId), position, precision)
}

/** What a date read where it enters names: its instant, how much of it is known, and (a world's) the calendar it was given in. */
export interface ReadTimestamp {
  iso: string
  precision: WorldPrecision
  /** The world calendar the text was written in; absent for ISO 8601. */
  calendar?: string
}

/** The last millisecond of the UTC day, month or year an ISO date names. */
function isoPeriodEnd(start: Date, precision: WorldPrecision): number {
  const next = new Date(start.getTime())
  if (precision === 'year') next.setUTCFullYear(next.getUTCFullYear() + 1)
  else if (precision === 'month') next.setUTCMonth(next.getUTCMonth() + 1)
  else next.setUTCDate(next.getUTCDate() + 1)
  return next.getTime() - 1
}

/**
 * A date as a person, a program or a model wrote it, read once where it
 * enters: the one rule every door applies (the API, the CLI and MCP tools,
 * ingestion, the app's forms).
 *
 * - In a world, its notation first, in any of its calendars ("Thaw 4, 312
 *   AR", "Thaw 312 AR", "312 AR"; a time after a comma).
 * - Then ISO 8601: a date and time is that instant; a date, a month or a year
 *   alone ("1871-03") names that UTC period, with its precision. In a world a
 *   Gregorian month or year is no period of the world's, so only an ISO date
 *   or date and time is read there.
 * - With `edge: 'end'`, a day, month or year written without a time is its
 *   period's last moment (Req 15); a time, even "00:00", is that moment.
 *
 * Null when it is none of these: {@link unreadDateReason} says why.
 */
export function readWorldTimestamp(
  set: WorldCalendarSet | null | undefined,
  text: string,
  edge: 'start' | 'end' = 'start'
): ReadTimestamp | null {
  if (set) {
    const world = parseWorldText(set, text)
    if (world.ok) {
      const at = edge === 'end' && !world.timed ? worldPeriod(calendarIn(set, world.calendar), world.fields, world.precision)?.end : world.position
      if (at === undefined) return null
      return { iso: new Date(at).toISOString(), precision: world.precision, calendar: world.calendar }
    }
  }
  const iso = parseIsoInstant(String(text).trim())
  if (!iso) return null
  const precision: WorldPrecision = iso.precision === 'year' || iso.precision === 'month' ? iso.precision : 'day'
  if (set && precision !== 'day') return null
  const at = edge === 'end' && iso.dateOnly ? isoPeriodEnd(iso.date, precision) : iso.date.getTime()
  if (!Number.isFinite(at) || Math.abs(at) > MAX_TIME) return null
  return { iso: new Date(at).toISOString(), precision }
}

/** Why {@link readWorldTimestamp} read nothing from the text, as a sentence. */
export function unreadDateReason(set: WorldCalendarSet | null | undefined, text: string): string {
  const trimmed = String(text).trim()
  const asIso = parseIsoInstant(trimmed)
  if (asIso && (!set || (asIso.precision !== 'year' && asIso.precision !== 'month'))) {
    return `"${trimmed}" reaches beyond the range a date can hold.`
  }
  if (set) {
    const iso = asIso
    if (iso && (iso.precision === 'year' || iso.precision === 'month')) {
      const example = formatInWorld(set, calendarIn(set).definition.epoch * calendarIn(set).dayMs, iso.precision)
      return `"${trimmed}" is a Gregorian ${iso.precision}, which is no ${iso.precision} of this world: give it in the world's calendar ("${example}"), or give a day.`
    }
    const world = parseWorldText(set, trimmed)
    if (!world.ok) return sentence(world.error)
  }
  return `"${trimmed}" is not a date: give an ISO 8601 date (1843-11-20, 1843-11-20T14:30, 1871-03).`
}

const sentence = (text: string) => {
  const capital = text.trim().charAt(0).toUpperCase() + text.trim().slice(1)
  return /[.!?]$/.test(capital) ? capital : `${capital}.`
}

/** "13 months and 2 festivals, 366 or 367 days a year; eras AR": a calendar's shape in a line. */
function shapeOf(definition: CalendarDefinition, set: WorldCalendarSet): string {
  const calendar = calendarIn(set, definition.id)
  const months = definition.parts.filter((part) => !part.intercalary).length
  const festivals = definition.parts.length - months
  const lengths = new Set<number>()
  for (let r = 0; r < Math.min(calendar.cycleYears, 1000); r++) lengths.add(calendar.yearStarts[r + 1]! - calendar.yearStarts[r]!)
  const sorted = [...lengths].sort((a, b) => a - b)
  const days = sorted.length === 1 ? `${sorted[0]}` : `${sorted[0]} to ${sorted[sorted.length - 1]}`
  const eras = (definition.eras ?? []).map((era) => era.label).filter(Boolean)
  return [
    `${months} month${months === 1 ? '' : 's'}${festivals ? ` and ${festivals} festival${festivals === 1 ? '' : 's'}` : ''}`,
    `${days} days a year`,
    ...(eras.length ? [`eras ${eras.join(', ')}`] : []),
  ].join(', ')
}

/** One line per calendar: its name, its shape, its parts in order; for exports and tool output. */
export function describeCalendarSet(set: WorldCalendarSet): string {
  const lines = set.calendars.map((definition) => {
    const parts = definition.parts.map((part) => `${part.name} (${part.days}${part.intercalary ? ', festival' : ''})`).join(', ')
    const primary = definition.id === set.primary && set.calendars.length > 1 ? ' (primary)' : ''
    return `${definition.name}${primary}: ${shapeOf(definition, set)}; ${parts}`
  })
  const day = set.dayLength === 86_400 ? '' : `A day is ${set.dayLength} seconds. `
  return day + lines.join('\n')
}

/**
 * What a reader of prose about the world (a language model extracting
 * events) needs: that the world keeps its own time, how each calendar names a
 * date, and to write every date in that notation, which the server converts.
 */
export function calendarSetInstructions(set: WorldCalendarSet): string {
  const examples = set.calendars.map((definition) => {
    const calendar = calendarIn(set, definition.id)
    const sample = formatWorldFields(calendar, { ...dateAt(calendar, definition.epoch * calendar.dayMs), part: 0, day: 1 }, 'day')
    const months = definition.parts.map((part) => part.name).join(', ')
    return `${definition.name}: write a date as "${sample}"; its months and festivals, in order, are ${months}.`
  })
  return (
    "The text dates events in an invented world's own calendar" +
    (set.calendars.length > 1 ? 's' : '') +
    ', not the Gregorian one. ' +
    examples.join(' ') +
    ' Give every timestamp as a date in that notation, exactly as the text gives it (a year alone, or a month and year, when that is all it says); do not convert it to an ISO date.'
  )
}
