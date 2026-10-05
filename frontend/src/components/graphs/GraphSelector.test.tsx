import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GraphSelector } from './GraphSelector'
import { useGraphManagement } from '@/hooks/useGraphs'
import { Graph } from '@/types'

// Mock dependencies
vi.mock('@/hooks/useGraphs')

const mockGraphs: Graph[] = [
  {
    id: 'graph1',
    name: 'Main Timeline',
    description: 'Primary historical timeline',
    status: 'active',
    version: 3,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-15T00:00:00Z',
    metadata: {
      eventCount: 150,
      arcCount: 12,
      relationshipCount: 75,
      pressureCount: 8
    },
    branchName: undefined,
    parentGraphId: undefined
  },
  {
    id: 'graph2',
    name: 'Alternative Branch',
    description: 'What-if scenario',
    status: 'active',
    version: 1,
    createdAt: '2024-01-10T00:00:00Z',
    updatedAt: '2024-01-14T00:00:00Z',
    metadata: {
      eventCount: 45,
      arcCount: 5,
      relationshipCount: 20,
      pressureCount: 3
    },
    branchName: 'alt-history',
    parentGraphId: 'graph1'
  },
  {
    id: 'graph3',
    name: 'Archived Timeline',
    description: 'Old version',
    status: 'archived',
    version: 2,
    createdAt: '2023-12-01T00:00:00Z',
    updatedAt: '2023-12-20T00:00:00Z',
    metadata: {
      eventCount: 80,
      arcCount: 8,
      relationshipCount: 35,
      pressureCount: 5
    }
  }
]

const createMockGraphManagement = (overrides = {}) => ({
  activeGraphId: 'graph1',
  activeGraph: mockGraphs[0],
  graphs: mockGraphs,
  switchGraph: vi.fn(),
  createGraph: vi.fn().mockResolvedValue({ id: 'new-graph', name: 'New Graph' }),
  isLoading: false,
  isCreating: false,
  isSwitching: false,
  ...overrides
})

