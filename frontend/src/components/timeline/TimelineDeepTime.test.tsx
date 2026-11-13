import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, render } from '@testing-library/react'
import { ActorTimeline, type ActorEventData } from './ActorTimeline'
import { Timeline } from './Timeline'
import { useWorldCalendarStore } from '@/stores/worldCalendarStore'
import { isoOfAxisTime } from '@althistory/calendar'
import type { Arc, Event } from '@/types'

/**
 * A history of a million years, drawn by the real scales (docs/specs/deep-time.md,
 * Req 12): events from 500,000 BCE to 300,000 CE, and a chronicle of a world
 * whose day is 30 hours long, none of which a JavaScript Date can hold.
 */

const event = (id: string, timestamp: string): Event => ({
  id,
  description: `Event ${id}`,
  actor: 'Actor',
  target: 'Target',
  timestamp,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
})

const arc = (id: string, start: string, end: string): Arc => ({
  id,
  name: `Arc ${id}`,
  description: '',
  parent_arc_id: null,
  start_time: start,
  end_time: end,
  level: 0,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
})

const axisLabels = () => Array.from(document.querySelectorAll('svg text.font-mono-code')).map((text) => text.textContent ?? '')

beforeEach(() => {
  Object.defineProperty(SVGElement.prototype, 'getScreenCTM', {
    configurable: true,
    writable: true,
    value: () => ({ inverse: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) }),
  })
  Object.defineProperty(SVGElement.prototype, 'createSVGPoint', {
    configurable: true,
    writable: true,
    value: () => {
      const point = { x: 0, y: 0, matrixTransform: () => ({ x: point.x, y: point.y }) }
      return point
    },
  })
  // d3-zoom's default extent (ActorTimeline sets none) reads the SVG's size, which jsdom leaves undefined.
  Object.defineProperty(SVGSVGElement.prototype, 'width', { configurable: true, get: () => ({ baseVal: { value: 900 } }) })
  Object.defineProperty(SVGSVGElement.prototype, 'height', { configurable: true, get: () => ({ baseVal: { value: 400 } }) })
})

