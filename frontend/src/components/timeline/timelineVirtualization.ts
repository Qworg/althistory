import { Event, TimeRange } from '@/types'

/**
 * Time-axis windowing for the timeline.
 *
 * The timeline maps a time domain to pixels; a mark whose time lies outside
 * that domain is drawn off-screen (d3 scales happily extrapolate) and is
 * invisible under the clip path. Windowing drops those marks from the React
 * tree so the rendered node count tracks the span the user is looking at
 * rather than the size of the dataset.
 *
 * This is pure calculation only (ADR-001 Tier 1): it returns filtered arrays
 * and never touches the DOM. The caller keeps rendering marks with React.
 */

/** An inclusive time interval, in the same units as the x scale domain. */
export interface TimeWindow {
  start: Date
  end: Date
}

/**
 * How far beyond each edge of the visible span marks are still rendered,
 * as a fraction of that visible span.
 *
 * The window is always `visibleSpan * (1 + 2 * overscan)` wide, so the number
 * of marks it admits depends on the zoom level, not on the dataset size. An
 * overscan of 0.5 keeps one extra viewport-width of marks split across the two
 * edges, which is enough that a modest pan does not immediately mount/unmount
 * the marks at the edge.
 */
export const WINDOW_OVERSCAN_FRACTION = 0.5

/**
 * Expands a visible range into the window of marks to render.
 *
 * When the range has non-finite bounds the range is returned unchanged:
 * windowing is then a no-op rather than dropping every mark.
 */
export function computeTimeWindow(
  range: TimeRange,
  overscanFraction: number = WINDOW_OVERSCAN_FRACTION
): TimeWindow {
  const startMs = range.start.getTime()
  const endMs = range.end.getTime()
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return { start: range.start, end: range.end }
  }
  const overscan = Math.max(0, endMs - startMs) * Math.max(0, overscanFraction)
  return { start: new Date(startMs - overscan), end: new Date(endMs + overscan) }
}

/**
 * Whether an event's timestamp falls inside the window.
 *
 * An unparseable timestamp is kept. Such an event has no position on the time
 * axis to cull against, and culling it would silently discard data; leaving it
 * rendered matches the behaviour before windowing existed.
 */
export function isEventInWindow(event: Event, window: TimeWindow): boolean {
  const timestamp = new Date(event.timestamp).getTime()
  if (!Number.isFinite(timestamp)) return true
  return timestamp >= window.start.getTime() && timestamp <= window.end.getTime()
}

/**
 * Whether an arc's interval overlaps the window.
 *
 * Overlap (not containment) is the test: an arc that starts before and ends
 * after the viewport is on screen for its whole width. Unparseable bounds are
 * kept for the same reason as events.
 */
export function isArcInWindow(arc: { start_time: string; end_time: string }, window: TimeWindow): boolean {
  const start = new Date(arc.start_time).getTime()
  const end = new Date(arc.end_time).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end)) return true
  return start <= window.end.getTime() && end >= window.start.getTime()
}

/** Events inside (or just outside) the window. */
export function filterEventsInWindow(events: Event[], window: TimeWindow): Event[] {
  return events.filter(event => isEventInWindow(event, window))
}

/**
 * Arcs whose interval overlaps the window. Generic over the element type so the
 * hierarchy's `ArcWithUIState` entries keep their UI fields.
 */
export function filterArcsInWindow<T extends { start_time: string; end_time: string }>(
  arcs: T[],
  window: TimeWindow
): T[] {
  return arcs.filter(arc => isArcInWindow(arc, window))
}
