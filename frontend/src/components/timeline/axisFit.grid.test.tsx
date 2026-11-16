/**
 * Every time axis without a world calendar, before 1 CE and in deep time, at
 * the widths the app is used at: the main timeline, the actor view and the
 * counterfactual canvas, from a single event's default view (twenty seconds)
 * and the one-second zoom to a fortnight and two hundred million years.
 *
 * On each axis: at least one label, or the caption under it, names a date;
 * no label runs past the SVG or overprints its neighbour; the actor view's
 * labels stand upright; and every date the axis writes reads back, where a
 * person types it, as the moment (or the day) it marks.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { readDateBound, readHistoricalText, toAxisTime } from '@althistory/calendar'
import { ActorTimeline, type ActorEventData } from './ActorTimeline'
import { Timeline } from './Timeline'
import { CounterfactualTimelineCanvas } from '@/components/branch/CounterfactualTimelineCanvas'
import { AXIS_LABEL_CHAR_PX, axisTicks, fitAxis, isBareTime } from '@/utils/d3Calculations'
import { DEFAULT_ACTOR_MARGIN, DEFAULT_TIMELINE_MARGIN, mainAxisMaxTicks } from './timelineLayout'
import { counterfactualMargin } from '@/components/branch/counterfactualAxis'
import { labelExtent } from '@/utils/axisLabelFit'
import type { Event } from '@/types'

const event = (id: string, timestamp: string): Event => ({
  id,
  description: `Event ${id}`,
  actor: 'Actor',
  target: 'Target',
  timestamp,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
})

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
  Object.defineProperty(SVGSVGElement.prototype, 'width', { configurable: true, get: () => ({ baseVal: { value: 900 } }) })
  Object.defineProperty(SVGSVGElement.prototype, 'height', { configurable: true, get: () => ({ baseVal: { value: 400 } }) })
})
afterEach(() => cleanup())

interface Drawn {
  label: string
  x: number
  anchor: 'start' | 'middle' | 'end'
}

const WIDTHS = [360, 600, 1000, 1300]

/** The x the main timeline's SVG reaches each side of its plot at a width: its own margins. */
const mainRoom = (width: number) => ({ left: -DEFAULT_TIMELINE_MARGIN.left, right: width - DEFAULT_TIMELINE_MARGIN.left })

const HISTORIES: Array<[string, string[]]> = [
  ['one event in 44 BCE (its twenty-second view)', ['-000043-03-15T12:00:00.000Z']],
  ['one event at midnight, 44 BCE (a view across it)', ['-000043-03-15T00:00:00.000Z']],
  ['three hours of 44 BCE', ['-000043-03-15T12:00:00.000Z', '-000043-03-15T15:00:00.000Z']],
  ['a night of 44 BCE', ['-000043-03-14T22:00:00.000Z', '-000043-03-15T02:00:00.000Z']],
  ['a fortnight of 44 BCE', ['-000043-03-01T00:00:00.000Z', '-000043-03-14T12:00:00.000Z']],
  ['a fortnight of 9000 BCE', ['-008999-03-01T00:00:00.000Z', '-008999-03-14T12:00:00.000Z']],
  ['one event in 50,000 BCE (deep time)', ['-049999-03-15T12:00:00.000Z']],
  ['three hours of 50,000 BCE', ['-049999-03-15T12:00:00.000Z', '-049999-03-15T15:00:00.000Z']],
  ['an hour across a deep-time month start', ['-065999999-06-30T23:30:00.000Z', '-065999999-07-01T00:30:00.000Z']],
  ['three hours from a deep-time month start', ['-065999999-07-01T00:00:00.000Z', '-065999999-07-01T03:00:00.000Z']],
  ['two hundred million years', ['-249999999-01-01T00:00:00.000Z', '-065999999-01-01T00:00:00.000Z']],
]

/** A label read back as a person types it: the moment it marks, or the day. */
function readBack(label: string): bigint | null {
  const read = / \d{2}:\d{2}(:\d{2}(\.\d{3})?)?$/.test(label) ? readHistoricalText(label, 'start') : readDateBound(label, 'start', null)
  return read.ok ? read.time : null
}

/** What every axis must hold to; `room` is the x the SVG reaches each side of the plot. */
function expectReadable(axis: string, drawn: readonly Drawn[], caption: string | null, room: { left: number; right: number }, charPx: number) {
  const dated = drawn.filter((tick) => !isBareTime(tick.label))
  expect(dated.length > 0 || Boolean(caption), `${axis}: no date (${JSON.stringify(drawn.map((t) => t.label))})`).toBe(true)
  const sorted = [...drawn].sort((a, b) => a.x - b.x)
  for (const [i, tick] of sorted.entries()) {
    const [left, right] = labelExtent(tick, charPx)
    expect(left, `${axis}: "${tick.label}" runs off the left`).toBeGreaterThanOrEqual(room.left - 0.5)
    expect(right, `${axis}: "${tick.label}" runs off the right`).toBeLessThanOrEqual(room.right + 0.5)
    if (i > 0) expect(left, `${axis}: "${tick.label}" overprints "${sorted[i - 1]!.label}"`).toBeGreaterThanOrEqual(labelExtent(sorted[i - 1]!, charPx)[1])
  }
  for (const tick of dated) expect(readBack(tick.label), `${axis}: "${tick.label}" does not read back`).not.toBeNull()
  for (const day of caption?.split(' – ') ?? []) expect(readDateBound(day, 'start', null).ok, `${axis}: caption "${day}"`).toBe(true)
}

