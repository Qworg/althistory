import type { Arc, Event } from '@/types'

/**
 * Temporal-constraint helpers for direct-manipulation on the timeline.
 *
 * Arc membership is derived purely from time bounds: an event is contained by
 * an arc when its timestamp lies within the arc's `[start_time, end_time]`
 * window (see `processArcsWithUIState`). The helpers here make that same
 * relationship explicit so drag/resize handlers can validate before writing.
 */

function toMs(value: string | Date): number {
  return new Date(value).getTime()
}

/** True when `value` lies inside the inclusive `[start, end]` window. */
export function isWithinBounds(
  value: string | Date,
  start: string | Date,
  end: string | Date
): boolean {
  const time = toMs(value)
  return time >= toMs(start) && time <= toMs(end)
}

/** Arcs whose window contains the event at its current timestamp. */
export function findContainingArcs(event: Event, arcs: Arc[]): Arc[] {
  return arcs.filter((arc) => isWithinBounds(event.timestamp, arc.start_time, arc.end_time))
}

/**
 * Of the arcs that currently contain the event, the ones the retimed event
 * would fall outside of. An empty result means the move stays inside every
 * containing arc and is therefore valid.
 */
export function findExcludedContainingArcs(
  event: Event,
  newTimestamp: Date,
  arcs: Arc[]
): Arc[] {
  return findContainingArcs(event, arcs).filter(
    (arc) => !isWithinBounds(newTimestamp, arc.start_time, arc.end_time)
  )
}

/**
 * Events currently contained by `arc` that would fall outside `newBounds`.
 * A non-empty result means resizing the arc would silently drop events.
 */
export function findExcludedContainedEvents(
  arc: Arc,
  newBounds: { start: Date; end: Date },
  events: Event[]
): Event[] {
  return events.filter(
    (event) =>
      isWithinBounds(event.timestamp, arc.start_time, arc.end_time) &&
      !isWithinBounds(event.timestamp, newBounds.start, newBounds.end)
  )
}
