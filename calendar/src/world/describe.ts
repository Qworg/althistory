/**
 * A world's calendars in plain words, for exports, tool output and what a
 * language model is told; and reading a date that may be written in the
 * world's notation or as an ISO timestamp (docs/specs/world-calendars.md,
 * Req 18).
 */

import { readTimestamp } from '../instant'
import type { CalendarDefinition, WorldCalendarSet } from './definition'
import { calendarIn, dateAt } from './engine'
import { type WorldPrecision, formatWorldFields, formatWorldPosition, parseWorldText } from './notation'

/** A position in a world's calendar (its primary unless another is named), at a precision. */
export function formatInWorld(set: WorldCalendarSet, position: number, precision: WorldPrecision = 'day', calendarId?: string): string {
  return formatWorldPosition(calendarIn(set, calendarId), position, precision)
}

/**
 * A date as a person or a model wrote it, in a graph that may have a world
 * calendar: the world's notation first (in any of its calendars), then ISO
 * 8601. Read once where it enters, as toISOString's spelling with the
 * precision it stated. Null when it is neither.
 */
export function readWorldTimestamp(
  set: WorldCalendarSet | null | undefined,
  text: string
): { iso: string; precision: WorldPrecision } | null {
  if (set) {
    const world = parseWorldText(set, text)
    if (world.ok) return { iso: new Date(world.position).toISOString(), precision: world.precision }
  }
  return readTimestamp(text)
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
