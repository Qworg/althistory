import { screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { BranchComparisonModal } from './BranchComparisonModal'
import { renderWithProviders } from '@/test/utils'
import { useWorldCalendarStore } from '@/stores/worldCalendarStore'
import type { Event, GraphCalendar } from '@/types'

const AR: GraphCalendar = { epochYear: 1000, eraLabel: 'AR' }

const causalGraph = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }))
vi.mock('@/components/causal-graph/CausalGraphComponent', () => ({
  CausalGraphComponent: (props: Record<string, unknown>) => {
    causalGraph.props = props
    return <div data-testid="embedded-causal-graph" />
  },
}))

vi.mock('@/services/api', () => ({
  apiClient: {
    events: { getAll: vi.fn().mockResolvedValue([]) },
    arcs: { getAll: vi.fn().mockResolvedValue([]) },
    causal: { getRelationships: vi.fn().mockResolvedValue([]) },
    graphs: {
      getAll: vi.fn().mockResolvedValue({
        graphs: [
          { id: 'earth-1', name: 'Earth', version: 1, metadata: { eventCount: 2 } },
          { id: 'earth-2', name: 'Earth Branch', parentGraphId: 'earth-1', version: 1, metadata: { eventCount: 2 } },
          { id: 'vael', name: 'Vael', version: 1, metadata: { eventCount: 2 }, calendar: { epochYear: 1000, eraLabel: 'AR' } },
        ],
        total: 3,
      }),
      getVersions: vi.fn().mockResolvedValue([]),
    },
  },
}))

const event = (id: string, description: string, timestamp: string): Event => ({
  id,
  description,
  actor: 'Parliament',
  target: 'Crown',
  timestamp,
  created_at: timestamp,
  updated_at: timestamp,
})

const shared = event('e1', 'The Charter', '1843-03-04T00:00:00Z')
const dropped = event('e2', 'The Old Treaty', '1843-11-20T00:00:00Z')
const added = event('e3', 'The New Treaty', '1844-02-01T00:00:00Z')

function open(baseline: string, branch: string) {
  return renderWithProviders(
    <BranchComparisonModal
      isOpen
      onClose={vi.fn()}
      initialBaselineGraphId={baseline}
      initialCounterfactualGraphId={branch}
      originalData={{ events: [shared, dropped], arcs: [], relationships: [] }}
      copiedData={{ events: [shared, added], arcs: [], relationships: [] }}
    />
  )
}

describe('BranchComparisonModal in world calendars', () => {
  afterEach(() => {
    useWorldCalendarStore.getState().setCalendar(null)
    causalGraph.props = null
  })

  it("shows two Gregorian graphs in stored years, even with an invented world open", async () => {
    useWorldCalendarStore.getState().setCalendar(AR)
    open('earth-1', 'earth-2')
    // Once the graph list has loaded, each graph's own (absent) calendar is used.
    await waitFor(() => expect(screen.getAllByText('Nov 20, 1843').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('tab', { name: 'Differences' }))
    expect(screen.getByText('Feb 1, 1844')).toBeInTheDocument()
    expect(screen.queryByText(/AR\b/)).not.toBeInTheDocument()
    expect(screen.queryByText(/count years differently/)).not.toBeInTheDocument()
  })

  it("shows two graphs of the same world in its years, even with a Gregorian graph open", async () => {
    // Both sides are Vael's: its calendar, whichever graph is open.
    open('vael', 'vael')
    await waitFor(() => expect(screen.getAllByText('Nov 20, 844 AR').length).toBeGreaterThan(0))
  })

  it('never labels one graph’s dates in the other’s calendar', async () => {
    open('vael', 'earth-2')
    await waitFor(() => expect(screen.getByText(/count years differently/)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('tab', { name: 'Differences' }))
    // Only in the baseline (Vael): its years. (It is also the point of divergence.)
    expect(screen.getAllByText('Nov 20, 844 AR').length).toBeGreaterThan(0)
    // Only in the branch (Earth): stored years.
    expect(screen.getByText('Feb 1, 1844')).toBeInTheDocument()
    // In both, with different calendars: stored years, not either world's.
    fireEvent.click(screen.getByRole('button', { name: /^All \(/ }))
    expect(screen.getByText('Mar 4, 1843')).toBeInTheDocument()
    expect(screen.queryByText('Mar 4, 844 AR')).not.toBeInTheDocument()
  })

  it("labels the embedded causal graph in the branch's calendar", async () => {
    useWorldCalendarStore.getState().setCalendar(AR)
    open('earth-1', 'earth-2')
    await waitFor(() => expect(screen.getAllByText('Nov 20, 1843').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('tab', { name: 'Causal graph' }))
    expect(causalGraph.props?.calendar).toBeNull()
  })
})
