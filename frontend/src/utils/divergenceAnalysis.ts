import { Event, CausalRelationship, GraphCalendar } from '@/types'
import { formatHistoricalDate } from '@/utils/historicalTime'
import { getActiveCalendar } from '@/stores/worldCalendarStore'
import { sameCalendarSet } from '@althistory/calendar'

/**
 * The world calendars of the two graphs compared. Each is the graph's own
 * (`null` for none); left out, the open graph's, which is right only when one
 * of the two is the open graph and the other shares its calendar (a branch).
 */
export interface ComparisonCalendars {
  readonly baseline?: GraphCalendar | null
  readonly counterfactual?: GraphCalendar | null
}

/**
 * The calendar a date in a comparison is shown in. A date from one side (an
 * event only the branch has, or only the baseline) reads in that graph's
 * calendar. A date both share -- the axis, a shared or modified event --
 * reads in their common calendar, or in stored (Gregorian) years when they
 * have different ones: one world's years must never label the other's dates.
 */
export function comparisonCalendar(
  side: 'baseline' | 'counterfactual' | 'both',
  calendars: ComparisonCalendars = {}
): GraphCalendar | null {
  const baseline = calendars.baseline === undefined ? getActiveCalendar() : calendars.baseline
  const counterfactual = calendars.counterfactual === undefined ? getActiveCalendar() : calendars.counterfactual
  if (side === 'baseline') return baseline
  if (side === 'counterfactual') return counterfactual
  return sameCalendarSet(baseline, counterfactual) ? baseline : null
}

/** Which side an item's date belongs to. */
export function comparisonSide(
  status: EventComparisonItem['status'] | DivergenceType
): 'baseline' | 'counterfactual' | 'both' {
  if (status === 'divergent_added' || status === 'event_added') return 'counterfactual'
  if (status === 'baseline_only' || status === 'event_removed') return 'baseline'
  return 'both'
}

export type DivergenceType = 'event_added' | 'event_modified' | 'event_removed' | 'relationship_changed'

export interface PointOfDivergence {
  readonly timestamp: string
  readonly event: Event | null
  readonly type: DivergenceType
  readonly description: string
}

export interface FieldChange {
  readonly field: string
  readonly baselineValue: unknown
  readonly counterfactualValue: unknown
}

export interface EventComparisonItem {
  readonly id: string
  readonly baselineEvent?: Event
  readonly counterfactualEvent?: Event
  readonly status: 'shared' | 'divergent_added' | 'baseline_only' | 'modified'
  readonly timestamp: string
  readonly diffSummary?: string
  readonly changes?: FieldChange[]
}

export interface DivergenceMetrics {
  readonly totalBaselineEvents: number
  readonly totalCounterfactualEvents: number
  readonly sharedEventsCount: number
  readonly divergentEventsCount: number
  readonly baselineOnlyEventsCount: number
  readonly modifiedEventsCount: number
  readonly divergenceRate: number // 0 to 100 percentage
  readonly hasDivergence: boolean
  readonly pointOfDivergence: PointOfDivergence | null
  readonly preDivergenceCount: number
  readonly postDivergenceBaselineCount: number
  readonly postDivergenceCounterfactualCount: number
}

export interface RelationshipComparisonItem {
  readonly id: string
  readonly baselineRel?: CausalRelationship
  readonly counterfactualRel?: CausalRelationship
  readonly status: 'shared' | 'added' | 'removed' | 'weight_changed'
  readonly causeEventId: string
  readonly effectEventId: string
}

/**
 * Determine if two events have differences in their core attributes.
 */
function getEventChanges(base: Event, cf: Event): FieldChange[] {
  const changes: FieldChange[] = []

  if (base.description !== cf.description) {
    changes.push({
      field: 'description',
      baselineValue: base.description,
      counterfactualValue: cf.description,
    })
  }

  if (base.actor !== cf.actor) {
    changes.push({
      field: 'actor',
      baselineValue: base.actor,
      counterfactualValue: cf.actor,
    })
  }

  if (base.target !== cf.target) {
    changes.push({
      field: 'target',
      baselineValue: base.target,
      counterfactualValue: cf.target,
    })
  }

  if (new Date(base.timestamp).getTime() !== new Date(cf.timestamp).getTime()) {
    changes.push({
      field: 'timestamp',
      baselineValue: base.timestamp,
      counterfactualValue: cf.timestamp,
    })
  }

  return changes
}

