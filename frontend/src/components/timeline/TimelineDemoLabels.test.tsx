/**
 * The demo histories (media/src/seed/scenario.ts), which link every one of
 * their events. Under the track a linked event's title sits beside its mark,
 * clear of the link that leaves it, so the crowded stretches name more of
 * their events and name them longer; and no label, above or under the track,
 * meets a link, the axis or another label. A title set beside its mark starts
 * right next to it, and the dash that joins them passes no other mark and no
 * other event's link.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { readWorldTimestamp, type WorldCalendarSet } from '@althistory/calendar'
import { deep, scenario, world, type ArcSeed, type EventSeed, type LinkSeed } from '../../../../media/src/seed/scenario'
import { Timeline } from './Timeline'
import { BESIDE_MAX_PX } from './eventLabelLayout'
import type { Arc, Event } from '@/types'
import { computeRipple, type TimelineLink } from './timelineLinks'
import { expectPlateClean, labelBoxes } from './labelTestUtils'

function history(seeds: EventSeed[], linkSeeds: LinkSeed[], arcSeeds: ArcSeed[], calendar: WorldCalendarSet | null): { events: Event[]; links: TimelineLink[]; arcs: Arc[] } {
  const iso = (text: string) => readWorldTimestamp(calendar, text)?.iso ?? text
  return {
    // The arcs the demo draws: the plate-only row above the labels lies under their bars.
    arcs: arcSeeds.map((arc) => ({ id: arc.key, name: arc.name, description: arc.description, start_time: iso(arc.start), end_time: iso(arc.end), level: arc.level, parent_arc_id: arc.parent ?? null, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z' })),
    events: seeds.map((seed) => ({
      id: seed.key,
      description: seed.description,
      actor: seed.actor,
      target: seed.target,
      timestamp: readWorldTimestamp(calendar, seed.timestamp)?.iso ?? seed.timestamp,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    })),
    links: linkSeeds.map((link, i) => ({ id: `l${i}`, causeId: link.cause, effectId: link.effect, type: link.type, weight: link.weight })),
  }
}

const HISTORIES: Record<string, { events: Event[]; links: TimelineLink[]; arcs: Arc[] }> = {
  'Engine Age': history(scenario.events, scenario.links, scenario.arcs, null),
  Vael: history(world.events, world.links, world.arcs, world.graph.calendar as WorldCalendarSet),
  'Deep time': history(deep.events, deep.links, deep.arcs, null),
  // The branch: the copied history with the events and links it adds.
  Branch: history([...scenario.events, ...scenario.branch.events], [...scenario.links, ...scenario.branch.links], scenario.arcs, null),
}

/** Selections no label or plate can name once the plate may not cover a traced link or another mark's stem, or hide a protected label: none, since the plate-only row above the labels. */
const EXCEPTIONS: Record<string, string[]> = {}

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
  dx: number
}

