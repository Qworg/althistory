import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { Timeline } from './Timeline'
import type { Arc, Event } from '@/types'

/**
 * The timeline as a keyboard composite, through the real d3 scale and zoom:
 * one tab stop, arrow keys between marks and lanes, Escape to the canvas,
 * keyboard retime/resize/context menu, the 24px hit target, the top-down
 * layout, and the ghosted baseline of a branch.
 */

const makeEvent = (id: string, timestamp: string, description = `Event ${id}`): Event => ({
  id,
  description,
  actor: 'Actor',
  target: 'Target',
  timestamp,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
})

const makeArc = (id: string, name: string, start: string, end: string, extra: Partial<Arc> = {}): Arc => ({
  id,
  name,
  description: name,
  start_time: start,
  end_time: end,
  level: 0,
  parent_arc_id: null,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  ...extra,
})

// Out of time order on purpose: navigation follows time, not array order.
const events: Event[] = [
  makeEvent('mid', '2024-06-01T00:00:00Z'),
  makeEvent('first', '2024-01-10T00:00:00Z'),
  makeEvent('last', '2024-12-20T00:00:00Z'),
]

const arcs: Arc[] = [
  makeArc('early', 'Early period', '2024-01-01T00:00:00Z', '2024-04-01T00:00:00Z'),
  makeArc('late', 'Late period', '2024-08-01T00:00:00Z', '2024-12-31T00:00:00Z'),
]

const mark = (key: string): SVGElement => {
  const el = document.querySelector(`[data-mark-key="${key}"]`)
  if (!(el instanceof SVGElement)) throw new Error(`mark ${key} is not rendered`)
  return el
}
const canvas = (): SVGSVGElement => {
  const el = document.querySelector('svg[data-timeline-canvas]')
  if (!(el instanceof SVGSVGElement)) throw new Error('canvas not rendered')
  return el
}
const translateY = (el: Element): number => {
  const match = /translate\(([-\d.]+),\s*([-\d.]+)\)/.exec(el.getAttribute('transform') ?? '')
  if (!match) throw new Error('no transform')
  return Number(match[2])
}

beforeEach(() => {
  vi.clearAllMocks()
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
})

