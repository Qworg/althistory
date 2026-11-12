/**
 * Where a timeline in a world calendar puts its ticks, and what it calls them
 * (docs/specs/world-calendars.md, Req 17); and filter bounds written in a
 * world's notation (Req 15).
 */

import { type WorldCalendarSet, MAX_TIME } from './definition'
import { type CompiledCalendar, calendarIn, dateAt, positionOf } from './engine'
import { formatWorldFields, formatWorldTime, parseWorldText, type WorldPrecision, worldPeriod } from './notation'

export interface WorldTick {
  position: number
  label: string
}

type Unit = 'year' | 'month' | 'day' | 'hour' | 'minute'

const STEPS: Record<Exclude<Unit, 'year'>, number[]> = {
  month: [1, 2, 3, 6],
  day: [1, 2, 5, 10],
  hour: [1, 2, 3, 6, 12],
  minute: [1, 5, 10, 15, 30],
}

/** Year steps of the 1-2-5 series, as far as a span of `years` needs (a calendar's year can be two days long). */
function yearSteps(years: number): number[] {
  const steps: number[] = []
  for (let power = 1; steps.length === 0 || steps[steps.length - 1]! < years; power *= 10) steps.push(power, 2 * power, 5 * power)
  return steps
}

/** A unit's average length in milliseconds, for estimating how many ticks a step makes. */
function unitMs(calendar: CompiledCalendar, unit: Unit): number {
  const yearDays = calendar.cycleDays / calendar.cycleYears
  if (unit === 'year') return yearDays * calendar.dayMs
  if (unit === 'month') return (yearDays / calendar.definition.parts.length) * calendar.dayMs
  if (unit === 'day') return calendar.dayMs
  if (unit === 'hour') return calendar.dayMs / calendar.time.hoursPerDay
  return calendar.dayMs / (calendar.time.hoursPerDay * calendar.time.minutesPerHour)
}

/**
 * The round line years in [from, to] for a step, in order, computed era by
 * era rather than year by year (a span can hold hundreds of millions of a
 * short calendar's years): in an era, its year 1 (unless `withEraStarts` is
 * false) and the counts that are multiples of the step; before the first
 * era, the counts back that are.
 * Null when there are more than `limit`.
 */
function roundYears(calendar: CompiledCalendar, from: number, to: number, step: number, limit: number, withEraStarts = true): number[] | null {
  const eras = calendar.definition.eras ?? [{ label: '', from: 1 }]
  const years: number[] = []
  const add = (year: number) => {
    if (year >= from && year <= to && years[years.length - 1] !== year) years.push(year)
    return years.length <= limit
  }
  // Before the first era: counts back (first.from - year) that are multiples of the step, latest count first.
  const first = eras[0]!.from
  if (from < first) {
    const highest = first - from
    const lowest = Math.max(1, first - Math.min(to, first - 1))
    for (let count = Math.floor(highest / step) * step; count >= lowest; count -= step) {
      if (count >= 1 && !add(first - count)) return null
    }
  }
  for (const [index, era] of eras.entries()) {
    const end = index + 1 < eras.length ? eras[index + 1]!.from - 1 : Infinity
    const lo = Math.max(from, era.from)
    const hi = Math.min(to, end)
    if (lo > hi) continue
    if (withEraStarts && !add(era.from)) return null
    // Counts (year - from + 1) that are multiples of the step.
    const firstCount = Math.max(step, Math.ceil((lo - era.from + 1) / step) * step)
    for (let count = firstCount; era.from + count - 1 <= hi; count += step) {
      if (!add(era.from + count - 1)) return null
    }
  }
  return years.sort((a, b) => a - b)
}

/** The ticks of one unit and step within [lo, hi], or null when there would be more than `limit`. */
function ticksOf(calendar: CompiledCalendar, unit: Unit, step: number, lo: number, hi: number, limit: number): number[] | null {
  const out: number[] = []
  const push = (position: number | null) => {
    if (position !== null && position >= lo && position <= hi) out.push(position)
    return out.length <= limit
  }
  const first = dateAt(calendar, lo)
  const last = dateAt(calendar, hi)
  if (unit === 'year') {
    // Each era's first year is a tick, unless eras are so short that their
    // starts alone would crowd the axis: then only the round counts.
    const startOf = (year: number) => positionOf(calendar, { year, part: 0, day: 1, hour: 0, minute: 0, second: 0 })
    const inDomain = (years: number[] | null) =>
      years && years.map(startOf).filter((position): position is number => position !== null && position >= lo && position <= hi)
    const withStarts = inDomain(roundYears(calendar, first.year, last.year, step, limit + 2))
    const chosen = withStarts && withStarts.length <= limit ? withStarts : inDomain(roundYears(calendar, first.year, last.year, step, limit + 2, false))
    if (!chosen || chosen.length > limit) return null
    out.push(...chosen)
  } else if (unit === 'month') {
    for (let year = first.year; year <= last.year; year++) {
      for (let part = 0; part < calendar.definition.parts.length; part += step) {
        if (!push(positionOf(calendar, { year, part, day: 1, hour: 0, minute: 0, second: 0 }))) return null
      }
    }
  } else {
    const firstDay = Math.floor(lo / calendar.dayMs)
    const lastDay = Math.floor(hi / calendar.dayMs)
    for (let axisDay = firstDay; axisDay <= lastDay; axisDay++) {
      const date = dateAt(calendar, axisDay * calendar.dayMs)
      if (unit === 'day') {
        if ((date.day - 1) % step === 0 && !push(axisDay * calendar.dayMs)) return null
        continue
      }
      const { hoursPerDay, minutesPerHour } = calendar.time
      for (let hour = 0; hour < hoursPerDay; hour += unit === 'hour' ? step : 1) {
        for (let minute = 0; minute < (unit === 'hour' ? 1 : minutesPerHour); minute += unit === 'minute' ? step : minutesPerHour) {
          if (!push(positionOf(calendar, { ...date, hour, minute, second: 0 }))) return null
        }
      }
    }
  }
  return out
}