describe('a timeline of a million years', () => {
  const events = [
    event('a', '-499999-06-15T00:00:00.000Z'),
    event('b', '-000043-03-15T00:00:00.000Z'),
    event('c', '1066-10-14T09:00:00.000Z'),
    event('d', '+300000-01-01T00:00:00.000Z'),
  ]

  it('draws every event and arc at its own place, with no NaN anywhere', () => {
    const { container } = render(
      <Timeline events={events} arcs={[arc('age', '-499999-01-01T00:00:00.000Z', '+300000-12-31T23:59:59.999Z')]} width={900} height={400} />
    )
    expect(container.querySelectorAll('[data-event-id]')).toHaveLength(4)
    expect(container.innerHTML).not.toContain('NaN')
    expect(container.innerHTML).not.toContain('Invalid')
    // Left to right in time.
    const xs = ['a', 'b', 'c', 'd'].map((id) => Number(container.querySelector(`[data-event-id="${id}"]`)?.getAttribute('transform')?.match(/translate\(([^,]+),/)?.[1] ?? NaN))
    expect(xs.every(Number.isFinite)).toBe(true)
    expect(xs).toEqual([...xs].sort((p, q) => p - q))
    expect(xs[3]! - xs[0]!).toBeGreaterThan(300)
  })

  it('labels its axis in years with their era, each label once', () => {
    render(<Timeline events={events} arcs={[]} width={900} height={400} />)
    const labels = axisLabels()
    expect(labels.length).toBeGreaterThan(2)
    expect(new Set(labels).size).toBe(labels.length)
    expect(labels.some((label) => /BCE/.test(label))).toBe(true)
    expect(labels.some((label) => /\bCE\b/.test(label) && !/BCE/.test(label))).toBe(true)
  })

  it('keeps a real history\'s axis in the d3 style it always had', () => {
    render(<Timeline events={[event('x', '1843-01-01T00:00:00.000Z'), event('y', '1871-06-01T00:00:00.000Z')]} arcs={[]} width={900} height={400} />)
    const labels = axisLabels()
    expect(labels.some((label) => /^18\d\d$|^18\d0s$/.test(label))).toBe(true)
    expect(labels.some((label) => /CE|BCE/.test(label))).toBe(false)
  })
})

describe('a world chronicle of a million years', () => {
  const world = {
    version: 2,
    dayLength: 30 * 3600,
    primary: 'ages',
    calendars: [
      {
        id: 'ages',
        name: 'The Count of Ages',
        parts: [
          { name: 'Ember', days: 40 },
          { name: 'Ash', days: 41 },
        ],
        epoch: 0,
        eras: [{ label: 'AF', from: 1 }],
      },
    ],
  }
  /** The first moment of a world year: 81 days of 30 hours each. */
  const startOf = (year: number) => isoOfAxisTime(BigInt(year - 1) * 81n * 108_000_000n)

  beforeEach(() => {
    useWorldCalendarStore.getState().setCalendar(world)
  })

  afterEach(() => {
    useWorldCalendarStore.getState().setCalendar(null)
  })

  it('labels its axis in the world\'s own years, a million of them', () => {
    const { container } = render(
      <Timeline events={[event('p', startOf(10)), event('q', startOf(250_000)), event('r', startOf(1_000_000))]} arcs={[]} width={900} height={400} />
    )
    expect(startOf(1_000_000)).toMatch(/^\+\d{6,}-/)
    expect(container.innerHTML).not.toContain('NaN')
    const labels = axisLabels()
    expect(labels.length).toBeGreaterThan(1)
    expect(new Set(labels).size).toBe(labels.length)
    expect(labels.every((label) => /AF/.test(label))).toBe(true)
  })
})

/** A real ctrl-wheel gesture, which d3-zoom turns into a zoom of `2^(-deltaY / 50)`. */
function wheelZoom(svg: SVGSVGElement, deltaY: number): void {
  act(() => {
    svg.dispatchEvent(new WheelEvent('wheel', { deltaY, clientX: 450, clientY: 200, ctrlKey: true, bubbles: true, cancelable: true }))
  })
}

const zoomOf = (svg: SVGSVGElement) => (svg as SVGSVGElement & { __zoom: { k: number } }).__zoom.k

describe('zooming out of a history a Date can hold', () => {
  // 200,000 BCE to 100,000 CE: 300,000 years, and every moment of it a Date can hold.
  const edges = ['-200000-01-01T00:00:00.000Z', '+100000-01-01T00:00:00.000Z']

  it('keeps every mark and tick finite when a Timeline zooms out to half', () => {
    const events = [event('a', edges[0]!), event('b', '1066-10-14T09:00:00.000Z'), event('c', edges[1]!)]
    const { container } = render(<Timeline events={events} arcs={[]} width={900} height={400} />)
    const svg = container.querySelector('svg') as SVGSVGElement
    wheelZoom(svg, 50)
    expect(zoomOf(svg)).toBeCloseTo(0.5, 5)
    expect(container.innerHTML).not.toContain('NaN')
    expect(container.innerHTML).not.toContain('Invalid')
    expect(container.querySelectorAll('[data-event-id]')).toHaveLength(3)
    expect(axisLabels().length).toBeGreaterThan(2)
  })

  it('keeps an ActorTimeline finite at its widest zoom, a tenth', () => {
    const actorEvents: ActorEventData[] = [event('a', '-100000-01-01T00:00:00.000Z'), event('b', '+100000-01-01T00:00:00.000Z')].map((e) => ({
      ...e,
      actor: 'Actor',
      role: 'actor' as const,
      isHighlighted: false,
    }))
    const { container } = render(<ActorTimeline events={actorEvents} arcs={[]} actor="Actor" layoutMode="chronological" width={900} height={400} />)
    const svg = container.querySelector('svg[role="group"]') as SVGSVGElement
    wheelZoom(svg, 400)
    expect(zoomOf(svg)).toBeCloseTo(0.1, 5)
    expect(container.innerHTML).not.toContain('NaN')
    expect(container.innerHTML).not.toContain('Invalid')
    expect(container.querySelectorAll('.actor-event').length).toBe(2)
  }, 30_000)
})
