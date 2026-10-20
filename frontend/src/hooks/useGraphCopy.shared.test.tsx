import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useGraphCopy } from './useGraphCopy'
import { useCopyStore } from '@/stores/copyStore'
import { apiClient } from '@/services/api'
import { CopyOperation, CopyResult } from '@/types'

vi.mock('@/services/api', () => ({
  apiClient: {
    graph: {
      copyFull: vi.fn(),
      copyByTimeRange: vi.fn(),
      copyByFilter: vi.fn(),
      getCopyStatus: vi.fn(),
    },
  },
}))

vi.mock('@/stores/globalStore', () => ({
  useGlobalStore: () => ({
    addError: vi.fn(),
    addLoadingOperation: vi.fn(),
    removeLoadingOperation: vi.fn(),
  }),
}))

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

const copyResult = (id: string, name: string): CopyResult => ({
  id,
  name,
  status: 'pending',
  progress: 0,
  created_at: '2024-01-01T00:00:00Z',
})

describe('the shared copy state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // The polling intervals are real timers; the store is reset between tests,
    // so the ones a previous test started have to be released or they keep
    // running for the rest of the file.
    useCopyStore.getState().stopAllPolling()
    useCopyStore.setState({
      activeOperations: [],
      completedOperations: [],
      pollingIntervals: new Map(),
    })
  })

  afterEach(() => {
    useCopyStore.getState().stopAllPolling()
  })

  it('shows one hook instance the copy another instance started', async () => {
    // The whole point: the modal starts the copy, the progress panel and the
    // history panel have to see it. Before the state was shared, each
    // instance of the hook had its own.
    vi.mocked(apiClient.graph.copyFull).mockResolvedValue(copyResult('copy-1', 'Copy One'))

    const first = renderHook(() => useGraphCopy(), { wrapper: createWrapper() })
    const second = renderHook(() => useGraphCopy(), { wrapper: createWrapper() })

    // A copy needs a name; without one the hook refuses to start it.
    act(() => {
      first.result.current.setCopyName('Copy One')
    })

    await act(async () => {
      await first.result.current.createFullCopy()
    })

    await waitFor(() => {
      expect(second.result.current.copyState.activeOperations).toHaveLength(1)
    })

    expect(second.result.current.copyState.activeOperations[0]?.id).toBe('copy-1')
    expect(useCopyStore.getState().activeOperations).toHaveLength(1)
  })

  it('moves a finished copy to the completed list for every instance', async () => {

    vi.mocked(apiClient.graph.copyFull).mockResolvedValue(copyResult('copy-2', 'Copy Two'))
    vi.mocked(apiClient.graph.getCopyStatus).mockResolvedValue({
      id: 'copy-2',
      name: 'Copy Two',
      status: 'completed',
      progress: 100,
      created_at: '2024-01-01T00:00:00Z',
      completed_at: '2024-01-01T00:01:00Z',
    })

    const first = renderHook(() => useGraphCopy(), { wrapper: createWrapper() })
    const second = renderHook(() => useGraphCopy(), { wrapper: createWrapper() })

    act(() => {
      first.result.current.setCopyName('Copy Two')
    })

    await act(async () => {
      await first.result.current.createFullCopy()
    })

    // The poll itself is covered elsewhere; what matters here is that the
    // finished copy is shared, so the store is updated the way the poll does.
    act(() => {
      useCopyStore.getState().updateOperation('copy-2', {
        status: 'completed',
        progress: 100,
      })
    })

    await waitFor(() => {
      expect(useCopyStore.getState().completedOperations).toHaveLength(1)
    })

    await waitFor(() => {
      expect(second.result.current.copyState.completedOperations).toHaveLength(1)
    })
    expect(second.result.current.copyState.completedOperations[0]?.id).toBe('copy-2')
  })

  it('polls the copy and stops when it finishes', async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(apiClient.graph.copyFull).mockResolvedValue(copyResult('copy-4', 'Copy Four'))
      vi.mocked(apiClient.graph.getCopyStatus).mockResolvedValue({
        id: 'copy-4',
        name: 'Copy Four',
        status: 'completed',
        progress: 100,
        created_at: '2024-01-01T00:00:00Z',
        completed_at: '2024-01-01T00:01:00Z',
      })

      const { result } = renderHook(() => useGraphCopy(), { wrapper: createWrapper() })

      act(() => {
        result.current.setCopyName('Copy Four')
      })

      await act(async () => {
        await result.current.createFullCopy()
      })

      // The poll runs every two seconds.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000)
      })

      // The store is read directly: `waitFor` uses real timers, which the
      // fake clock has replaced.
      expect(useCopyStore.getState().completedOperations).toHaveLength(1)
      expect(vi.mocked(apiClient.graph.getCopyStatus)).toHaveBeenCalledWith('copy-4')

      // And it stops: a finished copy is not polled again.
      const callsAfterFinish = vi.mocked(apiClient.graph.getCopyStatus).mock.calls.length
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6000)
      })
      expect(vi.mocked(apiClient.graph.getCopyStatus).mock.calls.length).toBe(callsAfterFinish)
    } finally {
      vi.useRealTimers()
    }
  })

  it('polls a copy once even when two instances watch it', async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(apiClient.graph.copyFull).mockResolvedValue(copyResult('copy-5', 'Copy Five'))
      vi.mocked(apiClient.graph.getCopyStatus).mockResolvedValue({
        id: 'copy-5',
        name: 'Copy Five',
        status: 'in_progress',
        progress: 50,
        created_at: '2024-01-01T00:00:00Z',
      })

      const first = renderHook(() => useGraphCopy(), { wrapper: createWrapper() })
      const second = renderHook(() => useGraphCopy(), { wrapper: createWrapper() })

      act(() => {
        first.result.current.setCopyName('Copy Five')
      })

      await act(async () => {
        await first.result.current.createFullCopy()
      })

      // The second instance asks for the same copy to be watched.
      act(() => {
        second.result.current.refreshCopyStatus('copy-5')
      })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000)
      })

      // One interval, so one request per tick -- not one per instance.
      expect(vi.mocked(apiClient.graph.getCopyStatus).mock.calls.length).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('releases a duplicate interval for a copy that is already watched', () => {
    // The store is the last line of defence: if a caller hands over an
    // interval for a copy that is already watched, the new one would never be
    // cleared.
    const first = setInterval(() => {}, 10_000)
    const second = setInterval(() => {}, 10_000)

    useCopyStore.getState().startPolling('copy-6', first)
    useCopyStore.getState().startPolling('copy-6', second)

    // The second interval was released, so only the first is still registered.
    expect(useCopyStore.getState().pollingIntervals.size).toBe(1)
    expect(useCopyStore.getState().pollingIntervals.get('copy-6')).toBe(first)
  })

  it('stops polling a copy that cannot be reached, without failing it', async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(apiClient.graph.copyFull).mockResolvedValue(copyResult('copy-7', 'Copy Seven'))
      vi.mocked(apiClient.graph.getCopyStatus).mockRejectedValue(new Error('network down'))

      const { result } = renderHook(() => useGraphCopy(), { wrapper: createWrapper() })

      act(() => {
        result.current.setCopyName('Copy Seven')
      })

      await act(async () => {
        await result.current.createFullCopy()
      })

      // Five consecutive failures end the polling.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000 * 6)
      })

      expect(useCopyStore.getState().pollingIntervals.size).toBe(0)
      // A network outage says nothing about the copy: it is still running, and
      // the user can refresh it.
      const operation = useCopyStore
        .getState()
        .activeOperations.find((candidate) => candidate.id === 'copy-7')
      expect(operation).toBeDefined()
      expect(operation?.status).not.toBe('failed')
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears the completed list for every instance', async () => {
    const operation: CopyOperation = {
      id: 'copy-3',
      name: 'Copy Three',
      type: 'full',
      status: 'completed',
      progress: 100,
      created_at: '2024-01-01T00:00:00Z',
      parameters: {},
    }
    useCopyStore.setState({ completedOperations: [operation] })

    const { result } = renderHook(() => useGraphCopy(), { wrapper: createWrapper() })

    act(() => {
      result.current.clearCompletedOperations()
    })

    await waitFor(() => {
      expect(useCopyStore.getState().completedOperations).toHaveLength(0)
    })
  })
})