/**
 * Find the Point of Divergence (PoD): the earliest point in time where the
 * counterfactual timeline deviates from the baseline timeline.
 */
export function findPointOfDivergence(
  items: readonly EventComparisonItem[],
  calendars?: ComparisonCalendars
): PointOfDivergence | null {
  const divergentItems = items.filter(
    item => item.status === 'divergent_added' || item.status === 'modified' || item.status === 'baseline_only'
  )

  if (divergentItems.length === 0) {
    return null
  }

  // Sort divergent items chronologically to pinpoint the earliest deviation
  const sorted = [...divergentItems].sort((a, b) => {
    return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  })

  const earliest = sorted[0]
  if (!earliest) {
    return null
  }
  const timestamp = earliest.timestamp

  if (earliest.status === 'divergent_added') {
    const event = earliest.counterfactualEvent ?? null
    return {
      timestamp,
      event,
      type: 'event_added',
      description: event
        ? `First new counterfactual event: "${event.description}" (${formatHistoricalDate(timestamp, undefined, comparisonCalendar('counterfactual', calendars))})`
        : `New event introduced at ${formatHistoricalDate(timestamp, undefined, comparisonCalendar('counterfactual', calendars))}`,
    }
  }

  if (earliest.status === 'modified') {
    const event = earliest.counterfactualEvent ?? earliest.baselineEvent ?? null
    const changesDesc = earliest.changes?.map(c => c.field).join(', ') ?? 'attributes'
    return {
      timestamp,
      event,
      type: 'event_modified',
      description: `Altered event (${changesDesc}): "${event?.description ?? earliest.id}"`,
    }
  }

  // Baseline only (event was deleted / prevented in counterfactual)
  const event = earliest.baselineEvent ?? null
  return {
    timestamp,
    event,
    type: 'event_removed',
    description: event
      ? `Prevented/omitted event: "${event.description}" (${formatHistoricalDate(timestamp, undefined, comparisonCalendar('baseline', calendars))})`
      : `Event prevented at ${formatHistoricalDate(timestamp, undefined, comparisonCalendar('baseline', calendars))}`,
  }
}

/**
 * Compare baseline and counterfactual event sets to produce a unified diff,
 * divergence metrics, and identify the Point of Divergence.
 */
