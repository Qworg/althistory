import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { GraphCopyModal } from './GraphCopyModal'
import { useGlobalStore } from '@/stores/globalStore'
import { useGraphCopy } from '@/hooks/useGraphCopy'
import { Event, Arc } from '@/types'

// Mock the hooks
vi.mock('@/stores/globalStore')
vi.mock('@/hooks/useGraphCopy')

const mockEvents: Event[] = [
  {
    id: '1',
    description: 'Event 1',
    actor: 'Actor A',
    target: 'Target X',
    timestamp: '2023-01-01T00:00:00Z',
    created_at: '2023-01-01T00:00:00Z',
    updated_at: '2023-01-01T00:00:00Z'
  },
  {
    id: '2',
    description: 'Event 2',
    actor: 'Actor B',
    target: 'Target Y',
    timestamp: '2023-06-01T00:00:00Z',
    created_at: '2023-06-01T00:00:00Z',
    updated_at: '2023-06-01T00:00:00Z'
  }
]

const mockArcs: Arc[] = [
  {
    id: '1',
    name: 'Arc 1',
    description: 'Test arc',
    start_time: '2023-01-01T00:00:00Z',
    end_time: '2023-12-31T00:00:00Z',
    parent_arc_id: null,
    created_at: '2023-01-01T00:00:00Z',
    updated_at: '2023-01-01T00:00:00Z'
  }
]

const mockUseGlobalStore = {
  events: mockEvents,
  arcs: mockArcs,
  activeFilters: {
    dateRange: null,
    actors: ['Actor A'],
    targets: ['Target X'],
    eventTypes: [],
    arcLevels: [],
    causalWeightRange: [0, 1] as [number, number],
    confidenceThreshold: 0.5,
    searchQuery: ''
  }
}

const mockUseGraphCopy = {
  copyState: {
    activeOperations: [],
    completedOperations: [],
    selectedTimeRange: null,
    selectedFilter: null,
    copyName: '',
    isCreatingCopy: false
  },
  setCopyName: vi.fn(),
  setSelectedTimeRange: vi.fn(),
  setSelectedFilter: vi.fn(),
  createFullCopy: vi.fn(),
  createTimeRangeCopy: vi.fn(),
  createFilteredCopy: vi.fn(),
  isCreatingCopy: false
}

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  })
  
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}

