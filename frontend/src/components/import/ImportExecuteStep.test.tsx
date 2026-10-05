import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ImportExecuteStep } from './ImportExecuteStep'
import { ImportResult } from '@/types'

// Mock successful import result
const successfulResult: ImportResult = {
  success: true,
  graphId: 'graph-123',
  graphVersion: 5,
  imported: {
    events: 10,
    arcs: 3,
    relationships: 5,
    pressures: 2,
  },
  skipped: {
    events: 2,
    arcs: 0,
    relationships: 1,
    pressures: 0,
  },
  deleted: {
    events: 0,
    arcs: 0,
    relationships: 0,
    pressures: 0,
  },
  errors: [],
  warnings: [
    { code: 'ORPHAN_REF', message: 'Orphan reference resolved', path: 'arcs[0]' },
  ],
}

const failedResult: ImportResult = {
  success: false,
  graphId: 'graph-123',
  graphVersion: 4,
  imported: {
    events: 0,
    arcs: 0,
    relationships: 0,
    pressures: 0,
  },
  skipped: {
    events: 0,
    arcs: 0,
    relationships: 0,
    pressures: 0,
  },
  deleted: {
    events: 0,
    arcs: 0,
    relationships: 0,
    pressures: 0,
  },
  errors: [
    { code: 'CONSTRAINT_VIOLATION', message: 'Temporal constraint violated', path: 'events[0]' },
    { code: 'DB_ERROR', message: 'Database write failed', path: 'arcs[1]' },
  ],
  warnings: [],
}