describe('Timeline keyboard composite', () => {
  it('has one tab stop: the earliest event, then whichever mark last had focus', () => {
    render(<Timeline events={events} arcs={arcs} width={800} />)

    const stops = Array.from(document.querySelectorAll('[tabindex="0"]'))
    expect(stops).toEqual([mark('event:first')])
    expect(canvas()).toHaveAttribute('tabindex', '-1')

    act(() => mark('event:mid').focus())
    expect(mark('event:mid')).toHaveAttribute('tabindex', '0')
    expect(mark('event:first')).toHaveAttribute('tabindex', '-1')
  })

  it('makes the canvas the tab stop when there are no marks', () => {
    render(<Timeline events={[]} arcs={[]} width={800} />)
    expect(canvas()).toHaveAttribute('tabindex', '0')
  })

  it('steps through events in time order with the arrow keys, and Home/End to the ends', () => {
    render(<Timeline events={events} arcs={arcs} width={800} />)
    act(() => mark('event:first').focus())

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(mark('event:mid'))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(mark('event:last'))
    // No wrap at the end of the lane.
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(mark('event:last'))

    fireEvent.keyDown(document.activeElement!, { key: 'Home' })
    expect(document.activeElement).toBe(mark('event:first'))
    fireEvent.keyDown(document.activeElement!, { key: 'End' })
    expect(document.activeElement).toBe(mark('event:last'))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(mark('event:mid'))
  })

  it('moves between the event track and the arc row with up/down, landing on the nearest mark in time', () => {
    render(<Timeline events={events} arcs={arcs} width={800} />)
    act(() => mark('event:last').focus())

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(mark('arc:late'))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(mark('arc:early'))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(mark('event:first'))
  })

  it('returns to the canvas with Escape, pans there with the arrows, and re-enters with Enter', () => {
    const onTimeRangeChange = vi.fn()
    render(<Timeline events={events} arcs={arcs} width={800} onTimeRangeChange={onTimeRangeChange} />)
    act(() => mark('event:mid').focus())

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(document.activeElement).toBe(canvas())

    // Zoom in first so a pan has room to move (the translate extent clamps it at fit).
    onTimeRangeChange.mockClear()
    fireEvent.keyDown(canvas(), { key: '+' })
    fireEvent.keyDown(canvas(), { key: 'ArrowRight' })
    expect(onTimeRangeChange).toHaveBeenCalled()

    fireEvent.keyDown(canvas(), { key: 'Enter' })
    expect(document.activeElement).toBe(mark('event:mid'))
  })

  it('lets the first Escape on a mark clear an active selection, keeping focus on the mark', () => {
    const onDocumentEscape = vi.fn()
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onDocumentEscape()
    }
    document.addEventListener('keydown', listener)
    try {
      render(<Timeline events={events} arcs={arcs} width={800} selectedEventId="mid" />)
      act(() => mark('event:mid').focus())
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
      // The view's document-level handler (clear selection) receives it...
      expect(onDocumentEscape).toHaveBeenCalledTimes(1)
      // ...and focus stays where the user is working.
      expect(document.activeElement).toBe(mark('event:mid'))
    } finally {
      document.removeEventListener('keydown', listener)
    }
  })

  it('pans a focused mark into view when it is off screen', () => {
    const onTimeRangeChange = vi.fn()
    render(<Timeline events={events} arcs={[]} width={800} onTimeRangeChange={onTimeRangeChange} />)
    act(() => mark('event:first').focus())
    // Zoom well in. On a mark the zoom keys zoom around it, so it keeps focus
    // while the last event leaves the render window.
    for (let i = 0; i < 6; i++) fireEvent.keyDown(document.activeElement!, { key: '+' })
    expect(document.activeElement).toBe(mark('event:first'))
    expect(document.querySelector('[data-mark-key="event:last"]')).toBeNull()

    fireEvent.keyDown(document.activeElement!, { key: 'End' })

    expect(document.activeElement).toBe(mark('event:last'))
    const range = onTimeRangeChange.mock.lastCall?.[0] as { start: Date; end: Date }
    const last = new Date('2024-12-20T00:00:00Z').getTime()
    expect(range.start.getTime()).toBeLessThanOrEqual(last)
    expect(range.end.getTime()).toBeGreaterThanOrEqual(last)
  })

  it('returns focus to the canvas when a pointer zoom culls the focused mark', () => {
    render(<Timeline events={events} arcs={[]} width={800} />)
    act(() => mark('event:first').focus())

    // Ctrl-wheel zoom far in at the right edge: the first event leaves the window.
    for (let i = 0; i < 6; i++) {
      act(() => {
        canvas().dispatchEvent(
          new WheelEvent('wheel', { deltaY: -120, clientX: 780, clientY: 100, ctrlKey: true, bubbles: true, cancelable: true })
        )
      })
    }

    expect(document.querySelector('[data-mark-key="event:first"]')).toBeNull()
    expect(document.activeElement).toBe(canvas())
  })

  it('retimes the focused event with Shift+arrow through onEventDrag', () => {
    const onEventDrag = vi.fn()
    render(<Timeline events={events} arcs={[]} width={800} onEventDrag={onEventDrag} />)

    fireEvent.keyDown(mark('event:mid'), { key: 'ArrowRight', shiftKey: true })

    expect(onEventDrag).toHaveBeenCalledTimes(1)
    const [ev, timestamp] = onEventDrag.mock.calls[0] as [Event, Date]
    expect(ev.id).toBe('mid')
    // About a year in view, so a step is one week.
    expect(timestamp.toISOString()).toBe('2024-06-08T00:00:00.000Z')
  })

  it('opens the context menu from the keyboard (Shift+F10 and the menu key) without a duplicate native one', () => {
    const onEventContextMenu = vi.fn()
    const onArcContextMenu = vi.fn()
    render(
      <Timeline
        events={events}
        arcs={arcs}
        width={800}
        onEventContextMenu={onEventContextMenu}
        onArcContextMenu={onArcContextMenu}
      />
    )

    fireEvent.keyDown(mark('event:mid'), { key: 'F10', shiftKey: true })
    expect(onEventContextMenu).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'mid' }),
      expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) })
    )
    // The browser's own contextmenu for the same press is swallowed.
    fireEvent.contextMenu(mark('event:mid'))
    expect(onEventContextMenu).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(mark('arc:early'), { key: 'ContextMenu' })
    expect(onArcContextMenu).toHaveBeenCalledWith(expect.objectContaining({ id: 'early' }), expect.any(Object))
  })

  it('shows the tooltip on keyboard focus', () => {
    render(<Timeline events={events} arcs={arcs} width={800} />)
    act(() => mark('event:mid').focus())
    expect(screen.getByRole('tooltip')).toHaveTextContent('Event mid')
  })

  it('selects with Enter on an event and on an arc', () => {
    const onEventSelect = vi.fn()
    const onArcSelect = vi.fn()
    render(<Timeline events={events} arcs={arcs} width={800} onEventSelect={onEventSelect} onArcSelect={onArcSelect} />)

    fireEvent.keyDown(mark('event:mid'), { key: 'Enter' })
    fireEvent.keyDown(mark('arc:late'), { key: ' ' })

    expect(onEventSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'mid' }))
    expect(onArcSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'late' }))
  })

  it('leaves Ctrl/Alt combinations alone (view switching, browser shortcuts)', () => {
    const onEventDrag = vi.fn()
    render(<Timeline events={events} arcs={[]} width={800} onEventDrag={onEventDrag} />)
    act(() => mark('event:first').focus())

    const notPrevented = fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight', altKey: true })
    expect(notPrevented).toBe(true)
    expect(document.activeElement).toBe(mark('event:first'))
    expect(onEventDrag).not.toHaveBeenCalled()
  })
})

