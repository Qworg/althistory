import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import * as d3 from 'd3'
import { Timeline } from './Timeline'
import type { Event, Arc } from '@/types'

// --- d3 mock -------------------------------------------------------------
// Keep the real scaleTime (so d3 invert is genuinely exercised) but replace the
// zoom/select surface with spies we can inspect. The real zoom behaviour is
// captured so its filter can be asserted.
const d3Control = vi.hoisted(() => ({
  filter: null as
    | ((event: { target: EventTarget | null; type: string; ctrlKey?: boolean; button?: number }) => boolean)
    | null,
  selectionOn: [] as unknown[][],
  zoomConstructed: false
}))

vi.mock('d3', async importOriginal => {
  const actual = await importOriginal<typeof import('d3')>()
  const selection = {
    call: () => selection,
    on: (...args: unknown[]) => {
      d3Control.selectionOn.push(args)
      return selection
    },
    transition: () => selection,
    duration: () => selection,
    style: () => selection,
    property: () => selection,
    attr: () => selection
  }
  const zoom = {
    scaleExtent: () => zoom,
    translateExtent: () => zoom,
    extent: () => zoom,
    on: () => zoom,
    transform: () => zoom,
    filter: (
      fn: (event: { target: EventTarget | null; type: string; ctrlKey?: boolean; button?: number }) => boolean
    ) => {
      d3Control.filter = fn
      return zoom
    }
  }
  return {
    ...actual,
    select: () => selection,
    zoom: () => {
      d3Control.zoomConstructed = true
      return zoom
    }
  }
})

// Fixed domain so expected timestamps are deterministic. The returned xDomain
// must be a stable reference (see EventInteraction.test.tsx).
vi.mock('@/hooks/useTimelineScales', () => {
  const xDomain: [Date, Date] = [new Date('2024-01-01T00:00:00Z'), new Date('2024-01-05T00:00:00Z')]
  const innerWidth = 728
  const innerHeight = 344
  return {
    useTimelineScales: () => ({ innerWidth, innerHeight, xDomain })
  }
})

const MARGIN_LEFT = 56

const frames: FrameRequestCallback[] = []

/** Move the pointer and run the frame the preview scheduled. */
function moveTo(clientX: number) {
  fireEvent.mouseMove(window, { clientX })
  act(() => {
    frames.splice(0).forEach(cb => cb(0))
  })
}
const SCALE = () =>
  d3
    .scaleTime()
    .domain([new Date('2024-01-01T00:00:00Z'), new Date('2024-01-05T00:00:00Z')])
    .range([0, 728])

const expectedDateAtClientX = (clientX: number): Date => SCALE().invert(clientX - MARGIN_LEFT)

const makeEvent = (id: string, timestamp: string): Event => ({
  id,
  description: `Event ${id}`,
  actor: 'Actor',
  target: 'Target',
  timestamp,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z'
})

const events: Event[] = [
  makeEvent('e1', '2024-01-01T00:00:00Z'),
  makeEvent('e2', '2024-01-05T00:00:00Z')
]

const parentArc: Arc = {
  id: 'parent',
  name: 'Parent Arc',
  description: 'parent',
  start_time: '2024-01-01T00:00:00Z',
  end_time: '2024-01-05T00:00:00Z',
  level: 0,
  parent_arc_id: null,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z'
}

beforeEach(() => {
  vi.clearAllMocks()
  // Queue animation frames like a browser does; moveTo() flushes them.
  frames.length = 0
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.push(cb)
    return frames.length
  })
  vi.stubGlobal('cancelAnimationFrame', () => {
    frames.length = 0
  })
  d3Control.filter = null
  d3Control.selectionOn.length = 0
  d3Control.zoomConstructed = false

  // jsdom does not implement these SVG geometry helpers.
  Object.defineProperty(SVGElement.prototype, 'getScreenCTM', {
    configurable: true,
    writable: true,
    value: () => ({ inverse: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) })
  })
  Object.defineProperty(SVGElement.prototype, 'createSVGPoint', {
    configurable: true,
    writable: true,
    value: () => {
      const point = {
        x: 0,
        y: 0,
        matrixTransform: () => ({ x: point.x, y: point.y })
      }
      return point
    }
  })
})

/**
 * The live drag preview (ghost mark + date readout + guardrail warning before
 * release), Escape-to-cancel, and the collision-free event labels.
 */
