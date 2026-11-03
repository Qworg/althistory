import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router'
import { TimelineView } from './TimelineView'
import { useEvents } from '@/hooks/useEvents'
import { useArcs } from '@/hooks/useArcs'
import { useGlobalStore } from '@/stores/globalStore'
import { NotificationCenter } from '@/components/notifications/NotificationCenter'
import type { Event, Arc, FilterState } from '@/types'
import type { TimelineProps } from '@/components/timeline/Timeline'

/**
 * Behavioural coverage for the direct-manipulation handlers TimelineView hands
 * to the timeline. Timeline itself is replaced by a probe so these tests
 * exercise TimelineView's validate/persist/surface-error decisions rather than
 * D3 pointer plumbing (owned elsewhere).
 */
const mocks = vi.hoisted(() => ({
  timelineProps: { current: null as TimelineProps | null },
  updateEvent: vi.fn(),
  updateArc: vi.fn(),
  createEvent: vi.fn(),
  deleteEvent: vi.fn(),
  deleteArc: vi.fn(),
}))

vi.mock('@/components/timeline/Timeline', () => ({
  Timeline: (props: TimelineProps) => {
    mocks.timelineProps.current = props
    return <div data-testid="timeline" />
  },
}))

vi.mock('@/hooks/useEvents')
vi.mock('@/hooks/useArcs')

vi.mock('@/hooks/useAPI', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useAPI')>()
  return {
    ...actual,
    useUpdateEvent: () => ({ mutateAsync: mocks.updateEvent, isPending: false }),
    useUpdateArc: () => ({ mutateAsync: mocks.updateArc, isPending: false }),
    useCreateEvent: () => ({ mutateAsync: mocks.createEvent, isPending: false }),
    useDeleteEvent: () => ({ mutateAsync: mocks.deleteEvent, isPending: false }),
    useDeleteArc: () => ({ mutateAsync: mocks.deleteArc, isPending: false }),
    // No server: the inspector's causal links come back empty, not refused.
    useCausalRelationships: () => ({ data: [], isLoading: false, error: null }),
  }
})

type EventsQuery = ReturnType<typeof useEvents>
type ArcsQuery = ReturnType<typeof useArcs>

const eventsResult = (fields: Pick<EventsQuery, 'data' | 'isLoading' | 'error'>): EventsQuery =>
  fields as EventsQuery
const arcsResult = (fields: Pick<ArcsQuery, 'data' | 'isLoading' | 'error'>): ArcsQuery =>
  fields as ArcsQuery

const normanArc: Arc = {
  id: 'a1',
  name: 'Norman Conquest',
  description: 'William takes England',
  start_time: '1066-09-01T00:00:00.000Z',
  end_time: '1067-01-01T00:00:00.000Z',
  level: 0,
  parent_arc_id: null,
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:00:00.000Z',
}

const successionArc: Arc = {
  id: 'a2',
  name: 'Succession Crisis',
  description: 'Contest for the throne',
  start_time: '1064-01-01T00:00:00.000Z',
  end_time: '1065-01-01T00:00:00.000Z',
  level: 1,
  parent_arc_id: 'a1',
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:00:00.000Z',
}

const events: Event[] = [
  {
    id: 'e1',
    description: 'Battle of Hastings',
    actor: 'William',
    target: 'Harold',
    timestamp: '1066-10-14T09:00:00.000Z',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'e2',
    description: 'Coronation ceremony',
    actor: 'William',
    target: 'Church',
    timestamp: '1066-12-25T12:00:00.000Z',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'e3',
    description: 'Harold sworn oath',
    actor: 'Harold',
    target: 'William',
    timestamp: '1064-01-10T08:00:00.000Z',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
  },
]

const arcs: Arc[] = [normanArc, successionArc]

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

function renderView() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <TimelineView />
        <NotificationCenter />
      </BrowserRouter>
    </QueryClientProvider>
  )
}

function currentTimelineProps(): TimelineProps {
  const props = mocks.timelineProps.current
  if (!props) throw new Error('Timeline has not rendered')
  return props
}

