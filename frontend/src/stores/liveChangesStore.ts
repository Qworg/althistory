import { create } from 'zustand'
import type { ChangedEntityType } from '@/types'
import type { LiveFeedStatus } from '@/services/liveFeedClient'
import { FRESH_MS } from '@/services/liveChanges'

/**
 * What the live change feed leaves on screen: whether it is connected, which
 * items arrived a moment ago (they are highlighted), and the notices that say
 * who changed what.
 *
 * Whether live sync is wanted is a preference, kept in the browser. It is on
 * unless the person turned it off.
 */

const PREFERENCE_KEY = 'althistory.liveSync'

/** Live sync is on by default; only an explicit "off" turns it off. */
export function readLiveSyncPreference(): boolean {
  try {
    return localStorage.getItem(PREFERENCE_KEY) !== 'off'
  } catch {
    return true
  }
}

function writeLiveSyncPreference(enabled: boolean): void {
  try {
    if (enabled) localStorage.removeItem(PREFERENCE_KEY)
    else localStorage.setItem(PREFERENCE_KEY, 'off')
  } catch {
    // The choice lasts until the page is closed.
  }
}

/** A line telling who changed what, shown for a few seconds. */
export interface LiveNotice {
  id: string
  message: string
  at: number
}

type FreshKind = 'event' | 'arc' | 'relationship'

interface FreshMap {
  event: Record<string, number>
  arc: Record<string, number>
  relationship: Record<string, number>
}

interface LiveChangesState {
  enabled: boolean
  /** Bumped to make the feed start again, after it gave up (`error`). */
  retries: number
  status: LiveFeedStatus
  /** Why the feed is in `error` or `reconnecting`, for the tooltip. */
  detail: string | null
  /** Items that arrived a moment ago, by id, with when their highlight ends. */
  fresh: FreshMap
  notices: LiveNotice[]

  setEnabled: (enabled: boolean) => void
  /** Try the connection again, now. */
  retry: () => void
  setStatus: (status: LiveFeedStatus, detail?: string | null) => void
  /** Highlight items for `FRESH_MS`. */
  markFresh: (items: Array<{ type: ChangedEntityType; id: string }>, now?: number) => void
  addNotices: (messages: string[], now?: number) => void
  dismissNotice: (id: string) => void
}

const EMPTY_FRESH: FreshMap = { event: {}, arc: {}, relationship: {} }

/** The most notices kept at once; the oldest go first. */
const MAX_NOTICES = 4
/** How long a notice stays, unless dismissed. */
export const NOTICE_MS = 9000

let pruneTimer: ReturnType<typeof setTimeout> | undefined
let noticeCounter = 0

function isFreshKind(type: ChangedEntityType): type is FreshKind {
  return type === 'event' || type === 'arc' || type === 'relationship'
}

export const useLiveChangesStore = create<LiveChangesState>((set, get) => {
  /** Drop what has expired, and arrange to do it again when the next item does. */
  const prune = (): void => {
    const now = Date.now()
    const { fresh, notices } = get()
    let changed = false
    let soonest = Infinity
    const next: FreshMap = { event: {}, arc: {}, relationship: {} }
    for (const kind of ['event', 'arc', 'relationship'] as const) {
      for (const [id, until] of Object.entries(fresh[kind])) {
        if (until > now) {
          next[kind][id] = until
          soonest = Math.min(soonest, until)
        } else {
          changed = true
        }
      }
    }
    const liveNotices = notices.filter((notice) => notice.at + NOTICE_MS > now)
    for (const notice of liveNotices) soonest = Math.min(soonest, notice.at + NOTICE_MS)
    if (changed || liveNotices.length !== notices.length) {
      set({ fresh: changed ? next : fresh, notices: liveNotices })
    }
    pruneTimer = undefined
    if (soonest !== Infinity) pruneTimer = setTimeout(prune, Math.max(50, soonest - now + 25))
  }

  const schedulePrune = (): void => {
    if (pruneTimer === undefined) pruneTimer = setTimeout(prune, 100)
  }

  return {
    enabled: readLiveSyncPreference(),
    retries: 0,
    status: 'off',
    detail: null,
    fresh: EMPTY_FRESH,
    notices: [],

    retry: () => set({ retries: get().retries + 1 }),

    setEnabled: (enabled) => {
      writeLiveSyncPreference(enabled)
      set({ enabled })
    },

    setStatus: (status, detail = null) => set({ status, detail }),

    markFresh: (items, now = Date.now()) => {
      const current = get().fresh
      const next: FreshMap = { event: { ...current.event }, arc: { ...current.arc }, relationship: { ...current.relationship } }
      let any = false
      for (const item of items) {
        if (!isFreshKind(item.type)) continue
        next[item.type][item.id] = now + FRESH_MS
        any = true
      }
      if (!any) return
      set({ fresh: next })
      schedulePrune()
    },

    addNotices: (messages, now = Date.now()) => {
      if (messages.length === 0) return
      const added = messages.map((message) => ({ id: `live-${++noticeCounter}`, message, at: now }))
      set({ notices: [...get().notices, ...added].slice(-MAX_NOTICES) })
      schedulePrune()
    },

    dismissNotice: (id) => set({ notices: get().notices.filter((notice) => notice.id !== id) }),
  }
})

/** Test helper: forget everything the feed left behind. */
export function resetLiveChangesStore(): void {
  if (pruneTimer !== undefined) clearTimeout(pruneTimer)
  pruneTimer = undefined
  useLiveChangesStore.setState({
    enabled: readLiveSyncPreference(),
    retries: 0,
    status: 'off',
    detail: null,
    fresh: EMPTY_FRESH,
    notices: [],
  })
}
