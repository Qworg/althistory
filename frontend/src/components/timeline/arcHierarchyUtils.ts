import { Arc, Event } from '@/types'
// Re-export formatDuration from shared utilities to avoid duplication
export { formatDuration } from '@/utils/d3Calculations'

// Extended Arc interface for UI state
export interface ArcWithUIState extends Arc {
  isExpanded: boolean
  isSelected: boolean
  renderLevel: number
  containedEvents: Event[]
  childArcs: Arc[]
  parentArc: Arc | null
  eventCount: number
  duration: number
}

/**
 * Assigns a render level to every arc, putting overlapping siblings on
 * different rows.
 *
 * COST, measured and not hidden: arc positions are parsed repeatedly (twice per
 * overlap comparison), the overlap scan walks the whole level-assignment map for
 * each candidate level, and each comparison looks its arc up with a linear
 * `find` in the sorted list. The result is super-linear in the ARC count: 2,000
 * arcs with no events at all measured ~3.0s in vitest on the machine this was
 * profiled on, against ~20ms for 300 arcs. Unlike `processArcsWithUIState` this
 * does not care how many events there are, and windowing cannot help it either,
 * because it runs before the render window is known.
 *
 * Left as-is deliberately: fixing it means pre-parsing the bounds and replacing
 * the nested scan with an indexed interval assignment, which would change the
 * level-assignment code path and needs its own tests. It is reported as an
 * outstanding limit rather than half-done here.
 */
interface ParsedEvent {
  event: Event
  time: number
}

function findStartIndex(events: readonly ParsedEvent[], targetTime: number): number {
  let low = 0
  let high = events.length
  while (low < high) {
    const mid = (low + high) >> 1
    const entry = events[mid]
    if (entry && entry.time < targetTime) {
      low = mid + 1
    } else {
      high = mid
    }
  }
  return low
}

function findEndIndex(events: readonly ParsedEvent[], targetTime: number): number {
  let low = 0
  let high = events.length
  while (low < high) {
    const mid = (low + high) >> 1
    const entry = events[mid]
    if (entry && entry.time <= targetTime) {
      low = mid + 1
    } else {
      high = mid
    }
  }
  return low
}

interface ArcWithTiming {
  arc: ArcWithUIState
  startMs: number
  endMs: number
}

/**
 * Assigns a render level to every arc, putting overlapping siblings on
 * different rows using an indexed interval assignment algorithm ($O(A \log A)$).
 */
export function calculateArcHierarchy(arcs: ArcWithUIState[]): { arcHierarchy: ArcWithUIState[], maxLevel: number } {
  // Pre-parse timestamps and map by arc
  const timingByArc = new Map<ArcWithUIState, ArcWithTiming>()
  for (const arc of arcs) {
    const startMs = new Date(arc.start_time).getTime()
    const endMs = new Date(arc.end_time).getTime()
    timingByArc.set(arc, { arc, startMs, endMs })
  }

  // Build hierarchy tree
  const rootArcs: ArcWithTiming[] = []
  const childrenMap = new Map<string, ArcWithTiming[]>()

  for (const arc of arcs) {
    const timedArc = timingByArc.get(arc)!
    if (!arc.parent_arc_id) {
      rootArcs.push(timedArc)
    } else {
      let children = childrenMap.get(arc.parent_arc_id)
      if (!children) {
        children = []
        childrenMap.set(arc.parent_arc_id, children)
      }
      children.push(timedArc)
    }
  }

  // Calculate render levels with hierarchy and temporal constraints
  const result: ArcWithUIState[] = []
  let maxLevel = 0

  function processArcLevel(arcsAtLevel: ArcWithTiming[], baseLevel: number, expandedParents: Set<string>) {
    // Sort arcs by start time for consistent positioning
    const sortedArcs = [...arcsAtLevel].sort((a, b) => a.startMs - b.startMs)

    // Track the latest end time on each candidate render level to avoid overlaps.
    // In start-time sorted order, an arc only conflicts with a level if its start time < last end time on that level.
    const levelEndTimes = new Map<number, number>()
    
    for (const timedArc of sortedArcs) {
      let level = baseLevel
      while (levelEndTimes.has(level) && timedArc.startMs < levelEndTimes.get(level)!) {
        level++
      }

      levelEndTimes.set(level, timedArc.endMs)
      timedArc.arc.renderLevel = level
      maxLevel = Math.max(maxLevel, level)
      result.push(timedArc.arc)

      // Process children if this arc is expanded
      if (timedArc.arc.isExpanded && childrenMap.has(timedArc.arc.id)) {
        const children = childrenMap.get(timedArc.arc.id)!
        const newExpandedParents = new Set(expandedParents)
        newExpandedParents.add(timedArc.arc.id)
        processArcLevel(children, timedArc.arc.renderLevel + 1, newExpandedParents)
      }
    }
  }

  // Start with root arcs
  processArcLevel(rootArcs, 0, new Set())

  return { arcHierarchy: result, maxLevel }
}

/**
 * Attaches UI state (contained events, child/parent arcs, duration) to every
 * arc using binary search interval querying and O(1) parent/child index lookups.
 */
export function processArcsWithUIState(
  arcs: Arc[], 
  events: Event[], 
  expandedArcs: Set<string>, 
  selectedElements: Set<string>
): ArcWithUIState[] {
  // 1. Index arcs by ID and parent_arc_id to make child and parent lookups O(1)
  const arcsById = new Map<string, Arc>()
  const childrenByParentId = new Map<string, Arc[]>()

  for (const arc of arcs) {
    arcsById.set(arc.id, arc)
    if (arc.parent_arc_id) {
      const children = childrenByParentId.get(arc.parent_arc_id)
      if (children) {
        children.push(arc)
      } else {
        childrenByParentId.set(arc.parent_arc_id, [arc])
      }
    }
  }

  // 2. Pre-parse event timestamps once and sort chronologically for O(log E) interval binary search
  const parsedEvents: ParsedEvent[] = events.map(event => ({
    event,
    time: new Date(event.timestamp).getTime()
  }))
  parsedEvents.sort((a, b) => a.time - b.time)

  return arcs.map(arc => {
    const arcStart = new Date(arc.start_time).getTime()
    const arcEnd = new Date(arc.end_time).getTime()
    const duration = arcEnd - arcStart

    // Binary search for events falling within [arcStart, arcEnd]
    const startIdx = findStartIndex(parsedEvents, arcStart)
    const endIdx = findEndIndex(parsedEvents, arcEnd)
    const containedEvents = parsedEvents.slice(startIdx, endIdx).map(p => p.event)

    const childArcs = childrenByParentId.get(arc.id) || []
    const parentArc = arc.parent_arc_id ? (arcsById.get(arc.parent_arc_id) || null) : null

    return {
      ...arc,
      isExpanded: expandedArcs.has(arc.id),
      isSelected: selectedElements.has(arc.id),
      renderLevel: 0,
      containedEvents,
      childArcs,
      parentArc,
      eventCount: containedEvents.length,
      duration
    }
  })
}

