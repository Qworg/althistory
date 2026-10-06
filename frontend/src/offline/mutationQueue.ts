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
 * - Throws `QueueStorageError` when a change could not be persisted, so callers
 *   never report a write as queued when it is not on disk. Nothing is silently
 *   dropped.
 * - Notifies subscribers (used to keep the store's pending count in step),
 *   including when another tab changes the queue (`storage` event).
 *
 * Storage layout
 * --------------
 * One localStorage entry per mutation, keyed
 * `<STORAGE_KEY>.<mutation id>`. Enqueue is a single `setItem` and remove is a
 * single `removeItem`, so neither is a read-modify-write of a shared array: two
 * tabs enqueueing at the same time cannot lose each other's write (which an
 * array read-modify-write can). `sequence` orders entries; a sequence collision
 * across tabs only makes the order of those two writes ambiguous, it does not
 * drop either one. Entries written by the previous array-format version under
 * `MUTATION_QUEUE_STORAGE_KEY` are migrated on read.
 *
 * What this module does NOT do
 * ----------------------------
 * - It does not talk to the server and does not decide retry policy; that is
 *   `mutationReplay.ts`.
 * - It does not resolve conflicts against server state, does not use the
 *   Background Sync API, and does not lock the queue across tabs. Two tabs
 *   replaying at the same time can both send the same queued write; there is no
 *   lock. Writes are not lost by that, but they can be applied twice.
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
  /** Ordering key, assigned by `enqueueMutation`. */
  sequence: number
}

/** Input accepted by `enqueueMutation`; the wire shape minus the assigned fields. */
export type EnqueueMutationInput = MutationRequest

/**
 * The key the array-format queue was stored under (v1). Reads still honour it
 * and migrate its entries to per-mutation keys.
 */
export const MUTATION_QUEUE_STORAGE_KEY = 'althistory.offline-mutation-queue.v1'

/** Prefix for the per-mutation entries that replaced the v1 array. */
export const MUTATION_QUEUE_ENTRY_PREFIX = `${MUTATION_QUEUE_STORAGE_KEY}.`

/**
 * Raised when a queue change could not be persisted (or when there is no
 * storage at all). Callers must surface this: a write that is not on disk is
 * not queued.
 */
export class QueueStorageError extends Error {
  constructor(
    public readonly operation: 'read' | 'enqueue' | 'remove' | 'clear',
    message: string,
    /** The underlying storage failure, when there was one. */
    public readonly storageCause?: unknown,
  ) {
    super(message)
    this.name = 'QueueStorageError'
  }
}

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

function entryKey(id: string): string {
  return `${MUTATION_QUEUE_ENTRY_PREFIX}${id}`
}

/** True for a storage key this module owns (per-mutation entries or the v1 array). */
export function isMutationQueueStorageKey(key: string): boolean {
  return key === MUTATION_QUEUE_STORAGE_KEY || key.startsWith(MUTATION_QUEUE_ENTRY_PREFIX)
}

function isStoredMutation(value: unknown): value is QueuedMutation {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.method === 'string' &&
    typeof candidate.url === 'string' &&
    typeof candidate.enqueuedAt === 'number' &&
    typeof candidate.sequence === 'number'
  )
}

/** A v1 array entry, which predates the `sequence` field. */
interface LegacyQueuedMutation {
  id: string
  method: string
  url: string
  enqueuedAt: number
  body?: unknown
  entityKey?: string
}

function isLegacyStoredMutation(value: unknown): value is LegacyQueuedMutation {
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

function sortQueue(queue: QueuedMutation[]): QueuedMutation[] {
  return [...queue].sort(
    (a, b) =>
      a.sequence - b.sequence ||
      a.enqueuedAt - b.enqueuedAt ||
      a.id.localeCompare(b.id),
  )
}

function listEntryKeys(storage: Storage): string[] {
  const keys: string[] = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (key !== null && key.startsWith(MUTATION_QUEUE_ENTRY_PREFIX)) keys.push(key)
  }
  return keys
}

function parseEntry(storage: Storage, key: string): QueuedMutation | null {
  let raw: string | null
  try {
    raw = storage.getItem(key)
  } catch {
    return null
  }
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (isStoredMutation(parsed)) return parsed
  } catch {
    // fall through: an unreadable entry is dropped below
  }
  // An entry that cannot be parsed can never be replayed; drop it rather than
  // reporting it forever as pending work.
  try {
    storage.removeItem(key)
  } catch {
    /* best effort */
  }
  return null
}

/**
 * Read the queue in FIFO order. Malformed or non-array payloads are treated as
 * empty rather than throwing, so a corrupt entry cannot prevent the app from
 * starting. A v1 array payload is migrated to the per-mutation layout.
 */
