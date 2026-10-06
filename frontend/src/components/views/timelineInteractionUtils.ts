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

/** True when the inclusive window `[innerStart, innerEnd]` fits inside `[outerStart, outerEnd]`. */
function windowContains(
  outerStart: string | Date,
  outerEnd: string | Date,
  innerStart: string | Date,
  innerEnd: string | Date
): boolean {
  return toMs(innerStart) >= toMs(outerStart) && toMs(innerEnd) <= toMs(outerEnd)
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

/**
 * Direct child arcs of `arc` that currently sit inside it but would fall
 * outside `newBounds`.
 *
 * The hierarchy invariant is that a child arc's window is contained by its
 * parent's (see `processArcsWithUIState` / `calculateArcHierarchy`). A resize
 * that breaks it is the arc-level mirror of shrinking past a contained event,
 * so it is rejected for the same reason: it would silently rewrite the
 * hierarchy with no record of intent. Only children that are inside the arc
 * today are reported, so pre-existing data that already violates the invariant
 * cannot block an unrelated resize.
 */
export function findExcludedChildArcs(
  arc: Arc,
  newBounds: { start: Date; end: Date },
  arcs: Arc[]
): Arc[] {
  return arcs.filter(
    (child) =>
      child.parent_arc_id === arc.id &&
      child.id !== arc.id &&
      windowContains(arc.start_time, arc.end_time, child.start_time, child.end_time) &&
      !windowContains(newBounds.start, newBounds.end, child.start_time, child.end_time)
  )
}

/**
 * The parent arc `arc` currently fits inside but would escape under
 * `newBounds`, if any. `null` means the resize either has no parent or stays
 * within the parent's window.
 */
export function findEscapedParentArc(
  arc: Arc,
  newBounds: { start: Date; end: Date },
  arcs: Arc[]
): Arc | null {
  if (!arc.parent_arc_id) return null
  const parent = arcs.find((candidate) => candidate.id === arc.parent_arc_id)
  if (!parent) return null
  // Same intent as findExcludedChildArcs: only flag a hierarchy edge that is
  // valid today and would be broken by this resize.
  if (!windowContains(parent.start_time, parent.end_time, arc.start_time, arc.end_time)) {
    return null
  }
  return windowContains(parent.start_time, parent.end_time, newBounds.start, newBounds.end)
    ? null
    : parent
}
