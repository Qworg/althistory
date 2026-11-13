import type { QueryClient } from '@tanstack/react-query'
import type { LiveChange } from '@/types'
import { describeChanges, freshIdsOf, queryRootsFor } from './liveChanges'
import { GRAPH_LIST_CHANNEL } from './liveFeedClient'

/** What the applier writes to the screen's state; the live store satisfies it. */
export interface LiveChangeSink {
  markFresh(items: Array<{ type: 'event' | 'arc' | 'relationship' | 'pressure'; id: string }>): void
  addNotices(messages: string[]): void
}

export interface LiveChangeApplierOptions {
  queryClient: QueryClient
  sink: LiveChangeSink
  /** The graph on screen. */
  activeGraphId: () => string | null
  /** This tab's id: changes it made itself are not announced back to it. */
  clientId: string
  /** How long changes are gathered before they are applied. Defaults to 150ms. */
  windowMs?: number
}

/**
 * Applies the changes the feed pushes: invalidates the queries they made stale,
 * highlights what arrived, and says who changed what.
 *
 * Changes are gathered for a short window and applied together, so an agent
 * writing thirty events is a handful of refetches rather than thirty; the
 * window is fixed from the first change, so a steady stream is still applied
 * several times a second.
 *
 * A change this tab made itself is skipped: the edit that made it already
 * refreshed what it touched, and announcing your own edit back to you is noise.
 */
export class LiveChangeApplier {
  private readonly options: LiveChangeApplierOptions
  private batch: LiveChange[] = []
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(options: LiveChangeApplierOptions) {
    this.options = options
  }

  push(change: LiveChange): void {
    if (change.origin !== undefined && change.origin === this.options.clientId) return
    this.batch.push(change)
    if (this.timer === undefined) {
      this.timer = setTimeout(() => this.flush(), this.options.windowMs ?? 150)
    }
  }

  /** What the client holds for a graph (or the graph list) may be stale: read it again. */
  resync(graphId: string): void {
    const { queryClient } = this.options
    const roots =
      graphId === this.options.activeGraphId()
        ? [['graphs'], ['events'], ['arcs'], ['causal'], ['inference']]
        : [['graphs']]
    if (graphId === GRAPH_LIST_CHANNEL) {
      void queryClient.invalidateQueries({ queryKey: ['graphs'] })
      return
    }
    for (const queryKey of roots) void queryClient.invalidateQueries({ queryKey })
  }

  /** Apply what has been gathered. */
  flush(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    const batch = this.batch
    this.batch = []
    if (batch.length === 0) return

    const active = this.options.activeGraphId()
    for (const queryKey of queryRootsFor(batch, active)) {
      void this.options.queryClient.invalidateQueries({ queryKey: [...queryKey] })
    }

    const fresh = batch.filter((change) => change.graphId === active).flatMap(freshIdsOf)
    if (fresh.length > 0) this.options.sink.markFresh(fresh)

    const notices = describeChanges(batch, (graphId) => this.graphName(graphId, active))
    if (notices.length > 0) this.options.sink.addNotices(notices)
  }

  dispose(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    this.batch = []
  }

  private graphName(graphId: string, active: string | null): string {
    const cached = this.options.queryClient.getQueryData<{ name?: string }>(['graphs', 'detail', graphId])
    if (cached?.name) return `“${cached.name}”`
    return graphId === active ? 'this graph' : 'another graph'
  }
}
