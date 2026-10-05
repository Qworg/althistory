import { render, screen, fireEvent, within } from '@testing-library/react'
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
    // 75% appears in multiple places (current confidence, max, slider value)
    // Check that at least one exists
    expect(screen.getAllByText('75%').length).toBeGreaterThan(0)
  })

  it('displays confidence statistics correctly', () => {
    render(<PressureConfidenceTracker {...defaultProps} />)

    expect(screen.getByText('Average')).toBeInTheDocument()
    expect(screen.getByText('68%')).toBeInTheDocument() // Average of [0.6, 0.65, 0.7, 0.75]
    expect(screen.getByText('Min')).toBeInTheDocument()
    expect(screen.getByText('60%')).toBeInTheDocument() // Min value
    expect(screen.getByText('Max')).toBeInTheDocument()
    // Max value is 75%, same as current confidence - get parent container (.bg-gray-50)
    const maxSection = screen.getByText('Max').closest<HTMLElement>('.bg-gray-50')
    if (maxSection === null) throw new Error('Expected a Max statistics section')
    expect(within(maxSection).getByText('75%')).toBeInTheDocument()
    expect(screen.getByText('Volatility')).toBeInTheDocument()
  })

  it('shows increasing trend correctly', () => {
    // Use a history where trend > 0.1 (recent[-1] - recent[0] > 0.1)
    const increasingHistory = [0.5, 0.65, 0.8]
    render(
      <PressureConfidenceTracker
        {...defaultProps}
        confidenceHistory={increasingHistory}
        pressure={{ ...defaultProps.pressure, confidence_score: 0.8 }}
      />
    )

    expect(screen.getByText('📈')).toBeInTheDocument()
    // Component renders lowercase trend with CSS capitalize
    expect(screen.getByText('increasing')).toBeInTheDocument()
  })

  it('shows decreasing trend correctly', () => {
    // Need trend < -0.1 (recent[-1] - recent[0] < -0.1)
    const decreasingHistory = [0.8, 0.7, 0.55]
    render(
      <PressureConfidenceTracker
        {...defaultProps}
        confidenceHistory={decreasingHistory}
        pressure={{ ...defaultProps.pressure, confidence_score: 0.55 }}
      />
    )

    expect(screen.getByText('📉')).toBeInTheDocument()
    expect(screen.getByText('decreasing')).toBeInTheDocument()
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
    expect(screen.getByText('stable')).toBeInTheDocument()
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

    // Should show current confidence (75% appears multiple times - current and slider)
    expect(screen.getAllByText('75%').length).toBeGreaterThan(0)
    expect(screen.queryByText('Confidence History')).not.toBeInTheDocument()
  })

  it('handles single item confidence history', () => {
    render(<PressureConfidenceTracker {...defaultProps} confidenceHistory={[0.75]} />)

    // Component renders lowercase trend with CSS capitalize
    expect(screen.getByText('stable')).toBeInTheDocument()
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

    // Find the progress bar container (next sibling of "Current Confidence" label row)
    const currentConfidenceLabel = screen.getByText('Current Confidence')
    const currentConfidenceSection = currentConfidenceLabel.closest('.mb-4')
    const progressBar = currentConfidenceSection?.querySelector('.bg-blue-500')
    expect(progressBar).toHaveStyle({ width: '75%' })
  })

  it('generates appropriate insights for different scenarios', () => {
    // Test increasing trend with low volatility
    // Need trend > 0.1 (recent[-1] - recent[0] > 0.1) with low volatility (std dev < 0.1)
    const increasingHistory = [0.5, 0.6, 0.65, 0.75]
    const { rerender } = render(
      <PressureConfidenceTracker
        {...defaultProps}
        confidenceHistory={increasingHistory}
        pressure={{ ...defaultProps.pressure, confidence_score: 0.75 }}
      />
    )
    expect(screen.getByText(/steadily increasing/)).toBeInTheDocument()

    // Test high volatility
    const volatileHistory = [0.3, 0.8, 0.4, 0.9, 0.2]
    rerender(
      <PressureConfidenceTracker
        {...defaultProps}
        confidenceHistory={volatileHistory}
        pressure={{ ...defaultProps.pressure, confidence_score: 0.2 }}
      />
    )
    expect(screen.getByText(/High volatility detected/)).toBeInTheDocument()
  })

  it('updates display when pressure confidence changes', () => {
    const { rerender } = render(<PressureConfidenceTracker {...defaultProps} />)

    // 75% appears multiple times - verify at least one exists
    expect(screen.getAllByText('75%').length).toBeGreaterThan(0)

    rerender(
      <PressureConfidenceTracker
        {...defaultProps}
        pressure={{ ...defaultProps.pressure, confidence_score: 0.9 }}
      />
    )

    // After update, 90% should appear (may also appear multiple times)
    expect(screen.getAllByText('90%').length).toBeGreaterThan(0)
  })
})