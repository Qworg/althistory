import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '../../test/utils'
import { ArcDetailPanel } from './ArcDetailPanel'
import { Arc, Event, InferredPressure } from '../../types'

const mockArc: Arc = {
  id: '1',
  name: 'Test Arc',
  description: 'Test Description',
  start_time: '2023-01-01T00:00:00Z',
  end_time: '2023-01-31T23:59:59Z',
  parent_arc_id: null,
  created_at: '2023-01-01T00:00:00Z',
  updated_at: '2023-01-01T00:00:00Z'
}

const mockEvents: Event[] = [
  {
    id: '1',
    description: 'Event 1',
    actor: 'Actor 1',
    target: 'Target 1',
    timestamp: '2023-01-15T12:00:00Z',
    created_at: '2023-01-01T00:00:00Z',
    updated_at: '2023-01-01T00:00:00Z'
  }
]

const mockChildArcs: Arc[] = [
  {
    id: '2',
    name: 'Child Arc',
    description: 'Child Description',
    start_time: '2023-01-10T00:00:00Z',
    end_time: '2023-01-20T23:59:59Z',
    parent_arc_id: '1',
    created_at: '2023-01-01T00:00:00Z',
    updated_at: '2023-01-01T00:00:00Z'
  }
]

const mockPressures: InferredPressure[] = [
  {
    id: '1',
    description: 'Economic Pressure',
    confidence_score: 0.85,
    pressure_type: 'economic',
    created_at: '2023-01-01T00:00:00Z',
    updated_at: '2023-01-01T00:00:00Z'
  }
]

const mockProps = {
  arc: null,
  isOpen: false,
  onClose: vi.fn(),
  onSave: vi.fn(),
  containedEvents: [],
  childArcs: [],
  parentArc: null
}

