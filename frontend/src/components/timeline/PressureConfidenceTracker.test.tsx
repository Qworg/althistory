import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import PressureConfidenceTracker from './PressureConfidenceTracker'
import { PressureWithContext } from '@/types/pressure'

describe('PressureConfidenceTracker', () => {
  const mockPressure: PressureWithContext = {
    id: 'pressure-1',
    description: 'Economic pressure from trade sanctions',
    confidence_score: 0.75,
    pressure_type: 'economic',
    created_at: '2023-01-01T00:00:00Z',
    updated_at: '2023-01-01T00:00:00Z',
    affectedArcs: [],
    evidenceEvents: [],
    influenceStrength: 0.7,
    isVisible: true,
    isHighlighted: false,
    renderColor: '#10b981',
    renderOpacity: 0.6
  }

  const defaultProps = {
    pressure: mockPressure,
    confidenceHistory: [0.6, 0.65, 0.7, 0.75],
    onConfidenceUpdate: vi.fn(),
    showHistory: true
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders confidence tracker with current confidence', () => {
    render(<PressureConfidenceTracker {...defaultProps} />)
    
    expect(screen.getByText('Confidence Tracking')).toBeInTheDocument()
    expect(screen.getByText('Current Confidence')).toBeInTheDocument()
    expect(screen.getByText('75%')).toBeInTheDocument()
  })

  it('displays confidence statistics correctly', () => {
    render(<PressureConfidenceTracker {...defaultProps} />)
    
    expect(screen.getByText('Average')).toBeInTheDocument()
    expect(screen.getByText('68%')).toBeInTheDocument() // Average of [0.6, 0.65, 0.7, 0.75]
    expect(screen.getByText('Min')).toBeInTheDocument()
    expect(screen.getByText('60%')).toBeInTheDocument() // Min value
    expect(screen.getByText('Max')).toBeInTheDocument()
    expect(screen.getByText('75%')).toBeInTheDocument() // Max value
    expect(screen.getByText('Volatility')).toBeInTheDocument()
  })

  it('shows increasing trend correctly', () => {
    render(<PressureConfidenceTracker {...defaultProps} />)
    
    expect(screen.getByText('📈')).toBeInTheDocument()
    expect(screen.getByText('Increasing')).toBeInTheDocument()
  })

  it('shows decreasing trend correctly', () => {
    const decreasingHistory = [0.8, 0.75, 0.7, 0.6]
    render(
      <PressureConfidenceTracker 
        {...defaultProps} 
        confidenceHistory={decreasingHistory}
        pressure={{ ...mockPressure, confidence_score: 0.6 }}
      />
    )
    
    expect(screen.getByText('📉')).toBeInTheDocument()
    expect(screen.getByText('Decreasing')).toBeInTheDocument()
  })

  it('shows stable trend correctly', () => {
    const stableHistory = [0.75, 0.74, 0.76, 0.75]
    render(
      <PressureConfidenceTracker 
        {...defaultProps} 
        confidenceHistory={stableHistory}
      />
    )
    
    expect(screen.getByText('➡️')).toBeInTheDocument()
    expect(screen.getByText('Stable')).toBeInTheDocument()
  })

  it('displays volatility levels correctly', () => {
    // Test low volatility
    const lowVolatilityHistory = [0.74, 0.75, 0.76, 0.75]
    const { rerender } = render(
      <PressureConfidenceTracker 
        {...defaultProps} 
        confidenceHistory={lowVolatilityHistory}
      />
    )
    expect(screen.getByText('Low')).toBeInTheDocument()

    // Test high volatility
    const highVolatilityHistory = [0.3, 0.8, 0.4, 0.9]
    rerender(
      <PressureConfidenceTracker 
        {...defaultProps} 
        confidenceHistory={highVolatilityHistory}
      />
    )
    expect(screen.getByText('High')).toBeInTheDocument()
  })

  it('renders confidence history chart when showHistory is true', () => {
    render(<PressureConfidenceTracker {...defaultProps} showHistory={true} />)
    
    expect(screen.getByText('Confidence History')).toBeInTheDocument()
    expect(screen.getByText('Oldest')).toBeInTheDocument()
    expect(screen.getByText('Most Recent')).toBeInTheDocument()
  })

  it('hides confidence history chart when showHistory is false', () => {
    render(<PressureConfidenceTracker {...defaultProps} showHistory={false} />)
    
    expect(screen.queryByText('Confidence History')).not.toBeInTheDocument()
  })

  it('renders update controls when onConfidenceUpdate is provided', () => {
    render(<PressureConfidenceTracker {...defaultProps} />)
    
    expect(screen.getByText('Update Confidence')).toBeInTheDocument()
    expect(screen.getByRole('slider')).toBeInTheDocument()
    expect(screen.getByText('4 updates tracked')).toBeInTheDocument()
  })

  it('hides update controls when onConfidenceUpdate is not provided', () => {
    render(<PressureConfidenceTracker {...defaultProps} onConfidenceUpdate={undefined} />)
    
    expect(screen.queryByText('Update Confidence')).not.toBeInTheDocument()
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
  })

  it('calls onConfidenceUpdate when slider is changed', () => {
    const onConfidenceUpdate = vi.fn()
    render(<PressureConfidenceTracker {...defaultProps} onConfidenceUpdate={onConfidenceUpdate} />)
    
    const slider = screen.getByRole('slider')
    fireEvent.change(slider, { target: { value: '0.8' } })
    
    expect(onConfidenceUpdate).toHaveBeenCalledWith(0.8)
  })

  it('displays insights when sufficient history is available', () => {
    render(<PressureConfidenceTracker {...defaultProps} />)
    
    expect(screen.getByText('💡')).toBeInTheDocument()
    expect(screen.getByText('Insight:')).toBeInTheDocument()
  })

  it('handles empty confidence history', () => {
    render(<PressureConfidenceTracker {...defaultProps} confidenceHistory={[]} />)
    
    expect(screen.getByText('75%')).toBeInTheDocument() // Should show current confidence
    expect(screen.queryByText('Confidence History')).not.toBeInTheDocument()
  })

  it('handles single item confidence history', () => {
    render(<PressureConfidenceTracker {...defaultProps} confidenceHistory={[0.75]} />)
    
    expect(screen.getByText('Stable')).toBeInTheDocument() // Should show stable trend
    expect(screen.queryByText('Confidence History')).not.toBeInTheDocument()
  })

  it('applies custom className', () => {
    const customClassName = 'custom-tracker-class'
    render(<PressureConfidenceTracker {...defaultProps} className={customClassName} />)
    
    const tracker = screen.getByText('Confidence Tracking').closest('.pressure-confidence-tracker')
    expect(tracker).toHaveClass(customClassName)
  })

  it('displays correct progress bar width', () => {
    render(<PressureConfidenceTracker {...defaultProps} />)
    
    const progressBar = screen.getByText('Current Confidence').nextElementSibling?.querySelector('div > div')
    expect(progressBar).toHaveStyle({ width: '75%' })
  })

  it('generates appropriate insights for different scenarios', () => {
    // Test increasing trend with low volatility
    const increasingHistory = [0.6, 0.65, 0.7, 0.75]
    const { rerender } = render(
      <PressureConfidenceTracker 
        {...defaultProps} 
        confidenceHistory={increasingHistory}
      />
    )
    expect(screen.getByText(/steadily increasing/)).toBeInTheDocument()

    // Test high volatility
    const volatileHistory = [0.3, 0.8, 0.4, 0.9, 0.2]
    rerender(
      <PressureConfidenceTracker 
        {...defaultProps} 
        confidenceHistory={volatileHistory}
        pressure={{ ...mockPressure, confidence_score: 0.2 }}
      />
    )
    expect(screen.getByText(/High volatility detected/)).toBeInTheDocument()
  })

  it('updates display when pressure confidence changes', () => {
    const { rerender } = render(<PressureConfidenceTracker {...defaultProps} />)
    
    expect(screen.getByText('75%')).toBeInTheDocument()
    
    rerender(
      <PressureConfidenceTracker 
        {...defaultProps} 
        pressure={{ ...mockPressure, confidence_score: 0.9 }}
      />
    )
    
    expect(screen.getByText('90%')).toBeInTheDocument()
  })
})