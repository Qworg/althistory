import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ImportConflictStep } from './ImportConflictStep'
import { ImportConflict, ConflictResolution } from '@/types'

// Mock conflict data
const errorConflict: ImportConflict = {
  id: 'conflict-1',
  type: 'duplicate-id',
  entityType: 'event',
  entityId: 'event-1',
  severity: 'error',
  message: 'Event with this ID already exists in the graph',
  existingEntity: { id: 'event-1', description: 'Existing event' },
  incomingEntity: { id: 'event-1', description: 'New imported event' },
  suggestedResolution: 'skip',
}

const warningConflict: ImportConflict = {
  id: 'conflict-2',
  type: 'temporal-violation',
  entityType: 'arc',
  entityId: 'arc-1',
  severity: 'warning',
  message: 'Arc dates may overlap with existing arcs',
  suggestedResolution: 'overwrite',
}

const anotherErrorConflict: ImportConflict = {
  id: 'conflict-3',
  type: 'causal-paradox',
  entityType: 'relationship',
  entityId: 'rel-1',
  severity: 'error',
  message: 'Causal relationship creates paradox',
  suggestedResolution: 'rename',
}

describe('ImportConflictStep', () => {
  const user = userEvent.setup()
  const mockOnResolve = vi.fn()
  const mockOnResolveAll = vi.fn()
  const mockOnContinue = vi.fn()
  const mockOnBack = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  const renderComponent = (
    conflicts: ImportConflict[],
    resolutions: Record<string, ConflictResolution> = {},
    props = {}
  ) => {
    return render(
      <ImportConflictStep
        conflicts={conflicts}
        resolutions={resolutions}
        onResolve={mockOnResolve}
        onResolveAll={mockOnResolveAll}
        onContinue={mockOnContinue}
        onBack={mockOnBack}
        {...props}
      />
    )
  }

  describe('Initial Render', () => {
    it('should display conflict resolution header', () => {
      renderComponent([errorConflict])
      
      expect(screen.getByText('Resolve Conflicts')).toBeInTheDocument()
      expect(screen.getByText('1 conflict(s) found. Resolve errors to continue.')).toBeInTheDocument()
    })

    it('should show resolution progress', () => {
      renderComponent([errorConflict, warningConflict])
      
      expect(screen.getByText('Resolution Progress')).toBeInTheDocument()
      expect(screen.getByText('0 / 2 resolved')).toBeInTheDocument()
    })

    it('should show bulk action buttons', () => {
      renderComponent([errorConflict])
      
      expect(screen.getByText('Apply to all conflicts:')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Skip All' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Overwrite All' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Rename All' })).toBeInTheDocument()
    })
  })

  describe('Conflict Display', () => {
    it('should group errors separately from warnings', () => {
      renderComponent([errorConflict, warningConflict, anotherErrorConflict])
      
      expect(screen.getByText('Errors (2) - Must Resolve')).toBeInTheDocument()
      expect(screen.getByText('Warnings (1) - Optional')).toBeInTheDocument()
    })

    it('should display conflict details', () => {
      renderComponent([errorConflict])
      
      expect(screen.getByText('error')).toBeInTheDocument()
      expect(screen.getByText('event')).toBeInTheDocument()
      expect(screen.getByText('duplicate-id')).toBeInTheDocument()
      expect(screen.getByText('event-1')).toBeInTheDocument()
      expect(screen.getByText('Event with this ID already exists in the graph')).toBeInTheDocument()
    })

    it('should show entity comparison for duplicate-id conflicts', () => {
      renderComponent([errorConflict])
      
      expect(screen.getByText('Existing')).toBeInTheDocument()
      expect(screen.getByText('Incoming')).toBeInTheDocument()
      expect(screen.getByText(/Existing event/)).toBeInTheDocument()
      expect(screen.getByText(/New imported event/)).toBeInTheDocument()
    })

    it('should show suggested resolution hint', () => {
      renderComponent([errorConflict])
      
      expect(screen.getByText('(suggested: skip)')).toBeInTheDocument()
    })
  })

  describe('Resolution Selection', () => {
    it('should show resolution buttons for each conflict', () => {
      renderComponent([errorConflict])
      
      // Each conflict row has Skip, Overwrite, Rename buttons
      const skipButtons = screen.getAllByRole('button', { name: 'Skip' })
      const overwriteButtons = screen.getAllByRole('button', { name: 'Overwrite' })
      const renameButtons = screen.getAllByRole('button', { name: 'Rename' })
      
      expect(skipButtons.length).toBeGreaterThanOrEqual(1)
      expect(overwriteButtons.length).toBeGreaterThanOrEqual(1)
      expect(renameButtons.length).toBeGreaterThanOrEqual(1)
    })

    it('should call onResolve when resolution button clicked', async () => {
      renderComponent([errorConflict])
      
      // Get the Skip button from the conflict row (not bulk action)
      const conflictSection = screen.getByText('Resolution:').closest('div')
      const skipButton = conflictSection?.querySelector('button')
      
      if (skipButton) {
        await user.click(skipButton)
        expect(mockOnResolve).toHaveBeenCalledWith('conflict-1', 'skip')
      }
    })

    it('should highlight selected resolution', () => {
      renderComponent([errorConflict], { 'conflict-1': 'skip' })
      
      // The skip button should have the selected style (bg-blue-600)
      const skipButtons = screen.getAllByRole('button', { name: 'Skip' })
      const selectedButton = skipButtons.find(btn => btn.className.includes('bg-blue-600'))
      expect(selectedButton).toBeTruthy()
    })
  })

  describe('Bulk Actions', () => {
    it('should call onResolveAll with skip when Skip All clicked', async () => {
      renderComponent([errorConflict, warningConflict])
      
      const skipAllButton = screen.getByRole('button', { name: 'Skip All' })
      await user.click(skipAllButton)
      
      expect(mockOnResolveAll).toHaveBeenCalledWith('skip')
    })

    it('should call onResolveAll with overwrite when Overwrite All clicked', async () => {
      renderComponent([errorConflict, warningConflict])
      
      const overwriteAllButton = screen.getByRole('button', { name: 'Overwrite All' })
      await user.click(overwriteAllButton)
      
      expect(mockOnResolveAll).toHaveBeenCalledWith('overwrite')
    })

    it('should call onResolveAll with rename when Rename All clicked', async () => {
      renderComponent([errorConflict, warningConflict])
      
      const renameAllButton = screen.getByRole('button', { name: 'Rename All' })
      await user.click(renameAllButton)
      
      expect(mockOnResolveAll).toHaveBeenCalledWith('rename')
    })
  })

  describe('Progress Tracking', () => {
    it('should update progress as resolutions are added', () => {
      renderComponent([errorConflict, warningConflict], { 'conflict-1': 'skip' })
      
      expect(screen.getByText('1 / 2 resolved')).toBeInTheDocument()
    })

    it('should show all resolved when complete', () => {
      renderComponent(
        [errorConflict, warningConflict],
        { 'conflict-1': 'skip', 'conflict-2': 'overwrite' }
      )
      
      expect(screen.getByText('2 / 2 resolved')).toBeInTheDocument()
    })

    it('should show error count when errors not resolved', () => {
      renderComponent([errorConflict, anotherErrorConflict])
      
      expect(screen.getByText('2 error(s) still need resolution')).toBeInTheDocument()
    })

    it('should not show error count when all errors resolved', () => {
      renderComponent(
        [errorConflict, warningConflict],
        { 'conflict-1': 'skip' } // error resolved, warning not
      )
      
      expect(screen.queryByText(/error\(s\) still need resolution/)).not.toBeInTheDocument()
    })
  })

  describe('Continue Button', () => {
    it('should disable continue button when errors not resolved', () => {
      renderComponent([errorConflict])
      
      const continueButton = screen.getByRole('button', { name: 'Continue to Import' })
      expect(continueButton).toBeDisabled()
    })

    it('should enable continue button when all errors resolved', () => {
      renderComponent([errorConflict], { 'conflict-1': 'skip' })
      
      const continueButton = screen.getByRole('button', { name: 'Continue to Import' })
      expect(continueButton).not.toBeDisabled()
    })

    it('should enable continue button with unresolved warnings if errors are resolved', () => {
      renderComponent(
        [errorConflict, warningConflict],
        { 'conflict-1': 'skip' } // only error resolved
      )
      
      const continueButton = screen.getByRole('button', { name: 'Continue to Import' })
      expect(continueButton).not.toBeDisabled()
    })

    it('should call onContinue when clicked', async () => {
      renderComponent([errorConflict], { 'conflict-1': 'skip' })
      
      const continueButton = screen.getByRole('button', { name: 'Continue to Import' })
      await user.click(continueButton)
      
      expect(mockOnContinue).toHaveBeenCalled()
    })
  })

  describe('Navigation', () => {
    it('should call onBack when back button clicked', async () => {
      renderComponent([errorConflict])
      
      const backButton = screen.getByRole('button', { name: 'Back' })
      await user.click(backButton)
      
      expect(mockOnBack).toHaveBeenCalled()
    })

    it('should disable back button when loading', () => {
      renderComponent([errorConflict], {}, { isLoading: true })
      
      const backButton = screen.getByRole('button', { name: 'Back' })
      expect(backButton).toBeDisabled()
    })

    it('should show loading text on continue button', () => {
      renderComponent([errorConflict], { 'conflict-1': 'skip' }, { isLoading: true })
      
      expect(screen.getByRole('button', { name: 'Loading...' })).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty conflicts array', () => {
      renderComponent([])
      
      expect(screen.getByText('0 conflict(s) found. Resolve errors to continue.')).toBeInTheDocument()
      // Continue should be enabled when no conflicts
      const continueButton = screen.getByRole('button', { name: 'Continue to Import' })
      expect(continueButton).not.toBeDisabled()
    })

    it('should handle warnings only (no errors)', () => {
      renderComponent([warningConflict])
      
      expect(screen.queryByText(/Errors \(/)).not.toBeInTheDocument()
      expect(screen.getByText('Warnings (1) - Optional')).toBeInTheDocument()
      
      // Continue should be enabled since no errors
      const continueButton = screen.getByRole('button', { name: 'Continue to Import' })
      expect(continueButton).not.toBeDisabled()
    })
  })
})
