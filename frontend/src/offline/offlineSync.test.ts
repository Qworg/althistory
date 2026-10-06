import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useGlobalStore } from '@/stores/globalStore'
import * as connectivity from './connectivity'
import {
  QueueStorageError,
  clearMutationQueue,
  enqueueMutation,
  readMutationQueue,
} from './mutationQueue'
import {
  HttpMutationError,
  replayQueuedMutations,
  startOfflineSync,
  submitMutation,
  type MutationSender,
} from './offlineSync'

vi.mock('./connectivity', () => ({
  isOnline: vi.fn(() => true),
  subscribeConnectivity: vi.fn(() => () => {}),
}))

const mockedIsOnline = vi.mocked(connectivity.isOnline)
const mockedSubscribe = vi.mocked(connectivity.subscribeConnectivity)

let connectivityListener: ((online: boolean) => void) | null = null

describe('offline sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    connectivityListener = null
    localStorage.clear()
    clearMutationQueue()
    mockedIsOnline.mockReturnValue(true)
    mockedSubscribe.mockImplementation((listener) => {
      connectivityListener = listener
      return () => {
        connectivityListener = null
      }
    })
    useGlobalStore.setState({
      isOnline: true,
      pendingMutationCount: 0,
      syncInProgress: false,
      errors: [],
    })
  })

  afterEach(() => {
    connectivityListener = null
  })

  it('queues writes while offline and replays them in order on reconnect', async () => {
    mockedIsOnline.mockReturnValue(false)
    const send = vi.fn<MutationSender>().mockResolvedValue(undefined)
    const stop = startOfflineSync({ send })

    const first = await submitMutation(
      { method: 'POST', url: '/events', body: { id: 'e1' } },
      { isOnline: mockedIsOnline, send },
    )
    const second = await submitMutation(
      { method: 'PUT', url: '/events/e1', body: { description: 'x' } },
      { isOnline: mockedIsOnline, send },
    )

    expect(first.delivery).toBe('queued')
    expect(second.delivery).toBe('queued')
    expect(readMutationQueue().map((mutation) => mutation.url)).toEqual([
      '/events',
      '/events/e1',
    ])
    expect(send).not.toHaveBeenCalled()
    expect(useGlobalStore.getState().pendingMutationCount).toBe(2)

    mockedIsOnline.mockReturnValue(true)
    connectivityListener?.(true)

    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2))
    expect(send.mock.calls[0]?.[0]).toMatchObject({ method: 'POST', url: '/events' })
    expect(send.mock.calls[1]?.[0]).toMatchObject({ method: 'PUT', url: '/events/e1' })
    expect(readMutationQueue()).toHaveLength(0)
    await vi.waitFor(() => expect(useGlobalStore.getState().pendingMutationCount).toBe(0))

    stop()
  })

  it('does not queue a write that fails while online', async () => {
    mockedIsOnline.mockReturnValue(true)
    const send = vi.fn<MutationSender>().mockRejectedValue(new Error('server exploded'))

    await expect(
      submitMutation(
        { method: 'POST', url: '/events', body: { id: 'e1' } },
        { isOnline: mockedIsOnline, send },
      ),
    ).rejects.toThrow('server exploded')

    expect(readMutationQueue()).toHaveLength(0)
    expect(useGlobalStore.getState().pendingMutationCount).toBe(0)
  })

  it('does not let a fresh write overtake queued work', async () => {
    // The queue is not empty and the device is online: sending the new write
    // immediately would let it reach the server before the queued create it may
    // depend on. It must be appended instead.
    mockedIsOnline.mockReturnValue(false)
    const send = vi.fn<MutationSender>().mockResolvedValue(undefined)
    const stop = startOfflineSync({ send })

    await submitMutation(
      { method: 'POST', url: '/events', body: { id: 'e1' } },
      { isOnline: mockedIsOnline, send },
    )

    mockedIsOnline.mockReturnValue(true)
    const fresh = await submitMutation(
      { method: 'PUT', url: '/events/e1', body: { description: 'x' } },
      { isOnline: mockedIsOnline, send },
    )

    expect(fresh.delivery).toBe('queued')
    // The notice must describe the real reason: online, waiting for the queue
    // ahead of it, not "waiting for the connection".
    expect(
      useGlobalStore
        .getState()
        .errors.some((error) => error.message.includes('queued behind earlier unsent changes')),
    ).toBe(true)
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2))
    expect(send.mock.calls.map(([mutation]) => mutation.url)).toEqual(['/events', '/events/e1'])

    stop()
  })

  it('queues a write that arrives while a replay pass is in flight', async () => {
    mockedIsOnline.mockReturnValue(false)
    // Only the first send is held open, so the pass really is in flight while
    // the next write is submitted.
    let releaseFirst: () => void = () => {}
    const firstSendGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const send = vi.fn<MutationSender>().mockImplementation(async (mutation) => {
      if (mutation.url === '/events') await firstSendGate
    })
    const stop = startOfflineSync({ send })

    await submitMutation(
      { method: 'POST', url: '/events', body: { id: 'e1' } },
      { isOnline: mockedIsOnline, send },
    )

    mockedIsOnline.mockReturnValue(true)
    const replay = replayQueuedMutations({ send })
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))

    try {
      const whileSyncing = await submitMutation(
        { method: 'POST', url: '/arcs', body: { id: 'a1' } },
        { isOnline: mockedIsOnline, send },
      )

      expect(whileSyncing.delivery).toBe('queued')
      // The in-flight write is still in the queue and the new one is appended
      // behind it: no overtake.
      expect(send).toHaveBeenCalledTimes(1)
      expect(readMutationQueue().map((mutation) => mutation.url)).toEqual(['/events', '/arcs'])
    } finally {
      // Always release the held send, so a failing assertion cannot leave a
      // replay pass pending for the tests that follow.
      releaseFirst()
    }

    await replay
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2))
    expect(send.mock.calls.map(([mutation]) => mutation.url)).toEqual(['/events', '/arcs'])

    stop()
  })

  it('reports a write that could not be persisted instead of claiming it is queued', async () => {
    mockedIsOnline.mockReturnValue(false)
    const send = vi.fn<MutationSender>().mockResolvedValue(undefined)
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })

    await expect(
      submitMutation(
        { method: 'POST', url: '/events', body: { id: 'e1' } },
        { isOnline: mockedIsOnline, send },
      ),
    ).rejects.toThrow(QueueStorageError)

    setItem.mockRestore()
    expect(readMutationQueue()).toHaveLength(0)
    expect(useGlobalStore.getState().pendingMutationCount).toBe(0)
  })

  it('retries a transient failure while online, without another connectivity event', async () => {
    mockedIsOnline.mockReturnValue(false)
    let attempts = 0
    const send = vi.fn<MutationSender>().mockImplementation(async () => {
      attempts += 1
      if (attempts === 1) throw new HttpMutationError(503, 'service unavailable')
    })
    const stop = startOfflineSync({ send, retryBaseDelayMs: 5, retryMaxDelayMs: 20 })

    await submitMutation(
      { method: 'POST', url: '/events', body: { id: 'e1' } },
      { isOnline: mockedIsOnline, send },
    )

    mockedIsOnline.mockReturnValue(true)
    connectivityListener?.(true)

    // The first pass fails transiently; the retry must come from the scheduled
    // retry, not from a reload or a second offline->online transition.
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(readMutationQueue()).toHaveLength(0))
    expect(connectivityListener).not.toBeNull()

    stop()
  })

  it('surfaces a rejected replay instead of dropping it silently', async () => {
    enqueueMutation({ method: 'POST', url: '/events', body: { id: 'e1' } })
    const send = vi
      .fn<MutationSender>()
      .mockRejectedValue(new HttpMutationError(422, 'invalid payload'))

    const result = await replayQueuedMutations({ send })

    expect(result.rejected).toHaveLength(1)
    expect(result.remaining).toBe(0)

    const errors = useGlobalStore.getState().errors
    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toContain('rejected')
    expect(errors[0]?.message).toContain('/events')

    // A permanently rejected write is not retained for an endless retry loop.
    expect(readMutationQueue()).toHaveLength(0)
  })

  it('skips and surfaces later writes to an entity whose earlier write was rejected', async () => {
    enqueueMutation({
      method: 'POST',
      url: '/events',
      body: { id: 'e1' },
      entityKey: 'event:e1',
    })
    enqueueMutation({
      method: 'PUT',
      url: '/events/e1',
      body: { description: 'x' },
      entityKey: 'event:e1',
    })
    const arc = enqueueMutation({
      method: 'POST',
      url: '/arcs',
      body: { id: 'a1' },
      entityKey: 'arc:a1',
    })

    const send = vi.fn<MutationSender>().mockImplementation(async (mutation) => {
      if (mutation.url === '/events') {
        throw new HttpMutationError(409, 'conflict')
      }
    })

    const result = await replayQueuedMutations({ send })

    expect(result.rejected).toHaveLength(2)
    expect(result.rejected[1]?.skippedDependent).toBe(true)
    // The write that replayed is the arc, not the skipped event update.
    expect(result.replayed).toEqual([arc.id])

    const messages = useGlobalStore.getState().errors.map((error) => error.message)
    expect(messages.some((message) => message.includes('Skipped'))).toBe(true)
    expect(readMutationQueue()).toHaveLength(0)
  })

  it('stops at a transient failure and keeps the remaining writes queued in order', async () => {
    enqueueMutation({ method: 'POST', url: '/events', body: { id: 'e1' } })
    enqueueMutation({ method: 'POST', url: '/events', body: { id: 'e2' } })
    enqueueMutation({ method: 'POST', url: '/arcs', body: { id: 'a1' } })

    let attempts = 0
    const send = vi.fn<MutationSender>().mockImplementation(async () => {
      attempts += 1
      // Only the second write fails, so a pass that continued past a transient
      // failure would send the third write too.
      if (attempts === 2) throw new Error('network down')
    })
    const result = await replayQueuedMutations({ send })

    expect(send).toHaveBeenCalledTimes(2)
    expect(result.retryable).toBe(true)
    expect(result.replayed).toHaveLength(1)
    expect(result.remaining).toBe(2)
    expect(readMutationQueue().map((mutation) => mutation.url)).toEqual(['/events', '/arcs'])
    expect(useGlobalStore.getState().errors).toHaveLength(0)
  })

  it('mirrors the replay state into the store while a pass runs', async () => {
    enqueueMutation({ method: 'POST', url: '/events', body: { id: 'e1' } })
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const send = vi.fn<MutationSender>().mockImplementation(async () => {
      await gate
    })

    const pass = replayQueuedMutations({ send })
    await vi.waitFor(() => expect(useGlobalStore.getState().syncInProgress).toBe(true))

    release()
    await pass
    expect(useGlobalStore.getState().syncInProgress).toBe(false)
    expect(useGlobalStore.getState().pendingMutationCount).toBe(0)
  })

  it('surfaces the offline transition without claiming that every change is saved', () => {
    const stop = startOfflineSync({ send: vi.fn<MutationSender>() })
    expect(useGlobalStore.getState().isOnline).toBe(true)

    mockedIsOnline.mockReturnValue(false)
    connectivityListener?.(false)

    expect(useGlobalStore.getState().isOnline).toBe(false)
    const errors = useGlobalStore.getState().errors
    const offlineNotice = errors.find(
      (error) => error.type === 'network' && error.message.includes('offline'),
    )
    expect(offlineNotice).toBeDefined()
    // The claim names the writes the queue actually receives, and says plainly
    // that the rest are not saved.
    expect(offlineNotice?.message).toContain('Event and arc edits are saved on this device')
    expect(offlineNotice?.message).toContain('NOT saved')

    stop()
  })
})