function drawnTicks(container: HTMLElement, selector: string): Drawn[] {
  return Array.from(container.querySelectorAll<SVGTextElement>(selector)).map((text) => ({
    label: text.textContent ?? '',
    x: Number(/translate\(\s*([-\d.e]+)/.exec(text.parentElement?.getAttribute('transform') ?? '')?.[1]),
    anchor: (text.getAttribute('text-anchor') ?? 'middle') as Drawn['anchor'],
  }))
}

describe('every time axis before 1 CE and in deep time', () => {
  for (const [history, stamps] of HISTORIES) {
    for (const width of WIDTHS) {
      it(`main timeline, ${history}, at ${width} px`, () => {
        const { container } = render(<Timeline events={stamps.map((t, i) => event(`e${i}`, t))} arcs={[]} width={width} height={400} />)
        const drawn = drawnTicks(container, 'text.axis-tick')
        const caption = container.querySelector('.axis-day-caption')?.textContent ?? null
        expectReadable(`main ${history} ${width}`, drawn, caption, mainRoom(width), AXIS_LABEL_CHAR_PX)
      })

      it(`actor view, ${history}, at ${width} px`, () => {
        const events: ActorEventData[] = stamps.map((t, i) => ({ ...event(`e${i}`, t), role: 'actor' as const, isHighlighted: false }))
        const { container } = render(<ActorTimeline actor="Actor" layoutMode="chronological" events={events} arcs={[]} width={width} height={400} />)
        const texts = Array.from(container.querySelectorAll('.x-axis text.axis-tick'))
        expect(texts.every((text) => !text.getAttribute('transform')), `actor ${history} ${width}: labels turned`).toBe(true)
        const drawn = drawnTicks(container, '.x-axis text.axis-tick')
        const caption = container.querySelector('.x-axis .axis-day-caption')?.textContent ?? null
        expectReadable(`actor ${history} ${width}`, drawn, caption, { left: -DEFAULT_ACTOR_MARGIN.left, right: width - DEFAULT_ACTOR_MARGIN.left }, 6.6)
      })

      it(`counterfactual canvas, ${history}, at ${width} px`, () => {
        const events = stamps.map((t, i) => event(`e${i}`, t))
        const { container } = render(
          <CounterfactualTimelineCanvas
            baselineName="Rome"
            counterfactualName="Branch"
            baselineEvents={events}
            counterfactualEvents={events}
            baselineCalendar={null}
            counterfactualCalendar={null}
            width={width}
          />
        )
        const drawn = drawnTicks(container, 'text.axis-tick')
        const margin = counterfactualMargin(width)
        expectReadable(`counterfactual ${history} ${width}`, drawn, null, { left: -margin.left, right: Math.max(100, width - margin.left - margin.right) + margin.right }, AXIS_LABEL_CHAR_PX)
      })
    }
  }

  it('names the day under the main axis as the view zooms and pans', () => {
    // A night of 44 BCE across midnight, 22:00 to 02:00.
    const { container } = render(
      <Timeline events={['-000043-03-14T22:00:00.000Z', '-000043-03-15T02:00:00.000Z'].map((t, i) => event(`n${i}`, t))} arcs={[]} width={1000} height={400} />
    )
    const svg = container.querySelector('svg')!
    const caption = () => container.querySelector('.axis-day-caption')?.textContent ?? null
    const labels = () => Array.from(container.querySelectorAll('text.axis-tick')).map((text) => text.textContent)
    // Zoom in at the left end of the plot: the view shrinks onto the evening of the 14th.
    act(() => {
      svg.dispatchEvent(new WheelEvent('wheel', { deltaY: -200, clientX: 60, clientY: 200, ctrlKey: true, bubbles: true, cancelable: true }))
    })
    expect(caption(), JSON.stringify(labels())).toBe('44-03-14 BCE')
    // Pan toward the later hours, a step at a time: the caption takes in midnight, then only the 15th.
    const seen = new Set<string | null>()
    for (let step = 0; step < 120; step++) {
      fireEvent.keyDown(svg, { key: 'ArrowRight' })
      seen.add(caption())
    }
    expect([...seen]).toContain('44-03-14 BCE – 44-03-15 BCE')
    expect(caption(), JSON.stringify(labels())).toBe('44-03-15 BCE')
    // Every label that names a date reads back as itself in the day the caption names.
    for (const label of labels()) if (label && !isBareTime(label)) expect(readBack(label), label).not.toBeNull()
  })

  it('fits the main timeline zoomed in to one second, before 1 CE and in deep time', () => {
    for (const [from, to] of [
      ['-000043-03-15T11:59:59.500Z', '-000043-03-15T12:00:00.500Z'],
      ['-000043-03-14T23:59:59.500Z', '-000043-03-15T00:00:00.500Z'],
      ['-049999-03-15T11:59:59.500Z', '-049999-03-15T12:00:00.500Z'],
    ] as const) {
      for (const width of WIDTHS) {
        const inner = width - DEFAULT_TIMELINE_MARGIN.left - DEFAULT_TIMELINE_MARGIN.right
        const domain: [Date, Date] = [new Date(from), new Date(to)]
        const span = Number(toAxisTime(domain[1])! - toAxisTime(domain[0])!)
        const x = (date: Date) => (Number(toAxisTime(date)! - toAxisTime(domain[0])!) / span) * inner
        const maxTicks = mainAxisMaxTicks(inner)
        const ticks = axisTicks(domain, maxTicks > 0 ? maxTicks : 5, null).map((tick) => ({ ...tick, x: x(tick.date) }))
        const fitted = fitAxis(ticks, null, mainRoom(width), domain)
        expectReadable(`zoom ${from} ${width}`, fitted.ticks, fitted.caption, mainRoom(width), AXIS_LABEL_CHAR_PX)
        for (const tick of fitted.ticks) {
          if (!isBareTime(tick.label)) expect(readBack(tick.label), tick.label).toBe(toAxisTime(tick.date))
        }
      }
    }
  })
})
