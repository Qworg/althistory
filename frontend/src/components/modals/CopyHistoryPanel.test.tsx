import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CopyHistoryPanel } from './CopyHistoryPanel'
import { useGraphCopy } from '@/hooks/useGraphCopy'
import { CopyOperation } from '@/types'
import { createMockCopyOperation, copyHistoryPanelScenarios } from '@/test/fixtures/modalFixtures'

// Mock the useGraphCopy hook
vi.mock('@/hooks/useGraphCopy')

const mockOperations: CopyOperation[] = [
  {
    id: '1',
    name: 'Test Copy 1',
    type: 'full',
    status: 'completed',
    progress: 100,
    created_at: '2023-01-01T00:00:00Z',
    completed_at: '2023-01-01T00:05:00Z',
    parameters: {}
  },
  {
    id: '2',
    name: 'Test Copy 2',
    type: 'time_range',
    status: 'failed',
    progress: 50,
    error_message: 'Network error',
    created_at: '2023-01-02T00:00:00Z',
    completed_at: '2023-01-02T00:03:00Z',
    parameters: {
      timeRange: {
        start: new Date('2023-01-01'),
        end: new Date('2023-12-31')
      }
    }
  },
  {
    id: '3',
    name: 'Test Copy 3',
    type: 'filtered',
    status: 'in_progress',
    progress: 75,
    created_at: '2023-01-03T00:00:00Z',
    parameters: {
      filter: {
        actors: ['Actor1', 'Actor2'],
        targets: ['Target1']
      }
    }
  }
]

