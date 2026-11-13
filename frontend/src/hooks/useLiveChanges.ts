import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api'
import { DEMO_MODE } from '@/demo/flag'
import { CLIENT_ID } from '@/services/clientIdentity'
import { LiveFeedClient } from '@/services/liveFeedClient'
import { LiveChangeApplier } from '@/services/liveChangeApplier'
import { useLiveChangesStore } from '@/stores/liveChangesStore'
import { getWebSocketStreamUrl } from '@/hooks/useStreamingWrite'
import { useActiveGraphId } from '@/hooks/useGraphs'

/**
 * Keeps the app in step with what other writers do to the graph on screen.
 *
 * Mounted once, in the layout. While live sync is on (it is by default), it
 * holds one read-only socket to the server, watches the active graph and the
 * graph list, and applies every change that arrives: the matching queries are
 * invalidated so the timeline, the causal graph and the panels refetch, new
 * items are highlighted for a moment, and a notice says who changed what. A
 * dropped connection is reopened and what was missed is replayed, or the graph
 * is refetched. See `LiveFeedClient` and `LiveChangeApplier`.
 *
 * The in-browser demo has no server, so it never connects.
 */
export function useLiveChanges(): void {
  const queryClient = useQueryClient()
  const activeGraphId = useActiveGraphId()
  const enabled = useLiveChangesStore((state) => state.enabled)
  const retries = useLiveChangesStore((state) => state.retries)
  const clientRef = useRef<LiveFeedClient | null>(null)
  // The applier reads the graph on screen at the moment a batch is applied.
  const activeRef = useRef<string | null>(activeGraphId)
  activeRef.current = activeGraphId

  useEffect(() => {
    if (DEMO_MODE || !enabled) {
      useLiveChangesStore.getState().setStatus('off')
      return
    }
    const store = useLiveChangesStore.getState()
    const applier = new LiveChangeApplier({
      queryClient,
      sink: { markFresh: store.markFresh, addNotices: store.addNotices },
      activeGraphId: () => activeRef.current,
      clientId: CLIENT_ID,
    })
    const client = new LiveFeedClient({
      getToken: (graphId) => apiClient.stream.getToken(graphId, 'feed'),
      urlFor: getWebSocketStreamUrl,
      onChange: (change) => applier.push(change),
      onResync: (graphId) => applier.resync(graphId),
      onStatus: (status, detail) => useLiveChangesStore.getState().setStatus(status, detail ?? null),
      onAccessRevoked: () =>
        useLiveChangesStore
          .getState()
          .addNotices(['Live sync stopped for this graph: this key may no longer read it.']),
    })
    clientRef.current = client
    client.setGraph(activeRef.current)
    client.start()

    // A tab that was in the background may have lost its connection to a sleeping laptop.
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') client.nudge()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onVisible)

    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onVisible)
      applier.dispose()
      client.stop()
      clientRef.current = null
    }
  }, [enabled, retries, queryClient])

  useEffect(() => {
    clientRef.current?.setGraph(activeGraphId)
  }, [activeGraphId])
}
