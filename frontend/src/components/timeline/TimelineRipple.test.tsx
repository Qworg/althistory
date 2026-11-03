import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Timeline } from './Timeline'
import type { TimelineLink } from './timelineLinks'
import type { Event } from '@/types'

/**
 * The causal layer of the timeline: the link band, the ripple of a selection,
 * the shape that carries an event's confidence, and a branch's after-split wash.
 */

const makeEvent = (id: string, timestamp: string, confidence?: number): Event => ({
  id,
  description: `Event ${id}`,
  actor: 'Actor',
  target: 'Target',
  timestamp,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  ...(confidence !== undefined ? { metadata: { confidence } } : {}),
})

const events = [
  makeEvent('a', '2024-01-01T00:00:00Z'),
  makeEvent('b', '2024-03-01T00:00:00Z', 0.6),
  makeEvent('c', '2024-06-01T00:00:00Z', 0.2),
  makeEvent('d', '2024-09-01T00:00:00Z'),
  makeEvent('lone', '2024-11-01T00:00:00Z'),
]

const links: TimelineLink[] = [
  { id: 'ab', causeId: 'a', effectId: 'b', type: 'direct', weight: 0.9 },
  { id: 'bc', causeId: 'b', effectId: 'c', type: 'indirect', weight: 0.4 },
  { id: 'cd', causeId: 'c', effectId: 'd', type: 'contributory', weight: 0.5 },
  { id: 'gone', causeId: 'a', effectId: 'not-on-canvas', type: 'direct', weight: 1 },
]

const linkPaths = () => [...document.querySelectorAll<SVGPathElement>('.timeline-link')]
const markOf = (id: string) => document.querySelector(`[data-event-id="${id}"]`)!

describe('Timeline causal links', () => {
  it('draws one path per link between two events on the canvas, styled by type', () => {
    render(<Timeline events={events} arcs={[]} width={800} links={links} />)
    const paths = linkPaths()
    expect(paths.map((p) => p.dataset.linkId)).toEqual(['ab', 'bc', 'cd'])
    expect(paths[0]).not.toHaveAttribute('stroke-dasharray')
    expect(paths[1]).toHaveAttribute('stroke-dasharray', '6 4')
    // Heavier links draw thicker
    expect(Number(paths[0]!.getAttribute('stroke-width'))).toBeGreaterThan(Number(paths[1]!.getAttribute('stroke-width')))
  })

  it('reserves no link band when there is nothing to draw', () => {
    const { container, rerender } = render(<Timeline events={events} arcs={[]} width={800} />)
    const plain = Number(container.querySelector('svg[data-timeline-canvas]')!.getAttribute('height'))
    expect(container.querySelector('[data-testid="timeline-links"]')).toBeNull()
    rerender(<Timeline events={events} arcs={[]} width={800} links={links} />)
    const withLinks = Number(container.querySelector('svg[data-timeline-canvas]')!.getAttribute('height'))
    expect(withLinks).toBeGreaterThan(plain)
  })

  it('traces the ripple of the selection and dims what is off it', () => {
    render(<Timeline events={events} arcs={[]} width={800} links={links} selectedEventId="b" />)
    expect(markOf('a')).not.toHaveAttribute('data-dimmed')
    expect(markOf('c')).not.toHaveAttribute('data-dimmed')
    expect(markOf('d')).not.toHaveAttribute('data-dimmed')
    expect(markOf('lone')).toHaveAttribute('data-dimmed', 'true')
    const roles = Object.fromEntries(linkPaths().map((p) => [p.dataset.linkId, p.dataset.ripple]))
    expect(roles).toEqual({ ab: 'cause', bc: '1', cd: '2' })
  })

  it('draws confidence as the shape of the mark', () => {
    render(<Timeline events={events} arcs={[]} width={800} />)
    expect(markOf('a')).toHaveAttribute('data-confidence-tier', 'firm')
    expect(markOf('b')).toHaveAttribute('data-confidence-tier', 'probable')
    expect(markOf('c')).toHaveAttribute('data-confidence-tier', 'speculative')
    expect(markOf('c').getAttribute('aria-label')).toMatch(/confidence 0\.20/)
  })

  it('washes the branch after its point of divergence', () => {
    render(
      <Timeline
        events={events}
        arcs={[]}
        width={800}
        ghost={{ label: 'Baseline', events, divergence: new Date('2024-06-01T00:00:00Z') }}
      />
    )
    const wash = document.querySelector('[data-testid="timeline-after-divergence"]')!
    const divergenceX = Number(wash.getAttribute('x'))
    expect(divergenceX).toBeGreaterThan(0)
    expect(Number(wash.getAttribute('width'))).toBeGreaterThan(0)
  })
})
