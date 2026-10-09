import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CausalGraphView } from './CausalGraphView'
import { useEvents, useCausalRelationships } from '@/hooks/useAPI'
import { useGlobalStore } from '@/stores/globalStore'
import type { Event, CausalRelationship } from '@/types'
import type { CausalGraphComponentProps } from '@/components/causal-graph'

vi.mock('@/hooks/useAPI', () => ({
  useEvents: vi.fn(),
  useCausalRelationships: vi.fn(),
  useDeleteCausalLink: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useUpdateCausalLink: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useDeleteEvent: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useUpdateEvent: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}))

vi.mock('@/components/causal-graph', () => ({
  CausalGraphComponent: ({ events, causalRelationships }: CausalGraphComponentProps) => (
    <div data-testid="causal-graph-component">
      <span data-testid="rendered-events-count">{events?.length ?? 0}</span>
      <span data-testid="rendered-rel-count">{causalRelationships?.length ?? 0}</span>
    </div>
  )
}))

const mockUseEvents = vi.mocked(useEvents)
const mockUseCausalRelationships = vi.mocked(useCausalRelationships)

const sampleEvents: Event[] = [
  {
    id: 'e1',
    description: 'Event One',
    actor: 'Actor A',
    target: 'Target B',
    timestamp: '2023-01-01T00:00:00.000Z',
    created_at: '2023-01-01T00:00:00.000Z',
    updated_at: '2023-01-01T00:00:00.000Z'
  },
  {
    id: 'e2',
    description: 'Event Two',
    actor: 'Actor B',
    target: 'Target C',
    timestamp: '2023-01-02T00:00:00.000Z',
    created_at: '2023-01-02T00:00:00.000Z',
    updated_at: '2023-01-02T00:00:00.000Z'
  }
]

const sampleRelationships: CausalRelationship[] = [
  {
    id: 'r1',
    cause_event_id: 'e1',
    effect_event_id: 'e2',
    weight: 0.8,
    confidence: 0.9,
    relationship_type: 'direct',
    evidence: 'Direct observation',
    created_at: '2023-01-01T00:00:00.000Z',
    updated_at: '2023-01-01T00:00:00.000Z'
  }
]

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false }
    }
  })
  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>
  )
}

describe('CausalGraphView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useGlobalStore.getState().clearFilters()
  })

  it('renders loading state when queries are loading', () => {
    mockUseEvents.mockReturnValue({
      data: [],
      isLoading: true
    } as unknown as ReturnType<typeof useEvents>)
    mockUseCausalRelationships.mockReturnValue({
      data: [],
      isLoading: false
    } as unknown as ReturnType<typeof useCausalRelationships>)

    renderWithClient(<CausalGraphView />)

    expect(screen.getByText('Loading graph data...')).toBeInTheDocument()
  })

  it('renders empty state when there are no events without retaining ghost state', () => {
    mockUseEvents.mockReturnValue({
      data: [],
      isLoading: false
    } as unknown as ReturnType<typeof useEvents>)
    mockUseCausalRelationships.mockReturnValue({
      data: [],
      isLoading: false
    } as unknown as ReturnType<typeof useCausalRelationships>)

    renderWithClient(<CausalGraphView />)

    expect(screen.getByText('No events to display')).toBeInTheDocument()
    expect(screen.queryByTestId('causal-graph-component')).not.toBeInTheDocument()
    expect(screen.getByText('0 events')).toBeInTheDocument()
    expect(screen.getByText('0 relationships')).toBeInTheDocument()
  })

  it('passes filtered events and relationships directly to CausalGraphComponent', () => {
    mockUseEvents.mockReturnValue({
      data: sampleEvents,
      isLoading: false
    } as unknown as ReturnType<typeof useEvents>)
    mockUseCausalRelationships.mockReturnValue({
      data: sampleRelationships,
      isLoading: false
    } as unknown as ReturnType<typeof useCausalRelationships>)

    renderWithClient(<CausalGraphView />)

    expect(screen.getByTestId('causal-graph-component')).toBeInTheDocument()
    expect(screen.getByTestId('rendered-events-count')).toHaveTextContent('2')
    expect(screen.getByTestId('rendered-rel-count')).toHaveTextContent('1')
    expect(screen.getByText('2 events')).toBeInTheDocument()
    expect(screen.getByText('1 relationships')).toBeInTheDocument()
  })
})
