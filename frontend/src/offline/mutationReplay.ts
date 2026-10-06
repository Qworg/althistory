/**
 * Replay policy for the offline mutation queue (Req 14.2).
 *
 * Replay is FIFO: the queue is read in enqueue order and each write is sent
 * before the next. The policy for the cases that cannot be solved cleanly is
 * stated here and enforced below.
 *
 * 1. A 4xx rejection is permanent for that payload (the server refused it).
 *    The write is removed from the queue and reported through `onRejected` so
 *    the UI can surface it. It is NOT retried forever, because a 4xx will not
 *    become a success by waiting.
 * 2. A network failure or a 5xx is transient. Replay stops at that write and
 *    leaves it and everything after it queued, in order. Nothing is dropped and
 *    nothing is reported as a rejection; the pending count and the offline
 *    indicator are the signal that work is still outstanding.
 * 3. Same-entity ordering. If a queued write carries an `entityKey` and a 4xx
 *    rejects it, later queued writes with the same `entityKey` are presumed to
 *    depend on the rejected one (e.g. a create followed by an update). They are
 *    skipped and reported through `onRejected` with `skippedDependent: true`
 *    rather than replayed into a guaranteed failure. Writes without an
 *    `entityKey`, or to a different entity, still replay.
 *
 * What this does NOT do
 * ---------------------
 * - No server-side conflict resolution: the server's current state is never
 *   read back, so a queued update can overwrite a newer server-side change
 *   (last write wins by replay order).
 * - No idempotency keys: if the server applied a write but the response was
 *   lost, replay can apply it twice.
 * - No Background Sync API and no cross-tab locking.
 */

import {
  readMutationQueue,
  removeMutation,
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
}

export interface ReplayOptions {
  /** Connectivity check between writes. Defaults to always-online. */
  isOnline?: () => boolean
  onRejected?: (rejected: RejectedMutation) => void
}

/**
 * Replay the durable queue once, in order. Safe to call when the queue is
 * empty. Does not throw for ordinary per-write failures; those are captured in
 * the returned `ReplayResult` (and surfaced via `onRejected`).
 */
export async function replayMutationQueue(
  send: MutationSender,
  options: ReplayOptions = {},
): Promise<ReplayResult> {
  const checkOnline = options.isOnline ?? (() => true)
  const replayed: string[] = []
  const rejected: RejectedMutation[] = []
  const failedEntityKeys = new Set<string>()

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
      rejected.push(rejection)
      removeMutation(mutation.id)
      options.onRejected?.(rejection)
      continue
    }

    try {
      await send(mutation)
      removeMutation(mutation.id)
      replayed.push(mutation.id)
    } catch (error) {
      const status = getHttpStatus(error)
      const message = error instanceof Error ? error.message : String(error)

      if (status !== null && status >= 400 && status < 500) {
        const rejection: RejectedMutation = {
          mutation,
          status,
          message,
          skippedDependent: false,
        }
        rejected.push(rejection)
        removeMutation(mutation.id)
        if (mutation.entityKey !== undefined) failedEntityKeys.add(mutation.entityKey)
        options.onRejected?.(rejection)
        continue
      }

      // Network failure or 5xx: stop this pass, keep this write and the rest in
      // order for a later reconnect. Do not drop, do not report as rejected.
      break
    }
  }

  return { replayed, rejected, remaining: readMutationQueue().length }
}
