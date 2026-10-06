import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useGlobalStore } from '@/stores/globalStore'
import * as connectivity from './connectivity'
import { clearMutationQueue, enqueueMutation, readMutationQueue } from './mutationQueue'
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
    useGlobalStore.setState({ isOnline: true, pendingMutationCount: 0, errors: [] })
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

    expect(first).toBe('queued')
    expect(second).toBe('queued')
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
    enqueueMutation({ method: 'POST', url: '/arcs', body: { id: 'a1' }, entityKey: 'arc:a1' })

    const send = vi.fn<MutationSender>().mockImplementation(async (mutation) => {
      if (mutation.url === '/events') {
        throw new HttpMutationError(409, 'conflict')
      }
    })

    const result = await replayQueuedMutations({ send })

    expect(result.rejected).toHaveLength(2)
    expect(result.rejected[1]?.skippedDependent).toBe(true)
    expect(result.replayed).toHaveLength(1)

    const messages = useGlobalStore.getState().errors.map((error) => error.message)
    expect(messages.some((message) => message.includes('Skipped'))).toBe(true)
    expect(readMutationQueue()).toHaveLength(0)
  })

  it('keeps the queue in order when a replay fails transiently', async () => {
    enqueueMutation({ method: 'POST', url: '/events', body: { id: 'e1' } })
    enqueueMutation({ method: 'POST', url: '/arcs', body: { id: 'a1' } })

    const send = vi.fn<MutationSender>().mockRejectedValue(new Error('network down'))
    const result = await replayQueuedMutations({ send })

    expect(result.replayed).toHaveLength(0)
    expect(result.remaining).toBe(2)
    expect(readMutationQueue().map((mutation) => mutation.url)).toEqual(['/events', '/arcs'])
    expect(useGlobalStore.getState().errors).toHaveLength(0)
  })

  it('surfaces the offline transition through the existing error channel', () => {
    const stop = startOfflineSync({ send: vi.fn<MutationSender>() })
    expect(useGlobalStore.getState().isOnline).toBe(true)

    mockedIsOnline.mockReturnValue(false)
    connectivityListener?.(false)

    expect(useGlobalStore.getState().isOnline).toBe(false)
    const errors = useGlobalStore.getState().errors
    expect(
      errors.some((error) => error.type === 'network' && error.message.includes('offline')),
    ).toBe(true)

    stop()
  })
})
