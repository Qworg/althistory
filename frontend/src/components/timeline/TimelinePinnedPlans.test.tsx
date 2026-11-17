/**
 * What the pinned-name plans are fed: the full name and its shorter forms
 * (so a plate that has no room for the whole name takes a shorter one), and
 * widths measured again once the fonts have loaded.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { Timeline } from './Timeline'
import { ActorTimeline, type ActorEventData } from './ActorTimeline'
import { fontsLoaded } from './labelWidth'
import * as pinned from './pinnedLabel'
import { computeRipple } from './timelineLinks'
import type { Event } from '@/types'

const widthPerChar = { value: 6.72 }
vi.mock('./labelWidth', async (original) => ({
  ...(await original<typeof import('./labelWidth')>()),
  measureLabelWidth: (text: string) => text.length * widthPerChar.value,
}))
const planned: Array<ReadonlyArray<{ text: string; width: number }>> = []
const selectionInputs: Array<{ links: ReadonlyArray<{ id: string; x1: number; x2: number; traced?: boolean }>; belowRows: readonly number[]; plateOnlyRows: readonly number[]; aboveRows: readonly number[]; preferAbove?: boolean; labels: ReadonlyArray<{ id: string; protectedLabel?: boolean; obstacle?: boolean }>; softObstacles?: ReadonlyArray<{ id: string; protectedLabel?: boolean; obstacle?: boolean }> }> = []
vi.mock('./selectionPlate', async (original) => {
  const actual = await original<typeof import('./selectionPlate')>()
  return {
    ...actual,
    planSelectionPlate: (input: Parameters<typeof actual.planSelectionPlate>[0]) => {
      selectionInputs.push({ links: input.links, belowRows: input.belowRows, plateOnlyRows: input.plateOnlyRows, aboveRows: input.aboveRows, preferAbove: input.preferAbove, labels: input.labels, softObstacles: input.softObstacles })
      return actual.planSelectionPlate(input)
    },
  }
})
vi.mock('./pinnedLabel', async (original) => {
  const actual = await original<typeof import('./pinnedLabel')>()
  return {
    ...actual,
    planPinnedText: (input: Parameters<typeof actual.planPinnedText>[0], texts: Parameters<typeof actual.planPinnedText>[1]) => {
      planned.push(texts)
      return actual.planPinnedText(input, texts)
    },
  }
})

const event = (id: string, timestamp: string, description: string): Event => ({
  id,
  description,
  actor: 'Actor',
  target: 'Target',
  timestamp,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
})
const crowd = (count: number): Event[] =>
  Array.from({ length: count }, (_, i) => event(`e${String(i).padStart(2, '0')}`, new Date(Date.UTC(2024, 0, 1, i)).toISOString(), `A rather long title for crowded event number ${i}`))

beforeEach(() => {
  widthPerChar.value = 6.72
  planned.length = 0
  selectionInputs.length = 0
  Object.defineProperty(SVGSVGElement.prototype, 'width', { configurable: true, get: () => ({ baseVal: { value: 1000 } }) })
  Object.defineProperty(SVGSVGElement.prototype, 'height', { configurable: true, get: () => ({ baseVal: { value: 500 } }) })
})
afterEach(() => cleanup())

describe('the selection plate is planned over the full name and its shorter forms', () => {
  it('on the main timeline: 32, 24, 18 and 14 characters, longest first', () => {
    const events = crowd(40)
    for (const ev of events) {
      render(<Timeline events={events} arcs={[]} width={1000} height={500} selectedEventId={ev.id} />)
      cleanup()
      if (planned.length > 0) break
    }
    expect(planned.length).toBeGreaterThan(0)
    const texts = planned[0]!
    expect(texts.map((t) => t.text.length)).toEqual([...texts.map((t) => t.text.length)].sort((a, b) => b - a))
    expect(texts).toHaveLength(4)
    expect(texts[0]!.text.length).toBeGreaterThan(texts[3]!.text.length)
    expect(texts[3]!.text.length).toBeLessThanOrEqual(14)
    expect(texts[0]!.width).toBeGreaterThan(texts[3]!.width)
  })

  it('in the actor view: 32, 24, 18 and 14 characters, longest first', () => {
    const edge: ActorEventData[] = [
      ...['a1', 'a2', 'a3', 'a4', 'a5'].map((id) => ({ ...event(id, '1700-01-01T00:00:00Z', 'Piled at the edge'), role: 'actor' as const, isHighlighted: false })),
      { ...event('first', '1700-01-01T00:00:00Z', 'A selected title long enough to need room'), role: 'actor' as const, isHighlighted: false },
      ...['z1', 'z2', 'z3', 'z4', 'z5'].map((id) => ({ ...event(id, '1900-01-01T00:00:00Z', 'Piled at the edge'), role: 'actor' as const, isHighlighted: false })),
      { ...event('last', '1900-01-01T00:00:00Z', 'A selected title long enough to need room'), role: 'actor' as const, isHighlighted: false },
    ]
    const { container } = render(<ActorTimeline actor="Actor" layoutMode="chronological" events={edge} arcs={[]} width={500} height={400} />)
    for (const id of ['first', 'last']) {
      fireEvent.click(container.querySelector(`.actor-event[data-event-id="${id}"]`)!)
      fireEvent.click(container.querySelector(`.actor-event[data-event-id="${id}"]`)!)
    }
    expect(planned.length).toBeGreaterThan(0)
    const texts = planned[0]!
    expect(texts).toHaveLength(4)
    expect(texts.map((t) => t.text.length)).toEqual([...texts.map((t) => t.text.length)].sort((a, b) => b - a))
    expect(texts[3]!.text.length).toBeLessThanOrEqual(14)
    expect(pinned.PLATE_PAD).toBeGreaterThan(0)
  })
})

describe('the plate follows the fonts', () => {
  it('is measured again when the fonts have loaded: its width changes with the new text widths', () => {
    const events = crowd(40)
    let id: string | null = null
    let container: HTMLElement | null = null
    let rerendered: (() => number) | null = null
    for (const ev of events) {
      const view = render(<Timeline events={events} arcs={[]} width={1000} height={500} selectedEventId={ev.id} />)
      if (view.container.querySelector('[data-pinned-label-for]')) {
        id = ev.id
        container = view.container
        rerendered = () => Number(view.container.querySelector('rect.event-label-plate')!.getAttribute('width'))
        break
      }
      cleanup()
    }
    expect(id, 'a selection that gets a plate').not.toBeNull()
    expect(container).not.toBeNull()
    const before = rerendered!()
    // The real font turns out wider than the first estimate.
    widthPerChar.value = 9
    act(() => fontsLoaded())
    expect(rerendered!()).toBeGreaterThan(before)
  })

  it('is measured again in the actor view too', () => {
    const edge: ActorEventData[] = [
      ...['a1', 'a2', 'a3', 'a4', 'a5'].map((id) => ({ ...event(id, '1700-01-01T00:00:00Z', 'Piled at the edge'), role: 'actor' as const, isHighlighted: false })),
      { ...event('first', '1700-01-01T00:00:00Z', 'A selected title long enough to need room'), role: 'actor' as const, isHighlighted: false },
    ]
    const { container } = render(<ActorTimeline actor="Actor" layoutMode="chronological" events={edge} arcs={[]} width={700} height={400} />)
    fireEvent.click(container.querySelector('.actor-event[data-event-id="first"]')!)
    const plate = () => Number(container.querySelector('[data-pinned-label-for] rect.event-label-plate')?.getAttribute('width'))
    const before = plate()
    expect(before).toBeGreaterThan(0)
    widthPerChar.value = 9
    act(() => fontsLoaded())
    expect(plate()).toBeGreaterThan(before)
  })
})

describe('the plate is planned again when the links change', () => {
  it('follows a link whose ends move, the selection and everything else the same', () => {
    const events = crowd(40)
    const linkA = { id: 'l1', causeId: 'e00', effectId: 'e05', type: 'direct' as const, weight: 0.5 }
    const linkB = { ...linkA, effectId: 'e30' }
    let replanned = 0
    for (const ev of events) {
      selectionInputs.length = 0
      const view = render(<Timeline events={events} arcs={[]} links={[linkA]} width={1000} height={500} selectedEventId={ev.id} />)
      if (selectionInputs.length > 0) {
        const calls = selectionInputs.length
        const before = selectionInputs[calls - 1]!.links[0]!.x2
        view.rerender(<Timeline events={events} arcs={[]} links={[linkB]} width={1000} height={500} selectedEventId={ev.id} />)
        // Where the selection is still unnamed in place, the plate is planned again, over the new link.
        if (selectionInputs.length > calls) {
          replanned++
          expect(selectionInputs[selectionInputs.length - 1]!.links[0]!.x2).not.toBe(before)
        }
      }
      view.unmount()
    }
    expect(replanned, 'a selection planned again after the link changed').toBeGreaterThan(0)
  })
})

describe('the rows the plate is offered', () => {
  const arc = { id: 'a', name: 'An arc', description: '', start_time: '2024-01-01T00:00:00Z', end_time: '2024-01-02T00:00:00Z', level: 0, parent_arc_id: null, created_at: 'x', updated_at: 'x' }
  const firstPlanned = (links: Array<{ id: string; causeId: string; effectId: string; type: 'direct'; weight: number }>, arcs = [arc], ghost?: { label: string; events: Event[]; divergence: Date }) => {
    const events = crowd(40)
    for (const ev of events) {
      selectionInputs.length = 0
      const view = render(<Timeline events={events} arcs={arcs} links={links} ghost={ghost} width={1000} height={500} selectedEventId={ev.id} />)
      view.unmount()
      if (selectionInputs.length > 0) return selectionInputs[0]!
    }
    throw new Error('no selection was planned')
  }

  it('the four label rows, a plate-only row above them, and two rows under the track where links hang there', () => {
    const input = firstPlanned([{ id: 'l1', causeId: 'e00', effectId: 'e39', type: 'direct', weight: 0.5 }])
    expect(input.aboveRows).toEqual([-20, -34, -48, -62])
    expect(input.plateOnlyRows).toEqual([-75.2])
    expect(input.belowRows).toEqual([34, 48])
  })

  it('a plate-only row only where its whole plate lies in the plot and under the arc band and the divergence band', () => {
    // With an arc, the row lies under its bar. With no arcs the plot has 74px above the track, and the row (top at -11.7) would be cut off.
    expect(firstPlanned([], [arc]).plateOnlyRows).toEqual([-75.2])
    expect(firstPlanned([], []).plateOnlyRows).toEqual([])
    // With the divergence band (its labels fill the top 24px) and no arcs, the plate would cover them.
    const ghost = { label: 'Baseline', events: [], divergence: new Date('2024-01-01T10:00:00Z') }
    expect(firstPlanned([], [], ghost).plateOnlyRows).toEqual([])
    expect(firstPlanned([], [arc], ghost).plateOnlyRows).toEqual([-75.2])
  })

  it('and only the one row a track without links keeps under it', () => {
    expect(firstPlanned([]).belowRows).toEqual([24])
  })

  it('tries the rows above alone first where the inspector sheet is docked (below 1024px), and not on a wide screen', () => {
    const original = window.innerWidth
    try {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 })
      expect(firstPlanned([]).preferAbove).toBe(true)
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 })
      expect(firstPlanned([]).preferAbove).toBe(false)
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: original })
    }
  })
})

describe('the point of divergence event', () => {
  it('is the one event protected, though others share its instant; and an event the branch no longer has protects none', () => {
    // Two events at the divergence instant, apart from a dense cluster whose selections find no room in the rows.
    const at = (day: number, minute = 0) => new Date(Date.UTC(2024, 0, 1 + day, 0, minute)).toISOString()
    const events = [
      event('e10', at(0), 'The event the branch diverges at'),
      event('e11', at(0), 'Another event at the same instant'),
      ...Array.from({ length: 40 }, (_, i) => event(`c${String(i).padStart(2, '0')}`, at(30, i), `A rather long title for clustered event number ${i}`)),
    ]
    const divergence = new Date(at(0))
    const protectedAmong = (divergenceEventId: string | null) => {
      const seen: Record<string, boolean | undefined> = {}
      for (const ev of events) {
        selectionInputs.length = 0
        const view = render(<Timeline events={events} arcs={[]} ghost={{ label: 'Baseline', events: [], divergence, divergenceEventId }} width={1000} height={500} selectedEventId={ev.id} />)
        view.unmount()
        for (const label of selectionInputs[0]?.labels ?? []) if (label.id === 'e10' || label.id === 'e11') seen[label.id] = label.protectedLabel
      }
      return seen
    }
    const withEvent = protectedAmong('e10')
    expect(Object.keys(withEvent)).toEqual(expect.arrayContaining(['e10', 'e11']))
    expect(withEvent.e10, 'the divergence event is protected').toBe(true)
    expect(withEvent.e11, 'another event at its instant is not').toBeFalsy()
    const without = protectedAmong('gone')
    expect(Object.keys(without).length).toBeGreaterThan(0)
    expect(without.e10).toBeFalsy()
    expect(without.e11).toBeFalsy()
  })
})

describe('the links the plate is planned over', () => {
  it("are marked traced when they are in the selection's ripple, and only then", () => {
    const events = crowd(40)
    // The effect ends of the chains carry no weight, so their labels go first: selecting one finds no room.
    const links = [
      { id: 'l1', causeId: 'e00', effectId: 'e39', type: 'direct' as const, weight: 0.5 },
      { id: 'l2', causeId: 'e10', effectId: 'e20', type: 'direct' as const, weight: 0.5 },
      { id: 'l3', causeId: 'e20', effectId: 'e30', type: 'direct' as const, weight: 0.5 },
    ]
    let traced = 0
    let untraced = 0
    for (const ev of events) {
      selectionInputs.length = 0
      const view = render(<Timeline events={events} arcs={[]} links={links} width={1000} height={500} selectedEventId={ev.id} />)
      view.unmount()
      const input = selectionInputs[0]
      if (!input) continue
      const ripple = computeRipple(ev.id, links)
      for (const link of input.links) {
        expect(link.traced, `${link.id} for ${ev.id}`).toBe(ripple.links.has(link.id))
        if (link.traced) traced++
        else untraced++
      }
    }
    expect(traced).toBeGreaterThan(0)
    expect(untraced).toBeGreaterThan(0)
  })
})

describe('arc bars as obstacles', () => {
  const arcOf = (id: string, start: string, end: string) => ({ id, name: id, description: '', start_time: start, end_time: end, level: 0, parent_arc_id: null, created_at: 'x', updated_at: 'x' })
  const planned = (arcs: ReturnType<typeof arcOf>[]) => {
    const events = crowd(40)
    for (const ev of events) {
      selectionInputs.length = 0
      const view = render(<Timeline events={events} arcs={arcs} width={1000} height={500} selectedEventId={ev.id} />)
      view.unmount()
      if (selectionInputs.length > 0) return selectionInputs[0]!.softObstacles ?? []
    }
    throw new Error('no selection was planned')
  }

  it('a bar narrower than a plate is an obstacle (a plate over a sliver arc would read as its label); a wide one is not', () => {
    // Four hours of a forty-hour axis (about 90px) against the whole of it.
    const narrow = planned([arcOf('sliver', '2024-01-01T18:00:00Z', '2024-01-01T22:00:00Z')])
    expect(narrow.find((box) => box.id === 'arc:sliver')).toMatchObject({ obstacle: true, protectedLabel: true })
    const wide = planned([arcOf('wide', '2024-01-01T00:00:00Z', '2024-01-02T15:00:00Z')])
    expect(wide.find((box) => box.id === 'arc:wide')).toBeUndefined()
  })
})
