/**
 * Where the selection's plate may go above the labels: inside the clip rect
 * (the plot), under the divergence band's labels, and under the lowest arc
 * bar. A plate above any of those is cut off, or covers a landmark.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { Timeline } from './Timeline'
import { DIVERGENCE_BAND_HEIGHT } from './timelineLayout'
import type { Arc, Event } from '@/types'

const event = (id: string, timestamp: string): Event => ({
  id,
  description: `A rather long title for crowded event number ${id}`,
  actor: 'Actor',
  target: 'Target',
  timestamp,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
})
const crowd = (count: number): Event[] => Array.from({ length: count }, (_, i) => event(`e${String(i).padStart(2, '0')}`, new Date(Date.UTC(2024, 0, 1, i)).toISOString()))
const arc: Arc = {
  id: 'a1',
  name: 'An arc',
  description: '',
  start_time: '2024-01-01T00:00:00Z',
  end_time: '2024-01-02T00:00:00Z',
  level: 0,
  parent_arc_id: null,
  created_at: 'x',
  updated_at: 'x',
}

beforeEach(() => {
  Object.defineProperty(SVGSVGElement.prototype, 'width', { configurable: true, get: () => ({ baseVal: { value: 1000 } }) })
  Object.defineProperty(SVGSVGElement.prototype, 'height', { configurable: true, get: () => ({ baseVal: { value: 500 } }) })
})
afterEach(() => cleanup())

/** Every plate drawn for a selection of each event: how many, and the highest top. */
function plates(events: Event[], arcs: Arc[], ghost?: { label: string; events: Event[]; divergence: Date }) {
  const found: Array<{ id: string; top: number; markY: number; clipTop: number; clipBottom: number; bottom: number }> = []
  for (const ev of events) {
    const { container } = render(<Timeline events={events} arcs={arcs} ghost={ghost} width={1000} height={500} selectedEventId={ev.id} />)
    const rect = container.querySelector('[data-pinned-label-for] rect.event-label-plate')
    const clip = container.querySelector('clipPath rect')!
    const mark = container.querySelector(`[data-event-id="${ev.id}"]`)!
    if (rect) {
      const markY = Number(/translate\(\s*[-\d.e]+\s*,\s*([-\d.e]+)\)/.exec(mark.getAttribute('transform')!)![1])
      const top = Number(rect.getAttribute('y'))
      found.push({ id: ev.id, top, bottom: top + Number(rect.getAttribute('height')), markY, clipTop: Number(clip.getAttribute('y')), clipBottom: Number(clip.getAttribute('y')) + Number(clip.getAttribute('height')) })
    }
    cleanup()
  }
  return found
}

describe('a plate stays inside the plot and clear of the bands above the labels', () => {
  it('with no arcs and no band: inside the clip rect and the SVG (the plate may rise into the 16px top margin), whatever the crowd', () => {
    let risen = 0
    for (const count of [20, 30, 40, 60]) {
      const found = plates(crowd(count), [])
      for (const plate of found) {
        expect(plate.top, `${count} events: the plate of ${plate.id} is cut off at ${plate.top}`).toBeGreaterThanOrEqual(plate.clipTop)
        expect(plate.top).toBeGreaterThanOrEqual(-16)
        expect(plate.bottom).toBeLessThanOrEqual(plate.clipBottom)
        if (plate.top < 0) risen++
      }
    }
    expect(risen, 'some plate rises into the margin').toBeGreaterThan(0)
  }, 120_000)

  it('with no arcs and a divergence band: clear of its diamond and label', () => {
    const events = crowd(40)
    for (const at of [3, 12, 30]) {
      const ghost = { label: 'Baseline', events: events.slice(0, 5), divergence: new Date(events[at]!.timestamp) }
      for (const ev of events) {
        const { container } = render(<Timeline events={events} arcs={[]} ghost={ghost} width={1000} height={500} selectedEventId={ev.id} />)
        const rect = container.querySelector('[data-pinned-label-for] rect.event-label-plate')
        if (rect) {
          const plate = { left: Number(rect.getAttribute('x')), right: Number(rect.getAttribute('x')) + Number(rect.getAttribute('width')), top: Number(rect.getAttribute('y')), bottom: Number(rect.getAttribute('y')) + Number(rect.getAttribute('height')) }
          const text = container.querySelector('.timeline-divergence text')!
          const diamond = container.querySelector('.timeline-divergence path')!
          const cx = Number(/M ([-\d.e]+)/.exec(diamond.getAttribute('d')!)![1])
          const width = text.textContent!.length * 12 * 0.62
          const x = Number(text.getAttribute('x'))
          const labelLeft = text.getAttribute('text-anchor') === 'end' ? x - width : x
          const boxes = [
            { left: cx - 6, right: cx + 6, top: 6, bottom: 18 },
            { left: labelLeft, right: labelLeft + width, top: 6.4, bottom: 19 },
          ]
          for (const box of boxes) {
            const apart = plate.right <= box.left || plate.left >= box.right || plate.bottom <= box.top || plate.top >= box.bottom
            expect(apart, `the plate of ${ev.id} covers the divergence band at event ${at}`).toBe(true)
          }
        }
        cleanup()
      }
    }
  }, 180_000)

  it('with an arc: under its bar, within the tolerance the band under it allows', () => {
    const found = plates(crowd(40), [arc])
    expect(found.length).toBeGreaterThan(0)
    for (const plate of found) {
      // The bar's foot is 84px above the track (74px of label rows and the 10px gap): the plate's top is no higher.
      expect(plate.top, `the plate of ${plate.id} reaches over the bar`).toBeGreaterThanOrEqual(plate.markY - 84)
      expect(plate.top).toBeGreaterThanOrEqual(plate.clipTop)
    }
    // With the room above the labels, some plate takes it (the row at -75, its top the bar's foot).
    expect(found.some((plate) => plate.top < plate.markY - 80)).toBe(true)
  }, 120_000)

  it('with arcs and a band: under both', () => {
    const events = crowd(40)
    const ghost = { label: 'Baseline', events: events.slice(0, 5), divergence: new Date(events[12]!.timestamp) }
    for (const plate of plates(events, [arc], ghost)) {
      expect(plate.top).toBeGreaterThanOrEqual(plate.markY - 84)
      expect(plate.top).toBeGreaterThanOrEqual(DIVERGENCE_BAND_HEIGHT)
    }
  }, 120_000)
})
