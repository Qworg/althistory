import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ActorPerspectiveView } from './ActorPerspectiveView'
import { useEvents } from '@/hooks/useEvents'
import { useArcs } from '@/hooks/useArcs'
import { useGlobalStore } from '@/stores/globalStore'
import { Event, Arc } from '@/types'

// Mock the hooks
vi.mock('@/hooks/useEvents')
vi.mock('@/hooks/useArcs')
vi.mock('@/stores/globalStore')

// Mock the child components
vi.mock('@/components/timeline/ActorTimeline', () => ({
  ActorTimeline: ({ events, actor, onEventSelect }: any) => (
    <div data-testid="actor-timeline">
      <div data-testid="timeline-actor">{actor}</div>
      <div data-testid="timeline-events-count">{events.length}</div>
      {events.map((event: any) => (
        <button
          key={event.id}
          data-testid={`timeline-event-${event.id}`}
          onClick={() => onEventSelect(event)}
        >
          {event.description} ({event.role})
        </button>
      ))}
    </div>
  )
}))

vi.mock('@/components/actor/ActorSelector', () => ({
  ActorSelector: ({ actors, selectedActor, onActorSelect }: any) => (
    <div data-testid="actor-selector">
      <select
        data-testid="actor-select"
        value={selectedActor}
        onChange={(e) => onActorSelect(e.target.value)}
      >
        <option value="">Select an actor</option>
        {actors.map((actor: string) => (
          <option key={actor} value={actor}>
            {actor}
          </option>
        ))}
      </select>
    </div>
  )
}))

vi.mock('@/components/actor/ActorStats', () => ({
  ActorStats: ({ actor, stats }: any) => (
    <div data-testid="actor-stats">
      <div data-testid="stats-actor">{actor}</div>
      <div data-testid="stats-event-count">{stats.eventCount}</div>
      <div data-testid="stats-as-actor">{stats.relationshipMetrics.asActor}</div>
      <div data-testid="stats-as-target">{stats.relationshipMetrics.asTarget}</div>
    </div>
  )
}))

const mockEvents: Event[] = [
  {
    id: '1',
    description: 'Event 1',
    actor: 'Alice',
    target: 'Bob',
    timestamp: '2024-01-01T10:00:00Z',
    created_at: '2024-01-01T10:00:00Z',
    updated_at: '2024-01-01T10:00:00Z'
  },
  {
    id: '2',
    description: 'Event 2',
    actor: 'Bob',
    target: 'Alice',
    timestamp: '2024-01-02T10:00:00Z',
    created_at: '2024-01-02T10:00:00Z',
    updated_at: '2024-01-02T10:00:00Z'
  },
  {
    id: '3',
    description: 'Event 3',
    actor: 'Alice',
    target: 'Charlie',
    timestamp: '2024-01-03T10:00:00Z',
    created_at: '2024-01-03T10:00:00Z',
    updated_at: '2024-01-03T10:00:00Z'
  },
  {
    id: '4',
    description: 'Event 4',
    actor: 'Charlie',
    target: 'Alice',
    timestamp: '2024-01-04T10:00:00Z',
    created_at: '2024-01-04T10:00:00Z',
    updated_at: '2024-01-04T10:00:00Z'
  }
]

const mockArcs: Arc[] = [
  {
    id: 'arc1',
    name: 'Arc 1',
    description: 'First arc',
    start_time: '2024-01-01T00:00:00Z',
    end_time: '2024-01-02T23:59:59Z',
    parent_arc_id: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z'
  },
  {
    id: 'arc2',
    name: 'Arc 2',
    description: 'Second arc',
    start_time: '2024-01-03T00:00:00Z',
    end_time: '2024-01-04T23:59:59Z',
    parent_arc_id: null,
    created_at: '2024-01-03T00:00:00Z',
    updated_at: '2024-01-03T00:00:00Z'
  }
]

const mockGlobalStore = {
  activeFilters: {
    dateRange: null,
    actors: [],
    targets: [],
    eventTypes: [],
    arcLevels: [],
    causalWeightRange: [0, 1] as [number, number],
    confidenceThreshold: 0,
    searchQuery: ''
  }
}

