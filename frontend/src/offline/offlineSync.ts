/**
 * Offline sync orchestration (Req 14.2).
 *
 * Responsibilities:
 * - Mirror connectivity into the global store (`isOnline`, `syncInProgress`) and
 *   surface the offline transition through the existing `addError` /
 *   NotificationCenter channel rather than a second notification system.
 * - Keep the store's `pendingMutationCount` in step with the durable queue.
 * - Replay the queue in order when connectivity returns, surfacing rejected
 *   writes through `addError`.
 * - Provide `submitMutation`, the offline-aware write path used by the real
 *   mutation hooks (`@/hooks/useAPI.ts`, `@/hooks/useEvents.ts`,
 *   `@/hooks/useArcs.ts`): offline -> persisted in the queue, online -> sent now
 *   with its value returned to the caller.
 *
 * Ordering guarantee
 * ------------------
 * A write is only sent immediately when the device is online, the queue is
 * empty, and no replay pass is in flight. Otherwise it is appended to the queue
 * and sent by the replay pass, in enqueue order. Without that check a fresh
 * write could overtake an earlier queued one (an update reaching the server
 * before the queued create it depends on), so the queue order is the send order.
 *
 * Retry
 * -----
 * A retryable failure (network, 5xx, 401, 408, 429 -- see `mutationReplay.ts`)
 * leaves the write queued. While the app is online, `startOfflineSync` retries
 * with capped exponential backoff instead of waiting for another
 * offline->online transition. Nothing runs when the device is offline.
 *
 * Which writes are covered
 * ------------------------
 * Event, arc, and causal-link create/update/delete through the mutation hooks
 * listed above. Writes that need a server answer the caller cannot reconstruct
 * offline (graph management, import/export jobs, API keys) are NOT queued: they
 * surface as failures. See `README.md` for the full list.
 *
 * Limits -- this is offline *caching plus ordered replay*, not full offline
 * sync. See `mutationReplay.ts` for the rejection/ordering policy. There is no
 * server conflict resolution, no idempotency key, no Background Sync, and no
 * cross-tab lock (two tabs can replay the same queue concurrently; writes are
 * not lost, but they can be applied twice).
 */

import { useGlobalStore } from '@/stores/globalStore'
import { isOnline, subscribeConnectivity } from './connectivity'
import {
  enqueueMutation,
  getQueueSize,
  subscribeMutationQueue,
  QueueStorageError,
  type MutationRequest,
  type QueuedMutation,
} from './mutationQueue'
import {
  HttpMutationError,
  getHttpStatus,
  replayMutationQueue,
  type MutationSender,
  type RejectedMutation,
  type ReplayResult,
} from './mutationReplay'

export { HttpMutationError } from './mutationReplay'
export { QueueStorageError }
export type { MutationSender, RejectedMutation, ReplayResult }

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api'

/**
 * Abort a replayed request that never answers. A hung request would otherwise
 * leave the pass in flight forever, blocking every later pass and every queued
 * write behind it. An abort surfaces as a retryable failure (no HTTP status).
 */
const MUTATION_REQUEST_TIMEOUT_MS = 30000

function requestSignal(): AbortSignal | undefined {
  if (typeof AbortSignal === 'undefined') return undefined
  if (typeof AbortSignal.timeout !== 'function') return undefined
  return AbortSignal.timeout(MUTATION_REQUEST_TIMEOUT_MS)
}

/**
 * Sender that replays one queued write against the API with `fetch`. Reads the
 * same base URL and `auth_token` as `services/api.ts`; uses `fetch` rather than
 * the API client because the client exposes only typed methods, not a generic
 * request. A non-2xx response throws `HttpMutationError(status)`, which the
 * replay policy classifies as retryable or permanent (see `mutationReplay.ts`).
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
      signal: requestSignal(),
    })

    if (!response.ok) {
      throw new HttpMutationError(
        response.status,
        `${mutation.method} ${mutation.url} failed with status ${response.status}`,
      )
    }
  }
}

/**
 * Outcome of an offline-aware write.
 *
 * `sent` carries the value the caller's sender produced (the entity the API
 * returned). `queued` means the write is on this device and will be sent when
 * the connection allows; the caller must not pretend the server accepted it.
 */
export type OfflineWriteOutcome<T> =
  | { delivery: 'sent'; value: T }
  | { delivery: 'queued'; mutation: QueuedMutation }

export function isQueuedWrite<T>(
  outcome: OfflineWriteOutcome<T>,
): outcome is { delivery: 'queued'; mutation: QueuedMutation } {
  return outcome.delivery === 'queued'
}

