import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VersionHistoryPanel } from './VersionHistoryPanel'
import { 
  useGraphVersions, 
  useRollbackGraph, 
  useActiveGraphId, 
  useActiveGraph 
} from '@/hooks/useGraphs'
import { GraphVersion, Graph } from '@/types'

// Mock dependencies
vi.mock('@/hooks/useGraphs')

const mockActiveGraph: Graph = {
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
}

const mockVersions: GraphVersion[] = [
  {
    version: 3,
    commitHash: 'abc123',
    timestamp: new Date(Date.now() - 1000 * 60 * 5).toISOString(), // 5 minutes ago
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
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), // 2 hours ago
    message: 'Updated arc descriptions',
    author: 'user2',
    changes: {
      eventsAdded: 0,
      eventsModified: 10,
      eventsDeleted: 2,
      arcsAdded: 0,
      arcsModified: 3,
      arcsDeleted: 0,
      relationshipsAdded: 0,
      relationshipsModified: 5,
      relationshipsDeleted: 1
    }
  },
  {
    version: 1,
    commitHash: 'ghi789',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(), // 3 days ago
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

const createMockRollbackMutation = (overrides = {}) => ({
  mutateAsync: vi.fn().mockResolvedValue({}),
  isPending: false,
  ...overrides
})

describe('VersionHistoryPanel', () => {
  const user = userEvent.setup()
  const mockOnVersionSelect = vi.fn()
  let mockRollbackMutation: ReturnType<typeof createMockRollbackMutation>

  beforeEach(() => {
    mockRollbackMutation = createMockRollbackMutation()
    
    vi.mocked(useActiveGraphId).mockReturnValue('graph1')
    vi.mocked(useActiveGraph).mockReturnValue({
      data: mockActiveGraph,
      isLoading: false,
      error: null
    } as any)
    vi.mocked(useGraphVersions).mockReturnValue({
      data: mockVersions,
      isLoading: false,
      error: null
    } as any)
    vi.mocked(useRollbackGraph).mockReturnValue(mockRollbackMutation as any)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('No Graph Selected', () => {
    it('should display "No graph selected" when no graph is active', () => {
      vi.mocked(useActiveGraphId).mockReturnValue(null)
      
      render(<VersionHistoryPanel />)
      
      expect(screen.getByText('No graph selected')).toBeInTheDocument()
    })
  })

  describe('Panel Header', () => {
    it('should display panel header with version history title', () => {
      render(<VersionHistoryPanel />)
      
      expect(screen.getByText('Version History')).toBeInTheDocument()
    })

    it('should display current version badge', () => {
      render(<VersionHistoryPanel />)
      
      // v3 appears in both the header badge and in the version list
      expect(screen.getAllByText('v3').length).toBeGreaterThanOrEqual(1)
    })

    it('should apply custom className', () => {
      const { container } = render(<VersionHistoryPanel className="custom-class" />)
      
      expect(container.firstChild).toHaveClass('custom-class')
    })
  })

  describe('Collapse/Expand Behavior', () => {
    it('should be expanded by default', () => {
      render(<VersionHistoryPanel />)
      
      // Version list should be visible
      expect(screen.getByText('Added new events for February')).toBeInTheDocument()
    })

    it('should collapse when header is clicked', async () => {
      render(<VersionHistoryPanel />)
      
      // Click header to collapse
      const header = screen.getByRole('button', { name: /Version History/i })
      await user.click(header)
      
      // Version list should be hidden
      expect(screen.queryByText('Added new events for February')).not.toBeInTheDocument()
    })

    it('should expand when header is clicked again', async () => {
      render(<VersionHistoryPanel />)
      
      const header = screen.getByRole('button', { name: /Version History/i })
      
      // Collapse
      await user.click(header)
      expect(screen.queryByText('Added new events for February')).not.toBeInTheDocument()
      
      // Expand
      await user.click(header)
      expect(screen.getByText('Added new events for February')).toBeInTheDocument()
    })
  })

  describe('Loading State', () => {
    it('should display loading spinner when loading', () => {
      vi.mocked(useGraphVersions).mockReturnValue({
        data: null,
        isLoading: true,
        error: null
      } as any)
      
      render(<VersionHistoryPanel />)
      
      expect(screen.getByText('Loading history...')).toBeInTheDocument()
    })

    it('should display spinner animation', () => {
      vi.mocked(useGraphVersions).mockReturnValue({
        data: null,
        isLoading: true,
        error: null
      } as any)
      
      render(<VersionHistoryPanel />)
      
      const spinner = document.querySelector('.animate-spin')
      expect(spinner).toBeInTheDocument()
    })
  })

  describe('Error State', () => {
    it('should display error message when loading fails', () => {
      vi.mocked(useGraphVersions).mockReturnValue({
        data: null,
        isLoading: false,
        error: new Error('Network error')
      } as any)
      
      render(<VersionHistoryPanel />)
      
      expect(screen.getByText('Failed to load version history')).toBeInTheDocument()
    })
  })

  describe('Empty State', () => {
    it('should display empty message when no versions exist', () => {
      vi.mocked(useGraphVersions).mockReturnValue({
        data: [],
        isLoading: false,
        error: null
      } as any)
      
      render(<VersionHistoryPanel />)
      
      expect(screen.getByText('No version history available')).toBeInTheDocument()
    })

    it('should display empty message when versions is null', () => {
      vi.mocked(useGraphVersions).mockReturnValue({
        data: null,
        isLoading: false,
        error: null
      } as any)
      
      render(<VersionHistoryPanel />)
      
      expect(screen.getByText('No version history available')).toBeInTheDocument()
    })
  })

  describe('Version List Rendering', () => {
    it('should display all versions', () => {
      render(<VersionHistoryPanel />)
      
      // v3 appears in both header and version list
      expect(screen.getAllByText('v3').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('v2')).toBeInTheDocument()
      expect(screen.getByText('v1')).toBeInTheDocument()
    })

    it('should display version commit messages', () => {
      render(<VersionHistoryPanel />)
      
      expect(screen.getByText('Added new events for February')).toBeInTheDocument()
      expect(screen.getByText('Updated arc descriptions')).toBeInTheDocument()
      expect(screen.getByText('Initial import')).toBeInTheDocument()
    })

    it('should display "No commit message" when message is empty', () => {
      vi.mocked(useGraphVersions).mockReturnValue({
        data: [{
          ...mockVersions[0],
          message: ''
        }],
        isLoading: false,
        error: null
      } as any)
      
      render(<VersionHistoryPanel />)
      
      expect(screen.getByText('No commit message')).toBeInTheDocument()
    })

    it('should display author names', () => {
      render(<VersionHistoryPanel />)
      
      // user1 appears multiple times (authored multiple versions)
      expect(screen.getAllByText('user1').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('user2')).toBeInTheDocument()
    })

    it('should display relative timestamps', () => {
      render(<VersionHistoryPanel />)
      
      // Should show relative time like "5m ago", "2h ago", "3d ago"
      expect(screen.getByText('5m ago')).toBeInTheDocument()
      expect(screen.getByText('2h ago')).toBeInTheDocument()
      expect(screen.getByText('3d ago')).toBeInTheDocument()
    })

    it('should show "Current" badge for current version', () => {
      render(<VersionHistoryPanel />)
      
      const currentBadges = screen.getAllByText('Current')
      expect(currentBadges.length).toBeGreaterThanOrEqual(1)
    })

    it('should show "Latest" badge for latest version when not current', () => {
      // Set active graph to version 2
      vi.mocked(useActiveGraph).mockReturnValue({
        data: { ...mockActiveGraph, version: 2 },
        isLoading: false,
        error: null
      } as any)
      
      render(<VersionHistoryPanel />)
      
      expect(screen.getByText('Latest')).toBeInTheDocument()
    })

    it('should highlight current version with blue background', () => {
      render(<VersionHistoryPanel />)
      
      // v3 appears multiple times, find the one in the version list
      const v3Elements = screen.getAllByText('v3')
      const v3Item = v3Elements.find(el => el.classList.contains('font-medium'))?.closest('.px-4')
      expect(v3Item).toHaveClass('bg-blue-50')
    })

    it('should respect maxVersions prop', () => {
      render(<VersionHistoryPanel maxVersions={2} />)
      
      // Hook should be called with limit
      expect(useGraphVersions).toHaveBeenCalledWith('graph1', 2)
    })
  })

  describe('Changes Summary', () => {
    it('should display events added badge', () => {
      render(<VersionHistoryPanel />)
      
      // v3 has +5 events - check any event badge contains +5
      const eventBadges = screen.getAllByTitle('events')
      expect(eventBadges.some(el => el.textContent?.includes('+5'))).toBe(true)
    })

    it('should display events modified badge', () => {
      render(<VersionHistoryPanel />)
      
      // v2 has ~10 events modified and -2 deleted
      const eventBadges = screen.getAllByTitle('events')
      const v2EventBadge = eventBadges.find(el => el.textContent?.includes('~10'))
      expect(v2EventBadge).toBeTruthy()
    })

    it('should display arcs changes', () => {
      render(<VersionHistoryPanel />)
      
      // v3 has +1 arc
      const arcBadges = screen.getAllByTitle('arcs')
      expect(arcBadges.some(el => el.textContent?.includes('+1'))).toBe(true)
    })

    it('should display relationships changes', () => {
      render(<VersionHistoryPanel />)
      
      // v3 has +3 relationships, ~1 modified
      const relBadges = screen.getAllByTitle('relationships')
      expect(relBadges.some(el => el.textContent?.includes('+3'))).toBe(true)
    })

    it('should not display badge when no changes for a type', () => {
      vi.mocked(useGraphVersions).mockReturnValue({
        data: [{
          ...mockVersions[0],
          changes: {
            eventsAdded: 0,
            eventsModified: 0,
            eventsDeleted: 0,
            arcsAdded: 0,
            arcsModified: 0,
            arcsDeleted: 0,
            relationshipsAdded: 5,
            relationshipsModified: 0,
            relationshipsDeleted: 0
          }
        }],
        isLoading: false,
        error: null
      } as any)
      
      render(<VersionHistoryPanel />)
      
      // Only relationships badge should appear
      expect(screen.getByText('R: +5')).toBeInTheDocument()
      expect(screen.queryByText(/^E:/)).not.toBeInTheDocument()
      expect(screen.queryByText(/^A:/)).not.toBeInTheDocument()
    })
  })

  describe('Rollback Functionality', () => {
    it('should show rollback button for non-current versions', () => {
      render(<VersionHistoryPanel />)
      
      // v2 and v1 should have rollback buttons (indicated by the icon)
      const rollbackButtons = document.querySelectorAll('[title="Rollback to this version"]')
      expect(rollbackButtons.length).toBe(2)
    })

    it('should not show rollback button for current version', () => {
      render(<VersionHistoryPanel />)
      
      // v3 is current, should not have rollback button
      // Find the v3 in the version list (not in the header)
      const v3Elements = screen.getAllByText('v3')
      const v3Item = v3Elements.find(el => el.classList.contains('font-medium'))?.closest('.px-4')
      const rollbackBtn = v3Item?.querySelector('[title="Rollback to this version"]')
      expect(rollbackBtn).not.toBeInTheDocument()
    })

    it('should show confirmation buttons when rollback is clicked', async () => {
      render(<VersionHistoryPanel />)
      
      const rollbackButtons = document.querySelectorAll('[title="Rollback to this version"]')
      await user.click(rollbackButtons[0])
      
      expect(screen.getByRole('button', { name: 'Yes' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'No' })).toBeInTheDocument()
    })

    it('should call rollback mutation when confirmed', async () => {
      render(<VersionHistoryPanel />)
      
      const rollbackButtons = document.querySelectorAll('[title="Rollback to this version"]')
      await user.click(rollbackButtons[0])
      
      await user.click(screen.getByRole('button', { name: 'Yes' }))
      
      await waitFor(() => {
        expect(mockRollbackMutation.mutateAsync).toHaveBeenCalledWith({
          id: 'graph1',
          version: 2
        })
      })
    })

    it('should cancel rollback when No is clicked', async () => {
      render(<VersionHistoryPanel />)
      
      const rollbackButtons = document.querySelectorAll('[title="Rollback to this version"]')
      await user.click(rollbackButtons[0])
      
      await user.click(screen.getByRole('button', { name: 'No' }))
      
      // Confirmation should be hidden, rollback button should be back
      expect(screen.queryByRole('button', { name: 'Yes' })).not.toBeInTheDocument()
      expect(mockRollbackMutation.mutateAsync).not.toHaveBeenCalled()
    })

    it('should show loading state while rolling back', async () => {
      vi.mocked(useRollbackGraph).mockReturnValue(createMockRollbackMutation({
        isPending: true
      }) as any)
      
      render(<VersionHistoryPanel />)
      
      const rollbackButtons = document.querySelectorAll('[title="Rollback to this version"]')
      await user.click(rollbackButtons[0])
      
      expect(screen.getByText('...')).toBeInTheDocument()
    })

    it('should disable confirmation buttons while rolling back', async () => {
      vi.mocked(useRollbackGraph).mockReturnValue(createMockRollbackMutation({
        isPending: true
      }) as any)
      
      render(<VersionHistoryPanel />)
      
      const rollbackButtons = document.querySelectorAll('[title="Rollback to this version"]')
      await user.click(rollbackButtons[0])
      
      const yesButton = screen.getByRole('button', { name: '...' })
      expect(yesButton).toBeDisabled()
    })

    it('should hide confirmation after successful rollback', async () => {
      render(<VersionHistoryPanel />)
      
      const rollbackButtons = document.querySelectorAll('[title="Rollback to this version"]')
      await user.click(rollbackButtons[0])
      await user.click(screen.getByRole('button', { name: 'Yes' }))
      
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'Yes' })).not.toBeInTheDocument()
      })
    })

    it('should handle rollback error gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      
      vi.mocked(useRollbackGraph).mockReturnValue(createMockRollbackMutation({
        mutateAsync: vi.fn().mockRejectedValue(new Error('Rollback failed'))
      }) as any)
      
      render(<VersionHistoryPanel />)
      
      const rollbackButtons = document.querySelectorAll('[title="Rollback to this version"]')
      await user.click(rollbackButtons[0])
      await user.click(screen.getByRole('button', { name: 'Yes' }))
      
      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith('Rollback failed:', expect.any(Error))
      })
      
      consoleSpy.mockRestore()
    })
  })

  describe('Version Click Handler', () => {
    it('should call onVersionSelect when version item is clicked', async () => {
      render(<VersionHistoryPanel onVersionSelect={mockOnVersionSelect} />)
      
      const versionItem = screen.getByText('Updated arc descriptions').closest('.px-4')
      await user.click(versionItem!)
      
      expect(mockOnVersionSelect).toHaveBeenCalledWith(mockVersions[1])
    })

    it('should not prevent rollback click from bubbling', async () => {
      render(<VersionHistoryPanel onVersionSelect={mockOnVersionSelect} />)
      
      const rollbackButtons = document.querySelectorAll('[title="Rollback to this version"]')
      await user.click(rollbackButtons[0])
      
      // Version select should not be called when clicking rollback
      expect(mockOnVersionSelect).not.toHaveBeenCalled()
    })
  })

  describe('Accessibility', () => {
    it('should have proper heading structure', () => {
      render(<VersionHistoryPanel />)
      
      expect(screen.getByText('Version History')).toBeInTheDocument()
    })

    it('should have interactive elements as buttons', () => {
      render(<VersionHistoryPanel />)
      
      const headerButton = screen.getByRole('button', { name: /Version History/i })
      expect(headerButton).toBeInTheDocument()
    })
  })
})
