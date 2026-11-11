import { useEffect } from 'react'
import { useActiveGraphId, useGraph } from '@/hooks/useGraphs'
import { useWorldCalendarStore } from '@/stores/worldCalendarStore'

/**
 * Keeps the active world calendar (stores/worldCalendarStore.ts) equal to the
 * calendar of the graph on screen.
 *
 * It follows the same two things the rest of the app follows: the active graph
 * id (which a switch, here or in another tab, changes) and that graph's detail
 * query, which a calendar edit (`useUpdateGraph`) and the reconciler write
 * into. While a newly chosen graph is still loading, the previous calendar
 * stays, as the previous graph's data does. A graph that is gone (404) or
 * could never be loaded, or no graph at all, has no calendar; a failed
 * refetch of a graph already loaded keeps its calendar.
 *
 * Mount once, at the layout.
 */
export function useWorldCalendarSync(): void {
  const activeGraphId = useActiveGraphId()
  const { data: graph, error } = useGraph(activeGraphId)
  const setCalendar = useWorldCalendarStore((state) => state.setCalendar)
  // A failed background refetch (a 429, a 5xx after its retries) leaves the
  // cached graph in place, and so does its calendar: dropping it would
  // relabel every date and remount every view over a transient error. Only a
  // graph that is gone (404) or was never loaded has no calendar.
  const graphGone = error ? isNotFound(error) : false
  const hasGraph = Boolean(graph && graph.id === activeGraphId)

  useEffect(() => {
    if (!activeGraphId || graphGone || (error && !hasGraph)) {
      setCalendar(null)
      return
    }
    if (!graph || graph.id !== activeGraphId) return
    setCalendar(graph.calendar ?? null)
  }, [activeGraphId, graph, error, graphGone, hasGraph, setCalendar])
}

/** Whether a request failed because the graph does not exist (any more): an APIError with status 404. */
function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 404
}
