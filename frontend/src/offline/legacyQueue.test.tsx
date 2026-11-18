import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useGlobalStore } from '@/stores/globalStore'
import * as connectivity from './connectivity'
import { clearMutationQueue, enqueueMutation, readMutationQueue } from './mutationQueue'
import { replayQueuedMutations, resetReplayNotices, startOfflineSync } from './offlineSync'
import { OfflineIndicator } from './OfflineIndicator'

vi.mock('./connectivity', () => ({
  isOnline: vi.fn(() => true),
  subscribeConnectivity: vi.fn(() => () => {}),
}))
vi.mock('@/hooks/useGraphs', () => ({
  useActiveGraphId: () => localStorage.getItem('active_graph_id'),
  useActiveGraph: () => ({ data: { id: 'graph-open', name: 'Open Graph' } }),
}))

const mockedIsOnline = vi.mocked(connectivity.isOnline)

function headersOf(call: unknown[]): Record<string, string> {
  return (call[1] as RequestInit).headers as Record<string, string>
}

/** Five writes from before graphs were recorded, then one new write to the same entity. */
function queueLegacyAndNew() {
  for (let i = 0; i < 5; i += 1) {
    enqueueMutation({ method: 'PUT', url: `/events/e1?step=${i}`, body: { i }, entityKey: 'event:e1' })
  }
  enqueueMutation({ method: 'PUT', url: '/events/e1?step=new', body: {}, entityKey: 'event:e1', graphId: 'graph-new' })
}

describe('writes queued before graphs were recorded', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    clearMutationQueue()
    resetReplayNotices()
    mockedIsOnline.mockReturnValue(true)
    localStorage.setItem('active_graph_id', 'graph-open')
    useGlobalStore.setState({ errors: [], pendingMutationCount: 0, unscopedMutationCount: 0 })
    fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    localStorage.clear()
  })

  it('sends nothing, removes nothing and reports nothing; the new write is not dropped', async () => {
    queueLegacyAndNew()
    const stop = startOfflineSync({ retryBaseDelayMs: 5 })
    const result = await replayQueuedMutations()

    expect(result.held).toBe(true)
    expect(result.retryable).toBe(false)
    expect(result.rejected).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
    expect(readMutationQueue()).toHaveLength(6)
    expect(useGlobalStore.getState().errors).toEqual([])
    expect(useGlobalStore.getState().unscopedMutationCount).toBe(5)
    // No retry loop either.
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(fetchMock).not.toHaveBeenCalled()
    stop()
  })

  it('asks once, and Send replays them all to the open graph in order, then the new write', async () => {
    queueLegacyAndNew()
    const user = userEvent.setup()
    const stop = startOfflineSync({ retryBaseDelayMs: 5 })
    render(<OfflineIndicator />)
    await replayQueuedMutations()

    expect(screen.getAllByTestId('unscoped-prompt')).toHaveLength(1)
    expect(screen.getByTestId('unscoped-prompt')).toHaveTextContent("5 changes saved before this update don't record their graph")

    await user.click(screen.getByRole('button', { name: 'Send to Open Graph' }))
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6))

    const urls = fetchMock.mock.calls.map((call) => String(call[0]))
    expect(urls.map((u) => u.split('?step=')[1])).toEqual(['0', '1', '2', '3', '4', 'new'])
    expect(fetchMock.mock.calls.slice(0, 5).map((c) => headersOf(c)['X-Graph-Id'])).toEqual(Array(5).fill('graph-open'))
    expect(headersOf(fetchMock.mock.calls[5]!)['X-Graph-Id']).toBe('graph-new')
    await vi.waitFor(() => expect(readMutationQueue()).toHaveLength(0))
    expect(screen.queryByTestId('unscoped-prompt')).not.toBeInTheDocument()
    stop()
  })

  it('Discard removes only those and gives one summary notice', async () => {
    queueLegacyAndNew()
    const user = userEvent.setup()
    const stop = startOfflineSync({ retryBaseDelayMs: 5 })
    render(<OfflineIndicator />)
    await act(async () => {
      await replayQueuedMutations()
    })

    await user.click(screen.getByRole('button', { name: 'Discard' }))

    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('step=0'), expect.anything())
    expect(readMutationQueue().map((m) => m.graphId)).toEqual(['graph-new'])
    const messages = useGlobalStore.getState().errors.map((e) => e.message)
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain('Discarded 5 saved changes')
    stop()
  })
})

describe('what a replay sends and says', () => {
  beforeEach(() => {
    clearMutationQueue()
    resetReplayNotices()
    mockedIsOnline.mockReturnValue(true)
    useGlobalStore.setState({ errors: [] })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    localStorage.clear()
  })

  it('sends the credential as a Bearer token and X-API-Key', async () => {
    localStorage.setItem('api_key', 'k-1')
    enqueueMutation({ method: 'POST', url: '/events', body: {}, graphId: null })
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    await replayQueuedMutations()
    expect(headersOf(fetchMock.mock.calls[0]!)).toMatchObject({ Authorization: 'Bearer k-1', 'X-API-Key': 'k-1' })
  })

  it('falls back to VITE_API_KEY when the browser holds no key', async () => {
    vi.stubEnv('VITE_API_KEY', 'env-key')
    enqueueMutation({ method: 'POST', url: '/events', body: {}, graphId: null })
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    await replayQueuedMutations()
    expect(headersOf(fetchMock.mock.calls[0]!)['X-API-Key']).toBe('env-key')
  })

  it('announces a 401 once per key, even after the notice is dismissed and the retry fails again', async () => {
    localStorage.setItem('api_key', 'k-1')
    enqueueMutation({ method: 'POST', url: '/events', body: {}, graphId: 'g' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })))
    await replayQueuedMutations()
    expect(useGlobalStore.getState().errors).toHaveLength(1)
    useGlobalStore.setState({ errors: [] })
    await replayQueuedMutations()
    expect(useGlobalStore.getState().errors).toHaveLength(0)
    // A different key is a new situation.
    localStorage.setItem('api_key', 'k-2')
    await replayQueuedMutations()
    expect(useGlobalStore.getState().errors).toHaveLength(1)
  })

  it('says the graph no longer exists when a 404 is the graph, not the item', async () => {
    enqueueMutation({ method: 'PUT', url: '/events/e9', body: {}, graphId: 'graph-gone' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })))
    const result = await replayQueuedMutations()
    expect(result.rejected).toHaveLength(1)
    expect(useGlobalStore.getState().errors[0]!.message).toContain('graph it was made in no longer exists')
  })

  it('keeps the plain message when the graph is there and the item is not', async () => {
    enqueueMutation({ method: 'PUT', url: '/events/e9', body: {}, graphId: 'graph-ok' })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) =>
        String(url).includes('/graphs/') ? new Response('{}', { status: 200 }) : new Response('{}', { status: 404 }),
      ),
    )
    await replayQueuedMutations()
    expect(useGlobalStore.getState().errors[0]!.message).toContain('was rejected by the server (HTTP 404)')
  })
})
