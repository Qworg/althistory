/**
 * The actor timeline has to survive the names it is given.
 *
 * An actor or partner name is user data, and names like `U.S.`, `Britain &
 * France` or `O'Brien` are ordinary history. The component used to build a
 * CSS selector out of the name (`.actor-event-${groupKey}`), which is not a
 * valid selector for such a name: d3 threw on the first render, so the actor
 * perspective was empty for exactly the actors a history tool has most of.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { ActorTimeline, type ActorEventData } from './ActorTimeline'
import { Event } from '@/types'

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
})
