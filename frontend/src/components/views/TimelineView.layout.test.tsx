/**
 * The Timeline view's hierarchy: the timeline is the subject, so its canvas
 * takes most of the window and the pressure analysis below it starts closed.
 *
 * The canvas used to be capped at 360px while the pressure panel -- four stat
 * tiles, a chip row and a list, each in a card -- stood taller than it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router'
import { TimelineView } from './TimelineView'
import { useEvents } from '@/hooks/useEvents'
import { useArcs } from '@/hooks/useArcs'
import { useGlobalStore } from '@/stores/globalStore'
import type { Arc, Event, FilterState } from '@/types'
import type { TimelineProps } from '@/components/timeline/Timeline'
import { timelineContentHeight } from '@/components/timeline/timelineLayout'

const probe = vi.hoisted(() => ({ props: null as TimelineProps | null }))

vi.mock('@/components/timeline/Timeline', () => ({
  Timeline: (props: TimelineProps) => {
    probe.props = props
    return <div data-testid="timeline" />
  },
}))
vi.mock('@/hooks/useEvents')
vi.mock('@/hooks/useArcs')
// No server: the pressures come back empty rather than as refused requests.
vi.mock('@/hooks/useAPI', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useAPI')>()
  return {
    ...actual,
    useInferredPressures: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
    useCausalRelationships: () => ({ data: [], isLoading: false, error: null }),
  }
})

type EventsQuery = ReturnType<typeof useEvents>
type ArcsQuery = ReturnType<typeof useArcs>

const events: Event[] = [
  {
    id: 'e1',
    description: 'Babbage completes the Engine',
    actor: 'Babbage',
    target: 'Treasury',
    timestamp: '1843-11-20T00:00:00.000Z',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
  },
]

function arcAtLevel(id: string, level: number): Arc {
  return {
    id,
    name: `Arc ${id}`,
    description: '',
    start_time: '1840-01-01T00:00:00.000Z',
    end_time: '1850-01-01T00:00:00.000Z',
    level,
    parent_arc_id: null,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
  }
}

const filters: FilterState = {
  dateRange: null,
  actors: [],
  targets: [],
  eventTypes: [],
  arcLevels: [],
  causalWeightRange: [0, 1],
  confidenceThreshold: 0,
  searchQuery: '',
}

const originalInnerHeight = window.innerHeight

function setWindowHeight(height: number) {
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height })
}

function renderView(arcs: Arc[] = [arcAtLevel('a1', 0)]) {
  vi.mocked(useEvents).mockReturnValue({ data: events, isLoading: false, error: null } as EventsQuery)
  vi.mocked(useArcs).mockReturnValue({ data: arcs, isLoading: false, error: null } as ArcsQuery)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <TimelineView />
      </BrowserRouter>
    </QueryClientProvider>
  )
}

function canvasHeight(): number | undefined {
  return probe.props?.height
}

describe('TimelineView layout', () => {
  beforeEach(() => {
    probe.props = null
    useGlobalStore.setState({ errors: [], activeFilters: { ...filters } })
  })

  afterEach(() => {
    setWindowHeight(originalInnerHeight)
  })

  it('sizes the canvas to the timeline content, whatever the window height', () => {
    setWindowHeight(1400)
    renderView()
    // A tall window adds nothing: extra height was an empty band between the
    // arc rows and the event track.
    expect(canvasHeight()).toBe(timelineContentHeight([arcAtLevel('a1', 0)]))
  })

  it('grows when arcs need more rows', () => {
    setWindowHeight(600)
    // Overlapping top-level arcs stack into rows (children stay collapsed)
    const first = arcAtLevel('a1', 0)
    const overlapping = { ...arcAtLevel('a2', 0), start_time: '1845-01-01T00:00:00.000Z', end_time: '1855-01-01T00:00:00.000Z' }
    renderView([first, overlapping])
    expect(canvasHeight()).toBe(timelineContentHeight([first, overlapping]))
    expect(canvasHeight()).toBeGreaterThan(timelineContentHeight([first]))
  })

  it('titles the view on the shared type scale', () => {
    renderView()
    const title = screen.getByRole('heading', { level: 2, name: 'Timeline View' })
    expect(title).toHaveClass('font-display', 'text-[1.75rem]', 'leading-tight', 'font-semibold')
  })

  it('opens with the pressure analysis collapsed below the timeline', () => {
    renderView()

    const heading = screen.getByRole('heading', { level: 3, name: 'Pressure Analysis' })
    const toggle = screen.getByRole('button', { name: 'Pressure Analysis' })
    expect(heading).toContainElement(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    // The timeline comes first in reading order.
    const timeline = screen.getByTestId('timeline')
    expect(timeline.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    // The stat tiles are gone.
    for (const label of ['Total', 'Visible', 'Avg Confidence', 'Hidden']) {
      expect(screen.queryByText(label, { exact: true })).not.toBeInTheDocument()
    }
  })
})
