/**
 * Keyboard model of the timeline canvas, as pure functions.
 *
 * The timeline is one tab stop. Focus then moves between marks with the
 * arrow keys: ←/→ through a lane in time order, ↑/↓ between lanes (each arc
 * row, top to bottom, then the event track), Home/End to a lane's ends.
 * Timeline.tsx wires these to the DOM; nothing here touches it.
 */

import { type CompiledCalendar, type WorldCalendarSet, calendarIn, dateAt, partLengths, positionOf } from '@althistory/calendar'
import { getActiveCalendar } from '@/stores/worldCalendarStore'


/** A mark's identity in the DOM (`data-mark-key`) and in the model. */
export type MarkKey = string

export const eventMarkKey = (id: string): MarkKey => `event:${id}`
export const arcMarkKey = (id: string): MarkKey => `arc:${id}`

export function parseMarkKey(key: MarkKey): { kind: 'event' | 'arc'; id: string } | null {
  if (key.startsWith('event:')) return { kind: 'event', id: key.slice('event:'.length) }
  if (key.startsWith('arc:')) return { kind: 'arc', id: key.slice('arc:'.length) }
  return null
}

interface NavItem {
  key: MarkKey
  /** Start and end of the mark in epoch ms (equal for an event). */
  start: number
  end: number
}

export interface NavModel {
  /** Lanes top to bottom: arc rows by render level, then the event track. Never empty lanes. */
  lanes: NavItem[][]
  index: Map<MarkKey, { lane: number; position: number }>
}

export type NavMove = 'prev' | 'next' | 'first' | 'last' | 'up' | 'down'

const byTime = (a: NavItem, b: NavItem) => a.start - b.start || a.end - b.end || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)

export function buildNavModel(
  events: ReadonlyArray<{ id: string; timestamp: string }>,
  arcs: ReadonlyArray<{ id: string; start_time: string; end_time: string; renderLevel: number }>
): NavModel {
  const rows = new Map<number, NavItem[]>()
  for (const arc of arcs) {
    const start = new Date(arc.start_time).getTime()
    const end = new Date(arc.end_time).getTime()
    if (Number.isNaN(start) || Number.isNaN(end)) continue
    const row = rows.get(arc.renderLevel) ?? []
    row.push({ key: arcMarkKey(arc.id), start, end })
    rows.set(arc.renderLevel, row)
  }
  const lanes: NavItem[][] = [...rows.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, row]) => row.sort(byTime))

  const track: NavItem[] = []
  for (const event of events) {
    const t = new Date(event.timestamp).getTime()
    if (!Number.isNaN(t)) track.push({ key: eventMarkKey(event.id), start: t, end: t })
  }
  if (track.length > 0) lanes.push(track.sort(byTime))

  const index = new Map<MarkKey, { lane: number; position: number }>()
  lanes.forEach((lane, laneIndex) => lane.forEach((item, position) => index.set(item.key, { lane: laneIndex, position })))
  return { lanes, index }
}

/** The span [start, end] (epoch ms) of a mark in the model, or null. */
export function markSpan(model: NavModel, key: MarkKey): { start: number; end: number } | null {
  const at = model.index.get(key)
  const item = at ? model.lanes[at.lane]?.[at.position] : undefined
  return item ? { start: item.start, end: item.end } : null
}

/** Distance in time from t to an item (0 when the item spans t). */
function distance(item: NavItem, t: number): number {
  if (t < item.start) return item.start - t
  if (t > item.end) return t - item.end
  return 0
}

/**
 * Where focus goes from `from` for `move`, or null to stay put.
 *
 * A vertical move lands on the mark in the next lane nearest in time to the
 * current one. For an arc the reference time is the middle of the part of it
 * that is in view (`view`), so moving down from a long arc lands on an event
 * the user can see rather than on one under its off-screen midpoint.
 */
export function navigate(
  model: NavModel,
  from: MarkKey,
  move: NavMove,
  view?: { start: number; end: number }
): MarkKey | null {
  const at = model.index.get(from)
  if (!at) return null
  const lane = model.lanes[at.lane]
  const current = lane?.[at.position]
  if (!lane || !current) return null

  switch (move) {
    case 'prev':
      return lane[at.position - 1]?.key ?? null
    case 'next':
      return lane[at.position + 1]?.key ?? null
    case 'first':
      return lane[0]?.key ?? null
    case 'last':
      return lane[lane.length - 1]?.key ?? null
    case 'up':
    case 'down': {
      const target = model.lanes[at.lane + (move === 'up' ? -1 : 1)]
      if (!target || target.length === 0) return null
      let start = current.start
      let end = current.end
      if (view && end > start) {
        start = Math.max(start, view.start)
        end = Math.min(end, view.end)
        if (end < start) {
          start = current.start
          end = current.end
        }
      }
      const t = (start + end) / 2
      let best = target[0]!
      let bestDistance = distance(best, t)
      for (const item of target) {
        const d = distance(item, t)
        if (d < bestDistance) {
          best = item
          bestDistance = d
        }
      }
      return best.key
    }
  }
}

type Unit = 'minute' | 'hour' | 'day' | 'month' | 'year'

