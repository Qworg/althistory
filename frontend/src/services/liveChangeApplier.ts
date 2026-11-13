import type { QueryClient } from '@tanstack/react-query'
import type { LiveChange } from '@/types'
import { changesGraphCounts, describeChanges, freshIdsOf, generationNotice, queryRootsFor } from './liveChanges'
import { GRAPH_LIST_CHANNEL } from './liveFeedClient'

/** What the applier writes to the screen's state; the live store satisfies it. */
export interface LiveChangeSink {
  markFresh(items: Array<FreshItem>): void
  addNotices(messages: string[]): void
  /** Say something under a key: a later notice with the same key replaces the earlier one. */
  setNotice(key: string, message: string): void
}

/**
 * The least time between refetches of the graph queries because entities
 * changed. The graph routes are rate-limited per key, and in a local setup the
 * browser and an agent share one key, so a busy writer must not spend the
 * agent's budget on counts nobody is watching closely.
 */
export const GRAPH_COUNTS_REFRESH_MS = 10_000

/**
 * The least time between refetches of one data root (events, arcs, links).
 * Short, so an agent writing a call every second or two appears about as it
 * writes (the issue asks for within about a second); the sustained rate is
 * bounded by `DATA_REFRESHES_PER_MINUTE`, not by this. The first change after
 * a quiet spell refreshes at once; changes inside the interval are covered by
 * one trailing refresh when it ends, so a view is at most this far behind the
 * last change while the minute's budget lasts.
 */
export const DATA_REFRESH_MS = 1_000

/**
 * The same for the pressures, which are derived from everything else and
 * invalidated by every write: they follow the entities at a slower pace.
 */
export const DERIVED_REFRESH_MS = 15_000

/** The query root whose refetch delivers an entity of each type. */
const ROOT_OF_TYPE: Readonly<Record<string, string>> = {
  event: 'events',
  arc: 'arcs',
  relationship: 'causal',
  pressure: 'inference',
}

type FreshItem = { type: 'event' | 'arc' | 'relationship' | 'pressure'; id: string }

/** Items waiting for the refetch that will bring them, and the graph they belong to. */
interface PendingFresh {
  graphId: string
  items: FreshItem[]
}

/** The roots that are derived from the others and refresh at `DERIVED_REFRESH_MS`. */
const DERIVED_ROOTS: ReadonlySet<string> = new Set(['inference'])

/**
 * The most data-root invalidations in any minute, across all roots. The
 * per-root intervals bound each root; this bounds their sum, so a steady
 * stream (an agent writing an event and a link every two seconds, for an
 * hour) leaves the key most of its 60 requests a minute for the person using
 * the page. What the cap holds back is not lost: it is refreshed as soon as
 * the minute makes room.
 */
export const DATA_REFRESHES_PER_MINUTE = 30

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
 * An item is highlighted when the refetch that carries it finishes, not when
 * the change arrives: a refetch held back by the throttle or the minute's
 * budget would otherwise leave the highlight to run out before the item is on
 * screen.
 *
 * A change this tab made itself is applied but not announced or highlighted:
 * announcing your own edit back to you is noise. It still refreshes the data,
 * because the tag that says it is this tab's is one any writer can send.
 *
 * Data refetches are throttled per root (`DATA_REFRESH_MS`, slower for the
 * derived pressures) and across roots (`DATA_REFRESHES_PER_MINUTE`), because
 * every refetch is a request against a rate-limited key.
 */
export class LiveChangeApplier {
  private readonly options: LiveChangeApplierOptions
  private batch: LiveChange[] = []
  private timer: ReturnType<typeof setTimeout> | undefined
  /** When the graph queries were last invalidated, and the pending trailing refresh. */
  private graphsAt = Number.NEGATIVE_INFINITY
  private graphsTimer: ReturnType<typeof setTimeout> | undefined
  /** The same for each data root: when it was last invalidated, and its pending trailing refresh. */
  private readonly roots = new Map<
    string,
    { at: number; timer: ReturnType<typeof setTimeout> | undefined; pending: PendingFresh[] }
  >()
  private disposed = false
  /** When each data-root invalidation of the last minute happened. */
  private spent: number[] = []
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
    const announced = batch.filter((change) => !this.own.has(change))
    // What to highlight, by the root whose refetch brings it.
    const freshByRoot = new Map<string, PendingFresh>()
    if (active !== null) {
      for (const change of announced) {
        if (change.graphId !== active) continue
        for (const item of freshIdsOf(change)) {
          const root = ROOT_OF_TYPE[item.type]
          if (root === undefined) continue
          const group = freshByRoot.get(root) ?? { graphId: active, items: [] }
          group.items.push(item)
          freshByRoot.set(root, group)
        }
      }
    }

    const roots = queryRootsFor(batch, active).map((queryKey) => queryKey[0])
    // A root with items to highlight is refetched even if no rule named it.
    for (const root of freshByRoot.keys()) if (!roots.includes(root)) roots.push(root)
    for (const root of roots) {
      if (root === 'graphs') this.invalidateGraphs()
      else this.invalidateData(root, freshByRoot.get(root))
    }
    if (changesGraphCounts(batch)) this.scheduleGraphCounts()

    const notices = describeChanges(
      announced.filter((change) => change.kind !== 'generation'),
      (graphId) => this.graphName(graphId, active)
    )
    if (notices.length > 0) this.options.sink.addNotices(notices)
    // A run's end is announced once per job: a cancel is published, then
    // corrected when the exact count is known, and the correction replaces the
    // first notice instead of adding a second.
    for (const change of announced) {
      const notice = generationNotice(change)
      if (notice !== null && change.kind === 'generation') this.options.sink.setNotice(`generation:${change.jobId}`, notice)
    }
  }

  /** Refetch a data root now if the root's interval and the minute's budget allow, else when they do. */
  private invalidateData(root: string, fresh?: PendingFresh): void {
    const held = this.roots.get(root) ?? { at: Number.NEGATIVE_INFINITY, timer: undefined, pending: [] }
    this.roots.set(root, held)
    if (fresh) held.pending.push(fresh)
    if (held.timer !== undefined) return
    const interval = DERIVED_ROOTS.has(root) ? DERIVED_REFRESH_MS : DATA_REFRESH_MS
    const attempt = (): void => {
      held.timer = undefined
      const now = Date.now()
      this.spent = this.spent.filter((at) => now - at < 60_000)
      const budgetWait = this.spent.length >= DATA_REFRESHES_PER_MINUTE ? (this.spent[0] ?? now) + 60_000 - now : 0
      const wait = Math.max(held.at + interval - now, budgetWait)
      if (wait > 0) {
        held.timer = setTimeout(attempt, wait)
        return
      }
      held.at = now
      this.spent.push(now)
      const delivering = held.pending
      held.pending = []
      const delivered = (): void => this.highlight(delivering)
      void this.options.queryClient.invalidateQueries({ queryKey: [root] }).then(delivered, delivered)
    }
    attempt()
  }

  /** The refetch that carries these items has finished: highlight those on the graph still on screen. */
  private highlight(groups: PendingFresh[]): void {
    if (this.disposed || groups.length === 0) return
    const active = this.options.activeGraphId()
    const items = groups.filter((group) => group.graphId === active).flatMap((group) => group.items)
    if (items.length > 0) this.options.sink.markFresh(items)
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
    this.disposed = true
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
