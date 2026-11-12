/**
 * Writing and reading dates in a world calendar's own notation, structured
 * dates, and the period a date names (docs/specs/world-calendars.md, Req 7,
 * 10, 11, 14, 15).
 */

import type { DatePrecision } from '../describe'
import { sameNameKey } from '../text'
import { type CalendarDefinition, DEFAULT_NOTATION, MAX_TIME, type WorldCalendarSet } from './definition'
import {
  type CompiledCalendar,
  type WorldDateFields,
  axisDayOf,
  calendarIn,
  compileCalendar,
  eraOf,
  fieldsProblem,
  lineYear,
  partLengths,
  positionOf,
  dateAt,
} from './engine'

export type WorldPrecision = DatePrecision

function notationOf(definition: CalendarDefinition): Required<NonNullable<CalendarDefinition['notation']>> {
  return { ...DEFAULT_NOTATION, ...definition.notation }
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{([a-z]+)\}/g, (_match, name: string) => values[name] ?? '')
}

/** A line year as words: "312 AR", "Year 312", "40 before AR", "40 before Year 1", or with `beforeEra` "40 BAR" (Req 7). */
export function formatWorldYearOf(definition: CalendarDefinition, year: number): string {
  const eras = definition.eras ?? [{ label: '', from: 1 }]
  const { era, count } = eraOf(definition, year)
  if (era === 'before') {
    if (definition.beforeEra) return `${count} ${definition.beforeEra}`
    return eras[0]!.label ? `${count} before ${eras[0]!.label}` : `${count} before Year 1`
  }
  const label = eras[era]!.label
  return label ? `${count} ${label}` : `Year ${count}`
}

const pad = (value: number, width: number) => String(value).padStart(width, '0')
const widthOf = (units: number) => Math.max(2, String(units - 1).length)

/** A time of day in the calendar's notation: "14:30", or "09:07:41" with seconds. */
export function formatWorldTime(calendar: CompiledCalendar, date: Pick<WorldDateFields, 'hour' | 'minute' | 'second'>): string {
  const { hoursPerDay, minutesPerHour, secondsPerMinute } = calendar.time
  return fill(notationOf(calendar.definition).time, {
    hour: pad(date.hour, widthOf(hoursPerDay)),
    minute: pad(date.minute, widthOf(minutesPerHour)),
    second: pad(date.second, widthOf(secondsPerMinute)),
  })
}

/** Whether a part is a festival of a single day in a year, written by the festival template. */
function isOneDayFestival(calendar: CompiledCalendar, year: number, part: number): boolean {
  return Boolean(calendar.definition.parts[part]!.intercalary) && partLengths(calendar, year)[part] === 1
}

/** A date in the calendar's notation, at a precision; with its time when asked. */
export function formatWorldFields(
  calendar: CompiledCalendar,
  date: WorldDateFields,
  precision: WorldPrecision = 'day',
  withTime = false
): string {
  const definition = calendar.definition
  const notation = notationOf(definition)
  const year = formatWorldYearOf(definition, date.year)
  if (precision === 'year') return fill(notation.year, { year })
  const month = definition.parts[date.part]!.name
  if (precision === 'month') return fill(notation.month, { month, year })
  const text = isOneDayFestival(calendar, date.year, date.part)
    ? fill(notation.festival, { month, year })
    : fill(notation.date, { month, day: String(date.day), year })
  return withTime ? `${text}, ${formatWorldTime(calendar, date)}` : text
}

/**
 * A position in the calendar's notation, at a precision. At day precision a
 * time other than the day's start is written after the date.
 */
export function formatWorldPosition(calendar: CompiledCalendar, position: number, precision: WorldPrecision = 'day'): string {
  if (!Number.isFinite(position)) return 'Invalid date'
  const date = dateAt(calendar, position)
  const startOfDay = date.hour === 0 && date.minute === 0 && date.second === 0
  return formatWorldFields(calendar, date, precision, precision === 'day' && !startOfDay)
}

// ── Reading ──────────────────────────────────────────────────────────────

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')

