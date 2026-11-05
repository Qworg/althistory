/**
 * What the Timeline view says about the selected event (why it is there) and
 * about the graph (whether it is a branch, and of what), and how it words a
 * delete.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router'
import { TimelineView } from './TimelineView'
import { useEvents } from '@/hooks/useEvents'
import { useArcs } from '@/hooks/useArcs'
import { useBaselineGhost, type BaselineGhostState } from '@/hooks/useBaselineGhost'
import { useGlobalStore } from '@/stores/globalStore'
import type { Arc, CausalRelationship, Event, FilterState, Graph } from '@/types'
import type { TimelineProps } from '@/components/timeline/Timeline'
import type { BranchComparisonModalProps } from '@/components/branch/BranchComparisonModal'
import { formatHistoricalDate } from '@/utils/historicalTime'

const mocks = vi.hoisted(() => ({
  timelineProps: { current: null as Record<string, unknown> | null },
  comparisonProps: { current: null as Record<string, unknown> | null },
  relationships: [] as unknown[],
}))

vi.mock('@/components/timeline/Timeline', () => ({
  Timeline: (props: TimelineProps) => {
    mocks.timelineProps.current = props as unknown as Record<string, unknown>
    return <div data-testid="timeline" />
  },
}))
vi.mock('@/components/branch/BranchComparisonModal', () => ({
  BranchComparisonModal: (props: BranchComparisonModalProps) => {
    mocks.comparisonProps.current = props as unknown as Record<string, unknown>
    return <div role="dialog" aria-label="Compare branches" />
  },
}))
vi.mock('@/hooks/useEvents')
vi.mock('@/hooks/useArcs')
vi.mock('@/hooks/useBaselineGhost')
vi.mock('@/hooks/useAPI', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useAPI')>()
  return {
    ...actual,
    useInferredPressures: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
    useCausalRelationships: () => ({ data: mocks.relationships, isLoading: false, error: null }),
    useDeleteEvent: () => ({ mutateAsync: vi.fn(), isPending: false }),
  }
})

const arcs: Arc[] = [
  {
    id: 'offices',
    name: 'The Calculating Offices',
    description: '',
    start_time: '1844-07-01T00:00:00.000Z',
    end_time: '1858-12-31T00:00:00.000Z',
    level: 1,
    parent_arc_id: null,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'wire',
    name: 'Engines on the Wire',
    description: '',
    start_time: '1851-01-01T00:00:00.000Z',
    end_time: '1858-12-31T00:00:00.000Z',
    level: 2,
    parent_arc_id: 'offices',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
  },
]

function event(id: string, description: string, timestamp: string, metadata?: Record<string, unknown>): Event {
  return {
    id,
    description,
    actor: 'Actor',
    target: 'Target',
    timestamp,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    metadata,
  }
}

const lloyds = event('lloyds', "Lloyd's adopts engine tables", '1847-06-01T00:00:00.000Z')
const wire = event('wire-ev', 'Engines linked by telegraph', '1853-03-01T00:00:00.000Z', {
  arcId: 'wire',
  confidence: 0.82,
  sourceUrl: 'https://en.wikipedia.org/wiki/Electrical_telegraph',
  articleTitle: 'Electrical telegraph',
  extractionSource: 'wikipedia',
  aiGenerated: true,
})
const moltke = event('moltke', 'Moltke plans mobilisation by engine', '1866-05-01T00:00:00.000Z')
const events = [lloyds, wire, moltke]

function link(id: string, cause: string, effect: string, weight: number): CausalRelationship {
  return {
    id,
    cause_event_id: cause,
    effect_event_id: effect,
    weight,
    evidence: '',
    confidence: 0.7,
    relationship_type: 'contributory',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
  }
}

const defaultFilters: FilterState = {
  dateRange: null,
  actors: [],
  targets: [],
  eventTypes: [],
  arcLevels: [],
  causalWeightRange: [0, 1],
  confidenceThreshold: 0,
  searchQuery: '',
}

const notABranch: BaselineGhostState = {
  branch: null,
  baseline: null,
  baselineEvents: [],
  pointOfDivergence: null,
  ghost: undefined,
}

function graph(id: string, name: string, parentGraphId?: string): Graph {
  return {
    id,
    name,
    status: 'active',
    version: 1,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    metadata: { eventCount: 0, arcCount: 0, relationshipCount: 0, pressureCount: 0 },
    parentGraphId,
  }
}

function renderView() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <TimelineView />
      </BrowserRouter>
    </QueryClientProvider>
  )
}

function timelineProps(): TimelineProps & { ghost?: { label: string; events: Event[]; divergence?: Date | null } } {
  if (!mocks.timelineProps.current) throw new Error('Timeline has not rendered')
  return mocks.timelineProps.current as unknown as TimelineProps & {
    ghost?: { label: string; events: Event[]; divergence?: Date | null }
  }
}

function select(ev: Event) {
  act(() => {
    timelineProps().onEventSelect?.(ev)
  })
}

describe('TimelineView: the selected event and why it is there', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.timelineProps.current = null
    mocks.comparisonProps.current = null
    mocks.relationships = [link('r1', 'lloyds', 'wire-ev', 0.55), link('r2', 'wire-ev', 'moltke', 0.6)]
    useGlobalStore.setState({ errors: [], activeFilters: { ...defaultFilters } })
    vi.mocked(useEvents).mockReturnValue({ data: events, isLoading: false, error: null } as ReturnType<typeof useEvents>)
    vi.mocked(useArcs).mockReturnValue({ data: arcs, isLoading: false, error: null } as ReturnType<typeof useArcs>)
    vi.mocked(useBaselineGhost).mockReturnValue(notABranch)
  })

  it('shows confidence, the containing arcs, the source, and the causes and effects', () => {
    renderView()
    select(wire)

    const inspector = screen.getByRole('region', { name: 'Selection inspector' })
    // Confidence on the 0–1 scale, as a measurement.
    const confidence = within(inspector).getByText('0.82')
    expect(confidence).toHaveClass('font-mono-code')
    // The assigned arc, below its parent.
    const arcButtons = within(inspector).getAllByRole('button', { name: /The Calculating Offices|Engines on the Wire/ })
    expect(arcButtons.map((b) => b.textContent)).toEqual(['The Calculating Offices', 'Engines on the Wire'])
    expect(within(inspector).queryByText('(by date)')).not.toBeInTheDocument()
    // Where the record came from.
    expect(within(inspector).getByRole('link', { name: 'Electrical telegraph' })).toHaveAttribute(
      'href',
      'https://en.wikipedia.org/wiki/Electrical_telegraph'
    )
    expect(within(inspector).getByText('Extracted from Wikipedia by an LLM')).toBeInTheDocument()
    // What led to it and what it led to.
    expect(within(within(inspector).getByRole('list', { name: 'Causes' })).getByRole('button')).toHaveTextContent(
      "Lloyd's adopts engine tables"
    )
    expect(within(within(inspector).getByRole('list', { name: 'Effects' })).getByRole('button')).toHaveTextContent(
      'Moltke plans mobilisation by engine'
    )
  })

  it('walks the causal chain: a cause or effect selects that event on the timeline', async () => {
    const user = userEvent.setup()
    renderView()
    select(wire)

    await user.click(screen.getByRole('button', { name: /Moltke plans mobilisation by engine/ }))
    expect(timelineProps().selectedEventId).toBe('moltke')
    const inspector = screen.getByRole('region', { name: 'Selection inspector' })
    expect(within(inspector).getByRole('list', { name: 'Causes' })).toHaveTextContent('Engines linked by telegraph')
    expect(within(inspector).getByText('No recorded effects.')).toBeInTheDocument()
  })

  it('selects an arc from the inspector', async () => {
    const user = userEvent.setup()
    renderView()
    select(wire)
    await user.click(screen.getByRole('button', { name: 'Engines on the Wire' }))
    expect(screen.getByRole('heading', { name: 'Selected arc' })).toBeInTheDocument()
  })

  it('omits what the record does not say, and marks arcs found by date', () => {
    renderView()
    select(lloyds)

    const inspector = screen.getByRole('region', { name: 'Selection inspector' })
    expect(within(inspector).queryByText('Confidence')).not.toBeInTheDocument()
    expect(within(inspector).queryByText('Source')).not.toBeInTheDocument()
    expect(within(inspector).getByText('(by date)')).toBeInTheDocument()
    expect(within(inspector).getByRole('button', { name: 'The Calculating Offices' })).toBeInTheDocument()
    expect(within(inspector).getByText('No recorded causes.')).toBeInTheDocument()
  })

  it('sits beside the canvas card, not inside it, so selecting never re-measures the canvas', () => {
    const { container } = renderView()
    select(wire)
    const inspector = screen.getByRole('region', { name: 'Selection inspector' })
    // Not a card nested inside the timeline's card: its own surface beside it.
    const timelineCard = container.querySelector('h2.sr-only')!.closest('.rounded-lg')!
    expect(timelineCard.contains(inspector)).toBe(false)
    expect(inspector.closest('aside')).toHaveAttribute('aria-label', 'Selection')
    // The actions stay.
    for (const name of ['Edit', 'Assign to arc', 'Branch from this event']) {
      expect(within(inspector).getByRole('button', { name })).toBeInTheDocument()
    }
  })

  it('names the item in a delete confirmation and says how to get it back', async () => {
    const user = userEvent.setup()
    renderView()
    act(() => {
      timelineProps().onEventContextMenu?.(lloyds, { x: 10, y: 10 })
    })
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }))

    const dialog = screen.getByRole('dialog', { name: "Delete “Lloyd's adopts engine tables”?" })
    expect(dialog).toHaveTextContent(/Version history/)
    expect(dialog).toHaveTextContent(/undo this straight afterwards/)
    expect(dialog).not.toHaveTextContent(/cannot be undone/i)
    expect(within(dialog).getByRole('button', { name: 'Delete event' })).toBeInTheDocument()
  })
})

describe('TimelineView on a branch', () => {
  const baseline = graph('engine', 'The Engine Age')
  const branch = graph('clerks', 'The Engine Age — Clerks Prevail', 'engine')
  const ban = event('ban', 'Parliament bans private calculating engines', '1860-07-12T00:00:00.000Z')

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.timelineProps.current = null
    mocks.comparisonProps.current = null
    mocks.relationships = []
    useGlobalStore.setState({ errors: [], activeFilters: { ...defaultFilters } })
    vi.mocked(useEvents).mockReturnValue({ data: [...events, ban], isLoading: false, error: null } as ReturnType<typeof useEvents>)
    vi.mocked(useArcs).mockReturnValue({ data: arcs, isLoading: false, error: null } as ReturnType<typeof useArcs>)
    vi.mocked(useBaselineGhost).mockReturnValue({
      branch,
      baseline,
      baselineEvents: events,
      pointOfDivergence: { timestamp: ban.timestamp, event: ban, type: 'event_added', description: '' },
      ghost: { label: 'Baseline: The Engine Age', events, divergence: new Date(ban.timestamp) },
    })
  })

  it('names its baseline and the point of divergence under the title', () => {
    renderView()
    const line = screen.getByTestId('branch-context')
    expect(line).toHaveTextContent(`Branch of The Engine Age · diverges ${formatHistoricalDate(ban.timestamp)}`)
  })

  it('opens the comparison of this branch against its baseline', async () => {
    const user = userEvent.setup()
    renderView()
    expect(screen.queryByRole('dialog', { name: 'Compare branches' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Compare branches' }))
    expect(screen.getByRole('dialog', { name: 'Compare branches' })).toBeInTheDocument()
    expect(mocks.comparisonProps.current).toMatchObject({
      isOpen: true,
      initialBaselineGraphId: 'engine',
      initialCounterfactualGraphId: 'clerks',
    })
  })

  it('hands the timeline the baseline as a ghost, filtered like the branch', () => {
    useGlobalStore.setState({ activeFilters: { ...defaultFilters, searchQuery: 'engine' } })
    renderView()
    const ghost = timelineProps().ghost
    expect(ghost?.label).toBe('Baseline: The Engine Age')
    expect(ghost?.divergence).toEqual(new Date(ban.timestamp))
    // Every baseline event mentions an engine.
    expect(ghost?.events.map((e) => e.id)).toEqual(['lloyds', 'wire-ev', 'moltke'])

    act(() => {
      useGlobalStore.setState({ activeFilters: { ...defaultFilters, searchQuery: 'Moltke' } })
    })
    expect(timelineProps().ghost?.events.map((e) => e.id)).toEqual(['moltke'])
  })

  it('says so when the branch has not changed anything yet', () => {
    vi.mocked(useBaselineGhost).mockReturnValue({
      branch,
      baseline,
      baselineEvents: events,
      pointOfDivergence: null,
      ghost: { label: 'Baseline: The Engine Age', events, divergence: null },
    })
    renderView()
    expect(screen.getByTestId('branch-context')).toHaveTextContent('Branch of The Engine Age · no changes from it yet')
  })

  it('shows no branch line on a baseline graph', () => {
    vi.mocked(useBaselineGhost).mockReturnValue(notABranch)
    renderView()
    expect(screen.queryByTestId('branch-context')).not.toBeInTheDocument()
    expect(timelineProps().ghost).toBeUndefined()
  })
})