export function readMutationQueue(): QueuedMutation[] {
  const storage = getStorage()
  if (!storage) return []

  const byId = new Map<string, QueuedMutation>()
  for (const key of listEntryKeys(storage)) {
    const entry = parseEntry(storage, key)
    if (entry) byId.set(entry.id, entry)
  }

  let legacyRaw: string | null
  try {
    legacyRaw = storage.getItem(MUTATION_QUEUE_STORAGE_KEY)
  } catch {
    legacyRaw = null
  }
  if (legacyRaw !== null) {
    try {
      const parsed: unknown = JSON.parse(legacyRaw)
      if (Array.isArray(parsed)) {
        const legacy = parsed.filter(isLegacyStoredMutation)
        let migratedAll = true
        legacy.forEach((entry, index) => {
          if (byId.has(entry.id)) return
          const migrated: QueuedMutation = {
            id: entry.id,
            method: entry.method as QueuedMutationMethod,
            url: entry.url,
            enqueuedAt: entry.enqueuedAt,
            sequence: index,
          }
          if (entry.body !== undefined) migrated.body = entry.body
          if (entry.entityKey !== undefined) migrated.entityKey = entry.entityKey
          byId.set(entry.id, migrated)
          try {
            storage.setItem(entryKey(entry.id), JSON.stringify(migrated))
          } catch (error) {
            // Keep reading it from the v1 key: nothing is lost, it is just not
            // migrated, so the v1 key must not be deleted below.
            migratedAll = false
            console.error('Failed to migrate an offline mutation queue entry:', error)
          }
        })
        // Only drop the v1 payload once every entry is in the new layout, so a
        // failed migration cannot lose writes.
        if (migratedAll) {
          try {
            storage.removeItem(MUTATION_QUEUE_STORAGE_KEY)
          } catch {
            /* best effort */
          }
        }
      } else {
        try {
          storage.removeItem(MUTATION_QUEUE_STORAGE_KEY)
        } catch {
          /* best effort */
        }
      }
    } catch {
      // Unparseable v1 payload: drop it, it can never be replayed.
      try {
        storage.removeItem(MUTATION_QUEUE_STORAGE_KEY)
      } catch {
        /* best effort */
      }
    }
  }

  return sortQueue([...byId.values()])
}

function requireStorage(operation: QueueStorageError['operation']): Storage {
  const storage = getStorage()
  if (!storage) {
    throw new QueueStorageError(
      operation,
      'Browser storage is unavailable, so the change could not be saved on this device.',
    )
  }
  return storage
}

function notify(queue: QueuedMutation[]): void {
  const snapshot = [...queue]
  listeners.forEach((listener) => listener(snapshot))
}

function setEntry(storage: Storage, entry: QueuedMutation): void {
  try {
    storage.setItem(entryKey(entry.id), JSON.stringify(entry))
  } catch (error) {
    throw new QueueStorageError(
      'enqueue',
      'The browser refused to store the change on this device (storage is full or blocked). The change was NOT saved.',
      { cause: error },
    )
  }
}

/**
 * Append a write to the durable queue. Returns the stored record (including the
 * generated id and enqueue timestamp) only once it is persisted; throws
 * `QueueStorageError` when it is not.
 *
 * The write is a single `setItem` of one entry key, so it cannot lose a
 * concurrent enqueue from another tab.
 */
export function enqueueMutation(input: EnqueueMutationInput): QueuedMutation {
  const storage = requireStorage('enqueue')
  const existing = readMutationQueue()
  const highestSequence = existing.reduce(
    (highest, mutation) => Math.max(highest, mutation.sequence),
    -1,
  )

  const mutation: QueuedMutation = {
    id: createId(),
    method: input.method,
    url: input.url,
    enqueuedAt: Date.now(),
    sequence: highestSequence + 1,
  }
  if (input.body !== undefined) mutation.body = input.body
  if (input.entityKey !== undefined) mutation.entityKey = input.entityKey

  setEntry(storage, mutation)
  notify(readMutationQueue())
  return mutation
}

/**
 * Remove one queued write by id. A no-op if it is already gone. Throws
 * `QueueStorageError` when an existing entry could not be removed, so a caller
 * does not report a delivered write as removed while it is still on disk.
 */
export function removeMutation(id: string): void {
  const storage = requireStorage('remove')
  const key = entryKey(id)
  let present = false
  try {
    present = storage.getItem(key) !== null
  } catch (error) {
    throw new QueueStorageError('remove', 'Could not read the offline queue from storage.', {
      cause: error,
    })
  }
  if (!present) return
  try {
    storage.removeItem(key)
  } catch (error) {
    throw new QueueStorageError(
      'remove',
      'A synced change could not be removed from the offline queue on this device; it may be sent again.',
      { cause: error },
    )
  }
  notify(readMutationQueue())
}

export function getQueuedMutations(): QueuedMutation[] {
  return readMutationQueue()
}

export function getQueueSize(): number {
  return readMutationQueue().length
}

export function clearMutationQueue(): void {
  const storage = requireStorage('clear')
  const keys = [...listEntryKeys(storage), MUTATION_QUEUE_STORAGE_KEY]
  try {
    for (const key of keys) storage.removeItem(key)
  } catch (error) {
    throw new QueueStorageError('clear', 'Could not clear the offline queue in storage.', {
      cause: error,
    })
  }
  notify([])
}

/**
 * Notify subscribers when another tab changes the queue. The `storage` event
 * only fires in tabs other than the writer, so this cannot loop back into the
 * tab that made the change.
 */
function handleStorageEvent(event: StorageEvent): void {
  if (event.key !== null && !isMutationQueueStorageKey(event.key)) return
  notify(readMutationQueue())
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', handleStorageEvent)
}

/**
 * Subscribe to queue changes. The listener is called with a copy of the queue
 * after every enqueue/remove/clear, and after another tab changes the queue.
 * Returns an unsubscribe function.
 */
export function subscribeMutationQueue(listener: QueueListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
