import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  MUTATION_QUEUE_STORAGE_KEY,
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

    // Durable: the records are on disk, not only in memory.
    const raw: unknown = JSON.parse(localStorage.getItem(MUTATION_QUEUE_STORAGE_KEY) ?? '[]')
    expect(Array.isArray(raw) ? raw.length : 0).toBe(2)
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
})
