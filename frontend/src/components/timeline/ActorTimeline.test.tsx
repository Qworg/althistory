/**
 * The actor timeline has to survive the names it is given.
 *
 * An actor or partner name is user data, and names like `U.S.`, `Britain &
 * France` or `O'Brien` are ordinary history. The component used to build a
 * CSS selector out of the name (`.actor-event-${groupKey}`), which is not a
 * valid selector for such a name: d3 threw on the first render, so the actor
 * perspective was empty for exactly the actors a history tool has most of.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ActorTimeline, type ActorEventData } from './ActorTimeline'
import { LABEL_ROW_OFFSETS } from './eventLabelLayout'
import { Arc, Event } from '@/types'

function arc(id: string, name: string, start: string, end: string, level = 1): Arc {
  return {
    id,
    name,
    description: '',
    parent_arc_id: null,
    start_time: start,
    end_time: end,
    level,
    created_at: '1776-07-04T00:00:00.000Z',
    updated_at: '1776-07-04T00:00:00.000Z',
  }
}

function actorEvent(
  id: string,
  role: 'actor' | 'target',
  partner: string,
  timestamp = '1776-07-04T00:00:00.000Z'
): ActorEventData {
  const base: Event = {
    id,
    description: `Event ${id}`,
    actor: role === 'actor' ? 'U.S.' : partner,
    target: role === 'actor' ? partner : 'U.S.',
    timestamp,
    created_at: '1776-07-04T00:00:00.000Z',
    updated_at: '1776-07-04T00:00:00.000Z',
  }
  return { ...base, role, isHighlighted: false }
}

describe('ActorTimeline', () => {
  beforeEach(() => {
    // JSDOM implements no SVG geometry. d3's zoom and axis code reads it, so
    // the methods the component touches are installed here -- the same stubs
    // the other timeline tests use.
    Object.defineProperty(SVGElement.prototype, 'getScreenCTM', {
      configurable: true,
      writable: true,
      value: () => ({ inverse: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) }),
    })
    Object.defineProperty(SVGElement.prototype, 'createSVGPoint', {
      configurable: true,
      writable: true,
      value: () => ({ x: 0, y: 0, matrixTransform: () => ({ x: 0, y: 0 }) }),
    })
    Object.defineProperty(SVGElement.prototype, 'getBBox', {
      configurable: true,
      writable: true,
      value: () => ({ x: 0, y: 0, width: 100, height: 20 }),
    })
    // d3-zoom's default extent reads the SVG's width and height, which JSDOM
    // leaves undefined.
    Object.defineProperty(SVGSVGElement.prototype, 'width', {
      configurable: true,
      get: () => ({ baseVal: { value: 800 } }),
    })
    Object.defineProperty(SVGSVGElement.prototype, 'height', {
      configurable: true,
      get: () => ({ baseVal: { value: 400 } }),
    })
  })

  it('renders events grouped under a name that is not a valid CSS class', () => {
    // Thematic layout groups by the partner name, which is what the selector
    // was built from.
    const { container } = render(
      <ActorTimeline
        actor="U.S."
        layoutMode="thematic"
        events={[
          actorEvent('e1', 'actor', 'Britain & France', '1776-07-04T00:00:00.000Z'),
          actorEvent('e2', 'actor', "O'Brien's Company", '1777-01-01T00:00:00.000Z'),
          actorEvent('e3', 'actor', 'U.S.', '1778-01-01T00:00:00.000Z'),
        ]}
        arcs={[]}
      />
    )

    // Every event is drawn, under whatever name it was grouped by.
    expect(container.querySelectorAll('.actor-event')).toHaveLength(3)
  })

  it('renders the chronological layout, whose group keys are plain words', () => {
    const { container } = render(
      <ActorTimeline
        actor="U.S."
        layoutMode="chronological"
        events={[
          actorEvent('e1', 'actor', 'Britain & France', '1776-07-04T00:00:00.000Z'),
          actorEvent('e2', 'target', 'Spain', '1777-01-01T00:00:00.000Z'),
        ]}
        arcs={[]}
      />
    )

    expect(container.querySelectorAll('.actor-event')).toHaveLength(2)
  })

  it('keeps the group name in an attribute rather than in the class', () => {
    const { container } = render(
      <ActorTimeline
        actor="U.S."
        layoutMode="thematic"
        events={[actorEvent('e1', 'actor', 'Britain & France')]}
        arcs={[]}
      />
    )

    const group = container.querySelector('.actor-event-group')
    expect(group).not.toBeNull()
    expect(group?.getAttribute('data-group')).toBe('Britain & France')
  })

  const twoEvents = [
    actorEvent('e1', 'actor', 'Britain', '1776-07-04T00:00:00.000Z'),
    actorEvent('e2', 'target', 'Spain', '1790-01-01T00:00:00.000Z'),
  ]

  it('keeps the event marks when the parent re-renders', () => {
    const { container, rerender } = render(
      <ActorTimeline actor="U.S." layoutMode="chronological" events={twoEvents} arcs={[]} margin={{ top: 20, right: 20, bottom: 60, left: 80 }} />
    )
    expect(container.querySelectorAll('.actor-event')).toHaveLength(2)

    // A fresh margin object with the same values, then a real margin change:
    // the axes are redrawn each time, and the marks must survive both.
    rerender(<ActorTimeline actor="U.S." layoutMode="chronological" events={twoEvents} arcs={[]} margin={{ top: 20, right: 20, bottom: 60, left: 80 }} />)
    expect(container.querySelectorAll('.actor-event')).toHaveLength(2)
    rerender(<ActorTimeline actor="U.S." layoutMode="chronological" events={twoEvents} arcs={[]} margin={{ top: 20, right: 20, bottom: 60, left: 120 }} />)
    expect(container.querySelectorAll('.actor-event')).toHaveLength(2)
    expect(container.querySelectorAll('.x-axis')).toHaveLength(1)
  })

  it('does not repeat the layout name over the chart (the view\'s Layout control names it)', () => {
    render(<ActorTimeline actor="U.S." layoutMode="chronological" events={twoEvents} arcs={[]} />)
    expect(screen.queryByText(/Chronological Layout/i)).not.toBeInTheDocument()
    expect(screen.getByText('As Actor')).toBeInTheDocument()
  })

  describe('axis tick labels', () => {
    const tickTexts = (container: HTMLElement) =>
      Array.from(container.querySelectorAll<SVGTextElement>('.x-axis .tick text'))

    it('stand upright when they fit side by side', () => {
      const spread = [
        actorEvent('e1', 'actor', 'Britain', '1840-01-01T00:00:00.000Z'),
        actorEvent('e2', 'target', 'France', '1880-01-01T00:00:00.000Z'),
      ]
      const { container } = render(
        <ActorTimeline actor="U.S." layoutMode="chronological" events={spread} arcs={[]} width={1000} />
      )
      const ticks = tickTexts(container)
      expect(ticks.length).toBeGreaterThan(1)
      for (const tick of ticks) {
        expect(tick.getAttribute('transform')).toBeNull()
        expect(tick.getAttribute('text-anchor')).toBe('middle')
      }
    })

    it('turn only when they would collide', () => {
      const spread = [
        actorEvent('e1', 'actor', 'Britain', '1840-01-01T00:00:00.000Z'),
        actorEvent('e2', 'target', 'France', '1880-01-01T00:00:00.000Z'),
      ]
      const { container } = render(
        <ActorTimeline actor="U.S." layoutMode="chronological" events={spread} arcs={[]} width={180} margin={{ top: 20, right: 10, bottom: 60, left: 10 }} />
      )
      const ticks = tickTexts(container)
      expect(ticks.length).toBeGreaterThan(1)
      for (const tick of ticks) {
        expect(tick.getAttribute('transform')).toBe('rotate(-45)')
      }
    })
  })

  describe('arc labels', () => {
    const spread = [
      actorEvent('e1', 'actor', 'Britain', '1843-01-01T00:00:00.000Z'),
      actorEvent('e2', 'target', 'France', '1870-01-01T00:00:00.000Z'),
    ]

    it('move overlapping names to separate rows instead of overprinting them', () => {
      // Two arcs with the same span, so their centred names would overprint.
      const { container } = render(
        <ActorTimeline
          actor="U.S."
          layoutMode="chronological"
          events={spread}
          arcs={[
            arc('a1', 'The Calculating Offices', '1845-01-01T00:00:00.000Z', '1860-01-01T00:00:00.000Z', 1),
            arc('a2', 'Engines on the Wire', '1845-01-01T00:00:00.000Z', '1860-01-01T00:00:00.000Z', 1),
          ]}
          width={800}
        />
      )
      const labels = Array.from(container.querySelectorAll<SVGTextElement>('.actor-arc-label'))
      expect(labels).toHaveLength(2)
      expect(labels[0]!.getAttribute('y')).not.toBe(labels[1]!.getAttribute('y'))
    })

    it('keep a name on one row when the bands are apart', () => {
      const { container } = render(
        <ActorTimeline
          actor="U.S."
          layoutMode="chronological"
          events={spread}
          arcs={[
            arc('a1', 'Building', '1843-01-01T00:00:00.000Z', '1850-01-01T00:00:00.000Z'),
            arc('a2', 'The Wire', '1862-01-01T00:00:00.000Z', '1870-01-01T00:00:00.000Z'),
          ]}
          width={800}
        />
      )
      const labels = Array.from(container.querySelectorAll<SVGTextElement>('.actor-arc-label'))
      expect(labels.map((l) => l.textContent)).toEqual(['Building', 'The Wire'])
      expect(new Set(labels.map((l) => l.getAttribute('y'))).size).toBe(1)
    })

    it('keep the event labels below the arc names', () => {
      const ids = Array.from({ length: LABEL_ROW_OFFSETS.length + 1 }, (_, i) => `e${i + 1}`)
      const sameDay = ids.map((id) => actorEvent(id, 'actor', 'Britain', '1850-01-01T00:00:00.000Z'))
      const { container } = render(
        <ActorTimeline
          actor="U.S."
          layoutMode="chronological"
          events={[...sameDay, actorEvent('z', 'target', 'France', '1870-01-01T00:00:00.000Z')]}
          arcs={[
            arc('a1', 'The Calculating Offices', '1845-01-01T00:00:00.000Z', '1860-01-01T00:00:00.000Z'),
            arc('a2', 'Engines on the Wire', '1845-01-01T00:00:00.000Z', '1860-01-01T00:00:00.000Z'),
          ]}
          width={800}
          height={340}
        />
      )
      const arcFloor = Math.max(
        ...Array.from(container.querySelectorAll('.actor-arc-label')).map((l) => Number(l.getAttribute('y')))
      )
      for (const label of Array.from(container.querySelectorAll('.actor-event-label'))) {
        const group = label.closest('.actor-event')!
        const markY = Number(/translate\([^,]+,\s*([-\d.]+)\)/.exec(group.getAttribute('transform') ?? '')![1])
        expect(markY + Number(label.getAttribute('y'))).toBeGreaterThan(arcFloor + 10)
      }
    })
  })

  it('clamps arc bands to the plot area', () => {
    const { container } = render(
      <ActorTimeline
        actor="U.S."
        layoutMode="chronological"
        events={twoEvents}
        arcs={[
          {
            id: 'a1',
            name: 'A long era',
            description: '',
            parent_arc_id: null,
            start_time: '1700-01-01T00:00:00.000Z',
            end_time: '1900-01-01T00:00:00.000Z',
            level: 1,
            created_at: '1776-07-04T00:00:00.000Z',
            updated_at: '1776-07-04T00:00:00.000Z',
          },
        ]}
        width={800}
        margin={{ top: 20, right: 20, bottom: 60, left: 80 }}
      />
    )
    const band = container.querySelector('.actor-arc rect')
    expect(band).not.toBeNull()
    const x = Number(band!.getAttribute('x'))
    const width = Number(band!.getAttribute('width'))
    expect(x).toBe(0)
    expect(x + width).toBeCloseTo(800 - 80 - 20)
  })

  it('labels the tracks without repeating the actor name', () => {
    const { container } = render(
      <ActorTimeline actor="Prussian General Staff" layoutMode="chronological" events={twoEvents} arcs={[]} />
    )
    const labels = Array.from(container.querySelectorAll('.y-axis text')).map((t) => t.textContent)
    expect(labels).toEqual(['As actor', 'As target'])
  })

  describe('React owns the DOM (ADR-001)', () => {
    it('renders the tooltip inside the component, not on document.body', () => {
      const { container } = render(
        <ActorTimeline actor="U.S." layoutMode="chronological" events={twoEvents} arcs={[]} />
      )
      const mark = container.querySelector('.actor-event[data-event-id="e1"]')!
      fireEvent.mouseEnter(mark)

      const tooltip = screen.getByRole('tooltip')
      expect(container.contains(tooltip)).toBe(true)
      expect(tooltip).toHaveTextContent('Event e1')
      expect(tooltip).toHaveTextContent('U.S. as Actor')
      expect(tooltip).toHaveTextContent('Jul 4, 1776')
      // Nothing is appended outside the React tree.
      expect(document.body.querySelectorAll(':scope > .actor-timeline-tooltip')).toHaveLength(0)

      fireEvent.mouseLeave(mark)
      expect(screen.queryByRole('tooltip')).toBeNull()
    })

    it('renders the Fit to View button once, through React', () => {
      const { container, rerender } = render(
        <ActorTimeline actor="U.S." layoutMode="chronological" events={twoEvents} arcs={[]} />
      )
      rerender(<ActorTimeline actor="U.S." layoutMode="thematic" events={twoEvents} arcs={[]} />)
      expect(container.querySelectorAll('.fit-to-view-button')).toHaveLength(1)
      expect(screen.getByRole('button', { name: /Fit to View/ })).toBeInTheDocument()
    })

    it('draws thematic connection lines between events with the same partner', () => {
      const { container } = render(
        <ActorTimeline
          actor="U.S."
          layoutMode="thematic"
          events={[
            actorEvent('e1', 'actor', 'Britain', '1776-07-04T00:00:00.000Z'),
            actorEvent('e2', 'actor', 'Britain', '1777-07-04T00:00:00.000Z'),
            actorEvent('e3', 'actor', 'Britain', '1778-07-04T00:00:00.000Z'),
          ]}
          arcs={[]}
        />
      )
      expect(container.querySelectorAll('.connection-line')).toHaveLength(2)
    })
  })

  describe('event marks', () => {
    it('are keyboard-focusable buttons with a descriptive label', () => {
      render(<ActorTimeline actor="U.S." layoutMode="chronological" events={twoEvents} arcs={[]} />)
      const mark = screen.getByRole('button', { name: /^Event e1, U\.S\. → Britain, Jul 4, 1776 \(U\.S\. as actor\)$/ })
      expect(mark).toHaveAttribute('tabindex', '0')
      expect(mark.querySelector('.event-focus-ring')?.getAttribute('class')).toContain('group-focus-visible:opacity-100')
    })

    it.each(['Enter', ' '])('activate with the %j key like a click', (key) => {
      const onEventSelect = vi.fn()
      const { container } = render(
        <ActorTimeline actor="U.S." layoutMode="chronological" events={twoEvents} arcs={[]} onEventSelect={onEventSelect} />
      )
      const mark = container.querySelector<SVGGElement>('.actor-event[data-event-id="e2"]')!
      const notPrevented = fireEvent.keyDown(mark, { key })

      expect(onEventSelect).toHaveBeenCalledWith(twoEvents[1])
      expect(notPrevented).toBe(false)
      expect(mark).toHaveAttribute('aria-pressed', 'true')
    })

    it('shows the tooltip on keyboard focus', () => {
      const { container } = render(
        <ActorTimeline actor="U.S." layoutMode="chronological" events={twoEvents} arcs={[]} />
      )
      const mark = container.querySelector('.actor-event[data-event-id="e2"]')!
      fireEvent.focus(mark)
      expect(screen.getByRole('tooltip')).toHaveTextContent('U.S. as Target')
      fireEvent.blur(mark)
      expect(screen.queryByRole('tooltip')).toBeNull()
    })

    it('are labelled with their event titles, not a role letter', () => {
      const { container } = render(
        <ActorTimeline
          actor="U.S."
          layoutMode="chronological"
          events={[
            { ...twoEvents[0]!, description: 'Declaration of Independence' },
            { ...twoEvents[1]!, description: 'Treaty with Spain' },
          ]}
          arcs={[]}
        />
      )
      const labels = Array.from(container.querySelectorAll('.actor-event-label')).map((t) => t.textContent)
      expect(labels).toEqual(['Declaration of In…', 'Treaty with Spain'])
      // The role is the lane, the colour and the accessible name.
      const marks = Array.from(container.querySelectorAll('.actor-event'))
      for (const mark of marks) {
        const texts = Array.from(mark.querySelectorAll('text')).map((t) => t.textContent)
        expect(texts).not.toContain('A')
        expect(texts).not.toContain('T')
      }
      expect(screen.getByRole('button', { name: /Treaty with Spain.*\(U\.S\. as target\)$/ })).toBeInTheDocument()
    })

    it('places labels without overprinting, dropping those that do not fit', () => {
      // More events on the same day in one lane than there are label rows:
      // one per row is named, the rest keep their tooltip and accessible name.
      const ids = Array.from({ length: LABEL_ROW_OFFSETS.length + 2 }, (_, i) => `e${i + 1}`)
      const sameDay = ids.map((id) => actorEvent(id, 'actor', 'Britain'))
      const { container } = render(
        <ActorTimeline actor="U.S." layoutMode="chronological" events={sameDay} arcs={[]} />
      )
      const labels = Array.from(container.querySelectorAll<SVGTextElement>('.actor-event-label'))
      expect(labels.length).toBeGreaterThan(0)
      expect(labels.length).toBeLessThan(sameDay.length)
      expect(new Set(labels.map((l) => l.getAttribute('y'))).size).toBe(labels.length)
    })

    it('names the selected mark first and in the selection colour', () => {
      const sameDay = ['e1', 'e2', 'e3', 'e4'].map((id) => actorEvent(id, 'actor', 'Britain'))
      const { container } = render(
        <ActorTimeline actor="U.S." layoutMode="chronological" events={sameDay} arcs={[]} />
      )
      const mark = container.querySelector('.actor-event[data-event-id="e4"]')!
      expect(mark.querySelector('.actor-event-label')).toBeNull()

      fireEvent.click(mark)
      const label = mark.querySelector('.actor-event-label')
      expect(label).toHaveTextContent('Event e4')
      expect(label?.getAttribute('fill')).toBe('var(--accent-selected)')
    })

    it('draws the selected event in indigo, not danger red', () => {
      const onEventSelect = vi.fn()
      const { container } = render(
        <ActorTimeline actor="U.S." layoutMode="chronological" events={twoEvents} arcs={[]} onEventSelect={onEventSelect} />
      )
      const mark = container.querySelector('.actor-event[data-event-id="e1"]')!
      const marker = () => mark.querySelector('.event-marker')!

      expect(marker().getAttribute('fill')).toBe('#3b82f6')
      fireEvent.click(mark)
      expect(onEventSelect).toHaveBeenCalledWith(twoEvents[0])
      expect(marker().getAttribute('fill')).toBe('var(--accent-selected)')
      expect(marker().getAttribute('r')).toBe('8')

      // A second click deselects.
      fireEvent.click(mark)
      expect(marker().getAttribute('fill')).toBe('#3b82f6')
    })
  })
})