const mockUseGraphCopy = {
  copyState: {
    activeOperations: [mockOperations[2]], // in_progress operation
    completedOperations: [mockOperations[0], mockOperations[1]], // completed and failed
    selectedTimeRange: null,
    selectedFilter: null,
    copyName: '',
    isCreatingCopy: false
  },
  clearCompletedOperations: vi.fn()
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

describe('CopyHistoryPanel', () => {
  const mockOnClose = vi.fn()
  const mockOnSwitchToGraph = vi.fn()
  const mockOnCompareGraphs = vi.fn()
  const mockOnDeleteCopy = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    ;(useGraphCopy as any).mockReturnValue(mockUseGraphCopy)
  })

  it('should not render when closed', () => {
    render(
      <CopyHistoryPanel
        isOpen={false}
        onClose={mockOnClose}
        onSwitchToGraph={mockOnSwitchToGraph}
        onCompareGraphs={mockOnCompareGraphs}
        onDeleteCopy={mockOnDeleteCopy}
      />,
      { wrapper: createWrapper() }
    )

    expect(screen.queryByText('Copy History')).not.toBeInTheDocument()
  })

  it('should render when open', () => {
    render(
      <CopyHistoryPanel
        isOpen={true}
        onClose={mockOnClose}
        onSwitchToGraph={mockOnSwitchToGraph}
        onCompareGraphs={mockOnCompareGraphs}
        onDeleteCopy={mockOnDeleteCopy}
      />,
      { wrapper: createWrapper() }
    )

    expect(screen.getByText('Copy History')).toBeInTheDocument()
    expect(screen.getByText('Manage and review all graph copy operations')).toBeInTheDocument()
  })

  it('should display all operations', () => {
    render(
      <CopyHistoryPanel
        isOpen={true}
        onClose={mockOnClose}
        onSwitchToGraph={mockOnSwitchToGraph}
        onCompareGraphs={mockOnCompareGraphs}
        onDeleteCopy={mockOnDeleteCopy}
      />,
      { wrapper: createWrapper() }
    )

    expect(screen.getByText('Test Copy 1')).toBeInTheDocument()
    expect(screen.getByText('Test Copy 2')).toBeInTheDocument()
    expect(screen.getByText('Test Copy 3')).toBeInTheDocument()
  })

  it('should show correct status indicators', () => {
    render(
      <CopyHistoryPanel
        isOpen={true}
        onClose={mockOnClose}
        onSwitchToGraph={mockOnSwitchToGraph}
        onCompareGraphs={mockOnCompareGraphs}
        onDeleteCopy={mockOnDeleteCopy}
      />,
      { wrapper: createWrapper() }
    )

    expect(screen.getByText('completed')).toBeInTheDocument()
    expect(screen.getByText('failed')).toBeInTheDocument()
    expect(screen.getByText('in progress')).toBeInTheDocument()
  })

  it('should filter operations by status', async () => {
    const user = userEvent.setup()
    
    render(
      <CopyHistoryPanel
        isOpen={true}
        onClose={mockOnClose}
        onSwitchToGraph={mockOnSwitchToGraph}
        onCompareGraphs={mockOnCompareGraphs}
        onDeleteCopy={mockOnDeleteCopy}
      />,
      { wrapper: createWrapper() }
    )

    // Filter by completed
    const statusFilter = screen.getByDisplayValue('All Status')
    await user.selectOptions(statusFilter, 'completed')

    // Should only show completed operations
    expect(screen.getByText('Test Copy 1')).toBeInTheDocument()
    expect(screen.queryByText('Test Copy 2')).not.toBeInTheDocument()
    expect(screen.queryByText('Test Copy 3')).not.toBeInTheDocument()
  })

  it('should search operations by name', async () => {
    const user = userEvent.setup()
    
    render(
      <CopyHistoryPanel
        isOpen={true}
        onClose={mockOnClose}
        onSwitchToGraph={mockOnSwitchToGraph}
        onCompareGraphs={mockOnCompareGraphs}
        onDeleteCopy={mockOnDeleteCopy}
      />,
      { wrapper: createWrapper() }
    )

    const searchInput = screen.getByPlaceholderText('Search by name or type...')
    await user.type(searchInput, 'Copy 1')

    // Should only show matching operation
    expect(screen.getByText('Test Copy 1')).toBeInTheDocument()
    expect(screen.queryByText('Test Copy 2')).not.toBeInTheDocument()
    expect(screen.queryByText('Test Copy 3')).not.toBeInTheDocument()
  })

  it('should sort operations by different fields', async () => {
    const user = userEvent.setup()
    
    render(
      <CopyHistoryPanel
        isOpen={true}
        onClose={mockOnClose}
        onSwitchToGraph={mockOnSwitchToGraph}
        onCompareGraphs={mockOnCompareGraphs}
        onDeleteCopy={mockOnDeleteCopy}
      />,
      { wrapper: createWrapper() }
    )

    // Click on Name header to sort by name
    const nameHeader = screen.getByText('Name')
    await user.click(nameHeader)

    // Should show sort indicator
    expect(screen.getByText('↑')).toBeInTheDocument()
  })

  it('should call onSwitchToGraph when Open button is clicked', async () => {
    const user = userEvent.setup()
    
    render(
      <CopyHistoryPanel
        isOpen={true}
        onClose={mockOnClose}
        onSwitchToGraph={mockOnSwitchToGraph}
        onCompareGraphs={mockOnCompareGraphs}
        onDeleteCopy={mockOnDeleteCopy}
      />,
      { wrapper: createWrapper() }
    )

    const openButton = screen.getByText('Open')
    await user.click(openButton)

    expect(mockOnSwitchToGraph).toHaveBeenCalledWith('Test Copy 1')
  })

  it('should call onCompareGraphs when Compare button is clicked', async () => {
    const user = userEvent.setup()
    
    render(
      <CopyHistoryPanel
        isOpen={true}
        onClose={mockOnClose}
        onSwitchToGraph={mockOnSwitchToGraph}
        onCompareGraphs={mockOnCompareGraphs}
        onDeleteCopy={mockOnDeleteCopy}
      />,
      { wrapper: createWrapper() }
    )

    const compareButton = screen.getByText('Compare')
    await user.click(compareButton)

    expect(mockOnCompareGraphs).toHaveBeenCalledWith('Original', 'Test Copy 1')
  })

  it('should call onDeleteCopy when Delete button is clicked', async () => {
    const user = userEvent.setup()

    render(
      <CopyHistoryPanel
        isOpen={true}
        onClose={mockOnClose}
        onSwitchToGraph={mockOnSwitchToGraph}
        onCompareGraphs={mockOnCompareGraphs}
        onDeleteCopy={mockOnDeleteCopy}
      />,
      { wrapper: createWrapper() }
    )

    const deleteButtons = screen.getAllByText('Delete')
    await user.click(deleteButtons[0])

    // Operations are sorted by created_at desc, so first row is most recent (id: '3')
    expect(mockOnDeleteCopy).toHaveBeenCalled()
  })

  it('should call clearCompletedOperations when Clear History is clicked', async () => {
    const user = userEvent.setup()
    
    render(
      <CopyHistoryPanel
        isOpen={true}
        onClose={mockOnClose}
        onSwitchToGraph={mockOnSwitchToGraph}
        onCompareGraphs={mockOnCompareGraphs}
        onDeleteCopy={mockOnDeleteCopy}
      />,
      { wrapper: createWrapper() }
    )

    const clearButton = screen.getByText('Clear History')
    await user.click(clearButton)

    expect(mockUseGraphCopy.clearCompletedOperations).toHaveBeenCalled()
  })

  it('should show summary statistics', () => {
    render(
      <CopyHistoryPanel
        isOpen={true}
        onClose={mockOnClose}
        onSwitchToGraph={mockOnSwitchToGraph}
        onCompareGraphs={mockOnCompareGraphs}
        onDeleteCopy={mockOnDeleteCopy}
      />,
      { wrapper: createWrapper() }
    )

    expect(screen.getByText('3')).toBeInTheDocument() // Total operations
    expect(screen.getByText('Total Operations')).toBeInTheDocument()
    // "Completed" appears in both status badges and summary, use getAllByText
    expect(screen.getAllByText(/Completed/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/In Progress/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Failed/i).length).toBeGreaterThan(0)
  })

  it('should show empty state when no operations match filters', async () => {
    const user = userEvent.setup()
    
    render(
      <CopyHistoryPanel
        isOpen={true}
        onClose={mockOnClose}
        onSwitchToGraph={mockOnSwitchToGraph}
        onCompareGraphs={mockOnCompareGraphs}
        onDeleteCopy={mockOnDeleteCopy}
      />,
      { wrapper: createWrapper() }
    )

    const searchInput = screen.getByPlaceholderText('Search by name or type...')
    await user.type(searchInput, 'NonExistentCopy')

    expect(screen.getByText('No Copy Operations Found')).toBeInTheDocument()
    expect(screen.getByText('No operations match your current filters.')).toBeInTheDocument()
  })

  it('should close modal when close button is clicked', async () => {
    const user = userEvent.setup()

    render(
      <CopyHistoryPanel
        isOpen={true}
        onClose={mockOnClose}
        onSwitchToGraph={mockOnSwitchToGraph}
        onCompareGraphs={mockOnCompareGraphs}
        onDeleteCopy={mockOnDeleteCopy}
      />,
      { wrapper: createWrapper() }
    )

    // Use the specific close panel button (aria-label)
    const closeButton = screen.getByRole('button', { name: /close panel/i })
    await user.click(closeButton)

    expect(mockOnClose).toHaveBeenCalled()
  })

  it('should display operation parameters correctly', () => {
    render(
      <CopyHistoryPanel
        isOpen={true}
        onClose={mockOnClose}
        onSwitchToGraph={mockOnSwitchToGraph}
        onCompareGraphs={mockOnCompareGraphs}
        onDeleteCopy={mockOnDeleteCopy}
      />,
      { wrapper: createWrapper() }
    )

    // Check time range display
    expect(screen.getByText(/1\/1\/2023 - 12\/31\/2023/)).toBeInTheDocument()
    
    // Check filter display
    expect(screen.getByText(/Filtered: 2 actors, 1 targets/)).toBeInTheDocument()
  })

  it('should show progress bars correctly', () => {
    render(
      <CopyHistoryPanel
        isOpen={true}
        onClose={mockOnClose}
        onSwitchToGraph={mockOnSwitchToGraph}
        onCompareGraphs={mockOnCompareGraphs}
        onDeleteCopy={mockOnDeleteCopy}
      />,
      { wrapper: createWrapper() }
    )

    expect(screen.getByText('100%')).toBeInTheDocument()
    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(screen.getByText('75%')).toBeInTheDocument()
  })

  describe('Accessibility', () => {
    it('should have proper dialog accessibility attributes', () => {
      render(
        <CopyHistoryPanel
          isOpen={true}
          onClose={mockOnClose}
          onSwitchToGraph={mockOnSwitchToGraph}
          onCompareGraphs={mockOnCompareGraphs}
          onDeleteCopy={mockOnDeleteCopy}
        />,
        { wrapper: createWrapper() }
      )

      const dialog = screen.getByRole('dialog')
      expect(dialog).toHaveAttribute('aria-modal', 'true')
      expect(dialog).toHaveAttribute('aria-labelledby', 'copy-history-title')
    })

    it('should have accessible search input', () => {
      render(
        <CopyHistoryPanel
          isOpen={true}
          onClose={mockOnClose}
          onSwitchToGraph={mockOnSwitchToGraph}
          onCompareGraphs={mockOnCompareGraphs}
          onDeleteCopy={mockOnDeleteCopy}
        />,
        { wrapper: createWrapper() }
      )

      const searchInput = screen.getByLabelText(/search/i)
      expect(searchInput).toBeInTheDocument()
    })

    it('should have accessible status filter', () => {
      render(
        <CopyHistoryPanel
          isOpen={true}
          onClose={mockOnClose}
          onSwitchToGraph={mockOnSwitchToGraph}
          onCompareGraphs={mockOnCompareGraphs}
          onDeleteCopy={mockOnDeleteCopy}
        />,
        { wrapper: createWrapper() }
      )

      const statusFilter = screen.getByLabelText(/filter by status/i)
      expect(statusFilter).toBeInTheDocument()
    })

    it('should have accessible close button', () => {
      render(
        <CopyHistoryPanel
          isOpen={true}
          onClose={mockOnClose}
          onSwitchToGraph={mockOnSwitchToGraph}
          onCompareGraphs={mockOnCompareGraphs}
          onDeleteCopy={mockOnDeleteCopy}
        />,
        { wrapper: createWrapper() }
      )

      const closeButton = screen.getByRole('button', { name: /close panel/i })
      expect(closeButton).toBeInTheDocument()
    })
  })
})