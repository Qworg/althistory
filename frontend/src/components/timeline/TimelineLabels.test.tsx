/**
 * Event titles on the main timeline stay where they are: selecting or
 * highlighting an event styles its label (and dims the rest) but never packs
 * the rows again; and, where causal links hang under the track, a label with
 * no room above may take a row under it, never over a link.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { Timeline } from './Timeline'
import { TIMELINE_BELOW_ROW_OFFSETS } from './eventLabelLayout'
import type { Event } from '@/types'
import type { TimelineLink } from './timelineLinks'

const event = (id: string, timestamp: string, description = `Event ${id}`): Event => ({
  id,
  description,
  actor: 'Actor',
  target: 'Target',
  timestamp,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
})

/** `count` events an hour apart: so close that their labels crowd every row. */
const crowd = (count: number): Event[] =>
  Array.from({ length: count }, (_, i) => event(`e${String(i).padStart(2, '0')}`, new Date(Date.UTC(2024, 0, 1, i)).toISOString(), `Crowded event number ${i}`))

beforeEach(() => {
  Object.defineProperty(SVGSVGElement.prototype, 'width', { configurable: true, get: () => ({ baseVal: { value: 1000 } }) })
  Object.defineProperty(SVGSVGElement.prototype, 'height', { configurable: true, get: () => ({ baseVal: { value: 500 } }) })
})
afterEach(() => cleanup())

interface Drawn {
  y: string | null
  anchor: string | null
  text: string | null
}

const drawnLabels = (container: HTMLElement) =>
  new Map<string, Drawn>(
    Array.from(container.querySelectorAll<SVGTextElement>('text.event-label')).map((text) => [
      text.closest('[data-event-id]')!.getAttribute('data-event-id')!,
      { y: text.getAttribute('y'), anchor: text.getAttribute('text-anchor'), text: text.textContent },
    ])
  )

describe('labels stay put when an event is selected or highlighted', () => {
  it('keeps every label where it was, and styles the selected one in place', () => {
    const events = crowd(40)
    const { container, rerender } = render(<Timeline events={events} arcs={[]} width={1000} height={500} />)
    const before = drawnLabels(container)
    expect(before.size).toBeGreaterThan(4)
    const named = [...before.keys()]
    const unnamed = events.map((ev) => ev.id).filter((id) => !before.has(id))
    expect(unnamed.length).toBeGreaterThan(0)
    for (const id of [named[0]!, named[named.length - 1]!, unnamed[0]!, unnamed[unnamed.length - 1]!]) {
      rerender(<Timeline events={events} arcs={[]} width={1000} height={500} selectedEventId={id} />)
      const after = drawnLabels(container)
      for (const [key, where] of before) expect(after.get(key), `selecting ${id} moved ${key}`).toEqual(where)
      // The selection is named: in place where it had a label, over its neighbours where it had none.
      const selected = container.querySelector(`[data-event-id="${id}"] text.event-label`)
      expect(selected, id).not.toBeNull()
      expect(selected!.getAttribute('font-weight')).toBe('600')
      expect(selected!.getAttribute('fill')).toBe('var(--accent-selected)')
    }
    // Nothing else is named because of it.
    rerender(<Timeline events={events} arcs={[]} width={1000} height={500} selectedEventId={unnamed[0]!} />)
    expect(drawnLabels(container).size).toBe(before.size + 1)
  })

  it('keeps every label where it was when events are highlighted', () => {
    const events = crowd(40)
    const { container, rerender } = render(<Timeline events={events} arcs={[]} width={1000} height={500} />)
    const before = drawnLabels(container)
    const highlighted = new Set([...before.keys()].slice(0, 3))
    rerender(<Timeline events={events} arcs={[]} width={1000} height={500} highlightedEventIds={highlighted} />)
    const after = drawnLabels(container)
    for (const [key, where] of before) expect(after.get(key), key).toEqual(where)
    for (const id of highlighted) expect(container.querySelector(`[data-event-id="${id}"] text.event-label`)!.getAttribute('font-weight')).toBe('600')
  })

  it('keeps every label where it was while a ripple is traced through links', () => {
    const events = crowd(40)
    const links: TimelineLink[] = [
      { id: 'l1', causeId: 'e00', effectId: 'e10', type: 'direct', weight: 0.8 },
      { id: 'l2', causeId: 'e10', effectId: 'e25', type: 'indirect', weight: 0.5 },
    ]
    const { container, rerender } = render(<Timeline events={events} arcs={[]} links={links} width={1000} height={500} />)
    const before = drawnLabels(container)
    rerender(<Timeline events={events} arcs={[]} links={links} width={1000} height={500} selectedEventId="e10" />)
    const after = drawnLabels(container)
    for (const [key, where] of before) expect(after.get(key), key).toEqual(where)
  })
})

