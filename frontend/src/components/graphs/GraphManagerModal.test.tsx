import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { UseQueryResult } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GraphManagerModal } from './GraphManagerModal'
import type { ModalBaseProps } from '@/components/modals/ModalBase'
import { 
  useGraphManagement, 
  useGraphVersions, 
  useGraphBranches 
} from '@/hooks/useGraphs'
import { Graph, GraphVersion } from '@/types'

// Mock dependencies
vi.mock('@/hooks/useGraphs')
vi.mock('@/components/modals/ModalBase', () => ({
  ModalBase: ({ isOpen, onClose, title, children }: ModalBaseProps) => (
    isOpen ? (
      <div data-testid="modal" role="dialog">
        <h2>{title}</h2>
        <button onClick={onClose} data-testid="modal-close">Close</button>
        {children}
      </div>
    ) : null
  )
}))

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
    }
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
  }
]

const mockVersions: GraphVersion[] = [
  {
    version: 3,
    commitHash: 'abc123',
    timestamp: '2024-01-15T10:00:00Z',
    message: 'Added new events for February',
    author: 'user1',
    changes: {
      eventsAdded: 5,
      eventsModified: 2,
      eventsDeleted: 0,
      arcsAdded: 1,
      arcsModified: 0,
      arcsDeleted: 0,
      relationshipsAdded: 3,
      relationshipsModified: 1,
      relationshipsDeleted: 0
    }
  },
  {
    version: 2,
    commitHash: 'def456',
    timestamp: '2024-01-10T10:00:00Z',
    message: 'Initial import',
    author: 'user1',
    changes: {
      eventsAdded: 100,
      eventsModified: 0,
      eventsDeleted: 0,
      arcsAdded: 10,
      arcsModified: 0,
      arcsDeleted: 0,
      relationshipsAdded: 50,
      relationshipsModified: 0,
      relationshipsDeleted: 0
    }
  }
]

type MockQuerySpec<TData> =
  | { data: TData }
  | { data?: undefined; loading: boolean }
  | { error: Error }

/** Builds a useQuery result shaped like the one the graph hooks return. */
const createMockQueryResult = <TData,>(spec: MockQuerySpec<TData>): UseQueryResult<TData, Error> => {
  const base = {
    dataUpdatedAt: 0,
    errorUpdateCount: 0,
    errorUpdatedAt: 0,
    failureCount: 0,
    failureReason: null,
    isEnabled: true,
    isInitialLoading: false,
    isPaused: false,
    isRefetching: false,
    isStale: false,
    refetch: vi.fn(),
  }

  if ('error' in spec) {
    return {
      ...base,
      data: undefined,
      error: spec.error,
      fetchStatus: 'idle',
      isError: true,
      isFetched: true,
      isFetchedAfterMount: true,
      isFetching: false,
      isLoading: false,
      isLoadingError: true,
      isPending: false,
      isPlaceholderData: false,
      isRefetchError: false,
      isSuccess: false,
      status: 'error',
      promise: new Promise<TData>(() => undefined),
    }
  }

  if ('loading' in spec) {
    return {
      ...base,
      data: undefined,
      error: null,
      fetchStatus: spec.loading ? 'fetching' : 'idle',
      isError: false,
      isFetched: false,
      isFetchedAfterMount: false,
      isFetching: spec.loading,
      isLoading: spec.loading,
      isLoadingError: false,
      isPending: true,
      isPlaceholderData: false,
      isRefetchError: false,
      isSuccess: false,
      status: 'pending',
      promise: new Promise<TData>(() => undefined),
    }
  }

  return {
    ...base,
    data: spec.data,
    error: null,
    fetchStatus: 'idle',
    isError: false,
    isFetched: true,
    isFetchedAfterMount: true,
    isFetching: false,
    isLoading: false,
    isLoadingError: false,
    isPending: false,
    isPlaceholderData: false,
    isRefetchError: false,
    isSuccess: true,
    status: 'success',
    promise: Promise.resolve(spec.data),
  }
}

/** The last of the queried elements, which the fixtures guarantee exists. */
const lastOf = (elements: Element[], what: string): Element => {
  const element = elements[elements.length - 1]
  if (!element) {
    throw new Error(`Expected ${what} to be rendered`)
  }
  return element
}

/** The graph at `index`, which the fixed fixture above guarantees exists. */
const graphAt = (index: number): Graph => {
  const graph = mockGraphs[index]
  if (!graph) {
    throw new Error(`Expected a graph at index ${index}`)
  }
  return graph
}

