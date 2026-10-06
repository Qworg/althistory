/**
 * Durable offline mutation queue (Req 14.2).
 *
 * A write that cannot reach the server while the device is offline is appended
 * here, persisted in localStorage, and replayed in FIFO order on reconnect by
 * `offlineSync.ts`.
 *
 * What this module does
 * ---------------------
 * - Stores an ordered list of {method, url, body, entityKey} records.
 * - Persists every change synchronously to localStorage so a page reload while
 *   offline does not lose the queue.
 * - Notifies subscribers (used to keep the store's pending count in step).
 *
 * What this module does NOT do
 * ----------------------------
 * - It does not talk to the server and does not decide retry policy; that is
 *   `mutationReplay.ts`.
 * - It does not resolve conflicts against server state, does not use the
 *   Background Sync API, and does not coordinate across tabs. A second tab
 *   opening the same queue sees whatever is in localStorage at read time, but
 *   two tabs replaying concurrently can both attempt the same mutation. There is
 *   no lock.
 */

export type QueuedMutationMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/** The part of a write that the queue stores and a sender replays. */
export interface MutationRequest {
  method: QueuedMutationMethod
  /** Path relative to the API base URL, e.g. `/events`. */
  url: string
  body?: unknown
  /**
   * Optional logical entity this write targets, e.g. `event:abc`. Used by the
   * replay pass to skip later queued writes to an entity whose earlier write was
   * permanently rejected (see `mutationReplay.ts`). When omitted, no dependent
   * skipping happens for this write.
   */
  entityKey?: string
}

export interface QueuedMutation extends MutationRequest {
  id: string
  enqueuedAt: number
}

/** Input accepted by `enqueueMutation`; identical to the wire shape stored. */
export type EnqueueMutationInput = MutationRequest

export const MUTATION_QUEUE_STORAGE_KEY = 'althistory.offline-mutation-queue.v1'

type QueueListener = (queue: QueuedMutation[]) => void

const listeners = new Set<QueueListener>()

function getStorage(): Storage | null {
  try {
    // Accessing localStorage can throw when storage is disabled or blocked.
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

function isQueuedMutation(value: unknown): value is QueuedMutation {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.method === 'string' &&
    typeof candidate.url === 'string' &&
    typeof candidate.enqueuedAt === 'number'
  )
}

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `mutation-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/**
 * Read the queue from storage in FIFO order. Malformed or non-array payloads are
 * treated as an empty queue rather than throwing, so a corrupt entry cannot
 * prevent the app from starting.
 */
export function readMutationQueue(): QueuedMutation[] {
  const storage = getStorage()
  if (!storage) return []
  const raw = storage.getItem(MUTATION_QUEUE_STORAGE_KEY)
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isQueuedMutation)
  } catch {
    return []
  }
}

function writeMutationQueue(queue: QueuedMutation[]): void {
  const storage = getStorage()
  if (storage) {
    try {
      storage.setItem(MUTATION_QUEUE_STORAGE_KEY, JSON.stringify(queue))
    } catch (error) {
      console.error('Failed to persist the offline mutation queue:', error)
    }
  }
  const snapshot = [...queue]
  listeners.forEach((listener) => listener(snapshot))
}

/**
 * Append a write to the durable queue. Returns the stored record (including the
 * generated id and enqueue timestamp) so callers can report it.
 */
export function enqueueMutation(input: EnqueueMutationInput): QueuedMutation {
  const mutation: QueuedMutation = {
    id: createId(),
    method: input.method,
    url: input.url,
    enqueuedAt: Date.now(),
  }
  if (input.body !== undefined) mutation.body = input.body
  if (input.entityKey !== undefined) mutation.entityKey = input.entityKey
  writeMutationQueue([...readMutationQueue(), mutation])
  return mutation
}

/** Remove one queued write by id. A no-op if it is already gone. */
export function removeMutation(id: string): void {
  const queue = readMutationQueue()
  const next = queue.filter((mutation) => mutation.id !== id)
  if (next.length !== queue.length) writeMutationQueue(next)
}

export function getQueuedMutations(): QueuedMutation[] {
  return readMutationQueue()
}

export function getQueueSize(): number {
  return readMutationQueue().length
}

export function clearMutationQueue(): void {
  writeMutationQueue([])
}

/**
 * Subscribe to queue changes. The listener is called with a copy of the queue
 * after every enqueue/remove/clear. Returns an unsubscribe function.
 */
export function subscribeMutationQueue(listener: QueueListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
