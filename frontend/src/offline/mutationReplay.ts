/**
 * Replay policy for the offline mutation queue (Req 14.2).
 *
 * Replay is FIFO: the queue is read in enqueue order and each write is sent
 * before the next. The policy for the cases that cannot be solved cleanly is
 * stated here and enforced below.
 *
 * 1. A permanent rejection is a client error the server will keep refusing for
 *    this payload (400, 403, 404, 409, 410, 422, ...). The write is removed from
 *    the queue and reported through `onRejected` so the UI can surface it. It is
 *    NOT retried forever, because it will not become a success by waiting.
 * 2. A transient failure stays queued, in order, and is retried later:
 *    - a network failure (no HTTP status),
 *    - a 5xx,
 *    - 401 (an expired/absent token: the same write succeeds after signing in),
 *    - 408 and 429 (timeout and rate limit).
 *    The pass stops at that write and leaves it and everything after it queued.
 *    Nothing is dropped and nothing is reported as a rejection. Removal from the
 *    queue is NOT attempted for a transient failure, so 401/408/429 writes are
 *    preserved rather than surfaced as lost.
 * 3. Same-entity ordering. If a queued write carries an `entityKey` and a
 *    permanent rejection removes it, later queued writes with the same
 *    `entityKey` are presumed to depend on the rejected one (e.g. a create
 *    followed by an update). They are skipped and reported through `onRejected`
 *    with `skippedDependent: true` rather than replayed into a guaranteed
 *    failure. Writes without an `entityKey`, or to a different entity, still
 *    replay.
 * 4. If a write was sent but could not be removed from local storage, the entry
 *    stays queued (it may be sent again) and the failure is reported through
 *    `onStorageError`; the pass stops so the rest stays in order. A write is only
 *    counted as `replayed` once it is gone from storage.
 *
 * What this does NOT do
 * ---------------------
 * - No server-side conflict resolution: the server's current state is never
 *   read back, so a queued update can overwrite a newer server-side change
 *   (last write wins by replay order).
 * - No idempotency keys: if the server applied a write but the response was
 *   lost, replay can apply it twice.
 * - No Backoff-After / `Retry-After` honouring: a 429 is retried on the
 *   schedule in `offlineSync.ts`, not on the delay the server asked for.
 * - No Background Sync API and no cross-tab locking.
 */

import {
  readMutationQueue,
  removeMutation,
  QueueStorageError,
  type MutationRequest,
  type QueuedMutation,
} from './mutationQueue'

/** A function that performs one write. Rejects on failure. */
export interface MutationSender {
  (mutation: MutationRequest): Promise<void>
}

/** Error a sender throws when the server answered with a non-2xx status. */
export class HttpMutationError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'HttpMutationError'
  }
}

/** Read an HTTP status from an unknown thrown value, or null when absent. */
export function getHttpStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null
  const candidate = error as { status?: unknown }
  return typeof candidate.status === 'number' ? candidate.status : null
}

/** HTTP statuses that can succeed on a later attempt. */
const RETRYABLE_STATUSES = new Set([401, 408, 429])

/**
 * Whether a failed write should stay queued for a later attempt.
 *
 * `null` means the request never produced an HTTP response (network failure or
 * timeout), which is retryable. 401 (expired token), 408 (request timeout), 429
 * (rate limited) and every 5xx are retryable. Every other 4xx is a permanent
 * rejection for this payload.
 *
 * A retryable failure is NOT a rejection: the write stays in the queue.
 */
export function isRetryableStatus(status: number | null): boolean {
  if (status === null) return true
  if (RETRYABLE_STATUSES.has(status)) return true
  return status >= 500
}

export interface RejectedMutation {
  mutation: QueuedMutation
  status: number | null
  message: string
  /** True when skipped because an earlier write to the same entity was rejected. */
  skippedDependent: boolean
}

export interface ReplayResult {
  /** Ids sent successfully and removed from the queue. */
  replayed: string[]
  /** Writes removed because the server rejected them (or they depended on one). */
  rejected: RejectedMutation[]
  /** Queue length when this pass finished; non-zero means work is still queued. */
  remaining: number
  /**
   * True when the pass stopped early on a retryable failure with work still
   * queued, i.e. another attempt is worthwhile without a reconnect.
   */
  retryable: boolean
}

export interface ReplayOptions {
  /** Connectivity check between writes. Defaults to always-online. */
  isOnline?: () => boolean
  onRejected?: (rejected: RejectedMutation) => void
  /**
   * Called when the queue could not be updated in storage after a write was
   * sent. The write stays queued and may be sent again; that is not a
   * rejection and must be surfaced separately.
   */
  onStorageError?: (error: QueueStorageError) => void
}

function isQueueStorageError(error: unknown): error is QueueStorageError {
  return error instanceof QueueStorageError
}

/**
 * Replay the durable queue once, in order. Safe to call when the queue is
 * empty. Does not throw for ordinary per-write failures; those are captured in
 * the returned `ReplayResult` (and surfaced via `onRejected` /
 * `onStorageError`).
 */
export async function replayMutationQueue(
  send: MutationSender,
  options: ReplayOptions = {},
): Promise<ReplayResult> {
  const checkOnline = options.isOnline ?? (() => true)
  const replayed: string[] = []
  const rejected: RejectedMutation[] = []
  const failedEntityKeys = new Set<string>()
  let retryable = false

  // Snapshot so writes enqueued during replay are not part of this pass.
  const snapshot = readMutationQueue()

  for (const mutation of snapshot) {
    if (!checkOnline()) break

    if (mutation.entityKey !== undefined && failedEntityKeys.has(mutation.entityKey)) {
      const rejection: RejectedMutation = {
        mutation,
        status: null,
        message: 'Skipped: an earlier queued change to the same item was rejected.',
        skippedDependent: true,
      }
      if (!dropFromQueue(mutation, options)) {
        retryable = true
        break
      }
      rejected.push(rejection)
      options.onRejected?.(rejection)
      continue
    }

    try {
      await send(mutation)
    } catch (error) {
      const status = getHttpStatus(error)
      const message = error instanceof Error ? error.message : String(error)

      if (!isRetryableStatus(status)) {
        const rejection: RejectedMutation = {
          mutation,
          status,
          message,
          skippedDependent: false,
        }
        if (!dropFromQueue(mutation, options)) {
          retryable = true
          break
        }
        rejected.push(rejection)
        if (mutation.entityKey !== undefined) failedEntityKeys.add(mutation.entityKey)
        options.onRejected?.(rejection)
        continue
      }

      // Retryable (network, 5xx, 401, 408, 429): stop this pass and keep this
      // write and the rest queued, in order. Do not drop, do not report as
      // rejected, do not attempt removal.
      retryable = true
      break
    }

    if (!dropFromQueue(mutation, options)) {
      // The write was delivered but the queue entry could not be removed, so it
      // is still queued and may be sent again. It is NOT reported as replayed
      // and the rest of the pass stops to preserve order.
      retryable = true
      break
    }
    replayed.push(mutation.id)
  }

  return { replayed, rejected, remaining: readMutationQueue().length, retryable }
}

/**
 * Remove a mutation that has been settled (sent, or permanently rejected) from
 * the queue. Returns false when the removal could not be persisted, after
 * reporting it through `onStorageError`.
 */
function dropFromQueue(mutation: QueuedMutation, options: ReplayOptions): boolean {
  try {
    removeMutation(mutation.id)
    return true
  } catch (error) {
    console.error('Failed to remove a replayed mutation from the offline queue:', error)
    if (isQueueStorageError(error)) options.onStorageError?.(error)
    return false
  }
}
