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
const forcedPlan: { value: ReturnType<typeof import('./selectionPlate').planSelectionPlate> } = { value: null }
const planned: Array<ReadonlyArray<{ text: string; width: number }>> = []
type PlateFormInput = { text: string; width: number; ink?: { ascent: number; descent: number }; sizes?: ReadonlyArray<{ fontSize: number; width: number; ink: { ascent: number; descent: number } }> }
const selectionInputs: Array<{ texts: ReadonlyArray<PlateFormInput>; shortTexts?: ReadonlyArray<PlateFormInput>; links: ReadonlyArray<{ id: string; x1: number; x2: number; traced?: boolean }>; belowRows: readonly number[]; plateOnlyRows: readonly number[]; aboveRows: readonly number[]; preferAbove?: boolean; labels: ReadonlyArray<{ id: string; left: number; right: number; top: number; bottom: number; protectedLabel?: boolean; obstacle?: boolean }>; softObstacles?: ReadonlyArray<{ id: string; left: number; right: number; top: number; bottom: number; protectedLabel?: boolean; obstacle?: boolean }> }> = []
vi.mock('./selectionPlate', async (original) => {
  const actual = await original<typeof import('./selectionPlate')>()
  return {
    ...actual,
    planSelectionPlate: (input: Parameters<typeof actual.planSelectionPlate>[0]) => {
      if (forcedPlan.value) return forcedPlan.value
      selectionInputs.push({ texts: input.texts, shortTexts: input.shortTexts, links: input.links, belowRows: input.belowRows, plateOnlyRows: input.plateOnlyRows, aboveRows: input.aboveRows, preferAbove: input.preferAbove, labels: input.labels, softObstacles: input.softObstacles })
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
  forcedPlan.value = null
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
    expect(input.plateOnlyRows).toEqual([-75])
    expect(input.belowRows).toEqual([34, 48])
  })

  it('a plate-only row only where its whole plate lies in the plot and under the arc band and the divergence band', () => {
    // With an arc, the row lies under its bar (the plate's top is the bar's foot).
    expect(firstPlanned([], [arc]).plateOnlyRows).toEqual([-75])
    // With no arcs and no band, the plot has 74px above the track and the plate (top at -10) rises into the top margin, which the clip now includes.
    expect(firstPlanned([], []).plateOnlyRows).toEqual([-75])
    // With a divergence band and no arcs it is offered too, the band's diamond and label being obstacles; with arcs too.
    const ghost = { label: 'Baseline', events: [], divergence: new Date('2024-01-01T10:00:00Z') }
    expect(firstPlanned([], [], ghost).plateOnlyRows).toEqual([-75])
    expect(firstPlanned([], [arc], ghost).plateOnlyRows).toEqual([-75])
    // A margin too small for the plate to rise into it (no arcs, no band) takes the row away.
    const events = crowd(40)
    selectionInputs.length = 0
    for (const ev of events) {
      selectionInputs.length = 0
      const view = render(<Timeline events={events} arcs={[]} margin={{ top: 4, right: 16, bottom: 40, left: 56 }} width={1000} height={500} selectedEventId={ev.id} />)
      view.unmount()
      if (selectionInputs.length > 0) break
    }
    expect(selectionInputs[0]!.plateOnlyRows).toEqual([])
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
  const arcOf = (id: string, start: string, end: string, level = 0) => ({ id, name: id, description: '', start_time: start, end_time: end, level, parent_arc_id: null, created_at: 'x', updated_at: 'x' })
  const planned = (arcs: ReturnType<typeof arcOf>[]) => {
    const events = crowd(40)
    for (const ev of events) {
      selectionInputs.length = 0
      const view = render(<Timeline events={events} arcs={arcs} width={1000} height={500} selectedEventId={ev.id} />)
      const bars = new Map(
        arcs.map((arc) => {
          const ring = view.container.querySelector(`[data-arc-id="${arc.id}"] rect.arc-focus-ring`)
          return [arc.id, ring ? { left: Number(ring.getAttribute('x')) + 3, top: Number(ring.getAttribute('y')) + 3, width: Number(ring.getAttribute('width')) - 6, height: Number(ring.getAttribute('height')) - 6 } : null] as const
        })
      )
      view.unmount()
      if (selectionInputs.length > 0) return { soft: selectionInputs[0]!.softObstacles ?? [], bars }
    }
    throw new Error('no selection was planned')
  }

  it('a bar narrower than a plate is an obstacle where it is drawn (a plate over a sliver arc would read as its label); a wider one is not', () => {
    // Four hours of a forty-hour axis (about 95px), six and a half (about 150px), and the whole of it.
    const { soft, bars } = planned([
      arcOf('sliver', '2024-01-01T18:00:00Z', '2024-01-01T22:00:00Z'),
      arcOf('mid', '2024-01-01T02:00:00Z', '2024-01-01T08:30:00Z'),
      arcOf('wide', '2024-01-01T00:00:00Z', '2024-01-02T15:00:00Z'),
    ])
    const box = soft.find((b) => b.id === 'arc:sliver')!
    expect(box).toMatchObject({ obstacle: true, protectedLabel: true })
    const bar = bars.get('sliver')!
    expect(box.left).toBeCloseTo(bar.left, 0)
    expect(box.right - box.left).toBeCloseTo(bar.width, 0)
    expect(box.top).toBeCloseTo(bar.top, 0)
    // One px past the bar's foot, so a plate that only touches the foot is an overlap.
    expect(box.bottom - box.top).toBeCloseTo(bar.height + 1, 0)
    expect(soft.find((b) => b.id === 'arc:mid'), 'an arc of 150px is wider than a plate').toBeUndefined()
    expect(soft.find((b) => b.id === 'arc:wide')).toBeUndefined()
  })

  it('at the level its bar is drawn: a sliver in a lower row of arcs has its box there', () => {
    // Two overlapping slivers stack in two rows.
    const { soft, bars } = planned([arcOf('a', '2024-01-01T18:00:00Z', '2024-01-01T22:00:00Z'), arcOf('b', '2024-01-01T19:00:00Z', '2024-01-01T23:00:00Z', 1)])
    for (const id of ['a', 'b']) {
      const bar = bars.get(id)
      const box = soft.find((b) => b.id === `arc:${id}`)
      expect(box, id).toBeDefined()
      expect(box!.top).toBeCloseTo(bar!.top, 0)
    }
    expect(bars.get('a')!.top).not.toBe(bars.get('b')!.top)
  })
})

describe('the plate is planned again when what it depends on changes', () => {
  const arcOf = (id: string, start: string, end: string) => ({ id, name: id, description: '', start_time: start, end_time: end, level: 0, parent_arc_id: null, created_at: 'x', updated_at: 'x' })
  /**
   * Render a selection with `first`, then `second` over it (same selection, same everything else): the input of the
   * last plan, for the first selection that is still planned after the change.
   */
  const afterChange = (first: Partial<React.ComponentProps<typeof Timeline>>, second: Partial<React.ComponentProps<typeof Timeline>>) => {
    const events = crowd(40)
    for (const ev of events) {
      selectionInputs.length = 0
      const props = { events, arcs: [], width: 1000, height: 500, selectedEventId: ev.id }
      const view = render(<Timeline {...props} {...first} />)
      const calls = selectionInputs.length
      if (calls > 0) {
        const before = selectionInputs[calls - 1]!
        view.rerender(<Timeline {...props} {...second} />)
        if (selectionInputs.length > calls) {
          const result = { before, after: selectionInputs[selectionInputs.length - 1]! }
          view.unmount()
          return result
        }
      }
      view.unmount()
    }
    throw new Error('no selection was planned again')
  }

  it('when an arc changes (a narrow one is drawn elsewhere)', () => {
    const { before, after } = afterChange(
      { arcs: [arcOf('s', '2024-01-01T18:00:00Z', '2024-01-01T22:00:00Z')] },
      { arcs: [arcOf('s', '2024-01-01T02:00:00Z', '2024-01-01T06:00:00Z')] }
    )
    expect(after.softObstacles![0]!.left).not.toBe(before.softObstacles![0]!.left)
  })

  it('when the layout\'s limit changes with nothing else moving (a top margin too small to rise into)', () => {
    const { before, after } = afterChange({ margin: { top: 16, right: 16, bottom: 40, left: 56 } }, { margin: { top: 4, right: 16, bottom: 40, left: 56 } })
    expect(before.plateOnlyRows).toEqual([-75])
    expect(after.plateOnlyRows).toEqual([])
  })

  it('when the divergence event changes', () => {
    const base = crowd(40)
    // The same instant (one Date): only the event the divergence names changes.
    const divergence = new Date(base[10]!.timestamp)
    const ghostEvents: Event[] = []
    const ghostOf = (divergenceEventId: string) => ({ label: 'Baseline', events: ghostEvents, divergence, divergenceEventId })
    const { before, after } = afterChange({ ghost: ghostOf('e10') }, { ghost: ghostOf('e11') })
    const flag = (input: typeof before, id: string) => input.labels.find((l) => l.id === id)?.protectedLabel
    expect(flag(before, 'e10')).toBe(true)
    expect(flag(after, 'e10')).toBeFalsy()
  })
})

describe('the divergence band\'s landmarks, as obstacles', () => {
  type Obstacle = { id: string; left: number; right: number; top: number; bottom: number; protectedLabel?: boolean; obstacle?: boolean }
  const planned = (props: Partial<React.ComponentProps<typeof Timeline>>) => {
    const events = crowd(40)
    for (const ev of events) {
      selectionInputs.length = 0
      const view = render(<Timeline events={events} arcs={[]} width={1000} height={500} selectedEventId={ev.id} {...props} />)
      if (selectionInputs.length > 0) {
        const captured = selectionInputs[0]!
        const centre = (selector: string) => Number(/M ([-\d.e]+)/.exec(view.container.querySelector(selector)!.getAttribute('d')!)![1])
        const out = { labels: captured.labels as readonly Obstacle[], soft: (captured.softObstacles ?? []) as readonly Obstacle[], divergenceX: view.container.querySelector('.timeline-divergence path') ? centre('.timeline-divergence path') : null, markX: view.container.querySelector('.timeline-branch-mark path') ? centre('.timeline-branch-mark path') : null, divergenceText: view.container.querySelector('.timeline-divergence text')?.textContent ?? '' }
        view.unmount()
        return out
      }
      view.unmount()
    }
    throw new Error('no selection was planned')
  }
  const events = crowd(40)
  const divergenceAt = (index: number) => ({ label: 'Baseline', events: [], divergence: new Date(events[index]!.timestamp), divergenceEventId: null })

  it('the divergence diamond and its label, sized from the measured text, on the side the drawn label takes', () => {
    widthPerChar.value = 9
    for (const [index, labelBefore] of [[3, false], [36, true]] as const) {
      const { labels, soft, divergenceX, divergenceText } = planned({ ghost: divergenceAt(index) })
      const diamond = labels.find((l) => l.id === 'band:divergence:diamond')!
      const label = labels.find((l) => l.id === 'band:divergence:label')!
      for (const box of [diamond, label]) {
        expect(box, `event ${index}`).toMatchObject({ obstacle: true, protectedLabel: true })
        expect(soft.find((o) => o.id === box.id), 'hard, not soft').toBeUndefined()
      }
      // A diamond of 12px in a band 24px deep, boxed with a pixel to spare.
      expect(diamond).toMatchObject({ left: divergenceX! - 7, right: divergenceX! + 7, top: 5, bottom: 19 })
      // The label: its measured width (9px a character here, not the 0.56em estimate), after the diamond or before it.
      const width = divergenceText.length * 9
      expect(label.right - label.left).toBeCloseTo(width, 3)
      if (labelBefore) expect(label.right).toBeCloseTo(divergenceX! - 10, 3)
      else expect(label.left).toBeCloseTo(divergenceX! + 10, 3)
      expect(label.top).toBeCloseTo(12 + 4 - 12 * 0.8, 3)
      expect(label.bottom).toBe(19)
    }
  })

  it('a branch mark\'s diamond and label, the label before it past 70% of the width', () => {
    widthPerChar.value = 9
    for (const [index, labelBefore] of [[3, false], [36, true]] as const) {
      const mark = { id: 'bm', label: 'WWII MEMORIAL', date: new Date(events[index]!.timestamp) }
      const { labels, markX } = planned({ branchMarks: [mark] })
      const diamond = labels.find((l) => l.id === 'band:bm:diamond')!
      const label = labels.find((l) => l.id === 'band:bm:label')!
      expect(diamond).toMatchObject({ left: markX! - 7, right: markX! + 7, top: 5, bottom: 19, obstacle: true, protectedLabel: true })
      expect(label).toMatchObject({ obstacle: true, protectedLabel: true })
      expect(label.right - label.left).toBeCloseTo(mark.label.length * 9, 3)
      if (labelBefore) expect(label.right).toBeCloseTo(markX! - 10, 3)
      else expect(label.left).toBeCloseTo(markX! + 10, 3)
    }
  })
})

describe('the band\'s label sides differ between 60% and 70% of the width', () => {
  it('the divergence label is before its diamond past 60% and a branch mark\'s only past 70%', () => {
    widthPerChar.value = 9
    const events = crowd(40)
    const planned = (props: Partial<React.ComponentProps<typeof Timeline>>) => {
      for (const ev of events) {
        selectionInputs.length = 0
        const view = render(<Timeline events={events} arcs={[]} width={1000} height={500} selectedEventId={ev.id} {...props} />)
        if (selectionInputs.length > 0) {
          const out = { labels: selectionInputs[0]!.labels, view }
          return out
        }
        view.unmount()
      }
      throw new Error('no selection was planned')
    }
    // Find the event whose x lies between 60% and 70% of the plot (928px).
    let index = -1
    for (const candidate of [24, 25, 26, 27, 28, 29]) {
      const probe = planned({ ghost: { label: 'B', events: [], divergence: new Date(events[candidate]!.timestamp), divergenceEventId: null } })
      const cx = Number(/M ([-\d.e]+)/.exec(probe.view.container.querySelector('.timeline-divergence path')!.getAttribute('d')!)![1])
      probe.view.unmount()
      if (cx / 928 > 0.62 && cx / 928 < 0.68) {
        index = candidate
        break
      }
    }
    expect(index, 'an event between 60% and 70% of the width').toBeGreaterThan(0)
    const date = new Date(events[index]!.timestamp)
    const div = planned({ ghost: { label: 'B', events: [], divergence: date, divergenceEventId: null } })
    const divX = Number(/M ([-\d.e]+)/.exec(div.view.container.querySelector('.timeline-divergence path')!.getAttribute('d')!)![1])
    const divLabel = div.labels.find((l) => l.id === 'band:divergence:label')!
    expect(divLabel.right, 'before the diamond').toBeCloseTo(divX - 10, 3)
    div.view.unmount()
    const mark = planned({ branchMarks: [{ id: 'bm', label: 'A mark', date }] })
    const markX = Number(/M ([-\d.e]+)/.exec(mark.view.container.querySelector('.timeline-branch-mark path')!.getAttribute('d')!)![1])
    const markLabel = mark.labels.find((l) => l.id === 'band:bm:label')!
    expect(markLabel.left, 'after the diamond').toBeCloseTo(markX + 10, 3)
  })
})

describe('the plate is planned again when the band changes', () => {
  const afterChange = (first: Partial<React.ComponentProps<typeof Timeline>>, second: Partial<React.ComponentProps<typeof Timeline>>) => {
    const events = crowd(40)
    for (const ev of events) {
      selectionInputs.length = 0
      const props = { events, arcs: [], width: 1000, height: 500, selectedEventId: ev.id }
      const view = render(<Timeline {...props} {...first} />)
      const calls = selectionInputs.length
      if (calls > 0) {
        view.rerender(<Timeline {...props} {...second} />)
        if (selectionInputs.length > calls) {
          const out = { before: selectionInputs[calls - 1]!, after: selectionInputs[selectionInputs.length - 1]! }
          view.unmount()
          return out
        }
      }
      view.unmount()
    }
    throw new Error('no selection was planned again')
  }
  const events = crowd(40)
  const ghostEvents: Event[] = []
  const ghostAt = (index: number) => ({ label: 'Baseline', events: ghostEvents, divergence: new Date(events[index]!.timestamp), divergenceEventId: null })

  it('when the divergence moves', () => {
    const { before, after } = afterChange({ ghost: ghostAt(5) }, { ghost: ghostAt(30) })
    const at = (input: typeof before) => input.labels.find((l) => l.id === 'band:divergence:diamond')!.left
    expect(at(after)).not.toBe(at(before))
  })

  it('when a branch mark moves', () => {
    const mark = (index: number) => ({ id: 'bm', label: 'A branch', date: new Date(events[index]!.timestamp) })
    const { before, after } = afterChange({ branchMarks: [mark(5)] }, { branchMarks: [mark(30)] })
    const at = (input: typeof before) => input.labels.find((l) => l.id === 'band:bm:diamond')!.left
    expect(at(after)).not.toBe(at(before))
  })
})

describe('the sizes and short forms the plate is offered (#41, #42)', () => {
  const selectAll = (events: Event[], until: (container: HTMLElement) => boolean) => {
    for (const ev of events) {
      const view = render(<Timeline events={events} arcs={[]} width={1000} height={500} selectedEventId={ev.id} />)
      if (until(view.container)) return view.container
      cleanup()
    }
    return null
  }
  const accented = (count: number): Event[] =>
    Array.from({ length: count }, (_, i) => event(`e${String(i).padStart(2, '0')}`, new Date(Date.UTC(2024, 0, 1, i)).toISOString(), `Ångström reforms the engine office number ${i}`))

  it('offers every form the sizes from 11.5px down to 10px in half-pixel steps, measured at each size', () => {
    selectAll(accented(40), () => selectionInputs.length > 0)
    const form = selectionInputs[0]!.texts[0]!
    expect(form.sizes!.map((size) => size.fontSize)).toEqual([11.5, 11, 10.5, 10])
    // The usual size's ink is an accented capital's, taller than the plate-only plate's 9 (and half the stroke).
    expect(form.ink!.ascent).toBeGreaterThan(pinned.PLATE_ONLY_ASCENT + pinned.PLATE_INK_SLACK)
    // Each size is measured at that size: narrower as it gets smaller (here by the mocked width per character, so the same: the width is of the text).
    for (const size of form.sizes!) expect(size.width).toBe(form.width)
    for (const input of selectionInputs) for (const f of input.texts) expect(f.sizes!.map((size) => size.fontSize)).toEqual([11.5, 11, 10.5, 10])
  })

  it('draws the pinned text at the size and baseline the plan gives: smaller, and lifted, with the plate shortened', () => {
    forcedPlan.value = { text: 'Ångström…', plan: { offset: -75, anchor: 'middle', left: 100, right: 160, ascent: 9, descent: 1, fontSize: 10.5, lift: 0.5, hidden: [], crossings: 0, tracedHits: 0 } }
    const container = selectAll(crowd(40), (c) => c.querySelector('[data-pinned-label-for]') !== null)
    expect(container, 'a selection that is pinned').not.toBeNull()
    const text = container!.querySelector('[data-pinned-label-for] text')!
    const rect = container!.querySelector('rect.event-label-plate')!
    expect(text.getAttribute('font-size')).toBe('10.5')
    // The plate reaches 9 above the row's baseline and 1 below; the text's baseline is half a pixel above it.
    expect(Number(rect.getAttribute('height'))).toBe(10)
    expect(Number(text.getAttribute('y')) - Number(rect.getAttribute('y'))).toBeCloseTo(8.5)
    // Without them it is drawn at the usual size on the row's baseline.
    cleanup()
    forcedPlan.value = { text: 'Ångström…', plan: { offset: -75, anchor: 'middle', left: 100, right: 160, ascent: 9, descent: 3, hidden: [], crossings: 0, tracedHits: 0 } }
    const plain = selectAll(crowd(40), (c) => c.querySelector('[data-pinned-label-for]') !== null)!
    expect(plain.querySelector('[data-pinned-label-for] text')!.getAttribute('font-size')).toBe('12')
    expect(Number(plain.querySelector('[data-pinned-label-for] text')!.getAttribute('y')) - Number(plain.querySelector('rect.event-label-plate')!.getAttribute('y'))).toBeCloseTo(9)
  })

  it('offers the shorter forms, cut at word ends, of a name the ordinary forms leave long', () => {
    const named = Array.from({ length: 40 }, (_, i) => event(`e${String(i).padStart(2, '0')}`, new Date(Date.UTC(2024, 0, 1, i)).toISOString(), `Prussia in a war that will not end ${i}`))
    selectAll(named, () => selectionInputs.length > 0)
    const short = selectionInputs[0]!.shortTexts!
    expect(short.map((form) => form.text)).toEqual(['Prussia in…'])
    expect(selectionInputs[0]!.texts.map((form) => form.text)).not.toContain('Prussia in…')
  })
})
