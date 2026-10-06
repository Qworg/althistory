import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router'
import type { TimelineProps } from '@/components/timeline/Timeline'
import { Header } from '@/components/layout/Header'
import { TimelineView } from '@/components/views/TimelineView'

/**
 * Acceptance test for the payoff of graph-scoped isolation: switching the active
 * graph through the UI changes the data the views read.
 *
 * The HTTP boundary is faked with a stateful server: `/events` answers for the
 * graph the server currently considers active (mirroring backend
 * `resolveGraphContext`, which falls back to the active graph when no
 * X-Graph-Id header is sent), and `POST /graphs/:id/activate` changes that
 * active graph. Everything above the HTTP boundary is real: `GraphSelector` ->
 * `useGraphManagement` -> `apiClient.graphs.switch` (which persists and emits
 * `graph-switched`) -> React Query invalidation -> `useEvents` refetch ->
 * `TimelineView` render.
 */
const fake = vi.hoisted(() => {
  const graphA = {
    id: 'graph-a',
    name: 'Alpha Graph',
    description: '',
    status: 'active',
    version: 1,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    metadata: { eventCount: 2, arcCount: 0, relationshipCount: 0, pressureCount: 0 },
  }
  const graphB = {
    id: 'graph-b',
    name: 'Beta Graph',
    description: '',
    status: 'active',
    version: 1,
    createdAt: '2024-01-02T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
    metadata: { eventCount: 1, arcCount: 0, relationshipCount: 0, pressureCount: 0 },
  }
  const event = (id: string, description: string) => ({
    id,
    description,
    actor: 'actor',
    target: 'target',
    timestamp: '1066-10-14T09:00:00.000Z',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
  })

  const state = {
    activeGraphId: 'graph-a',
    activated: [] as string[],
    requests: [] as Array<{ method: string; url: string }>,
  }
  const graphStore: Record<string, unknown> = { 'graph-a': graphA, 'graph-b': graphB }
  const eventsByGraph: Record<string, unknown[]> = {
    'graph-a': [event('a1', 'Battle of Hastings'), event('a2', 'Coronation')],
    'graph-b': [event('b1', 'Moon Landing')],
  }

  const ok = (data: unknown) => Promise.resolve({ data: { success: true, data } })

  const get = vi.fn(async (url: string) => {
    state.requests.push({ method: 'GET', url })
    if (url === '/graphs') return ok([graphA, graphB])
    if (url === '/events') return ok(eventsByGraph[state.activeGraphId] ?? [])
    if (url === '/arcs') return ok([])
    if (url.startsWith('/graphs/')) {
      const id = url.split('/')[2]
      if (id !== undefined && graphStore[id] !== undefined) return ok(graphStore[id])
    }
    return ok([])
  })

  const post = vi.fn(async (url: string) => {
    state.requests.push({ method: 'POST', url })
    const match = /^\/graphs\/([^/]+)\/activate$/.exec(url)
    const id = match?.[1]
    if (id !== undefined) {
      state.activeGraphId = id
      state.activated.push(id)
      return Promise.resolve({ data: { success: true } })
    }
    return ok({})
  })

  const instance = {
    get,
    post,
    put: vi.fn().mockResolvedValue({ data: { success: true } }),
    delete: vi.fn().mockResolvedValue({ data: { success: true } }),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  }

  return { state, instance }
})

vi.mock('axios', () => ({ default: { create: vi.fn(() => fake.instance) } }))

// D3 owns the real timeline DOM; the data contract is what this test exercises.
vi.mock('@/components/timeline/Timeline', () => ({
  Timeline: ({ events, arcs }: TimelineProps) => (
    <div data-testid="timeline">
      <span data-testid="rendered-events">{events.length}</span>
      <span data-testid="rendered-arcs">{arcs.length}</span>
    </div>
  ),
}))

function renderHarness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Header isMobile={false} layoutMode="sidebar" />
        <TimelineView />
      </BrowserRouter>
    </QueryClientProvider>
  )
}

describe('graph switching through the header changes the data the views read', () => {
  beforeEach(() => {
    localStorage.setItem('active_graph_id', 'graph-a')
    fake.state.activeGraphId = 'graph-a'
    fake.state.activated = []
    fake.state.requests = []
    vi.clearAllMocks()
  })

  afterEach(() => {
    localStorage.removeItem('active_graph_id')
  })

  it('switches the active graph and re-reads the timeline data from the new graph', async () => {
    const user = userEvent.setup()
    renderHarness()

    // The timeline first renders graph A's two events.
    expect(await screen.findByText('2 events, 0 arcs')).toBeInTheDocument()
    expect(screen.getByTestId('rendered-events')).toHaveTextContent('2')

    // Switch to graph B through the mounted GraphSelector.
    await user.click(screen.getByRole('button', { name: /alpha graph/i }))
    await user.click(await screen.findByRole('button', { name: /beta graph/i }))

    // The backend activation was requested, and the views now read graph B.
    await waitFor(() => {
      expect(fake.state.activated).toContain('graph-b')
    })
    await waitFor(() => {
      expect(screen.getByText('1 events, 0 arcs')).toBeInTheDocument()
    })
    expect(screen.getByTestId('rendered-events')).toHaveTextContent('1')

    // The selector reflects the new active graph.
    expect(
      await screen.findByRole('button', { name: /beta graph/i })
    ).toBeInTheDocument()

    // The event endpoint was queried again after the switch (not just the button).
    const eventRequests = fake.state.requests.filter(request => request.url === '/events')
    expect(eventRequests.length).toBeGreaterThanOrEqual(2)
  })
})
