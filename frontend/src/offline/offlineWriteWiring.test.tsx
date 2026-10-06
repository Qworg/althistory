import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import React from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useGlobalStore } from '@/stores/globalStore'
import { apiClient } from '@/services/api'
import {
  clearMutationQueue,
  readMutationQueue,
  MUTATION_QUEUE_ENTRY_PREFIX,
} from './mutationQueue'
import type { OfflineWriteOutcome } from './offlineSync'
import { useCreateEvent, useUpdateEvent } from '@/hooks/useAPI'

/**
 * These tests are the evidence that the production write path is wired to the
 * offline queue: they render the real mutation hooks and assert that an offline
 * write ends up in the durable queue INSTEAD of being lost. Without the
 * `submitMutation` call in `@/hooks/useAPI.ts` they fail (the API client is
 * called and the queue stays empty).
 */

vi.mock('@/services/api', () => ({
  apiClient: {
    events: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    arcs: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
  APIError: class APIError extends Error {
    constructor(
      message: string,
      public status: number,
    ) {
      super(message)
    }
  },
}))

function setNavigatorOnline(value: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => value })
}

const createData = {
  description: 'Offline create',
  actor: 'a',
  target: 'b',
  timestamp: '2024-01-01T00:00:00Z',
}

describe('offline write wiring through the mutation hooks', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    localStorage.clear()
    clearMutationQueue()
    vi.clearAllMocks()
    setNavigatorOnline(true)
    useGlobalStore.setState({ events: [], errors: [], isOnline: true, pendingMutationCount: 0 })
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
  })

  afterEach(() => {
    queryClient.clear()
    setNavigatorOnline(true)
    vi.restoreAllMocks()
  })

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )

  it('queues an event create made offline instead of losing it', async () => {
    setNavigatorOnline(false)
    const { result } = renderHook(() => useCreateEvent(), { wrapper })

    const outcome = await result.current.mutateAsync(createData)

    expect(outcome.delivery).toBe('queued')
    // The write never reached the API client...
    expect(apiClient.events.create).not.toHaveBeenCalled()
    // ...it is on this device, with the payload the API would have received.
    const queued = readMutationQueue()
    expect(queued).toHaveLength(1)
    expect(queued[0]).toMatchObject({ method: 'POST', url: '/events', body: createData })
    // Stored, not just in memory.
    expect(localStorage.getItem(`${MUTATION_QUEUE_ENTRY_PREFIX}${queued[0]?.id}`)).toContain(
      'Offline create',
    )
    // And it is not reported as accepted: the event is not added to local state.
    expect(useGlobalStore.getState().events).toHaveLength(0)
    // The user is told where it went.
    expect(
      useGlobalStore
        .getState()
        .errors.some((error) => error.message.includes('saved on this device')),
    ).toBe(true)
  })

  it('sends the create when online and leaves the queue empty', async () => {
    const created = { id: 'e1', ...createData, created_at: 'now', updated_at: 'now' }
    vi.mocked(apiClient.events.create).mockResolvedValue(created)
    const { result } = renderHook(() => useCreateEvent(), { wrapper })

    const outcome = await result.current.mutateAsync(createData)

    expect(outcome.delivery).toBe('sent')
    expect(apiClient.events.create).toHaveBeenCalledWith(createData)
    expect(readMutationQueue()).toHaveLength(0)
    await waitFor(() => expect(useGlobalStore.getState().events).toHaveLength(1))
  })

  it('queues an event update against the same entity key it will be replayed with', async () => {
    setNavigatorOnline(false)
    const { result } = renderHook(() => useUpdateEvent(), { wrapper })

    const outcome: OfflineWriteOutcome<unknown> = await result.current.mutateAsync({
      id: 'e1',
      data: { description: 'edited offline' },
    })

    expect(outcome.delivery).toBe('queued')
    expect(apiClient.events.update).not.toHaveBeenCalled()
    expect(readMutationQueue()[0]).toMatchObject({
      method: 'PUT',
      url: '/events/e1',
      body: { description: 'edited offline' },
      entityKey: 'event:e1',
    })
  })

  it('still surfaces a failure that happens while online', async () => {
    vi.mocked(apiClient.events.create).mockRejectedValue(new Error('server exploded'))
    const { result } = renderHook(() => useCreateEvent(), { wrapper })

    await expect(result.current.mutateAsync(createData)).rejects.toThrow('server exploded')
    expect(readMutationQueue()).toHaveLength(0)
  })
})
