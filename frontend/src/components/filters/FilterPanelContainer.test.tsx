import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router'
import { FilterPanelContainer, ActiveFiltersBar } from './FilterPanelContainer'
import { useEvents } from '@/hooks/useEvents'
import { useArcs } from '@/hooks/useArcs'
import { useGlobalStore } from '@/stores/globalStore'
import type { Event, Arc, FilterState } from '@/types'

vi.mock('@/hooks/useEvents')
vi.mock('@/hooks/useArcs')

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

const renderHarness = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <FilterPanelContainer />
        <ActiveFiltersBar />
      </BrowserRouter>
    </QueryClientProvider>
  )
}

describe('FilterPanelContainer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useGlobalStore.setState({
      activeFilters: { ...defaultFilters },
      uiState: { ...useGlobalStore.getState().uiState, filterPanelOpen: true }
    })
    vi.mocked(useEvents).mockReturnValue(eventsResult({ data: events, isLoading: false, error: null }))
    vi.mocked(useArcs).mockReturnValue(arcsResult({ data: arcs, isLoading: false, error: null }))
  })

  it('renders the filter panel and search interface when the toolbar toggle is open', () => {
    renderHarness()

    expect(screen.getByRole('heading', { name: 'Filters' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Search events, arcs, or actors...')).toBeInTheDocument()
    expect(screen.getByText('Actors (0 selected)')).toBeInTheDocument()
  })

  it('writes a selected actor into the store and surfaces it as an active filter', async () => {
    renderHarness()

    fireEvent.click(screen.getByLabelText('William'))

    await waitFor(() => {
      expect(useGlobalStore.getState().activeFilters.actors).toEqual(['William'])
    })
    expect(screen.getByText('Active filters:')).toBeInTheDocument()
    expect(screen.getByText('Actor: William')).toBeInTheDocument()
  })

  it('writes the search query into the store', async () => {
    renderHarness()

    fireEvent.change(screen.getByPlaceholderText('Search events, arcs, or actors...'), {
      target: { value: 'hastings' }
    })

    await waitFor(() => {
      expect(useGlobalStore.getState().activeFilters.searchQuery).toBe('hastings')
    })
    expect(screen.getByText('Search: "hastings"')).toBeInTheDocument()
  })

  it('removes a single active filter value', async () => {
    useGlobalStore.setState({ activeFilters: { ...defaultFilters, actors: ['William'] } })
    renderHarness()

    fireEvent.click(screen.getByLabelText('Remove filter: Actor: William'))

    await waitFor(() => {
      expect(useGlobalStore.getState().activeFilters.actors).toEqual([])
    })
  })

  it('clears all filters from the active-filter strip', async () => {
    useGlobalStore.setState({ activeFilters: { ...defaultFilters, searchQuery: 'hastings' } })
    renderHarness()

    fireEvent.click(screen.getByText('Clear all'))

    await waitFor(() => {
      expect(useGlobalStore.getState().activeFilters).toEqual(defaultFilters)
    })
  })
})
