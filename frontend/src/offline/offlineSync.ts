/**
 * Offline sync orchestration (Req 14.2).
 *
 * Responsibilities:
 * - Mirror connectivity into the global store (`isOnline`) and surface the
 *   offline transition through the existing `addError` / NotificationCenter
 *   channel rather than a second notification system.
 * - Keep the store's `pendingMutationCount` in step with the durable queue.
 * - Replay the queue in order when connectivity returns, surfacing rejected
 *   writes through `addError`.
 * - Provide `submitMutation`, the offline-aware write path: offline -> enqueue,
 *   online -> send now and let the failure propagate (it is NOT queued).
 *
 * Limits -- this is offline *caching plus ordered replay*, not full offline
 * sync. See `mutationReplay.ts` for the rejection/ordering policy and the list
 * of unsolved cases (no server conflict resolution, no idempotency keys, no
 * Background Sync, no cross-tab lock).
 *
 * Integration status: `submitMutation` replaces a direct API write at a call
 * site. The existing React Query mutation hooks in `@/hooks/useAPI.ts` have not
 * been switched over to it (outside this change's file ownership); until they
 * are, this queue only receives writes from callers that use `submitMutation`.
 */

import { useGlobalStore } from '@/stores/globalStore'
import { isOnline, subscribeConnectivity } from './connectivity'
import {
  enqueueMutation,
  getQueueSize,
  subscribeMutationQueue,
  type MutationRequest,
} from './mutationQueue'
import {
  HttpMutationError,
  replayMutationQueue,
  type MutationSender,
  type RejectedMutation,
  type ReplayResult,
} from './mutationReplay'

export { HttpMutationError }
export type { MutationSender, RejectedMutation, ReplayResult }

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api'

/**
 * Sender that replays one queued write against the API with `fetch`. Reads the
 * same base URL and `auth_token` as `services/api.ts`; uses `fetch` rather than
 * the API client because the client exposes only typed methods, not a generic
 * request. A non-2xx response throws `HttpMutationError(status)`, which the
 * replay policy classifies as permanent (4xx) or transient (5xx).
 */
export function createHttpMutationSender(baseURL: string = API_BASE_URL): MutationSender {
  return async (mutation) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('auth_token') : null
    if (token) headers.Authorization = `Bearer ${token}`

    const response = await fetch(`${baseURL}${mutation.url}`, {
      method: mutation.method,
      headers,
      body: mutation.body === undefined ? undefined : JSON.stringify(mutation.body),
    })

    if (!response.ok) {
      throw new HttpMutationError(
        response.status,
        `${mutation.method} ${mutation.url} failed with status ${response.status}`,
      )
    }
  }
}

export interface SubmitMutationOptions {
  /** Connectivity override, mainly for tests. Defaults to `isOnline()`. */
  isOnline?: () => boolean
  /** Sender used when online. Defaults to the HTTP sender. */
  send?: MutationSender
  onQueued?: (mutationRequest: MutationRequest) => void
}

/**
 * Offline-aware write. Returns `'queued'` when the write was persisted because
 * the device is offline, or `'sent'` when it was sent. When online, a failure
 * propagates to the caller and is NOT queued -- queuing is for offline writes,
 * not a retry bin for every failure.
 */
export async function submitMutation(
  input: MutationRequest,
  options: SubmitMutationOptions = {},
): Promise<'sent' | 'queued'> {
  const checkOnline = options.isOnline ?? isOnline

  if (!checkOnline()) {
    const queued = enqueueMutation(input)
    options.onQueued?.(queued)
    return 'queued'
  }

  const send = options.send ?? createHttpMutationSender()
  await send(input)
  return 'sent'
}

function formatRejection(rejected: RejectedMutation): string {
  const { mutation } = rejected
  if (rejected.skippedDependent) {
    return `Skipped a queued ${mutation.method} ${mutation.url}: an earlier change to the same item was rejected.`
  }
  const status = rejected.status !== null ? ` (HTTP ${rejected.status})` : ''
  return `A queued change (${mutation.method} ${mutation.url}) was rejected by the server${status} and was not synced.`
}

// One replay pass at a time so an `online` event and a startup pass cannot
// interleave and send the same write twice within one pass.
let replayInFlight: Promise<ReplayResult> | null = null

export interface OfflineSyncOptions {
  send?: MutationSender
}

/**
 * Replay the durable queue once and mirror the resulting count into the store.
 * Rejections are surfaced through `addError`; network/5xx failures are left
 * queued silently (the indicator shows the outstanding count).
 */
export function replayQueuedMutations(options: OfflineSyncOptions = {}): Promise<ReplayResult> {
  if (replayInFlight) return replayInFlight

  const send = options.send ?? createHttpMutationSender()
  const pass = replayMutationQueue(send, {
    isOnline,
    onRejected: (rejected) => {
      useGlobalStore.getState().addError({ type: 'network', message: formatRejection(rejected) })
    },
  })
    .catch((error: unknown) => {
      console.error('Offline queue replay threw unexpectedly:', error)
      return { replayed: [], rejected: [], remaining: getQueueSize() } satisfies ReplayResult
    })
    .finally(() => {
      replayInFlight = null
      useGlobalStore.getState().setPendingMutationCount(getQueueSize())
    })

  replayInFlight = pass
  return pass
}

/**
 * Start connectivity tracking and replay-on-reconnect. Call once at app start.
 * Returns a teardown function (used by tests; the app never tears down).
 */
export function startOfflineSync(options: OfflineSyncOptions = {}): () => void {
  const initial = useGlobalStore.getState()
  initial.setOnline(isOnline())
  initial.setPendingMutationCount(getQueueSize())

  const unsubscribeQueue = subscribeMutationQueue(() => {
    useGlobalStore.getState().setPendingMutationCount(getQueueSize())
  })

  const unsubscribeConnectivity = subscribeConnectivity((online) => {
    const state = useGlobalStore.getState()
    const wasOnline = state.isOnline
    state.setOnline(online)

    if (!online && wasOnline) {
      state.addError({
        type: 'network',
        message:
          'You are offline. Changes are stored on this device and can be synced when the connection returns.',
      })
    }

    if (online && !wasOnline) {
      void replayQueuedMutations(options)
    }
  })

  // Pick up anything left from a previous session if we are already online.
  if (isOnline() && getQueueSize() > 0) {
    void replayQueuedMutations(options)
  }

  return () => {
    unsubscribeQueue()
    unsubscribeConnectivity()
  }
}
