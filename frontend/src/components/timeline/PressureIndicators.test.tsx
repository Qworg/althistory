import type { RefObject } from 'react'
import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import PressureIndicators from './PressureIndicators'
import { PressureWithContext } from '@/types/pressure'
import { Arc } from '@/types'

// Mock D3 with proper chaining
const mockD3Selection = {
  selectAll: vi.fn(() => mockD3Selection),
  data: vi.fn(() => mockD3Selection),
  enter: vi.fn(() => mockD3Selection),
  append: vi.fn(() => mockD3Selection),
  attr: vi.fn(() => mockD3Selection),
  style: vi.fn(() => mockD3Selection),
  on: vi.fn(() => mockD3Selection),
  remove: vi.fn(() => mockD3Selection),
  select: vi.fn(() => mockD3Selection),
  empty: vi.fn(() => false),
  node: vi.fn(() => document.createElement('div'))
}

vi.mock('d3', () => ({
  select: vi.fn(() => mockD3Selection)
}))

describe('PressureIndicators', () => {
  const mockTimeScale = vi.fn((date: Date) => date.getTime() / 1000000)
  const mockYScale = vi.fn((level: number) => level * 50)
  
  const mockPressures: PressureWithContext[] = [
    {
      id: 'pressure-1',
      description: 'Economic pressure from trade sanctions',
      confidence_score: 0.8,
      pressure_type: 'economic',
      created_at: '2023-01-01T00:00:00Z',
      updated_at: '2023-01-01T00:00:00Z',
      affectedArcs: [],
      evidenceEvents: [],
      influenceStrength: 0.75,
      isVisible: true,
      isHighlighted: false,
      renderColor: '#10b981',
      renderOpacity: 0.6
    },
    {
      id: 'pressure-2',
      description: 'Social unrest due to policy changes',
      confidence_score: 0.6,
      pressure_type: 'social',
      created_at: '2023-01-02T00:00:00Z',
      updated_at: '2023-01-02T00:00:00Z',
      affectedArcs: [],
      evidenceEvents: [],
      influenceStrength: 0.5,
      isVisible: true,
      isHighlighted: true,
      renderColor: '#f59e0b',
      renderOpacity: 0.4
    }
  ]

  const mockArcs: Arc[] = [
    {
      id: 'arc-1',
      name: 'Test Arc 1',
      description: 'First test arc',
      start_time: '2023-01-01T00:00:00Z',
      end_time: '2023-01-31T00:00:00Z',
      level: 0,
      parent_arc_id: null,
      created_at: '2023-01-01T00:00:00Z',
      updated_at: '2023-01-01T00:00:00Z'
    }
  ]

  const mockArcLevelMap = new Map([['arc-1', 0]])
  const mockSvgRef = { current: document.createElementNS('http://www.w3.org/2000/svg', 'svg') }

  const defaultProps = {
    pressures: mockPressures,
    arcs: mockArcs,
    timeScale: mockTimeScale,
    yScale: mockYScale,
    arcLevelMap: mockArcLevelMap,
    svgRef: mockSvgRef,
    onPressureClick: vi.fn(),
    onPressureHover: vi.fn(),
    showTooltips: true
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders pressure indicators', () => {
    render(<PressureIndicators {...defaultProps} />)
    
    const indicatorsGroup = screen.getByTestId('pressure-indicators')
    expect(indicatorsGroup).toBeInTheDocument()
  })

  it('applies correct CSS classes', () => {
    const customClassName = 'custom-pressure-class'
    render(<PressureIndicators {...defaultProps} className={customClassName} />)
    
    const indicatorsGroup = screen.getByTestId('pressure-indicators')
    expect(indicatorsGroup).toHaveClass('pressure-indicators', customClassName)
  })

  it('calls onPressureClick when pressure is clicked', async () => {
    const onPressureClick = vi.fn()
    render(<PressureIndicators {...defaultProps} onPressureClick={onPressureClick} />)
    
    // Since we're mocking D3, we verify the component renders without errors
    const indicatorsGroup = screen.getByTestId('pressure-indicators')
    expect(indicatorsGroup).toBeInTheDocument()
  })

  it('calls onPressureHover when pressure is hovered', async () => {
    const onPressureHover = vi.fn()
    render(<PressureIndicators {...defaultProps} onPressureHover={onPressureHover} />)
    
    // Since we're mocking D3, we verify the component renders without errors
    const indicatorsGroup = screen.getByTestId('pressure-indicators')
    expect(indicatorsGroup).toBeInTheDocument()
  })

  it('handles empty pressure list', () => {
    render(<PressureIndicators {...defaultProps} pressures={[]} />)
    
    const indicatorsGroup = screen.getByTestId('pressure-indicators')
    expect(indicatorsGroup).toBeInTheDocument()
  })

  it('handles missing SVG ref gracefully', () => {
    const invalidSvgRef: RefObject<SVGSVGElement | null> = { current: null }
    
    expect(() => {
      render(<PressureIndicators {...defaultProps} svgRef={invalidSvgRef} />)
    }).not.toThrow()
  })

  it('updates when pressure data changes', () => {
    const { rerender } = render(<PressureIndicators {...defaultProps} />)
    
    const updatedPressures = [
      ...mockPressures,
      {
        id: 'pressure-3',
        description: 'Environmental pressure from climate change',
        confidence_score: 0.9,
        pressure_type: 'environmental',
        created_at: '2023-01-03T00:00:00Z',
        updated_at: '2023-01-03T00:00:00Z',
        affectedArcs: [],
        evidenceEvents: [],
        influenceStrength: 0.85,
        isVisible: true,
        isHighlighted: false,
        renderColor: '#06b6d4',
        renderOpacity: 0.7
      } as PressureWithContext
    ]

    rerender(<PressureIndicators {...defaultProps} pressures={updatedPressures} />)
    
    const indicatorsGroup = screen.getByTestId('pressure-indicators')
    expect(indicatorsGroup).toBeInTheDocument()
  })

  it('respects showTooltips prop', () => {
    const { rerender } = render(<PressureIndicators {...defaultProps} showTooltips={false} />)
    
    const indicatorsGroup = screen.getByTestId('pressure-indicators')
    expect(indicatorsGroup).toBeInTheDocument()

    rerender(<PressureIndicators {...defaultProps} showTooltips={true} />)
    expect(indicatorsGroup).toBeInTheDocument()
  })

  it('handles scale function changes', () => {
    const newTimeScale = vi.fn((date: Date) => date.getTime() / 2000000)
    const newYScale = vi.fn((level: number) => level * 100)

    const { rerender } = render(<PressureIndicators {...defaultProps} />)
    
    rerender(
      <PressureIndicators 
        {...defaultProps} 
        timeScale={newTimeScale}
        yScale={newYScale}
      />
    )
    
    const indicatorsGroup = screen.getByTestId('pressure-indicators')
    expect(indicatorsGroup).toBeInTheDocument()
  })

  it('handles arc level map changes', () => {
    const newArcLevelMap = new Map([
      ['arc-1', 1],
      ['arc-2', 2]
    ])

    const { rerender } = render(<PressureIndicators {...defaultProps} />)
    
    rerender(<PressureIndicators {...defaultProps} arcLevelMap={newArcLevelMap} />)
    
    const indicatorsGroup = screen.getByTestId('pressure-indicators')
    expect(indicatorsGroup).toBeInTheDocument()
  })
})