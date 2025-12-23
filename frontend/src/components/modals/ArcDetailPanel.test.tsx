import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/utils'
import { ArcDetailPanel } from './ArcDetailPanel'
import {
  createMockArc,
  createMockEvent,
  arcDetailPanelScenarios
} from '@/test/fixtures/modalFixtures'
import { getFormField, waitForValidationError, getDialog, expectDialogAccessibility } from '@/test/helpers/a11yTestHelpers'

describe('ArcDetailPanel', () => {
  const defaultProps = {
    arc: null as ReturnType<typeof createMockArc> | null,
    isOpen: false,
    onClose: vi.fn(),
    onSave: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    containedEvents: [] as ReturnType<typeof createMockEvent>[],
    childArcs: [] as ReturnType<typeof createMockArc>[],
    parentArc: null as ReturnType<typeof createMockArc> | null
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('does not render when isOpen is false', () => {
      renderWithProviders(<ArcDetailPanel {...defaultProps} arc={createMockArc()} />)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('does not render when arc is null', () => {
      renderWithProviders(<ArcDetailPanel {...defaultProps} isOpen={true} arc={null} />)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('renders panel when isOpen is true and arc is provided', () => {
      renderWithProviders(
        <ArcDetailPanel {...defaultProps} arc={createMockArc()} isOpen={true} />
      )
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('shows "Arc Details" title', () => {
      renderWithProviders(
        <ArcDetailPanel {...defaultProps} arc={createMockArc()} isOpen={true} />
      )
      expect(screen.getByRole('heading', { name: /arc details/i })).toBeInTheDocument()
    })

    it('has proper dialog accessibility attributes', () => {
      renderWithProviders(
        <ArcDetailPanel {...defaultProps} arc={createMockArc()} isOpen={true} />
      )
      const dialog = screen.getByRole('dialog')
      expectDialogAccessibility(dialog)
    })
  })

  describe('Form Population', () => {
    it('populates form fields with arc data', () => {
      const arc = createMockArc({ name: 'My Test Arc', description: 'My Test Description' })
      renderWithProviders(
        <ArcDetailPanel {...defaultProps} arc={arc} isOpen={true} />
      )

      expect(screen.getByDisplayValue('My Test Arc')).toBeInTheDocument()
      expect(screen.getByDisplayValue('My Test Description')).toBeInTheDocument()
    })

    it('updates form data when arc changes', () => {
      const arc1 = createMockArc({ name: 'Arc 1' })
      const arc2 = createMockArc({ name: 'Arc 2' })

      const { rerender } = renderWithProviders(
        <ArcDetailPanel {...defaultProps} arc={arc1} isOpen={true} />
      )
      expect(screen.getByDisplayValue('Arc 1')).toBeInTheDocument()

      rerender(
        <ArcDetailPanel {...defaultProps} arc={arc2} isOpen={true} />
      )
      expect(screen.getByDisplayValue('Arc 2')).toBeInTheDocument()
    })
  })

  describe('Form Interaction', () => {
    it('updates name field when typing', async () => {
      const user = userEvent.setup()
      renderWithProviders(
        <ArcDetailPanel {...defaultProps} arc={createMockArc()} isOpen={true} />
      )

      const nameInput = screen.getByLabelText(/name/i)
      await user.clear(nameInput)
      await user.type(nameInput, 'New Arc Name')

      expect(nameInput).toHaveValue('New Arc Name')
    })

    it('updates description field when typing', async () => {
      const user = userEvent.setup()
      renderWithProviders(
        <ArcDetailPanel {...defaultProps} arc={createMockArc()} isOpen={true} />
      )

      const descInput = screen.getByLabelText(/description/i)
      await user.clear(descInput)
      await user.type(descInput, 'New Description')

      expect(descInput).toHaveValue('New Description')
    })
  })

  describe('Validation', () => {
    it('shows validation error for empty name', async () => {
      const user = userEvent.setup()
      const arc = createMockArc({ name: '' })
      renderWithProviders(
        <ArcDetailPanel {...defaultProps} arc={arc} isOpen={true} />
      )

      const saveButton = screen.getByRole('button', { name: /save changes/i })
      await user.click(saveButton)

      await waitFor(() => {
        expect(screen.getByText('Name is required')).toBeInTheDocument()
      })
      expect(defaultProps.onSave).not.toHaveBeenCalled()
    })

    it('shows validation error for empty description', async () => {
      const user = userEvent.setup()
      const arc = createMockArc({ description: '' })
      renderWithProviders(
        <ArcDetailPanel {...defaultProps} arc={arc} isOpen={true} />
      )

      const saveButton = screen.getByRole('button', { name: /save changes/i })
      await user.click(saveButton)

      await waitFor(() => {
        expect(screen.getByText('Description is required')).toBeInTheDocument()
      })
    })

    it('shows validation error when end time is before start time', async () => {
      const user = userEvent.setup()
      const arc = createMockArc({
        start_time: '2023-01-31T00:00:00Z',
        end_time: '2023-01-01T00:00:00Z'
      })
      renderWithProviders(
        <ArcDetailPanel {...defaultProps} arc={arc} isOpen={true} />
      )

      const saveButton = screen.getByRole('button', { name: /save changes/i })
      await user.click(saveButton)

      await waitFor(() => {
        expect(screen.getByText('End time must be after start time')).toBeInTheDocument()
      })
    })

    it('warns about contained events outside time range', async () => {
      const user = userEvent.setup()
      const arc = createMockArc({
        start_time: '2023-01-20T00:00:00Z',
        end_time: '2023-01-25T00:00:00Z'
      })
      const containedEvents = [
        createMockEvent({ timestamp: '2023-01-10T00:00:00Z' })
      ]

      renderWithProviders(
        <ArcDetailPanel
          {...defaultProps}
          arc={arc}
          containedEvents={containedEvents}
          isOpen={true}
        />
      )

      const saveButton = screen.getByRole('button', { name: /save changes/i })
      await user.click(saveButton)

      await waitFor(() => {
        expect(screen.getByText(/contained events would be outside/i)).toBeInTheDocument()
      })
    })

    it('clears field error when user starts typing', async () => {
      const user = userEvent.setup()
      const arc = createMockArc({ name: '' })
      renderWithProviders(
        <ArcDetailPanel {...defaultProps} arc={arc} isOpen={true} />
      )

      // Trigger validation error
      const saveButton = screen.getByRole('button', { name: /save changes/i })
      await user.click(saveButton)

      await waitFor(() => {
        expect(screen.getByText('Name is required')).toBeInTheDocument()
      })

      // Start typing to clear error
      const nameInput = screen.getByLabelText(/name/i)
      await user.type(nameInput, 'New Name')

      await waitFor(() => {
        expect(screen.queryByText('Name is required')).not.toBeInTheDocument()
      })
    })
  })

  describe('Actions', () => {
    it('calls onClose when close button is clicked', async () => {
      const user = userEvent.setup()
      renderWithProviders(
        <ArcDetailPanel {...defaultProps} arc={createMockArc()} isOpen={true} />
      )

      const closeButton = screen.getByRole('button', { name: /close panel/i })
      await user.click(closeButton)

      expect(defaultProps.onClose).toHaveBeenCalledOnce()
    })

    it('calls onClose when cancel button is clicked', async () => {
      const user = userEvent.setup()
      renderWithProviders(
        <ArcDetailPanel {...defaultProps} arc={createMockArc()} isOpen={true} />
      )

      const cancelButton = screen.getByRole('button', { name: /cancel/i })
      await user.click(cancelButton)

      expect(defaultProps.onClose).toHaveBeenCalledOnce()
    })

    it('calls onSave with form data when valid', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn().mockResolvedValue(undefined)
      const arc = createMockArc({
        name: 'Test Arc',
        description: 'Test Description',
        start_time: '2023-01-01T00:00:00Z',
        end_time: '2023-01-31T00:00:00Z'
      })

      renderWithProviders(
        <ArcDetailPanel {...defaultProps} arc={arc} onSave={onSave} isOpen={true} />
      )

      const saveButton = screen.getByRole('button', { name: /save changes/i })
      await user.click(saveButton)

      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'Test Arc',
            description: 'Test Description'
          })
        )
      })
    })

    it('shows loading state during save', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn(() => new Promise(resolve => setTimeout(resolve, 100)))
      const arc = createMockArc()

      renderWithProviders(
        <ArcDetailPanel {...defaultProps} arc={arc} onSave={onSave} isOpen={true} />
      )

      const saveButton = screen.getByRole('button', { name: /save changes/i })
      await user.click(saveButton)

      expect(screen.getByText(/saving/i)).toBeInTheDocument()
    })

    it('shows error message when save fails', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn().mockRejectedValue(new Error('Save failed'))
      const arc = createMockArc()

      renderWithProviders(
        <ArcDetailPanel {...defaultProps} arc={arc} onSave={onSave} isOpen={true} />
      )

      const saveButton = screen.getByRole('button', { name: /save changes/i })
      await user.click(saveButton)

      await waitFor(() => {
        expect(screen.getByText('Failed to save arc. Please try again.')).toBeInTheDocument()
      })
    })

    it('closes panel after successful save', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn().mockResolvedValue(undefined)
      const arc = createMockArc()

      renderWithProviders(
        <ArcDetailPanel {...defaultProps} arc={arc} onSave={onSave} isOpen={true} />
      )

      const saveButton = screen.getByRole('button', { name: /save changes/i })
      await user.click(saveButton)

      await waitFor(() => {
        expect(defaultProps.onClose).toHaveBeenCalled()
      })
    })
  })

  describe('Delete', () => {
    it('renders delete button when onDelete is provided', () => {
      renderWithProviders(
        <ArcDetailPanel {...defaultProps} arc={createMockArc()} onDelete={vi.fn()} isOpen={true} />
      )

      expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument()
    })

    it('does not render delete button when onDelete is not provided', () => {
      renderWithProviders(
        <ArcDetailPanel {...defaultProps} arc={createMockArc()} onDelete={undefined} isOpen={true} />
      )

      expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument()
    })
  })

  describe('Hierarchy Display', () => {
    it('displays parent arc when provided', () => {
      const parentArc = createMockArc({ id: 'parent', name: 'My Parent Arc Name' })
      const arc = createMockArc({ parent_arc_id: 'parent' })

      renderWithProviders(
        <ArcDetailPanel {...defaultProps} arc={arc} parentArc={parentArc} isOpen={true} />
      )

      // Component has "Parent Arc:" label and the parent name
      expect(screen.getByText(/Parent Arc:/)).toBeInTheDocument()
      expect(screen.getByText('My Parent Arc Name')).toBeInTheDocument()
    })

    it('displays child arcs when provided', () => {
      const arc = createMockArc()
      const childArcs = [
        createMockArc({ id: 'child1', name: 'First Child Arc', parent_arc_id: arc.id }),
        createMockArc({ id: 'child2', name: 'Second Child Arc', parent_arc_id: arc.id })
      ]

      renderWithProviders(
        <ArcDetailPanel {...defaultProps} arc={arc} childArcs={childArcs} isOpen={true} />
      )

      expect(screen.getByText(/Child Arcs \(2\)/i)).toBeInTheDocument()
      // Child arc names are displayed in list items with bullet point prefix
      expect(screen.getByText(/First Child Arc/)).toBeInTheDocument()
      expect(screen.getByText(/Second Child Arc/)).toBeInTheDocument()
    })
  })

  describe('Contained Events Display', () => {
    it('displays contained events count', () => {
      const arc = createMockArc()
      const containedEvents = [
        createMockEvent({ id: '1', description: 'Event 1' }),
        createMockEvent({ id: '2', description: 'Event 2' })
      ]

      renderWithProviders(
        <ArcDetailPanel {...defaultProps} arc={arc} containedEvents={containedEvents} isOpen={true} />
      )

      expect(screen.getByText(/contained events \(2\)/i)).toBeInTheDocument()
    })

    it('displays event details', () => {
      const arc = createMockArc()
      const containedEvents = [
        createMockEvent({
          description: 'Test Event',
          actor: 'Test Actor',
          target: 'Test Target'
        })
      ]

      renderWithProviders(
        <ArcDetailPanel {...defaultProps} arc={arc} containedEvents={containedEvents} isOpen={true} />
      )

      expect(screen.getByText('Test Event')).toBeInTheDocument()
      expect(screen.getByText(/test actor.*test target/i)).toBeInTheDocument()
    })

    it('shows message when no events contained', () => {
      const arc = createMockArc()

      renderWithProviders(
        <ArcDetailPanel {...defaultProps} arc={arc} containedEvents={[]} isOpen={true} />
      )

      expect(screen.getByText(/no events contained/i)).toBeInTheDocument()
    })
  })

  describe('Accessibility', () => {
    it('has labeled form fields', () => {
      renderWithProviders(
        <ArcDetailPanel {...defaultProps} arc={createMockArc()} isOpen={true} />
      )

      expect(screen.getByLabelText(/name/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/description/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/start time/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/end time/i)).toBeInTheDocument()
    })

    it('marks required fields with aria-required', () => {
      renderWithProviders(
        <ArcDetailPanel {...defaultProps} arc={createMockArc()} isOpen={true} />
      )

      expect(screen.getByLabelText(/name/i)).toHaveAttribute('aria-required', 'true')
      expect(screen.getByLabelText(/description/i)).toHaveAttribute('aria-required', 'true')
    })

    it('sets aria-invalid on fields with errors', async () => {
      const user = userEvent.setup()
      const arc = createMockArc({ name: '' })
      renderWithProviders(
        <ArcDetailPanel {...defaultProps} arc={arc} isOpen={true} />
      )

      const saveButton = screen.getByRole('button', { name: /save changes/i })
      await user.click(saveButton)

      await waitFor(() => {
        expect(screen.getByLabelText(/name/i)).toHaveAttribute('aria-invalid', 'true')
      })
    })

    it('shows validation errors with role="alert"', async () => {
      const user = userEvent.setup()
      const arc = createMockArc({ name: '' })
      renderWithProviders(
        <ArcDetailPanel {...defaultProps} arc={arc} isOpen={true} />
      )

      const saveButton = screen.getByRole('button', { name: /save changes/i })
      await user.click(saveButton)

      await waitFor(() => {
        const alerts = screen.getAllByRole('alert')
        expect(alerts.length).toBeGreaterThan(0)
      })
    })
  })
})
