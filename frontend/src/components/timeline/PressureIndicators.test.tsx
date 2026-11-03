/**
 * Pressure bars are React-rendered (ADR-001 Tier 1): marks, gradient and the
 * tooltip. The tooltip used to be a div d3 appended to document.body; it now
 * lives in the timeline container, which is the svg's parent.
 */
import type { RefObject } from 'react'
import { useRef } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import PressureIndicators, { type PressureIndicatorsProps } from './PressureIndicators'
import { PressureWithContext } from '@/types/pressure'
import { Arc } from '@/types'
import { formatHistoricalRange } from '@/utils/historicalTime'

const arc: Arc = {
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

function pressure(id: string, overrides: Partial<PressureWithContext> = {}): PressureWithContext {
  return {
    id,
    description: `Pressure ${id}`,
    confidence_score: 0.8,
    pressure_type: 'economic',
    created_at: '2023-01-01T00:00:00Z',
    updated_at: '2023-01-01T00:00:00Z',
    affectedArcs: [arc],
    evidenceEvents: [],
    influenceStrength: 0.75,
    isVisible: true,
    isHighlighted: false,
    renderColor: '#10b981',
    renderOpacity: 0.6,
    ...overrides
  }
}

const timeScale = (date: Date) => date.getTime() / 1e10
const yScale = (level: number) => 40 + level * 28
const arcLevelMap = new Map([['arc-1', 0]])

/** Renders the indicators the way Timeline does: inside an svg inside a positioned container. */
function Harness(props: Partial<PressureIndicatorsProps>) {
  const svgRef = useRef<SVGSVGElement>(null)
  return (
    <div data-testid="container" style={{ position: 'relative' }}>
      <svg ref={svgRef}>
        <PressureIndicators
          pressures={[pressure('p1')]}
          arcs={[arc]}
          timeScale={timeScale}
          yScale={yScale}
          arcLevelMap={arcLevelMap}
          svgRef={svgRef}
          {...props}
        />
      </svg>
    </div>
  )
}

describe('PressureIndicators', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders one React-owned indicator per affected arc', () => {
    const { container } = render(<Harness pressures={[pressure('p1'), pressure('p2', { pressure_type: 'social' })]} />)

    expect(screen.getByTestId('pressure-indicators')).toBeInTheDocument()
    expect(container.querySelectorAll('.pressure-indicator')).toHaveLength(2)
    expect(container.querySelector('.pressure-indicator[data-pressure-id="p1"][data-arc-id="arc-1"]')).not.toBeNull()
  })

  it('applies the custom class', () => {
    render(<Harness className="custom-pressure-class" />)
    expect(screen.getByTestId('pressure-indicators')).toHaveClass('pressure-indicators', 'custom-pressure-class')
  })

  it('renders its confidence gradient in JSX and references it', () => {
    const { container } = render(<Harness />)
    const gradient = container.querySelector('linearGradient')
    expect(gradient).not.toBeNull()
    const overlay = container.querySelector('.confidence-indicator')
    expect(overlay?.getAttribute('fill')).toBe(`url(#${gradient!.id})`)
  })

  it('handles an empty pressure list and a missing svg ref', () => {
    const empty: RefObject<SVGSVGElement | null> = { current: null }
    const { container } = render(
      <svg>
        <PressureIndicators
          pressures={[]}
          arcs={[arc]}
          timeScale={timeScale}
          yScale={yScale}
          arcLevelMap={arcLevelMap}
          svgRef={empty}
        />
      </svg>
    )
    expect(container.querySelectorAll('.pressure-indicator')).toHaveLength(0)
  })

  it('calls onPressureClick on click', () => {
    const onPressureClick = vi.fn()
    render(<Harness onPressureClick={onPressureClick} />)

    fireEvent.click(screen.getByRole('button', { name: /Economic pressure on Test Arc 1/ }))
    expect(onPressureClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }))
  })

  it.each(['Enter', ' '])('activates with the %j key', (key) => {
    const onPressureClick = vi.fn()
    render(<Harness onPressureClick={onPressureClick} />)

    const bar = screen.getByRole('button', { name: /Economic pressure/ })
    // Out of the tab order (the timeline is one tab stop); still activatable
    expect(bar).toHaveAttribute('tabindex', '-1')
    const notPrevented = fireEvent.keyDown(bar, { key })
    expect(onPressureClick).toHaveBeenCalledTimes(1)
    expect(notPrevented).toBe(false)
  })

  it('shows a React tooltip inside the container on hover, not on document.body', () => {
    const onPressureHover = vi.fn()
    render(<Harness onPressureHover={onPressureHover} />)

    const bar = screen.getByRole('button', { name: /Economic pressure/ })
    fireEvent.mouseEnter(bar, { clientX: 20, clientY: 30 })

    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toHaveTextContent('Economic Pressure')
    expect(tooltip).toHaveTextContent('Pressure p1')
    expect(tooltip.parentElement).toBe(screen.getByTestId('container'))
    // The pressure type is a stroke icon, not an emoji.
    expect(tooltip.querySelector('svg path')).not.toBeNull()
    expect(tooltip.textContent).not.toMatch(/💰/)
    expect(onPressureHover).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'p1' }))

    fireEvent.mouseLeave(bar)
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(onPressureHover).toHaveBeenLastCalledWith(null)
  })

  it('shows the tooltip on keyboard focus too', () => {
    render(<Harness />)
    const bar = screen.getByRole('button', { name: /Economic pressure/ })
    fireEvent.focus(bar)
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    fireEvent.blur(bar)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('respects showTooltips={false}', () => {
    const onPressureHover = vi.fn()
    render(<Harness showTooltips={false} onPressureHover={onPressureHover} />)
    fireEvent.mouseEnter(screen.getByRole('button', { name: /Economic pressure/ }))
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(onPressureHover).toHaveBeenCalled()
  })

  it('removes the tooltip on unmount', () => {
    const { unmount } = render(<Harness />)
    fireEvent.mouseEnter(screen.getByRole('button', { name: /Economic pressure/ }))
    expect(document.querySelector('.pressure-tooltip')).not.toBeNull()
    unmount()
    expect(document.querySelector('.pressure-tooltip')).toBeNull()
  })

  it('draws a top-level arc\'s indicator inside the plot, on the arc\'s own lane', () => {
    // The timeline's real lane scale: level 0 at y=10. The indicator used to be
    // placed 25px above the arc (y=-15), outside the plot's clip rectangle, so
    // no indicator of a root arc was ever visible.
    const timelineYScale = (level: number) => 10 + level * 28
    const { container } = render(<Harness yScale={timelineYScale} />)
    const bar = container.querySelector('.pressure-bar')!
    const y = Number(bar.getAttribute('y'))
    const height = Number(bar.getAttribute('height'))
    expect(y).toBeGreaterThanOrEqual(0)
    // Within the arc bar (top 10, 16px tall), not in the lane above.
    expect(y).toBeGreaterThanOrEqual(10)
    expect(y + height).toBeLessThanOrEqual(10 + 16)
  })

  it('keeps a deeper arc\'s indicator out of the lane above it', () => {
    const timelineYScale = (level: number) => 10 + level * 28
    const { container } = render(<Harness yScale={timelineYScale} arcLevelMap={new Map([['arc-1', 1]])} />)
    const y = Number(container.querySelector('.pressure-bar')!.getAttribute('y'))
    expect(y).toBeGreaterThanOrEqual(38)
    expect(y).toBeLessThan(38 + 16)
  })

  it('shows the inferred period in the tooltip, not a saturated influence figure', () => {
    render(
      <Harness
        pressures={[
          pressure('p1', {
            influenceStrength: 1,
            time_range: { start: '1847-05-31T00:00:00Z', end: '1847-06-17T00:00:00Z' },
          }),
        ]}
      />
    )
    fireEvent.mouseEnter(screen.getByRole('button', { name: /Economic pressure/ }))
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip.textContent).not.toMatch(/influence/i)
    expect(tooltip).toHaveTextContent(formatHistoricalRange('1847-05-31T00:00:00Z', '1847-06-17T00:00:00Z'))
  })

  it('omits indicators for arcs not in the rendered hierarchy', () => {
    const { container } = render(<Harness arcLevelMap={new Map()} />)
    expect(container.querySelectorAll('.pressure-indicator')).toHaveLength(0)
  })
})