describe('Timeline accessibility audit', () => {
  it('has no axe violations, plain or as a branch with its baseline', async () => {
    // axe measures SVG text through a canvas, which jsdom lacks; without this
    // stub jsdom logs "not implemented" for every label. axe copes with null.
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null)
    const { container, rerender } = render(<Timeline events={events} arcs={arcs} width={800} />)
    expect(await axe(container)).toHaveNoViolations()
    rerender(
      <Timeline
        events={events}
        arcs={arcs}
        width={800}
        ghost={{ label: 'Baseline', events: events.slice(0, 2), divergence: new Date('2024-05-01T00:00:00Z') }}
      />
    )
    expect(await axe(container)).toHaveNoViolations()
    getContext.mockRestore()
  })
})

describe('Timeline event mark hit target', () => {
  it('selects from anywhere on the mark group: a 24px hit area, and the stem no longer swallows the click', () => {
    const onEventSelect = vi.fn()
    render(<Timeline events={events} arcs={[]} width={800} onEventSelect={onEventSelect} />)

    const group = mark('event:mid')
    const hit = group.querySelector('.event-hit-area')
    expect(hit).toHaveAttribute('r', '12')
    const stem = group.querySelector('.event-stem')
    expect(stem).toHaveAttribute('pointer-events', 'none')
    // Painted under the dot, not over it.
    const children = Array.from(group.children)
    expect(children.indexOf(stem!)).toBeLessThan(children.indexOf(group.querySelector('.event-marker')!))

    fireEvent.click(hit!)
    expect(onEventSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'mid' }))
  })
})

describe('Timeline layout', () => {
  it('draws labels a user must read at 12px', () => {
    render(<Timeline events={events} arcs={arcs} width={800} />)
    const labels = document.querySelectorAll('.event-label, .arc-label')
    expect(labels.length).toBeGreaterThan(0)
    labels.forEach(label => expect(label).toHaveAttribute('font-size', '12'))
  })

  it('puts the event track just below the arc rows, and sizes the canvas to its content', () => {
    const { rerender } = render(<Timeline events={events} arcs={arcs} width={800} />)
    const arcBar = document.querySelector('[data-arc-id="early"] .arc-main')!
    const arcBottom = Number(arcBar.getAttribute('y')) + Number(arcBar.getAttribute('height'))
    const trackY = translateY(mark('event:mid'))
    // Room for four 12px label rows between them, and no more.
    expect(trackY - arcBottom).toBeGreaterThan(60)
    expect(trackY - arcBottom).toBeLessThan(94)
    const oneRowHeight = Number(canvas().getAttribute('height'))

    // Overlapping arcs take a second row: the track moves down and the canvas grows with it.
    const overlapping = [...arcs, makeArc('overlap', 'Overlap', '2024-02-01T00:00:00Z', '2024-05-01T00:00:00Z')]
    rerender(<Timeline events={events} arcs={overlapping} width={800} />)
    expect(translateY(mark('event:mid'))).toBeGreaterThan(trackY)
    expect(Number(canvas().getAttribute('height'))).toBeGreaterThan(oneRowHeight)
  })

  it('treats height as a minimum: it never clips the content', () => {
    render(<Timeline events={events} arcs={arcs} width={800} height={40} />)
    expect(Number(canvas().getAttribute('height'))).toBeGreaterThan(100)
  })
})

