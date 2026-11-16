/**
 * The Engine Age demo history (media/src/seed/scenario.ts), which links every
 * one of its events. Under the track a linked event's title sits beside its
 * mark, clear of the link that leaves it, so the crowded stretches name more
 * of their events and name them longer; and no label, above or under the
 * track, meets a link, the axis or another label.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { scenario } from '../../../../media/src/seed/scenario'
import { Timeline } from './Timeline'
import type { Event } from '@/types'
import type { TimelineLink } from './timelineLinks'

const events: Event[] = scenario.events.map((seed) => ({
  id: seed.key,
  description: seed.description,
  actor: seed.actor,
  target: seed.target,
  timestamp: seed.timestamp,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
}))
const links: TimelineLink[] = scenario.links.map((link, i) => ({ id: `l${i}`, causeId: link.cause, effectId: link.effect, type: link.type, weight: link.weight }))

beforeEach(() => {
  Object.defineProperty(SVGSVGElement.prototype, 'width', { configurable: true, get: () => ({ baseVal: { value: 1300 } }) })
  Object.defineProperty(SVGSVGElement.prototype, 'height', { configurable: true, get: () => ({ baseVal: { value: 600 } }) })
})
afterEach(() => cleanup())

interface Box {
  id: string
  left: number
  right: number
  top: number
  bottom: number
  text: string
  y: number
}

function drawnBoxes(container: HTMLElement): { boxes: Box[]; eventY: number; axisY: number } {
  const first = container.querySelector('[data-event-id]')!
  const eventY = Number(/translate\(\s*[-\d.e]+\s*,\s*([-\d.e]+)\)/.exec(first.getAttribute('transform')!)![1])
  const axisY = Math.max(
    ...Array.from(container.querySelectorAll('text.axis-tick')).map((t) => Number(/translate\(0,\s*([-\d.e]+)\)/.exec(t.parentElement!.parentElement!.getAttribute('transform') ?? '')?.[1] ?? 0))
  )
  const boxes = Array.from(container.querySelectorAll<SVGTextElement>('[data-event-id] text.event-label')).map((text) => {
    const mark = text.closest('[data-event-id]')!
    const x = Number(/translate\(\s*([-\d.e]+)/.exec(mark.getAttribute('transform')!)![1])
    const offset = Number(text.getAttribute('y'))
    const width = text.textContent!.length * 12 * 0.56
    const anchor = text.getAttribute('text-anchor')
    const ax = x + Number(text.getAttribute('x') ?? 0)
    const left = anchor === 'start' ? ax : anchor === 'end' ? ax - width : ax - width / 2
    return { id: mark.getAttribute('data-event-id')!, left, right: left + width, top: eventY + offset - 10, bottom: eventY + offset + 3, text: text.textContent!, y: offset }
  })
  return { boxes, eventY, axisY }
}

describe('the Engine Age history at 1300 px', () => {
  it('names the Bank of England longer, and no fewer events, than the rows above alone could', () => {
    const { container } = render(<Timeline events={events} arcs={[]} links={links} width={1300} height={600} />)
    const { boxes } = drawnBoxes(container)
    const text = (key: string) => boxes.find((box) => box.id === key)?.text ?? ''
    const keyOf = (word: string) => scenario.events.find((seed) => seed.description.includes(word))!.key
    // On main these read "The Bank of Engla…" and "Prussia buys…".
    expect(text(keyOf('The Bank of England')).length, text(keyOf('The Bank of England'))).toBeGreaterThan('The Bank of Engla…'.length)
    // Prussia sits between links 99px apart, room for 14 characters: a longer name has none to go in under the track.
    expect(text(keyOf('Prussia buys')).length, text(keyOf('Prussia buys'))).toBeGreaterThanOrEqual('Prussia buys…'.length)
    expect(boxes.some((box) => box.y > 0), 'at least one label sits under the track').toBe(true)
  })

  it('keeps every label clear of every link, the axis and every other label', () => {
    const { container } = render(<Timeline events={events} arcs={[]} links={links} width={1300} height={600} />)
    const { boxes, axisY, eventY } = drawnBoxes(container)
    expect(boxes.length).toBeGreaterThan(0)
    for (const [i, a] of boxes.entries()) {
      expect(a.bottom, `${a.text} meets the axis`).toBeLessThan(axisY)
      for (const b of boxes.slice(i + 1)) {
        const apart = a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top
        expect(apart, `"${a.text}" overlaps "${b.text}"`).toBe(true)
      }
    }
    const curves = Array.from(container.querySelectorAll<SVGPathElement>('.timeline-link')).map((path) => {
      const m = /^M ([-\d.e]+) ([-\d.e]+) C ([-\d.e]+) ([-\d.e]+), ([-\d.e]+) ([-\d.e]+), ([-\d.e]+) ([-\d.e]+)$/.exec(path.getAttribute('d')!)!
      const [x0, y0, x1, y1, x2, y2, x3, y3] = m.slice(1).map(Number) as [number, number, number, number, number, number, number, number]
      return Array.from({ length: 601 }, (_, i) => {
        const t = i / 600
        const u = 1 - t
        return { x: u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, y: u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3 }
      })
    })
    expect(curves.length).toBe(links.length)
    for (const box of boxes) {
      if (box.y < 0) continue
      for (const curve of curves) {
        for (const point of curve) {
          expect(point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom, `"${box.text}" is crossed by a link at ${point.x.toFixed(1)},${point.y.toFixed(1)} (track ${eventY})`).toBe(false)
        }
      }
    }
  })
})
