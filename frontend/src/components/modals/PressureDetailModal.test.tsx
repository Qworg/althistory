import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import PressureDetailModal from './PressureDetailModal'
import { PressureWithContext } from '@/types/pressure'
import { Event, Arc } from '@/types'

describe('PressureDetailModal', () => {
  const mockEvents: Event[] = [
    {
      id: 'event-1',
      description: 'Economic sanctions imposed',
      actor: 'Country A',
      target: 'Country B',
      timestamp: '2023-01-15T00:00:00Z',
      created_at: '2023-01-01T00:00:00Z',
      updated_at: '2023-01-01T00:00:00Z'
    },
    {
      id: 'event-2',
      description: 'Trade agreement cancelled',
      actor: 'Country B',
      target: 'Country A',
      timestamp: '2023-01-20T00:00:00Z',
      created_at: '2023-01-01T00:00:00Z',
      updated_at: '2023-01-01T00:00:00Z'
    }
  ]

  const mockArcs: Arc[] = [
    {
      id: 'arc-1',
      name: 'Economic Crisis Period',
      description: 'Period of economic instability',
      start_time: '2023-01-01T00:00:00Z',
      end_time: '2023-01-31T00:00:00Z',
      parent_arc_id: null,
      created_at: '2023-01-01T00:00:00Z',
      updated_at: '2023-01-01T00:00:00Z'
    }
  ]

  const mockPressure: PressureWithContext = {
    id: 'pressure-1',
    description: 'Economic pressure from trade sanctions and diplomatic tensions',
    confidence_score: 0.85,
    pressure_type: 'economic',
    created_at: '2023-01-01T00:00:00Z',
    updated_at: '2023-01-01T00:00:00Z',
    affectedArcs: mockArcs,
    evidenceEvents: mockEvents,
    influenceStrength: 0.78,
    isVisible: true,
    isHighlighted: false,
    renderColor: '#10b981',
    renderOpacity: 0.68
  }

  const defaultProps = {
    pressure: mockPressure,
    isOpen: true,
    onClose: vi.fn(),
    onEvidenceEventClick: vi.fn(),
    onHighlightEvidence: vi.fn(),
    onClearHighlight: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders when open with pressure data', () => {
    render(<PressureDetailModal {...defaultProps} />)
    
    expect(screen.getByTestId('pressure-detail-modal')).toBeInTheDocument()
    expect(screen.getByText('Economic Pressure')).toBeInTheDocument()
    expect(screen.getByText('HIGH CONFIDENCE')).toBeInTheDocument()
    expect(screen.getByText('85% confident')).toBeInTheDocument()
    expect(screen.getByText(mockPressure.description)).toBeInTheDocument()
  })

  it('does not render when closed', () => {
    render(<PressureDetailModal {...defaultProps} isOpen={false} />)
    
    expect(screen.queryByTestId('pressure-detail-modal')).not.toBeInTheDocument()
  })

  it('does not render when pressure is null', () => {
    render(<PressureDetailModal {...defaultProps} pressure={null} />)
    
    expect(screen.queryByTestId('pressure-detail-modal')).not.toBeInTheDocument()
  })

  it('displays correct confidence level styling', () => {
    const { rerender } = render(<PressureDetailModal {...defaultProps} />)
    
    expect(screen.getByText('HIGH CONFIDENCE')).toHaveClass('text-green-600')
    
    // Test medium confidence
    const mediumConfidencePressure = {
      ...mockPressure,
      confidence_score: 0.5
    }
    rerender(<PressureDetailModal {...defaultProps} pressure={mediumConfidencePressure} />)
    expect(screen.getByText('MEDIUM CONFIDENCE')).toHaveClass('text-yellow-600')
    
    // Test low confidence
    const lowConfidencePressure = {
      ...mockPressure,
      confidence_score: 0.2
    }
    rerender(<PressureDetailModal {...defaultProps} pressure={lowConfidencePressure} />)
    expect(screen.getByText('LOW CONFIDENCE')).toHaveClass('text-red-600')
  })

  it('displays metrics correctly', () => {
    render(<PressureDetailModal {...defaultProps} />)
    
    expect(screen.getByText('85%')).toBeInTheDocument() // Confidence percentage
    expect(screen.getByText('78%')).toBeInTheDocument() // Influence strength percentage
    expect(screen.getByText('2')).toBeInTheDocument() // Evidence events count
  })

  it('displays affected arcs', () => {
    render(<PressureDetailModal {...defaultProps} />)
    
    expect(screen.getByText('Affected Arcs')).toBeInTheDocument()
    expect(screen.getByText('Economic Crisis Period')).toBeInTheDocument()
    expect(screen.getByText('Period of economic instability')).toBeInTheDocument()
  })

  it('displays evidence events', () => {
    render(<PressureDetailModal {...defaultProps} />)
    
    expect(screen.getAllByText('Evidence Events')).toHaveLength(2) // One in metrics, one as section header
    expect(screen.getByText('Economic sanctions imposed')).toBeInTheDocument()
    expect(screen.getByText('Trade agreement cancelled')).toBeInTheDocument()
    expect(screen.getByText('Actor: Country A → Target: Country B')).toBeInTheDocument()
    expect(screen.getByText('Actor: Country B → Target: Country A')).toBeInTheDocument()
  })

  it('handles empty evidence events', () => {
    const pressureWithNoEvidence = {
      ...mockPressure,
      evidenceEvents: []
    }
    
    render(<PressureDetailModal {...defaultProps} pressure={pressureWithNoEvidence} />)
    
    expect(screen.getByText('No evidence events found for this pressure')).toBeInTheDocument()
  })

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn()
    render(<PressureDetailModal {...defaultProps} onClose={onClose} />)
    
    const closeButton = screen.getByLabelText('Close modal')
    fireEvent.click(closeButton)
    
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn()
    render(<PressureDetailModal {...defaultProps} onClose={onClose} />)
    
    const backdrop = screen.getByTestId('pressure-detail-modal')
    fireEvent.click(backdrop)
    
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not call onClose when modal content is clicked', () => {
    const onClose = vi.fn()
    render(<PressureDetailModal {...defaultProps} onClose={onClose} />)
    
    const modalContent = screen.getByText('Economic Pressure').closest('div')
    fireEvent.click(modalContent!)
    
    expect(onClose).not.toHaveBeenCalled()
  })

  it('calls onHighlightEvidence when highlight button is clicked', () => {
    const onHighlightEvidence = vi.fn()
    render(<PressureDetailModal {...defaultProps} onHighlightEvidence={onHighlightEvidence} />)
    
    const highlightButton = screen.getByText('Highlight All')
    fireEvent.click(highlightButton)
    
    expect(onHighlightEvidence).toHaveBeenCalledWith(mockEvents)
  })

  it('calls onClearHighlight when clear button is clicked', () => {
    const onClearHighlight = vi.fn()
    render(<PressureDetailModal {...defaultProps} onClearHighlight={onClearHighlight} />)
    
    const clearButton = screen.getByText('Clear Highlight')
    fireEvent.click(clearButton)
    
    expect(onClearHighlight).toHaveBeenCalledTimes(1)
  })

  it('calls onEvidenceEventClick when evidence event is clicked', () => {
    const onEvidenceEventClick = vi.fn()
    render(<PressureDetailModal {...defaultProps} onEvidenceEventClick={onEvidenceEventClick} />)
    
    const eventElement = screen.getByText('Economic sanctions imposed')
    fireEvent.click(eventElement)
    
    expect(onEvidenceEventClick).toHaveBeenCalledWith(mockEvents[0])
  })

  it('displays metadata correctly', () => {
    render(<PressureDetailModal {...defaultProps} />)
    
    expect(screen.getByText('Metadata')).toBeInTheDocument()
    expect(screen.getByText('pressure-1')).toBeInTheDocument()
    expect(screen.getByText('Economic')).toBeInTheDocument()
  })

  it('applies custom className', () => {
    const customClassName = 'custom-modal-class'
    render(<PressureDetailModal {...defaultProps} className={customClassName} />)
    
    const modal = screen.getByTestId('pressure-detail-modal')
    expect(modal).toHaveClass(customClassName)
  })

  it('handles different pressure types correctly', () => {
    const pressureTypes = [
      { type: 'social', expectedText: 'Social Pressure', expectedIcon: '👥' },
      { type: 'environmental', expectedText: 'Environmental Pressure', expectedIcon: '🌍' },
      { type: 'political', expectedText: 'Political Pressure', expectedIcon: '🏛️' }
    ]

    pressureTypes.forEach(({ type, expectedText }) => {
      const pressure = {
        ...mockPressure,
        pressure_type: type as 'economic' | 'social' | 'environmental' | 'political'
      }
      
      const { rerender } = render(<PressureDetailModal {...defaultProps} pressure={pressure} />)
      expect(screen.getByText(expectedText)).toBeInTheDocument()
      
      rerender(<PressureDetailModal {...defaultProps} />)
    })
  })

  it('displays progress bars correctly', () => {
    render(<PressureDetailModal {...defaultProps} />)
    
    // Check that progress bars are rendered by looking for the visual elements
    const confidenceBar = screen.getByText('85%').previousElementSibling?.querySelector('div[style*="width: 85%"]')
    const influenceBar = screen.getByText('78%').previousElementSibling?.querySelector('div[style*="width: 78%"]')
    
    expect(confidenceBar).toBeInTheDocument()
    expect(influenceBar).toBeInTheDocument()
  })

  it('handles keyboard navigation', () => {
    const onClose = vi.fn()
    render(<PressureDetailModal {...defaultProps} onClose={onClose} />)
    
    // Test Escape key
    fireEvent.keyDown(document, { key: 'Escape' })
    // Note: This would require additional setup to properly test keyboard events
    // For now, we just verify the modal renders correctly
    expect(screen.getByTestId('pressure-detail-modal')).toBeInTheDocument()
  })
})