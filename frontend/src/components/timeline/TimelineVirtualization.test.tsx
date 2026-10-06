import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render } from '@testing-library/react'
import { Timeline } from './Timeline'
import type { Arc, Event } from '@/types'
import type { PressureWithContext } from '@/types/pressure'

/**
 * Virtualisation behaviour for the timeline component.
 *
 * `useTimelineScales` is mocked so each test can pin the visible time domain
 * (the single source of truth the x scale is built from) independently of the
 * dataset. Every render still goes through the real d3 scale and the real
 * Timeline markup, so the asserted node counts are the real DOM.
 *
 * KNOW WHAT THE PINNED DOMAIN DOES AND DOES NOT SHOW: it makes the viewport
 * narrower than the dataset, which production cannot reach from fit-to-view
 * (the extent is derived from the data, so every mark starts on screen). These
 * tests therefore prove that the window is wired to the viewport and culls the
 * marks outside it -- they do NOT show that the mounted count is bounded
 * independently of N. It is not: see TimelineVirtualizationRealZoom.test.tsx,
 * which drives the real d3-zoom to its 20x cap and measures the real
 * relationship (about N/10 marks for a uniform dataset).
 */

const scaleControl = vi.hoisted(() => ({
  domain: 'wide' as 'wide' | 'day'
}))

vi.mock('@/hooks/useTimelineScales', () => {
  const domains: Record<string, [Date, Date]> = {
    // Four days, matching the fixture extent.
    wide: [new Date('2024-01-01T00:00:00Z'), new Date('2024-01-05T00:00:00Z')],
    // One day; with the 0.5 overscan the render window is
    // 2023-12-31T12:00 .. 2024-01-02T12:00.
    day: [new Date('2024-01-01T00:00:00Z'), new Date('2024-01-02T00:00:00Z')]
  }
  return {
    useTimelineScales: () => ({
      innerWidth: 728,
      innerHeight: 344,
      xDomain: domains[scaleControl.domain] ?? domains.wide
    })
  }
})

const makeEvent = (id: string, timestamp: string): Event => ({
  id,
  description: `Event ${id}`,
  actor: 'Actor',
  target: 'Target',
  timestamp,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z'
})

const makeArc = (id: string, start: string, end: string, parent: string | null = null): Arc => ({
  id,
  name: `Arc ${id}`,
  description: `Arc ${id}`,
  start_time: start,
  end_time: end,
  level: parent ? 1 : 0,
  parent_arc_id: parent,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z'
})

/** Events well inside the one-day window. */
const eventsInWindow = (count: number): Event[] =>
  Array.from({ length: count }, (_, i) =>
    makeEvent(`in-${i}`, new Date(Date.UTC(2024, 0, 1, 12, 0, i)).toISOString())
  )

/** Events spread across 2022, far outside any window used by these tests. */
const eventsOutsideWindow = (count: number): Event[] =>
  Array.from({ length: count }, (_, i) =>
    makeEvent(`out-${i}`, new Date(Date.UTC(2022, 0, 1) + i * 60_000).toISOString())
  )

const renderedEventCount = (): number => document.querySelectorAll('[data-event-id]').length
const renderedArcCount = (): number => document.querySelectorAll('[data-arc-id]').length
const renderedPressureIndicatorCount = (): number =>
  document.querySelectorAll('.pressure-indicator').length

/** A pressure whose affected arcs are the arcs handed to it. */
const makePressure = (id: string, affectedArcs: Arc[]): PressureWithContext => ({
  id,
  description: `Pressure ${id}`,
  confidence_score: 0.8,
  pressure_type: 'economic',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  affectedArcs,
  evidenceEvents: [],
  influenceStrength: 0.6,
  isVisible: true,
  isHighlighted: false,
  renderColor: '#10b981',
  renderOpacity: 0.6
})

beforeEach(() => {
  scaleControl.domain = 'wide'
  vi.clearAllMocks()
  // jsdom does not implement these SVG geometry helpers used by d3.
  Object.defineProperty(SVGElement.prototype, 'getScreenCTM', {
    configurable: true,
    writable: true,
    value: () => ({ inverse: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) })
  })
  Object.defineProperty(SVGElement.prototype, 'createSVGPoint', {
    configurable: true,
    writable: true,
    value: () => {
      const point = { x: 0, y: 0, matrixTransform: () => ({ x: point.x, y: point.y }) }
      return point
    }
  })
})

