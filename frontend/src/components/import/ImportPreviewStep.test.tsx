import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ImportPreviewStep } from './ImportPreviewStep'
import { ImportPreview, ImportMode } from '@/types'

// Mock preview data
const emptyCountsMock = {
  events: 0,
  arcs: 0,
  relationships: 0,
  pressures: 0,
}

const createPreviewMock = (overrides = {}): ImportPreview => ({
  toCreate: { events: 10, arcs: 3, relationships: 5, pressures: 2 },
  toUpdate: { events: 2, arcs: 1, relationships: 0, pressures: 0 },
  toDelete: emptyCountsMock,
  conflicts: [],
  warnings: [],
  ...overrides,
})

const previewWithConflicts: ImportPreview = createPreviewMock({
  conflicts: [
    {
      id: 'conflict-1',
      type: 'duplicate-id',
      entityType: 'event',
      entityId: 'event-1',
      severity: 'error',
      message: 'Event ID already exists',
      existingEntity: { id: 'event-1', description: 'Old event' },
      incomingEntity: { id: 'event-1', description: 'New event' },
      suggestedResolution: 'skip',
    },
  ],
})

const previewWithWarnings: ImportPreview = createPreviewMock({
  warnings: [
    { code: 'ORPHAN_REF', message: 'Orphan reference detected', path: 'arcs[0]' },
    { code: 'DEPRECATED', message: 'Deprecated field found', path: 'events[1]' },
  ],
})

const previewNoChanges: ImportPreview = createPreviewMock({
  toCreate: emptyCountsMock,
  toUpdate: emptyCountsMock,
  toDelete: emptyCountsMock,
})

