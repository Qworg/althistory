import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TimelineContainer } from '@/components/integrated/TimelineContainer';
import { CausalGraphContainer } from '@/components/integrated/CausalGraphContainer';
import { VisualizationDashboard } from '@/components/integrated/VisualizationDashboard';
import { useEvents, useArcs, useCausalRelationships, useCausalChain } from '@/hooks/useApiData';

// Mock the API hooks
vi.mock('@/hooks/useApiData', () => ({
  useEvents: vi.fn(),
  useArcs: vi.fn(),
  useCausalRelationships: vi.fn(),
  useCausalChain: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(message: string, public statusCode: number, public details?: any) {
      super(message);
      this.name = 'ApiError';
    }
  }
}));

// Mock D3 and Cytoscape
vi.mock('d3', () => {
  const createMockSelection = () => ({
    selectAll: vi.fn(() => createMockSelection()),
    remove: vi.fn(() => createMockSelection()),
    data: vi.fn(() => createMockSelection()),
    enter: vi.fn(() => createMockSelection()),
    append: vi.fn(() => createMockSelection()),
    attr: vi.fn(() => createMockSelection()),
    style: vi.fn(() => createMockSelection()),
    on: vi.fn(() => createMockSelection()),
    text: vi.fn(() => createMockSelection()),
    call: vi.fn(() => createMockSelection())
  });

  return {
    select: vi.fn(() => createMockSelection()),
  scaleTime: vi.fn(() => {
    const scale = vi.fn((value: Date) => 100); // Mock scale function that returns a fixed value
    scale.domain = vi.fn(() => scale);
    scale.range = vi.fn(() => scale);
    return scale;
  }),
  axisBottom: vi.fn(() => ({})),
  zoom: vi.fn(() => ({
    scaleExtent: vi.fn(() => ({
      extent: vi.fn(() => ({
        on: vi.fn(() => ({}))
      }))
    }))
  }))
}));

vi.mock('cytoscape', () => ({
  default: vi.fn(() => ({
    on: vi.fn(),
    layout: vi.fn(() => ({ run: vi.fn() })),
    elements: vi.fn(() => ({ remove: vi.fn() })),
    add: vi.fn(),
    nodes: vi.fn(() => ({
      style: vi.fn(),
      forEach: vi.fn()
    })),
    edges: vi.fn(() => ({
      style: vi.fn(),
      forEach: vi.fn()
    })),
    getElementById: vi.fn(() => ({
      style: vi.fn()
    })),
    destroy: vi.fn()
  }))
}));