function drawn(container: HTMLElement) {
  const first = container.querySelector('[data-event-id]')!
  const eventY = Number(/translate\(\s*[-\d.e]+\s*,\s*([-\d.e]+)\)/.exec(first.getAttribute('transform')!)![1])
  const axisY = Math.max(
    ...Array.from(container.querySelectorAll('text.axis-tick')).map((t) => Number(/translate\(0,\s*([-\d.e]+)\)/.exec(t.parentElement!.parentElement!.getAttribute('transform') ?? '')?.[1] ?? 0))
  )
  const marks = new Map(
    Array.from(container.querySelectorAll('[data-event-id]')).map((mark) => [mark.getAttribute('data-event-id')!, Number(/translate\(\s*([-\d.e]+)/.exec(mark.getAttribute('transform')!)![1])])
  )
  const boxes: Box[] = Array.from(container.querySelectorAll<SVGTextElement>('[data-event-id] text.event-label')).map((text) => {
    const id = text.closest('[data-event-id]')!.getAttribute('data-event-id')!
    const x = marks.get(id)!
    const offset = Number(text.getAttribute('y'))
    const width = text.textContent!.length * 12 * 0.56
    const anchor = text.getAttribute('text-anchor')
    const dx = Number(text.getAttribute('x') ?? 0)
    const ax = x + dx
    const left = anchor === 'start' ? ax : anchor === 'end' ? ax - width : ax - width / 2
    return { id, left, right: left + width, top: eventY + offset - 10, bottom: eventY + offset + 3, text: text.textContent!, y: offset, dx }
  })
  return { boxes, eventY, axisY, marks }
}

function curvesOf(container: HTMLElement, links: TimelineLink[]) {
  return Array.from(container.querySelectorAll<SVGPathElement>('.timeline-link')).map((path) => {
    const link = links.find((l) => l.id === path.getAttribute('data-link-id'))!
    const m = /^M ([-\d.e]+) ([-\d.e]+) C ([-\d.e]+) ([-\d.e]+), ([-\d.e]+) ([-\d.e]+), ([-\d.e]+) ([-\d.e]+)$/.exec(path.getAttribute('d')!)!
    const [x0, y0, x1, y1, x2, y2, x3, y3] = m.slice(1).map(Number) as [number, number, number, number, number, number, number, number]
    const points = Array.from({ length: 601 }, (_, i) => {
      const t = i / 600
      const u = 1 - t
      return { x: u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, y: u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3 }
    })
    return { link, points }
  })
}

describe('the Engine Age history at 1300 px', () => {
  it('names the Bank of England longer, and no fewer events, than the rows above alone could', () => {
    const { events, links, arcs } = HISTORIES['Engine Age']!
    const { container } = render(<Timeline events={events} arcs={arcs} links={links} width={1300} height={600} />)
    const { boxes } = drawn(container)
    const text = (key: string) => boxes.find((box) => box.id === key)?.text ?? ''
    const keyOf = (word: string) => scenario.events.find((seed) => seed.description.includes(word))!.key
    // On main these read "The Bank of Engla…" and "Prussia buys…".
    expect(text(keyOf('The Bank of England')).length, text(keyOf('The Bank of England'))).toBeGreaterThan('The Bank of Engla…'.length)
    // Prussia sits between links 99px apart, room for 14 characters: a longer name has none to go in under the track.
    expect(text(keyOf('Prussia buys')).length, text(keyOf('Prussia buys'))).toBeGreaterThanOrEqual('Prussia buys…'.length)
    expect(boxes.some((box) => box.y > 0), 'at least one label sits under the track').toBe(true)
  })
})

describe.each(Object.keys(HISTORIES))('%s at 1300 px', (name) => {
  const { events, links, arcs } = HISTORIES[name]!

  it('keeps every label clear of every link, the axis and every other label', () => {
    const { container } = render(<Timeline events={events} arcs={arcs} links={links} width={1300} height={600} />)
    const { boxes, axisY, eventY } = drawn(container)
    expect(boxes.length).toBeGreaterThan(0)
    for (const [i, a] of boxes.entries()) {
      expect(a.bottom, `${a.text} meets the axis`).toBeLessThan(axisY)
      for (const b of boxes.slice(i + 1)) {
        const apart = a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top
        expect(apart, `"${a.text}" overlaps "${b.text}"`).toBe(true)
      }
    }
    const curves = curvesOf(container, links)
    expect(curves.length).toBe(links.length)
    for (const box of boxes) {
      if (box.y < 0) continue
      for (const { points } of curves) {
        for (const point of points) {
          expect(point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom, `"${box.text}" is crossed by a link at ${point.x.toFixed(1)},${point.y.toFixed(1)} (track ${eventY})`).toBe(false)
        }
      }
    }
  })

  it('sets a title beside its mark only right next to it, with a dash that passes no other mark or link', () => {
    const { container } = render(<Timeline events={events} arcs={arcs} links={links} width={1300} height={600} />)
    const { boxes, marks } = drawn(container)
    const curves = curvesOf(container, links)
    const beside = boxes.filter((box) => box.y > 0 && box.dx !== 0)
    for (const box of beside) {
      const x = marks.get(box.id)!
      expect(Math.abs(box.dx), `"${box.text}" starts ${box.dx}px from its mark`).toBeLessThanOrEqual(BESIDE_MAX_PX)
      const dash = container.querySelector<SVGLineElement>(`line[data-leader-for="${box.id}"]`)
      expect(dash, `"${box.text}" has a dash`).not.toBeNull()
      // Non-text contrast: the muted ink (4.5:1 on the card in both schemes) at full opacity, not 0.6 of it (2.5:1).
      expect(dash!.getAttribute('stroke')).toBe('var(--text-muted)')
      expect(dash!.getAttribute('stroke-opacity')).toBe('1')
      const [a, b] = [Number(dash!.getAttribute('x1')), Number(dash!.getAttribute('x2'))].sort((p, q) => p - q) as [number, number]
      const y = Number(dash!.getAttribute('y1'))
      for (const [other, ox] of marks) {
        if (other === box.id || Math.abs(ox - x) < 1) continue
        expect(ox > a - 0.5 && ox < b + 0.5, `the dash of "${box.text}" passes the mark ${other}`).toBe(false)
      }
      for (const { link, points } of curves) {
        if (link.causeId === box.id || link.effectId === box.id) continue
        for (const point of points) {
          expect(point.x >= a - 0.5 && point.x <= b + 0.5 && Math.abs(point.y - y) <= 1.5, `the dash of "${box.text}" crosses link ${link.id}`).toBe(false)
        }
      }
    }
    // The checks above are not vacuous: the Engine Age sets titles beside their marks.
    if (name === 'Engine Age') expect(beside.length, 'titles set beside their marks').toBeGreaterThan(0)
  })
})

describe.each(Object.keys(HISTORIES))('selecting each event of %s', (name) => {
  const { events, links, arcs } = HISTORIES[name]!

  it('keeps every other label where it was, names the selection in its own place or on a clean plate, and never covers a traced label', () => {
    // Narrower widths crowd the rows, so plates are drawn; at 1300 px most events are named in place.
    let plates = 0
    let totalPlates = 0
    let coveringPlates = 0
    const unnamed: string[] = []
    for (const width of [600, 800, 1300]) {
      const base = render(<Timeline events={events} arcs={arcs} links={links} width={width} height={600} />)
      const before = labelBoxes(base.container)
      cleanup()
      for (const event of events) {
        const { container } = render(<Timeline events={events} arcs={arcs} links={links} width={width} height={600} selectedEventId={event.id} />)
        const ripple = computeRipple(event.id, links)
        // The plate never covers a link of the selection's own trace.
        const covered = expectPlateClean(container, event.id, before, [...ripple.causes, ...ripple.effects.keys()], width, [...ripple.links.keys()])
        if (container.querySelector('[data-pinned-label-for]')) { totalPlates++; if (covered.length > 0) coveringPlates++ }
        if (container.querySelector('[data-pinned-label-for]')) plates++
        // Every selection is named: in its own place, or on its plate (the exceptions are listed, none today).
        const named = container.querySelector(`[data-event-id="${event.id}"] text.event-label`) !== null || container.querySelector(`[data-pinned-label-for="${event.id}"]`) !== null
        // (An event beyond the plot's right edge, which jsdom's unfitted view leaves off screen, has no mark to name.)
        const markX = Number(/translate\(\s*([-\d.e]+)/.exec(container.querySelector(`[data-event-id="${event.id}"]`)?.getAttribute('transform') ?? '')?.[1])
        if (!named && markX >= 0 && markX <= width - 72) unnamed.push(`${event.id} at ${width}px`)
        cleanup()
      }
    }
    // (Vael's labels fit in place at these widths: no selection there needs a plate.)
    if (name !== 'Vael') expect(plates, 'a plate is drawn for some selection').toBeGreaterThan(0)
    // In these histories the first pass always finds room: no plate covers any link, not just the traced ones.
    expect(coveringPlates, `${coveringPlates} of ${totalPlates} plates cover a link`).toBe(0)
    expect(unnamed, 'selections named neither in place nor on a plate').toEqual(EXCEPTIONS[name] ?? [])
  })
})
