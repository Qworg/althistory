import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CausalRelationshipModal } from './CausalRelationshipModal'
import { useGlobalStore } from '@/stores/globalStore'
import { apiClient } from '@/services/api'
import { Event, CausalRelationship } from '@/types'

// Mock dependencies
vi.mock('@/stores/globalStore')
vi.mock('@/services/api')

const mockEvents: Event[] = [
  {
    id: 'event1',
    description: 'First event',
    actor: 'Actor A',
    target: 'Target A',
    timestamp: '2023-01-01T10:00:00Z',
    created_at: '2023-01-01T10:00:00Z',
    updated_at: '2023-01-01T10:00:00Z'
  },
  {
    id: 'event2',
    description: 'Second event',
    actor: 'Actor B',
    target: 'Target B',
    timestamp: '2023-01-01T11:00:00Z',
    created_at: '2023-01-01T11:00:00Z',
    updated_at: '2023-01-01T11:00:00Z'
  }
]

const mockRelationship: CausalRelationship = {
  id: 'rel1',
  cause_event_id: 'event1',
  effect_event_id: 'event2',
  weight: 0.8,
  evidence: 'Strong evidence for this relationship',
  confidence: 0.9,
  relationship_type: 'direct',
  created_at: '2023-01-01T12:00:00Z',
  updated_at: '2023-01-01T12:00:00Z'
}

const mockGlobalStore = {
  events: mockEvents,
  updateCausalRelationship: vi.fn(),
  deleteCausalRelationship: vi.fn(),
  addError: vi.fn()
}

