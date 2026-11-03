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

// ── Historical date bounds ────────────────────────────────────────────────
//
// The filter's date bounds are typed, not picked: a native date input shows
// the browser's locale order (mm/dd/yyyy in the US) and cannot reach BCE. A
// bound is a year, a year and month, or a full date, written largest unit
// first -- `1843`, `1843-11`, `1843-11-20` -- with `BCE` (or a minus sign) for
// years before 1 CE. There is no year 0: 1 BCE is followed by 1 CE.
//
// Like every historical time in the app (see utils/historicalTime.ts) a bound
// is a UTC instant. A start bound is the first moment of the period it names
// and an end bound the last, so `1843` to `1843` is the whole year.

export type DateBoundEdge = 'start' | 'end'

export type HistoricalDateParse =
  | { ok: true; date: Date; text: string }
  | { ok: false; error: string }

const HISTORICAL_DATE_PATTERN = /^(-)?(\d{1,6})(?:-(\d{1,2})(?:-(\d{1,2}))?)?(?:\s*(BCE|BC|CE|AD))?$/i

/** A UTC instant from an astronomical year (1 BCE = 0); safe for years 0-99. */
function utcDate(astronomicalYear: number, monthIndex: number, day: number): Date {
  const date = new Date(Date.UTC(2000, 0, 1))
  date.setUTCFullYear(astronomicalYear, monthIndex, day)
  return date
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** The canonical spelling of a bound: `1843`, `1843-11`, `44-03-15 BCE`. */
function formatBound(astronomicalYear: number, month?: number, day?: number): string {
  const bce = astronomicalYear <= 0
  const year = bce ? 1 - astronomicalYear : astronomicalYear
  let text = String(year)
  if (month !== undefined) text += `-${pad2(month)}`
  if (day !== undefined) text += `-${pad2(day)}`
  return bce ? `${text} BCE` : text
}

/**
 * Read a typed date bound. `edge` decides which end of the named period it
 * stands for. Returns the instant and the canonical spelling, or a message
 * that says what is wrong.
 */
export function parseHistoricalDate(input: string, edge: DateBoundEdge): HistoricalDateParse {
  const trimmed = input.trim().replace(/\s+/g, ' ')
  const match = HISTORICAL_DATE_PATTERN.exec(trimmed)
  if (!match) {
    return { ok: false, error: 'Write the year first: 1843, 1843-11 or 1843-11-20 (add BCE before 1 CE).' }
  }
  const [, minus, yearText, monthText, dayText, era] = match
  const eraUpper = era?.toUpperCase()
  const isBce = Boolean(minus) || eraUpper === 'BCE' || eraUpper === 'BC'
  if (minus && (eraUpper === 'BCE' || eraUpper === 'BC' || eraUpper === 'CE' || eraUpper === 'AD')) {
    return { ok: false, error: 'Use a minus sign or an era, not both.' }
  }
  const year = Number(yearText)
  if (year === 0) {
    return { ok: false, error: 'There is no year 0: 1 BCE is followed by 1 CE.' }
  }
  const astronomicalYear = isBce ? 1 - year : year
  const month = monthText === undefined ? undefined : Number(monthText)
  const day = dayText === undefined ? undefined : Number(dayText)
  if (month !== undefined && (month < 1 || month > 12)) {
    return { ok: false, error: 'The month must be 01 to 12.' }
  }
  if (month !== undefined && day !== undefined) {
    const check = utcDate(astronomicalYear, month - 1, day)
    if (day < 1 || check.getUTCMonth() !== month - 1) {
      return { ok: false, error: `That month has no day ${day}.` }
    }
  }

  let date: Date
  if (edge === 'start') {
    date = utcDate(astronomicalYear, (month ?? 1) - 1, day ?? 1)
  } else {
    // The last millisecond of the period: the start of the next one, less 1ms.
    const next = day !== undefined
      ? utcDate(astronomicalYear, month! - 1, day + 1)
      : month !== undefined
        ? utcDate(astronomicalYear, month, 1)
        : utcDate(astronomicalYear + 1, 0, 1)
    date = new Date(next.getTime() - 1)
  }
  if (Number.isNaN(date.getTime())) {
    return { ok: false, error: 'That date is out of range.' }
  }
  return { ok: true, date, text: formatBound(astronomicalYear, month, day) }
}

/**
 * The canonical spelling of an instant as a bound, the inverse of
 * {@link parseHistoricalDate}: a start on 1 January reads as the year, on the
 * 1st of a month as the month; an end on the last moment of a year or month
 * likewise. Anything else is the full date. Invalid -> ''.
 */
export function formatHistoricalDateBound(value: Date | string | null | undefined, edge: DateBoundEdge): string {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'string') {
    // A typed bound (from a link, say) keeps its own precision: `1843` as an
    // end is the whole year, where Date would read it as 1 January.
    const parsed = parseHistoricalDate(value, edge)
    if (parsed.ok) return parsed.text
  }
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  if (edge === 'end') {
    const next = new Date(date.getTime() + 1)
    const isMidnight = (d: Date) =>
      d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0
    if (isMidnight(next)) {
      if (next.getUTCDate() === 1 && next.getUTCMonth() === 0) return formatBound(next.getUTCFullYear() - 1)
      if (next.getUTCDate() === 1) {
        return formatBound(date.getUTCFullYear(), date.getUTCMonth() + 1)
      }
      return formatBound(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
    }
  } else if (
    date.getUTCHours() === 0 && date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0
  ) {
    if (date.getUTCDate() === 1 && date.getUTCMonth() === 0) return formatBound(date.getUTCFullYear())
    if (date.getUTCDate() === 1) return formatBound(date.getUTCFullYear(), date.getUTCMonth() + 1)
  }
  return formatBound(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

function toInputDate(value: Date | string | null | undefined, edge: DateBoundEdge): string {
  return formatHistoricalDateBound(value, edge)
}

/** A typed bound -> its instant; an empty or unreadable bound is an invalid
 * `Date`, which {@link boundTimestamp} treats as open. */
function fromInputDate(value: string, edge: DateBoundEdge): Date {
  if (!value) return new Date(NaN)
  const parsed = parseHistoricalDate(value, edge)
  return parsed.ok ? parsed.date : new Date(value)
}

/** Store filter shape (`Date` bounds) -> the string-bounded shape `FilterPanel` renders. */
export function toPanelFilters(filters: FilterState): PanelFilterState {
  return {
    dateRange: filters.dateRange
      ? {
          start: toInputDate(filters.dateRange.start, 'start'),
          end: toInputDate(filters.dateRange.end, 'end')
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
          start: fromInputDate(filters.dateRange.start, 'start'),
          end: fromInputDate(filters.dateRange.end, 'end')
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
