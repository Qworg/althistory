import type { Event, ExtractionResult } from '@/types'
import { historicalYear } from '@/utils/historicalTime'
import { getActiveCalendar } from '@/stores/worldCalendarStore'
import { type WorldCalendarSet, readWorldTimestamp, toInstant } from '@althistory/calendar'

/**
 * The confidence a row needs to start selected. The review's "Select rows
 * with confidence ≥" control starts at the same value, so its count agrees
 * with what is ticked when the review opens.
 */
export const PRESELECT_THRESHOLD = 0.7

export interface HistorySpan {
  start: number
  end: number
}

const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000

/** The span of the graph's events, or null for an empty graph (nothing to compare with). */
export function historySpan(events: readonly Pick<Event, 'timestamp'>[] | undefined): HistorySpan | null {
  const times = (events ?? []).map((event) => toInstant(event.timestamp).getTime()).filter(Number.isFinite)
  if (times.length < 2) return null
  return { start: Math.min(...times), end: Math.max(...times) }
}

/**
 * Whether a date falls well outside the history it would join: more than a
 * decade, or a fifth of the history's own length, beyond either end. A
 * Wikipedia article about the Analytical Engine also recounts a 2010
 * fund-raising campaign; in an 1834–1868 history that row is almost always a
 * mistake to import, so it is flagged and starts unticked.
 */
export function isOutsideSpan(timestamp: string, span: HistorySpan | null, calendar: WorldCalendarSet | null = getActiveCalendar()): boolean {
  if (!span) return false
  // Read as the importer reads it (a reviewer's text too: in a world, its
  // notation), never as `new Date` would guess.
  const read = readWorldTimestamp(calendar, timestamp)
  if (!read) return false
  // Milliseconds, as a number: good to a second even at a million years.
  const time = Number(read.time)
  const margin = Math.max(10 * YEAR_MS, (span.end - span.start) * 0.2)
  return time < span.start - margin || time > span.end + margin
}

/** "1834–1868" (or "835 AR–869 AR" in a world calendar), for the flag on an out-of-span row. */
export function formatSpan(span: HistorySpan): string {
  return `${historicalYear(span.start)}–${historicalYear(span.end)}`
}

/**
 * The review's starting selection. Extractors marked every row selected, so
 * the review began as "untick the junk" and one click on the commit button
 * imported it. A row now starts ticked only when its confidence reaches
 * PRESELECT_THRESHOLD and its date sits within the history it would join.
 * Arcs and links follow the threshold alone.
 */
export function applyReviewDefaults(extraction: ExtractionResult, span: HistorySpan | null): ExtractionResult {
  return {
    ...extraction,
    events: extraction.events.map((event) => ({
      ...event,
      selected: event.confidence >= PRESELECT_THRESHOLD && !isOutsideSpan(event.timestamp, span),
    })),
    arcs: extraction.arcs.map((arc) => ({ ...arc, selected: arc.confidence >= PRESELECT_THRESHOLD })),
    relationships: extraction.relationships.map((relationship) => ({
      ...relationship,
      selected: relationship.confidence >= PRESELECT_THRESHOLD,
    })),
  }
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/**
 * A typed date as the phrase the date reader recognises, or null when it
 * cannot be read: "1862" → "In 1862, ", "1862-05" → "In May 1862, ",
 * "1862-05-03" → "On 3 May 1862, ".
 */
export function datePhrase(input: string): string | null {
  const match = /^\s*(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?\s*$/.exec(input)
  if (!match) return null
  const [, year, month, day] = match
  if (!month) return `In ${year}, `
  const monthName = MONTHS[Number(month) - 1]
  if (!monthName) return null
  if (!day) return `In ${monthName} ${year}, `
  const dayNumber = Number(day)
  if (dayNumber < 1 || dayNumber > 31) return null
  return `On ${dayNumber} ${monthName} ${year}, `
}
