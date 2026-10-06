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
export function calculateArcHierarchy(arcs: ArcWithUIState[]): { arcHierarchy: ArcWithUIState[], maxLevel: number } {
  const arcMap = new Map<string, ArcWithUIState>()
  arcs.forEach(arc => arcMap.set(arc.id, arc))

  // Build hierarchy tree
  const rootArcs: ArcWithUIState[] = []
  const childrenMap = new Map<string, ArcWithUIState[]>()

  arcs.forEach(arc => {
    if (!arc.parent_arc_id) {
      rootArcs.push(arc)
    } else {
      if (!childrenMap.has(arc.parent_arc_id)) {
        childrenMap.set(arc.parent_arc_id, [])
      }
      childrenMap.get(arc.parent_arc_id)!.push(arc)
    }
  })

  // Calculate render levels with hierarchy and temporal constraints
  const result: ArcWithUIState[] = []
  let maxLevel = 0

  function processArcLevel(arcsAtLevel: ArcWithUIState[], baseLevel: number, expandedParents: Set<string>) {
    // Sort arcs by start time for consistent positioning
    const sortedArcs = [...arcsAtLevel].sort((a, b) => 
      new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
    )

    // Calculate levels to avoid overlaps within the same hierarchy level
    const levelAssignments = new Map<string, number>()
    
    for (const arc of sortedArcs) {
      let level = baseLevel
      const arcStart = new Date(arc.start_time).getTime()
      const arcEnd = new Date(arc.end_time).getTime()

      // Find first available level that doesn't conflict
      while (true) {
        let conflict = false
        
        for (const [otherArcId, otherLevel] of levelAssignments.entries()) {
          if (otherLevel === level) {
            const otherArc = sortedArcs.find(a => a.id === otherArcId)
            if (otherArc) {
              const otherStart = new Date(otherArc.start_time).getTime()
              const otherEnd = new Date(otherArc.end_time).getTime()
              
              // Check for temporal overlap
              if (!(arcEnd <= otherStart || arcStart >= otherEnd)) {
                conflict = true
                break
              }
            }
          }
        }
        
        if (!conflict) {
          levelAssignments.set(arc.id, level)
          break
        }
        level++
      }

      arc.renderLevel = levelAssignments.get(arc.id)!
      maxLevel = Math.max(maxLevel, arc.renderLevel)
      result.push(arc)

      // Process children if this arc is expanded
      if (arc.isExpanded && childrenMap.has(arc.id)) {
        const children = childrenMap.get(arc.id)!
        const newExpandedParents = new Set(expandedParents)
        newExpandedParents.add(arc.id)
        processArcLevel(children, arc.renderLevel + 1, newExpandedParents)
      }
    }
  }

  // Start with root arcs
  processArcLevel(rootArcs, 0, new Set())

  return { arcHierarchy: result, maxLevel }
}

/**
 * Attaches UI state (contained events, child/parent arcs, duration) to every
 * arc.
 *
 * COST, measured and not hidden: for each arc this scans every event, building
 * two `new Date(...)` per arc-event pair to compare timestamps, and then scans
 * the arc list twice more for its children and its parent. It is O(arcs x
 * events) with the Date parsing dominating: 300 arcs against 10,000 events
 * measured ~1.0s in vitest on the machine this was profiled on, so it degrades
 * with the EVENT count as well as the arc count.
 *
 * It is called on every arc selection and every expand/collapse (see
 * Timeline.tsx), over the FULL arc and event sets: the time window applied to
 * the render does not reduce this input, so windowing does not make clicking
 * cheap. Pre-parsing the timestamps once and indexing the arcs would remove most
 * of the cost; that is a separate piece of work, so this stands as an
 * outstanding limit (see `calculateArcHierarchy` for the arc-count half of it).
 */
export function processArcsWithUIState(
  arcs: Arc[], 
  events: Event[], 
  expandedArcs: Set<string>, 
  selectedElements: Set<string>
): ArcWithUIState[] {
  return arcs.map(arc => {
    const containedEvents = events.filter(event => {
      const eventTime = new Date(event.timestamp).getTime()
      const arcStart = new Date(arc.start_time).getTime()
      const arcEnd = new Date(arc.end_time).getTime()
      return eventTime >= arcStart && eventTime <= arcEnd
    })

    const childArcs = arcs.filter(childArc => childArc.parent_arc_id === arc.id)
    const parentArc = arc.parent_arc_id ? arcs.find(p => p.id === arc.parent_arc_id) || null : null
    
    const duration = new Date(arc.end_time).getTime() - new Date(arc.start_time).getTime()

    return {
      ...arc,
      isExpanded: expandedArcs.has(arc.id),
      isSelected: selectedElements.has(arc.id),
      renderLevel: 0, // Will be calculated in hierarchy
      containedEvents,
      childArcs,
      parentArc,
      eventCount: containedEvents.length,
      duration
    }
  })
}