describe('CausalRelationshipModal', () => {
  const user = userEvent.setup()
  const mockOnClose = vi.fn()
  const mockOnSave = vi.fn()
  const mockOnDelete = vi.fn()

  beforeEach(() => {
    vi.mocked(useGlobalStore).mockReturnValue(mockGlobalStore as any)
    vi.mocked(apiClient.causal.updateLink).mockResolvedValue({
      ...mockRelationship,
      weight: 0.6
    })
    vi.mocked(apiClient.causal.deleteLink).mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should not render when isOpen is false', () => {
    render(
      <CausalRelationshipModal
        relationship={mockRelationship}
        isOpen={false}
        onClose={mockOnClose}
      />
    )
    
    expect(screen.queryByText('Edit Causal Relationship')).not.toBeInTheDocument()
  })

  it('should not render when relationship is null', () => {
    render(
      <CausalRelationshipModal
        relationship={null}
        isOpen={true}
        onClose={mockOnClose}
      />
    )
    
    expect(screen.queryByText('Edit Causal Relationship')).not.toBeInTheDocument()
  })

  it('should render modal with relationship data when open', () => {
    render(
      <CausalRelationshipModal
        relationship={mockRelationship}
        isOpen={true}
        onClose={mockOnClose}
      />
    )
    
    expect(screen.getByText('Edit Causal Relationship')).toBeInTheDocument()
    expect(screen.getByText('Actor A → Target A')).toBeInTheDocument()
    expect(screen.getByText('Actor B → Target B')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Strong evidence for this relationship')).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toHaveValue('direct')
  })

  it('should display weight and confidence sliders with correct values', () => {
    render(
      <CausalRelationshipModal
        relationship={mockRelationship}
        isOpen={true}
        onClose={mockOnClose}
      />
    )
    
    const weightSlider = screen.getByDisplayValue('0.8')
    const confidenceSlider = screen.getByDisplayValue('0.9')
    
    expect(weightSlider).toBeInTheDocument()
    expect(confidenceSlider).toBeInTheDocument()
    expect(screen.getByText('Weight (0.80)')).toBeInTheDocument()
    expect(screen.getByText('Confidence (0.90)')).toBeInTheDocument()
  })

  it('should update weight value when slider is moved', async () => {
    render(
      <CausalRelationshipModal
        relationship={mockRelationship}
        isOpen={true}
        onClose={mockOnClose}
      />
    )
    
    const weightSlider = screen.getByDisplayValue('0.8')
    fireEvent.change(weightSlider, { target: { value: '0.6' } })
    
    expect(screen.getByText('Weight (0.60)')).toBeInTheDocument()
  })

  it('should update confidence value when slider is moved', async () => {
    render(
      <CausalRelationshipModal
        relationship={mockRelationship}
        isOpen={true}
        onClose={mockOnClose}
      />
    )
    
    const confidenceSlider = screen.getByDisplayValue('0.9')
    fireEvent.change(confidenceSlider, { target: { value: '0.7' } })
    
    expect(screen.getByText('Confidence (0.70)')).toBeInTheDocument()
  })

  it('should update relationship type when dropdown is changed', async () => {
    render(
      <CausalRelationshipModal
        relationship={mockRelationship}
        isOpen={true}
        onClose={mockOnClose}
      />
    )
    
    const typeSelect = screen.getByRole('combobox')
    await user.selectOptions(typeSelect, 'indirect')
    
    expect(typeSelect).toHaveValue('indirect')
  })

  it('should update evidence when textarea is changed', async () => {
    render(
      <CausalRelationshipModal
        relationship={mockRelationship}
        isOpen={true}
        onClose={mockOnClose}
      />
    )
    
    const evidenceTextarea = screen.getByDisplayValue('Strong evidence for this relationship')
    await user.clear(evidenceTextarea)
    await user.type(evidenceTextarea, 'Updated evidence')
    
    expect(screen.getByDisplayValue('Updated evidence')).toBeInTheDocument()
  })

  it('should call onClose when close button is clicked', async () => {
    render(
      <CausalRelationshipModal
        relationship={mockRelationship}
        isOpen={true}
        onClose={mockOnClose}
      />
    )
    
    const closeButton = screen.getByLabelText('Close modal')
    await user.click(closeButton)
    
    expect(mockOnClose).toHaveBeenCalled()
  })

  it('should call onClose when cancel button is clicked', async () => {
    render(
      <CausalRelationshipModal
        relationship={mockRelationship}
        isOpen={true}
        onClose={mockOnClose}
      />
    )
    
    const cancelButton = screen.getByText('Cancel')
    await user.click(cancelButton)
    
    expect(mockOnClose).toHaveBeenCalled()
  })

  it('should save changes when save button is clicked', async () => {
    render(
      <CausalRelationshipModal
        relationship={mockRelationship}
        isOpen={true}
        onClose={mockOnClose}
        onSave={mockOnSave}
      />
    )
    
    // Modify weight
    const weightSlider = screen.getByDisplayValue('0.8')
    fireEvent.change(weightSlider, { target: { value: '0.6' } })
    
    // Click save
    const saveButton = screen.getByText('Save Changes')
    await user.click(saveButton)
    
    await waitFor(() => {
      expect(apiClient.causal.updateLink).toHaveBeenCalledWith('rel1', {
        weight: 0.6,
        evidence: 'Strong evidence for this relationship',
        confidence: 0.9,
        relationship_type: 'direct'
      })
    })
    
    expect(mockGlobalStore.updateCausalRelationship).toHaveBeenCalledWith('rel1', {
      weight: 0.6,
      evidence: 'Strong evidence for this relationship',
      confidence: 0.9,
      relationship_type: 'direct'
    })
    
    expect(mockOnSave).toHaveBeenCalled()
    expect(mockOnClose).toHaveBeenCalled()
  })

  it('should validate weight range and show error for invalid values', async () => {
    // Mock the component to bypass HTML5 validation for testing
    const mockRelationshipWithInvalidWeight = { ...mockRelationship, weight: 1.5 }
    
    render(
      <CausalRelationshipModal
        relationship={mockRelationshipWithInvalidWeight}
        isOpen={true}
        onClose={mockOnClose}
      />
    )
    
    const saveButton = screen.getByText('Save Changes')
    await user.click(saveButton)
    
    expect(mockGlobalStore.addError).toHaveBeenCalledWith({
      message: 'Weight must be between 0 and 1',
      type: 'validation'
    })
    
    expect(apiClient.causal.updateLink).not.toHaveBeenCalled()
  })

  it('should validate confidence range and show error for invalid values', async () => {
    // Mock the component to bypass HTML5 validation for testing
    const mockRelationshipWithInvalidConfidence = { ...mockRelationship, confidence: -0.1 }
    
    render(
      <CausalRelationshipModal
        relationship={mockRelationshipWithInvalidConfidence}
        isOpen={true}
        onClose={mockOnClose}
      />
    )
    
    const saveButton = screen.getByText('Save Changes')
    await user.click(saveButton)
    
    expect(mockGlobalStore.addError).toHaveBeenCalledWith({
      message: 'Confidence must be between 0 and 1',
      type: 'validation'
    })
    
    expect(apiClient.causal.updateLink).not.toHaveBeenCalled()
  })

  it('should handle API errors during save', async () => {
    vi.mocked(apiClient.causal.updateLink).mockRejectedValue(new Error('Network error'))
    
    render(
      <CausalRelationshipModal
        relationship={mockRelationship}
        isOpen={true}
        onClose={mockOnClose}
      />
    )
    
    const saveButton = screen.getByText('Save Changes')
    await user.click(saveButton)
    
    await waitFor(() => {
      expect(mockGlobalStore.addError).toHaveBeenCalledWith({
        message: 'Failed to update causal relationship',
        type: 'network'
      })
    })
  })

  it('should delete relationship when delete button is clicked and confirmed', async () => {
    // Mock window.confirm
    const originalConfirm = window.confirm
    window.confirm = vi.fn(() => true)
    
    render(
      <CausalRelationshipModal
        relationship={mockRelationship}
        isOpen={true}
        onClose={mockOnClose}
        onDelete={mockOnDelete}
      />
    )
    
    const deleteButton = screen.getByText('Delete Relationship')
    await user.click(deleteButton)
    
    await waitFor(() => {
      expect(apiClient.causal.deleteLink).toHaveBeenCalledWith('rel1')
    })
    
    expect(mockGlobalStore.deleteCausalRelationship).toHaveBeenCalledWith('rel1')
    expect(mockOnDelete).toHaveBeenCalledWith('rel1')
    expect(mockOnClose).toHaveBeenCalled()
    
    // Restore window.confirm
    window.confirm = originalConfirm
  })

  it('should not delete relationship when delete is not confirmed', async () => {
    // Mock window.confirm to return false
    const originalConfirm = window.confirm
    window.confirm = vi.fn(() => false)
    
    render(
      <CausalRelationshipModal
        relationship={mockRelationship}
        isOpen={true}
        onClose={mockOnClose}
        onDelete={mockOnDelete}
      />
    )
    
    const deleteButton = screen.getByText('Delete Relationship')
    await user.click(deleteButton)
    
    expect(apiClient.causal.deleteLink).not.toHaveBeenCalled()
    expect(mockGlobalStore.deleteCausalRelationship).not.toHaveBeenCalled()
    expect(mockOnDelete).not.toHaveBeenCalled()
    
    // Restore window.confirm
    window.confirm = originalConfirm
  })

  it('should handle API errors during delete', async () => {
    vi.mocked(apiClient.causal.deleteLink).mockRejectedValue(new Error('Network error'))
    
    // Mock window.confirm
    const originalConfirm = window.confirm
    window.confirm = vi.fn(() => true)
    
    render(
      <CausalRelationshipModal
        relationship={mockRelationship}
        isOpen={true}
        onClose={mockOnClose}
      />
    )
    
    const deleteButton = screen.getByText('Delete Relationship')
    await user.click(deleteButton)
    
    await waitFor(() => {
      expect(mockGlobalStore.addError).toHaveBeenCalledWith({
        message: 'Failed to delete causal relationship',
        type: 'network'
      })
    })
    
    // Restore window.confirm
    window.confirm = originalConfirm
  })

  it('should show loading state during save operation', async () => {
    // Mock a slow API call
    vi.mocked(apiClient.causal.updateLink).mockImplementation(
      () => new Promise(resolve => setTimeout(resolve, 100))
    )
    
    render(
      <CausalRelationshipModal
        relationship={mockRelationship}
        isOpen={true}
        onClose={mockOnClose}
      />
    )
    
    const saveButton = screen.getByText('Save Changes')
    await user.click(saveButton)
    
    expect(screen.getByText('Saving...')).toBeInTheDocument()
    
    // Wait for the operation to complete
    await waitFor(() => {
      expect(screen.getByText('Save Changes')).toBeInTheDocument()
    })
  })

  it('should disable form controls during loading', async () => {
    // Mock a slow API call
    vi.mocked(apiClient.causal.updateLink).mockImplementation(
      () => new Promise(resolve => setTimeout(resolve, 100))
    )
    
    render(
      <CausalRelationshipModal
        relationship={mockRelationship}
        isOpen={true}
        onClose={mockOnClose}
      />
    )
    
    const saveButton = screen.getByText('Save Changes')
    await user.click(saveButton)
    
    // Check that form controls are disabled
    const weightSlider = screen.getByDisplayValue('0.8')
    const confidenceSlider = screen.getByDisplayValue('0.9')
    const typeSelect = screen.getByRole('combobox')
    const evidenceTextarea = screen.getByDisplayValue('Strong evidence for this relationship')
    
    expect(weightSlider).toBeDisabled()
    expect(confidenceSlider).toBeDisabled()
    expect(typeSelect).toBeDisabled()
    expect(evidenceTextarea).toBeDisabled()
    
    // Wait for the operation to complete
    await waitFor(() => {
      expect(weightSlider).not.toBeDisabled()
    })
  })
})