describe('TimelineView direct-manipulation handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.timelineProps.current = null
    mocks.updateEvent.mockResolvedValue(undefined)
    mocks.updateArc.mockResolvedValue(undefined)
    // useCreateEvent resolves to an offline-aware outcome, not the bare event.
    mocks.createEvent.mockResolvedValue({ delivery: 'sent', value: { id: 'created', description: 'A new battle', actor: 'Someone', target: 'Somewhere', timestamp: '2020-06-01T10:00:00.000Z', created_at: '', updated_at: '' } })
    useGlobalStore.setState({ errors: [], activeFilters: { ...defaultFilters } })
    vi.mocked(useEvents).mockReturnValue(
      eventsResult({ data: events, isLoading: false, error: null })
    )
    vi.mocked(useArcs).mockReturnValue(
      arcsResult({ data: arcs, isLoading: false, error: null })
    )
  })

  it('persists the new timestamp when an event is dragged within its arc', async () => {
    renderView()

    await act(async () => {
      await currentTimelineProps().onEventDrag?.(
        events[0]!,
        new Date('1066-11-01T00:00:00.000Z')
      )
    })

    expect(mocks.updateEvent).toHaveBeenCalledTimes(1)
    expect(mocks.updateEvent).toHaveBeenCalledWith({
      id: 'e1',
      data: { timestamp: '1066-11-01T00:00:00.000Z' },
    })
    expect(useGlobalStore.getState().errors).toHaveLength(0)
  })

  it('rejects an out-of-bounds drag with a visible validation error instead of writing', async () => {
    renderView()

    await act(async () => {
      await currentTimelineProps().onEventDrag?.(
        events[0]!,
        new Date('1068-06-01T00:00:00.000Z')
      )
    })

    expect(mocks.updateEvent).not.toHaveBeenCalled()
    expect(
      await screen.findByText(/outside its containing arc "Norman Conquest"/)
    ).toBeInTheDocument()
    expect(useGlobalStore.getState().errors[0]?.type).toBe('validation')
  })

  it('surfaces a failed retime request to the user', async () => {
    mocks.updateEvent.mockRejectedValueOnce(new Error('server exploded'))
    renderView()

    await act(async () => {
      await currentTimelineProps().onEventDrag?.(
        events[0]!,
        new Date('1066-11-01T00:00:00.000Z')
      )
    })

    expect(await screen.findByText(/Failed to move "Battle of Hastings": server exploded/)).toBeInTheDocument()
    expect(useGlobalStore.getState().errors[0]?.type).toBe('network')
  })

  it('persists new bounds when an arc is resized around its contained events', async () => {
    renderView()

    await act(async () => {
      await currentTimelineProps().onArcResize?.(normanArc, {
        start: new Date('1066-09-01T00:00:00.000Z'),
        end: new Date('1067-06-01T00:00:00.000Z'),
      })
    })

    expect(mocks.updateArc).toHaveBeenCalledTimes(1)
    expect(mocks.updateArc).toHaveBeenCalledWith({
      id: 'a1',
      data: {
        start_time: '1066-09-01T00:00:00.000Z',
        end_time: '1067-06-01T00:00:00.000Z',
      },
    })
  })

  it('rejects an arc resize that would drop a contained event', async () => {
    renderView()

    await act(async () => {
      await currentTimelineProps().onArcResize?.(normanArc, {
        start: new Date('1066-12-26T00:00:00.000Z'),
        end: new Date('1067-01-01T00:00:00.000Z'),
      })
    })

    expect(mocks.updateArc).not.toHaveBeenCalled()
    expect(
      await screen.findByText(/Cannot shrink "Norman Conquest": 2 contained events/)
    ).toBeInTheDocument()
    expect(useGlobalStore.getState().errors[0]?.type).toBe('validation')
  })

  // Expansion state lives in Timeline (it decides which descendants enter the
  // rendered hierarchy), not in this view. The rendered behaviour -- toggling
  // an arc's disclosure adds/removes its descendants in the DOM -- is covered
  // against the real component in TimelineInteractionA.test.tsx. What this view
  // owns is the resize constraint: the hierarchy must survive the new bounds.
  const containedChild: Arc = {
    id: 'a3',
    name: 'Contained Child',
    description: 'Sits inside the Norman Conquest window',
    start_time: '1066-10-01T00:00:00.000Z',
    end_time: '1066-11-01T00:00:00.000Z',
    level: 1,
    parent_arc_id: 'a1',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
  }

  it('rejects a shrink that would leave a child arc outside its parent, naming the child', async () => {
    vi.mocked(useArcs).mockReturnValue(
      arcsResult({ data: [normanArc, containedChild], isLoading: false, error: null })
    )
    renderView()

    await act(async () => {
      await currentTimelineProps().onArcResize?.(normanArc, {
        start: new Date('1066-10-05T00:00:00.000Z'),
        end: new Date('1067-01-01T00:00:00.000Z'),
      })
    })

    expect(mocks.updateArc).not.toHaveBeenCalled()
    expect(
      await screen.findByText(
        /Cannot resize "Norman Conquest": it would no longer contain child arc "Contained Child"/
      )
    ).toBeInTheDocument()
    expect(useGlobalStore.getState().errors[0]?.type).toBe('validation')
  })

  it('rejects a child resize that would extend outside its parent, naming the parent', async () => {
    vi.mocked(useArcs).mockReturnValue(
      arcsResult({ data: [normanArc, containedChild], isLoading: false, error: null })
    )
    renderView()

    await act(async () => {
      await currentTimelineProps().onArcResize?.(containedChild, {
        start: new Date('1066-08-01T00:00:00.000Z'),
        end: new Date('1066-11-01T00:00:00.000Z'),
      })
    })

    expect(mocks.updateArc).not.toHaveBeenCalled()
    expect(
      await screen.findByText(
        /Cannot resize "Contained Child": it would extend outside its parent arc "Norman Conquest"/
      )
    ).toBeInTheDocument()
    expect(useGlobalStore.getState().errors[0]?.type).toBe('validation')
  })

  it('opens the create flow prefilled with the double-clicked timestamp and creates on save', async () => {
    const user = userEvent.setup()
    renderView()

    await act(async () => {
      currentTimelineProps().onEventCreate?.(new Date('2020-06-01T10:00:00.000Z'))
    })

    expect(screen.getByRole('heading', { name: /create event/i })).toBeInTheDocument()
    const timestampInput = screen.getByLabelText(/^date/i) as HTMLInputElement
    expect(timestampInput.value).not.toBe('')

    await user.type(screen.getByLabelText(/description/i), 'A new battle')
    await user.type(screen.getByLabelText(/^actor/i), 'Someone')
    await user.type(screen.getByLabelText(/^target/i), 'Somewhere')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(mocks.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({ timestamp: '2020-06-01T10:00:00.000Z' })
      )
    })
  })

  it('surfaces a failed create request to the user', async () => {
    const user = userEvent.setup()
    mocks.createEvent.mockRejectedValueOnce(new Error('create failed'))
    renderView()

    await act(async () => {
      currentTimelineProps().onEventCreate?.(new Date('2020-06-01T10:00:00.000Z'))
    })

    await user.type(screen.getByLabelText(/description/i), 'A new battle')
    await user.type(screen.getByLabelText(/^actor/i), 'Someone')
    await user.type(screen.getByLabelText(/^target/i), 'Somewhere')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(await screen.findByText(/Failed to create event: create failed/)).toBeInTheDocument()
  })

  describe('undo and redo', () => {
    it('undoes a drag with Ctrl+Z by writing the original time back, then redoes it', async () => {
      renderView()

      await act(async () => {
        await currentTimelineProps().onEventDrag?.(events[0]!, new Date('1066-11-01T00:00:00.000Z'))
      })
      expect(screen.getByText(/^Moved "Battle of Hastings" to/)).toHaveAttribute('role', 'status')

      mocks.updateEvent.mockClear()
      await act(async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))
      })
      await waitFor(() =>
        expect(mocks.updateEvent).toHaveBeenCalledWith({
          id: 'e1',
          data: { timestamp: '1066-10-14T09:00:00.000Z' },
        })
      )
      expect(screen.getByText(/^Undone: moved "Battle of Hastings"/)).toBeInTheDocument()

      mocks.updateEvent.mockClear()
      await act(async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }))
      })
      await waitFor(() =>
        expect(mocks.updateEvent).toHaveBeenCalledWith({
          id: 'e1',
          data: { timestamp: '1066-11-01T00:00:00.000Z' },
        })
      )
    })

    it('undoes an arc resize from the Undo button', async () => {
      const user = userEvent.setup()
      renderView()

      await act(async () => {
        await currentTimelineProps().onArcResize?.(normanArc, {
          start: new Date('1066-08-01T00:00:00.000Z'),
          end: new Date('1067-01-01T00:00:00.000Z'),
        })
      })
      mocks.updateArc.mockClear()

      await user.click(screen.getByRole('button', { name: /^undo/i }))

      await waitFor(() =>
        expect(mocks.updateArc).toHaveBeenCalledWith({
          id: 'a1',
          data: { start_time: normanArc.start_time, end_time: normanArc.end_time },
        })
      )
      expect(screen.getByRole('button', { name: /^undo/i })).toBeDisabled()
      expect(screen.getByRole('button', { name: /^redo/i })).toBeEnabled()
    })

    it('records nothing for a refused drag, so there is nothing to undo', async () => {
      renderView()

      await act(async () => {
        await currentTimelineProps().onEventDrag?.(events[0]!, new Date('1068-06-01T00:00:00.000Z'))
      })

      expect(screen.queryByRole('button', { name: /^undo/i })).not.toBeInTheDocument()
    })

    it('hands the timeline the same guardrails, phrased for the live preview', () => {
      renderView()
      const props = currentTimelineProps()

      expect(props.getEventDragViolation?.(events[0]!, new Date('1066-11-01T00:00:00.000Z'))).toBeNull()
      expect(props.getEventDragViolation?.(events[0]!, new Date('1068-06-01T00:00:00.000Z'))).toMatch(
        /^Will be refused: outside its containing arc "Norman Conquest"/
      )
      expect(
        props.getArcResizeViolation?.(normanArc, {
          start: new Date('1066-11-01T00:00:00.000Z'),
          end: new Date('1067-01-01T00:00:00.000Z'),
        })
      ).toMatch(/contained events? would fall outside/)
    })
  })

  it('sizes the canvas to the card even when data was still loading at mount', async () => {
    // The card (and its ref) only renders after loading; the measurement has
    // to attach then, or the canvas keeps its 800px default and overflows.
    const rect = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({ width: 700, height: 400, top: 0, left: 0, right: 700, bottom: 400, x: 0, y: 0, toJSON: () => ({}) })
    vi.mocked(useEvents).mockReturnValue(eventsResult({ data: undefined, isLoading: true, error: null }))
    // The card's padding (24px a side) is read from its computed style
    const realStyle = window.getComputedStyle
    const style = vi.spyOn(window, 'getComputedStyle').mockImplementation(
      (el, pseudo) => Object.assign(realStyle(el, pseudo), { paddingLeft: '24px', paddingRight: '24px' })
    )

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const tree = (
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <TimelineView />
        </BrowserRouter>
      </QueryClientProvider>
    )
    const { rerender } = render(tree)
    expect(mocks.timelineProps.current).toBeNull()

    vi.mocked(useEvents).mockReturnValue(eventsResult({ data: events, isLoading: false, error: null }))
    rerender(tree)

    // 700px card minus its 24px padding on each side
    await waitFor(() => expect(currentTimelineProps().width).toBe(652))
    rect.mockRestore()
    style.mockRestore()
  })

  it('opens "Branch from this event" from the inspector with the point of divergence filled in', async () => {
    const user = userEvent.setup()
    renderView()

    act(() => {
      currentTimelineProps().onEventSelect?.(events[0]!)
    })
    await user.click(screen.getByRole('button', { name: 'Branch from this event' }))

    const dialog = await screen.findByRole('dialog', { name: /branch from this event/i })
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByRole('region', { name: /point of divergence/i })).toHaveTextContent('Battle of Hastings')
    expect((within(dialog).getByLabelText(/branch name/i) as HTMLInputElement).value).toMatch(/what if: Battle of Hastings/)
  })
})