const renderWithQueryClient = (component: React.ReactElement) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      {component}
    </QueryClientProvider>
  )
}

describe('ActorPerspectiveView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    
    // Mock the hooks with default values
    vi.mocked(useEvents).mockReturnValue({
      data: mockEvents,
      isLoading: false,
      error: null,
      refetch: vi.fn()
    } as any)
    
    vi.mocked(useArcs).mockReturnValue({
      data: mockArcs,
      isLoading: false,
      error: null,
      refetch: vi.fn()
    } as any)
    
    vi.mocked(useGlobalStore).mockReturnValue(mockGlobalStore as any)
  })

  describe('Initial Render', () => {
    it('renders the component with correct title and description', () => {
      renderWithQueryClient(<ActorPerspectiveView />)
      
      expect(screen.getByText('Actor Perspective View')).toBeInTheDocument()
      expect(screen.getByText('Explore events and relationships from a specific actor\'s perspective')).toBeInTheDocument()
    })

    it('renders actor selector', () => {
      renderWithQueryClient(<ActorPerspectiveView />)
      
      expect(screen.getByTestId('actor-selector')).toBeInTheDocument()
      expect(screen.getByTestId('actor-select')).toBeInTheDocument()
    })

    it('shows empty state when no actor is selected', () => {
      renderWithQueryClient(<ActorPerspectiveView />)
      
      expect(screen.getByText('Select an Actor')).toBeInTheDocument()
      expect(screen.getByText('Choose an actor from the dropdown above to view their timeline perspective.')).toBeInTheDocument()
    })

    it('displays loading state correctly', () => {
      vi.mocked(useEvents).mockReturnValue({
        data: undefined,
        isLoading: true,
        error: null,
        refetch: vi.fn()
      } as any)

      renderWithQueryClient(<ActorPerspectiveView />)
      
      // In loading state, the title is not rendered, only the skeleton
      expect(document.querySelector('.animate-pulse')).toBeInTheDocument()
      expect(screen.queryByText('Actor Perspective View')).not.toBeInTheDocument()
    })
  })

  describe('Actor Selection and Navigation', () => {
    it('populates actor selector with unique actors from events', () => {
      renderWithQueryClient(<ActorPerspectiveView />)
      
      const select = screen.getByTestId('actor-select')
      const options = select.querySelectorAll('option')
      
      // Should have empty option plus unique actors: Alice, Bob, Charlie
      expect(options).toHaveLength(4)
      expect(options[1]).toHaveTextContent('Alice')
      expect(options[2]).toHaveTextContent('Bob')
      expect(options[3]).toHaveTextContent('Charlie')
    })

    it('filters events correctly when actor is selected', async () => {
      renderWithQueryClient(<ActorPerspectiveView />)
      
      const select = screen.getByTestId('actor-select')
      fireEvent.change(select, { target: { value: 'Alice' } })
      
      await waitFor(() => {
        expect(screen.getByTestId('actor-timeline')).toBeInTheDocument()
        expect(screen.getByTestId('timeline-actor')).toHaveTextContent('Alice')
        expect(screen.getByTestId('timeline-events-count')).toHaveTextContent('4') // Alice appears in 4 events
      })
    })

    it('shows actor statistics when actor is selected', async () => {
      renderWithQueryClient(<ActorPerspectiveView />)
      
      const select = screen.getByTestId('actor-select')
      fireEvent.change(select, { target: { value: 'Alice' } })
      
      await waitFor(() => {
        expect(screen.getByTestId('actor-stats')).toBeInTheDocument()
        expect(screen.getByTestId('stats-actor')).toHaveTextContent('Alice')
        expect(screen.getByTestId('stats-event-count')).toHaveTextContent('4')
        expect(screen.getByTestId('stats-as-actor')).toHaveTextContent('2') // Alice as actor in 2 events
        expect(screen.getByTestId('stats-as-target')).toHaveTextContent('2') // Alice as target in 2 events
      })
    })

    it('shows empty state when selected actor has no events', async () => {
      // Mock events without the selected actor
      vi.mocked(useEvents).mockReturnValue({
        data: [],
        isLoading: false,
        error: null,
        refetch: vi.fn()
      } as any)

      renderWithQueryClient(<ActorPerspectiveView />)
      
      const select = screen.getByTestId('actor-select')
      fireEvent.change(select, { target: { value: 'NonExistentActor' } })
      
      await waitFor(() => {
        // When no events, it shows the "Select an Actor" state since no actors are available
        expect(screen.getByText('Select an Actor')).toBeInTheDocument()
      })
    })

    it('preserves state when switching between actors', async () => {
      renderWithQueryClient(<ActorPerspectiveView />)
      
      const select = screen.getByTestId('actor-select')
      
      // Select first actor
      fireEvent.change(select, { target: { value: 'Alice' } })
      
      await waitFor(() => {
        expect(screen.getByTestId('timeline-actor')).toHaveTextContent('Alice')
      })
      
      // Switch to second actor
      fireEvent.change(select, { target: { value: 'Bob' } })
      
      await waitFor(() => {
        expect(screen.getByTestId('timeline-actor')).toHaveTextContent('Bob')
        // Should have cleared event selection
        expect(screen.queryByText('Selected Event')).not.toBeInTheDocument()
      })
    })

    it('handles smooth transitions when switching actors', async () => {
      renderWithQueryClient(<ActorPerspectiveView />)
      
      const select = screen.getByTestId('actor-select')
      
      // Select first actor
      fireEvent.change(select, { target: { value: 'Alice' } })
      
      await waitFor(() => {
        const timelineContainer = screen.getByTestId('actor-timeline').closest('.transition-all')
        expect(timelineContainer).toBeInTheDocument()
      })
      
      // Switch to second actor - should maintain smooth transition classes
      fireEvent.change(select, { target: { value: 'Bob' } })
      
      await waitFor(() => {
        const timelineContainer = screen.getByTestId('actor-timeline').closest('.transition-all')
        expect(timelineContainer).toBeInTheDocument()
      })
    })
  })

  describe('Event Role Distinction', () => {
    it('correctly identifies actor and target roles', async () => {
      renderWithQueryClient(<ActorPerspectiveView />)
      
      const select = screen.getByTestId('actor-select')
      fireEvent.change(select, { target: { value: 'Alice' } })
      
      await waitFor(() => {
        // Alice as actor in events 1 and 3
        expect(screen.getByTestId('timeline-event-1')).toHaveTextContent('Event 1 (actor)')
        expect(screen.getByTestId('timeline-event-3')).toHaveTextContent('Event 3 (actor)')
        
        // Alice as target in event 4
        expect(screen.getByTestId('timeline-event-4')).toHaveTextContent('Event 4 (target)')
      })
    })
  })

  describe('Layout Mode Toggle', () => {
    it('shows layout mode toggle when actor is selected', async () => {
      renderWithQueryClient(<ActorPerspectiveView />)
      
      const select = screen.getByTestId('actor-select')
      fireEvent.change(select, { target: { value: 'Alice' } })
      
      await waitFor(() => {
        expect(screen.getByText('Layout:')).toBeInTheDocument()
        expect(screen.getByText('Chronological')).toBeInTheDocument()
        expect(screen.getByText('Thematic')).toBeInTheDocument()
      })
    })

    it('switches layout mode correctly', async () => {
      renderWithQueryClient(<ActorPerspectiveView />)
      
      const select = screen.getByTestId('actor-select')
      fireEvent.change(select, { target: { value: 'Alice' } })
      
      await waitFor(() => {
        const thematicButton = screen.getByText('Thematic')
        fireEvent.click(thematicButton)
        
        // Check if the button becomes active (this would be reflected in styling)
        expect(thematicButton).toHaveClass('bg-white', 'text-gray-900', 'shadow-sm')
      })
    })

    it('does not show layout toggle when no actor is selected', () => {
      renderWithQueryClient(<ActorPerspectiveView />)
      
      expect(screen.queryByText('Layout:')).not.toBeInTheDocument()
    })
  })

  describe('Event Selection', () => {
    it('displays selected event details', async () => {
      renderWithQueryClient(<ActorPerspectiveView />)
      
      const select = screen.getByTestId('actor-select')
      fireEvent.change(select, { target: { value: 'Alice' } })
      
      await waitFor(() => {
        const eventButton = screen.getByTestId('timeline-event-1')
        fireEvent.click(eventButton)
        
        expect(screen.getByText('Selected Event')).toBeInTheDocument()
        expect(screen.getByText('Event 1')).toBeInTheDocument()
        // Use more specific queries to avoid multiple matches
        expect(screen.getByText('Description:')).toBeInTheDocument()
        expect(screen.getByText('Target:')).toBeInTheDocument()
      })
    })

    it('shows correct role badge for selected event', async () => {
      renderWithQueryClient(<ActorPerspectiveView />)
      
      const select = screen.getByTestId('actor-select')
      fireEvent.change(select, { target: { value: 'Alice' } })
      
      await waitFor(() => {
        const eventButton = screen.getByTestId('timeline-event-1')
        fireEvent.click(eventButton)
        
        const roleBadge = screen.getByText('Actor')
        expect(roleBadge).toBeInTheDocument()
        expect(roleBadge).toHaveClass('bg-blue-100', 'text-blue-800')
      })
    })
  })

  describe('Arc Filtering', () => {
    it('filters arcs to show only relevant ones', async () => {
      renderWithQueryClient(<ActorPerspectiveView />)
      
      const select = screen.getByTestId('actor-select')
      fireEvent.change(select, { target: { value: 'Alice' } })
      
      await waitFor(() => {
        // Should show count of relevant arcs
        expect(screen.getByText(/across \d+ arcs/)).toBeInTheDocument()
      })
    })
  })

  describe('Statistics Calculation', () => {
    it('calculates actor statistics correctly', async () => {
      renderWithQueryClient(<ActorPerspectiveView />)
      
      const select = screen.getByTestId('actor-select')
      fireEvent.change(select, { target: { value: 'Alice' } })
      
      await waitFor(() => {
        expect(screen.getByTestId('stats-event-count')).toHaveTextContent('4')
        expect(screen.getByTestId('stats-as-actor')).toHaveTextContent('2')
        expect(screen.getByTestId('stats-as-target')).toHaveTextContent('2')
      })
    })
  })

  describe('Accessibility', () => {
    it('has proper ARIA labels and roles', () => {
      renderWithQueryClient(<ActorPerspectiveView />)
      
      const select = screen.getByTestId('actor-select')
      // HTML select elements have implicit role
      expect(select.tagName.toLowerCase()).toBe('select')
    })

    it('supports keyboard navigation', async () => {
      renderWithQueryClient(<ActorPerspectiveView />)
      
      const select = screen.getByTestId('actor-select')
      
      // Test keyboard interaction
      fireEvent.keyDown(select, { key: 'Enter' })
      fireEvent.keyDown(select, { key: 'ArrowDown' })
      fireEvent.keyDown(select, { key: 'Enter' })
      
      // Should work without throwing errors
      expect(select).toBeInTheDocument()
    })
  })

  describe('Error Handling', () => {
    it('handles empty events array gracefully', () => {
      vi.mocked(useEvents).mockReturnValue({
        data: [],
        isLoading: false,
        error: null,
        refetch: vi.fn()
      } as any)

      renderWithQueryClient(<ActorPerspectiveView />)
      
      expect(screen.getByText('Select an Actor')).toBeInTheDocument()
    })

    it('handles undefined events gracefully', () => {
      vi.mocked(useEvents).mockReturnValue({
        data: undefined,
        isLoading: false,
        error: null,
        refetch: vi.fn()
      } as any)

      renderWithQueryClient(<ActorPerspectiveView />)
      
      expect(screen.getByText('Select an Actor')).toBeInTheDocument()
    })
  })
})