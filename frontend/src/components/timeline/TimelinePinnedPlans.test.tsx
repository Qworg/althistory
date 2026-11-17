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
import type { Event } from '@/types'

const widthPerChar = { value: 6.72 }
vi.mock('./labelWidth', async (original) => ({
  ...(await original<typeof import('./labelWidth')>()),
  measureLabelWidth: (text: string) => text.length * widthPerChar.value,
}))
const planned: Array<ReadonlyArray<{ text: string; width: number }>> = []
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
