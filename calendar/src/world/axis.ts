/**
 * Where a timeline in a world calendar puts its ticks, and what it calls them
 * (docs/specs/world-calendars.md, Req 17); and filter bounds written in a
 * world's notation (Req 15).
 */

import { type WorldCalendarSet, MAX_TIME } from './definition'
import { type CompiledCalendar, calendarIn, dateAt, positionOf } from './engine'
import { formatWorldFields, formatWorldTime, parseWorldDate, parseWorldText, type WorldPrecision, worldPeriod } from './notation'

export interface WorldTick {
  position: number
  label: string
}

type Unit = 'year' | 'month' | 'day' | 'hour' | 'minute'

const BASE_STEPS: Record<Exclude<Unit, 'year'>, number[]> = {
  month: [1, 2, 3, 6],
  day: [1, 2, 5, 10],
  hour: [1, 2, 3, 6, 12],
  minute: [1, 5, 10, 15, 30],
}

/**
 * A unit's round steps: the usual ones, then 1-2-5 steps past them up to the
 * most the calendar has of it (a day of a thousand hours steps by 200).
 */
function stepsOf(calendar: CompiledCalendar, unit: Exclude<Unit, 'year'>): number[] {
  const most =
    unit === 'month'
      ? calendar.definition.parts.length
      : unit === 'day'
        ? Math.max(...calendar.definition.parts.map((part) => part.days)) + 2
        : unit === 'hour'
          ? calendar.time.hoursPerDay
          : calendar.time.minutesPerHour
  const steps = [...BASE_STEPS[unit]]
  // Only a unit divided far more finely than Earth's (a thousand hours) needs
  // more: 24 hours stepped by 20, or 12 months by 10, would tick unevenly.
  if (most <= steps[steps.length - 1]! * 4) return steps
  for (let power = 10; power < most; power *= 10) {
    for (const step of [power, 2 * power, 5 * power]) if (step > steps[steps.length - 1]! && step < most) steps.push(step)
  }
  return steps
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
      // Only the hours the domain reaches (a day can have a thousand).
      const fromHour = axisDay === firstDay ? first.hour - (first.hour % (unit === 'hour' ? step : 1)) : 0
      const toHour = axisDay === lastDay ? last.hour : hoursPerDay - 1
      for (let hour = fromHour; hour <= toHour; hour += unit === 'hour' ? step : 1) {
        for (let minute = 0; minute < (unit === 'hour' ? 1 : minutesPerHour); minute += unit === 'minute' ? step : minutesPerHour) {
          if (!push(positionOf(calendar, { ...date, hour, minute, second: 0 }))) return null
        }
      }
    }
  }
  return out
}

/**
 * Ticks for a timeline over [lo, hi] in a calendar (Req 17): of the round
 * units and steps that give from two to `maxTicks` ticks, the one that gives
 * the most (the coarser on a tie), as a d3 axis fills the room it is given;
 * each labelled in the calendar's notation, distinct.
 */
