import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import type { ReactElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { EventDetailModal } from './EventDetailModal'
import {
  createMockEvent,
  createMockArc,
  createMockCausalRelationship
} from '@/test/fixtures/modalFixtures'
import { useWorldCalendarStore } from '@/stores/worldCalendarStore'
import { VAEL, vael } from '@/test/fixtures/worldCalendars'

vi.mock('@/hooks/useAPI', () => ({
  useEvents: vi.fn(() => ({
    data: [
      { id: 'e1', description: 'a', actor: 'Prussian General Staff', target: 'Calculating Offices', timestamp: '1866-01-01T00:00:00Z' },
      { id: 'e2', description: 'b', actor: 'Clerks', target: 'Prussian General Staff', timestamp: '1867-01-01T00:00:00Z' },
    ],
  })),
}))

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
      expect(screen.getByLabelText(/^date/i)).toHaveAttribute('aria-required', 'true')
    })

    it('has HTML5 required attributes on required fields', () => {
      render(<EventDetailModal {...defaultProps} isOpen={true} />)

      expect(screen.getByLabelText(/description/i)).toBeRequired()
      expect(screen.getByLabelText(/actor/i)).toBeRequired()
      expect(screen.getByLabelText(/target/i)).toBeRequired()
      expect(screen.getByLabelText(/^date/i)).toBeRequired()
    })

    it('validates timestamp format when provided', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn().mockResolvedValue(undefined)
      render(<EventDetailModal {...defaultProps} onSave={onSave} isOpen={true} />)

      // Fill in valid data
      await user.type(screen.getByLabelText(/description/i), 'Test Event')
      await user.type(screen.getByLabelText(/actor/i), 'Test Actor')
      await user.type(screen.getByLabelText(/target/i), 'Test Target')
      fireEvent.change(screen.getByLabelText(/^date/i), { target: { value: '2023-01-01T12:00' } })

      const saveButton = screen.getByRole('button', { name: /save/i })
      await user.click(saveButton)

      // onSave should be called with valid data
      await waitFor(() => {
        expect(onSave).toHaveBeenCalled()
      })
    })

    it('records the precision a typed date states, and keeps the event\'s when the date is left alone', async () => {
      const user = userEvent.setup()
      const save = async (event: ReturnType<typeof createMockEvent>, date?: string) => {
        const onSave = vi.fn().mockResolvedValue(undefined)
        const { unmount } = render(<EventDetailModal {...defaultProps} event={event} onSave={onSave} isOpen={true} />)
        if (date !== undefined) fireEvent.change(screen.getByLabelText(/^date/i), { target: { value: date } })
        await user.click(screen.getByRole('button', { name: /save/i }))
        await waitFor(() => expect(onSave).toHaveBeenCalled())
        unmount()
        return onSave.mock.calls[0]![0] as { timestamp: string; metadata?: Record<string, unknown> }
      }
      const monthEvent = createMockEvent({ timestamp: '1871-03-01T00:00:00.000Z', metadata: { datePrecision: 'month' } })
      // Left as the form shows it: still the month.
      expect((await save(monthEvent)).metadata?.datePrecision).toBe('month')
      // A day typed in its place: the day, and no stale month.
      const day = await save(monthEvent, '1871-03-15')
      expect(day.timestamp).toBe('1871-03-15T00:00:00.000Z')
      expect(day.metadata?.datePrecision).toBeUndefined()
      // A day-precision event on the 1st, left alone: shown as the day, and still a day.
      const firstOfMonth = createMockEvent({ timestamp: '1871-03-01T00:00:00.000Z' })
      render(<EventDetailModal {...defaultProps} event={firstOfMonth} isOpen={true} />)
      expect(screen.getByLabelText(/^date/i)).toHaveValue('1871-03-01')
      cleanup()
      expect((await save(firstOfMonth)).metadata?.datePrecision).toBeUndefined()
      // A month typed for a dated event: the month.
      expect((await save(createMockEvent({ timestamp: '1871-03-15T00:00:00.000Z' }), '1872-05')).metadata?.datePrecision).toBe('month')
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

  describe('Inline validation', () => {
    it('replaces the browser bubbles with messages under each field', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn().mockResolvedValue(undefined)
      render(<EventDetailModal {...defaultProps} onSave={onSave} isOpen={true} />)

      const form = screen.getByLabelText(/description/i).closest('form')!
      expect(form).toHaveAttribute('novalidate')

      await user.click(screen.getByRole('button', { name: /save/i }))

      expect(onSave).not.toHaveBeenCalled()
      const description = screen.getByLabelText(/description/i)
      expect(description).toHaveAttribute('aria-invalid', 'true')
      expect(document.getElementById(description.getAttribute('aria-describedby')!)).toHaveTextContent(
        'Describe what happened.'
      )
      expect(screen.getByLabelText(/actor/i)).toHaveAttribute('aria-invalid', 'true')
      expect(screen.getByLabelText(/target/i)).toHaveAttribute('aria-invalid', 'true')
      expect(screen.getByLabelText(/^date/i)).toHaveAttribute('aria-invalid', 'true')
      // The first invalid field takes focus.
      await waitFor(() => expect(description).toHaveFocus())
    })

    it('focuses the first field still invalid, and clears a message once fixed', async () => {
      const user = userEvent.setup()
      render(<EventDetailModal {...defaultProps} isOpen={true} />)

      await user.type(screen.getByLabelText(/description/i), 'The census is taken')
      await user.click(screen.getByRole('button', { name: /save/i }))

      const actor = screen.getByLabelText(/actor/i)
      await waitFor(() => expect(actor).toHaveFocus())
      expect(screen.getByLabelText(/description/i)).not.toHaveAttribute('aria-invalid', 'true')

      await user.type(actor, 'Registrar')
      expect(actor).not.toHaveAttribute('aria-invalid', 'true')
      expect(screen.queryByText(/Name who acted/)).not.toBeInTheDocument()
    })
  })

  describe('Actor and target suggestions', () => {
    it('offers the actors and targets already in the graph', () => {
      const client = new QueryClient()
      render(
        <QueryClientProvider client={client}>
          <EventDetailModal {...defaultProps} isOpen={true} />
        </QueryClientProvider>
      )

      const actor = screen.getByLabelText(/actor/i)
      const target = screen.getByLabelText(/target/i)
      const listId = actor.getAttribute('list')!
      expect(listId).toBeTruthy()
      expect(target).toHaveAttribute('list', listId)
      const options = Array.from(document.getElementById(listId)!.querySelectorAll('option')).map((o) => o.value)
      expect(options).toEqual(['Calculating Offices', 'Clerks', 'Prussian General Staff'])
    })

    it('offers none without a query client', () => {
      render(<EventDetailModal {...defaultProps} isOpen={true} />)

      expect(screen.getByLabelText(/actor/i)).not.toHaveAttribute('list')
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

      const timestampInput = screen.getByLabelText(/^date/i)
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
      const onSave = vi.fn(() => new Promise<void>(resolve => { setTimeout(resolve, 100) }))
      render(<EventDetailModal {...defaultProps} onSave={onSave} isOpen={true} />)

      // Fill in required fields
      await user.type(screen.getByLabelText(/description/i), 'New Event')
      await user.type(screen.getByLabelText(/actor/i), 'New Actor')
      await user.type(screen.getByLabelText(/target/i), 'New Target')
      fireEvent.change(screen.getByLabelText(/^date/i), { target: { value: '2023-01-01T12:00' } })

      const saveButton = screen.getByRole('button', { name: /save/i })
      await user.click(saveButton)

      expect(screen.getByText('Saving…')).toBeInTheDocument()
    })

    it('shows error message when save fails', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn().mockRejectedValue(new Error('Save failed'))
      render(<EventDetailModal {...defaultProps} onSave={onSave} isOpen={true} />)

      // Fill in required fields
      await user.type(screen.getByLabelText(/description/i), 'New Event')
      await user.type(screen.getByLabelText(/actor/i), 'New Actor')
      await user.type(screen.getByLabelText(/target/i), 'New Target')
      fireEvent.change(screen.getByLabelText(/^date/i), { target: { value: '2023-01-01T12:00' } })

      const saveButton = screen.getByRole('button', { name: /save/i })
      await user.click(saveButton)

      await waitFor(() => {
        expect(screen.getByText(/could not be saved\. Your changes are still here/)).toBeInTheDocument()
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
      fireEvent.change(screen.getByLabelText(/^date/i), { target: { value: '2023-01-01T12:00' } })

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
      expect(screen.getByText(/will be removed\. Version history can restore/i)).toBeInTheDocument()
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
      // Last one is in the confirmation dialog
      const confirmButton = confirmButtons[confirmButtons.length - 1]
      if (!confirmButton) throw new Error('expected a Delete button in the confirmation dialog')
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
      if (!cancelButton) throw new Error('expected a Cancel button in the confirmation dialog')
      await user.click(cancelButton)

      expect(onDelete).not.toHaveBeenCalled()
      expect(screen.queryByText(/will be removed\. Version history can restore/i)).not.toBeInTheDocument()
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
      expect(screen.getByLabelText(/^date/i)).toBeInTheDocument()
    })

    it('marks required fields with aria-required', () => {
      render(<EventDetailModal {...defaultProps} isOpen={true} />)

      expect(screen.getByLabelText(/description/i)).toHaveAttribute('aria-required', 'true')
      expect(screen.getByLabelText(/actor/i)).toHaveAttribute('aria-required', 'true')
      expect(screen.getByLabelText(/^date/i)).toHaveAttribute('aria-required', 'true')
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

  describe('Accessibility (axe)', () => {
    it('create mode has no axe violations', async () => {
      const { container } = render(<EventDetailModal {...defaultProps} isOpen={true} />)

      expect(await axe(container)).toHaveNoViolations()
    })

    it('edit mode has no axe violations', async () => {
      const { container } = render(
        <EventDetailModal {...defaultProps} event={createMockEvent()} isOpen={true} />
      )

      expect(await axe(container)).toHaveNoViolations()
    })

    it('related-information state has no axe violations', async () => {
      const { container } = render(
        <EventDetailModal
          {...defaultProps}
          event={createMockEvent()}
          relatedArcs={[createMockArc()]}
          causalRelationships={[createMockCausalRelationship()]}
          isOpen={true}
        />
      )

      expect(await axe(container)).toHaveNoViolations()
    })

    it('delete confirmation state has no axe violations', async () => {
      const user = userEvent.setup()
      const { container } = render(
        <EventDetailModal {...defaultProps} event={createMockEvent()} isOpen={true} />
      )

      await user.click(screen.getByRole('button', { name: /^delete$/i }))

      expect(await axe(container)).toHaveNoViolations()
    })
  })
})

describe('EventDetailModal: what the form records', () => {
  const withClient = (ui: ReactElement) =>
    render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>)

  async function fillRequired(date: string) {
    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/description/i), 'Something happens')
    await user.type(screen.getByLabelText(/^actor/i), 'Someone')
    await user.type(screen.getByLabelText(/^target/i), 'Somewhere')
    fireEvent.change(screen.getByLabelText(/^date/i), { target: { value: date } })
    return user
  }

  it('makes no claim of confidence unless one is given', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<EventDetailModal event={null} isOpen onClose={vi.fn()} onSave={onSave} />)
    expect(screen.getByLabelText(/^confidence/i)).toHaveValue(null)
    const user = await fillRequired('1843-11-20')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0]![0].metadata).not.toHaveProperty('confidence')
  })

  it('saves confidence and evidence into the event metadata, keeping the rest', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const event = { ...createMockEvent({}), metadata: { arcId: 'arc-1', confidence: 0.5 } }
    render(<EventDetailModal event={event} isOpen onClose={vi.fn()} onSave={onSave} />)
    expect(screen.getByLabelText(/^confidence/i)).toHaveValue(0.5)
    fireEvent.change(screen.getByLabelText(/^confidence/i), { target: { value: '0.3' } })
    fireEvent.change(screen.getByLabelText(/^evidence/i), { target: { value: 'Hansard, 1861' } })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0]![0].metadata).toEqual({ arcId: 'arc-1', confidence: 0.3, evidence: 'Hansard, 1861' })
  })

  it('reads a BCE date and a year-only date', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<EventDetailModal event={null} isOpen onClose={vi.fn()} onSave={onSave} />)
    const user = await fillRequired('44-03-15 BCE')
    expect(screen.getByText(/Reads as/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(new Date(onSave.mock.calls[0]![0].timestamp).getUTCFullYear()).toBe(-43)
  })

  it('refuses a date it cannot read, saying how to write one', async () => {
    const onSave = vi.fn()
    render(<EventDetailModal event={null} isOpen onClose={vi.fn()} onSave={onSave} />)
    const user = await fillRequired('March 1843')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(await screen.findByText(/Write the year first/)).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('links a new event to the cause picked for it', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    withClient(<EventDetailModal event={null} isOpen onClose={vi.fn()} onSave={onSave} />)
    const user = await fillRequired('1866-06-01')
    // Only causes no later than the new event are offered (e2 is 1867)
    const picker = screen.getByLabelText(/caused by/i)
    expect(Array.from((picker as HTMLSelectElement).options).map(o => o.value)).toEqual(['', 'e1'])
    await user.selectOptions(picker, 'e1')
    await user.selectOptions(screen.getByLabelText(/^link$/i), 'contributory')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0]![1]).toEqual({ cause: { eventId: 'e1', type: 'contributory' } })
  })

  describe('in a world calendar', () => {
    const props = { event: null, isOpen: true, onClose: vi.fn(), onSave: vi.fn().mockResolvedValue(undefined) }
    afterEach(() => useWorldCalendarStore.getState().setCalendar(null))

    it("takes the date in the world's notation, and saves the instant and precision it names", async () => {
      const user = userEvent.setup()
      const onSave = vi.fn().mockResolvedValue(undefined)
      useWorldCalendarStore.getState().setCalendar(VAEL)
      withClient(<EventDetailModal {...props} onSave={onSave} />)
      await user.type(screen.getByLabelText(/description/i), 'The harbour freezes')
      await user.type(screen.getByLabelText(/actor/i), 'Winter')
      await user.type(screen.getByLabelText(/target/i), 'Harbour')
      const date = screen.getByLabelText(/^date/i)
      await user.type(date, 'Thaw 312 AR')
      expect(screen.getByText('Reads as Thaw 312 AR.')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: /save/i }))
      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith(
          expect.objectContaining({
            timestamp: vael(312, 2, 1).toISOString(),
            metadata: expect.objectContaining({ datePrecision: 'month' }),
          })
        )
      })
    })

    it('saves a date left as shown unchanged, though another calendar is shown, and rewrites only the date on a switch', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn().mockResolvedValue(undefined)
      useWorldCalendarStore.getState().setCalendar(VAEL)
      useWorldCalendarStore.getState().showCalendar('tide')
      const stored = vael(312, 2, 1).toISOString()
      const event = createMockEvent({ timestamp: stored, metadata: { datePrecision: 'month' } })
      withClient(<EventDetailModal {...props} event={event} onSave={onSave} />)
      const date = screen.getByLabelText(/^date/i)
      expect((date as HTMLInputElement).value).toMatch(/ TC$/)
      const description = screen.getByLabelText(/description/i)
      await user.clear(description)
      await user.type(description, 'Edited')
      // Back to the Reckoning: the description stays, the date is written in it.
      act(() => useWorldCalendarStore.getState().showCalendar('reckoning'))
      expect(screen.getByLabelText(/description/i)).toHaveValue('Edited')
      expect(screen.getByLabelText(/^date/i)).toHaveValue('Thaw 312 AR')
      await user.click(screen.getByRole('button', { name: /save/i }))
      await waitFor(() =>
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ description: 'Edited', timestamp: stored, metadata: expect.objectContaining({ datePrecision: 'month' }) }))
      )
    })

    it('shows an event at the precision it is known to, and refuses a day the world lacks', async () => {
      const user = userEvent.setup()
      useWorldCalendarStore.getState().setCalendar(VAEL)
      const event = createMockEvent({ timestamp: vael(312, 6, 1).toISOString() })
      withClient(<EventDetailModal {...props} event={event} />)
      const date = screen.getByLabelText(/^date/i)
      expect(date).toHaveValue("Midyear's Day, 312 AR")
      await user.clear(date)
      await user.type(date, 'Thaw 31, 312 AR')
      await user.click(screen.getByRole('button', { name: /save/i }))
      expect(await screen.findByText('Thaw has 30 days that year, so no day 31.')).toBeInTheDocument()
    })
  })
})

