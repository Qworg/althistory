import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  MUTATION_QUEUE_ENTRY_PREFIX,
  MUTATION_QUEUE_STORAGE_KEY,
  QueueStorageError,
  clearMutationQueue,
  enqueueMutation,
  getQueueSize,
  readMutationQueue,
  removeMutation,
  subscribeMutationQueue,
} from './mutationQueue'

describe('offline mutation queue', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('persists enqueued mutations in FIFO order', () => {
    enqueueMutation({ method: 'POST', url: '/events', body: { id: 'e1' } })
    enqueueMutation({
      method: 'PUT',
      url: '/events/e1',
      body: { description: 'x' },
      entityKey: 'event:e1',
    })

    const queue = readMutationQueue()
    expect(queue.map((mutation) => mutation.url)).toEqual(['/events', '/events/e1'])
    expect(queue[1]?.entityKey).toBe('event:e1')
    expect(getQueueSize()).toBe(2)

    // Durable: the records are on disk under their own keys, not only in memory.
    const entryKeys: string[] = []
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (key?.startsWith(MUTATION_QUEUE_ENTRY_PREFIX)) entryKeys.push(key)
    }
    expect(entryKeys).toHaveLength(2)
    expect(localStorage.getItem(`${MUTATION_QUEUE_ENTRY_PREFIX}${queue[0]?.id}`)).toContain(
      '"sequence"',
    )
  })

  it('keeps FIFO order when an entry is removed and a later one is enqueued', () => {
    // Order has to survive a removal plus a new enqueue: `sequence` is assigned
    // from the queue's current maximum, so an implementation that reused or
    // reset the counter would reorder these.
    const first = enqueueMutation({ method: 'POST', url: '/events', body: { id: 'e1' } })
    const second = enqueueMutation({ method: 'POST', url: '/events', body: { id: 'e2' } })
    const third = enqueueMutation({ method: 'POST', url: '/arcs', body: { id: 'a1' } })

    removeMutation(second.id)
    const fourth = enqueueMutation({
      method: 'PUT',
      url: '/events/e1',
      body: { description: 'x' },
    })

    expect(readMutationQueue().map((mutation) => mutation.id)).toEqual([
      first.id,
      third.id,
      fourth.id,
    ])
    expect(readMutationQueue().map((mutation) => mutation.url)).toEqual([
      '/events',
      '/arcs',
      '/events/e1',
    ])
  })

  it('removes a mutation by id', () => {
    const first = enqueueMutation({ method: 'POST', url: '/events', body: {} })
    enqueueMutation({ method: 'POST', url: '/arcs', body: {} })

    removeMutation(first.id)

    expect(readMutationQueue().map((mutation) => mutation.url)).toEqual(['/arcs'])
  })

  it('clears the queue', () => {
    enqueueMutation({ method: 'DELETE', url: '/events/e1' })
    clearMutationQueue()
    expect(getQueueSize()).toBe(0)
  })

  it('treats a corrupt stored payload as an empty queue', () => {
    localStorage.setItem(MUTATION_QUEUE_STORAGE_KEY, '{not valid json')
    expect(readMutationQueue()).toEqual([])
  })

  it('notifies subscribers on enqueue, remove and clear', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeMutationQueue(listener)

    const mutation = enqueueMutation({ method: 'POST', url: '/events', body: {} })
    removeMutation(mutation.id)

    expect(listener).toHaveBeenCalledTimes(2)
    expect(listener.mock.calls[0]?.[0]).toHaveLength(1)
    expect(listener.mock.calls[1]?.[0]).toHaveLength(0)

    unsubscribe()
    enqueueMutation({ method: 'POST', url: '/arcs', body: {} })
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('reports a failed persist instead of returning an unqueued record', () => {
    // A queue that cannot persist is not durable. `enqueueMutation` must not
    // hand back a record that pretends the write is stored.
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError')
    })

    expect(() => enqueueMutation({ method: 'POST', url: '/events', body: {} })).toThrow(
      QueueStorageError,
    )

    setItem.mockRestore()
    expect(getQueueSize()).toBe(0)
  })

  it('does not lose an entry another tab stored concurrently', () => {
    // Each mutation is its own storage key, so enqueue is a single `setItem`
    // rather than a read-modify-write of a shared array. A second tab's write
    // that lands between our read and our write therefore survives.
    enqueueMutation({ method: 'POST', url: '/events', body: { id: 'ours' } })

    const otherTabEntry = {
      id: 'other-tab',
      method: 'POST',
      url: '/arcs',
      enqueuedAt: Date.now(),
      sequence: 99,
    }
    localStorage.setItem(
      `${MUTATION_QUEUE_ENTRY_PREFIX}${otherTabEntry.id}`,
      JSON.stringify(otherTabEntry),
    )

    expect(readMutationQueue().map((mutation) => mutation.id)).toContain('other-tab')
    expect(getQueueSize()).toBe(2)
  })

  it('notifies subscribers when another tab changes the queue', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeMutationQueue(listener)

    const otherTabEntry = {
      id: 'other-tab',
      method: 'POST',
      url: '/events',
      enqueuedAt: Date.now(),
      sequence: 0,
    }
    localStorage.setItem(
      `${MUTATION_QUEUE_ENTRY_PREFIX}${otherTabEntry.id}`,
      JSON.stringify(otherTabEntry),
    )
    window.dispatchEvent(
      new StorageEvent('storage', { key: `${MUTATION_QUEUE_ENTRY_PREFIX}${otherTabEntry.id}` }),
    )

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0]?.[0]).toHaveLength(1)
    unsubscribe()
  })

  it('ignores storage events for unrelated keys', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeMutationQueue(listener)

    window.dispatchEvent(new StorageEvent('storage', { key: 'auth_token' }))

    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('migrates the v1 array payload to per-mutation entries in order', () => {
    const legacy = [
      { id: 'a', method: 'POST', url: '/events', enqueuedAt: 1, body: { id: 'e1' } },
      {
        id: 'b',
        method: 'PUT',
        url: '/events/e1',
        enqueuedAt: 2,
        body: { description: 'x' },
        entityKey: 'event:e1',
      },
    ]
    localStorage.setItem(MUTATION_QUEUE_STORAGE_KEY, JSON.stringify(legacy))

    expect(readMutationQueue().map((mutation) => mutation.id)).toEqual(['a', 'b'])
    // Migrated, not re-read from the v1 key.
    expect(localStorage.getItem(MUTATION_QUEUE_STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem(`${MUTATION_QUEUE_ENTRY_PREFIX}a`)).not.toBeNull()
    expect(readMutationQueue().map((mutation) => mutation.url)).toEqual(['/events', '/events/e1'])
  })
})
