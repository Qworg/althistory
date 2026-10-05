import type {
  Event,
  Arc,
  CausalRelationship,
  FilterState
} from '@/types'
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
  value: Date | string | null | undefined,
  edge: 'start' | 'end'
): number {
  const open = edge === 'start' ? -Infinity : Infinity
  if (value === null || value === undefined || value === '') return open
  const time = value instanceof Date
    ? value.getTime()
    : new Date(value).getTime()
  return Number.isNaN(time) ? open : time
}

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
  const time = new Date(timestamp).getTime()
  if (Number.isNaN(time)) return false
  return (
    time >= boundTimestamp(filters.dateRange.start, 'start') &&
    time <= boundTimestamp(filters.dateRange.end, 'end')
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
      const start = boundTimestamp(filters.dateRange.start, 'start')
      const end = boundTimestamp(filters.dateRange.end, 'end')
      const arcStart = new Date(arc.start_time).getTime()
      const arcEnd = new Date(arc.end_time).getTime()
      if (Number.isNaN(arcStart) || Number.isNaN(arcEnd)) return false
      // Keep arcs that overlap the selected window.
      if (arcStart > end || arcEnd < start) return false
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

function toInputDate(value: Date | string | null | undefined): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.length >= 10 ? value.slice(0, 10) : value
  const time = value.getTime()
  return Number.isNaN(time) ? '' : value.toISOString().slice(0, 10)
}

function fromInputDate(value: string): Date {
  return new Date(value)
}

/** Store filter shape (`Date` bounds) -> the string-bounded shape `FilterPanel` renders. */
export function toPanelFilters(filters: FilterState): PanelFilterState {
  return {
    dateRange: filters.dateRange
      ? {
          start: toInputDate(filters.dateRange.start),
          end: toInputDate(filters.dateRange.end)
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
export function fromPanelFilters(filters: PanelFilterState): FilterState {
  return {
    dateRange: filters.dateRange
      ? {
          start: fromInputDate(filters.dateRange.start),
          end: fromInputDate(filters.dateRange.end)
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
  const startA = boundTimestamp(a.start, 'start')
  const startB = boundTimestamp(b.start, 'start')
  const endA = boundTimestamp(a.end, 'end')
  const endB = boundTimestamp(b.end, 'end')
  const startEqual = startA === startB || (Number.isNaN(startA) && Number.isNaN(startB))
  const endEqual = endA === endB || (Number.isNaN(endA) && Number.isNaN(endB))
  return startEqual && endEqual
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