describe('timeline virtualisation: bounded node count', () => {
  it('renders only the events in view when 10,000 events lie outside', () => {
    scaleControl.domain = 'day'
    render(
      <Timeline
        events={[...eventsOutsideWindow(10_000), ...eventsInWindow(5)]}
        arcs={[]}
        width={800}
        height={400}
      />
    )
    // 10,005 events in the data, 5 inside the pinned viewport: the marks outside
    // it are not mounted. This is a statement about culling off-screen marks,
    // not about a bound on N -- see the file comment.
    expect(renderedEventCount()).toBe(5)
    expect(document.querySelector('[data-event-id="in-0"]')).toBeInTheDocument()
    expect(document.querySelector('[data-event-id="out-0"]')).not.toBeInTheDocument()
  })

  it('renders the same count for a much smaller dataset with the same events in view', () => {
    scaleControl.domain = 'day'
    render(
      <Timeline
        events={[...eventsOutsideWindow(100), ...eventsInWindow(5)]}
        arcs={[]}
        width={800}
        height={400}
      />
    )
    // Identical to the 10,000-outside case above: adding off-screen events to
    // the dataset does not add mounted marks.
    expect(renderedEventCount()).toBe(5)
  })

  it('renders only the arcs overlapping the window', () => {
    scaleControl.domain = 'day'
    render(
      <Timeline
        events={[]}
        arcs={[
          makeArc('in', '2024-01-01T06:00:00Z', '2024-01-01T18:00:00Z'),
          ...Array.from({ length: 500 }, (_, i) =>
            makeArc(
              `out-${i}`,
              new Date(Date.UTC(2020, 0, 1) + i * 60_000).toISOString(),
              new Date(Date.UTC(2020, 0, 1) + i * 60_000 + 3_600_000).toISOString()
            )
          )
        ]}
        width={800}
        height={400}
      />
    )
    expect(renderedArcCount()).toBe(1)
    expect(document.querySelector('[data-arc-id="in"]')).toBeInTheDocument()
  })

  it('renders only the pressure indicators for arcs in the window', () => {
    scaleControl.domain = 'wide'
    const inWindowArc = makeArc('in', '2024-01-01T06:00:00Z', '2024-01-01T18:00:00Z')
    const outsideArcs = Array.from({ length: 200 }, (_, i) =>
      makeArc(
        `out-${i}`,
        new Date(Date.UTC(2020, 0, 1) + i * 60_000).toISOString(),
        new Date(Date.UTC(2020, 0, 1) + i * 60_000 + 3_600_000).toISOString()
      )
    )
    const subject = makePressure('p', [inWindowArc, ...outsideArcs])

    render(
      <Timeline
        events={[]}
        arcs={[inWindowArc, ...outsideArcs]}
        pressures={[subject]}
        width={800}
        height={400}
      />
    )

    // PressureIndicators renders one DOM group per (pressure, affected arc)
    // pair, so without a windowing pass of its own this count would be 201
    // however far the view is zoomed in.
    expect(renderedPressureIndicatorCount()).toBe(1)
    expect(
      document.querySelector('.pressure-indicator[data-arc-id="in"]')
    ).toBeInTheDocument()
  })

  it('does not mount a pressure whose arcs are all outside the window', () => {
    scaleControl.domain = 'day'
    const offscreenArc = makeArc('out', '2020-01-01T00:00:00Z', '2020-01-02T00:00:00Z')

    render(
      <Timeline
        events={[]}
        arcs={[offscreenArc]}
        pressures={[makePressure('p', [offscreenArc])]}
        width={800}
        height={400}
      />
    )

    expect(renderedPressureIndicatorCount()).toBe(0)
  })
})

describe('timeline virtualisation: edge cases', () => {
  it('handles an empty dataset', () => {
    scaleControl.domain = 'day'
    render(<Timeline events={[]} arcs={[]} width={800} height={400} />)
    expect(renderedEventCount()).toBe(0)
    expect(renderedArcCount()).toBe(0)
    expect(document.querySelector('svg')).toBeInTheDocument()
  })

  it('renders a single event and keeps it addressable', () => {
    scaleControl.domain = 'day'
    render(
      <Timeline events={[makeEvent('only', '2024-01-01T12:00:00Z')]} arcs={[]} width={800} height={400} />
    )
    expect(renderedEventCount()).toBe(1)
    expect(document.querySelector('[data-event-id="only"]')).toBeInTheDocument()
  })

  it('renders nothing when every event is outside the window', () => {
    scaleControl.domain = 'day'
    render(
      <Timeline
        events={eventsOutsideWindow(50)}
        arcs={[makeArc('far', '2020-01-01T00:00:00Z', '2020-01-02T00:00:00Z')]}
        width={800}
        height={400}
      />
    )
    expect(renderedEventCount()).toBe(0)
    expect(renderedArcCount()).toBe(0)
  })

  it('renders every event when the window covers the whole dataset', () => {
    scaleControl.domain = 'wide'
    const events = [
      makeEvent('a', '2024-01-01T00:00:00Z'),
      makeEvent('b', '2024-01-02T06:00:00Z'),
      makeEvent('c', '2024-01-04T12:00:00Z'),
      makeEvent('d', '2024-01-03T09:00:00Z')
    ]
    render(<Timeline events={events} arcs={[]} width={800} height={400} />)
    // A fully visible dataset degenerates to rendering all of it.
    expect(renderedEventCount()).toBe(events.length)
  })
})

