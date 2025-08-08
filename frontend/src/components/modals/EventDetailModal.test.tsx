import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { EventDetailModal } from './EventDetailModal'
import { Event, Arc, CausalRelationship } from '@/types'

const mockEvent: Event = {
  id: '1',
  description: 'Test Event',
  actor: 'Test Actor',
  target: 'Test Target',
  timestamp: '2023-01-01T12:00:00Z',
  created_at: '2023-01-01T12:00:00Z',
  updated_at: '2023-01-01T12:00:00Z'
}

const mockProps = {
  event: null,
  isOpen: false,
  onClose: vi.fn(),
  onSave: vi.fn(),
  onDelete: vi.fn(),
  relatedArcs: [],
  causalRelationships: []
}

describe('EventDetailModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not render when isOpen is false', () => {
    render(<EventDetailModal {...mockProps} />)
    
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders modal when isOpen is true', () => {
    render(<EventDetailModal {...mockProps} isOpen={true} />)
    
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Create Event')).toBeInTheDocument()
  })

  it('renders edit mode when event is provided', () => {
    render(<EventDetailModal {...mockProps} event={mockEvent} isOpen={true} />)
    
    expect(screen.getByText('Edit Event')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Test Event')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Test Actor')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Test Target')).toBeInTheDocument()
  })

  it('populates form fields with event data', () => {
    render(<EventDetailModal {...mockProps} event={mockEvent} isOpen={true} />)
    
    expect(screen.getByDisplayValue('Test Event')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Test Actor')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Test Target')).toBeInTheDocument()
    expect(screen.getByDisplayValue('test')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Test evidence')).toBeInTheDocument()
  })

  it('calls onClose when close button is clicked', () => {
    render(<EventDetailModal {...mockProps} isOpen={true} />)
    
    const closeButton = screen.getByLabelText('Close modal')
    fireEvent.click(closeButton)
    
    expect(mockProps.onClose).toHaveBeenCalledOnce()
  })

  it('calls onClose when cancel button is clicked', () => {
    render(<EventDetailModal {...mockProps} isOpen={true} />)
    
    const cancelButton = screen.getByText('Cancel')
    fireEvent.click(cancelButton)
    
    expect(mockProps.onClose).toHaveBeenCalledOnce()
  })

  it('calls onClose when backdrop is clicked', () => {
    render(<EventDetailModal {...mockProps} isOpen={true} />)
    
    const backdrop = screen.getByRole('dialog').firstChild as HTMLElement
    fireEvent.click(backdrop)
    
    expect(mockProps.onClose).toHaveBeenCalledOnce()
  })

  it('calls onClose when escape key is pressed', () => {
    render(<EventDetailModal {...mockProps} isOpen={true} />)
    
    fireEvent.keyDown(document, { key: 'Escape' })
    
    expect(mockProps.onClose).toHaveBeenCalledOnce()
  })

  it('validates required fields', async () => {
    render(<EventDetailModal {...mockProps} isOpen={true} />)
    
    const saveButton = screen.getByText('Save')
    fireEvent.click(saveButton)
    
    await waitFor(() => {
      expect(screen.getByText('Description is required')).toBeInTheDocument()
      expect(screen.getByText('Actor is required')).toBeInTheDocument()
      expect(screen.getByText('Timestamp is required')).toBeInTheDocument()
    })
    
    expect(mockProps.onSave).not.toHaveBeenCalled()
  })

  it('validates confidence range', async () => {
    render(<EventDetailModal {...mockProps} isOpen={true} />)
    
    const confidenceSlider = screen.getByLabelText(/Confidence/)
    fireEvent.change(confidenceSlider, { target: { value: '1.5' } })
    
    const saveButton = screen.getByText('Save')
    fireEvent.click(saveButton)
    
    await waitFor(() => {
      expect(screen.getByText('Confidence must be between 0 and 1')).toBeInTheDocument()
    })
  })

  it('calls onSave with form data when form is valid', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<EventDetailModal {...mockProps} onSave={onSave} isOpen={true} />)
    
    // Fill in required fields
    fireEvent.change(screen.getByLabelText(/Description/), { target: { value: 'New Event' } })
    fireEvent.change(screen.getByLabelText(/Actor/), { target: { value: 'New Actor' } })
    fireEvent.change(screen.getByLabelText(/Timestamp/), { target: { value: '2023-01-01T12:00' } })
    
    const saveButton = screen.getByText('Save')
    fireEvent.click(saveButton)
    
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        description: 'New Event',
        actor: 'New Actor',
        target: '',
        timestamp: '2023-01-01T12:00:00Z',
        event_type: '',
        confidence: 1.0,
        evidence: ''
      })
    })
  })

  it('shows delete button only when editing existing event', () => {
    const { rerender } = render(<EventDetailModal {...mockProps} isOpen={true} />)
    
    expect(screen.queryByText('Delete')).not.toBeInTheDocument()
    
    rerender(<EventDetailModal {...mockProps} event={mockEvent} isOpen={true} />)
    
    expect(screen.getByText('Delete')).toBeInTheDocument()
  })

  it('shows delete confirmation dialog when delete is clicked', () => {
    render(<EventDetailModal {...mockProps} event={mockEvent} isOpen={true} />)
    
    const deleteButton = screen.getByText('Delete')
    fireEvent.click(deleteButton)
    
    expect(screen.getByText('Delete Event')).toBeInTheDocument()
    expect(screen.getByText('Are you sure you want to delete this event?')).toBeInTheDocument()
  })

  it('calls onDelete when delete is confirmed', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined)
    render(<EventDetailModal {...mockProps} event={mockEvent} onDelete={onDelete} isOpen={true} />)
    
    // Click delete button
    const deleteButton = screen.getByText('Delete')
    fireEvent.click(deleteButton)
    
    // Confirm deletion
    const confirmButton = screen.getAllByText('Delete')[1] // Second delete button in confirmation
    if (confirmButton) {
      fireEvent.click(confirmButton)
    }
    
    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledOnce()
    })
  })

  it('shows loading state during save', async () => {
    const onSave = vi.fn().mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)))
    render(<EventDetailModal {...mockProps} onSave={onSave} isOpen={true} />)
    
    // Fill in required fields
    fireEvent.change(screen.getByLabelText(/Description/), { target: { value: 'New Event' } })
    fireEvent.change(screen.getByLabelText(/Actor/), { target: { value: 'New Actor' } })
    fireEvent.change(screen.getByLabelText(/Timestamp/), { target: { value: '2023-01-01T12:00' } })
    
    const saveButton = screen.getByText('Save')
    fireEvent.click(saveButton)
    
    expect(screen.getByText('Saving...')).toBeInTheDocument()
    expect(saveButton).toBeDisabled()
  })

  it('shows error message when save fails', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('Save failed'))
    render(<EventDetailModal {...mockProps} onSave={onSave} isOpen={true} />)
    
    // Fill in required fields
    fireEvent.change(screen.getByLabelText(/Description/), { target: { value: 'New Event' } })
    fireEvent.change(screen.getByLabelText(/Actor/), { target: { value: 'New Actor' } })
    fireEvent.change(screen.getByLabelText(/Timestamp/), { target: { value: '2023-01-01T12:00' } })
    
    const saveButton = screen.getByText('Save')
    fireEvent.click(saveButton)
    
    await waitFor(() => {
      expect(screen.getByText('Failed to save event. Please try again.')).toBeInTheDocument()
    })
  })

  it('displays related arcs and causal relationships', () => {
    const relatedArcs: Arc[] = [{ 
      id: '1', 
      name: 'Test Arc', 
      description: 'Test description',
      start_time: '2023-01-01T00:00:00Z',
      end_time: '2023-01-02T00:00:00Z',
      parent_arc_id: null,
      created_at: '2023-01-01T00:00:00Z',
      updated_at: '2023-01-01T00:00:00Z'
    }]
    const causalRelationships: CausalRelationship[] = [{ 
      id: '1', 
      cause_event_id: 'event-1',
      effect_event_id: 'event-2',
      relationship_type: 'direct', 
      weight: 0.8,
      evidence: 'Test evidence',
      confidence: 0.9,
      created_at: '2023-01-01T00:00:00Z',
      updated_at: '2023-01-01T00:00:00Z'
    }]
    
    render(
      <EventDetailModal 
        {...mockProps} 
        event={mockEvent} 
        relatedArcs={relatedArcs}
        causalRelationships={causalRelationships}
        isOpen={true} 
      />
    )
    
    expect(screen.getByText('Related Information')).toBeInTheDocument()
    expect(screen.getByText('Related Arcs')).toBeInTheDocument()
    expect(screen.getByText('Test Arc')).toBeInTheDocument()
    expect(screen.getByText('Causal Relationships')).toBeInTheDocument()
    expect(screen.getByText('causes (Weight: 0.8)')).toBeInTheDocument()
  })

  it('has proper accessibility attributes', () => {
    render(<EventDetailModal {...mockProps} isOpen={true} />)
    
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-labelledby', 'event-modal-title')
    
    const title = screen.getByText('Create Event')
    expect(title).toHaveAttribute('id', 'event-modal-title')
  })

  it('prevents body scroll when modal is open', () => {
    const { rerender } = render(<EventDetailModal {...mockProps} isOpen={false} />)
    
    expect(document.body.style.overflow).toBe('')
    
    rerender(<EventDetailModal {...mockProps} isOpen={true} />)
    
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('clears form when event changes to null', () => {
    const { rerender } = render(<EventDetailModal {...mockProps} event={mockEvent} isOpen={true} />)
    
    expect(screen.getByDisplayValue('Test Event')).toBeInTheDocument()
    
    rerender(<EventDetailModal {...mockProps} event={null} isOpen={true} />)
    
    expect(screen.queryByDisplayValue('Test Event')).not.toBeInTheDocument()
  })
})