describe('ArcDetailPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not render when isOpen is false', () => {
    renderWithProviders(<ArcDetailPanel {...mockProps} />)
    
    expect(screen.queryByText('Arc Details')).not.toBeInTheDocument()
  })

  it('renders panel when isOpen is true', () => {
    renderWithProviders(<ArcDetailPanel {...mockProps} isOpen={true} />)
    
    expect(screen.getByText('Create Arc')).toBeInTheDocument()
    expect(screen.getByText('Details')).toBeInTheDocument()
  })

  it('renders edit mode when arc is provided', () => {
    renderWithProviders(<ArcDetailPanel {...mockProps} arc={mockArc} isOpen={true} />)
    
    expect(screen.getByText('Arc Details')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Test Arc')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Test Description')).toBeInTheDocument()
  })

  it('populates form fields with arc data', () => {
    renderWithProviders(<ArcDetailPanel {...mockProps} arc={mockArc} isOpen={true} />)
    
    expect(screen.getByDisplayValue('Test Arc')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Test Description')).toBeInTheDocument()
    expect(screen.getByDisplayValue('test')).toBeInTheDocument()
  })

  it('calls onClose when close button is clicked', () => {
    renderWithProviders(<ArcDetailPanel {...mockProps} isOpen={true} />)
    
    const closeButton = screen.getByLabelText('Close panel')
    fireEvent.click(closeButton)
    
    expect(mockProps.onClose).toHaveBeenCalledOnce()
  })

  it('calls onClose when escape key is pressed', () => {
    renderWithProviders(<ArcDetailPanel {...mockProps} isOpen={true} />)
    
    fireEvent.keyDown(document, { key: 'Escape' })
    
    expect(mockProps.onClose).toHaveBeenCalledOnce()
  })

  it('shows correct tab counts', () => {
    renderWithProviders(
      <ArcDetailPanel 
        {...mockProps} 
        containedEvents={mockEvents}
        childArcs={mockChildArcs}
        inferredPressures={mockPressures}
        isOpen={true} 
      />
    )
    
    expect(screen.getByText('Events (1)')).toBeInTheDocument()
    expect(screen.getByText('Child Arcs (1)')).toBeInTheDocument()
    expect(screen.getByText('Pressures (1)')).toBeInTheDocument()
  })

  it('switches between tabs', () => {
    renderWithProviders(
      <ArcDetailPanel 
        {...mockProps} 
        containedEvents={mockEvents}
        isOpen={true} 
      />
    )
    
    // Initially on details tab
    expect(screen.getByLabelText(/Name/)).toBeInTheDocument()
    
    // Switch to events tab
    fireEvent.click(screen.getByText('Events (1)'))
    expect(screen.getByText('Contained Events')).toBeInTheDocument()
    expect(screen.getByText('Event 1')).toBeInTheDocument()
  })

  it('validates required fields', async () => {
    renderWithProviders(<ArcDetailPanel {...mockProps} isOpen={true} />)
    
    const saveButton = screen.getByText('Save Arc')
    fireEvent.click(saveButton)
    
    await waitFor(() => {
      expect(screen.getByText('Name is required')).toBeInTheDocument()
      expect(screen.getByText('Start time is required')).toBeInTheDocument()
      expect(screen.getByText('End time is required')).toBeInTheDocument()
    })
    
    expect(mockProps.onSave).not.toHaveBeenCalled()
  })

  it('validates that end time is after start time', async () => {
    renderWithProviders(<ArcDetailPanel {...mockProps} isOpen={true} />)
    
    // Fill in required fields with invalid date range
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'Test Arc' } })
    fireEvent.change(screen.getByLabelText(/Start Time/), { target: { value: '2023-01-31T12:00' } })
    fireEvent.change(screen.getByLabelText(/End Time/), { target: { value: '2023-01-01T12:00' } })
    
    const saveButton = screen.getByText('Save Arc')
    fireEvent.click(saveButton)
    
    await waitFor(() => {
      expect(screen.getByText('End time must be after start time')).toBeInTheDocument()
    })
  })

  it('calls onSave with form data when form is valid', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    renderWithProviders(<ArcDetailPanel {...mockProps} onSave={onSave} isOpen={true} />)
    
    // Fill in required fields
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'New Arc' } })
    fireEvent.change(screen.getByLabelText(/Start Time/), { target: { value: '2023-01-01T12:00' } })
    fireEvent.change(screen.getByLabelText(/End Time/), { target: { value: '2023-01-31T12:00' } })
    
    const saveButton = screen.getByText('Save Arc')
    fireEvent.click(saveButton)
    
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        name: 'New Arc',
        description: '',
        start_time: '2023-01-01T12:00:00Z',
        end_time: '2023-01-31T12:00:00Z',
        arc_type: '',
        confidence: 1.0
      })
    })
  })

  it('displays contained events in events tab', () => {
    renderWithProviders(
      <ArcDetailPanel 
        {...mockProps} 
        containedEvents={mockEvents}
        isOpen={true} 
      />
    )
    
    // Switch to events tab
    fireEvent.click(screen.getByText('Events (1)'))
    
    expect(screen.getByText('Event 1')).toBeInTheDocument()
    expect(screen.getByText('Actor 1 → Target 1')).toBeInTheDocument()
    expect(screen.getByText('type1')).toBeInTheDocument()
  })

  it('displays child arcs in arcs tab', () => {
    renderWithProviders(
      <ArcDetailPanel 
        {...mockProps} 
        childArcs={mockChildArcs}
        isOpen={true} 
      />
    )
    
    // Switch to arcs tab
    fireEvent.click(screen.getByText('Child Arcs (1)'))
    
    expect(screen.getByText('Child Arc')).toBeInTheDocument()
    expect(screen.getByText('Child Description')).toBeInTheDocument()
    expect(screen.getByText('child')).toBeInTheDocument()
  })

  it('displays inferred pressures in pressures tab', () => {
    renderWithProviders(
      <ArcDetailPanel 
        {...mockProps} 
        inferredPressures={mockPressures}
        isOpen={true} 
      />
    )
    
    // Switch to pressures tab
    fireEvent.click(screen.getByText('Pressures (1)'))
    
    expect(screen.getByText('Economic Pressure')).toBeInTheDocument()
    expect(screen.getByText('85%')).toBeInTheDocument()
    expect(screen.getByText('economic')).toBeInTheDocument()
  })

  it('shows empty states for tabs with no data', () => {
    renderWithProviders(<ArcDetailPanel {...mockProps} isOpen={true} />)
    
    // Events tab
    fireEvent.click(screen.getByText('Events (0)'))
    expect(screen.getByText('No events in this arc.')).toBeInTheDocument()
    
    // Arcs tab
    fireEvent.click(screen.getByText('Child Arcs (0)'))
    expect(screen.getByText('No child arcs.')).toBeInTheDocument()
    
    // Pressures tab
    fireEvent.click(screen.getByText('Pressures (0)'))
    expect(screen.getByText('No inferred pressures.')).toBeInTheDocument()
  })

  it('shows loading state during save', async () => {
    const onSave = vi.fn().mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)))
    renderWithProviders(<ArcDetailPanel {...mockProps} onSave={onSave} isOpen={true} />)
    
    // Fill in required fields
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'New Arc' } })
    fireEvent.change(screen.getByLabelText(/Start Time/), { target: { value: '2023-01-01T12:00' } })
    fireEvent.change(screen.getByLabelText(/End Time/), { target: { value: '2023-01-31T12:00' } })
    
    const saveButton = screen.getByText('Save Arc')
    fireEvent.click(saveButton)
    
    expect(screen.getByText('Saving...')).toBeInTheDocument()
    expect(saveButton).toBeDisabled()
  })

  it('shows error message when save fails', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('Save failed'))
    renderWithProviders(<ArcDetailPanel {...mockProps} onSave={onSave} isOpen={true} />)
    
    // Fill in required fields
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'New Arc' } })
    fireEvent.change(screen.getByLabelText(/Start Time/), { target: { value: '2023-01-01T12:00' } })
    fireEvent.change(screen.getByLabelText(/End Time/), { target: { value: '2023-01-31T12:00' } })
    
    const saveButton = screen.getByText('Save Arc')
    fireEvent.click(saveButton)
    
    await waitFor(() => {
      expect(screen.getByText('Failed to save arc. Please try again.')).toBeInTheDocument()
    })
  })

  it('updates confidence slider value display', () => {
    renderWithProviders(<ArcDetailPanel {...mockProps} isOpen={true} />)
    
    const confidenceSlider = screen.getByLabelText(/Confidence/)
    fireEvent.change(confidenceSlider, { target: { value: '0.75' } })
    
    expect(screen.getByText('Confidence: 0.75')).toBeInTheDocument()
  })

  it('clears form when arc changes to null', () => {
    const { rerender } = renderWithProviders(<ArcDetailPanel {...mockProps} arc={mockArc} isOpen={true} />)
    
    expect(screen.getByDisplayValue('Test Arc')).toBeInTheDocument()
    
    rerenderWithProviders(<ArcDetailPanel {...mockProps} arc={null} isOpen={true} />)
    
    expect(screen.queryByDisplayValue('Test Arc')).not.toBeInTheDocument()
  })

  it('formats dates correctly in child arcs', () => {
    renderWithProviders(
      <ArcDetailPanel 
        {...mockProps} 
        childArcs={mockChildArcs}
        isOpen={true} 
      />
    )
    
    // Switch to arcs tab
    fireEvent.click(screen.getByText('Child Arcs (1)'))
    
    // Check that dates are formatted (exact format may vary by locale)
    expect(screen.getByText(/1\/10\/2023.*1\/20\/2023/)).toBeInTheDocument()
  })

  it('has proper tab navigation', () => {
    renderWithProviders(<ArcDetailPanel {...mockProps} isOpen={true} />)
    
    const detailsTab = screen.getByText('Details')
    const eventsTab = screen.getByText('Events (0)')
    
    // Details tab should be active initially
    expect(detailsTab).toHaveClass('border-blue-500', 'text-blue-600')
    expect(eventsTab).toHaveClass('border-transparent', 'text-gray-500')
    
    // Click events tab
    fireEvent.click(eventsTab)
    
    expect(eventsTab).toHaveClass('border-blue-500', 'text-blue-600')
    expect(detailsTab).toHaveClass('border-transparent', 'text-gray-500')
  })
})