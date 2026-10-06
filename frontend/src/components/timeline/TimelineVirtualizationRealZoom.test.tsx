import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render } from '@testing-library/react'
import { Timeline } from './Timeline'
import type { Event } from '@/types'

/**
 * What windowing actually bounds, measured through the REAL zoom path.
 *
 * TimelineVirtualization.test.tsx pins `useTimelineScales` to a domain narrower
 * than its dataset, which is a useful way to test the filter wiring but cannot
 * happen in production: the extent is derived from the data, so at fit-to-view
 * every mark is genuinely on screen. This file uses the real hook and the real
 * d3-zoom behaviour and drives the viewport with wheel gestures, so the numbers
 * here are the ones the component produces for real datasets.
 *
 * The headline these tests exist to pin down: windowing culls OFF-SCREEN marks.
 * It does not bound the mounted count independently of N. Timeline clamps
 * d3-zoom at 20x while the window is `1 + 2 * overscan = 2` visible spans wide,
 * so the narrowest window still covers 1/10 of the data extent and a uniform
 * dataset mounts about N/10 marks however far it is zoomed in.
 */

/** d3-zoom's `scaleExtent` ceiling in Timeline.tsx. */
const MAX_ZOOM = 20
/** The plot area: the mocked-free Timeline default margin of 56 with width 800. */
const MARGIN_LEFT = 56
const INNER_WIDTH = 728

const makeEvent = (id: string, timestamp: string): Event => ({
  id,
  description: `Event ${id}`,
  actor: 'Actor',
  target: 'Target',
  timestamp,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z'
})

const DAY_MS = 24 * 60 * 60 * 1000

/** `count` events evenly spread over `spanDays` starting at 2024-01-01T00:00Z. */
const uniformEvents = (count: number, spanDays: number): Event[] =>
  Array.from({ length: count }, (_, i) =>
    makeEvent(`u-${i}`, new Date(Date.UTC(2024, 0, 1) + (i * spanDays * DAY_MS) / count).toISOString())
  )

const renderedEventCount = (): number => document.querySelectorAll('[data-event-id]').length

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

/**
 * A real ctrl-wheel zoom. `clientX` is where the wheel lands and d3 keeps the
 * time under that pixel fixed, so the view grows around it. A ctrl-wheel delta
 * of -50 is one doubling (d3: k *= 2^(-deltaY * 0.002 * 10)).
 */
function wheelZoom(svg: SVGSVGElement, deltaY: number, clientX: number): void {
  act(() => {
    svg.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY,
        clientX,
        clientY: 200,
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      })
    )
  })
}

/** Zooms until d3's own scale clamps at `scaleExtent`'s upper bound. */
function zoomToCap(svg: SVGSVGElement, clientX: number): void {
  for (let i = 0; i < 20 && zoomScale(svg) < MAX_ZOOM; i++) {
    wheelZoom(svg, -120, clientX)
  }
  // Asserting the cap, not assuming it: this is the zoom level the claim is
  // about, so the test must land on it exactly.
  expect(zoomScale(svg)).toBe(MAX_ZOOM)
}

beforeEach(() => {
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

describe('windowing through the real zoom path', () => {
  it('mounts a proportional slice, not a bounded count, at the 20x zoom cap', () => {
    const small = render(<Timeline events={uniformEvents(1000, 4)} arcs={[]} width={800} height={400} />)
    zoomToCap(requireSvg(), MARGIN_LEFT + INNER_WIDTH / 2)
    const mountedAt1000 = renderedEventCount()
    small.unmount()

    render(<Timeline events={uniformEvents(2000, 4)} arcs={[]} width={800} height={400} />)
    zoomToCap(requireSvg(), MARGIN_LEFT + INNER_WIDTH / 2)
    const mountedAt2000 = renderedEventCount()

    // The window is (1 + 2 * 0.5) visible spans wide and the view is 20x, so
    // each mount is a fixed fraction of the dataset. Measured here: 104 of 1000
    // and 208 of 2000, i.e. about N/9.6 both times.
    expect(mountedAt1000).toBeGreaterThan(1000 / 12)
    expect(mountedAt1000).toBeLessThan(1000 / 8)
    expect(mountedAt2000).toBeGreaterThan(2000 / 12)
    expect(mountedAt2000).toBeLessThan(2000 / 8)

    // Doubling the dataset doubles the mounted count at the same zoom. This is
    // the limit the stronger claim would have hidden: there is no zoom level
    // this component can reach where the mounted count stops tracking N.
    expect(mountedAt2000 / mountedAt1000).toBeGreaterThan(1.7)
    expect(mountedAt2000 / mountedAt1000).toBeLessThan(2.3)
  })

  it('does not reduce a fully-visible dataset, and culls as marks leave the viewport', () => {
    const eventCount = 400
    render(<Timeline events={uniformEvents(eventCount, 4)} arcs={[]} width={800} height={400} />)

    // At fit-to-view every mark really is on screen, so every mark mounts.
    // Windowing culls off-screen marks; it does not shrink a visible dataset.
    expect(renderedEventCount()).toBe(eventCount)

    // A mild zoom accordingly drops almost nothing: measured 392 of 400. The
    // eight that go are the ones the anchor scrolls just past the left edge --
    // d3's zoom extent is the full SVG width while the x scale's range is the
    // inner plot, so the wheel anchor sits a margin to the right of the plot
    // centre and the window is not exactly centred on the extent.
    const svg = requireSvg()
    wheelZoom(svg, -50, MARGIN_LEFT + INNER_WIDTH / 2)
    expect(zoomScale(svg)).toBeCloseTo(2, 6)
    expect(renderedEventCount()).toBeGreaterThan(eventCount * 0.95)

    // Past that, marks leave the DOM as they leave the viewport.
    zoomToCap(svg, MARGIN_LEFT + INNER_WIDTH / 2)
    const zoomedCount = renderedEventCount()
    expect(zoomedCount).toBeLessThan(eventCount / 4)
    expect(zoomedCount).toBeGreaterThan(eventCount / 25)
  })

  it('culls a dense region that the viewport has zoomed away from', () => {
    // Production-reachable version of the mock-extent case: 2,000 events in
    // 2022 and 5 in January 2024, so the extent spans two years while the
    // interesting marks are a two-year zoom away from the bulk of the data.
    const cluster = Array.from({ length: 2000 }, (_, i) =>
      makeEvent(`cluster-${i}`, new Date(Date.UTC(2022, 0, 1) + i * 60_000).toISOString())
    )
    const recent = [
      makeEvent('recent-a', '2024-01-01T00:00:00Z'),
      makeEvent('recent-b', '2024-01-02T00:00:00Z'),
      makeEvent('recent-c', '2024-01-03T00:00:00Z'),
      makeEvent('recent-d', '2024-01-04T00:00:00Z'),
      makeEvent('recent-e', '2024-01-05T00:00:00Z')
    ]
    render(<Timeline events={[...cluster, ...recent]} arcs={[]} width={800} height={400} />)
    expect(renderedEventCount()).toBe(2005)

    // Zoom on the sparse end, anchored just inside the right edge of the plot
    // so the 2024 marks stay visible instead of being scrolled past the extent.
    zoomToCap(requireSvg(), MARGIN_LEFT + INNER_WIDTH - 40)

    expect(renderedEventCount()).toBe(5)
    expect(document.querySelector('[data-event-id="recent-a"]')).toBeInTheDocument()
    expect(document.querySelector('[data-event-id="cluster-0"]')).not.toBeInTheDocument()
  })
})
