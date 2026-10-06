import { Event, TimeRange } from '@/types'
import { PressureWithContext } from '@/types/pressure'

/**
 * Time-axis windowing for the timeline.
 *
 * The timeline maps a time domain to pixels; a mark whose time lies outside
 * that domain is drawn off-screen (d3 scales happily extrapolate) and is
 * invisible under the clip path. Windowing drops those marks from the React
 * tree, so zooming in mounts only the marks near the viewport instead of the
 * whole dataset.
 *
 * WHAT THIS DOES NOT DO: it does not bound the mounted count independently of
 * the dataset. The window is the visible span plus overscan, so the number of
 * marks it admits is (marks per unit time) x (window span); for a uniform
 * dataset of N marks spread over the extent that is
 * `N * (1 + 2 * overscan) / k` at zoom k. That shrinks as you zoom in, but it
 * stays proportional to N. d3-zoom is clamped at 20x (Timeline's
 * `scaleExtent`), so the narrowest window is
 * `(1 + 2 * 0.5) / 20 = 1/10` of the data extent and a fully zoomed uniform
 * dataset still mounts roughly N/10 marks. Nothing is culled while the window
 * still covers the whole extent -- nominally up to `1 + 2 * overscan` (2x with
 * the default), and a little earlier when the viewport is not centred inside the
 * extent, since the window is centred on the viewport rather than on the data.
 *
 * A bound that held regardless of zoom would have to aggregate or cluster
 * marks rather than cull off-screen ones, which is not implemented here. Any
 * claim of the form "the count tracks the viewport, not N" is therefore wrong
 * for this module as written; the true statement is "marks outside the window
 * are not mounted", with the one exception documented on `isEventInWindow` /
 * `isArcInWindow`: an unparseable timestamp has no position to compare, so that
 * mark is kept.
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
 * The window is always `visibleSpan * (1 + 2 * overscan)` wide. At zero
 * overscan the window is exactly the viewport, so panning by even one pixel
 * would mount/unmount marks at the edges; 0.5 keeps one extra viewport-width of
 * marks split across the two edges. It is a multiple of the viewport width, not
 * a cap on the number of marks: see the module comment for what that implies.
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

/**
 * Pressures whose affected arcs are still in the window, with `affectedArcs`
 * narrowed to those arcs.
 *
 * This is windowing for the pressure layer, which needs its own pass because
 * the arcs are reached through each pressure: `generatePressureIndicators`
 * renders one DOM group per (pressure, affected arc) pair, so the mounted
 * pressure node count is `pressures x affectedArcs` and would otherwise ignore
 * the viewport entirely and keep scaling with the full arc set.
 *
 * A pressure left with no in-window arcs produces only off-screen indicators,
 * so it is dropped. The same relative bound as events and arcs applies: this
 * culls indicators that cannot be seen, it is not an aggregation pass.
 *
 * Returns the input array unchanged when nothing is dropped, so callers can use
 * it inside a memo without churning identity on every fit-to-view render.
 */
export function filterPressuresInWindow(
  pressures: PressureWithContext[],
  window: TimeWindow
): PressureWithContext[] {
  const result: PressureWithContext[] = []
  for (const pressure of pressures) {
    const arcsInWindow = pressure.affectedArcs.filter(arc => isArcInWindow(arc, window))
    if (arcsInWindow.length === 0) continue
    result.push(
      arcsInWindow.length === pressure.affectedArcs.length
        ? pressure
        : { ...pressure, affectedArcs: arcsInWindow }
    )
  }
  if (result.length === pressures.length && result.every((p, i) => p === pressures[i])) {
    return pressures
  }
  return result
}