describe('timeline virtualisation: zoom drives the window', () => {
  it('drops the cluster a wheel-zoom scrolls off screen and keeps the visible one', () => {
    scaleControl.domain = 'wide'
    const leftCluster = [
      makeEvent('left-a', '2024-01-01T00:00:00Z'),
      makeEvent('left-b', '2024-01-01T02:00:00Z')
    ]
    const rightCluster = [
      makeEvent('right-a', '2024-01-03T00:00:00Z'),
      makeEvent('right-b', '2024-01-03T02:00:00Z')
    ]
    render(
      <Timeline events={[...leftCluster, ...rightCluster]} arcs={[]} width={800} height={400} />
    )
    expect(renderedEventCount()).toBe(4)

    const svg = document.querySelector('svg')
    if (!svg) throw new Error('timeline svg was not rendered')
    // Ctrl-wheel at the centre applies d3-zoom's pinch multiplier (k ~ 5.28),
    // so the view lands around 2024-01-02T12:46 .. 2024-01-03T06:58 and only
    // the right cluster survives the window.
    act(() => {
      svg.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: -120,
          clientX: 400,
          clientY: 200,
          ctrlKey: true,
          bubbles: true,
          cancelable: true
        })
      )
    })

    expect(renderedEventCount()).toBe(2)
    expect(document.querySelector('[data-event-id="right-a"]')).toBeInTheDocument()
    expect(document.querySelector('[data-event-id="left-a"]')).not.toBeInTheDocument()
  })
})

describe('timeline virtualisation: visible marks stay interactive', () => {
  it('drag-to-retime still fires onEventDrag for an event inside the window', () => {
    scaleControl.domain = 'day'
    const onEventDrag = vi.fn()
    render(
      <Timeline
        events={[makeEvent('draggable', '2024-01-01T12:00:00Z')]}
        arcs={[]}
        onEventDrag={onEventDrag}
        width={800}
        height={400}
      />
    )

    const mark = document.querySelector('[data-event-id="draggable"]')
    if (!mark) throw new Error('event mark was not rendered')
    expect(renderedEventCount()).toBe(1)

    fireEvent.mouseDown(mark, { button: 0, clientX: 420 })
    fireEvent.mouseMove(window, { clientX: 480 })
    fireEvent.mouseUp(window, { clientX: 480 })

    expect(onEventDrag).toHaveBeenCalledTimes(1)
    const [dragged, newTimestamp] = onEventDrag.mock.calls[0] as [Event, Date]
    expect(dragged.id).toBe('draggable')
    expect(newTimestamp).toBeInstanceOf(Date)
    expect(newTimestamp.getTime()).not.toBe(new Date('2024-01-01T12:00:00Z').getTime())
  })

  it('arc resize still fires onArcResize for an arc inside the window', () => {
    scaleControl.domain = 'day'
    const onArcResize = vi.fn()
    render(
      <Timeline
        events={[]}
        arcs={[makeArc('resizable', '2024-01-01T00:00:00Z', '2024-01-01T12:00:00Z')]}
        onArcResize={onArcResize}
        width={800}
        height={400}
      />
    )

    const handle = document.querySelector('[data-arc-id="resizable"] .arc-resize-end')
    if (!handle) throw new Error('arc resize handle was not rendered')

    fireEvent.mouseDown(handle, { button: 0, clientX: 420 })
    fireEvent.mouseMove(window, { clientX: 480 })
    fireEvent.mouseUp(window, { clientX: 480 })

    expect(onArcResize).toHaveBeenCalledTimes(1)
    const [arc, bounds] = onArcResize.mock.calls[0] as [
      Arc,
      { start: Date; end: Date }
    ]
    expect(arc.id).toBe('resizable')
    expect(bounds.end.getTime()).toBeGreaterThan(new Date('2024-01-01T12:00:00Z').getTime())
  })

  it('expand still fires onArcExpand and reveals the child arc inside the window', () => {
    scaleControl.domain = 'day'
    const onArcExpand = vi.fn()
    render(
      <Timeline
        events={[]}
        arcs={[
          makeArc('parent', '2024-01-01T00:00:00Z', '2024-01-01T20:00:00Z'),
          makeArc('child', '2024-01-01T06:00:00Z', '2024-01-01T08:00:00Z', 'parent')
        ]}
        onArcExpand={onArcExpand}
        width={800}
        height={400}
      />
    )

    // Collapsed by default: only the parent is in the hierarchy.
    expect(renderedArcCount()).toBe(1)
    const toggle = document.querySelector('[data-arc-toggle="parent"]')
    if (!toggle) throw new Error('arc toggle was not rendered')

    fireEvent.click(toggle)

    expect(onArcExpand).toHaveBeenCalledTimes(1)
    expect(renderedArcCount()).toBe(2)
    expect(document.querySelector('[data-arc-id="child"]')).toBeInTheDocument()
  })

  it('hover still shows the tooltip for an event inside the window', () => {
    scaleControl.domain = 'day'
    render(
      <Timeline
        events={[makeEvent('hovered', '2024-01-01T12:00:00Z')]}
        arcs={[]}
        width={800}
        height={400}
      />
    )

    const mark = document.querySelector('[data-event-id="hovered"]')
    if (!mark) throw new Error('event mark was not rendered')
    fireEvent.mouseEnter(mark)

    const tooltip = document.querySelector('.timeline-tooltip')
    expect(tooltip).toBeInTheDocument()
    expect(tooltip?.textContent).toContain('Event hovered')
  })
})
