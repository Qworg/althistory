/**
 * Event titles on the main timeline stay where they are: selecting or
 * highlighting an event styles its label (and dims the rest) but never packs
 * the rows again; and, where causal links hang under the track, a label with
 * no room above may take a row under it, never over a link.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, renderHook } from '@testing-library/react'
import { Timeline } from './Timeline'
import { fontsLoaded, measureLabelWidth } from './labelWidth'
import { useFontEpoch } from './useFontEpoch'
import { TIMELINE_BELOW_ROW_OFFSETS } from './eventLabelLayout'
import type { Event } from '@/types'
import type { TimelineLink } from './timelineLinks'
import { expectPlateClean, labelBoxes } from './labelTestUtils'

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
    Array.from(container.querySelectorAll<SVGTextElement>('[data-event-id] text.event-label')).map((text) => [
      text.closest('[data-event-id]')!.getAttribute('data-event-id')!,
      { y: text.getAttribute('y'), anchor: text.getAttribute('text-anchor'), text: text.textContent },
    ])
  )

describe('labels stay put when an event is selected or highlighted', () => {
  it('keeps every label where it was, and styles the selected one in place', () => {
    const events = crowd(40)
    const { container, rerender } = render(<Timeline events={events} arcs={[]} width={1000} height={500} />)
    const before = drawnLabels(container)
    const boxes = labelBoxes(container)
    expect(before.size).toBeGreaterThan(4)
    const named = [...before.keys()]
    const unnamed = events.map((ev) => ev.id).filter((id) => !before.has(id))
    expect(unnamed.length).toBeGreaterThan(0)
    for (const id of [named[0]!, named[named.length - 1]!, ...unnamed]) {
      rerender(<Timeline events={events} arcs={[]} width={1000} height={500} selectedEventId={id} />)
      const own = container.querySelector(`[data-event-id="${id}"] text.event-label`)
      if (before.has(id)) {
        // In place, as it was, in the selection's style; no plate, nothing hidden.
        expect(drawnLabels(container).get(id), id).toEqual(before.get(id))
        expect(own!.getAttribute('font-weight')).toBe('600')
        expect(own!.getAttribute('fill')).toBe('var(--accent-selected)')
        expect(container.querySelector(`[data-pinned-label-for="${id}"]`)).toBeNull()
        for (const [key, where] of before) expect(drawnLabels(container).get(key), `selecting ${id} moved ${key}`).toEqual(where)
      } else {
        expect(own).toBeNull()
        expectPlateClean(container, id, boxes)
      }
    }
  })

  it('draws a clean plate for some unnamed selection in each of several crowds', () => {
    let plates = 0
    for (const count of [10, 14, 18, 22, 26, 30]) {
      const events = crowd(count)
      const base = render(<Timeline events={events} arcs={[]} width={1000} height={500} />)
      const before = labelBoxes(base.container)
      cleanup()
      for (const ev of events) {
        if (before.has(ev.id)) continue
        const { container } = render(<Timeline events={events} arcs={[]} width={1000} height={500} selectedEventId={ev.id} />)
        expectPlateClean(container, ev.id, before)
        if (container.querySelector('[data-pinned-label-for]')) {
          plates++
        }
        cleanup()
      }
    }
    expect(plates).toBeGreaterThan(0)
  })

  it('keeps every label where it was when events are highlighted, and gives those with no room no plate', () => {
    const events = crowd(40)
    const { container, rerender } = render(<Timeline events={events} arcs={[]} width={1000} height={500} />)
    const before = drawnLabels(container)
    const unnamed = events.map((ev) => ev.id).filter((id) => !before.has(id))
    const highlighted = new Set([...before.keys()].slice(0, 3))
    rerender(<Timeline events={events} arcs={[]} width={1000} height={500} highlightedEventIds={highlighted} />)
    const after = drawnLabels(container)
    for (const [key, where] of before) expect(after.get(key), key).toEqual(where)
    for (const id of highlighted) expect(container.querySelector(`[data-event-id="${id}"] text.event-label`)!.getAttribute('font-weight')).toBe('600')
    // Highlighted events with no room stay unnamed on the canvas.
    rerender(<Timeline events={events} arcs={[]} width={1000} height={500} highlightedEventIds={new Set(unnamed.slice(0, 4))} />)
    expect(container.querySelector('[data-pinned-label-for]')).toBeNull()
    expect(drawnLabels(container).size).toBe(before.size)
  })

  it('never covers a highlighted or traced label with the selection\'s plate', () => {
    const events = crowd(40)
    const links: TimelineLink[] = [
      { id: 'l1', causeId: 'e03', effectId: 'e30', type: 'direct', weight: 0.8 },
      { id: 'l2', causeId: 'e03', effectId: 'e12', type: 'direct', weight: 0.8 },
    ]
    const plain = render(<Timeline events={events} arcs={[]} links={links} width={1000} height={500} />)
    const before = labelBoxes(plain.container)
    const named = new Set(before.keys())
    cleanup()
    const unnamed = events.map((ev) => ev.id).filter((id) => !named.has(id))
    for (const id of unnamed) {
      const { container } = render(<Timeline events={events} arcs={[]} links={links} width={1000} height={500} selectedEventId={id} highlightedEventIds={new Set(['e00', 'e20'])} />)
      // Protected: the highlighted events' labels, and the traced causes and effects of the selection.
      const traced = ['e03', 'e30', 'e12'].filter((key) => key === id || links.some((l) => (l.causeId === id && l.effectId === key) || (l.effectId === id && l.causeId === key)))
      expectPlateClean(container, id, before, ['e00', 'e20', ...traced])
      cleanup()
    }
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
    for (const text of Array.from(container.querySelectorAll<SVGTextElement>('[data-event-id] text.event-label'))) {
      const offset = Number(text.getAttribute('y'))
      if (offset <= 0) continue
      const x = Number(/translate\(([-\d.e]+)/.exec(text.closest('[data-event-id]')!.getAttribute('transform')!)![1])
      const width = text.textContent!.length * 12 * 0.56
      const anchor = text.getAttribute('text-anchor')
      const ax = x + Number(text.getAttribute('x') ?? 0)
      const left = anchor === 'start' ? ax : anchor === 'end' ? ax - width : ax - width / 2
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

describe('the dimmed state while a ripple is traced', () => {
  it('fades the marks of events off the ripple, keeps their labels legible, and leaves the ripple at full strength', () => {
    const events = crowd(8).map((ev, i) => ({ ...ev, timestamp: new Date(Date.UTC(2024, 0, 1 + i * 30)).toISOString() }))
    const links: TimelineLink[] = [
      { id: 'l1', causeId: 'e00', effectId: 'e01', type: 'direct', weight: 0.8 },
      { id: 'l2', causeId: 'e01', effectId: 'e02', type: 'direct', weight: 0.8 },
    ]
    const { container } = render(<Timeline events={events} arcs={[]} links={links} width={1000} height={500} selectedEventId="e01" />)
    const mark = (id: string) => container.querySelector(`[data-event-id="${id}"]`)!
    for (const id of ['e00', 'e01', 'e02']) {
      expect(mark(id).hasAttribute('data-dimmed'), id).toBe(false)
      expect(mark(id).querySelector('.event-mark')!.getAttribute('opacity'), id).toBeNull()
    }
    for (const id of ['e05', 'e06']) {
      expect(mark(id).getAttribute('data-dimmed'), id).toBe('true')
      // The mark fades to about a third; the label keeps the muted ink at full opacity (it is outside the faded group).
      expect(Number(mark(id).querySelector('.event-mark')!.getAttribute('opacity'))).toBeLessThanOrEqual(0.35)
      const label = mark(id).querySelector('text.event-label')
      expect(label, id).not.toBeNull()
      expect(label!.getAttribute('fill')).toBe('var(--text-muted)')
      expect(label!.closest('.event-mark')).toBeNull()
      expect(mark(id).getAttribute('opacity')).toBeNull()
    }
  })
})

describe('traced and dimmed labels', () => {
  const sparse = () => crowd(8).map((ev, i) => ({ ...ev, timestamp: new Date(Date.UTC(2024, 0, 1 + i * 30)).toISOString() }))
  const chain: TimelineLink[] = [
    { id: 'l1', causeId: 'e00', effectId: 'e01', type: 'direct', weight: 0.8 },
    { id: 'l2', causeId: 'e01', effectId: 'e02', type: 'direct', weight: 0.8 },
  ]

  it('gives the labels on the traced ripple the primary ink, apart from the dimmed ones', () => {
    const { container } = render(<Timeline events={sparse()} arcs={[]} links={chain} width={1000} height={500} selectedEventId="e01" />)
    const fill = (id: string) => container.querySelector(`[data-event-id="${id}"] text.event-label`)?.getAttribute('fill')
    expect(fill('e00')).toBe('var(--text-primary)')
    expect(fill('e02')).toBe('var(--text-primary)')
    expect(fill('e01')).toBe('var(--accent-selected)')
    expect(fill('e05')).toBe('var(--text-muted)')
  })

  it("keeps the leaders and beside dashes of dimmed labels at about the marks' own strength, not near invisible", () => {
    const events = crowd(40)
    const links: TimelineLink[] = [{ id: 'l1', causeId: 'e00', effectId: 'e39', type: 'direct', weight: 0.8 }]
    const { container } = render(<Timeline events={events} arcs={[]} links={links} width={1000} height={500} selectedEventId="e00" />)
    const dimmed = new Set(Array.from(container.querySelectorAll('[data-dimmed="true"]')).map((mark) => mark.getAttribute('data-event-id')))
    const leaders = Array.from(container.querySelectorAll('line.event-label-leader')).filter((leader) => dimmed.has(leader.getAttribute('data-leader-for')))
    expect(leaders.length).toBeGreaterThan(0)
    for (const leader of leaders) expect(Number(leader.getAttribute('stroke-opacity'))).toBeGreaterThanOrEqual(0.3)
  })
})

describe('label widths follow the fonts', () => {
  it('tells what measured a label that the fonts have loaded, so it measures again', () => {
    const { result } = renderHook(() => useFontEpoch())
    const before = result.current
    act(() => fontsLoaded())
    expect(result.current).toBe(before + 1)
    expect(measureLabelWidth('Event', 12)).toBeGreaterThan(0)
  })
})
