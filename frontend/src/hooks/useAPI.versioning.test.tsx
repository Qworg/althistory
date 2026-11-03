/**
 * Every write is a new version, so a write must refresh the graph's metadata
 * and version head. Without this the header kept showing the version from
 * before the edit (a new branch read "v0" after its first change).
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useCreateEvent, useCreateCausalLink } from './useAPI'
import { graphKeys } from './useGraphs'
import { apiClient } from '@/services/api'
import type { Event, CausalRelationship } from '@/types'

vi.mock('@/offline/offlineSync', () => ({
  submitMutation: async (_req: unknown, { send }: { send: () => Promise<unknown> }) => ({
    delivery: 'sent',
    value: await send(),
  }),
}))

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { invalidate, wrapper }
}

const invalidatedGraphs = (invalidate: { mock: { calls: unknown[][] } }) =>
  invalidate.mock.calls.some(([filters]) => JSON.stringify((filters as { queryKey?: unknown } | undefined)?.queryKey) === JSON.stringify(graphKeys.all))

describe('write mutations refresh the graph version', () => {
  it('creating an event invalidates the graph queries', async () => {
    const event = { id: 'e1', description: 'x', actor: 'a', target: 'b', timestamp: '1843-01-01T00:00:00Z' } as Event
    vi.spyOn(apiClient.events, 'create').mockResolvedValue(event)
    const { invalidate, wrapper } = setup()
    const { result } = renderHook(() => useCreateEvent(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ description: 'x', actor: 'a', target: 'b', timestamp: event.timestamp })
    })

    expect(invalidatedGraphs(invalidate)).toBe(true)
  })

  it('creating a causal link invalidates the graph queries', async () => {
    vi.spyOn(apiClient.causal, 'createLink').mockResolvedValue({ id: 'r1' } as CausalRelationship)
    const { invalidate, wrapper } = setup()
    const { result } = renderHook(() => useCreateCausalLink(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        causeId: 'e1',
        effectId: 'e2',
        relationship: { weight: 0.5, evidence: '', confidence: 0.7, relationship_type: 'direct' },
      })
    })

    expect(invalidatedGraphs(invalidate)).toBe(true)
  })
})
