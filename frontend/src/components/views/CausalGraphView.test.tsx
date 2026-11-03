import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
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
  CausalGraphComponent: ({ events, causalRelationships, focusEventId, onNodeClick, onNodeContextMenu, onRelationshipContextMenu }: CausalGraphComponentProps) => (
    <div data-testid="causal-graph-component">
      {events?.[0] && (
        <button data-testid="context-first-event" onClick={() => onNodeContextMenu?.(events[0]!, { x: 10, y: 10 })}>
          Event menu
        </button>
      )}
      {causalRelationships?.[0] && (
        <button data-testid="context-first-link" onClick={() => onRelationshipContextMenu?.(causalRelationships[0]!, { x: 10, y: 10 })}>
          Link menu
        </button>
      )}
      <span data-testid="rendered-events-count">{events?.length ?? 0}</span>
      <span data-testid="rendered-rel-count">{causalRelationships?.length ?? 0}</span>
      <span data-testid="focus-event-id">{focusEventId ?? ''}</span>
      {events?.[0] && (
        <button data-testid="select-first-event" onClick={() => onNodeClick?.(events[0]!)}>
          Select First
        </button>
      )}
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

  it('forwards selected event id as focusEventId to CausalGraphComponent', () => {
    mockUseEvents.mockReturnValue({
      data: sampleEvents,
      isLoading: false
    } as unknown as ReturnType<typeof useEvents>)
    mockUseCausalRelationships.mockReturnValue({
      data: sampleRelationships,
      isLoading: false
    } as unknown as ReturnType<typeof useCausalRelationships>)

    renderWithClient(<CausalGraphView />)

    expect(screen.getByTestId('focus-event-id')).toHaveTextContent('')
    fireEvent.click(screen.getByTestId('select-first-event'))
    expect(screen.getByTestId('focus-event-id')).toHaveTextContent('e1')
  })

  it('titles the view on the shared scale and names the selected event by what happened', () => {
    mockUseEvents.mockReturnValue({
      data: sampleEvents,
      isLoading: false
    } as unknown as ReturnType<typeof useEvents>)
    mockUseCausalRelationships.mockReturnValue({
      data: sampleRelationships,
      isLoading: false
    } as unknown as ReturnType<typeof useCausalRelationships>)

    renderWithClient(<CausalGraphView />)

    // The breadcrumb and navigation name the view; the heading is for the outline.
    const title = screen.getByRole('heading', { level: 2, name: 'Causal Graph' })
    expect(title).toHaveClass('sr-only')

    // The inspector beside the graph describes the selection
    const inspector = screen.getByTestId('causal-inspector')
    expect(inspector).toHaveTextContent(/Select an event on the graph/)
    fireEvent.click(screen.getByTestId('select-first-event'))
    expect(within(inspector).getByText('Event One')).toBeInTheDocument()
    expect(within(inspector).getByText(/Actor A → Target B/)).toBeInTheDocument()
  })

  describe('delete confirmation', () => {
    beforeEach(() => {
      mockUseEvents.mockReturnValue({ data: sampleEvents, isLoading: false } as unknown as ReturnType<typeof useEvents>)
      mockUseCausalRelationships.mockReturnValue({
        data: sampleRelationships,
        isLoading: false
      } as unknown as ReturnType<typeof useCausalRelationships>)
    })

    it('names the event, says its links go with it, and says how to get it back', () => {
      renderWithClient(<CausalGraphView />)
      fireEvent.click(screen.getByTestId('context-first-event'))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))

      const dialog = screen.getByRole('dialog')
      expect(dialog).toHaveTextContent('Delete event')
      expect(dialog).toHaveTextContent('Delete “Event One”? Its causal link goes with it.')
      expect(dialog).toHaveTextContent('Version history keeps the graph as it was, so you can restore it from Versions.')
      expect(dialog).not.toHaveTextContent(/cannot be undone/i)
    })

    it('names a link by its cause and effect', () => {
      renderWithClient(<CausalGraphView />)
      fireEvent.click(screen.getByTestId('context-first-link'))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))

      const dialog = screen.getByRole('dialog')
      expect(dialog).toHaveTextContent('Delete link')
      expect(dialog).toHaveTextContent('Delete the link from “Event One” to “Event Two”?')
      expect(dialog).not.toHaveTextContent(/cannot be undone/i)
    })
  })

  it('says how Draw Link works in the cue line', () => {
    mockUseEvents.mockReturnValue({ data: sampleEvents, isLoading: false } as unknown as ReturnType<typeof useEvents>)
    mockUseCausalRelationships.mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<typeof useCausalRelationships>)
    renderWithClient(<CausalGraphView />)
    expect(screen.getByText(/Draw Link \(D\) links two selected events, or the cause and effect you click next/)).toBeInTheDocument()
  })
})