describe('Timeline ghosted baseline (branch view)', () => {
  // The branch shares "first" (same id) and "mid" (copied: new id, same
  // instant and description), drops the baseline's "gone", and adds "own".
  const baseline: Event[] = [
    makeEvent('first', '2024-01-10T00:00:00Z'),
    makeEvent('base-mid', '2024-06-01T00:00:00Z', 'Event mid'),
    makeEvent('gone', '2024-09-01T00:00:00Z', 'Baseline only'),
  ]
  const branch: Event[] = [
    makeEvent('first', '2024-01-10T00:00:00Z'),
    makeEvent('mid', '2024-06-01T00:00:00Z'),
    makeEvent('own', '2024-10-01T00:00:00Z', 'Clerks prevail'),
    makeEvent('early-own', '2024-02-01T00:00:00Z', 'Before divergence'),
  ]
  const ghost = { label: 'The Engine Age', events: baseline, divergence: new Date('2024-05-01T00:00:00Z') }

  it('draws the baseline as a non-interactive lane under the event track', () => {
    render(<Timeline events={branch} arcs={arcs} width={800} ghost={ghost} />)

    const lane = screen.getByTestId('timeline-ghost-lane')
    expect(lane).toHaveTextContent('Baseline: The Engine Age')
    expect(lane).toHaveAttribute('pointer-events', 'none')
    const ghosts = lane.querySelectorAll('.timeline-ghost-event')
    expect(ghosts).toHaveLength(3)
    expect(ghosts[0]!.closest('[aria-hidden="true"]')).not.toBeNull()
    // Below the active track.
    expect(Number(ghosts[0]!.getAttribute('cy'))).toBeGreaterThan(translateY(mark('event:mid')))
    // Ghost marks are not keyboard stops.
    expect(lane.querySelector('[tabindex]')).toBeNull()
    // The baseline event the branch dropped is drawn hollow.
    expect(lane.querySelector('[data-ghost-event-id="gone"]')).toHaveAttribute('data-dropped', 'true')
    expect(lane.querySelector('[data-ghost-event-id="first"]')).not.toHaveAttribute('data-dropped')
  })

  it('marks the point of divergence with a labelled amber landmark', () => {
    render(<Timeline events={branch} arcs={arcs} width={800} ghost={ghost} />)

    const landmark = screen.getByTestId('timeline-divergence')
    expect(landmark).toHaveTextContent('Diverges May 1, 2024')
    expect(landmark.querySelector('line')).toHaveStyle({ stroke: 'var(--accent-divergence)' })
    expect(landmark.querySelector('line')).toHaveAttribute('stroke-dasharray')
    expect(canvas()).toHaveAccessibleName(/Branch of The Engine Age, diverging May 1, 2024/)
  })

  it("draws the branch's own events after the divergence apart from the shared history", () => {
    render(<Timeline events={branch} arcs={arcs} width={800} ghost={ghost} />)

    expect(mark('event:own')).toHaveAttribute('data-branch-own', 'true')
    expect(mark('event:own').querySelector('.event-marker')).toHaveAttribute('fill', 'var(--accent-divergence)')
    expect(mark('event:own')).toHaveAccessibleName(/this branch only/)
    // Shared by id, shared as a copy, and new but before the divergence: none is "own".
    for (const key of ['event:first', 'event:mid', 'event:early-own']) {
      expect(mark(key)).not.toHaveAttribute('data-branch-own')
    }
  })

  it('keeps the zoom when the parent rebuilds the ghost object around the same events', () => {
    const onTimeRangeChange = vi.fn()
    const { rerender } = render(
      <Timeline events={branch} arcs={arcs} width={800} ghost={{ ...ghost }} onTimeRangeChange={onTimeRangeChange} />
    )
    fireEvent.keyDown(mark('event:mid'), { key: '+' })
    const zoomed = onTimeRangeChange.mock.lastCall?.[0] as { start: Date; end: Date }
    onTimeRangeChange.mockClear()

    rerender(<Timeline events={branch} arcs={arcs} width={800} ghost={{ ...ghost, divergence: new Date(ghost.divergence) }} onTimeRangeChange={onTimeRangeChange} />)

    // No reset to the full extent was reported.
    expect(onTimeRangeChange).not.toHaveBeenCalled()
    expect(zoomed.end.getTime() - zoomed.start.getTime()).toBeGreaterThan(0)
  })

  it('draws nothing extra without a ghost', () => {
    render(<Timeline events={branch} arcs={arcs} width={800} />)
    expect(screen.queryByTestId('timeline-ghost-lane')).toBeNull()
    expect(screen.queryByTestId('timeline-divergence')).toBeNull()
    expect(document.querySelector('[data-branch-own]')).toBeNull()
  })
})
