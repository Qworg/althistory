import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router'
import { TimelineView } from './TimelineView'
import { useEvents } from '@/hooks/useEvents'
import { useArcs } from '@/hooks/useArcs'
import { useGlobalStore } from '@/stores/globalStore'
import type { Event, Arc, FilterState } from '@/types'
import type { TimelineProps } from '@/components/timeline/Timeline'

vi.mock('@/hooks/useEvents')
vi.mock('@/hooks/useArcs')

vi.mock('@/components/timeline/Timeline', () => ({
  Timeline: ({ events, arcs }: TimelineProps) => (
    <div data-testid="timeline">
      <span data-testid="rendered-events">{events.length}</span>
      <span data-testid="rendered-arcs">{arcs.length}</span>
    </div>
  )
}))

type EventsQuery = ReturnType<typeof useEvents>
type ArcsQuery = ReturnType<typeof useArcs>

const eventsResult = (fields: Pick<EventsQuery, 'data' | 'isLoading' | 'error'>): EventsQuery =>
  fields as EventsQuery
const arcsResult = (fields: Pick<ArcsQuery, 'data' | 'isLoading' | 'error'>): ArcsQuery =>
  fields as ArcsQuery

const events: Event[] = [
  {
    id: 'e1',
    description: 'Battle of Hastings',
    actor: 'William',
    target: 'Harold',
    timestamp: '1066-10-14T09:00:00.000Z',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z'
  },
  {
    id: 'e2',
    description: 'Coronation ceremony',
    actor: 'William',
    target: 'Church',
    timestamp: '1066-12-25T12:00:00.000Z',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z'
  },
  {
    id: 'e3',
    description: 'Harold sworn oath',
    actor: 'Harold',
    target: 'William',
    timestamp: '1064-01-10T08:00:00.000Z',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z'
  }
]

const arcs: Arc[] = [
  {
    id: 'a1',
    name: 'Norman Conquest',
    description: 'William takes England',
    start_time: '1066-09-01T00:00:00.000Z',
    end_time: '1067-01-01T00:00:00.000Z',
    level: 0,
    parent_arc_id: null,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z'
  },
  {
    id: 'a2',
    name: 'Succession Crisis',
    description: 'Contest for the throne',
    start_time: '1064-01-01T00:00:00.000Z',
    end_time: '1065-01-01T00:00:00.000Z',
    level: 1,
    parent_arc_id: 'a1',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z'
  }
]

const defaultFilters: FilterState = {
  dateRange: null,
  actors: [],
  targets: [],
  eventTypes: [],
  arcLevels: [],
  causalWeightRange: [0, 1],
  confidenceThreshold: 0,
  searchQuery: ''
}

const renderView = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <TimelineView />
      </BrowserRouter>
    </QueryClientProvider>
  )
}

describe('TimelineView filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useGlobalStore.setState({ activeFilters: { ...defaultFilters } })
    vi.mocked(useEvents).mockReturnValue(eventsResult({ data: events, isLoading: false, error: null }))
    vi.mocked(useArcs).mockReturnValue(arcsResult({ data: arcs, isLoading: false, error: null }))
  })

  it('renders every fetched event and arc with no active filters', () => {
    renderView()

    expect(screen.getByText('3 events, 2 arcs')).toBeInTheDocument()
    expect(screen.getByTestId('rendered-events')).toHaveTextContent('3')
    expect(screen.getByTestId('rendered-arcs')).toHaveTextContent('2')
  })

  it('narrows the rendered events when a search filter is active', async () => {
    useGlobalStore.setState({
      activeFilters: { ...defaultFilters, searchQuery: 'hastings' }
    })
    renderView()

    await waitFor(() => {
      expect(screen.getByTestId('rendered-events')).toHaveTextContent('1')
    })
    expect(screen.getByText('1 events, 0 arcs')).toBeInTheDocument()
    expect(screen.getByTestId('rendered-arcs')).toHaveTextContent('0')
  })

  it('narrows the rendered events when an actor filter is active', async () => {
    useGlobalStore.setState({
      activeFilters: { ...defaultFilters, actors: ['Harold'] }
    })
    renderView()

    await waitFor(() => {
      expect(screen.getByTestId('rendered-events')).toHaveTextContent('1')
    })
    expect(screen.getByText('1 events, 2 arcs')).toBeInTheDocument()
  })

  it('re-filters the rendered events when the store filters change', async () => {
    renderView()

    expect(screen.getByTestId('rendered-events')).toHaveTextContent('3')

    await act(async () => {
      useGlobalStore.setState({
        activeFilters: { ...defaultFilters, targets: ['Church'] }
      })
    })

    await waitFor(() => {
      expect(screen.getByTestId('rendered-events')).toHaveTextContent('1')
    })
  })
})