export interface SubmitMutationOptions<T> {
  /** Connectivity override, mainly for tests. Defaults to `isOnline()`. */
  isOnline?: () => boolean
  /**
   * Performs the write when it can be sent now. Required: a caller that needs
   * the server's answer passes its API call here, and gets it back in
   * `{ delivery: 'sent' }`. The queued request is passed so a generic sender
   * (for example the HTTP sender used by replay) can be used directly.
   */
  send: (request: MutationRequest) => Promise<T>
  onQueued?: (mutationRequest: QueuedMutation) => void
  /** Set false to suppress the "saved on this device" notification (tests). */
  notify?: boolean
}

/**
 * Offline-aware write used by the mutation hooks.
 *
 * - Device offline, or the queue is not empty, or a replay pass is running:
 *   the write is persisted to the durable queue and reported as `queued`. If it
 *   cannot be persisted this throws `QueueStorageError` -- it is never reported
 *   as queued when nothing was stored.
 * - Otherwise the write is sent now. A failure propagates to the caller (queuing
 *   is for writes that could not be attempted, not a retry bin for every
 *   failure) unless the failure is a connectivity failure and the device went
 *   offline during the attempt, in which case the write is queued.
 */
export async function submitMutation<T>(
  input: MutationRequest,
  options: SubmitMutationOptions<T>,
): Promise<OfflineWriteOutcome<T>> {
  const checkOnline = options.isOnline ?? isOnline

  const queueWrite = (): OfflineWriteOutcome<T> => {
    // Throws QueueStorageError when the write is not durable; the caller must
    // surface that instead of reporting a queued write.
    const mutation = enqueueMutation(input)
    options.onQueued?.(mutation)
    const online = checkOnline()
    if (options.notify !== false) {
      // Only claim what is true: while offline the write waits for the
      // connection, while online it waits for the queued work ahead of it.
      notifyQueuedWrite(!online)
    }
    if (online) {
      // A queued write while online means the queue is not empty (ordering) or
      // a pass is running; make sure a pass follows this one.
      requestReplayWhenOnline()
    }
    return { delivery: 'queued', mutation }
  }

  if (!checkOnline()) return queueWrite()

  // Ordering: never send over the top of queued work, and never send while a
  // replay pass is walking the queue.
  if (getQueueSize() > 0 || replayInFlight !== null) return queueWrite()

  try {
    return { delivery: 'sent', value: await options.send(input) }
  } catch (error) {
    if (isConnectivityFailure(error) && !checkOnline()) {
      return queueWrite()
    }
    throw error
  }
}

/**
 * True for a failure that looks like "the request never reached the server"
 * (no HTTP status, or the API client's status-0 network error). Used only
 * together with a fresh offline check, so a 4xx/5xx still propagates.
 */
function isConnectivityFailure(error: unknown): boolean {
  if (error instanceof HttpMutationError) return false
  const status = getHttpStatus(error)
  return status === null || status === 0
}

// ---------------------------------------------------------------------------
// Notifications (existing addError / NotificationCenter channel)
// ---------------------------------------------------------------------------

const OFFLINE_TRANSITION_MESSAGE =
  'You are offline. Event and arc edits are saved on this device and will sync when the connection returns. Other changes (causal links, graph management, import/export, API keys) need a connection and are NOT saved.'

const QUEUED_WRITE_OFFLINE_MESSAGE =
  'This change was saved on this device and will be sent when the connection returns.'

const QUEUED_WRITE_ORDERED_MESSAGE =
  'This change was saved on this device and queued behind earlier unsent changes, so it is sent in order.'

/**
 * Add a notification unless the identical message is already showing, so a
 * burst of offline writes does not stack up identical notices.
 */
function addNotification(message: string): void {
  const { errors, addError } = useGlobalStore.getState()
  if (errors.some((error) => error.message === message)) return
  addError({ type: 'network', message })
}

function notifyQueuedWrite(isOffline: boolean): void {
  addNotification(isOffline ? QUEUED_WRITE_OFFLINE_MESSAGE : QUEUED_WRITE_ORDERED_MESSAGE)
}