export function worldTicks(calendar: CompiledCalendar, domain: readonly [number, number], maxTicks: number): WorldTick[] {
  const lo = Math.max(-MAX_TIME, Math.min(domain[0], domain[1]))
  const hi = Math.min(MAX_TIME, Math.max(domain[0], domain[1]))
  if (!(hi > lo) || maxTicks < 1) return []
  const span = hi - lo
  const units: Unit[] = ['year', 'month', 'day', 'hour', 'minute']
  let best: { unit: Unit; ticks: number[] } | null = null
  // Coarse to fine: once a unit's coarsest step has too many ticks, every finer one does.
  search: for (const unit of units) {
    const length = unitMs(calendar, unit)
    const steps = unit === 'year' ? yearSteps(span / length) : stepsOf(calendar, unit)
    for (const [index, step] of [...steps].reverse().entries()) {
      const tooMany = span / (length * step) > maxTicks * 2
      const ticks = tooMany ? null : ticksOf(calendar, unit, step, lo, hi, maxTicks)
      if (ticks === null) {
        if (index === 0) break search
        break
      }
      if (ticks.length > 0 && (best === null || ticks.length > best.ticks.length)) best = { unit, ticks }
    }
  }
  if (!best) {
    // No round step fits the room exactly (30 days in a 51-day month, with
    // room for two): take the coarsest that overflows least, thinned evenly.
    // Every tick still falls on that unit's boundary.
    for (const unit of units) {
      const length = unitMs(calendar, unit)
      const steps = unit === 'year' ? yearSteps(span / length) : stepsOf(calendar, unit)
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
    // As a d3 axis reads: a day's first moment by its date, the rest by their time.
    labels = dates.map((date, index) =>
      date.hour === 0 && date.minute === 0 ? labels[index]! : formatWorldTime(calendar, date)
    )
  }
  if (new Set(labels).size !== labels.length) {
    labels = dates.map((date) => `${formatWorldFields(calendar, date, 'day')}, ${formatWorldTime(calendar, date)}`)
  }
  return ticks.map((position, index) => ({ position, label: labels[index]! }))
}

/**
 * A filter bound written in a world's notation ("Thaw 312 AR"), as the first
 * (start) or last (end) millisecond of the day, month or year it names, with
 * the precision it was written at. It is read in the calendar shown (the
 * set's primary) first, so the spelling {@link formatWorldBound} gives always
 * reads back as itself; then in the world's other calendars. A bound names a
 * period, not a moment: a time is refused. An error when it names no date.
 */
export function worldBound(
  set: WorldCalendarSet,
  text: string,
  edge: 'start' | 'end'
): { ok: true; position: number; precision: WorldPrecision; calendar: string } | { ok: false; error: string } {
  const shown = parseWorldDate(calendarIn(set), text)
  const read = shown.ok ? shown : parseWorldText(set, text)
  if (!read.ok) return read
  if (read.timed) {
    return { ok: false, error: 'a bound names a day, a month or a year, not a time of day' }
  }
  const period = worldPeriod(calendarIn(set, read.calendar), read.fields, read.precision)
  if (!period) return { ok: false, error: 'that date is beyond the range a date can hold' }
  return { ok: true, position: edge === 'start' ? period.start : period.end, precision: read.precision, calendar: read.calendar }
}

/**
 * A position as a filter bound in the calendar shown, the inverse of
 * {@link worldBound}: a start on the first moment of a year reads as the
 * year, of a month as the month, and anything else as its day; an end on the
 * last moment of a year or month likewise. '' for a position that is not a
 * finite number.
 */
export function formatWorldBound(set: WorldCalendarSet, position: number, edge: 'start' | 'end'): string {
  if (!Number.isFinite(position) || Math.abs(position) > MAX_TIME) return ''
  const calendar = calendarIn(set)
  // A start is a period's first moment; an end is the moment before the next one's.
  const boundary = edge === 'start' ? position : position + 1
  const date = dateAt(calendar, position)
  const next = dateAt(calendar, Math.min(MAX_TIME, boundary))
  const startsAt = (fields: { year: number; part: number }) =>
    positionOf(calendar, { year: fields.year, part: fields.part, day: 1, hour: 0, minute: 0, second: 0 }) === boundary
  if (boundary <= MAX_TIME) {
    if (startsAt({ year: next.year, part: 0 })) return formatWorldFields(calendar, date, 'year')
    if (startsAt(next)) return formatWorldFields(calendar, date, 'month')
  }
  return formatWorldFields(calendar, date, 'day')
}

/**
 * A year, a month and a day as a bound is written in the calendar shown, for
 * a field's hint: the first of each in the calendar's year 1 ("1 AR", "Thaw
 * 1 AR", "Thaw 1, 1 AR"). Each reads back as a bound at its precision.
 */
export function worldBoundExamples(set: WorldCalendarSet): { year: string; month: string; day: string } {
  const calendar = calendarIn(set)
  const first = dateAt(calendar, calendar.definition.epoch * calendar.dayMs)
  return {
    year: formatWorldFields(calendar, first, 'year'),
    month: formatWorldFields(calendar, first, 'month'),
    day: formatWorldFields(calendar, first, 'day'),
  }
}
