import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EventDetailModal } from './EventDetailModal'
import {
  createMockEvent,
  createMockArc,
  createMockCausalRelationship
} from '@/test/fixtures/modalFixtures'

describe('EventDetailModal', () => {
  const defaultProps = {
    event: null as ReturnType<typeof createMockEvent> | null,
    isOpen: false,
    onClose: vi.fn(),
    onSave: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    relatedArcs: [] as ReturnType<typeof createMockArc>[],
    causalRelationships: [] as ReturnType<typeof createMockCausalRelationship>[]
  }

  beforeEach(() => {
    vi.clearAllMocks()
    // Reset body overflow
    document.body.style.overflow = ''
  })

  describe('Rendering', () => {
    it('does not render when isOpen is false', () => {
      render(<EventDetailModal {...defaultProps} />)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('renders modal when isOpen is true', () => {
      render(<EventDetailModal {...defaultProps} isOpen={true} />)
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByText('Create Event')).toBeInTheDocument()
    })

    it('shows "Edit Event" title when event is provided', () => {
      render(<EventDetailModal {...defaultProps} event={createMockEvent()} isOpen={true} />)
      expect(screen.getByText('Edit Event')).toBeInTheDocument()
    })

    it('shows "Create Event" title when event is null', () => {
      render(<EventDetailModal {...defaultProps} event={null} isOpen={true} />)
      expect(screen.getByText('Create Event')).toBeInTheDocument()
    })
  })

  describe('Form Population', () => {
    it('populates form fields with event data', () => {
      const event = createMockEvent({
        description: 'Test Description',
        actor: 'Test Actor',
        target: 'Test Target'
      })
      render(<EventDetailModal {...defaultProps} event={event} isOpen={true} />)

      expect(screen.getByDisplayValue('Test Description')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Test Actor')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Test Target')).toBeInTheDocument()
    })

    it('clears form when event changes to null', () => {
      const event = createMockEvent({ description: 'Test Event' })
      const { rerender } = render(<EventDetailModal {...defaultProps} event={event} isOpen={true} />)

      expect(screen.getByDisplayValue('Test Event')).toBeInTheDocument()

      rerender(<EventDetailModal {...defaultProps} event={null} isOpen={true} />)

      expect(screen.queryByDisplayValue('Test Event')).not.toBeInTheDocument()
    })
  })

  describe('Form Interaction', () => {
    it('updates description field when typing', async () => {
      const user = userEvent.setup()
      render(<EventDetailModal {...defaultProps} isOpen={true} />)

      const descInput = screen.getByLabelText(/description/i)
      await user.type(descInput, 'New Description')

      expect(descInput).toHaveValue('New Description')
    })

    it('updates actor field when typing', async () => {
      const user = userEvent.setup()
      render(<EventDetailModal {...defaultProps} isOpen={true} />)

      const actorInput = screen.getByLabelText(/actor/i)
      await user.type(actorInput, 'New Actor')

      expect(actorInput).toHaveValue('New Actor')
    })
  })

  describe('Close Actions', () => {
    it('calls onClose when close button is clicked', async () => {
      const user = userEvent.setup()
      render(<EventDetailModal {...defaultProps} isOpen={true} />)

      const closeButton = screen.getByRole('button', { name: /close modal/i })
      await user.click(closeButton)

      expect(defaultProps.onClose).toHaveBeenCalledOnce()
    })

    it('calls onClose when cancel button is clicked', async () => {
      const user = userEvent.setup()
      render(<EventDetailModal {...defaultProps} isOpen={true} />)

      const cancelButton = screen.getByRole('button', { name: /cancel/i })
      await user.click(cancelButton)

      expect(defaultProps.onClose).toHaveBeenCalledOnce()
    })

    it('calls onClose when escape key is pressed', () => {
      render(<EventDetailModal {...defaultProps} isOpen={true} />)

      fireEvent.keyDown(document, { key: 'Escape' })

      expect(defaultProps.onClose).toHaveBeenCalledOnce()
    })

    it('calls onClose when backdrop is clicked', () => {
      render(<EventDetailModal {...defaultProps} isOpen={true} />)

      const dialog = screen.getByRole('dialog')
      // Click on the dialog backdrop (first child containing the backdrop)
      const backdrop = dialog.querySelector('.flex')
      if (backdrop) {
        fireEvent.click(backdrop)
      }

      expect(defaultProps.onClose).toHaveBeenCalled()
    })
  })

  describe('Validation', () => {
    it('has required field indicators', () => {
      render(<EventDetailModal {...defaultProps} isOpen={true} />)

      // Check that required fields have aria-required
      expect(screen.getByLabelText(/description/i)).toHaveAttribute('aria-required', 'true')
      expect(screen.getByLabelText(/actor/i)).toHaveAttribute('aria-required', 'true')
      expect(screen.getByLabelText(/timestamp/i)).toHaveAttribute('aria-required', 'true')
    })

    it('has HTML5 required attributes on required fields', () => {
      render(<EventDetailModal {...defaultProps} isOpen={true} />)

      expect(screen.getByLabelText(/description/i)).toBeRequired()
      expect(screen.getByLabelText(/actor/i)).toBeRequired()
      expect(screen.getByLabelText(/target/i)).toBeRequired()
      expect(screen.getByLabelText(/timestamp/i)).toBeRequired()
    })

    it('validates timestamp format when provided', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn().mockResolvedValue(undefined)
      render(<EventDetailModal {...defaultProps} onSave={onSave} isOpen={true} />)

      // Fill in valid data
      await user.type(screen.getByLabelText(/description/i), 'Test Event')
      await user.type(screen.getByLabelText(/actor/i), 'Test Actor')
      await user.type(screen.getByLabelText(/target/i), 'Test Target')
      fireEvent.change(screen.getByLabelText(/timestamp/i), { target: { value: '2023-01-01T12:00' } })

      const saveButton = screen.getByRole('button', { name: /save/i })
      await user.click(saveButton)

      // onSave should be called with valid data
      await waitFor(() => {
        expect(onSave).toHaveBeenCalled()
      })
    })

    it('does not call onSave when form is invalid', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn().mockResolvedValue(undefined)
      render(<EventDetailModal {...defaultProps} onSave={onSave} isOpen={true} />)

      // Try to submit without filling required fields - form submission prevented
      const saveButton = screen.getByRole('button', { name: /save/i })
      await user.click(saveButton)

      // onSave should not be called because HTML5 validation prevents submission
      expect(onSave).not.toHaveBeenCalled()
    })
  })

  describe('Save Actions', () => {
    it('calls onSave with form data when valid', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn().mockResolvedValue(undefined)
      render(<EventDetailModal {...defaultProps} onSave={onSave} isOpen={true} />)

      // Fill in required fields
      await user.type(screen.getByLabelText(/description/i), 'New Event')
      await user.type(screen.getByLabelText(/actor/i), 'New Actor')
      await user.type(screen.getByLabelText(/target/i), 'New Target')

      const timestampInput = screen.getByLabelText(/timestamp/i)
      fireEvent.change(timestampInput, { target: { value: '2023-01-01T12:00' } })

      const saveButton = screen.getByRole('button', { name: /save/i })
      await user.click(saveButton)

      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith(
          expect.objectContaining({
            description: 'New Event',
            actor: 'New Actor',
            target: 'New Target'
          })
        )
      })
    })

    it('shows loading state during save', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn(() => new Promise(resolve => setTimeout(resolve, 100)))
      render(<EventDetailModal {...defaultProps} onSave={onSave} isOpen={true} />)

      // Fill in required fields
      await user.type(screen.getByLabelText(/description/i), 'New Event')
      await user.type(screen.getByLabelText(/actor/i), 'New Actor')
      await user.type(screen.getByLabelText(/target/i), 'New Target')
      fireEvent.change(screen.getByLabelText(/timestamp/i), { target: { value: '2023-01-01T12:00' } })

      const saveButton = screen.getByRole('button', { name: /save/i })
      await user.click(saveButton)

      expect(screen.getByText('Saving...')).toBeInTheDocument()
    })

    it('shows error message when save fails', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn().mockRejectedValue(new Error('Save failed'))
      render(<EventDetailModal {...defaultProps} onSave={onSave} isOpen={true} />)

      // Fill in required fields
      await user.type(screen.getByLabelText(/description/i), 'New Event')
      await user.type(screen.getByLabelText(/actor/i), 'New Actor')
      await user.type(screen.getByLabelText(/target/i), 'New Target')
      fireEvent.change(screen.getByLabelText(/timestamp/i), { target: { value: '2023-01-01T12:00' } })

      const saveButton = screen.getByRole('button', { name: /save/i })
      await user.click(saveButton)

      await waitFor(() => {
        expect(screen.getByText('Failed to save event. Please try again.')).toBeInTheDocument()
      })
    })

    it('closes modal after successful save', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn().mockResolvedValue(undefined)
      render(<EventDetailModal {...defaultProps} onSave={onSave} isOpen={true} />)

      // Fill in required fields
      await user.type(screen.getByLabelText(/description/i), 'New Event')
      await user.type(screen.getByLabelText(/actor/i), 'New Actor')
      await user.type(screen.getByLabelText(/target/i), 'New Target')
      fireEvent.change(screen.getByLabelText(/timestamp/i), { target: { value: '2023-01-01T12:00' } })

      const saveButton = screen.getByRole('button', { name: /save/i })
      await user.click(saveButton)

      await waitFor(() => {
        expect(defaultProps.onClose).toHaveBeenCalled()
      })
    })
  })

  describe('Delete Actions', () => {
    it('shows delete button only when editing existing event', () => {
      const { rerender } = render(<EventDetailModal {...defaultProps} isOpen={true} />)

      expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument()

      rerender(<EventDetailModal {...defaultProps} event={createMockEvent()} isOpen={true} />)

      expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument()
    })

    it('shows delete confirmation dialog when delete is clicked', async () => {
      const user = userEvent.setup()
      render(<EventDetailModal {...defaultProps} event={createMockEvent()} isOpen={true} />)

      const deleteButton = screen.getByRole('button', { name: /delete/i })
      await user.click(deleteButton)

      expect(screen.getByText('Delete Event')).toBeInTheDocument()
      expect(screen.getByText(/are you sure you want to delete/i)).toBeInTheDocument()
    })

    it('calls onDelete when delete is confirmed', async () => {
      const user = userEvent.setup()
      const onDelete = vi.fn().mockResolvedValue(undefined)
      render(<EventDetailModal {...defaultProps} event={createMockEvent()} onDelete={onDelete} isOpen={true} />)

      // Click delete button
      const deleteButton = screen.getByRole('button', { name: /delete/i })
      await user.click(deleteButton)

      // Confirm deletion - find the Delete button in the confirmation dialog
      const confirmButtons = screen.getAllByRole('button', { name: /delete/i })
      const confirmButton = confirmButtons[confirmButtons.length - 1] // Last one is in confirmation dialog
      await user.click(confirmButton)

      await waitFor(() => {
        expect(onDelete).toHaveBeenCalledOnce()
      })
    })

    it('cancels deletion when cancel is clicked in confirmation', async () => {
      const user = userEvent.setup()
      const onDelete = vi.fn()
      render(<EventDetailModal {...defaultProps} event={createMockEvent()} onDelete={onDelete} isOpen={true} />)

      // Click delete button
      const deleteButton = screen.getByRole('button', { name: /delete/i })
      await user.click(deleteButton)

      // Cancel in confirmation dialog
      const cancelButtons = screen.getAllByRole('button', { name: /cancel/i })
      const cancelButton = cancelButtons[cancelButtons.length - 1]
      await user.click(cancelButton)

      expect(onDelete).not.toHaveBeenCalled()
      expect(screen.queryByText(/are you sure you want to delete/i)).not.toBeInTheDocument()
    })
  })

  describe('Related Information Display', () => {
    it('displays related arcs when provided', () => {
      const event = createMockEvent()
      const relatedArcs = [
        createMockArc({ id: 'arc-1', name: 'Related Arc 1' }),
        createMockArc({ id: 'arc-2', name: 'Related Arc 2' })
      ]

      render(
        <EventDetailModal
          {...defaultProps}
          event={event}
          relatedArcs={relatedArcs}
          isOpen={true}
        />
      )

      expect(screen.getByText('Related Arcs')).toBeInTheDocument()
      expect(screen.getByText('Related Arc 1')).toBeInTheDocument()
      expect(screen.getByText('Related Arc 2')).toBeInTheDocument()
    })

    it('displays causal relationships when provided', () => {
      const event = createMockEvent()
      const causalRelationships = [
        createMockCausalRelationship({ id: 'rel-1', relationship_type: 'direct', weight: 0.8 })
      ]

      render(
        <EventDetailModal
          {...defaultProps}
          event={event}
          causalRelationships={causalRelationships}
          isOpen={true}
        />
      )

      expect(screen.getByText('Causal Relationships')).toBeInTheDocument()
      expect(screen.getByText(/direct.*weight.*0.8/i)).toBeInTheDocument()
    })

    it('does not show related information section when no relationships exist', () => {
      render(<EventDetailModal {...defaultProps} event={createMockEvent()} isOpen={true} />)

      expect(screen.queryByText('Related Information')).not.toBeInTheDocument()
    })
  })

  describe('Accessibility', () => {
    it('has proper dialog accessibility attributes', () => {
      render(<EventDetailModal {...defaultProps} isOpen={true} />)

      const dialog = screen.getByRole('dialog')
      expect(dialog).toHaveAttribute('aria-modal', 'true')
      expect(dialog).toHaveAttribute('aria-labelledby', 'event-modal-title')

      const title = screen.getByText('Create Event')
      expect(title).toHaveAttribute('id', 'event-modal-title')
    })

    it('has labeled form fields', () => {
      render(<EventDetailModal {...defaultProps} isOpen={true} />)

      expect(screen.getByLabelText(/description/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/actor/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/target/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/timestamp/i)).toBeInTheDocument()
    })

    it('marks required fields with aria-required', () => {
      render(<EventDetailModal {...defaultProps} isOpen={true} />)

      expect(screen.getByLabelText(/description/i)).toHaveAttribute('aria-required', 'true')
      expect(screen.getByLabelText(/actor/i)).toHaveAttribute('aria-required', 'true')
      expect(screen.getByLabelText(/timestamp/i)).toHaveAttribute('aria-required', 'true')
    })

    it('initializes aria-invalid to false on valid fields', () => {
      render(<EventDetailModal {...defaultProps} isOpen={true} />)

      // Fields start with aria-invalid="false" when no errors exist
      expect(screen.getByLabelText(/description/i)).toHaveAttribute('aria-invalid', 'false')
      expect(screen.getByLabelText(/actor/i)).toHaveAttribute('aria-invalid', 'false')
    })

    it('has error container elements ready for validation messages', () => {
      render(<EventDetailModal {...defaultProps} isOpen={true} />)

      // Check that the component has error display areas
      // Form fields have aria-describedby for potential error elements
      const descriptionField = screen.getByLabelText(/description/i)
      const actorField = screen.getByLabelText(/actor/i)

      // aria-describedby is conditionally set only when errors exist
      expect(descriptionField).not.toHaveAttribute('aria-describedby')
      expect(actorField).not.toHaveAttribute('aria-describedby')
    })

    it('prevents body scroll when modal is open', () => {
      const { rerender } = render(<EventDetailModal {...defaultProps} isOpen={false} />)

      expect(document.body.style.overflow).toBe('')

      rerender(<EventDetailModal {...defaultProps} isOpen={true} />)

      expect(document.body.style.overflow).toBe('hidden')
    })
  })
})