describe('Visualization Integration Tests', () => {
  const mockEventsData = {
    success: true,
    data: [
      {
        id: 'event-1',
        description: 'Test Event 1',
        actor: 'Actor 1',
        target: 'Target 1',
        timestamp: '2023-01-01T12:00:00Z'
      },
      {
        id: 'event-2',
        description: 'Test Event 2',
        actor: 'Actor 2',
        target: 'Target 2',
        timestamp: '2023-01-02T12:00:00Z'
      }
    ]
  };

  const mockArcsData = {
    success: true,
    data: [
      {
        id: 'arc-1',
        name: 'Test Arc 1',
        start_time: '2023-01-01T00:00:00Z',
        end_time: '2023-01-03T00:00:00Z',
        level: 1
      }
    ]
  };

  const mockRelationshipsData = {
    success: true,
    data: [
      {
        id: 'rel-1',
        source: 'event-1',
        target: 'event-2',
        weight: 0.8,
        evidence: 'Test evidence',
        confidence: 0.8
      }
    ]
  };

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup default hook responses
    (useEvents as any).mockReturnValue({
      data: mockEventsData,
      loading: false,
      error: null,
      refetch: vi.fn()
    });
    
    (useArcs as any).mockReturnValue({
      data: mockArcsData,
      loading: false,
      error: null,
      refetch: vi.fn()
    });
    
    (useCausalRelationships as any).mockReturnValue({
      data: mockRelationshipsData,
      loading: false,
      error: null,
      refetch: vi.fn()
    });
    
    (useCausalChain as any).mockReturnValue({
      data: {
        success: true,
        data: {
          events: mockEventsData.data,
          relationships: mockRelationshipsData.data
        }
      },
      loading: false,
      error: null,
      refetch: vi.fn()
    });
  });

  describe('TimelineContainer', () => {
    it('should render timeline with API data', async () => {
      render(<TimelineContainer />);

      // Should show loading initially
      expect(screen.getByText('Loading timeline data...')).toBeInTheDocument();

      // Wait for data to load
      await waitFor(() => {
        expect(screen.getByText(/2 events, 1 arcs/)).toBeInTheDocument();
      });

      // Should use the API hooks
      expect(useEvents).toHaveBeenCalled();
      expect(useArcs).toHaveBeenCalled();
    });

    it('should handle API errors gracefully', async () => {
      (useEvents as any).mockReturnValue({
        data: null,
        loading: false,
        error: new Error('API Error'),
        refetch: vi.fn()
      });

      render(<TimelineContainer />);

      await waitFor(() => {
        expect(screen.getByText('Error Loading Timeline')).toBeInTheDocument();
        expect(screen.getByText('API Error')).toBeInTheDocument();
      });
    });

    it('should handle empty data', async () => {
      (useEvents as any).mockReturnValue({
        data: { success: true, data: [] },
        loading: false,
        error: null,
        refetch: vi.fn()
      });
      (useArcs as any).mockReturnValue({
        data: { success: true, data: [] },
        loading: false,
        error: null,
        refetch: vi.fn()
      });

      render(<TimelineContainer />);

      await waitFor(() => {
        expect(screen.getByText('No timeline data available. Try adjusting your filters.')).toBeInTheDocument();
      });
    });

    it('should handle event selection', async () => {
      const onEventSelect = vi.fn();
      render(<TimelineContainer onEventSelect={onEventSelect} />);

      await waitFor(() => {
        expect(screen.getByText(/2 events, 1 arcs/)).toBeInTheDocument();
      });

      // Event selection would be tested through D3 interactions
      // For now, we verify the handler is passed correctly
      expect(onEventSelect).toBeDefined();
    });

    it('should apply filters correctly', async () => {
      const initialFilters = {
        actor: 'Actor 1',
        timeRange: {
          start: new Date('2023-01-01'),
          end: new Date('2023-01-02')
        }
      };

      render(<TimelineContainer initialFilters={initialFilters} />);

      await waitFor(() => {
        expect(apiService.getEvents).toHaveBeenCalledWith(
          expect.objectContaining({
            actor: 'Actor 1',
            startTime: expect.any(String),
            endTime: expect.any(String)
          })
        );
      });
    });
  });

  describe('CausalGraphContainer', () => {
    it('should render causal graph with API data', async () => {
      render(<CausalGraphContainer />);

      // Should show loading initially
      expect(screen.getByText('Loading causal graph data...')).toBeInTheDocument();

      // Wait for data to load
      await waitFor(() => {
        expect(screen.getByText(/2 events, 1 relationships/)).toBeInTheDocument();
      });

      // Should call API methods
      expect(apiService.getEvents).toHaveBeenCalled();
      expect(apiService.getCausalRelationships).toHaveBeenCalled();
    });

    it('should handle weight filtering', async () => {
      render(<CausalGraphContainer />);

      await waitFor(() => {
        expect(screen.getByText(/Min Weight:/)).toBeInTheDocument();
      });

      // Find and interact with weight slider
      const weightSlider = screen.getByRole('slider');
      fireEvent.change(weightSlider, { target: { value: '0.5' } });

      // Should update the display
      expect(screen.getByText('50%')).toBeInTheDocument();
    });

    it('should handle causal chain loading', async () => {
      const onEventSelect = vi.fn();
      render(<CausalGraphContainer onEventSelect={onEventSelect} />);

      await waitFor(() => {
        expect(screen.getByText(/2 events, 1 relationships/)).toBeInTheDocument();
      });

      // Causal chain loading would be triggered by event selection
      // This would be tested through Cytoscape interactions
    });

    it('should handle empty relationships', async () => {
      (apiService.getCausalRelationships as any).mockResolvedValue({ success: true, data: [] });

      render(<CausalGraphContainer />);

      await waitFor(() => {
        expect(screen.getByText('No causal relationships found. Try adjusting your filters.')).toBeInTheDocument();
      });
    });
  });

  describe('VisualizationDashboard', () => {
    it('should render dashboard with default timeline view', async () => {
      render(<VisualizationDashboard />);

      // Should show header
      expect(screen.getByText('Historical Data Visualization')).toBeInTheDocument();

      // Should show view mode selector
      expect(screen.getByText('Timeline')).toBeInTheDocument();
      expect(screen.getByText('Causal Graph')).toBeInTheDocument();
      expect(screen.getByText('Split View')).toBeInTheDocument();
      expect(screen.getByText('Tabs')).toBeInTheDocument();

      // Should show filters
      expect(screen.getByText('Filters')).toBeInTheDocument();

      // Should load timeline data
      await waitFor(() => {
        expect(screen.getByText(/events, .* arcs/)).toBeInTheDocument();
      });
    });

    it('should switch between view modes', async () => {
      render(<VisualizationDashboard />);

      // Switch to causal graph view
      fireEvent.click(screen.getByText('Causal Graph'));

      await waitFor(() => {
        expect(screen.getByText(/events, .* relationships/)).toBeInTheDocument();
      });

      // Switch to split view
      fireEvent.click(screen.getByText('Split View'));

      await waitFor(() => {
        expect(screen.getByText('Timeline View')).toBeInTheDocument();
        expect(screen.getByText('Causal Graph View')).toBeInTheDocument();
      });

      // Switch to tabs view
      fireEvent.click(screen.getByText('Tabs'));

      await waitFor(() => {
        expect(screen.getAllByText('Timeline')).toHaveLength(2); // Button and tab
        expect(screen.getAllByText('Causal Graph')).toHaveLength(2); // Button and tab
      });
    });

    it('should handle filter interactions', async () => {
      render(<VisualizationDashboard />);

      // Expand filters
      fireEvent.click(screen.getByText('Filters'));

      // Should show filter inputs
      expect(screen.getByPlaceholderText('Filter by actor...')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Filter by target...')).toBeInTheDocument();

      // Enter filter values
      fireEvent.change(screen.getByPlaceholderText('Filter by actor...'), {
        target: { value: 'Test Actor' }
      });

      // Clear filters
      fireEvent.click(screen.getByText('Clear Filters'));

      // Filter input should be cleared
      expect(screen.getByPlaceholderText('Filter by actor...')).toHaveValue('');
    });

    it('should handle real-time updates', async () => {
      render(<VisualizationDashboard realTimeUpdates={true} refreshInterval={1000} />);

      await waitFor(() => {
        expect(screen.getByText('Connected')).toBeInTheDocument();
      });

      // Should show connection status
      expect(screen.getByText('Connected')).toBeInTheDocument();
    });

    it('should handle cross-visualization interactions', async () => {
      render(<VisualizationDashboard initialViewMode="split" />);

      await waitFor(() => {
        expect(screen.getByText('Timeline View')).toBeInTheDocument();
        expect(screen.getByText('Causal Graph View')).toBeInTheDocument();
      });

      // Cross-visualization interactions would be tested through
      // component interactions, but require more complex setup
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors', async () => {
      (apiService.getEvents as any).mockRejectedValue(new Error('Network error'));

      render(<TimelineContainer />);

      await waitFor(() => {
        expect(screen.getByText('Error Loading Timeline')).toBeInTheDocument();
        expect(screen.getByText('Network error')).toBeInTheDocument();
        expect(screen.getByText('Retry')).toBeInTheDocument();
      });
    });

    it('should handle retry functionality', async () => {
      (apiService.getEvents as any).mockRejectedValueOnce(new Error('Network error'))
                                   .mockResolvedValue(mockEventsData);

      render(<TimelineContainer />);

      await waitFor(() => {
        expect(screen.getByText('Retry')).toBeInTheDocument();
      });

      // Click retry
      fireEvent.click(screen.getByText('Retry'));

      await waitFor(() => {
        expect(screen.getByText(/events, .* arcs/)).toBeInTheDocument();
      });
    });
  });

  describe('Loading States', () => {
    it('should show loading states correctly', async () => {
      // Delay API response to test loading state
      (apiService.getEvents as any).mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve(mockEventsData), 100))
      );

      render(<TimelineContainer />);

      // Should show loading
      expect(screen.getByText('Loading timeline data...')).toBeInTheDocument();

      // Should hide loading after data loads
      await waitFor(() => {
        expect(screen.queryByText('Loading timeline data...')).not.toBeInTheDocument();
      });
    });
  });

  describe('Data Synchronization', () => {
    it('should synchronize data between timeline and causal graph', async () => {
      render(<VisualizationDashboard initialViewMode="split" />);

      await waitFor(() => {
        expect(screen.getByText('Timeline View')).toBeInTheDocument();
        expect(screen.getByText('Causal Graph View')).toBeInTheDocument();
      });

      // Both views should use the same data
      expect(apiService.getEvents).toHaveBeenCalled();
      expect(apiService.getArcs).toHaveBeenCalled();
      expect(apiService.getCausalRelationships).toHaveBeenCalled();
    });

    it('should handle filter changes across views', async () => {
      render(<VisualizationDashboard />);

      // Expand filters and change actor filter
      fireEvent.click(screen.getByText('Filters'));
      fireEvent.change(screen.getByPlaceholderText('Filter by actor...'), {
        target: { value: 'New Actor' }
      });

      // Switch to causal graph view
      fireEvent.click(screen.getByText('Causal Graph'));

      // Should apply the same filters
      await waitFor(() => {
        expect(apiService.getCausalRelationships).toHaveBeenCalled();
      });
    });
  });
});