describe('labels under the track', () => {
  const linked: TimelineLink[] = [
    { id: 'l1', causeId: 'e00', effectId: 'e39', type: 'direct', weight: 0.8 },
    { id: 'l2', causeId: 'e05', effectId: 'e20', type: 'contributory', weight: 0.4 },
  ]

  it('names more events where links hang under the track, in the rows under it', () => {
    const events = crowd(40)
    const plain = render(<Timeline events={events} arcs={[]} width={1000} height={500} />)
    const withoutLinks = drawnLabels(plain.container)
    expect([...withoutLinks.values()].every((label) => Number(label.y) < 0)).toBe(true)
    cleanup()
    const { container } = render(<Timeline events={events} arcs={[]} links={linked} width={1000} height={500} />)
    const labels = drawnLabels(container)
    const below = [...labels.entries()].filter(([, label]) => Number(label.y) > 0)
    expect(below.length).toBeGreaterThan(0)
    for (const [, label] of below) expect(TIMELINE_BELOW_ROW_OFFSETS as readonly number[]).toContain(Number(label.y))
    expect(labels.size).toBeGreaterThan(withoutLinks.size)
  })

  it('never puts a label across a link\'s curve', () => {
    const events = crowd(40)
    const { container } = render(<Timeline events={events} arcs={[]} links={linked} width={1000} height={500} />)
    const paths = Array.from(container.querySelectorAll<SVGPathElement>('.timeline-link'))
    expect(paths.length).toBe(2)
    // The cubic of each link, sampled in the plot's coordinates relative to the band's top.
    const eventY = Number(/translate\([-\d.]+,\s*([-\d.]+)\)/.exec(container.querySelector('[data-event-id="e00"]')!.getAttribute('transform')!)![1])
    const curves = paths.map((path) => {
      const m = /^M ([-\d.e]+) ([-\d.e]+) C ([-\d.e]+) ([-\d.e]+), ([-\d.e]+) ([-\d.e]+), ([-\d.e]+) ([-\d.e]+)$/.exec(path.getAttribute('d')!)!
      const [x0, y0, x1, y1, x2, y2, x3, y3] = m.slice(1).map(Number) as number[] as [number, number, number, number, number, number, number, number]
      return Array.from({ length: 801 }, (_, i) => {
        const t = i / 800
        const u = 1 - t
        return { x: u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, y: u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3 }
      })
    })
    for (const text of Array.from(container.querySelectorAll<SVGTextElement>('text.event-label'))) {
      const offset = Number(text.getAttribute('y'))
      if (offset <= 0) continue
      const x = Number(/translate\(([-\d.e]+)/.exec(text.closest('[data-event-id]')!.getAttribute('transform')!)![1])
      const width = text.textContent!.length * 12 * 0.56
      const anchor = text.getAttribute('text-anchor')
      const left = anchor === 'start' ? x : anchor === 'end' ? x - width : x - width / 2
      const top = eventY + offset - 12
      const bottom = eventY + offset + 3
      for (const curve of curves) {
        for (const point of curve) {
          const inside = point.x >= left && point.x <= left + width && point.y >= top && point.y <= bottom
          expect(inside, `"${text.textContent}" at ${left.toFixed(0)}..${(left + width).toFixed(0)} is crossed at ${point.x.toFixed(1)},${point.y.toFixed(1)}`).toBe(false)
        }
      }
    }
  })
})
