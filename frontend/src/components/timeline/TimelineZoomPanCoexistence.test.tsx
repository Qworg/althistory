import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render } from '@testing-library/react'
import { Timeline } from './Timeline'
import type { Event, TimeRange } from '@/types'

/**
 * Zoom/pan coexistence against the REAL d3-zoom.
 *
 * TimelineInteractionA.test.tsx replaces d3.select/d3.zoom with spies, so its
 * zoom tests can only assert the return value of our filter function and the
 * arguments passed to a mocked `.on()` -- neither proves that a mark drag fails
 * to pan the view. This file deliberately does not mock d3: the marks and the
 * zoom behaviour are wired up by the real library, and a pan is observed
 * through `onTimeRangeChange` (the zoom handler is the only place that reports
 * a shifted domain after mount).
 *
 * Panning is only allowed once the view is zoomed in: Timeline pins
 * translateExtent to the viewport, so at k = 1 a pan is clamped to zero. Each
 * test therefore zooms in first, which is exactly when a stray pan would move
 * the view.
 */

vi.mock('@/hooks/useTimelineScales', () => {
  const xDomain: [Date, Date] = [new Date('2024-01-01T00:00:00Z'), new Date('2024-01-05T00:00:00Z')]
  const innerWidth = 728
  const innerHeight = 344
  return {
    useTimelineScales: () => ({ innerWidth, innerHeight, xDomain })
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

const events: Event[] = [
  makeEvent('e1', '2024-01-01T00:00:00Z'),
  makeEvent('e2', '2024-01-05T00:00:00Z')
]

/**
 * Dispatches a mouse event that d3-zoom will accept as coming from the window.
 *
 * jsdom's `Window` here is a proxy that jsdom's own `isWindow` check rejects, so
 * `new MouseEvent(type, { view: window })` throws. Setting `view` as an own
 * property after construction is the supported way to make d3's
 * `select(event.view)` attach its gesture listeners.
 */
function fireWithView(target: Element | Window, type: string, init: MouseEventInit): void {
  const view = document.defaultView
  if (!view) throw new Error('jsdom window is not available')
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init })
  Object.defineProperty(event, 'view', { value: view, configurable: true })
  target.dispatchEvent(event)
}

function requireSvg(): SVGSVGElement {
  const svg = document.querySelector('svg')
  if (!svg) throw new Error('timeline svg was not rendered')
  return svg
}

/** d3-zoom stores the live transform on the node it is bound to. */
function zoomScale(svg: SVGSVGElement): number {
  const host = svg as SVGSVGElement & { __zoom?: { k: number } }
  if (!host.__zoom) throw new Error('d3-zoom transform was not attached')
  return host.__zoom.k
}

/** The most recent visible range reported by the zoom handler. */
function lastReportedDomain(spy: { mock: { calls: unknown[][] } }): TimeRange {
  const calls = spy.mock.calls
  const last = calls[calls.length - 1]
  if (!last) throw new Error('onTimeRangeChange was never called')
  return last[0] as TimeRange
}

/**
 * Zooms the real d3-zoom behaviour in, so a pan is no longer clamped to zero.
 * `deltaY` controls how far: a smaller magnitude zooms less, which keeps more
 * of the timeline inside the virtualisation window.
 */
function zoomIn(deltaY: number = -120): void {
  const svg = requireSvg()
  expect(zoomScale(svg)).toBe(1)
  // The zoom handler updates React state, so flush it before the gesture under
  // test starts.
  act(() => {
    svg.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY,
        clientX: 400,
        clientY: 200,
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      })
    )
  })
  expect(zoomScale(svg)).toBeGreaterThan(1)
}

beforeEach(() => {
  vi.clearAllMocks()
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

describe('real d3-zoom coexistence', () => {
  it('pans on a background drag, which is the premise of the mark exclusion', () => {
    const onTimeRangeChange = vi.fn()
    render(
      <Timeline
        events={events}
        arcs={[]}
        onTimeRangeChange={onTimeRangeChange}
        width={800}
        height={400}
      />
    )

    zoomIn()
    const zoomedDomain = lastReportedDomain(onTimeRangeChange)
    onTimeRangeChange.mockClear()

    const svg = requireSvg()
    const view = document.defaultView
    if (!view) throw new Error('jsdom window is not available')
    act(() => {
      fireWithView(svg, 'mousedown', { button: 0, clientX: 380, clientY: 200 })
      fireWithView(view, 'mousemove', { button: 0, clientX: 300, clientY: 200 })
      fireWithView(view, 'mouseup', { button: 0, clientX: 300, clientY: 200 })
    })

    expect(onTimeRangeChange).toHaveBeenCalled()
    const pannedDomain = lastReportedDomain(onTimeRangeChange)
    expect(pannedDomain.start.getTime()).not.toBe(zoomedDomain.start.getTime())
  })

  it('does not pan when the gesture starts on a mark, and still retimes the event', () => {
    const onTimeRangeChange = vi.fn()
    const onEventDrag = vi.fn()
    render(
      <Timeline
        events={events}
        arcs={[]}
        onTimeRangeChange={onTimeRangeChange}
        onEventDrag={onEventDrag}
        width={800}
        height={400}
      />
    )

    // A gentler wheel delta than the pan test uses: this case needs a mark that
    // is inside the virtualisation window. The window includes half a visible
    // span of overscan, so k ~ 1.32 keeps e1 mounted (the aggressive k ~ 5.28
    // used by the pan test would scroll it out of the window).
    zoomIn(-20)
    onTimeRangeChange.mockClear()

    const mark = document.querySelector('[data-event-id="e1"]')
    if (!mark) throw new Error('event mark was not rendered')
    const view = document.defaultView
    if (!view) throw new Error('jsdom window is not available')

    act(() => {
      fireWithView(mark, 'mousedown', { button: 0, clientX: 380, clientY: 200 })
      fireWithView(view, 'mousemove', { button: 0, clientX: 300, clientY: 200 })
      fireWithView(view, 'mouseup', { button: 0, clientX: 300, clientY: 200 })
    })

    // No zoom transform was applied (a pan would have reported a shifted domain)...
    expect(onTimeRangeChange).not.toHaveBeenCalled()
    // ...and the mark still owned the gesture.
    expect(onEventDrag).toHaveBeenCalledTimes(1)
  })
})
