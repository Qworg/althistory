import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useActiveGraphReconciler, useActiveGraphId } from './useGraphs'
import { apiClient } from '@/services/api'
import type { Graph } from '@/types'

vi.mock('@/services/api', () => ({
  apiClient: { graphs: { getActive: vi.fn() } },
}))

const getActive = vi.mocked(apiClient.graphs.getActive)

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const graph = (id: string) => ({ id, name: id }) as unknown as Graph

function useBoth() {
  return { reconcile: useActiveGraphReconciler(), activeGraphId: useActiveGraphId() }
}

describe('useActiveGraphReconciler', () => {
  beforeEach(() => {
    localStorage.clear()
    getActive.mockReset()
  })

  it('adopts the server’s active graph when the remembered one is stale', async () => {
    localStorage.setItem('active_graph_id', 'graph-deleted')
    getActive.mockResolvedValue(graph('graph-live'))

    const { result } = renderHook(useBoth, { wrapper })

    await waitFor(() => expect(result.current.activeGraphId).toBe('graph-live'))
    expect(localStorage.getItem('active_graph_id')).toBe('graph-live')
    expect(result.current.reconcile.noActiveGraph).toBe(false)
  })

  it('forgets the remembered graph when the server has none active', async () => {
    localStorage.setItem('active_graph_id', 'graph-deleted')
    getActive.mockResolvedValue(null)

    const { result } = renderHook(useBoth, { wrapper })

    await waitFor(() => expect(result.current.reconcile.noActiveGraph).toBe(true))
    expect(result.current.activeGraphId).toBeNull()
    expect(localStorage.getItem('active_graph_id')).toBeNull()
  })

  it('leaves an agreeing id alone', async () => {
    localStorage.setItem('active_graph_id', 'graph-live')
    getActive.mockResolvedValue(graph('graph-live'))
    const listener = vi.fn()
    window.addEventListener('graph-switched', listener)

    const { result } = renderHook(useBoth, { wrapper })

    await waitFor(() => expect(getActive).toHaveBeenCalled())
    expect(result.current.activeGraphId).toBe('graph-live')
    expect(listener).not.toHaveBeenCalled()
    window.removeEventListener('graph-switched', listener)
  })
})
