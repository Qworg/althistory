import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useBaselineGhost } from './useBaselineGhost'
import { useActiveGraphId, useGraph } from '@/hooks/useGraphs'
import { apiClient } from '@/services/api'
import type { Event, Graph } from '@/types'

vi.mock('@/hooks/useGraphs', () => ({
  useActiveGraphId: vi.fn(),
  useGraph: vi.fn(),
}))
vi.mock('@/services/api', () => ({
  apiClient: { events: { getAll: vi.fn() } },
}))

function graph(id: string, name: string, parentGraphId?: string): Graph {
  return {
    id,
    name,
    status: 'active',
    version: 1,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    metadata: { eventCount: 0, arcCount: 0, relationshipCount: 0, pressureCount: 0 },
    parentGraphId,
  }
}

function event(id: string, timestamp: string, description = id): Event {
  return {
    id,
    description,
    actor: 'A',
    target: 'B',
    timestamp,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  }
}

const graphs: Record<string, Graph> = {
  engine: graph('engine', 'The Engine Age'),
  clerks: graph('clerks', 'The Engine Age — Clerks Prevail', 'engine'),
}

const shared = [event('design', '1834-12-15T00:00:00Z'), event('act', '1861-02-01T00:00:00Z')]
const ban = event('ban', '1860-07-12T00:00:00Z')

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('useBaselineGhost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useGraph).mockImplementation(
      (id) => ({ data: id ? graphs[id] : undefined }) as ReturnType<typeof useGraph>
    )
    vi.mocked(apiClient.events.getAll).mockResolvedValue(shared)
  })

  it('on a branch, fetches the parent graph\'s events by X-Graph-Id and finds the divergence', async () => {
    vi.mocked(useActiveGraphId).mockReturnValue('clerks')
    const branchEvents = [...shared, ban]
    const { result } = renderHook(() => useBaselineGhost(branchEvents), { wrapper })

    await waitFor(() => expect(result.current.ghost).toBeDefined())
    expect(apiClient.events.getAll).toHaveBeenCalledWith({ limit: 1000 }, { graphId: 'engine' })
    expect(result.current.branch?.id).toBe('clerks')
    expect(result.current.baseline?.id).toBe('engine')
    // The same analysis the comparison modal runs: the first added event.
    expect(result.current.pointOfDivergence?.event?.id).toBe('ban')
    expect(result.current.ghost).toEqual({
      label: 'The Engine Age',
      events: shared,
      divergence: new Date('1860-07-12T00:00:00Z'),
    })
  })

  it('reports no divergence while the branch matches its baseline', async () => {
    vi.mocked(useActiveGraphId).mockReturnValue('clerks')
    const { result } = renderHook(() => useBaselineGhost(shared), { wrapper })
    await waitFor(() => expect(result.current.ghost).toBeDefined())
    expect(result.current.pointOfDivergence).toBeNull()
    expect(result.current.ghost?.divergence).toBeNull()
  })

  it('does nothing on a graph that is not a branch', async () => {
    vi.mocked(useActiveGraphId).mockReturnValue('engine')
    const { result } = renderHook(() => useBaselineGhost(shared), { wrapper })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(apiClient.events.getAll).not.toHaveBeenCalled()
    expect(result.current).toMatchObject({ branch: null, baseline: null, ghost: undefined, pointOfDivergence: null })
  })
})
