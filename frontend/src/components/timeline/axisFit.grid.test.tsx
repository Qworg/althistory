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
import { cleanup, render } from '@testing-library/react'
import { readDateBound, readHistoricalText, toAxisTime } from '@althistory/calendar'
import { ActorTimeline, type ActorEventData } from './ActorTimeline'
import { Timeline } from './Timeline'
import { CounterfactualTimelineCanvas } from '@/components/branch/CounterfactualTimelineCanvas'
import { axisTicks, fitAxis, isBareTime } from '@/utils/d3Calculations'
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

const HISTORIES: Array<[string, string[]]> = [
  ['one event in 44 BCE (its twenty-second view)', ['-000043-03-15T12:00:00.000Z']],
  ['one event at midnight, 44 BCE (a view across it)', ['-000043-03-15T00:00:00.000Z']],
  ['three hours of 44 BCE', ['-000043-03-15T12:00:00.000Z', '-000043-03-15T15:00:00.000Z']],
  ['a night of 44 BCE', ['-000043-03-14T22:00:00.000Z', '-000043-03-15T02:00:00.000Z']],
  ['a fortnight of 44 BCE', ['-000043-03-01T00:00:00.000Z', '-000043-03-14T12:00:00.000Z']],
  ['a fortnight of 9000 BCE', ['-008999-03-01T00:00:00.000Z', '-008999-03-14T12:00:00.000Z']],
  ['one event in 50,000 BCE (deep time)', ['-049999-03-15T12:00:00.000Z']],
  ['three hours of 50,000 BCE', ['-049999-03-15T12:00:00.000Z', '-049999-03-15T15:00:00.000Z']],
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
        expectReadable(`main ${history} ${width}`, drawn, caption, { left: -56, right: width - 56 }, 7.2)
      })

      it(`actor view, ${history}, at ${width} px`, () => {
        const events: ActorEventData[] = stamps.map((t, i) => ({ ...event(`e${i}`, t), role: 'actor' as const, isHighlighted: false }))
        const { container } = render(<ActorTimeline actor="Actor" layoutMode="chronological" events={events} arcs={[]} width={width} height={400} />)
        const texts = Array.from(container.querySelectorAll('.x-axis text.axis-tick'))
        expect(texts.every((text) => !text.getAttribute('transform')), `actor ${history} ${width}: labels turned`).toBe(true)
        const drawn = drawnTicks(container, '.x-axis text.axis-tick')
        const caption = container.querySelector('.x-axis .axis-day-caption')?.textContent ?? null
        expectReadable(`actor ${history} ${width}`, drawn, caption, { left: -80, right: width - 80 }, 6.6)
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
        const margin = width < 560 ? { left: 96, right: 16 } : { left: 140, right: 32 }
        expectReadable(`counterfactual ${history} ${width}`, drawn, null, { left: -margin.left, right: width - margin.left }, 7.2)
      })
    }
  }

  it('fits the main timeline zoomed in to one second, before 1 CE and in deep time', () => {
    for (const [from, to] of [
      ['-000043-03-15T11:59:59.500Z', '-000043-03-15T12:00:00.500Z'],
      ['-000043-03-14T23:59:59.500Z', '-000043-03-15T00:00:00.500Z'],
      ['-049999-03-15T11:59:59.500Z', '-049999-03-15T12:00:00.500Z'],
    ] as const) {
      for (const width of WIDTHS) {
        const inner = width - 72
        const domain: [Date, Date] = [new Date(from), new Date(to)]
        const span = Number(toAxisTime(domain[1])! - toAxisTime(domain[0])!)
        const x = (date: Date) => (Number(toAxisTime(date)! - toAxisTime(domain[0])!) / span) * inner
        const maxTicks = Math.min(10, Math.floor(inner / 96))
        const ticks = axisTicks(domain, maxTicks > 0 ? maxTicks : 5, null).map((tick) => ({ ...tick, x: x(tick.date) }))
        const fitted = fitAxis(ticks, null, { left: -56, right: inner + 16 }, domain)
        expectReadable(`zoom ${from} ${width}`, fitted.ticks, fitted.caption, { left: -56, right: inner + 16 }, 7.2)
        for (const tick of fitted.ticks) {
          if (!isBareTime(tick.label)) expect(readBack(tick.label), tick.label).toBe(toAxisTime(tick.date))
        }
      }
    }
  })
})