describe('ImportPreviewStep', () => {
  const user = userEvent.setup()
  const mockOnModeChange = vi.fn()
  const mockOnContinue = vi.fn()
  const mockOnBack = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  const renderComponent = (preview: ImportPreview, mode: ImportMode = 'create-new', props = {}) => {
    return render(
      <ImportPreviewStep
        preview={preview}
        mode={mode}
        onModeChange={mockOnModeChange}
        onContinue={mockOnContinue}
        onBack={mockOnBack}
        hasConflicts={preview.conflicts.length > 0}
        {...props}
      />
    )
  }

  describe('Initial Render', () => {
    it('should display preview header', () => {
      renderComponent(createPreviewMock())
      
      expect(screen.getByText('Import Preview')).toBeInTheDocument()
      expect(screen.getByText('Review what changes will be made to your graph')).toBeInTheDocument()
    })

    it('should display import mode selection', () => {
      renderComponent(createPreviewMock())
      
      expect(screen.getByText('Import Mode')).toBeInTheDocument()
      expect(screen.getByText('Create New Graph')).toBeInTheDocument()
      expect(screen.getByText('Merge into Current Graph')).toBeInTheDocument()
      expect(screen.getByText('Replace Current Graph')).toBeInTheDocument()
    })
  })

  describe('Import Mode Selection', () => {
    it('should have create-new mode selected by default', () => {
      renderComponent(createPreviewMock(), 'create-new')
      
      const createNewRadio = screen.getByRole('radio', { name: /Create New Graph/i })
      expect(createNewRadio).toBeChecked()
    })

    it('should call onModeChange when mode is changed', async () => {
      renderComponent(createPreviewMock(), 'create-new')
      
      const mergeRadio = screen.getByRole('radio', { name: /Merge into Current Graph/i })
      await user.click(mergeRadio)
      
      expect(mockOnModeChange).toHaveBeenCalledWith('merge')
    })

    it('should call onModeChange for replace mode', async () => {
      renderComponent(createPreviewMock(), 'create-new')
      
      const replaceRadio = screen.getByRole('radio', { name: /Replace Current Graph/i })
      await user.click(replaceRadio)
      
      expect(mockOnModeChange).toHaveBeenCalledWith('replace')
    })

    it('should show correct mode descriptions', () => {
      renderComponent(createPreviewMock())
      
      expect(screen.getByText('Import into a brand new graph (no conflicts possible)')).toBeInTheDocument()
      expect(screen.getByText('Add new entities, skip existing ones with same IDs')).toBeInTheDocument()
      expect(screen.getByText('Replace existing entities with imported data')).toBeInTheDocument()
    })
  })

  describe('Change Summary Cards', () => {
    it('should display counts for entities to create', () => {
      renderComponent(createPreviewMock())
      
      expect(screen.getByText('To Create')).toBeInTheDocument()
      expect(screen.getByText('10')).toBeInTheDocument() // events
      expect(screen.getByText('3')).toBeInTheDocument() // arcs
    })

    it('should display counts for entities to update', () => {
      renderComponent(createPreviewMock())
      
      expect(screen.getByText('To Update')).toBeInTheDocument()
    })

    it('should not display card when all counts are zero', () => {
      renderComponent(previewNoChanges)
      
      expect(screen.queryByText('To Create')).not.toBeInTheDocument()
      expect(screen.queryByText('To Update')).not.toBeInTheDocument()
      expect(screen.queryByText('To Delete')).not.toBeInTheDocument()
    })

    it('should show no changes message when nothing will change', () => {
      renderComponent(previewNoChanges)
      
      expect(screen.getByText('No changes will be made with current settings')).toBeInTheDocument()
    })
  })

  describe('Conflicts Warning', () => {
    it('should show conflicts warning when hasConflicts is true', () => {
      renderComponent(previewWithConflicts)
      
      expect(screen.getByText('Conflicts Detected')).toBeInTheDocument()
      expect(screen.getByText(/1 conflict\(s\) that need to be resolved/)).toBeInTheDocument()
    })

    it('should not show conflicts warning when no conflicts', () => {
      renderComponent(createPreviewMock())
      
      expect(screen.queryByText('Conflicts Detected')).not.toBeInTheDocument()
    })

    it('should change continue button text when has conflicts', () => {
      renderComponent(previewWithConflicts)
      
      expect(screen.getByRole('button', { name: 'Resolve Conflicts' })).toBeInTheDocument()
    })
  })

  describe('Warnings Display', () => {
    it('should display warnings when present', () => {
      renderComponent(previewWithWarnings)
      
      expect(screen.getByText('Warnings (2)')).toBeInTheDocument()
      expect(screen.getByText(/ORPHAN_REF/)).toBeInTheDocument()
      expect(screen.getByText(/DEPRECATED/)).toBeInTheDocument()
    })

    it('should not display warnings section when no warnings', () => {
      renderComponent(createPreviewMock())
      
      expect(screen.queryByText(/Warnings \(/)).not.toBeInTheDocument()
    })

    it('should truncate warnings list and show count when more than 5', () => {
      const manyWarnings: ImportPreview = createPreviewMock({
        warnings: Array.from({ length: 8 }, (_, i) => ({
          code: `WARN_${i}`,
          message: `Warning ${i}`,
          path: `path[${i}]`,
        })),
      })
      renderComponent(manyWarnings)
      
      expect(screen.getByText('Warnings (8)')).toBeInTheDocument()
      expect(screen.getByText(/And 3 more warnings/)).toBeInTheDocument()
    })
  })

  describe('Navigation', () => {
    it('should call onContinue when continue button clicked', async () => {
      renderComponent(createPreviewMock())
      
      const continueButton = screen.getByRole('button', { name: 'Continue to Import' })
      await user.click(continueButton)
      
      expect(mockOnContinue).toHaveBeenCalled()
    })

    it('should call onBack when back button clicked', async () => {
      renderComponent(createPreviewMock())
      
      const backButton = screen.getByRole('button', { name: 'Back' })
      await user.click(backButton)
      
      expect(mockOnBack).toHaveBeenCalled()
    })
  })

  describe('Loading State', () => {
    it('should disable mode selection when loading', () => {
      renderComponent(createPreviewMock(), 'create-new', { isLoading: true })
      
      const createNewRadio = screen.getByRole('radio', { name: /Create New Graph/i })
      expect(createNewRadio).toBeDisabled()
    })

    it('should disable back button when loading', () => {
      renderComponent(createPreviewMock(), 'create-new', { isLoading: true })
      
      const backButton = screen.getByRole('button', { name: 'Back' })
      expect(backButton).toBeDisabled()
    })

    it('should show loading text on continue button', () => {
      renderComponent(createPreviewMock(), 'create-new', { isLoading: true })
      
      expect(screen.getByRole('button', { name: 'Loading...' })).toBeInTheDocument()
    })
  })
})
