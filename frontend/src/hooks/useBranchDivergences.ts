/**
 * Where each branch of the open graph departs from it.
 *
 * The divergence of a branch used to be visible only from inside the branch
 * (the ghost lane) or the comparison modal; on the baseline itself nothing
 * said "a what-if splits off here". This lists the open graph's direct
 * branches with their point of divergence, measured by the same
 * `analyzeEventDivergence` the ghost lane and the comparison use, so all three
 * agree on the date.
 *
 * Each branch's events are one `GET /events` scoped by `X-Graph-Id`, keyed
 * under `'events'` like the ghost's, so writes and graph switches refresh them.
 * Only the first few branches are measured: a marker per branch is the point,
 * and a graph forked dozens of times needs the Graph Manager, not a crowd of
 * diamonds.
 */

import { useMemo } from 'react'
import { useQueries } from '@tanstack/react-query'
import { apiClient } from '@/services/api'
import { useActiveGraphId, useGraphs } from '@/hooks/useGraphs'
import { analyzeEventDivergence } from '@/utils/divergenceAnalysis'
import { branchLabel } from '@/components/graphs/graphTree'
import type { Event, Graph } from '@/types'
import { toInstant } from '@althistory/calendar'

const MAX_MEASURED_BRANCHES = 6
const BRANCH_EVENT_LIMIT = 1000

export interface BranchDivergence {
  branch: Graph
  /** The part of the branch's name that is its own ("Clerks Prevail"). */
  label: string
  /** Where it departs; null while loading or when it has not departed yet. */
  date: Date | null
}

export function useBranchDivergences(baselineEvents: readonly Event[]): BranchDivergence[] {
  const activeGraphId = useActiveGraphId()
  const { data } = useGraphs()
  const graphs = useMemo(() => data?.graphs ?? [], [data])

  const active = useMemo(() => graphs.find((graph) => graph.id === activeGraphId) ?? null, [graphs, activeGraphId])
  const branches = useMemo(
    () =>
      activeGraphId
        ? graphs
            .filter((graph) => graph.parentGraphId === activeGraphId && graph.status !== 'deleted')
            .slice(0, MAX_MEASURED_BRANCHES)
        : [],
    [graphs, activeGraphId]
  )

  const results = useQueries({
    queries: branches.map((branch) => ({
      queryKey: ['events', 'graph', branch.id, { limit: BRANCH_EVENT_LIMIT }] as const,
      queryFn: () => apiClient.events.getAll({ limit: BRANCH_EVENT_LIMIT }, { graphId: branch.id }),
      staleTime: 30_000,
    })),
  })

  // `results` is a new array every render; when its data last changed is what matters.
  const dataKey = results.map((result) => result.dataUpdatedAt).join('|')

  return useMemo(
    () =>
      branches.map((branch, index) => {
        const events = results[index]?.data
        const point = events ? analyzeEventDivergence([...baselineEvents], events).metrics.pointOfDivergence : null
        return {
          branch,
          label: active ? branchLabel(branch, active) : branch.name,
          date: point ? toInstant(point.timestamp) : null,
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dataKey stands for `results`
    [branches, active, baselineEvents, dataKey]
  )
}