/** An alternation of names, longest first, so a name that starts another is tried last. */
const alternation = (names: readonly string[]) => [...names].sort((a, b) => b.length - a.length).map(escape).join('|')

function yearPattern(definition: CalendarDefinition): string {
  const eras = definition.eras ?? [{ label: '', from: 1 }]
  const options: string[] = []
  const labels = eras.map((era) => era.label).filter(Boolean)
  if (definition.beforeEra) options.push(`\\d+\\s+${escape(definition.beforeEra)}`)
  else if (eras[0]!.label) options.push(`\\d+\\s+before\\s+${escape(eras[0]!.label)}`)
  else options.push('\\d+\\s+before\\s+Year\\s+1')
  if (labels.length > 0) options.push(`\\d+\\s+(?:${alternation(labels)})`)
  else options.push('Year\\s+\\d+')
  return options.join('|')
}

/**
 * A template's literal text as a pattern: spaces alone between two
 * placeholders need at least one space ("Thaw 312", never "Thaw312"); around
 * punctuation they may be left out or added ("Thaw 4,312 AR", "Thaw 4 , 312 AR").
 */
function literalPattern(text: string): string {
  if (text.trim() === '') return '\\s+'
  return `\\s*${escape(text.trim())}\\s*`
}

/** A template as a pattern, and the placeholders its groups capture, in order. */
function templatePattern(template: string, groups: Record<string, string>): { source: string; order: string[] } {
  const order: string[] = []
  const source = template
    .split(/(\{[a-z]+\})/)
    .map((piece) => {
      const placeholder = /^\{([a-z]+)\}$/.exec(piece)
      if (!placeholder) return piece === '' ? '' : literalPattern(piece)
      order.push(placeholder[1]!)
      return `(${groups[placeholder[1]!]})`
    })
    .join('')
  return { source, order }
}

/** The line year a written year names, or why it names none. */
function readYearPhrase(definition: CalendarDefinition, text: string): number | string {
  const eras = definition.eras ?? [{ label: '', from: 1 }]
  const phrase = text.trim().replace(/\s+/g, ' ')
  const first = eras[0]!
  const beforeLabel = definition.beforeEra ?? (first.label ? `before ${first.label}` : 'before Year 1')
  const before = new RegExp(`^(\\d+) ${escape(beforeLabel)}$`, 'iu').exec(phrase)
  let count: number
  let year: number
  if (before) {
    count = Number(before[1])
    year = lineYear(definition, 'before', count)
  } else {
    const plain = /^Year (\d+)$/iu.exec(phrase)
    const labelled = /^(\d+) (.+)$/u.exec(phrase)
    if (plain && !first.label) {
      count = Number(plain[1])
      year = lineYear(definition, 0, count)
    } else if (labelled) {
      const index = eras.findIndex((era) => era.label && sameNameKey(era.label) === sameNameKey(labelled[2]!))
      if (index < 0) return `"${labelled[2]}" is not an era of ${definition.name}`
      count = Number(labelled[1])
      year = lineYear(definition, index, count)
      // A count past the next era's start is that era's: "1200 AR" when the Second Age began at AR 900.
      const next = eras[index + 1]
      if (next && year >= next.from) return `${definition.name} counts ${eras[index]!.label} only to ${next.from - eras[index]!.from}; later years are ${next.label}`
    } else return `"${text}" is not a year of ${definition.name}`
  }
  if (count < 1) return 'years are counted from 1'
  return year
}

export type WorldParse =
  | { ok: true; calendar: string; fields: WorldDateFields; precision: WorldPrecision; position: number }
  | { ok: false; error: string }

