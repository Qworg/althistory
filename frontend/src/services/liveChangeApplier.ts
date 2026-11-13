import type { QueryClient } from '@tanstack/react-query'
import type { LiveChange } from '@/types'
import { changesGraphCounts, describeChanges, freshIdsOf, queryRootsFor } from './liveChanges'
import { GRAPH_LIST_CHANNEL } from './liveFeedClient'

/** What the applier writes to the screen's state; the live store satisfies it. */
export interface LiveChangeSink {
  markFresh(items: Array<{ type: 'event' | 'arc' | 'relationship' | 'pressure'; id: string }>): void
  addNotices(messages: string[]): void
}

/**
 * The least time between refetches of the graph queries because entities
 * changed. The graph routes are rate-limited per key, and in a local setup the
 * browser and an agent share one key, so a busy writer must not spend the
 * agent's budget on counts nobody is watching closely.
 */
export const GRAPH_COUNTS_REFRESH_MS = 10_000

/**
 * The least time between refetches of one data root (events, arcs, links,
 * pressures). Every refetch is a request against the browser key's rate limit
 * (60 a minute by default when the entity routes need a key), and one flush
 * refetches several roots, so a stream of writes must not refetch at every
 * flush. The first change refreshes at once; changes inside the interval are
 * covered by one trailing refresh when it ends, so a view is at most this far
 * behind the last change.
 */
export const DATA_REFRESH_MS = 1_000

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
 * A change this tab made itself is applied but not announced or highlighted:
 * announcing your own edit back to you is noise. It still refreshes the data,
 * because the tag that says it is this tab's is one any writer can send.
 *
 * Data refetches are throttled per root (`DATA_REFRESH_MS`), because every
 * refetch is a request against a rate-limited key.
 */
export class LiveChangeApplier {
  private readonly options: LiveChangeApplierOptions
  private batch: LiveChange[] = []
  private timer: ReturnType<typeof setTimeout> | undefined
  /** When the graph queries were last invalidated, and the pending trailing refresh. */
  private graphsAt = Number.NEGATIVE_INFINITY
  private graphsTimer: ReturnType<typeof setTimeout> | undefined
  /** The same for each data root: when it was last invalidated, and its pending trailing refresh. */
  private readonly roots = new Map<string, { at: number; timer: ReturnType<typeof setTimeout> | undefined }>()
  /** Changes this tab made itself: they still refresh the data, but are not announced or highlighted. */
  private readonly own = new WeakSet<LiveChange>()

  constructor(options: LiveChangeApplierOptions) {
    this.options = options
  }

  push(change: LiveChange): void {
    // The origin is a tag any writer can set, so it can say what not to announce
    // or highlight, never what not to refetch: a writer naming this tab's id
    // must not be able to hide its edits from the screen.
    if (change.origin !== undefined && change.origin === this.options.clientId) this.own.add(change)
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
      this.invalidateGraphs()
      return
    }
    for (const queryKey of roots) {
      if (queryKey[0] === 'graphs') this.invalidateGraphs()
      else void queryClient.invalidateQueries({ queryKey })
    }
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
      if (queryKey[0] === 'graphs') this.invalidateGraphs()
      else this.invalidateData(queryKey[0])
    }
    if (changesGraphCounts(batch)) this.scheduleGraphCounts()

    const announced = batch.filter((change) => !this.own.has(change))
    const fresh = announced.filter((change) => change.graphId === active).flatMap(freshIdsOf)
    if (fresh.length > 0) this.options.sink.markFresh(fresh)

    const notices = describeChanges(announced, (graphId) => this.graphName(graphId, active))
    if (notices.length > 0) this.options.sink.addNotices(notices)
  }

  /** Refetch a data root now if it has been a while, else once the interval is over. */
  private invalidateData(root: string): void {
    const held = this.roots.get(root) ?? { at: Number.NEGATIVE_INFINITY, timer: undefined }
    this.roots.set(root, held)
    if (held.timer !== undefined) return
    const run = (): void => {
      held.timer = undefined
      held.at = Date.now()
      void this.options.queryClient.invalidateQueries({ queryKey: [root] })
    }
    const wait = held.at + DATA_REFRESH_MS - Date.now()
    if (wait <= 0) run()
    else held.timer = setTimeout(run, wait)
  }

  /** Refetch the graph queries now, and count it against the throttle. */
  private invalidateGraphs(): void {
    if (this.graphsTimer !== undefined) clearTimeout(this.graphsTimer)
    this.graphsTimer = undefined
    this.graphsAt = Date.now()
    void this.options.queryClient.invalidateQueries({ queryKey: ['graphs'] })
  }

  /** Entities changed: refresh the counts now if it has been a while, else once the wait is over. */
  private scheduleGraphCounts(): void {
    if (this.graphsTimer !== undefined) return
    const wait = this.graphsAt + GRAPH_COUNTS_REFRESH_MS - Date.now()
    if (wait <= 0) this.invalidateGraphs()
    else this.graphsTimer = setTimeout(() => this.invalidateGraphs(), wait)
  }

  dispose(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    if (this.graphsTimer !== undefined) clearTimeout(this.graphsTimer)
    this.graphsTimer = undefined
    for (const held of this.roots.values()) if (held.timer !== undefined) clearTimeout(held.timer)
    this.roots.clear()
    this.batch = []
  }

  private graphName(graphId: string, active: string | null): string {
    const cached = this.options.queryClient.getQueryData<{ name?: string }>(['graphs', 'detail', graphId])
    if (cached?.name) return `“${cached.name}”`
    return graphId === active ? 'this graph' : 'another graph'
  }
}
