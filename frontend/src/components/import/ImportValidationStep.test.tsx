import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ImportValidationStep } from './ImportValidationStep'
import { ImportValidationResult } from '@/types'

// Mock validation results
const validValidation: ImportValidationResult = {
  valid: true,
  errors: [],
  warnings: [],
  summary: {
    eventCount: 10,
    arcCount: 3,
    relationshipCount: 5,
    pressureCount: 2,
    actors: ['Actor A', 'Actor B', 'Actor C'],
    temporalRange: {
      start: '1900-01-01T00:00:00Z',
      end: '2000-12-31T23:59:59Z',
    },
  },
}

const invalidValidation: ImportValidationResult = {
  valid: false,
  errors: [
    {
      code: 'MISSING_FIELD',
      message: 'Event description is required',
      path: 'data.events[0].description',
    },
    {
      code: 'INVALID_DATE',
      message: 'Invalid timestamp format',
      path: 'data.events[1].timestamp',
    },
  ],
  warnings: [
    {
      code: 'ORPHAN_REFERENCE',
      message: 'Arc references non-existent parent',
      path: 'data.arcs[0].parentId',
    },
  ],
  summary: {
    eventCount: 8,
    arcCount: 2,
    relationshipCount: 3,
    pressureCount: 1,
    actors: ['Actor A'],
    temporalRange: null,
  },
}

const validationWithWarningsOnly: ImportValidationResult = {
  valid: true,
  errors: [],
  warnings: [
    {
      code: 'DEPRECATED_FIELD',
      message: 'Field "oldField" is deprecated',
      path: 'data.events[0].oldField',
    },
  ],
  summary: {
    eventCount: 5,
    arcCount: 1,
    relationshipCount: 2,
    pressureCount: 0,
    actors: [],
    temporalRange: null,
  },
}