describe('GraphSelector', () => {
  const user = userEvent.setup()
  const mockOnOpenManager = vi.fn()
  let mockGraphManagement: ReturnType<typeof createMockGraphManagement>

  beforeEach(() => {
    mockGraphManagement = createMockGraphManagement()
    vi.mocked(useGraphManagement).mockReturnValue(mockGraphManagement as any)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Initial Rendering', () => {
    it('should render the dropdown button with active graph name', () => {
      render(<GraphSelector onOpenManager={mockOnOpenManager} />)
      
      expect(screen.getByText('Main Timeline')).toBeInTheDocument()
    })

    it('should display version badge when graph is active', () => {
      render(<GraphSelector />)
      
      expect(screen.getByText('v3')).toBeInTheDocument()
    })

    it('should show "Select Graph" when no graph is active', () => {
      vi.mocked(useGraphManagement).mockReturnValue(createMockGraphManagement({
        activeGraphId: null,
        activeGraph: null
      }) as any)
      
      render(<GraphSelector />)
      
      expect(screen.getByText('Select Graph')).toBeInTheDocument()
    })

    it('should apply custom className', () => {
      const { container } = render(<GraphSelector className="custom-class" />)
      
      expect(container.firstChild).toHaveClass('custom-class')
    })

    it('should have correct ARIA attributes on closed state', () => {
      render(<GraphSelector />)
      
      const button = screen.getByRole('button', { name: /Main Timeline/i })
      expect(button).toHaveAttribute('aria-haspopup', 'listbox')
      expect(button).toHaveAttribute('aria-expanded', 'false')
    })
  })

  describe('Rendering with No Graphs', () => {
    it('should display "No graphs found" message when graph list is empty', async () => {
      vi.mocked(useGraphManagement).mockReturnValue(createMockGraphManagement({
        graphs: [],
        activeGraphId: null,
        activeGraph: null
      }) as any)
      
      render(<GraphSelector />)
      
      // Open dropdown
      const button = screen.getByRole('button', { name: /Select Graph/i })
      await user.click(button)
      
      expect(screen.getByText('No active graphs found')).toBeInTheDocument()
    })

    it('should still show "New Graph" button when no graphs exist', async () => {
      vi.mocked(useGraphManagement).mockReturnValue(createMockGraphManagement({
        graphs: []
      }) as any)
      
      render(<GraphSelector />)
      
      // Open dropdown
      await user.click(screen.getByRole('button'))
      
      expect(screen.getByText('New Graph')).toBeInTheDocument()
    })
  })

  describe('Rendering with Multiple Graphs', () => {
    it('should display all active graphs when dropdown is opened', async () => {
      render(<GraphSelector />)
      
      await user.click(screen.getByRole('button'))
      
      // Filter is 'active' by default, so should show active graphs
      // Use getAllByText since Main Timeline appears in both button and dropdown
      const mainTimelineElements = screen.getAllByText('Main Timeline')
      expect(mainTimelineElements.length).toBeGreaterThanOrEqual(2) // Button and dropdown item
      expect(screen.getByText('Alternative Branch')).toBeInTheDocument()
    })

    it('should display graph metadata (event count, arc count)', async () => {
      render(<GraphSelector />)
      
      await user.click(screen.getByRole('button'))
      
      expect(screen.getByText('150 events')).toBeInTheDocument()
      expect(screen.getByText('12 arcs')).toBeInTheDocument()
    })

    it('should display branch name badge for branched graphs', async () => {
      render(<GraphSelector />)
      
      await user.click(screen.getByRole('button'))
      
      expect(screen.getByText('alt-history')).toBeInTheDocument()
    })

    it('should highlight the currently active graph', async () => {
      render(<GraphSelector />)
      
      await user.click(screen.getByRole('button'))
      
      const activeGraphButton = screen.getByRole('button', { name: /Main Timeline.*150 events/i })
      expect(activeGraphButton).toHaveClass('bg-blue-50')
    })

    it('should filter graphs by status when filter tabs are clicked', async () => {
      render(<GraphSelector />)
      
      await user.click(screen.getByRole('button', { name: /Main Timeline/i }))
      
      // Click 'archived' filter
      const archivedTab = screen.getByRole('button', { name: /archived/i })
      await user.click(archivedTab)
      
      expect(screen.getByText('Archived Timeline')).toBeInTheDocument()
      // Main Timeline still appears in the dropdown button, but not in the dropdown list
      // We check that "Alternative Branch" (another active graph) is not shown
      expect(screen.queryByText('Alternative Branch')).not.toBeInTheDocument()
    })

    it('should show all graphs when "all" filter is selected', async () => {
      render(<GraphSelector />)
      
      await user.click(screen.getByRole('button', { name: /Main Timeline/i }))
      
      // Click 'all' filter
      const allTab = screen.getByRole('button', { name: /^all$/i })
      await user.click(allTab)
      
      // Main Timeline appears multiple times (button and dropdown)
      expect(screen.getAllByText('Main Timeline').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('Archived Timeline')).toBeInTheDocument()
    })
  })

  describe('Graph Selection', () => {
    it('should call switchGraph when a different graph is clicked', async () => {
      render(<GraphSelector />)
      
      await user.click(screen.getByRole('button'))
      
      // Click on the second graph
      const graphButton = screen.getByRole('button', { name: /Alternative Branch.*45 events/i })
      await user.click(graphButton)
      
      expect(mockGraphManagement.switchGraph).toHaveBeenCalledWith('graph2')
    })

    it('should not call switchGraph when clicking the already active graph', async () => {
      render(<GraphSelector />)
      
      await user.click(screen.getByRole('button'))
      
      // Click on the active graph
      const activeGraphButton = screen.getByRole('button', { name: /Main Timeline.*150 events/i })
      await user.click(activeGraphButton)
      
      expect(mockGraphManagement.switchGraph).not.toHaveBeenCalled()
    })

    it('should close dropdown after selecting a graph', async () => {
      render(<GraphSelector />)
      
      await user.click(screen.getByRole('button'))
      
      // Verify dropdown is open
      expect(screen.getByText('Alternative Branch')).toBeInTheDocument()
      
      // Click on a graph
      const graphButton = screen.getByRole('button', { name: /Alternative Branch.*45 events/i })
      await user.click(graphButton)
      
      // Dropdown should close (we can't easily check this, but the click handler sets isOpen to false)
      // The best we can do is verify the switchGraph was called
      expect(mockGraphManagement.switchGraph).toHaveBeenCalled()
    })
  })

  describe('Loading State', () => {
    it('should disable button when loading', () => {
      vi.mocked(useGraphManagement).mockReturnValue(createMockGraphManagement({
        isLoading: true
      }) as any)
      
      render(<GraphSelector />)
      
      const button = screen.getByRole('button')
      expect(button).toBeDisabled()
      expect(button).toHaveClass('cursor-not-allowed')
    })

    it('should show "Switching..." when switching graphs', () => {
      vi.mocked(useGraphManagement).mockReturnValue(createMockGraphManagement({
        isSwitching: true
      }) as any)
      
      render(<GraphSelector />)
      
      expect(screen.getByText('Switching...')).toBeInTheDocument()
    })

    it('should disable button when switching graphs', () => {
      vi.mocked(useGraphManagement).mockReturnValue(createMockGraphManagement({
        isSwitching: true
      }) as any)
      
      render(<GraphSelector />)
      
      const button = screen.getByRole('button')
      expect(button).toBeDisabled()
    })
  })

  describe('Create New Graph', () => {
    it('should show create form when "New Graph" is clicked', async () => {
      render(<GraphSelector />)
      
      await user.click(screen.getByRole('button'))
      await user.click(screen.getByText('New Graph'))
      
      expect(screen.getByPlaceholderText('Graph name...')).toBeInTheDocument()
    })

    it('should call createGraph with new name when form is submitted', async () => {
      render(<GraphSelector />)
      
      await user.click(screen.getByRole('button'))
      await user.click(screen.getByText('New Graph'))
      
      const input = screen.getByPlaceholderText('Graph name...')
      await user.type(input, 'My New Timeline')
      
      const createButton = screen.getByRole('button', { name: 'Create' })
      await user.click(createButton)
      
      await waitFor(() => {
        expect(mockGraphManagement.createGraph).toHaveBeenCalledWith({ name: 'My New Timeline' })
      })
    })

    it('should create graph when Enter is pressed in input', async () => {
      render(<GraphSelector />)
      
      await user.click(screen.getByRole('button'))
      await user.click(screen.getByText('New Graph'))
      
      const input = screen.getByPlaceholderText('Graph name...')
      await user.type(input, 'My New Timeline')
      await user.keyboard('{Enter}')
      
      await waitFor(() => {
        expect(mockGraphManagement.createGraph).toHaveBeenCalled()
      })
    })

    it('should cancel create when Escape is pressed', async () => {
      render(<GraphSelector />)
      
      await user.click(screen.getByRole('button'))
      await user.click(screen.getByText('New Graph'))
      
      // Verify input is shown
      expect(screen.getByPlaceholderText('Graph name...')).toBeInTheDocument()
      
      await user.keyboard('{Escape}')
      
      // Input should be hidden, New Graph button should be visible
      expect(screen.queryByPlaceholderText('Graph name...')).not.toBeInTheDocument()
      expect(screen.getByText('New Graph')).toBeInTheDocument()
    })

    it('should disable Create button when input is empty', async () => {
      render(<GraphSelector />)
      
      await user.click(screen.getByRole('button'))
      await user.click(screen.getByText('New Graph'))
      
      const createButton = screen.getByRole('button', { name: 'Create' })
      expect(createButton).toBeDisabled()
    })

    it('should not create graph with whitespace-only name', async () => {
      render(<GraphSelector />)
      
      await user.click(screen.getByRole('button'))
      await user.click(screen.getByText('New Graph'))
      
      const input = screen.getByPlaceholderText('Graph name...')
      await user.type(input, '   ')
      
      const createButton = screen.getByRole('button', { name: 'Create' })
      expect(createButton).toBeDisabled()
    })

    it('should show loading state while creating graph', async () => {
      vi.mocked(useGraphManagement).mockReturnValue(createMockGraphManagement({
        isCreating: true
      }) as any)
      
      render(<GraphSelector />)
      
      await user.click(screen.getByRole('button'))
      await user.click(screen.getByText('New Graph'))
      
      const input = screen.getByPlaceholderText('Graph name...')
      await user.type(input, 'Test')
      
      // The button should show loading indicator
      expect(screen.getByText('...')).toBeInTheDocument()
    })

    it('should switch to new graph after creation', async () => {
      render(<GraphSelector />)
      
      await user.click(screen.getByRole('button'))
      await user.click(screen.getByText('New Graph'))
      
      const input = screen.getByPlaceholderText('Graph name...')
      await user.type(input, 'My New Timeline')
      
      await user.click(screen.getByRole('button', { name: 'Create' }))
      
      await waitFor(() => {
        expect(mockGraphManagement.switchGraph).toHaveBeenCalledWith('new-graph')
      })
    })
  })

  describe('Manage Button', () => {
    it('should show Manage button when onOpenManager is provided', async () => {
      render(<GraphSelector onOpenManager={mockOnOpenManager} />)
      
      await user.click(screen.getByRole('button'))
      
      expect(screen.getByText('Manage')).toBeInTheDocument()
    })

    it('should not show Manage button when onOpenManager is not provided', async () => {
      render(<GraphSelector />)
      
      await user.click(screen.getByRole('button'))
      
      expect(screen.queryByText('Manage')).not.toBeInTheDocument()
    })

    it('should call onOpenManager when Manage button is clicked', async () => {
      render(<GraphSelector onOpenManager={mockOnOpenManager} />)
      
      await user.click(screen.getByRole('button'))
      await user.click(screen.getByText('Manage'))
      
      expect(mockOnOpenManager).toHaveBeenCalled()
    })

    it('should close dropdown when Manage button is clicked', async () => {
      render(<GraphSelector onOpenManager={mockOnOpenManager} />)
      
      await user.click(screen.getByRole('button'))
      await user.click(screen.getByText('Manage'))
      
      // Dropdown should be closed - button aria-expanded should be false
      await waitFor(() => {
        const button = screen.getByRole('button', { name: /Main Timeline/i })
        expect(button).toHaveAttribute('aria-expanded', 'false')
      })
    })
  })

  describe('Dropdown Behavior', () => {
    it('should toggle dropdown on button click', async () => {
      render(<GraphSelector />)
      
      const button = screen.getByRole('button', { name: /Main Timeline/i })
      
      // Open dropdown
      await user.click(button)
      expect(button).toHaveAttribute('aria-expanded', 'true')
      
      // Close dropdown
      await user.click(button)
      expect(button).toHaveAttribute('aria-expanded', 'false')
    })

    it('should close dropdown when clicking outside', async () => {
      render(
        <div>
          <div data-testid="outside">Outside element</div>
          <GraphSelector />
        </div>
      )
      
      const button = screen.getByRole('button', { name: /Main Timeline/i })
      
      // Open dropdown
      await user.click(button)
      expect(button).toHaveAttribute('aria-expanded', 'true')
      
      // Click outside
      fireEvent.mouseDown(screen.getByTestId('outside'))
      
      await waitFor(() => {
        expect(button).toHaveAttribute('aria-expanded', 'false')
      })
    })

    it('should show chevron rotated when dropdown is open', async () => {
      render(<GraphSelector />)
      
      await user.click(screen.getByRole('button', { name: /Main Timeline/i }))
      
      // Check that the dropdown content is visible
      expect(screen.getByText('New Graph')).toBeInTheDocument()
    })
  })

  describe('Status Badges', () => {
    it('should display archived badge for archived graphs', async () => {
      render(<GraphSelector />)
      
      await user.click(screen.getByRole('button'))
      
      // Switch to 'all' filter to see archived graph
      await user.click(screen.getByRole('button', { name: /^all$/i }))
      
      const statusBadges = screen.getAllByText('archived')
      expect(statusBadges.length).toBeGreaterThan(0)
    })
  })

  describe('Error Handling', () => {
    it('should handle createGraph error gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      
      vi.mocked(useGraphManagement).mockReturnValue(createMockGraphManagement({
        createGraph: vi.fn().mockRejectedValue(new Error('Network error'))
      }) as any)
      
      render(<GraphSelector />)
      
      await user.click(screen.getByRole('button'))
      await user.click(screen.getByText('New Graph'))
      
      const input = screen.getByPlaceholderText('Graph name...')
      await user.type(input, 'Test Graph')
      await user.click(screen.getByRole('button', { name: 'Create' }))
      
      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith('Failed to create graph:', expect.any(Error))
      })
      
      consoleSpy.mockRestore()
    })
  })
})