/** The value useGraphManagement resolves to. */
type GraphManagement = ReturnType<typeof useGraphManagement>

const createMockGraphManagement = (
  overrides: Partial<GraphManagement> = {}
): GraphManagement => ({
  activeGraphId: 'graph1',
  activeGraph: graphAt(0),
  graphs: mockGraphs,
  totalGraphs: mockGraphs.length,
  isLoading: false,
  isLoadingGraphs: false,
  isLoadingActive: false,
  error: null,
  createGraph: vi.fn(),
  updateGraph: vi.fn(),
  deleteGraph: vi.fn(),
  branchGraph: vi.fn().mockResolvedValue(graphAt(1)),
  mergeGraph: vi.fn(),
  rollbackGraph: vi.fn().mockResolvedValue(graphAt(0)),
  switchGraph: vi.fn(),
  isCreating: false,
  isUpdating: false,
  isDeleting: false,
  isBranching: false,
  isMerging: false,
  isRollingBack: false,
  isSwitching: false,
  ...overrides
})

describe('GraphManagerModal', () => {
  const user = userEvent.setup()
  const mockOnClose = vi.fn()
  let mockGraphManagement: ReturnType<typeof createMockGraphManagement>

  beforeEach(() => {
    mockGraphManagement = createMockGraphManagement()
    vi.mocked(useGraphManagement).mockReturnValue(mockGraphManagement)
    vi.mocked(useGraphVersions).mockReturnValue(createMockQueryResult({ data: mockVersions }))
    vi.mocked(useGraphBranches).mockReturnValue(createMockQueryResult({ data: [graphAt(1)] }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Modal Rendering', () => {
    it('should not render when isOpen is false', () => {
      render(
        <GraphManagerModal isOpen={false} onClose={mockOnClose} />
      )
      
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('should render when isOpen is true', () => {
      render(
        <GraphManagerModal isOpen={true} onClose={mockOnClose} />
      )
      
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByText('Graph Manager')).toBeInTheDocument()
    })

    it('should display navigation tabs', () => {
      render(
        <GraphManagerModal isOpen={true} onClose={mockOnClose} />
      )
      
      expect(screen.getByRole('button', { name: /graphs/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /branches/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /versions/i })).toBeInTheDocument()
    })

    it('should display active graph info in sidebar', () => {
      render(
        <GraphManagerModal isOpen={true} onClose={mockOnClose} />
      )
      
      expect(screen.getByText('Active Graph')).toBeInTheDocument()
      // Main Timeline appears in both sidebar and graph list
      expect(screen.getAllByText('Main Timeline').length).toBeGreaterThanOrEqual(2)
      expect(screen.getByText(/v3 - 150 events/)).toBeInTheDocument()
    })

    it('should start on specified initial tab', () => {
      render(
        <GraphManagerModal isOpen={true} onClose={mockOnClose} initialTab="versions" />
      )
      
      const versionsTab = screen.getByRole('button', { name: /versions/i })
      expect(versionsTab).toHaveClass('bg-blue-100')
    })
  })

  describe('Graphs Tab', () => {
    it('should display all graphs in the list', () => {
      render(
        <GraphManagerModal isOpen={true} onClose={mockOnClose} />
      )
      
      // Main Timeline appears multiple times (sidebar + graph list)
      expect(screen.getAllByText('Main Timeline').length).toBeGreaterThanOrEqual(2)
      expect(screen.getByText('Alternative Branch')).toBeInTheDocument()
    })

    it('should show graph metadata', () => {
      render(
        <GraphManagerModal isOpen={true} onClose={mockOnClose} />
      )
      
      expect(screen.getByText('150 events')).toBeInTheDocument()
      expect(screen.getByText('12 arcs')).toBeInTheDocument()
    })

    it('should highlight active graph', () => {
      render(
        <GraphManagerModal isOpen={true} onClose={mockOnClose} />
      )
      
      const graphCards = screen.getAllByText('Main Timeline')
      // Find the one in the graph list (inside the grid)
      const graphCard = graphCards.find(el => el.closest('.grid'))?.closest('.p-4')
      expect(graphCard).toHaveClass('border-blue-500')
    })

    it('should show branch name badge for branched graphs', () => {
      render(
        <GraphManagerModal isOpen={true} onClose={mockOnClose} />
      )
      
      expect(screen.getByText('alt-history')).toBeInTheDocument()
    })

    it('should show status badge', () => {
      render(
        <GraphManagerModal isOpen={true} onClose={mockOnClose} />
      )
      
      const activeStatusBadges = screen.getAllByText('active')
      expect(activeStatusBadges.length).toBeGreaterThan(0)
    })
  })

  describe('Graph Selection and Actions', () => {
    it('should show action buttons when graph is selected', async () => {
      render(
        <GraphManagerModal isOpen={true} onClose={mockOnClose} />
      )
      
      // Click on a non-active graph to select it
      const graphCard = screen.getByText('Alternative Branch').closest('.p-4')
      await user.click(graphCard!)
      
      expect(screen.getByRole('button', { name: /Switch to Graph/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Edit/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Delete/i })).toBeInTheDocument()
    })

    it('should not show Switch button for active graph', async () => {
      render(
        <GraphManagerModal isOpen={true} onClose={mockOnClose} />
      )
      
      // Click on the active graph. The sidebar repeats its name, so pick the
      // occurrence that lives inside the graph list card.
      const graphCard = screen.getAllByText('Main Timeline').find(el => el.closest('.p-4'))
      if (!graphCard) {
        throw new Error('Expected the active graph card to be rendered')
      }
      await user.click(graphCard)
      
      expect(screen.queryByRole('button', { name: /Switch to Graph/i })).not.toBeInTheDocument()
    })

    it('should call switchGraph and close modal when Switch is clicked', async () => {
      render(
        <GraphManagerModal isOpen={true} onClose={mockOnClose} />
      )
      
      // Select non-active graph
      const graphCard = screen.getByText('Alternative Branch').closest('.p-4')
      await user.click(graphCard!)
      
      // Click Switch
      await user.click(screen.getByRole('button', { name: /Switch to Graph/i }))
      
      expect(mockGraphManagement.switchGraph).toHaveBeenCalledWith('graph2')
      expect(mockOnClose).toHaveBeenCalled()
    })
  })

  describe('Edit Mode', () => {
    it('should show edit form when Edit button is clicked', async () => {
      render(
        <GraphManagerModal isOpen={true} onClose={mockOnClose} />
      )
      
      // Select a graph
      const graphCard = screen.getByText('Alternative Branch').closest('.p-4')
      await user.click(graphCard!)
      
      // Click Edit
      await user.click(screen.getByRole('button', { name: /Edit/i }))
      
      // Should show edit inputs - use getAllByRole since there are multiple textboxes
      expect(screen.getByDisplayValue('Alternative Branch')).toBeInTheDocument()
      expect(screen.getAllByRole('textbox').length).toBeGreaterThanOrEqual(2) // name input and description textarea
    })

    it('should update graph name in edit form', async () => {
      render(
        <GraphManagerModal isOpen={true} onClose={mockOnClose} />
      )
      
      // Select and edit
      const graphCard = screen.getByText('Alternative Branch').closest('.p-4')
      await user.click(graphCard!)
      await user.click(screen.getByRole('button', { name: /Edit/i }))
      
      const nameInput = screen.getByDisplayValue('Alternative Branch')
      await user.clear(nameInput)
      await user.type(nameInput, 'New Name')
      
      expect(screen.getByDisplayValue('New Name')).toBeInTheDocument()
    })

    it('should update graph description in edit form', async () => {
      render(
        <GraphManagerModal isOpen={true} onClose={mockOnClose} />
      )
      
      const graphCard = screen.getByText('Alternative Branch').closest('.p-4')
      await user.click(graphCard!)
      await user.click(screen.getByRole('button', { name: /Edit/i }))
      
      const textarea = screen.getByDisplayValue('What-if scenario')
      await user.clear(textarea)
      await user.type(textarea, 'Updated description')
      
      expect(screen.getByDisplayValue('Updated description')).toBeInTheDocument()
    })

    it('should update graph status in edit form', async () => {
      render(
        <GraphManagerModal isOpen={true} onClose={mockOnClose} />
      )
      
      const graphCard = screen.getByText('Alternative Branch').closest('.p-4')
      await user.click(graphCard!)
      await user.click(screen.getByRole('button', { name: /Edit/i }))
      
      const statusSelect = screen.getByRole('combobox')
      await user.selectOptions(statusSelect, 'archived')
      
      expect(statusSelect).toHaveValue('archived')
    })

    it('should call updateGraph when Save is clicked', async () => {
      render(
        <GraphManagerModal isOpen={true} onClose={mockOnClose} />
      )
      
      const graphCard = screen.getByText('Alternative Branch').closest('.p-4')
      await user.click(graphCard!)
      await user.click(screen.getByRole('button', { name: /Edit/i }))
      
      const nameInput = screen.getByDisplayValue('Alternative Branch')
      await user.clear(nameInput)
      await user.type(nameInput, 'Updated Name')
      
      await user.click(screen.getByRole('button', { name: 'Save' }))
      
      expect(mockGraphManagement.updateGraph).toHaveBeenCalledWith({
        id: 'graph2',
        data: expect.objectContaining({
          name: 'Updated Name'
        })
      })
    })

    it('should cancel edit mode when Cancel is clicked', async () => {
      render(
        <GraphManagerModal isOpen={true} onClose={mockOnClose} />
      )
      
      const graphCard = screen.getByText('Alternative Branch').closest('.p-4')
      await user.click(graphCard!)
      await user.click(screen.getByRole('button', { name: /Edit/i }))
      
      // Verify edit mode
      expect(screen.getByDisplayValue('Alternative Branch')).toBeInTheDocument()
      
      // Cancel
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      
      // Edit inputs should be gone
      expect(screen.queryByDisplayValue('Alternative Branch')).not.toBeInTheDocument()
    })
  })

  describe('Delete Confirmation Dialog', () => {
    it('should show delete confirmation dialog', async () => {
      render(
        <GraphManagerModal isOpen={true} onClose={mockOnClose} />
      )
      
      const graphCard = screen.getByText('Alternative Branch').closest('.p-4')
      await user.click(graphCard!)
      await user.click(screen.getByRole('button', { name: /Delete/i }))
      
      expect(screen.getByText('Delete Graph')).toBeInTheDocument()
      expect(screen.getByText(/Are you sure you want to delete "Alternative Branch"\?/)).toBeInTheDocument()
    })

    it('should call deleteGraph when confirmed', async () => {
      render(
        <GraphManagerModal isOpen={true} onClose={mockOnClose} />
      )
      
      const graphCard = screen.getByText('Alternative Branch').closest('.p-4')
      await user.click(graphCard!)
      await user.click(screen.getByRole('button', { name: /Delete/i }))
      
      // Confirm delete - find the Delete button in the confirmation dialog
      const deleteButtons = screen.getAllByRole('button', { name: /Delete/i })
      const confirmDeleteButton = deleteButtons.find(btn => 
        btn.classList.contains('bg-red-600')
      )
      await user.click(confirmDeleteButton!)
      
      expect(mockGraphManagement.deleteGraph).toHaveBeenCalledWith('graph2')
    })

    it('should close dialog when Cancel is clicked in delete confirmation', async () => {
      render(
        <GraphManagerModal isOpen={true} onClose={mockOnClose} />
      )
      
      const graphCard = screen.getByText('Alternative Branch').closest('.p-4')
      await user.click(graphCard!)
      await user.click(screen.getByRole('button', { name: /Delete/i }))
      
      // Click Cancel in dialog
      await user.click(lastOf(screen.getAllByRole('button', { name: /Cancel/i }), 'a cancel button'))
      
      expect(screen.queryByText(/Are you sure you want to delete/)).not.toBeInTheDocument()
    })

    it('should show loading state while deleting', async () => {
      vi.mocked(useGraphManagement).mockReturnValue(createMockGraphManagement({
        isDeleting: true
      }))
      
      render(
        <GraphManagerModal isOpen={true} onClose={mockOnClose} />
      )
      
      const graphCard = screen.getByText('Alternative Branch').closest('.p-4')
      await user.click(graphCard!)
      await user.click(screen.getByRole('button', { name: /Delete/i }))
      
      expect(screen.getByText('Deleting...')).toBeInTheDocument()
    })
  })

  describe('Branches Tab', () => {
    it('should switch to branches tab when clicked', async () => {
      render(
        <GraphManagerModal isOpen={true} onClose={mockOnClose} />
      )
      
      await user.click(screen.getByRole('button', { name: /branches/i }))
      
      expect(screen.getByText('Branches')).toBeInTheDocument()
    })

    it('should show loading state while loading branches', async () => {
      vi.mocked(useGraphBranches).mockReturnValue(createMockQueryResult({ loading: true }))
      
      render(
        <GraphManagerModal isOpen={true} onClose={mockOnClose} initialTab="branches" />
      )
      
      expect(screen.getByText('Loading branches...')).toBeInTheDocument()
    })

    it('should show empty state when no branches exist', async () => {
      vi.mocked(useGraphBranches).mockReturnValue(createMockQueryResult({ data: [] }))
      
      render(
        <GraphManagerModal isOpen={true} onClose={mockOnClose} initialTab="branches" />
      )
      
      expect(screen.getByText(/No branches yet/)).toBeInTheDocument()
    })

    it('should display branch list', async () => {
      render(
        <GraphManagerModal isOpen={true} onClose={mockOnClose} initialTab="branches" />
      )
      
      expect(screen.getByText('alt-history')).toBeInTheDocument()
    })

    it('should show Create Branch button', async () => {
      render(
        <GraphManagerModal isOpen={true} onClose={mockOnClose} initialTab="branches" />
      )
      
      expect(screen.getByRole('button', { name: /Create Branch/i })).toBeInTheDocument()
    })
  })

  describe('Branch Dialog', () => {
    it('should show branch dialog when Create Branch is clicked', async () => {
      render(
        <GraphManagerModal isOpen={true} onClose={mockOnClose} />
      )
      
      await user.click(screen.getByRole('button', { name: /Branch Current/i }))
      
      // "Create Branch" appears as both the button in branches tab and the dialog title
      expect(screen.getAllByText('Create Branch').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByPlaceholderText('Branch name...')).toBeInTheDocument()
    })

    it('should call branchGraph when branch is created', async () => {
      render(
        <GraphManagerModal isOpen={true} onClose={mockOnClose} />
      )
      
      await user.click(screen.getByRole('button', { name: /Branch Current/i }))
      
      const input = screen.getByPlaceholderText('Branch name...')
      await user.type(input, 'new-branch-name')
      
      await user.click(screen.getByRole('button', { name: /Create Branch$/i }))
      
      await waitFor(() => {
        expect(mockGraphManagement.branchGraph).toHaveBeenCalledWith('graph1', 'new-branch-name')
      })
    })

    it('should disable Create Branch button when name is empty', async () => {
      render(
        <GraphManagerModal isOpen={true} onClose={mockOnClose} />
      )
      
      await user.click(screen.getByRole('button', { name: /Branch Current/i }))
      
      const createBranchButton = screen.getByRole('button', { name: /Create Branch$/i })
      expect(createBranchButton).toBeDisabled()
    })

    it('should show loading state while creating branch', async () => {
      vi.mocked(useGraphManagement).mockReturnValue(createMockGraphManagement({
        isBranching: true
      }))
      
      render(
        <GraphManagerModal isOpen={true} onClose={mockOnClose} />
      )
      
      await user.click(screen.getByRole('button', { name: /Branch Current/i }))
      
      expect(screen.getByText('Creating...')).toBeInTheDocument()
    })

    it('should close branch dialog when Cancel is clicked', async () => {
      render(
        <GraphManagerModal isOpen={true} onClose={mockOnClose} />
      )
      
      await user.click(screen.getByRole('button', { name: /Branch Current/i }))
      
      // Find the Cancel button in the branch dialog
      await user.click(lastOf(screen.getAllByRole('button', { name: /Cancel/i }), 'a cancel button'))
      
      expect(screen.queryByPlaceholderText('Branch name...')).not.toBeInTheDocument()
    })
  })

  describe('Versions Tab', () => {
    it('should switch to versions tab when clicked', async () => {
      render(
        <GraphManagerModal isOpen={true} onClose={mockOnClose} />
      )
      
      await user.click(screen.getByRole('button', { name: /versions/i }))
      
      expect(screen.getByText('Version History')).toBeInTheDocument()
    })

    it('should show loading state while loading versions', async () => {
      vi.mocked(useGraphVersions).mockReturnValue(createMockQueryResult({ loading: true }))
      
      render(
        <GraphManagerModal isOpen={true} onClose={mockOnClose} initialTab="versions" />
      )
      
      expect(screen.getByText('Loading version history...')).toBeInTheDocument()
    })

    it('should show empty state when no versions exist', async () => {
      vi.mocked(useGraphVersions).mockReturnValue(createMockQueryResult({ data: [] }))
      
      render(
        <GraphManagerModal isOpen={true} onClose={mockOnClose} initialTab="versions" />
      )
      
      expect(screen.getByText('No version history available.')).toBeInTheDocument()
    })

    it('should display version list with commit messages', async () => {
      render(
        <GraphManagerModal isOpen={true} onClose={mockOnClose} initialTab="versions" />
      )
      
      expect(screen.getByText('v3')).toBeInTheDocument()
      expect(screen.getByText('Added new events for February')).toBeInTheDocument()
      expect(screen.getByText('v2')).toBeInTheDocument()
      expect(screen.getByText('Initial import')).toBeInTheDocument()
    })

    it('should show Current badge for current version', async () => {
      render(
        <GraphManagerModal isOpen={true} onClose={mockOnClose} initialTab="versions" />
      )
      
      expect(screen.getByText('Current')).toBeInTheDocument()
    })

    it('should show change summary for versions', async () => {
      render(
        <GraphManagerModal isOpen={true} onClose={mockOnClose} initialTab="versions" />
      )
      
      expect(screen.getByText('+5 events')).toBeInTheDocument()
      expect(screen.getByText('+1 arcs')).toBeInTheDocument()
    })

    it('should show Rollback button for non-current versions', async () => {
      render(
        <GraphManagerModal isOpen={true} onClose={mockOnClose} initialTab="versions" />
      )
      
      const rollbackButtons = screen.getAllByRole('button', { name: /Rollback/i })
      expect(rollbackButtons.length).toBe(1) // Only for version 2
    })

    it('should not show Rollback button for current version', async () => {
      render(
        <GraphManagerModal isOpen={true} onClose={mockOnClose} initialTab="versions" />
      )
      
      // v3 is current, should not have rollback button
      const v3Section = screen.getByText('v3').closest('.p-4')
      expect(v3Section?.querySelector('button[class*="border-orange"]')).not.toBeInTheDocument()
    })
  })

  describe('Rollback Functionality', () => {
    it('should call rollbackGraph when Rollback is clicked and confirmed', async () => {
      // Mock window.confirm
      const originalConfirm = window.confirm
      window.confirm = vi.fn(() => true)
      
      render(
        <GraphManagerModal isOpen={true} onClose={mockOnClose} initialTab="versions" />
      )
      
      const rollbackButton = screen.getByRole('button', { name: /Rollback/i })
      await user.click(rollbackButton)
      
      expect(window.confirm).toHaveBeenCalled()
      expect(mockGraphManagement.rollbackGraph).toHaveBeenCalledWith('graph1', 2)
      
      window.confirm = originalConfirm
    })

    it('should not rollback when confirmation is cancelled', async () => {
      const originalConfirm = window.confirm
      window.confirm = vi.fn(() => false)
      
      render(
        <GraphManagerModal isOpen={true} onClose={mockOnClose} initialTab="versions" />
      )
      
      const rollbackButton = screen.getByRole('button', { name: /Rollback/i })
      await user.click(rollbackButton)
      
      expect(mockGraphManagement.rollbackGraph).not.toHaveBeenCalled()
      
      window.confirm = originalConfirm
    })

    it('should show loading state while rolling back', async () => {
      vi.mocked(useGraphManagement).mockReturnValue(createMockGraphManagement({
        isRollingBack: true
      }))
      
      render(
        <GraphManagerModal isOpen={true} onClose={mockOnClose} initialTab="versions" />
      )
      
      expect(screen.getByText('Rolling back...')).toBeInTheDocument()
    })

    it('should disable rollback buttons while rolling back', async () => {
      vi.mocked(useGraphManagement).mockReturnValue(createMockGraphManagement({
        isRollingBack: true
      }))
      
      render(
        <GraphManagerModal isOpen={true} onClose={mockOnClose} initialTab="versions" />
      )
      
      const rollbackButton = screen.getByRole('button', { name: /Rolling back/i })
      expect(rollbackButton).toBeDisabled()
    })
  })

  describe('Loading States', () => {
    it('should disable Branch Current button when no graph is active', () => {
      vi.mocked(useGraphManagement).mockReturnValue(createMockGraphManagement({
        activeGraphId: null,
        activeGraph: undefined
      }))
      
      render(
        <GraphManagerModal isOpen={true} onClose={mockOnClose} />
      )
      
      const branchButton = screen.getByRole('button', { name: /Branch Current/i })
      expect(branchButton).toBeDisabled()
    })
  })
})