describe('GraphCopyModal', () => {
  const mockOnClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    ;(useGlobalStore as any).mockReturnValue(mockUseGlobalStore)
    ;(useGraphCopy as any).mockReturnValue(mockUseGraphCopy)
  })

  it('should not render when closed', () => {
    render(
      <GraphCopyModal isOpen={false} onClose={mockOnClose} />,
      { wrapper: createWrapper() }
    )

    expect(screen.queryByText('Create Graph Copy')).not.toBeInTheDocument()
  })

  it('should render when open', () => {
    render(
      <GraphCopyModal isOpen={true} onClose={mockOnClose} />,
      { wrapper: createWrapper() }
    )

    expect(screen.getByText('Create Graph Copy')).toBeInTheDocument()
    expect(screen.getByLabelText('Copy Name *')).toBeInTheDocument()
    expect(screen.getByText('Full Graph Copy')).toBeInTheDocument()
    expect(screen.getByText('Time Range Copy')).toBeInTheDocument()
    expect(screen.getByText('Filtered Copy')).toBeInTheDocument()
  })

  it('should update copy name when input changes', async () => {
    const user = userEvent.setup()
    
    render(
      <GraphCopyModal isOpen={true} onClose={mockOnClose} />,
      { wrapper: createWrapper() }
    )

    const nameInput = screen.getByLabelText('Copy Name *')
    await user.type(nameInput, 'My Test Copy')

    expect(mockUseGraphCopy.setCopyName).toHaveBeenCalledWith('My Test Copy')
  })

  it('should show event and arc counts for full copy', () => {
    render(
      <GraphCopyModal isOpen={true} onClose={mockOnClose} />,
      { wrapper: createWrapper() }
    )

    expect(screen.getByText(/2 events, 1 arcs/)).toBeInTheDocument()
  })

  it('should show time range inputs when time range copy is selected', async () => {
    const user = userEvent.setup()
    
    render(
      <GraphCopyModal isOpen={true} onClose={mockOnClose} />,
      { wrapper: createWrapper() }
    )

    const timeRangeRadio = screen.getByLabelText(/Time Range Copy/)
    await user.click(timeRangeRadio)

    expect(screen.getByText('Time Range Selection')).toBeInTheDocument()
    expect(screen.getByLabelText('Start Date')).toBeInTheDocument()
    expect(screen.getByLabelText('End Date')).toBeInTheDocument()
  })

  it('should show filter configuration when filtered copy is selected', async () => {
    const user = userEvent.setup()
    
    render(
      <GraphCopyModal isOpen={true} onClose={mockOnClose} />,
      { wrapper: createWrapper() }
    )

    const filteredRadio = screen.getByLabelText(/Filtered Copy/)
    await user.click(filteredRadio)

    expect(screen.getByText('Filter Configuration')).toBeInTheDocument()
    expect(screen.getByText('Use Current Filters')).toBeInTheDocument()
    expect(screen.getByText('Actors')).toBeInTheDocument()
    expect(screen.getByText('Targets')).toBeInTheDocument()
    expect(screen.getByText(/Confidence Threshold/)).toBeInTheDocument()
  })

  it('should populate filter configuration with current filters', async () => {
    const user = userEvent.setup()
    
    render(
      <GraphCopyModal isOpen={true} onClose={mockOnClose} />,
      { wrapper: createWrapper() }
    )

    const filteredRadio = screen.getByLabelText(/Filtered Copy/)
    await user.click(filteredRadio)

    const useCurrentFiltersButton = screen.getByText('Use Current Filters')
    await user.click(useCurrentFiltersButton)

    expect(mockUseGraphCopy.setSelectedFilter).toHaveBeenCalledWith({
      actors: ['Actor A'],
      targets: ['Target X'],
      event_types: [],
      confidence_threshold: 0.5
    })
  })

  it('should call createFullCopy when creating full copy', async () => {
    const user = userEvent.setup()
    
    // Mock copy name being set
    const mockCopyStateWithName = {
      ...mockUseGraphCopy.copyState,
      copyName: 'Test Copy'
    }
    ;(useGraphCopy as any).mockReturnValue({
      ...mockUseGraphCopy,
      copyState: mockCopyStateWithName
    })

    render(
      <GraphCopyModal isOpen={true} onClose={mockOnClose} />,
      { wrapper: createWrapper() }
    )

    const createButton = screen.getByText('Create Copy')
    await user.click(createButton)

    expect(mockUseGraphCopy.createFullCopy).toHaveBeenCalled()
  })

  it('should call createTimeRangeCopy when creating time range copy', async () => {
    const user = userEvent.setup()
    
    // Mock copy name being set
    const mockCopyStateWithName = {
      ...mockUseGraphCopy.copyState,
      copyName: 'Test Copy'
    }
    ;(useGraphCopy as any).mockReturnValue({
      ...mockUseGraphCopy,
      copyState: mockCopyStateWithName
    })

    render(
      <GraphCopyModal isOpen={true} onClose={mockOnClose} />,
      { wrapper: createWrapper() }
    )

    // Select time range copy
    const timeRangeRadio = screen.getByLabelText(/Time Range Copy/)
    await user.click(timeRangeRadio)

    const createButton = screen.getByText('Create Copy')
    await user.click(createButton)

    expect(mockUseGraphCopy.createTimeRangeCopy).toHaveBeenCalled()
  })

  it('should call createFilteredCopy when creating filtered copy', async () => {
    const user = userEvent.setup()
    
    // Mock copy name being set
    const mockCopyStateWithName = {
      ...mockUseGraphCopy.copyState,
      copyName: 'Test Copy'
    }
    ;(useGraphCopy as any).mockReturnValue({
      ...mockUseGraphCopy,
      copyState: mockCopyStateWithName
    })

    render(
      <GraphCopyModal isOpen={true} onClose={mockOnClose} />,
      { wrapper: createWrapper() }
    )

    // Select filtered copy
    const filteredRadio = screen.getByLabelText(/Filtered Copy/)
    await user.click(filteredRadio)

    const createButton = screen.getByText('Create Copy')
    await user.click(createButton)

    expect(mockUseGraphCopy.createFilteredCopy).toHaveBeenCalled()
  })

  it('should disable create button when copy name is empty', () => {
    render(
      <GraphCopyModal isOpen={true} onClose={mockOnClose} />,
      { wrapper: createWrapper() }
    )

    const createButton = screen.getByText('Create Copy')
    expect(createButton).toBeDisabled()
  })

  it('should show loading state when creating copy', () => {
    ;(useGraphCopy as any).mockReturnValue({
      ...mockUseGraphCopy,
      isCreatingCopy: true
    })

    render(
      <GraphCopyModal isOpen={true} onClose={mockOnClose} />,
      { wrapper: createWrapper() }
    )

    expect(screen.getByText('Creating Copy...')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Creating Copy/ })).toBeDisabled()
  })

  it('should close modal when close button is clicked', async () => {
    const user = userEvent.setup()
    
    render(
      <GraphCopyModal isOpen={true} onClose={mockOnClose} />,
      { wrapper: createWrapper() }
    )

    const closeButton = screen.getByRole('button', { name: /close/i })
    await user.click(closeButton)

    expect(mockOnClose).toHaveBeenCalled()
  })

  it('should close modal when cancel button is clicked', async () => {
    const user = userEvent.setup()
    
    render(
      <GraphCopyModal isOpen={true} onClose={mockOnClose} />,
      { wrapper: createWrapper() }
    )

    const cancelButton = screen.getByText('Cancel')
    await user.click(cancelButton)

    expect(mockOnClose).toHaveBeenCalled()
  })

  it('should show unique actors and targets in filter dropdowns', async () => {
    const user = userEvent.setup()
    
    render(
      <GraphCopyModal isOpen={true} onClose={mockOnClose} />,
      { wrapper: createWrapper() }
    )

    // Select filtered copy to show filter options
    const filteredRadio = screen.getByLabelText(/Filtered Copy/)
    await user.click(filteredRadio)

    // Check that unique actors are shown
    const actorsSelect = screen.getByLabelText('Actors')
    expect(actorsSelect).toBeInTheDocument()
    
    // Check that unique targets are shown
    const targetsSelect = screen.getByLabelText('Targets')
    expect(targetsSelect).toBeInTheDocument()
  })

  it('should update confidence threshold when slider changes', async () => {
    const user = userEvent.setup()
    
    render(
      <GraphCopyModal isOpen={true} onClose={mockOnClose} />,
      { wrapper: createWrapper() }
    )

    // Select filtered copy to show filter options
    const filteredRadio = screen.getByLabelText(/Filtered Copy/)
    await user.click(filteredRadio)

    const confidenceSlider = screen.getByRole('slider')
    fireEvent.change(confidenceSlider, { target: { value: '0.8' } })

    // The component should update its internal state
    // We can't easily test the internal state change without more complex mocking
    expect(confidenceSlider).toHaveValue('0.8')
  })
})