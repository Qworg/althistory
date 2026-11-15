/**
 * The baseline a branch was forked from, for drawing the branch against it.
 *
 * Plan (Principle 3, "branch without fear": the baseline stays in view while
 * the branch is edited, not only inside the comparison modal):
 *
 *  1. The active graph is a branch when it records a `parentGraphId`. Only then
 *     is anything fetched; on a baseline graph this hook is inert.
 *  2. The parent's metadata (its name, for the label) comes from `useGraph`, and
 *     its events from `GET /events` scoped by the `X-Graph-Id` header
 *     (`apiClient.events.getAll(…, { graphId })`), the same call the comparison
 *     modal makes. The query key starts with `'events'`, so every write and
 *     graph switch that invalidates the event queries refreshes it too.
 *  3. The point of divergence is NOT recomputed here: it is
 *     `analyzeEventDivergence` from `utils/divergenceAnalysis`, the helper
 *     `BranchComparisonModal` and `CounterfactualTimelineCanvas` already use, so
 *     the timeline and the comparison always agree on the date. It runs over the
 *     branch's full (unfiltered) event list, because a filter that hides the
 *     first changed event must not move the divergence.
 *  4. The result is shaped as the Timeline's `ghost` prop:
 *     `{ label: '<parent name>', events, divergence }` (Timeline adds "Baseline: "). The caller
 *     filters `events` with the view's active filters so the ghost and the
 *     branch's own marks answer the same question.
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/services/api'
import { useActiveGraphId, useGraph } from '@/hooks/useGraphs'
import { analyzeEventDivergence, PointOfDivergence } from '@/utils/divergenceAnalysis'
import type { Event, Graph } from '@/types'
import { toInstant } from '@althistory/calendar'

/** The shape of Timeline's `ghost` prop. */
export interface TimelineGhost {
  label: string
  events: Event[]
  divergence?: Date | null
}

/** The baseline's events, matching the view's own `limit: 1000`. */
const BASELINE_EVENT_LIMIT = 1000

export const baselineEventsKey = (graphId: string) =>
  ['events', 'graph', graphId, { limit: BASELINE_EVENT_LIMIT }] as const

export interface BaselineGhostState {
  /** The active graph, when it is a branch; null otherwise. */
  branch: Graph | null
  /** The graph the branch was forked from, once loaded. */
  baseline: Graph | null
  /** The baseline's events (unfiltered); empty until loaded. */
  baselineEvents: Event[]
  /** The earliest point where the branch departs from its baseline. */
  pointOfDivergence: PointOfDivergence | null
  /** The Timeline's `ghost` prop, or undefined when there is nothing to draw. */
  ghost: TimelineGhost | undefined
}

export function useBaselineGhost(branchEvents: readonly Event[]): BaselineGhostState {
  const activeGraphId = useActiveGraphId()
  const { data: activeGraph } = useGraph(activeGraphId)
  const parentId = activeGraph?.parentGraphId ?? null

  const { data: baseline } = useGraph(parentId)
  const { data: baselineEvents } = useQuery({
    queryKey: baselineEventsKey(parentId ?? ''),
    queryFn: () =>
      apiClient.events.getAll({ limit: BASELINE_EVENT_LIMIT }, { graphId: parentId! }),
    enabled: !!parentId,
    staleTime: 30_000,
  })

  const pointOfDivergence = useMemo(() => {
    if (!parentId || !baselineEvents) return null
    return analyzeEventDivergence(baselineEvents, branchEvents).metrics.pointOfDivergence
  }, [parentId, baselineEvents, branchEvents])

  const ghost = useMemo<TimelineGhost | undefined>(() => {
    if (!parentId || !baseline || !baselineEvents) return undefined
    return {
      // The bare name: Timeline composes "Baseline: <label>" and "Branch of <label>"
      label: baseline.name,
      events: baselineEvents,
      divergence: pointOfDivergence ? toInstant(pointOfDivergence.timestamp) : null,
    }
  }, [parentId, baseline, baselineEvents, pointOfDivergence])

  return {
    branch: parentId && activeGraph ? activeGraph : null,
    baseline: parentId ? baseline ?? null : null,
    baselineEvents: baselineEvents ?? [],
    pointOfDivergence,
    ghost,
  }
}