describe('Timeline drag preview', () => {
  const eventMark = (id: string) =>
    document.querySelector(`[data-event-id="${id}"]`) as Element

  it('shows a ghost and the target date while dragging, and clears both on release', () => {
    const onEventDrag = vi.fn()
    render(<Timeline events={events} arcs={[]} onEventDrag={onEventDrag} width={800} height={400} />)

    fireEvent.mouseDown(eventMark('e1'), { button: 0, clientX: 56 })
    expect(screen.queryByTestId('timeline-drag-preview')).not.toBeInTheDocument()

    moveTo(420)
    expect(screen.getByTestId('timeline-drag-preview')).toBeInTheDocument()
    const readout = screen.getByTestId('timeline-drag-readout')
    expect(readout).toHaveTextContent(/Move to/)
    expect(readout).toHaveTextContent(/Release to save · Esc to cancel/)
    // The date shown is the one the drop will write
    expect(onEventDrag).not.toHaveBeenCalled()

    fireEvent.mouseUp(window, { clientX: 420 })
    expect(onEventDrag).toHaveBeenCalledTimes(1)
    const [, written] = onEventDrag.mock.calls[0] as [Event, Date]
    expect(written.getTime()).toBe(expectedDateAtClientX(420).getTime())
    expect(screen.queryByTestId('timeline-drag-preview')).not.toBeInTheDocument()
    expect(screen.queryByTestId('timeline-drag-readout')).not.toBeInTheDocument()
  })

  it('warns on the preview, before release, when the drop would be refused', () => {
    const getEventDragViolation = vi.fn((_e: Event, ts: Date) =>
      ts.getTime() > new Date('2024-01-03T00:00:00Z').getTime() ? 'Will be refused: outside its containing arc "Parent Arc"' : null
    )
    render(
      <Timeline events={events} arcs={[]} onEventDrag={vi.fn()} getEventDragViolation={getEventDragViolation} width={800} height={400} />
    )

    fireEvent.mouseDown(eventMark('e1'), { button: 0, clientX: 56 })
    moveTo(150)
    expect(screen.getByTestId('timeline-drag-preview')).not.toHaveAttribute('data-invalid')

    moveTo(700)
    expect(screen.getByTestId('timeline-drag-preview')).toHaveAttribute('data-invalid', 'true')
    expect(screen.getByTestId('timeline-drag-readout')).toHaveTextContent(/outside its containing arc "Parent Arc"/)
    fireEvent.mouseUp(window, { clientX: 700 })
  })

  it('cancels on Escape without saving, and without the Escape reaching document listeners', () => {
    const onEventDrag = vi.fn()
    const documentEscape = vi.fn()
    document.addEventListener('keydown', documentEscape)
    render(<Timeline events={events} arcs={[]} onEventDrag={onEventDrag} width={800} height={400} />)

    fireEvent.mouseDown(eventMark('e1'), { button: 0, clientX: 56 })
    moveTo(420)
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.queryByTestId('timeline-drag-preview')).not.toBeInTheDocument()
    expect(eventMark('e1').getAttribute('style') ?? '').not.toMatch(/drop-shadow/)

    // The mouseup that follows belongs to an abandoned gesture
    fireEvent.mouseUp(window, { clientX: 420 })
    expect(onEventDrag).not.toHaveBeenCalled()
    expect(documentEscape).not.toHaveBeenCalled()
    document.removeEventListener('keydown', documentEscape)
  })

  it('previews an arc edge resize with the new bounds', () => {
    render(<Timeline events={[]} arcs={[parentArc]} onArcResize={vi.fn()} width={800} height={400} />)
    const handle = document.querySelector('[data-arc-id="parent"] [data-resize-edge="end"]') as Element

    fireEvent.mouseDown(handle, { button: 0, clientX: 784 })
    moveTo(500)

    expect(screen.getByTestId('timeline-drag-preview').querySelector('rect')).toBeInTheDocument()
    expect(screen.getByTestId('timeline-drag-readout')).toHaveTextContent(/End →/)
    fireEvent.mouseUp(window, { clientX: 500 })
  })
})

describe('Timeline event labels', () => {
  it('labels unselected events that have room', () => {
    render(<Timeline events={events} arcs={[]} width={800} height={400} />)

    const first = document.querySelector('[data-event-id="e1"]') as HTMLElement
    const last = document.querySelector('[data-event-id="e2"]') as HTMLElement
    expect(within(first).getByText('Event e1')).toHaveClass('event-label')
    expect(within(last).getByText('Event e2')).toBeInTheDocument()
  })

  it('drops labels that would collide rather than overprinting them', () => {
    // Twelve events a few pixels apart: two rows can hold at most a handful.
    const crowded = Array.from({ length: 12 }, (_, i) =>
      makeEvent(`c${i}`, new Date(Date.UTC(2024, 0, 2, 0, i * 10)).toISOString())
    )
    render(<Timeline events={crowded} arcs={[]} width={800} height={400} />)

    const labels = document.querySelectorAll('.event-label')
    expect(labels.length).toBeGreaterThan(0)
    expect(labels.length).toBeLessThan(crowded.length)
  })

  it('always labels the selected event, even in a crowd', () => {
    const crowded = Array.from({ length: 12 }, (_, i) =>
      makeEvent(`c${i}`, new Date(Date.UTC(2024, 0, 2, 0, i * 10)).toISOString())
    )
    render(<Timeline events={crowded} arcs={[]} selectedEventId="c7" width={800} height={400} />)

    const selected = document.querySelector('[data-event-id="c7"]') as HTMLElement
    expect(within(selected).getByText('Event c7')).toBeInTheDocument()
  })
})
