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
 * stays, as the previous graph's data does; a graph that cannot be loaded, or
 * no graph at all, has no calendar.
 *
 * Mount once, at the layout.
 */
export function useWorldCalendarSync(): void {
  const activeGraphId = useActiveGraphId()
  const { data: graph, isError } = useGraph(activeGraphId)
  const setCalendar = useWorldCalendarStore((state) => state.setCalendar)

  useEffect(() => {
    if (!activeGraphId || isError) {
      setCalendar(null)
      return
    }
    if (!graph || graph.id !== activeGraphId) return
    setCalendar(graph.calendar ?? null)
  }, [activeGraphId, graph, isError, setCalendar])
}
