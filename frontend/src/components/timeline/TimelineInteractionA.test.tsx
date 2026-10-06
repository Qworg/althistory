import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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

const childArc: Arc = {
  id: 'child',
  name: 'Child Arc',
  description: 'child',
  start_time: '2024-01-02T00:00:00Z',
  end_time: '2024-01-03T00:00:00Z',
  level: 1,
  parent_arc_id: 'parent',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z'
}

beforeEach(() => {
  vi.clearAllMocks()
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

describe('Timeline mark interaction behaviour', () => {
  describe('event drag to retime (Req 3.3)', () => {
    it('invokes onEventDrag with the retimed Date derived from the shared scale', () => {
      const onEventDrag = vi.fn()
      render(<Timeline events={events} arcs={[]} onEventDrag={onEventDrag} width={800} height={400} />)

      const mark = document.querySelector('[data-event-id="e1"]')
      expect(mark).toBeInTheDocument()

      fireEvent.mouseDown(mark!, { button: 0, clientX: 56 })
      fireEvent.mouseMove(window, { clientX: 420 })
      fireEvent.mouseUp(window, { clientX: 420 })

      expect(onEventDrag).toHaveBeenCalledTimes(1)
      const [draggedEvent, newTimestamp] = onEventDrag.mock.calls[0] as [Event, Date]
      expect(draggedEvent.id).toBe('e1')
      expect(newTimestamp).toBeInstanceOf(Date)
      expect(newTimestamp.getTime()).toBe(expectedDateAtClientX(420).getTime())
    })

    it('does NOT invoke onEventDrag for a plain click (no pointer travel)', () => {
      const onEventDrag = vi.fn()
      render(<Timeline events={events} arcs={[]} onEventDrag={onEventDrag} width={800} height={400} />)

      const mark = document.querySelector('[data-event-id="e1"]')
      fireEvent.mouseDown(mark!, { button: 0, clientX: 200 })
      fireEvent.mouseUp(mark!, { button: 0, clientX: 200 })

      expect(onEventDrag).not.toHaveBeenCalled()
    })

    it('does not invoke onEventDrag spuriously on re-render', () => {
      const onEventDrag = vi.fn()
      const { rerender } = render(
        <Timeline events={events} arcs={[]} onEventDrag={onEventDrag} width={800} height={400} />
      )
      rerender(<Timeline events={events} arcs={[]} onEventDrag={onEventDrag} width={800} height={400} />)
      expect(onEventDrag).not.toHaveBeenCalled()
    })
  })

  describe('arc expand/collapse (Req 2.3)', () => {
    it('toggles expansion, renders children, and calls expand then collapse', () => {
      const onArcExpand = vi.fn()
      const onArcCollapse = vi.fn()
      render(
        <Timeline
          events={[]}
          arcs={[parentArc, childArc]}
          onArcExpand={onArcExpand}
          onArcCollapse={onArcCollapse}
          width={800}
          height={400}
        />
      )

      // Collapsed by default: the child is not in the hierarchy.
      expect(document.querySelector('[data-arc-id="child"]')).not.toBeInTheDocument()

      const toggle = document.querySelector('[data-arc-toggle="parent"]')
      expect(toggle).toBeInTheDocument()
      expect(toggle).toHaveAttribute('aria-label', 'Expand arc Parent Arc')

      fireEvent.click(toggle!)

      expect(onArcExpand).toHaveBeenCalledTimes(1)
      expect(onArcExpand).toHaveBeenCalledWith(expect.objectContaining({ id: 'parent' }))
      expect(onArcCollapse).not.toHaveBeenCalled()
      expect(document.querySelector('[data-arc-id="child"]')).toBeInTheDocument()
      expect(toggle).toHaveAttribute('aria-label', 'Collapse arc Parent Arc')

      fireEvent.click(toggle!)

      expect(onArcCollapse).toHaveBeenCalledTimes(1)
      expect(onArcCollapse).toHaveBeenCalledWith(expect.objectContaining({ id: 'parent' }))
      expect(document.querySelector('[data-arc-id="child"]')).not.toBeInTheDocument()
    })

    it('supports keyboard toggle (Enter)', () => {
      const onArcExpand = vi.fn()
      render(
        <Timeline events={[]} arcs={[parentArc, childArc]} onArcExpand={onArcExpand} width={800} height={400} />
      )

      const toggle = document.querySelector('[data-arc-toggle="parent"]')
      fireEvent.keyDown(toggle!, { key: 'Enter' })

      expect(onArcExpand).toHaveBeenCalledWith(expect.objectContaining({ id: 'parent' }))
    })
  })

  describe('arc resize (Req 4.3)', () => {
    it('invokes onArcResize with new bounds from a start-edge drag', () => {
      const onArcResize = vi.fn()
      render(<Timeline events={[]} arcs={[parentArc]} onArcResize={onArcResize} width={800} height={400} />)

      const handle = document.querySelector('[data-arc-id="parent"] [data-resize-edge="start"]')
      expect(handle).toBeInTheDocument()
      expect(handle).toHaveAttribute('aria-label', 'Resize start of arc Parent Arc')

      fireEvent.mouseDown(handle!, { button: 0, clientX: 56 })
      fireEvent.mouseMove(window, { clientX: 420 })
      fireEvent.mouseUp(window, { clientX: 420 })

      expect(onArcResize).toHaveBeenCalledTimes(1)
      const [arc, bounds] = onArcResize.mock.calls[0] as [Arc, { start: Date; end: Date }]
      expect(arc.id).toBe('parent')
      expect(bounds.start.getTime()).toBe(expectedDateAtClientX(420).getTime())
      expect(bounds.start.getTime()).toBeLessThanOrEqual(bounds.end.getTime())
    })

    it('keeps start <= end when dragging the start edge past the end', () => {
      const onArcResize = vi.fn()
      render(<Timeline events={[]} arcs={[parentArc]} onArcResize={onArcResize} width={800} height={400} />)

      const handle = document.querySelector('[data-arc-id="parent"] [data-resize-edge="start"]')
      fireEvent.mouseDown(handle!, { button: 0, clientX: 56 })
      fireEvent.mouseMove(window, { clientX: 2000 })
      fireEvent.mouseUp(window, { clientX: 2000 })

      const [, bounds] = onArcResize.mock.calls[0] as [Arc, { start: Date; end: Date }]
      expect(bounds.start.getTime()).toBeLessThanOrEqual(bounds.end.getTime())
    })

    it('resizes via keyboard and keeps start <= end', () => {
      const onArcResize = vi.fn()
      render(<Timeline events={[]} arcs={[parentArc]} onArcResize={onArcResize} width={800} height={400} />)

      const handle = document.querySelector('[data-arc-id="parent"] [data-resize-edge="start"]')
      fireEvent.keyDown(handle!, { key: 'ArrowRight' })

      expect(onArcResize).toHaveBeenCalledTimes(1)
      const [, bounds] = onArcResize.mock.calls[0] as [Arc, { start: Date; end: Date }]
      expect(bounds.start.getTime()).toBeGreaterThan(new Date(parentArc.start_time).getTime())
      expect(bounds.start.getTime()).toBeLessThanOrEqual(bounds.end.getTime())
    })

    it('does not resize for a plain click without travel', () => {
      const onArcResize = vi.fn()
      render(<Timeline events={[]} arcs={[parentArc]} onArcResize={onArcResize} width={800} height={400} />)

      const handle = document.querySelector('[data-arc-id="parent"] [data-resize-edge="start"]')
      fireEvent.mouseDown(handle!, { button: 0, clientX: 56 })
      fireEvent.mouseUp(window, { clientX: 56 })

      expect(onArcResize).not.toHaveBeenCalled()
    })
  })

  describe('hover tooltip (Req 2.3)', () => {
    it('shows an event tooltip on hover and clears it on leave', () => {
      render(<Timeline events={events} arcs={[]} width={800} height={400} />)
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

      const mark = document.querySelector('[data-event-id="e1"]')
      fireEvent.mouseEnter(mark!)

      const tooltip = screen.getByRole('tooltip')
      expect(tooltip).toHaveTextContent('Event e1')
      expect(tooltip).toHaveTextContent('Actor')
      expect(tooltip).toHaveTextContent('Target')

      fireEvent.mouseLeave(mark!)
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    })

    it('shows an arc tooltip with name and date range on hover', () => {
      render(<Timeline events={[]} arcs={[parentArc]} width={800} height={400} />)
      const arcGroup = document.querySelector('[data-arc-id="parent"]')
      fireEvent.mouseEnter(arcGroup!)

      const tooltip = screen.getByRole('tooltip')
      expect(tooltip).toHaveTextContent('Parent Arc')
      expect(tooltip.textContent).toMatch(/2024/)

      fireEvent.mouseLeave(arcGroup!)
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    })
  })

  describe('double-click create (Req 3.1)', () => {
    it('prefills the timestamp from the pointer position on a background double-click', () => {
      const onEventCreate = vi.fn()
      render(<Timeline events={events} arcs={[]} onEventCreate={onEventCreate} width={800} height={400} />)

      const svg = document.querySelector('svg')
      fireEvent.doubleClick(svg!, { clientX: 420, clientY: 200 })

      expect(onEventCreate).toHaveBeenCalledTimes(1)
      const created = onEventCreate.mock.calls[0]?.[0] as Date
      expect(created).toBeInstanceOf(Date)
      expect(created.getTime()).toBe(expectedDateAtClientX(420).getTime())
    })

    it('does not create when double-clicking a mark', () => {
      const onEventCreate = vi.fn()
      render(<Timeline events={events} arcs={[]} onEventCreate={onEventCreate} width={800} height={400} />)

      const mark = document.querySelector('[data-event-id="e1"]')
      fireEvent.doubleClick(mark!, { clientX: 420, clientY: 200 })

      expect(onEventCreate).not.toHaveBeenCalled()
    })
  })

  describe('zoom/pan coexistence', () => {
    it('attaches zoom and excludes timeline marks from d3 gestures', () => {
      render(<Timeline events={events} arcs={[parentArc]} width={800} height={400} />)

      expect(d3Control.zoomConstructed).toBe(true)
      expect(d3Control.filter).toBeTypeOf('function')

      const filter = d3Control.filter
      if (!filter) throw new Error('zoom filter was not registered')

      const mark = document.querySelector('[data-event-id="e1"]')
      const arcGroup = document.querySelector('[data-arc-id="parent"]')
      const svg = document.querySelector('svg')

      // A mousedown on a mark must not be claimed by d3 zoom...
      expect(filter({ target: mark, type: 'mousedown', button: 0, ctrlKey: false })).toBe(false)
      expect(filter({ target: arcGroup, type: 'mousedown', button: 0, ctrlKey: false })).toBe(false)
      // ...but the background must still pan.
      expect(filter({ target: svg, type: 'mousedown', button: 0, ctrlKey: false })).toBe(true)
      // Wheel-zoom over a mark is still permitted.
      expect(filter({ target: mark, type: 'wheel', button: 0, ctrlKey: true })).toBe(true)
    })

    it('removes d3 double-click zoom so double-click is free for event creation', () => {
      render(<Timeline events={events} arcs={[]} width={800} height={400} />)

      expect(d3Control.selectionOn).toEqual(expect.arrayContaining([['dblclick.zoom', null]]))
    })
  })
})