/**
 * Ticks for a timeline over [lo, hi] in a calendar: the coarsest round unit
 * that gives at least two ticks and no more than `maxTicks` (Req 17), each
 * labelled in the calendar's notation, distinct.
 */
export function worldTicks(calendar: CompiledCalendar, domain: readonly [number, number], maxTicks: number): WorldTick[] {
  const lo = Math.max(-MAX_TIME, Math.min(domain[0], domain[1]))
  const hi = Math.min(MAX_TIME, Math.max(domain[0], domain[1]))
  if (!(hi > lo) || maxTicks < 1) return []
  const span = hi - lo
  const units: Unit[] = ['year', 'month', 'day', 'hour', 'minute']
  let best: { unit: Unit; ticks: number[] } | null = null
  for (const unit of units) {
    const length = unitMs(calendar, unit)
    // Largest step first: the first that fits is the coarsest round step.
    const steps = unit === 'year' ? yearSteps(span / length) : STEPS[unit]
    for (const step of [...steps].reverse()) {
      if (span / (length * step) > maxTicks * 2) break
      const ticks = ticksOf(calendar, unit, step, lo, hi, maxTicks)
      if (ticks === null) break
      if (ticks.length >= 2) best = { unit, ticks }
      else if (!best && ticks.length === 1) best = { unit, ticks }
    }
    if (best && best.ticks.length >= 2) break
  }
  if (!best) {
    // No round step fits the room exactly (30 days in a 51-day month, with
    // room for two): take the coarsest that overflows least, thinned evenly.
    // Every tick still falls on that unit's boundary.
    for (const unit of units) {
      const length = unitMs(calendar, unit)
      const steps = unit === 'year' ? yearSteps(span / length) : STEPS[unit]
      for (const step of [...steps].reverse()) {
        if (span / (length * step) > maxTicks * 8) break
        const ticks = ticksOf(calendar, unit, step, lo, hi, maxTicks * 8)
        if (ticks && ticks.length > 0) {
          const every = Math.ceil(ticks.length / maxTicks)
          best = { unit, ticks: ticks.filter((_tick, index) => index % every === 0) }
          break
        }
      }
      if (best) break
    }
  }
  if (!best) return []
  return labelled(calendar, best.unit, best.ticks)
}

/** Labels for ticks of a unit: as short as the unit allows, made fuller where two would read the same. */
function labelled(calendar: CompiledCalendar, unit: Unit, ticks: number[]): WorldTick[] {
  const dates = ticks.map((position) => dateAt(calendar, position))
  const precision: WorldPrecision = unit === 'year' ? 'year' : unit === 'month' ? 'month' : 'day'
  let labels = dates.map((date) => formatWorldFields(calendar, date, precision))
  if (unit === 'hour' || unit === 'minute') {
    const sameDay = new Set(dates.map((date) => `${date.year}:${date.part}:${date.day}`)).size === 1
    labels = dates.map((date, index) => (sameDay ? formatWorldTime(calendar, date) : `${labels[index]}, ${formatWorldTime(calendar, date)}`))
  }
  if (new Set(labels).size !== labels.length) {
    labels = dates.map((date) => `${formatWorldFields(calendar, date, 'day')}, ${formatWorldTime(calendar, date)}`)
  }
  return ticks.map((position, index) => ({ position, label: labels[index]! }))
}

/**
 * A filter bound written in a world's notation ("Thaw 312 AR"), as the first
 * (start) or last (end) millisecond of the period it names, with the
 * precision it was written at. An error when it names no date.
 */
export function worldBound(
  set: WorldCalendarSet,
  text: string,
  edge: 'start' | 'end'
): { ok: true; position: number; precision: WorldPrecision; calendar: string } | { ok: false; error: string } {
  const read = parseWorldText(set, text)
  if (!read.ok) return read
  // A bound with a time names that moment; without one, the period it names.
  const timed = read.fields.hour !== 0 || read.fields.minute !== 0 || read.fields.second !== 0
  if (timed) return { ok: true, position: read.position, precision: read.precision, calendar: read.calendar }
  const period = worldPeriod(calendarIn(set, read.calendar), read.fields, read.precision)
  if (!period) return { ok: false, error: 'that date is beyond the range a date can hold' }
  return { ok: true, position: edge === 'start' ? period.start : period.end, precision: read.precision, calendar: read.calendar }
}
