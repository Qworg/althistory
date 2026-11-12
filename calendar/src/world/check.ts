/**
 * The whole check of a calendar set (docs/specs/world-calendars.md, Req 3,
 * 11, 14): its shape (definition.ts), and that every date it writes reads back
 * as that date and no other, in its own calendar and against the world's
 * others.
 *
 * Names and templates can each be fine and still collide: a month "Midyear"
 * and a one-day festival "Midyear 3" write "Midyear 3, 5 AR" for the festival,
 * which reads back as the month's third day; two calendars that both count
 * "Year N" with the same month names write the same text for different days.
 * Rather than forbid every such shape in advance, the check writes a sample of
 * each calendar's dates (every month and festival, at each precision, with a
 * time, in years before and inside each era) and reads each back.
 */

import {
  type WorldCalendarIssue,
  type WorldCalendarSet,
  calendarSetShapeIssues,
  trimCalendarSet,
} from './definition'
import { type CompiledCalendar, type WorldDateFields, calendarIn, dateAt, partLengths, positionOf } from './engine'
import { type WorldPrecision, formatWorldFields, parseWorldDate } from './notation'

interface Sample {
  fields: WorldDateFields
  precision: WorldPrecision
  withTime: boolean
  /** Read in the world's other calendars too (text that differs only in its numbers need not be). */
  across: boolean
}

const reachable = (calendar: CompiledCalendar, year: number) => positionOf(calendar, { year, part: 0, day: 1, hour: 0, minute: 0, second: 0 }) !== null

/**
 * The years to write dates in. Every month and festival: in the first era's
 * year 1 and the year before it, and in the years about the timeline's zero
 * (an era can begin farther away than a date can reach). A year and a day:
 * in each era's first and twelfth years, and twelve before the first. Only
 * years a date can reach.
 */
function sampleYears(calendar: CompiledCalendar): { full: number[]; brief: number[] } {
  const eras = calendar.definition.eras ?? [{ label: '', from: 1 }]
  const first = eras[0]!.from
  const zero = dateAt(calendar, 0).year
  const full = [...new Set([first, first - 1, zero, zero - 1])].filter((year) => reachable(calendar, year))
  const brief = eras.flatMap((era, index) => {
    const next = eras[index + 1]?.from ?? Infinity
    return [era.from, era.from + 11 < next ? era.from + 11 : era.from].concat(index === 0 ? [first - 12] : [])
  })
  return { full, brief: [...new Set(brief)].filter((year) => !full.includes(year) && reachable(calendar, year)) }
}

/**
 * Years in which a leap rule changes a part's length, one per rule, near the
 * first sampled year: a festival of one day in most years but two in some
 * is written differently in those.
 */
function leapYears(calendar: CompiledCalendar, near: number): number[] {
  return (calendar.definition.leapRules ?? [])
    .map((rule) => {
      const offset = rule.offset ?? 0
      return near + ((((offset - near) % rule.every) + rule.every) % rule.every)
    })
    .filter((year) => reachable(calendar, year))
}

function samplesOf(calendar: CompiledCalendar): Sample[] {
  const samples: Sample[] = []
  const { hoursPerDay, minutesPerHour } = calendar.time
  const at = (year: number, part: number, day: number, hour = 0, minute = 0): WorldDateFields => ({ year, part, day, hour, minute, second: 0 })
  const { full, brief } = sampleYears(calendar)
  const base = full[0] ?? brief[0]
  // In a year a rule changes, the parts whose length changes that year.
  for (const year of base === undefined ? [] : leapYears(calendar, base)) {
    if (full.includes(year)) continue
    const usual = partLengths(calendar, base!)
    partLengths(calendar, year).forEach((days, part) => {
      // The parts whose length changes, and every festival: its text can meet the changed month's.
      if (days === usual[part] && !calendar.definition.parts[part]!.intercalary) return
      samples.push({ fields: at(year, part, 1), precision: 'month', withTime: false, across: false })
      samples.push({ fields: at(year, part, 1), precision: 'day', withTime: false, across: false })
      if (days > 1) samples.push({ fields: at(year, part, days), precision: 'day', withTime: false, across: false })
    })
  }
  for (const [index, year] of full.entries()) {
    const across = index === 0
    const lengths = partLengths(calendar, year)
    samples.push({ fields: at(year, 0, 1), precision: 'year', withTime: false, across })
    lengths.forEach((days, part) => {
      samples.push({ fields: at(year, part, 1), precision: 'month', withTime: false, across })
      samples.push({ fields: at(year, part, 1), precision: 'day', withTime: false, across })
      if (days > 1) samples.push({ fields: at(year, part, days), precision: 'day', withTime: false, across: false })
    })
    samples.push({ fields: at(year, 0, 1, Math.min(1, hoursPerDay - 1), Math.min(1, minutesPerHour - 1)), precision: 'day', withTime: true, across })
  }
  for (const year of brief) {
    samples.push({ fields: at(year, 0, 1), precision: 'year', withTime: false, across: true })
    samples.push({ fields: at(year, 0, 1), precision: 'day', withTime: false, across: true })
  }
  return samples.filter((sample) => positionOf(calendar, sample.fields) !== null)
}

/**
 * Text the set writes that reads back as another date, or in another of its
 * calendars too. The shape must already check out.
 */
export function readBackIssues(set: WorldCalendarSet): WorldCalendarIssue[] {
  const trimmed = trimCalendarSet(set)
  const calendars = trimmed.calendars.map((definition) => calendarIn(trimmed, definition.id))
  const issues: WorldCalendarIssue[] = []
  calendars.forEach((calendar, index) => {
    const path = `calendar.calendars[${index}]`
    const name = calendar.definition.name
    let own = false
    let shared = false
    for (const sample of samplesOf(calendar)) {
      const text = formatWorldFields(calendar, sample.fields, sample.precision, sample.withTime)
      if (!own) {
        const read = parseWorldDate(calendar, text)
        const expected = positionOf(calendar, sample.fields)
        if (!read.ok || read.position !== expected || read.precision !== sample.precision) {
          own = true
          const back = read.ok ? formatWorldFields(calendar, read.fields, read.precision, read.timed) : null
          const as = back === null ? 'nothing' : back === text ? 'another date of the same name' : `"${back}"`
          issues.push({
            path: `${path}.parts`,
            message: `${path} writes "${text}", which reads back as ${as}: its month and festival names and how dates are written must tell every date apart`,
          })
        }
      }
      if (!shared && sample.across) {
        const other = calendars.findIndex((candidate, at) => at !== index && parseWorldDate(candidate, text).ok)
        if (other >= 0) {
          shared = true
          issues.push({
            path: `${path}.eras`,
            message: `${path} writes "${text}", which is also a date in ${calendars[other]!.definition.name}: give ${name} an era label (or month names) of its own`,
          })
        }
      }
      if (own && shared) break
    }
  })
  return issues
}

/** Every issue with a calendar set from outside (a request, a tool, an import). Empty when usable. */
export function calendarSetIssues(value: unknown): WorldCalendarIssue[] {
  const shape = calendarSetShapeIssues(value)
  return shape.length > 0 ? shape : readBackIssues(value as WorldCalendarSet)
}

/** A checked calendar set, its names trimmed. Throws on an unusable one. */
export function normalizeCalendarSet(value: unknown): WorldCalendarSet {
  const issues = calendarSetIssues(value)
  if (issues.length > 0) throw new Error(issues.map((issue) => issue.message).join('; '))
  return trimCalendarSet(value as WorldCalendarSet)
}
