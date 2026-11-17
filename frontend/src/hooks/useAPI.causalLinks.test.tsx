/**
 * A pair of events can hold several links, so a change or a removal names the
 * link by its own id: the request carries it, and the store entry it touches is
 * the link's, not `cause_effect` of the pair.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useUpdateCausalLink, useDeleteCausalLink } from './useAPI'
import { apiClient } from '@/services/api'
import { useGlobalStore } from '@/stores/globalStore'
import type { CausalRelationship } from '@/types'

vi.mock('@/services/api')

const link = (id: string): CausalRelationship =>
  ({ id, cause_event_id: 'e1', effect_event_id: 'e2', weight: 0.5, confidence: 0.5, evidence: 'x', relationship_type: 'direct', created_at: '', updated_at: '' }) as CausalRelationship

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>{children}</QueryClientProvider>
}

describe('causal link hooks name the link by its id', () => {
  const updateInStore = vi.fn()
  const deleteInStore = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    useGlobalStore.setState({ updateCausalRelationship: updateInStore, deleteCausalRelationship: deleteInStore })
    vi.mocked(apiClient.causal.updateLink).mockResolvedValue(link('link_new'))
    vi.mocked(apiClient.causal.deleteLink).mockResolvedValue(undefined)
  })

  it('sends the link id on an update and updates that link in the store', async () => {
    const { result } = renderHook(() => useUpdateCausalLink(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ causeEventId: 'e1', effectEventId: 'e2', data: { evidence: 'revised' }, linkId: 'link_new' })
    })
    expect(apiClient.causal.updateLink).toHaveBeenCalledWith('e1', 'e2', { evidence: 'revised' }, 'link_new')
    expect(updateInStore).toHaveBeenCalledWith('link_new', expect.objectContaining({ id: 'link_new' }))
    expect(updateInStore).not.toHaveBeenCalledWith('e1_e2', expect.anything())
  })

  it('sends the link id on a delete and removes that link from the store', async () => {
    const { result } = renderHook(() => useDeleteCausalLink(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ causeEventId: 'e1', effectEventId: 'e2', linkId: 'link_new' })
    })
    expect(apiClient.causal.deleteLink).toHaveBeenCalledWith('e1', 'e2', 'link_new')
    expect(deleteInStore).toHaveBeenCalledWith('link_new')
    expect(deleteInStore).not.toHaveBeenCalledWith('e1_e2')
  })

  it('still works for a caller that names no link: the oldest of the pair', async () => {
    const { result } = renderHook(() => useDeleteCausalLink(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ causeEventId: 'e1', effectEventId: 'e2' })
    })
    expect(apiClient.causal.deleteLink).toHaveBeenCalledWith('e1', 'e2', undefined)
  })
})
