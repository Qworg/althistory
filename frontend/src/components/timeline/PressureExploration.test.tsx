/**
 * The pressure analysis is a disclosure section under the timeline: closed by
 * default to a one-line summary, so the timeline above it stays the subject of
 * the view. It used to open as a stack of cards -- four uppercase stat tiles,
 * a chip row and a list, each in its own bordered box -- which was taller than
 * the timeline it annotates.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PressureExploration } from './PressureExploration'
import { usePressures } from '@/hooks/usePressures'
import type { PressureWithContext } from '@/types/pressure'
import { formatHistoricalRange } from '@/utils/historicalTime'

vi.mock('@/hooks/usePressures')

function pressure(id: string, type: string, confidence: number): PressureWithContext {
  return {
    id,
    pressure_type: type,
    description: `A ${type} pressure`,
    confidence_score: confidence,
    created_at: '1843-01-01T00:00:00.000Z',
    updated_at: '1843-01-01T00:00:00.000Z',
    affectedArcs: [],
    evidenceEvents: [],
    influenceStrength: 0.7,
    isVisible: true,
    isHighlighted: false,
    renderColor: '#1d4ed8',
    renderOpacity: 0.8,
  } as PressureWithContext
}

const actions = {
  selectPressure: vi.fn(),
  highlightPressureEvidence: vi.fn(),
  clearPressureHighlight: vi.fn(),
  showEvidenceModalAction: vi.fn(),
  hideEvidenceModal: vi.fn(),
  trackConfidenceChange: vi.fn(),
  setConfidenceThreshold: vi.fn(),
  togglePressureIndicators: vi.fn(),
}

function mockPressures(
  visible: PressureWithContext[],
  { total = visible.length, threshold = 0.6, isLoading = false } = {}
) {
  const typeDistribution: Record<string, number> = {}
  for (const p of visible) typeDistribution[p.pressure_type] = (typeDistribution[p.pressure_type] ?? 0) + 1
  const average = visible.length ? visible.reduce((s, p) => s + p.confidence_score, 0) / visible.length : 0
  vi.mocked(usePressures).mockReturnValue({
    visiblePressures: visible,
    pressureStats: {
      totalPressures: total,
      visibleCount: visible.length,
      averageConfidence: average,
      typeDistribution,
      hiddenCount: total - visible.length,
    },
    isLoading,
    error: null,
    selectedPressure: null,
    explorationState: {
      selectedPressure: null,
      highlightedEvidence: new Set<string>(),
      showEvidenceModal: false,
      confidenceTracking: new Map<string, number[]>(),
    },
    visualConfig: { showIndicators: true, confidenceThreshold: threshold },
    ...actions,
  } as unknown as ReturnType<typeof usePressures>)
}

describe('PressureExploration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPressures([
      pressure('p1', 'economic', 0.9),
      pressure('p2', 'social', 0.8),
      pressure('p3', 'political', 0.7),
    ])
  })

  it('starts collapsed, with a disclosure button wired to its region', () => {
    render(<PressureExploration />)

    const heading = screen.getByRole('heading', { name: 'Pressure Analysis' })
    expect(heading.tagName).toBe('H3')
    const toggle = within(heading).getByRole('button', { name: 'Pressure Analysis' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    const regionId = toggle.getAttribute('aria-controls')
    expect(regionId).toBeTruthy()
    const region = document.getElementById(regionId!)
    expect(region).not.toBeNull()
    expect(region).not.toBeVisible()
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Detected pressures' })).not.toBeInTheDocument()
  })

  it('summarises the pressures in one line while collapsed', () => {
    render(<PressureExploration />)

    const summary = screen.getByTestId('pressure-summary')
    expect(summary).toHaveTextContent(
      '3 pressures detected · economic, social, political · average confidence 0.80'
    )
    // Each type is its own text node, so it can be found exactly (the media
    // tour waits for "economic" to know the pressures have loaded).
    expect(screen.getByText('economic', { exact: true })).toBeVisible()
    // The summary describes the toggle (jsdom's description pads inline
    // spans with spaces, so only its start is compared).
    expect(screen.getByRole('button', { name: 'Pressure Analysis' })).toHaveAccessibleDescription(
      /^3 pressures detected · economic/
    )
  })

  it('counts the pressures the threshold hides', () => {
    mockPressures([pressure('p1', 'economic', 0.9)], { total: 3, threshold: 0.75 })
    render(<PressureExploration />)

    expect(screen.getByTestId('pressure-summary')).toHaveTextContent(
      '1 of 3 pressures shown · economic · average confidence 0.90 · 2 below 0.75'
    )
  })

  it('lists each pressure with its period and arcs, not a saturated influence figure', () => {
    mockPressures([
      {
        ...pressure('p1', 'economic', 0.92),
        influenceStrength: 1,
        time_range: { start: '1847-05-31T00:00:00Z', end: '1847-06-17T00:00:00Z' },
        affectedArcs: [{ id: 'a1', name: 'The Calculating Offices' }],
      } as PressureWithContext,
    ])
    render(<PressureExploration defaultExpanded />)

    const item = within(screen.getByRole('list', { name: 'Detected pressures' })).getByRole('button')
    expect(item.textContent).not.toMatch(/influence/i)
    expect(item).toHaveTextContent(formatHistoricalRange('1847-05-31T00:00:00Z', '1847-06-17T00:00:00Z'))
    expect(item).toHaveTextContent('in The Calculating Offices')
  })

  it('has no stat tiles: the numbers live in the summary', () => {
    render(<PressureExploration defaultExpanded />)

    for (const label of ['Total', 'Visible', 'Avg Confidence', 'Hidden']) {
      expect(screen.queryByText(label, { exact: true })).not.toBeInTheDocument()
    }
  })

  it('opens on the toggle, showing the threshold on the 0–1 scale and the list', async () => {
    const user = userEvent.setup()
    render(<PressureExploration />)

    const toggle = screen.getByRole('button', { name: 'Pressure Analysis' })
    await user.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toBeVisible()

    // Labelled for what it thresholds, in the filter panel's unit.
    const slider = screen.getByRole('slider', { name: 'Minimum pressure confidence' })
    expect(slider).toHaveValue('0.6')
    expect(screen.getByText('0.60')).toBeInTheDocument()

    const list = screen.getByRole('list', { name: 'Detected pressures' })
    const items = within(list).getAllByRole('button')
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveTextContent('Economic pressure')
    expect(items[0]).toHaveTextContent('Confidence 0.90')

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens the detail modal from a list item by keyboard-reachable button', async () => {
    const user = userEvent.setup()
    render(<PressureExploration defaultExpanded />)

    await user.click(screen.getByRole('button', { name: /Social pressure/ }))
    expect(actions.selectPressure).toHaveBeenCalledWith(expect.objectContaining({ id: 'p2' }))
    expect(actions.showEvidenceModalAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'p2' }))
  })

  it('does not nest cards inside the view card', () => {
    const { container } = render(<PressureExploration defaultExpanded />)
    expect(container.querySelector('.bg-card')).toBeNull()
  })
})