export function analyzeEventDivergence(
  baselineEvents: readonly Event[],
  counterfactualEvents: readonly Event[],
  /** Each graph's world calendar, for the dates written into the descriptions. */
  calendars?: ComparisonCalendars
): { items: EventComparisonItem[]; metrics: DivergenceMetrics } {
  const baselineMap = new Map<string, Event>()
  baselineEvents.forEach(e => baselineMap.set(e.id, e))

  const cfMap = new Map<string, Event>()
  counterfactualEvents.forEach(e => cfMap.set(e.id, e))

  const items: EventComparisonItem[] = []
  let sharedCount = 0
  let divergentCount = 0
  let baselineOnlyCount = 0
  let modifiedCount = 0

  // 1. Process counterfactual events
  counterfactualEvents.forEach(cfEvent => {
    const baseEvent = baselineMap.get(cfEvent.id)

    if (!baseEvent) {
      // Event unique to counterfactual branch
      divergentCount++
      items.push({
        id: cfEvent.id,
        counterfactualEvent: cfEvent,
        status: 'divergent_added',
        timestamp: cfEvent.timestamp,
        diffSummary: `Added in counterfactual: "${cfEvent.description}"`,
      })
    } else {
      // Event exists in both: check for attribute modifications
      const changes = getEventChanges(baseEvent, cfEvent)
      if (changes.length > 0) {
        modifiedCount++
        items.push({
          id: cfEvent.id,
          baselineEvent: baseEvent,
          counterfactualEvent: cfEvent,
          status: 'modified',
          timestamp: cfEvent.timestamp,
          diffSummary: `Modified fields: ${changes.map(c => c.field).join(', ')}`,
          changes,
        })
      } else {
        sharedCount++
        items.push({
          id: cfEvent.id,
          baselineEvent: baseEvent,
          counterfactualEvent: cfEvent,
          status: 'shared',
          timestamp: cfEvent.timestamp,
          diffSummary: 'Identical across both timelines',
        })
      }
    }
  })

  // 2. Identify baseline events absent from counterfactual
  baselineEvents.forEach(baseEvent => {
    if (!cfMap.has(baseEvent.id)) {
      baselineOnlyCount++
      items.push({
        id: baseEvent.id,
        baselineEvent: baseEvent,
        status: 'baseline_only',
        timestamp: baseEvent.timestamp,
        diffSummary: `Absent from counterfactual: "${baseEvent.description}"`,
      })
    }
  })

  // Sort items chronologically
  items.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

  // Find Point of Divergence
  const pointOfDivergence = findPointOfDivergence(items, calendars)
  const hasDivergence = pointOfDivergence !== null

  // Pre-divergence vs post-divergence counts
  let preDivergenceCount = 0
  let postDivergenceBaselineCount = 0
  let postDivergenceCounterfactualCount = 0

  if (pointOfDivergence) {
    const podTime = new Date(pointOfDivergence.timestamp).getTime()
    baselineEvents.forEach(e => {
      const t = new Date(e.timestamp).getTime()
      if (t < podTime) {
        preDivergenceCount++
      } else {
        postDivergenceBaselineCount++
      }
    })
    counterfactualEvents.forEach(e => {
      const t = new Date(e.timestamp).getTime()
      if (t >= podTime) {
        postDivergenceCounterfactualCount++
      }
    })
  } else {
    preDivergenceCount = sharedCount
  }

  const totalCf = counterfactualEvents.length
  const divergenceRate = totalCf > 0 ? ((divergentCount + modifiedCount) / totalCf) * 100 : 0

  const metrics: DivergenceMetrics = {
    totalBaselineEvents: baselineEvents.length,
    totalCounterfactualEvents: counterfactualEvents.length,
    sharedEventsCount: sharedCount,
    divergentEventsCount: divergentCount,
    baselineOnlyEventsCount: baselineOnlyCount,
    modifiedEventsCount: modifiedCount,
    divergenceRate: Math.round(divergenceRate * 10) / 10,
    hasDivergence,
    pointOfDivergence,
    preDivergenceCount,
    postDivergenceBaselineCount,
    postDivergenceCounterfactualCount,
  }

  return { items, metrics }
}

/**
 * Compare baseline and counterfactual causal relationships.
 */
export function analyzeRelationshipDivergence(
  baselineRels: readonly CausalRelationship[],
  counterfactualRels: readonly CausalRelationship[]
): RelationshipComparisonItem[] {
  const baseMap = new Map<string, CausalRelationship>()
  baselineRels.forEach(r => baseMap.set(r.id, r))

  const cfMap = new Map<string, CausalRelationship>()
  counterfactualRels.forEach(r => cfMap.set(r.id, r))

  const results: RelationshipComparisonItem[] = []

  counterfactualRels.forEach(cfRel => {
    const baseRel = baseMap.get(cfRel.id)
    if (!baseRel) {
      results.push({
        id: cfRel.id,
        counterfactualRel: cfRel,
        status: 'added',
        causeEventId: cfRel.cause_event_id,
        effectEventId: cfRel.effect_event_id,
      })
    } else {
      const weightDiff = Math.abs(baseRel.weight - cfRel.weight) > 0.001
      results.push({
        id: cfRel.id,
        baselineRel: baseRel,
        counterfactualRel: cfRel,
        status: weightDiff ? 'weight_changed' : 'shared',
        causeEventId: cfRel.cause_event_id,
        effectEventId: cfRel.effect_event_id,
      })
    }
  })

  baselineRels.forEach(baseRel => {
    if (!cfMap.has(baseRel.id)) {
      results.push({
        id: baseRel.id,
        baselineRel: baseRel,
        status: 'removed',
        causeEventId: baseRel.cause_event_id,
        effectEventId: baseRel.effect_event_id,
      })
    }
  })

  return results
}