describe('ImportExecuteStep', () => {
  const user = userEvent.setup()
  const mockOnExecute = vi.fn()
  const mockOnBack = vi.fn()
  const mockOnComplete = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  const renderComponent = (props = {}) => {
    return render(
      <ImportExecuteStep
        isExecuting={false}
        progress={0}
        result={null}
        error={null}
        onExecute={mockOnExecute}
        onBack={mockOnBack}
        onComplete={mockOnComplete}
        {...props}
      />
    )
  }

  describe('Initial State (Ready to Import)', () => {
    it('should display ready to import header', () => {
      renderComponent()
      
      // There are two "Ready to Import" texts - one in header, one in banner
      const readyTexts = screen.getAllByText('Ready to Import')
      expect(readyTexts.length).toBeGreaterThan(0)
      expect(screen.getByText('Click the button below to start the import process')).toBeInTheDocument()
    })

    it('should show information banner', () => {
      renderComponent()
      
      expect(screen.getByText(/All validations passed/)).toBeInTheDocument()
      expect(screen.getByText(/This action will create a new version/)).toBeInTheDocument()
    })

    it('should show Start Import button', () => {
      renderComponent()
      
      expect(screen.getByRole('button', { name: 'Start Import' })).toBeInTheDocument()
    })

    it('should call onExecute when Start Import clicked', async () => {
      renderComponent()
      
      const startButton = screen.getByRole('button', { name: 'Start Import' })
      await user.click(startButton)
      
      expect(mockOnExecute).toHaveBeenCalled()
    })

    it('should show Back button', () => {
      renderComponent()
      
      expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
    })

    it('should call onBack when Back clicked', async () => {
      renderComponent()
      
      const backButton = screen.getByRole('button', { name: 'Back' })
      await user.click(backButton)
      
      expect(mockOnBack).toHaveBeenCalled()
    })
  })

  describe('Executing State', () => {
    it('should display importing header', () => {
      renderComponent({ isExecuting: true })
      
      expect(screen.getByText('Importing...')).toBeInTheDocument()
      expect(screen.getByText('Please wait while your data is being imported')).toBeInTheDocument()
    })

    it('should show progress bar', () => {
      renderComponent({ isExecuting: true, progress: 45 })
      
      expect(screen.getByText('Progress')).toBeInTheDocument()
      expect(screen.getByText('45%')).toBeInTheDocument()
    })

    it('should update progress bar width', () => {
      const { container } = renderComponent({ isExecuting: true, progress: 60 })
      
      const progressBar = container.querySelector('.bg-blue-500')
      expect(progressBar).toHaveStyle({ width: '60%' })
    })

    it('should show processing message', () => {
      renderComponent({ isExecuting: true })
      
      expect(screen.getByText('Processing entities...')).toBeInTheDocument()
    })

    it('should disable back button while executing', () => {
      renderComponent({ isExecuting: true })
      
      const backButton = screen.getByRole('button', { name: 'Back' })
      expect(backButton).toBeDisabled()
    })

    it('should not show Start Import button while executing', () => {
      renderComponent({ isExecuting: true })
      
      expect(screen.queryByRole('button', { name: 'Start Import' })).not.toBeInTheDocument()
    })
  })

  describe('Success State', () => {
    it('should display import complete header', () => {
      renderComponent({ result: successfulResult })
      
      expect(screen.getByText('Import Complete')).toBeInTheDocument()
      expect(screen.getByText('Your data has been successfully imported')).toBeInTheDocument()
    })

    it('should show success banner with graph info', () => {
      renderComponent({ result: successfulResult })
      
      expect(screen.getByText('Import Successful')).toBeInTheDocument()
      expect(screen.getByText('Graph version: 5')).toBeInTheDocument()
      expect(screen.getByText('Graph ID: graph-123')).toBeInTheDocument()
    })

    it('should show import summary', () => {
      renderComponent({ result: successfulResult })
      
      expect(screen.getByText('Import Summary')).toBeInTheDocument()
      expect(screen.getByText('Imported')).toBeInTheDocument()
      expect(screen.getByText('Skipped')).toBeInTheDocument()
    })

    it('should display imported counts', () => {
      renderComponent({ result: successfulResult })
      
      // Check for imported events count
      expect(screen.getByText('10')).toBeInTheDocument()
      expect(screen.getAllByText('events').length).toBeGreaterThan(0)
    })

    it('should display warnings when present', () => {
      renderComponent({ result: successfulResult })
      
      expect(screen.getByText('Warnings (1)')).toBeInTheDocument()
      expect(screen.getByText('ORPHAN_REF: Orphan reference resolved')).toBeInTheDocument()
    })

    it('should show Done button', () => {
      renderComponent({ result: successfulResult })
      
      expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()
    })

    it('should call onComplete when Done clicked', async () => {
      renderComponent({ result: successfulResult })
      
      const doneButton = screen.getByRole('button', { name: 'Done' })
      await user.click(doneButton)
      
      expect(mockOnComplete).toHaveBeenCalled()
    })

    it('should show Start Over button', () => {
      renderComponent({ result: successfulResult })
      
      expect(screen.getByRole('button', { name: 'Start Over' })).toBeInTheDocument()
    })

    it('should call onBack when Start Over clicked', async () => {
      renderComponent({ result: successfulResult })
      
      const startOverButton = screen.getByRole('button', { name: 'Start Over' })
      await user.click(startOverButton)
      
      expect(mockOnBack).toHaveBeenCalled()
    })
  })

  describe('Failed State', () => {
    it('should display import failed header', () => {
      renderComponent({ result: failedResult })
      
      // Multiple "Import Failed" texts may exist
      const failedTexts = screen.getAllByText('Import Failed')
      expect(failedTexts.length).toBeGreaterThan(0)
      expect(screen.getByText('There was an error during the import process')).toBeInTheDocument()
    })

    it('should show error banner', () => {
      renderComponent({ result: failedResult })
      
      // Check for the failed banner title
      const failedTexts = screen.getAllByText('Import Failed')
      expect(failedTexts.length).toBeGreaterThan(0)
    })

    it('should display error message when error prop provided', () => {
      renderComponent({ error: 'Network connection lost' })
      
      expect(screen.getByText('Network connection lost')).toBeInTheDocument()
    })

    it('should display detailed errors from result', () => {
      renderComponent({ result: failedResult })
      
      expect(screen.getByText('Errors (2)')).toBeInTheDocument()
      expect(screen.getByText('CONSTRAINT_VIOLATION:')).toBeInTheDocument()
      expect(screen.getByText('Temporal constraint violated')).toBeInTheDocument()
    })

    it('should show Retry Import button', () => {
      renderComponent({ result: failedResult })
      
      expect(screen.getByRole('button', { name: 'Retry Import' })).toBeInTheDocument()
    })

    it('should call onExecute when Retry Import clicked', async () => {
      renderComponent({ result: failedResult })
      
      const retryButton = screen.getByRole('button', { name: 'Retry Import' })
      await user.click(retryButton)
      
      expect(mockOnExecute).toHaveBeenCalled()
    })

    it('should show Start Over button on failure', () => {
      renderComponent({ result: failedResult })
      
      expect(screen.getByRole('button', { name: 'Start Over' })).toBeInTheDocument()
    })
  })

  describe('Error Only State (no result)', () => {
    it('should show failed state with error message only', () => {
      renderComponent({ error: 'Something went wrong' })
      
      const failedTexts = screen.getAllByText('Import Failed')
      expect(failedTexts.length).toBeGreaterThan(0)
      expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    })

    it('should show Retry Import button', () => {
      renderComponent({ error: 'Something went wrong' })
      
      expect(screen.getByRole('button', { name: 'Retry Import' })).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle result with no warnings', () => {
      const resultNoWarnings = { ...successfulResult, warnings: [] }
      renderComponent({ result: resultNoWarnings })
      
      expect(screen.queryByText(/Warnings \(/)).not.toBeInTheDocument()
    })

    it('should handle result with zero imported counts', () => {
      const resultZeroCounts: ImportResult = {
        ...successfulResult,
        imported: { events: 0, arcs: 0, relationships: 0, pressures: 0 },
      }
      renderComponent({ result: resultZeroCounts })
      
      // Should not show Imported section if all zeros
      expect(screen.getByText('Import Summary')).toBeInTheDocument()
    })

    it('should handle result with zero skipped counts', () => {
      const resultZeroSkipped: ImportResult = {
        ...successfulResult,
        skipped: { events: 0, arcs: 0, relationships: 0, pressures: 0 },
      }
      renderComponent({ result: resultZeroSkipped })
      
      // Should still show summary
      expect(screen.getByText('Import Summary')).toBeInTheDocument()
    })

    it('should show 100% progress at completion', () => {
      renderComponent({ isExecuting: false, progress: 100, result: successfulResult })
      
      // Should show success state, not progress
      expect(screen.getByText('Import Complete')).toBeInTheDocument()
    })
  })
})