/** A date written in one calendar's notation, at whatever precision it names (Req 14). */
export function parseWorldDate(calendar: CompiledCalendar, input: string): WorldParse {
  const definition = calendar.definition
  const notation = notationOf(definition)
  const text = input.trim().replace(/\s+/g, ' ')
  const number = '\\d{1,6}'
  const allParts = definition.parts.map((part) => part.name)
  const festivals = definition.parts.filter((part) => part.intercalary).map((part) => part.name)
  const year = yearPattern(definition)
  const time = templatePattern(notation.time, { hour: number, minute: number, second: number })
  const forms: Array<{ template: string; precision: WorldPrecision; festival?: boolean; timed: boolean }> = [
    { template: notation.date, precision: 'day', timed: true },
    ...(festivals.length > 0 ? [{ template: notation.festival, precision: 'day' as const, festival: true, timed: true }] : []),
    { template: notation.month, precision: 'month', timed: false },
    { template: notation.year, precision: 'year', timed: false },
  ]
  let reason: string | null = null
  for (const form of forms) {
    const months = form.festival ? festivals : allParts
    const date = templatePattern(form.template, { month: alternation(months), day: number, year })
    const pattern = new RegExp(`^${date.source}${form.timed ? `(?:\\s*,\\s*${time.source})?` : ''}$`, 'iu')
    const match = pattern.exec(text)
    if (!match) continue
    const values: Record<string, string> = {}
    date.order.forEach((name, index) => (values[name] = match[index + 1]!))
    const timeValues: Record<string, string | undefined> = {}
    time.order.forEach((name, index) => (timeValues[name] = match[date.order.length + 1 + index]))

    const lineYearOrError = readYearPhrase(definition, values.year!)
    if (typeof lineYearOrError === 'string') {
      reason = lineYearOrError
      continue
    }
    const part = values.month === undefined ? 0 : definition.parts.findIndex((candidate) => sameNameKey(candidate.name) === sameNameKey(values.month!))
    let day = values.day === undefined ? 1 : Number(values.day)
    if (form.festival) {
      const length = partLengths(calendar, lineYearOrError)[part]!
      if (length !== 1) {
        reason = `${definition.parts[part]!.name} has ${length} days that year: say which`
        continue
      }
      day = 1
    }
    const fields: WorldDateFields = {
      year: lineYearOrError,
      part,
      day,
      hour: timeValues.hour === undefined ? 0 : Number(timeValues.hour),
      minute: timeValues.minute === undefined ? 0 : Number(timeValues.minute),
      second: timeValues.second === undefined ? 0 : Number(timeValues.second),
    }
    const problem = fieldsProblem(calendar, fields)
    if (problem) {
      reason = problem
      continue
    }
    const position = positionOf(calendar, fields)
    if (position === null) {
      reason = 'that date is beyond the range a date can hold'
      continue
    }
    return { ok: true, calendar: definition.id, fields, precision: form.precision, position }
  }
  const example = formatWorldFields(calendar, { year: 312, part: 0, day: 4, hour: 0, minute: 0, second: 0 })
  return { ok: false, error: reason ?? `"${input.trim()}" is not a date in ${definition.name}: write one as "${example}"` }
}

/**
 * A date written in a world's notation, in any of its calendars (the primary
 * first). Text that two calendars both read, as different dates, is refused:
 * give it structured, with its calendar.
 */
export function parseWorldText(set: WorldCalendarSet, input: string): WorldParse {
  const order = [set.primary, ...set.calendars.map((definition) => definition.id).filter((id) => id !== set.primary)]
  const read = order.map((id) => parseWorldDate(calendarIn(set, id), input))
  const found = read.filter((result): result is Extract<WorldParse, { ok: true }> => result.ok)
  if (found.length === 0) return read[0]!
  const distinct = new Set(found.map((result) => result.position))
  if (distinct.size > 1) {
    const names = found.map((result) => set.calendars.find((definition) => definition.id === result.calendar)!.name)
    return { ok: false, error: `"${input.trim()}" is a different date in ${names.join(' and ')}: give it with its calendar` }
  }
  return found[0]!
}