export interface TimeStep {
  unit: Unit
  count: number
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const APPROX_MS: Record<Unit, number> = {
  minute: MINUTE,
  hour: HOUR,
  day: DAY,
  month: 30.44 * DAY,
  year: 365.25 * DAY,
}

/** Calendar steps, smallest first. Months and years are calendar offsets, not fixed ms. */
const STEPS: readonly TimeStep[] = [
  { unit: 'minute', count: 1 },
  { unit: 'minute', count: 15 },
  { unit: 'hour', count: 1 },
  { unit: 'hour', count: 6 },
  { unit: 'day', count: 1 },
  { unit: 'day', count: 7 },
  { unit: 'month', count: 1 },
  { unit: 'month', count: 3 },
  { unit: 'year', count: 1 },
  { unit: 'year', count: 5 },
  { unit: 'year', count: 10 },
  { unit: 'year', count: 25 },
  { unit: 'year', count: 50 },
  { unit: 'year', count: 100 },
]

/** About this many keyboard steps cross the visible span. */
const STEPS_PER_VIEW = 40

/**
 * The step a keyboard retime or resize moves by: the largest calendar unit
 * that fits about 40 times into what is on screen, so a press is a small but
 * visible move at any zoom (a day when a year is in view, five years when two
 * centuries are).
 */
export function keyboardTimeStep(visibleSpanMs: number, calendar: WorldCalendarSet | null = getActiveCalendar()): TimeStep {
  const target = visibleSpanMs / STEPS_PER_VIEW
  const approx = calendar ? worldUnitMs(calendar) : APPROX_MS
  let chosen = STEPS[0]!
  for (const step of STEPS) {
    if (approx[step.unit] * step.count <= target) chosen = step
  }
  return chosen
}

/** A world calendar's units, in milliseconds (a month and a year on average). */
function worldUnitMs(set: WorldCalendarSet): Record<Unit, number> {
  const calendar = calendarIn(set)
  const yearMs = (calendar.cycleDays / calendar.cycleYears) * calendar.dayMs
  return {
    minute: calendar.dayMs / (calendar.time.hoursPerDay * calendar.time.minutesPerHour),
    hour: calendar.dayMs / calendar.time.hoursPerDay,
    day: calendar.dayMs,
    month: yearMs / calendar.definition.parts.length,
    year: yearMs,
  }
}

/**
 * `date` moved by `direction` steps. In a world, by its own minutes, hours,
 * days, months and years (a month or a year keeps the day, the last day of a
 * shorter month or festival when it has fewer); otherwise in UTC on the
 * Gregorian calendar (historical dates are UTC instants).
 */
export function offsetByStep(date: Date, step: TimeStep, direction: number, calendar: WorldCalendarSet | null = getActiveCalendar()): Date {
  if (calendar) return new Date(offsetInWorld(calendarIn(calendar), date.getTime(), step, direction))
  const next = new Date(date.getTime())
  const n = step.count * direction
  switch (step.unit) {
    case 'minute':
    case 'hour':
    case 'day':
      next.setTime(next.getTime() + n * APPROX_MS[step.unit])
      break
    case 'month':
    case 'year': {
      // The same day of the month, or the month's last when it is shorter
      // (Jan 31 + 1 month is Feb 28, not Mar 3).
      const day = next.getUTCDate()
      next.setUTCDate(1)
      if (step.unit === 'month') next.setUTCMonth(next.getUTCMonth() + n)
      else next.setUTCFullYear(next.getUTCFullYear() + n)
      const last = new Date(Date.UTC(2000, 0, 1))
      last.setUTCFullYear(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)
      next.setUTCDate(Math.min(day, last.getUTCDate()))
      break
    }
  }
  return next
}

function offsetInWorld(calendar: CompiledCalendar, position: number, step: TimeStep, direction: number): number {
  const n = step.count * direction
  if (step.unit === 'minute' || step.unit === 'hour' || step.unit === 'day') {
    const unit = step.unit === 'day' ? calendar.dayMs : step.unit === 'hour' ? calendar.dayMs / calendar.time.hoursPerDay : calendar.dayMs / (calendar.time.hoursPerDay * calendar.time.minutesPerHour)
    return position + Math.round(n * unit)
  }
  const date = dateAt(calendar, position)
  let year = date.year
  let part = date.part
  if (step.unit === 'year') year += n
  else {
    // Months, not festivals: a step from Highsun lands in Saltreap, past
    // Midyear's Day, and keeps the day. From a festival, the next month.
    const months = calendar.definition.parts.flatMap((candidate, index) => (candidate.intercalary ? [] : [index]))
    const here = months.indexOf(part)
    // A festival sits between two months: forward from the one before it, back from the one after.
    const after = months.findIndex((index) => index > part)
    const next = after < 0 ? months.length : after
    const from = here >= 0 ? here : n > 0 ? next - 1 : next
    const index = from + n
    year += Math.floor(index / months.length)
    part = months[((index % months.length) + months.length) % months.length]!
  }
  const day = Math.min(date.day, partLengths(calendar, year)[part]!)
  // The same time into the new day.
  const intoDay = position - Math.floor(position / calendar.dayMs) * calendar.dayMs
  const start = positionOf(calendar, { year, part, day, hour: 0, minute: 0, second: 0 })
  return start === null ? position : start + intoDay
}
