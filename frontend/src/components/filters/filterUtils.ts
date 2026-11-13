import type {
  Event,
  Arc,
  CausalRelationship,
  FilterState
} from '@/types'
import { type AxisTime, type WorldCalendarSet, formatDateBound, readDateBound, toAxisTime, toInstant, type DateBoundEdge } from '@althistory/calendar'
import { getActiveCalendar } from '@/stores/worldCalendarStore'
import type { FilterState as PanelFilterState } from './FilterPanel'

export type { PanelFilterState }

/**
 * The backend `GET /events` route reads `actor`, `target`, `startTime` and
 * `endTime`, and `GET /arcs` reads `level`, `startTime` and `endTime`. The
 * client `EventFilters`/`ArcFilters` types send `start_date`/`end_date`/`search`
 * instead, so a time-range or text filter sent to the API silently no-ops, and
 * multi-select (actors/targets/eventTypes/arcLevels) has no query-parameter
 * equivalent at all. Filtering therefore happens client-side over the fetched
 * collection, which is the only form that can honour every filter the UI exposes.
 */

/** Inclusive timestamp for a bound of a date range. Missing/invalid bounds are
 * treated as open, so a partially-filled date range still narrows results. */
function boundTimestamp(
  value: Date | string | null | undefined
): AxisTime | null {
  // null is an open bound. Axis times are exact bigints: a deep date's getTime() is a rounded double.
  if (value === null || value === undefined || value === '') return null
  return toAxisTime(value)
}

/** Whether `time` is at or after the bound (an open one is always passed). */
const atOrAfter = (time: AxisTime, bound: AxisTime | null) => bound === null || time >= bound
const atOrBefore = (time: AxisTime, bound: AxisTime | null) => bound === null || time <= bound

function matchesQuery(query: string, ...values: string[]): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return values.some(value => value.toLowerCase().includes(needle))
}

function withinRange(
  timestamp: string,
  filters: FilterState
): boolean {
  if (!filters.dateRange) return true
  const time = toAxisTime(timestamp)
  if (time === null) return false
  return (
    atOrAfter(time, boundTimestamp(filters.dateRange.start)) &&
    atOrBefore(time, boundTimestamp(filters.dateRange.end))
  )
}

export function filterEvents(events: Event[], filters: FilterState): Event[] {
  return events.filter(event => {
    if (!matchesQuery(filters.searchQuery, event.description, event.actor, event.target)) {
      return false
    }
    if (filters.actors.length > 0 && !filters.actors.includes(event.actor)) return false
    if (filters.targets.length > 0 && !filters.targets.includes(event.target)) return false
    if (!withinRange(event.timestamp, filters)) return false
    // `eventTypes` has no backing field on `Event`, so it cannot narrow events.
    return true
  })
}

export function filterArcs(arcs: Arc[], filters: FilterState): Arc[] {
  return arcs.filter(arc => {
    if (!matchesQuery(filters.searchQuery, arc.name, arc.description)) return false
    if (filters.arcLevels.length > 0 && !filters.arcLevels.includes(arc.level)) return false
    if (filters.dateRange) {
      const start = boundTimestamp(filters.dateRange.start)
      const end = boundTimestamp(filters.dateRange.end)
      const arcStart = toAxisTime(arc.start_time)
      const arcEnd = toAxisTime(arc.end_time)
      if (arcStart === null || arcEnd === null) return false
      // Keep arcs that overlap the selected window.
      if (!atOrBefore(arcStart, end) || !atOrAfter(arcEnd, start)) return false
    }
    return true
  })
}

export function filterCausalRelationships(
  relationships: CausalRelationship[],
  filters: FilterState
): CausalRelationship[] {
  const [minWeight, maxWeight] = filters.causalWeightRange
  return relationships.filter(relationship => {
    if (relationship.weight < minWeight || relationship.weight > maxWeight) return false
    if (relationship.confidence < filters.confidenceThreshold) return false
    return true
  })
}

export function hasActiveFilters(filters: FilterState): boolean {
  return (
    filters.searchQuery.trim() !== '' ||
    filters.dateRange !== null ||
    filters.actors.length > 0 ||
    filters.targets.length > 0 ||
    filters.eventTypes.length > 0 ||
    filters.arcLevels.length > 0 ||
    filters.causalWeightRange[0] > 0 ||
    filters.causalWeightRange[1] < 1 ||
    filters.confidenceThreshold > 0
  )
}

// ── Historical date bounds ────────────────────────────────────────────────
//
// A bound is typed largest unit first -- `1843`, `1843-11`, `1843-11-20`, with
// `BCE` for years before 1 CE -- and read as a UTC instant: a start bound is
// the first moment of the period it names and an end bound the last. In a
// world it is written in the calendar shown ("Thaw 312 AR"). The reading and
// writing are `@althistory/calendar` (calendar/src/bounds.ts), property-tested
// against an arithmetic oracle and in calendars of every shape.

