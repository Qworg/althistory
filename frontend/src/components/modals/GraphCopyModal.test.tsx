import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { GraphCopyModal } from './GraphCopyModal'
import { useGlobalStore } from '@/stores/globalStore'
import { useGraphCopy } from '@/hooks/useGraphCopy'
import { useActiveGraph, useBranchGraph, useSwitchGraph } from '@/hooks/useGraphs'
import { useEvents, useArcs } from '@/hooks/useAPI'
import { Event, Arc, Graph } from '@/types'

// Mock the hooks
vi.mock('@/stores/globalStore')
vi.mock('@/hooks/useGraphCopy')
vi.mock('@/hooks/useGraphs')
vi.mock('@/hooks/useAPI')

const activeGraph: Graph = {
  id: 'graph-main',
  name: 'The Engine Age',
  description: '',
  status: 'active',
  version: 2,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  metadata: { eventCount: 2, arcCount: 1, relationshipCount: 0, pressureCount: 0 },
}
const branchMutateAsync = vi.fn()
const switchMutate = vi.fn()

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
    level: 0,
    parent_arc_id: null,
    created_at: '2023-01-01T00:00:00Z',
    updated_at: '2023-01-01T00:00:00Z'
  }
]

// The views read events and arcs through React Query; the store's own lists
// are never filled, so the store double deliberately leaves them empty.
const mockUseGlobalStore = {
  events: [],
  arcs: [],
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

type GlobalStoreState = ReturnType<typeof useGlobalStore>
type GraphCopyHook = ReturnType<typeof useGraphCopy>

/**
 * The store double only carries the slice the modal reads, so the seam with the
 * automocked `useGlobalStore` (typed against the full real store) is bridged
 * once, below, rather than with an unchecked assertion at each call site.
 */
const asStore = (partial: Partial<GlobalStoreState>) => partial as GlobalStoreState

// Typed in full: `vi.mocked(useGraphCopy)` is typed against the real hook's
// return type, so every member has to be present even if unused here.
const mockUseGraphCopy: GraphCopyHook = {
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
  createFullCopy: vi.fn(() => Promise.resolve()),
  createTimeRangeCopy: vi.fn(() => Promise.resolve()),
  createFilteredCopy: vi.fn(() => Promise.resolve()),
  cancelCopy: vi.fn(),
  refreshCopyStatus: vi.fn(),
  clearCompletedOperations: vi.fn(),
  isCreatingCopy: false,
  isRefreshingStatus: false
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
    vi.mocked(useGlobalStore).mockImplementation(((selector?: (state: GlobalStoreState) => unknown) =>
      selector ? selector(asStore(mockUseGlobalStore)) : asStore(mockUseGlobalStore)) as unknown as typeof useGlobalStore)
    vi.mocked(useEvents).mockReturnValue({ data: mockEvents } as unknown as ReturnType<typeof useEvents>)
    vi.mocked(useArcs).mockReturnValue({ data: mockArcs } as unknown as ReturnType<typeof useArcs>)
    vi.mocked(useGraphCopy).mockReturnValue(mockUseGraphCopy)
    branchMutateAsync.mockResolvedValue({ ...activeGraph, id: 'graph-branch', name: 'Clerks Prevail', parentGraphId: 'graph-main' })
    vi.mocked(useActiveGraph).mockReturnValue({ data: activeGraph } as unknown as ReturnType<typeof useActiveGraph>)
    vi.mocked(useBranchGraph).mockReturnValue({ mutateAsync: branchMutateAsync, isPending: false } as unknown as ReturnType<typeof useBranchGraph>)
    vi.mocked(useSwitchGraph).mockReturnValue({ mutate: switchMutate } as unknown as ReturnType<typeof useSwitchGraph>)
  })

  it('should not render when closed', () => {
    render(
      <GraphCopyModal isOpen={false} onClose={mockOnClose} />,
      { wrapper: createWrapper() }
    )

    expect(screen.queryByText('Branch or copy this graph')).not.toBeInTheDocument()
  })

  it('should render when open', () => {
    render(
      <GraphCopyModal isOpen={true} onClose={mockOnClose} />,
      { wrapper: createWrapper() }
    )

    expect(screen.getByRole('dialog', { name: 'Branch or copy this graph' })).toBeInTheDocument()
    // A branch is the default; the plain copies are named as copies.
    expect(screen.getByRole('radio', { name: /^Branch/ })).toBeChecked()
    expect(screen.getByLabelText('Branch name')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /^Full copy/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /^Time-range copy/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /^Filtered copy/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create branch' })).toBeInTheDocument()
  })

  it('should update copy name when input changes', async () => {
    const user = userEvent.setup()

    render(
      <GraphCopyModal isOpen={true} onClose={mockOnClose} />,
      { wrapper: createWrapper() }
    )

    const nameInput = screen.getByLabelText('Branch name')
    await user.type(nameInput, 'M')

    // setCopyName is called for each character typed
    expect(mockUseGraphCopy.setCopyName).toHaveBeenCalled()
  })

  it('should show event and arc counts for a branch, and name its baseline', () => {
    render(
      <GraphCopyModal isOpen={true} onClose={mockOnClose} />,
      { wrapper: createWrapper() }
    )

    expect(screen.getByText(/2 events, 1 arc\)/)).toBeInTheDocument()
    expect(screen.getByText(/keeps The Engine Age as its baseline/)).toBeInTheDocument()
  })

  it("counts the whole graph from its metadata, not the store's empty lists or a capped page", () => {
    // Regression: the dialog read useGlobalStore().events/arcs, which nothing
    // fills, and said "(0 events, 0 arcs)" for every graph.
    vi.mocked(useActiveGraph).mockReturnValue({
      data: { ...activeGraph, metadata: { ...activeGraph.metadata, eventCount: 1240, arcCount: 12 } },
    } as unknown as ReturnType<typeof useActiveGraph>)

    render(
      <GraphCopyModal isOpen={true} onClose={mockOnClose} />,
      { wrapper: createWrapper() }
    )

    expect(screen.getByText(/\(1240 events, 12 arcs\)/)).toBeInTheDocument()
    expect(screen.queryByText(/0 events, 0 arcs/)).not.toBeInTheDocument()
  })

  it('falls back to the loaded events and arcs while the graph has no counts yet', () => {
    vi.mocked(useActiveGraph).mockReturnValue({
      data: { ...activeGraph, metadata: undefined },
    } as unknown as ReturnType<typeof useActiveGraph>)

    render(
      <GraphCopyModal isOpen={true} onClose={mockOnClose} />,
      { wrapper: createWrapper() }
    )

    expect(screen.getByText(/\(2 events, 1 arc\)/)).toBeInTheDocument()
  })

  it('creates a branch of the active graph and offers to switch to it', async () => {
    const user = userEvent.setup()
    const setCopyName = vi.fn()
    vi.mocked(useGraphCopy).mockReturnValue({
      ...mockUseGraphCopy,
      setCopyName,
      copyState: { ...mockUseGraphCopy.copyState, copyName: '  Clerks Prevail ' }
    })

    render(
      <GraphCopyModal isOpen={true} onClose={mockOnClose} />,
      { wrapper: createWrapper() }
    )

    await user.type(screen.getByLabelText(/Description/), 'The ban passes')
    await user.click(screen.getByRole('button', { name: 'Create branch' }))

    expect(branchMutateAsync).toHaveBeenCalledWith({
      id: 'graph-main',
      data: { branchName: 'Clerks Prevail', description: 'The ban passes' }
    })
    expect(mockUseGraphCopy.createFullCopy).not.toHaveBeenCalled()
    expect(await screen.findByRole('status')).toHaveTextContent('The Engine Age is unchanged')
    expect(mockOnClose).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Switch to branch' }))
    expect(switchMutate).toHaveBeenCalledWith('graph-branch')
    expect(mockOnClose).toHaveBeenCalled()
  })

  it('reports a failed branch and keeps the form', async () => {
    const user = userEvent.setup()
    branchMutateAsync.mockRejectedValueOnce(new Error('Source graph not found'))
    vi.mocked(useGraphCopy).mockReturnValue({
      ...mockUseGraphCopy,
      copyState: { ...mockUseGraphCopy.copyState, copyName: 'Clerks Prevail' }
    })

    render(
      <GraphCopyModal isOpen={true} onClose={mockOnClose} />,
      { wrapper: createWrapper() }
    )

    await user.click(screen.getByRole('button', { name: 'Create branch' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent("Couldn't create the branch: Source graph not found.")
    })
    expect(screen.getByLabelText('Branch name')).toBeInTheDocument()
    expect(mockOnClose).not.toHaveBeenCalled()
  })

  it('should show time range inputs when time range copy is selected', async () => {
    const user = userEvent.setup()

    render(
      <GraphCopyModal isOpen={true} onClose={mockOnClose} />,
      { wrapper: createWrapper() }
    )

    const timeRangeRadio = screen.getByLabelText(/Time-range copy/)
    await user.click(timeRangeRadio)

    expect(screen.getByRole('group', { name: 'Time range' })).toBeInTheDocument()
    // TimeRangeSelector uses "Start Date & Time" and "End Date & Time" labels
    expect(screen.getByLabelText(/Start Date/)).toBeInTheDocument()
    expect(screen.getByLabelText(/End Date/)).toBeInTheDocument()
  })

  it('should show filter configuration when filtered copy is selected', async () => {
    const user = userEvent.setup()
    
    render(
      <GraphCopyModal isOpen={true} onClose={mockOnClose} />,
      { wrapper: createWrapper() }
    )

    const filteredRadio = screen.getByLabelText(/Filtered copy/)
    await user.click(filteredRadio)

    expect(screen.getByRole('group', { name: 'Filters' })).toBeInTheDocument()
    expect(screen.getByText('Use current filters')).toBeInTheDocument()
    expect(screen.getByText('Actors')).toBeInTheDocument()
    expect(screen.getByText('Targets')).toBeInTheDocument()
    expect(screen.getByLabelText(/Confidence threshold/)).toBeInTheDocument()
  })

  it('should populate filter configuration with current filters', async () => {
    const user = userEvent.setup()
    
    render(
      <GraphCopyModal isOpen={true} onClose={mockOnClose} />,
      { wrapper: createWrapper() }
    )

    const filteredRadio = screen.getByLabelText(/Filtered copy/)
    await user.click(filteredRadio)

    const useCurrentFiltersButton = screen.getByText('Use current filters')
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
    vi.mocked(useGraphCopy).mockReturnValue({
      ...mockUseGraphCopy,
      copyState: mockCopyStateWithName
    })

    render(
      <GraphCopyModal isOpen={true} onClose={mockOnClose} />,
      { wrapper: createWrapper() }
    )

    await user.click(screen.getByLabelText(/Full copy/))
    expect(screen.getByLabelText('Copy name')).toBeInTheDocument()
    const createButton = screen.getByText('Create copy')
    await user.click(createButton)

    expect(mockUseGraphCopy.createFullCopy).toHaveBeenCalled()
    expect(branchMutateAsync).not.toHaveBeenCalled()
    expect(mockOnClose).toHaveBeenCalled()
  })

  it('should call createTimeRangeCopy when creating time range copy', async () => {
    const user = userEvent.setup()
    
    // Mock copy name being set
    const mockCopyStateWithName = {
      ...mockUseGraphCopy.copyState,
      copyName: 'Test Copy'
    }
    vi.mocked(useGraphCopy).mockReturnValue({
      ...mockUseGraphCopy,
      copyState: mockCopyStateWithName
    })

    render(
      <GraphCopyModal isOpen={true} onClose={mockOnClose} />,
      { wrapper: createWrapper() }
    )

    // Select time range copy
    const timeRangeRadio = screen.getByLabelText(/Time-range copy/)
    await user.click(timeRangeRadio)

    const createButton = screen.getByText('Create copy')
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
    vi.mocked(useGraphCopy).mockReturnValue({
      ...mockUseGraphCopy,
      copyState: mockCopyStateWithName
    })

    render(
      <GraphCopyModal isOpen={true} onClose={mockOnClose} />,
      { wrapper: createWrapper() }
    )

    // Select filtered copy
    const filteredRadio = screen.getByLabelText(/Filtered copy/)
    await user.click(filteredRadio)

    const createButton = screen.getByText('Create copy')
    await user.click(createButton)

    expect(mockUseGraphCopy.createFilteredCopy).toHaveBeenCalled()
  })

  it('should create a filtered copy with the chosen filters in one flow', async () => {
    const user = userEvent.setup()

    vi.mocked(useGraphCopy).mockReturnValue({
      ...mockUseGraphCopy,
      copyState: {
        ...mockUseGraphCopy.copyState,
        copyName: 'Filtered Copy'
      }
    })

    render(
      <GraphCopyModal isOpen={true} onClose={mockOnClose} />,
      { wrapper: createWrapper() }
    )

    // Select filtered copy, choose filters, then create - without pressing
    // "Use Current Filters". The chosen filter must reach createFilteredCopy.
    await user.click(screen.getByLabelText(/Filtered copy/))
    await user.selectOptions(screen.getByLabelText('Actors'), ['Actor A'])
    await user.selectOptions(screen.getByLabelText('Targets'), ['Target X'])

    await user.click(screen.getByText('Create copy'))

    expect(mockUseGraphCopy.createFilteredCopy).toHaveBeenCalledWith({
      actors: ['Actor A'],
      targets: ['Target X'],
      event_types: [],
      confidence_threshold: 0.5
    })
  })

  it('should disable create button when copy name is empty', () => {
    render(
      <GraphCopyModal isOpen={true} onClose={mockOnClose} />,
      { wrapper: createWrapper() }
    )

    expect(screen.getByRole('button', { name: 'Create branch' })).toBeDisabled()
  })

  it('should show loading state when creating copy', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <GraphCopyModal isOpen={true} onClose={mockOnClose} />,
      { wrapper: createWrapper() }
    )
    await user.click(screen.getByLabelText(/Full copy/))

    vi.mocked(useGraphCopy).mockReturnValue({
      ...mockUseGraphCopy,
      isCreatingCopy: true
    })
    rerender(<GraphCopyModal isOpen={true} onClose={mockOnClose} />)

    expect(screen.getByRole('button', { name: 'Creating copy…' })).toBeDisabled()
  })

  it('should show loading state when creating a branch', () => {
    vi.mocked(useBranchGraph).mockReturnValue({ mutateAsync: branchMutateAsync, isPending: true } as unknown as ReturnType<typeof useBranchGraph>)

    render(
      <GraphCopyModal isOpen={true} onClose={mockOnClose} />,
      { wrapper: createWrapper() }
    )

    expect(screen.getByRole('button', { name: 'Creating branch…' })).toBeDisabled()
  })

  it('should close modal when close button is clicked', async () => {
    const user = userEvent.setup()
    
    render(
      <GraphCopyModal isOpen={true} onClose={mockOnClose} />,
      { wrapper: createWrapper() }
    )

    const closeButton = screen.getByRole('button', { name: /close modal/i })
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
    const filteredRadio = screen.getByLabelText(/Filtered copy/)
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
    const filteredRadio = screen.getByLabelText(/Filtered copy/)
    await user.click(filteredRadio)

    const confidenceSlider = screen.getByRole('slider')
    fireEvent.change(confidenceSlider, { target: { value: '0.8' } })

    // The component should update its internal state
    // We can't easily test the internal state change without more complex mocking
    expect(confidenceSlider).toHaveValue('0.8')
  })

  describe('Accessibility', () => {
    it('should have proper dialog accessibility attributes', () => {
      render(
        <GraphCopyModal isOpen={true} onClose={mockOnClose} />,
        { wrapper: createWrapper() }
      )

      const dialog = screen.getByRole('dialog', { name: 'Branch or copy this graph' })
      expect(dialog).toHaveAttribute('aria-modal', 'true')
    })

    it('should have labeled form fields', () => {
      render(
        <GraphCopyModal isOpen={true} onClose={mockOnClose} />,
        { wrapper: createWrapper() }
      )

      expect(screen.getByLabelText(/branch name/i)).toBeInTheDocument()
    })

    it('should have accessible close button', () => {
      render(
        <GraphCopyModal isOpen={true} onClose={mockOnClose} />,
        { wrapper: createWrapper() }
      )

      const closeButton = screen.getByRole('button', { name: /close modal/i })
      expect(closeButton).toBeInTheDocument()
    })

    it('should have proper radiogroup for copy type selection', () => {
      render(
        <GraphCopyModal isOpen={true} onClose={mockOnClose} />,
        { wrapper: createWrapper() }
      )

      expect(screen.getByRole('radiogroup', { name: 'What to make' })).toBeInTheDocument()
    })
  })

  describe('Accessibility (axe)', () => {
    it('branch state has no axe violations', async () => {
      const { container } = render(
        <GraphCopyModal isOpen={true} onClose={mockOnClose} />,
        { wrapper: createWrapper() }
      )

      expect(await axe(container)).toHaveNoViolations()
    })

    it('time-range state has no axe violations', async () => {
      const user = userEvent.setup()
      const { container } = render(
        <GraphCopyModal isOpen={true} onClose={mockOnClose} />,
        { wrapper: createWrapper() }
      )

      await user.click(screen.getByLabelText(/Time-range copy/))

      expect(await axe(container)).toHaveNoViolations()
    })

    it('filtered state has no axe violations', async () => {
      const user = userEvent.setup()
      const { container } = render(
        <GraphCopyModal isOpen={true} onClose={mockOnClose} />,
        { wrapper: createWrapper() }
      )

      await user.click(screen.getByLabelText(/Filtered copy/))

      expect(await axe(container)).toHaveNoViolations()
    })
  })
})