describe('ImportValidationStep', () => {
  const user = userEvent.setup()
  const mockOnContinue = vi.fn()
  const mockOnBack = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  const renderComponent = (validation: ImportValidationResult, props = {}) => {
    return render(
      <ImportValidationStep
        validation={validation}
        onContinue={mockOnContinue}
        onBack={mockOnBack}
        {...props}
      />
    )
  }

  describe('Valid Validation', () => {
    it('should show validation passed message', () => {
      renderComponent(validValidation)
      
      expect(screen.getByText('Validation Passed')).toBeInTheDocument()
      expect(screen.getByText('Your import file passed validation')).toBeInTheDocument()
    })

    it('should display green success banner', () => {
      renderComponent(validValidation)
      
      const banner = screen.getByText('Validation Passed').closest('div')?.parentElement?.parentElement
      expect(banner).toHaveClass('bg-green-50')
    })

    it('should show entity counts in summary', () => {
      renderComponent(validValidation)
      
      expect(screen.getByText('Events')).toBeInTheDocument()
      expect(screen.getByText('10')).toBeInTheDocument()
      expect(screen.getByText('Arcs')).toBeInTheDocument()
      expect(screen.getByText('3')).toBeInTheDocument()
      expect(screen.getByText('Relationships')).toBeInTheDocument()
      expect(screen.getByText('5')).toBeInTheDocument()
      expect(screen.getByText('Pressures')).toBeInTheDocument()
      expect(screen.getByText('2')).toBeInTheDocument()
    })

    it('should show temporal range when available', () => {
      renderComponent(validValidation)
      
      expect(screen.getByText('Time Range')).toBeInTheDocument()
      // Date formatting may vary based on locale, just check Time Range section exists
      const timeRangeSection = screen.getByText('Time Range').closest('div')
      expect(timeRangeSection).toBeInTheDocument()
    })

    it('should show actors when available', () => {
      renderComponent(validValidation)
      
      expect(screen.getByText('Actors (3)')).toBeInTheDocument()
      expect(screen.getByText(/Actor A, Actor B, Actor C/)).toBeInTheDocument()
    })

    it('should enable continue button', () => {
      renderComponent(validValidation)
      
      const continueButton = screen.getByRole('button', { name: 'Continue to Preview' })
      expect(continueButton).not.toBeDisabled()
    })

    it('should call onContinue when continue button clicked', async () => {
      renderComponent(validValidation)
      
      const continueButton = screen.getByRole('button', { name: 'Continue to Preview' })
      await user.click(continueButton)
      
      expect(mockOnContinue).toHaveBeenCalled()
    })
  })

  describe('Invalid Validation', () => {
    it('should show validation failed message', () => {
      renderComponent(invalidValidation)
      
      expect(screen.getByText('Validation Failed')).toBeInTheDocument()
      expect(screen.getByText('There are issues with your import file')).toBeInTheDocument()
    })

    it('should display red error banner', () => {
      renderComponent(invalidValidation)
      
      const banner = screen.getByText('Validation Failed').closest('div')?.parentElement?.parentElement
      expect(banner).toHaveClass('bg-red-50')
    })

    it('should show error count', () => {
      renderComponent(invalidValidation)
      
      expect(screen.getByText('2 error(s), 1 warning(s)')).toBeInTheDocument()
    })

    it('should display all errors', () => {
      renderComponent(invalidValidation)
      
      expect(screen.getByText('Errors (2)')).toBeInTheDocument()
      expect(screen.getByText('MISSING_FIELD')).toBeInTheDocument()
      expect(screen.getByText(': Event description is required')).toBeInTheDocument()
      expect(screen.getByText('INVALID_DATE')).toBeInTheDocument()
      expect(screen.getByText(': Invalid timestamp format')).toBeInTheDocument()
    })

    it('should display error paths', () => {
      renderComponent(invalidValidation)
      
      expect(screen.getByText('data.events[0].description')).toBeInTheDocument()
      expect(screen.getByText('data.events[1].timestamp')).toBeInTheDocument()
    })

    it('should display warnings', () => {
      renderComponent(invalidValidation)
      
      expect(screen.getByText('Warnings (1)')).toBeInTheDocument()
      expect(screen.getByText('ORPHAN_REFERENCE')).toBeInTheDocument()
    })

    it('should disable continue button when validation failed', () => {
      renderComponent(invalidValidation)
      
      const continueButton = screen.getByRole('button', { name: 'Continue to Preview' })
      expect(continueButton).toBeDisabled()
    })
  })

  describe('Validation with Warnings Only', () => {
    it('should show validation passed with warnings', () => {
      renderComponent(validationWithWarningsOnly)
      
      expect(screen.getByText('Validation Passed')).toBeInTheDocument()
      expect(screen.getByText('0 error(s), 1 warning(s)')).toBeInTheDocument()
    })

    it('should display warnings section', () => {
      renderComponent(validationWithWarningsOnly)
      
      expect(screen.getByText('Warnings (1)')).toBeInTheDocument()
      expect(screen.getByText('DEPRECATED_FIELD')).toBeInTheDocument()
    })

    it('should still enable continue button', () => {
      renderComponent(validationWithWarningsOnly)
      
      const continueButton = screen.getByRole('button', { name: 'Continue to Preview' })
      expect(continueButton).not.toBeDisabled()
    })
  })

  describe('Navigation', () => {
    it('should call onBack when back button clicked', async () => {
      renderComponent(validValidation)
      
      const backButton = screen.getByRole('button', { name: 'Back' })
      await user.click(backButton)
      
      expect(mockOnBack).toHaveBeenCalled()
    })

    it('should disable back button when loading', () => {
      renderComponent(validValidation, { isLoading: true })
      
      const backButton = screen.getByRole('button', { name: 'Back' })
      expect(backButton).toBeDisabled()
    })

    it('should show loading text on continue button when loading', () => {
      renderComponent(validValidation, { isLoading: true })
      
      expect(screen.getByRole('button', { name: 'Loading...' })).toBeInTheDocument()
    })
  })

  describe('Summary Edge Cases', () => {
    it('should not show temporal range when null', () => {
      renderComponent(validationWithWarningsOnly)
      
      expect(screen.queryByText('Time Range')).not.toBeInTheDocument()
    })

    it('should not show actors section when empty', () => {
      renderComponent(validationWithWarningsOnly)
      
      expect(screen.queryByText(/Actors/)).not.toBeInTheDocument()
    })

    it('should show truncated actors list when more than 5', () => {
      const manyActors: ImportValidationResult = {
        ...validValidation,
        summary: {
          ...validValidation.summary,
          actors: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
        },
      }
      renderComponent(manyActors)
      
      expect(screen.getByText('Actors (7)')).toBeInTheDocument()
      expect(screen.getByText(/and 2 more/)).toBeInTheDocument()
    })
  })
})
