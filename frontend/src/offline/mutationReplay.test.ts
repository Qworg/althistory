import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useGlobalStore } from '@/stores/globalStore'
import { clearMutationQueue, enqueueMutation, readMutationQueue } from './mutationQueue'
import {
  HttpMutationError,
  getHttpStatus,
  isRetryableStatus,
  replayMutationQueue,
  type MutationSender,
} from './mutationReplay'

describe('replay failure classification', () => {
  beforeEach(() => {
    localStorage.clear()
    clearMutationQueue()
    useGlobalStore.setState({ isOnline: true, pendingMutationCount: 0, errors: [] })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('treats the retryable statuses as retryable and other client errors as permanent', () => {
    // 401: an expired token while offline is likely and the same write succeeds
    // after signing in. 408/429: the server asked for another attempt later.
    expect(isRetryableStatus(401)).toBe(true)
    expect(isRetryableStatus(408)).toBe(true)
    expect(isRetryableStatus(429)).toBe(true)
    // No HTTP response at all, e.g. the network dropped.
    expect(isRetryableStatus(null)).toBe(true)
    expect(isRetryableStatus(500)).toBe(true)
    expect(isRetryableStatus(503)).toBe(true)

    // Genuine client errors: the server will keep refusing this payload.
    expect(isRetryableStatus(400)).toBe(false)
    expect(isRetryableStatus(403)).toBe(false)
    expect(isRetryableStatus(404)).toBe(false)
    expect(isRetryableStatus(409)).toBe(false)
    expect(isRetryableStatus(410)).toBe(false)
    expect(isRetryableStatus(422)).toBe(false)
  })

  it('reads the status of an APIError-shaped failure', () => {
    expect(getHttpStatus(new HttpMutationError(404, 'nope'))).toBe(404)
    expect(getHttpStatus(new Error('network down'))).toBeNull()
  })

  it.each([401, 408, 429, 500, 503])(
    'keeps a write queued after HTTP %i instead of deleting it',
    async (status) => {
      enqueueMutation({ method: 'POST', url: '/events', body: { id: 'e1' } })
      const send = vi
        .fn<MutationSender>()
        .mockRejectedValue(new HttpMutationError(status, `status ${status}`))

      const result = await replayMutationQueue(send)

      expect(result.replayed).toEqual([])
      // The point of the classification: a retryable status must NOT be treated
      // as a rejection, because surfacing a lost write is not preserving it.
      expect(result.rejected).toEqual([])
      expect(result.retryable).toBe(true)
      expect(readMutationQueue().map((mutation) => mutation.url)).toEqual(['/events'])
      expect(result.remaining).toBe(1)
    },
  )

  it('keeps a write queued after a network failure', async () => {
    enqueueMutation({ method: 'POST', url: '/events', body: { id: 'e1' } })
    const send = vi.fn<MutationSender>().mockRejectedValue(new Error('network down'))

    const result = await replayMutationQueue(send)

    expect(result.rejected).toEqual([])
    expect(result.retryable).toBe(true)
    expect(result.remaining).toBe(1)
  })

  it.each([400, 403, 404, 409, 422])(
    'removes a write the server permanently rejected with HTTP %i',
    async (status) => {
      enqueueMutation({ method: 'POST', url: '/events', body: { id: 'e1' } })
      const onRejected = vi.fn()
      const send = vi.fn<MutationSender>().mockRejectedValue(new HttpMutationError(status, 'no'))

      const result = await replayMutationQueue(send, { onRejected })

      expect(result.rejected).toHaveLength(1)
      expect(result.rejected[0]?.status).toBe(status)
      expect(onRejected).toHaveBeenCalledTimes(1)
      expect(result.retryable).toBe(false)
      expect(result.remaining).toBe(0)
    },
  )

  it('stops at a retryable failure instead of skipping past it', async () => {
    // Three queued writes; the first is delivered, the second fails
    // transiently, the third would succeed. A loop that used `continue` on a
    // transient failure would send the third write and break order; a `break`
    // leaves it queued. Asserting the send count AND the surviving order is what
    // separates the two.
    const first = enqueueMutation({ method: 'POST', url: '/events', body: { id: 'e1' } })
    const second = enqueueMutation({ method: 'POST', url: '/events', body: { id: 'e2' } })
    const third = enqueueMutation({ method: 'POST', url: '/arcs', body: { id: 'a1' } })

    let calls = 0
    const send = vi.fn<MutationSender>().mockImplementation(async () => {
      calls += 1
      // The second attempt (the `e2` create) fails transiently.
      if (calls === 2) throw new HttpMutationError(503, 'temporarily unavailable')
    })

    const result = await replayMutationQueue(send)

    expect(send).toHaveBeenCalledTimes(2)
    expect(result.replayed).toEqual([first.id])
    expect(result.retryable).toBe(true)
    expect(readMutationQueue().map((mutation) => mutation.id)).toEqual([second.id, third.id])
    expect(result.remaining).toBe(2)
  })

  it('does not report a write as replayed when it could not be removed from storage', async () => {
    enqueueMutation({ method: 'POST', url: '/events', body: { id: 'e1' } })
    const send = vi.fn<MutationSender>().mockResolvedValue(undefined)
    const onStorageError = vi.fn()

    // The write reaches the server, but local removal fails: it is still on
    // disk and may be sent again, so it must neither be reported as replayed nor
    // silently dropped.
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('storage blocked', 'SecurityError')
    })

    const result = await replayMutationQueue(send, { onStorageError })

    expect(send).toHaveBeenCalledTimes(1)
    expect(result.replayed).toEqual([])
    expect(result.remaining).toBe(1)
    expect(onStorageError).toHaveBeenCalledTimes(1)
    expect(onStorageError.mock.calls[0]?.[0]).toBeInstanceOf(Error)
  })

  describe('cross-tab Web Locks synchronization', () => {
    it('defers replay when another tab currently holds the replay lock', async () => {
      enqueueMutation({ method: 'POST', url: '/events', body: { id: 'e1' } })
      const send = vi.fn<MutationSender>().mockResolvedValue(undefined)

      // Mock navigator.locks where lock is unavailable (another tab holds it)
      const mockRequest = vi.fn().mockImplementation(async (_name, _options, callback) => {
        return callback(null)
      })
      vi.stubGlobal('navigator', {
        ...navigator,
        locks: { request: mockRequest },
      })

      const result = await replayMutationQueue(send)

      expect(mockRequest).toHaveBeenCalledWith(
        'offline-mutation-replay',
        { ifAvailable: true },
        expect.any(Function)
      )
      // Send must not be called; replay deferred
      expect(send).not.toHaveBeenCalled()
      expect(result.replayed).toEqual([])
      expect(result.retryable).toBe(true)
      expect(result.remaining).toBe(1)
    })

    it('proceeds with replay when the lock is successfully acquired', async () => {
      enqueueMutation({ method: 'POST', url: '/events', body: { id: 'e1' } })
      const send = vi.fn<MutationSender>().mockResolvedValue(undefined)

      const mockLock = { name: 'offline-mutation-replay', mode: 'exclusive' }
      const mockRequest = vi.fn().mockImplementation(async (_name, _options, callback) => {
        return callback(mockLock)
      })
      vi.stubGlobal('navigator', {
        ...navigator,
        locks: { request: mockRequest },
      })

      const result = await replayMutationQueue(send)

      expect(mockRequest).toHaveBeenCalled()
      expect(send).toHaveBeenCalledTimes(1)
      expect(result.replayed).toHaveLength(1)
      expect(result.remaining).toBe(0)
    })
  })
})