export {
  parseHistoricalDate,
  formatHistoricalDateBound,
  readDateBound,
  formatDateBound,
  type DateBoundEdge,
  type HistoricalDateParse,
} from '@althistory/calendar'

type CalendarArg = WorldCalendarSet | null

function toInputDate(value: Date | string | null | undefined, edge: DateBoundEdge, calendar: CalendarArg): string {
  return formatDateBound(value, edge, calendar)
}

/** A typed bound -> its instant; an empty or unreadable bound is an invalid
 * `Date`, which {@link boundTimestamp} treats as open. */
function fromInputDate(value: string, edge: DateBoundEdge, calendar: CalendarArg): Date {
  if (!value) return new Date(NaN)
  const parsed = readDateBound(value, edge, calendar)
  // Anything else (a full timestamp from a link) by the app's one reader: UTC
  // when it has no zone, and no date rather than the day V8 rolls "1870-02-31" into.
  return parsed.ok ? parsed.date : toInstant(value)
}

/**
 * A bound as a link carries it. In a world the instant it names (ISO 8601):
 * its text depends on the calendar the viewer picked, which a link does not
 * carry, and two calendars can write the same text for different days.
 * Without a world, the bound as typed (`1843-11`), as links always held it.
 */
export function boundToUrl(text: string, edge: DateBoundEdge, calendar: CalendarArg): string {
  if (!calendar || text === '') return text
  const read = readDateBound(text, edge, calendar)
  return read.ok ? read.date.toISOString() : text
}

/** A bound from a link, as the panel shows it in the calendar shown (see {@link boundToUrl}). */
export function boundFromUrl(value: string, edge: DateBoundEdge, calendar: CalendarArg): string {
  if (!calendar || value === '') return value
  return formatDateBound(value, edge, calendar) || value
}

/**
 * Store filter shape (`Date` bounds) -> the string-bounded shape `FilterPanel`
 * renders, with the bounds in the world calendar shown (the open graph's by
 * default; `null` for stored dates).
 */
export function toPanelFilters(filters: FilterState, calendar: CalendarArg = getActiveCalendar()): PanelFilterState {
  return {
    dateRange: filters.dateRange
      ? {
          start: toInputDate(filters.dateRange.start, 'start', calendar),
          end: toInputDate(filters.dateRange.end, 'end', calendar)
        }
      : null,
    actors: filters.actors,
    targets: filters.targets,
    eventTypes: filters.eventTypes,
    arcLevels: filters.arcLevels,
    causalWeightRange: filters.causalWeightRange,
    confidenceThreshold: filters.confidenceThreshold,
    searchQuery: filters.searchQuery
  }
}

/** `FilterPanel` string bounds -> the store filter shape. An empty bound stays
 * as an invalid `Date`, which {@link boundTimestamp} treats as open. */
export function fromPanelFilters(filters: PanelFilterState, calendar: CalendarArg = getActiveCalendar()): FilterState {
  return {
    dateRange: filters.dateRange
      ? {
          start: fromInputDate(filters.dateRange.start, 'start', calendar),
          end: fromInputDate(filters.dateRange.end, 'end', calendar)
        }
      : null,
    actors: filters.actors,
    targets: filters.targets,
    eventTypes: filters.eventTypes,
    arcLevels: filters.arcLevels,
    causalWeightRange: filters.causalWeightRange,
    confidenceThreshold: filters.confidenceThreshold,
    searchQuery: filters.searchQuery
  }
}

function sameStringArray(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function sameNumberArray(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function sameDateRange(
  a: FilterState['dateRange'],
  b: FilterState['dateRange']
): boolean {
  if (a === null || b === null) return a === b
  const startA = boundTimestamp(a.start)
  const startB = boundTimestamp(b.start)
  const endA = boundTimestamp(a.end)
  const endB = boundTimestamp(b.end)
  return startA === startB && endA === endB
}

/** Value equality for the store filter shape, used to avoid writing an
 * identical object back to the store (which would re-run the panel's URL sync). */
export function filtersEqual(a: FilterState, b: FilterState): boolean {
  return (
    a.searchQuery === b.searchQuery &&
    a.confidenceThreshold === b.confidenceThreshold &&
    a.causalWeightRange[0] === b.causalWeightRange[0] &&
    a.causalWeightRange[1] === b.causalWeightRange[1] &&
    sameStringArray(a.actors, b.actors) &&
    sameStringArray(a.targets, b.targets) &&
    sameStringArray(a.eventTypes, b.eventTypes) &&
    sameNumberArray(a.arcLevels, b.arcLevels) &&
    sameDateRange(a.dateRange, b.dateRange)
  )
}