function formatRejection(rejected: RejectedMutation): string {
  const { mutation } = rejected
  if (rejected.skippedDependent) {
    return `Skipped a queued ${mutation.method} ${mutation.url}: an earlier change to the same item was rejected.`
  }
  const status = rejected.status !== null ? ` (HTTP ${rejected.status})` : ''
  return `A queued change (${mutation.method} ${mutation.url}) was rejected by the server${status} and was not synced.`
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

// One replay pass at a time so an `online` event, a startup pass and a retry
// cannot interleave and send the same write twice within one pass.
let replayInFlight: Promise<ReplayResult> | null = null

/** Retry scheduling state; only active between `startOfflineSync` and teardown. */
let retryTimer: ReturnType<typeof setTimeout> | null = null
let retryAttempt = 0
let activeSyncOptions: OfflineSyncOptions | null = null

const DEFAULT_RETRY_BASE_DELAY_MS = 2000
const DEFAULT_RETRY_MAX_DELAY_MS = 60000

export interface OfflineSyncOptions {
  send?: MutationSender
  /** First retry delay after a retryable failure. Doubles up to the maximum. */
  retryBaseDelayMs?: number
  /** Ceiling for the retry delay. */
  retryMaxDelayMs?: number
}

function cancelScheduledReplay(): void {
  if (retryTimer !== null) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
}

function nextRetryDelay(): number {
  const base = activeSyncOptions?.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS
  const max = activeSyncOptions?.retryMaxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS
  const delay = Math.min(base * 2 ** retryAttempt, max)
  retryAttempt += 1
  return delay
}

/**
 * Schedule one replay pass. Only active after `startOfflineSync` (so calling
 * `replayQueuedMutations` directly, as the unit tests do, never leaves a timer
 * behind). Nothing is scheduled while the device is offline: the `online` event
 * starts the next pass.
 */
function scheduleReplay(delayMs: number): void {
  const options = activeSyncOptions
  if (options === null) return
  if (!isOnline()) return
  cancelScheduledReplay()
  retryTimer = setTimeout(() => {
    retryTimer = null
    void replayQueuedMutations(options)
  }, delayMs)
}

/**
 * Ask for a pass as soon as possible, e.g. after a write was queued because the
 * queue was not empty. Safe to call when a pass is running.
 */
function requestReplayWhenOnline(): void {
  if (activeSyncOptions === null) return
  if (!isOnline()) return
  if (replayInFlight !== null) return
  if (retryTimer !== null) return
  scheduleReplay(0)
}

/**
 * Replay the durable queue once and mirror the resulting count into the store.
 * Rejections are surfaced through `addError`; retryable failures are left queued
 * (the indicator shows the outstanding count, and `startOfflineSync` schedules
 * the retry).
 */
export function replayQueuedMutations(options: OfflineSyncOptions = {}): Promise<ReplayResult> {
  if (replayInFlight) return replayInFlight

  const send = options.send ?? createHttpMutationSender()
  useGlobalStore.getState().setSyncInProgress(true)
  const pass = replayMutationQueue(send, {
    isOnline,
    onRejected: (rejected) => {
      addNotification(formatRejection(rejected))
    },
    onStorageError: (error) => {
      // The write was sent but is still on disk, so it may be sent again.
      addNotification(error.message)
    },
  })
    .catch((error: unknown) => {
      console.error('Offline queue replay threw unexpectedly:', error)
      return {
        replayed: [],
        rejected: [],
        remaining: getQueueSize(),
        retryable: false,
      } satisfies ReplayResult
    })
    .finally(() => {
      replayInFlight = null
      useGlobalStore.getState().setSyncInProgress(false)
      useGlobalStore.getState().setPendingMutationCount(getQueueSize())
    })

  replayInFlight = pass
  void pass.then((result) => {
    if (activeSyncOptions === null) return
    if (!isOnline() || result.remaining === 0) {
      retryAttempt = 0
      return
    }
    // `retryable` means the pass stopped on a retryable failure; otherwise new
    // writes arrived while the pass was running and want a follow-up pass.
    const delay = result.retryable ? nextRetryDelay() : 0
    scheduleReplay(delay)
  })
  return pass
}

/**
 * Start connectivity tracking, replay-on-reconnect and retry-on-failure. Call
 * once at app start. Returns a teardown function (used by tests; the app never
 * tears down).
 */
export function startOfflineSync(options: OfflineSyncOptions = {}): () => void {
  activeSyncOptions = options
  retryAttempt = 0
  cancelScheduledReplay()

  const initial = useGlobalStore.getState()
  initial.setOnline(isOnline())
  initial.setPendingMutationCount(getQueueSize())
  initial.setSyncInProgress(false)

  const unsubscribeQueue = subscribeMutationQueue(() => {
    // Covers enqueues/removes from this tab and from another tab's `storage`
    // event, so the indicator cannot keep showing a count that is stale.
    useGlobalStore.getState().setPendingMutationCount(getQueueSize())
  })

  const unsubscribeConnectivity = subscribeConnectivity((online) => {
    const state = useGlobalStore.getState()
    const wasOnline = state.isOnline
    state.setOnline(online)

    if (!online && wasOnline) {
      addNotification(OFFLINE_TRANSITION_MESSAGE)
      // Nothing can be sent while offline; drop any pending retry.
      cancelScheduledReplay()
    }

    if (online && !wasOnline) {
      retryAttempt = 0
      void replayQueuedMutations(options)
    }
  })

  // Pick up anything left from a previous session if we are already online.
  if (isOnline() && getQueueSize() > 0) {
    void replayQueuedMutations(options)
  }

  return () => {
    activeSyncOptions = null
    cancelScheduledReplay()
    unsubscribeQueue()
    unsubscribeConnectivity()
  }
}