/** A date given as fields: `year` counts in `era` (a label, or "before"), or is the line year when no era is given. */
export interface WorldDateInput {
  calendar?: string
  era?: string
  year: number
  month?: string | number
  day?: number
  hour?: number
  minute?: number
  second?: number
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** A date given as text in the world's notation or as fields (Req 14). */
export function readWorldInput(set: WorldCalendarSet, input: unknown): WorldParse {
  if (typeof input === 'string') return parseWorldText(set, input)
  if (!isRecord(input)) return { ok: false, error: 'a date must be text in the world\'s notation or { year, month, day }' }
  const id = input.calendar === undefined ? set.primary : input.calendar
  const definition = set.calendars.find((candidate) => candidate.id === id)
  if (!definition) return { ok: false, error: `the world has no calendar "${String(id)}"` }
  const calendar = compileCalendar(definition, set.dayLength)
  if (typeof input.year !== 'number' || !Number.isInteger(input.year)) return { ok: false, error: 'year must be a whole number' }

  let year = input.year
  if (input.era !== undefined) {
    if (typeof input.era !== 'string') return { ok: false, error: 'era must be text' }
    const eras = definition.eras ?? [{ label: '', from: 1 }]
    const before = definition.beforeEra ?? (eras[0]!.label ? `before ${eras[0]!.label}` : 'before Year 1')
    const key = sameNameKey(input.era)
    if (key === 'before' || key === sameNameKey(before)) year = lineYear(definition, 'before', input.year)
    else {
      const index = eras.findIndex((era) => sameNameKey(era.label) === key)
      if (index < 0) return { ok: false, error: `"${input.era}" is not an era of ${definition.name}` }
      year = lineYear(definition, index, input.year)
    }
    if (input.year < 1) return { ok: false, error: 'years are counted from 1' }
  }

  let part = 0
  if (input.month !== undefined) {
    if (typeof input.month === 'number') part = input.month - 1
    else if (typeof input.month === 'string') part = definition.parts.findIndex((candidate) => sameNameKey(candidate.name) === sameNameKey(input.month as string))
    if (!Number.isInteger(part) || part < 0 || part >= definition.parts.length) {
      return { ok: false, error: `${definition.name} has no month "${String(input.month)}"` }
    }
  }
  const precision: WorldPrecision = input.day !== undefined ? 'day' : input.month !== undefined ? 'month' : 'year'
  const timed = ['hour', 'minute', 'second'].some((key) => input[key] !== undefined)
  if (timed && precision !== 'day') return { ok: false, error: 'a time needs a day' }
  const fields: WorldDateFields = {
    year,
    part,
    day: (input.day as number | undefined) ?? 1,
    hour: (input.hour as number | undefined) ?? 0,
    minute: (input.minute as number | undefined) ?? 0,
    second: (input.second as number | undefined) ?? 0,
  }
  const problem = fieldsProblem(calendar, fields)
  if (problem) return { ok: false, error: problem }
  const position = positionOf(calendar, fields)
  if (position === null) return { ok: false, error: 'that date is beyond the range a date can hold' }
  return { ok: true, calendar: definition.id, fields, precision, position }
}

/**
 * The period a date names (Req 15): from its first position to the last
 * millisecond before the next day, month or year. Null when it is beyond
 * the range a date can hold.
 */
export function worldPeriod(
  calendar: CompiledCalendar,
  fields: WorldDateFields,
  precision: WorldPrecision
): { start: number; end: number } | null {
  const startFields = {
    year: fields.year,
    part: precision === 'year' ? 0 : fields.part,
    day: precision === 'day' ? fields.day : 1,
    hour: 0,
    minute: 0,
    second: 0,
  }
  const start = positionOf(calendar, startFields)
  if (start === null) return null
  let nextDay: number
  if (precision === 'day') nextDay = axisDayOf(calendar, startFields) + 1
  else if (precision === 'month' && fields.part + 1 < calendar.definition.parts.length) {
    nextDay = axisDayOf(calendar, { year: fields.year, part: fields.part + 1, day: 1 })
  } else nextDay = axisDayOf(calendar, { year: fields.year + 1, part: 0, day: 1 })
  const end = nextDay * calendar.dayMs - 1
  return Math.abs(end) <= MAX_TIME ? { start, end } : null
}
