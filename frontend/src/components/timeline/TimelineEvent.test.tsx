/**
 * The event mark: its highlighted and selected states, its colours, and its
 * keyboard behaviour.
 *
 * The exploration panel's "highlight evidence" button sets a set of event ids;
 * without a mark for them the button changed nothing anyone could see.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TimelineEvent } from './TimelineEvent'
import { Event } from '@/types'

const event: Event = {
  id: 'event-1',
  description: 'A treaty is signed',
  actor: 'Negotiators',
  target: 'Signatories',
  timestamp: '1919-06-28T00:00:00Z',
  created_at: '1919-06-28T00:00:00Z',
  updated_at: '1919-06-28T00:00:00Z',
}

function marker(mark: HTMLElement) {
  return mark.querySelector('.event-marker')
}

describe('TimelineEvent', () => {
  it('marks a highlighted event with a divergence-coloured ring', () => {
    render(
      <svg>
        <TimelineEvent event={event} x={10} y={20} isHighlighted />
      </svg>
    )

    const circle = marker(screen.getByRole('button', { name: /A treaty is signed/ }))

    // The highlight is a bigger mark with a contrasting (amber) stroke, so it
    // reads as highlighted rather than as a slightly different event.
    expect(circle?.getAttribute('r')).toBe('9')
    expect(circle?.getAttribute('stroke')).toBe('var(--accent-divergence)')
    expect(circle?.getAttribute('fill')).toBe('var(--accent-baseline)')
  })

  it('draws an ordinary event in the cobalt baseline colour on the card surface', () => {
    render(
      <svg>
        <TimelineEvent event={event} x={10} y={20} />
      </svg>
    )

    const circle = marker(screen.getByRole('button', { name: /A treaty is signed/ }))

    expect(circle?.getAttribute('r')).toBe('6')
    // Amber is reserved for divergence; the baseline mark is cobalt.
    expect(circle?.getAttribute('fill')).toBe('var(--accent-baseline)')
    expect(circle?.getAttribute('stroke')).toBe('var(--surface-card)')
  })

  it('draws the selected event in indigo', () => {
    render(
      <svg>
        <TimelineEvent event={event} x={10} y={20} isSelected />
      </svg>
    )

    const mark = screen.getByRole('button', { name: /A treaty is signed/ })
    expect(marker(mark)?.getAttribute('fill')).toBe('var(--accent-selected)')
    expect(mark.querySelector('.event-selected-ring')).not.toBeNull()
  })

  it.each(['Enter', ' '])('activates the click handler with the %j key', (key) => {
    const onClick = vi.fn()
    render(
      <svg>
        <TimelineEvent event={event} x={10} y={20} onClick={onClick} />
      </svg>
    )

    const mark = screen.getByRole('button', { name: /A treaty is signed/ })
    const notPrevented = fireEvent.keyDown(mark, { key })

    expect(onClick).toHaveBeenCalledWith(event)
    // Space must not also scroll the page.
    expect(notPrevented).toBe(false)
  })

  it('ignores other keys', () => {
    const onClick = vi.fn()
    render(
      <svg>
        <TimelineEvent event={event} x={10} y={20} onClick={onClick} />
      </svg>
    )

    fireEvent.keyDown(screen.getByRole('button', { name: /A treaty is signed/ }), { key: 'a' })
    expect(onClick).not.toHaveBeenCalled()
  })

  it("draws a branch's own event in the divergence amber and says so", () => {
    render(
      <svg>
        <TimelineEvent event={event} x={10} y={20} isBranchOwn />
      </svg>
    )
    const mark = screen.getByRole('button', { name: /A treaty is signed.*this branch only/ })
    expect(marker(mark)?.getAttribute('fill')).toBe('var(--accent-divergence)')
  })

  it('takes part in a roving tabindex: tabbable only when it is the tab stop', () => {
    const { rerender } = render(
      <svg>
        <TimelineEvent event={event} x={10} y={20} isTabStop={false} />
      </svg>
    )
    expect(screen.getByRole('button', { name: /A treaty is signed/ })).toHaveAttribute('tabindex', '-1')
    rerender(
      <svg>
        <TimelineEvent event={event} x={10} y={20} isTabStop />
      </svg>
    )
    expect(screen.getByRole('button', { name: /A treaty is signed/ })).toHaveAttribute('tabindex', '0')
  })

  it('leaves Shift+Enter and other keys to the timeline (they bubble)', () => {
    const onClick = vi.fn()
    render(
      <svg>
        <TimelineEvent event={event} x={10} y={20} onClick={onClick} />
      </svg>
    )
    const notPrevented = fireEvent.keyDown(screen.getByRole('button', { name: /A treaty is signed/ }), { key: 'Enter', shiftKey: true })
    expect(notPrevented).toBe(true)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('has a focus ring that appears only on keyboard focus', () => {
    render(
      <svg>
        <TimelineEvent event={event} x={10} y={20} />
      </svg>
    )

    const ring = screen.getByRole('button', { name: /A treaty is signed/ }).querySelector('.event-focus-ring')
    expect(ring).not.toBeNull()
    expect(ring?.getAttribute('class')).toContain('group-focus-visible:opacity-100')
  })

  describe('an event another writer just added (the live change feed)', () => {
    it('is ringed in the success colour, named as new, and the ring is gone once the highlight ends', () => {
      const { rerender } = render(
        <svg>
          <TimelineEvent event={event} x={10} y={20} isFresh />
        </svg>
      )
      const mark = screen.getByRole('button', { name: /A treaty is signed.*, new/ })
      const ring = mark.querySelector('.event-fresh-ring')
      expect(ring).not.toBeNull()
      expect(ring?.getAttribute('stroke')).toBe('var(--status-success)')
      // It animates through a class the stylesheet gives reduced-motion support to.
      expect(ring?.getAttribute('class')).toContain('live-fresh-ring')
      expect(mark.getAttribute('data-fresh')).toBe('true')

      rerender(
        <svg>
          <TimelineEvent event={event} x={10} y={20} />
        </svg>
      )
      const after = screen.getByRole('button', { name: /A treaty is signed/ })
      expect(after.querySelector('.event-fresh-ring')).toBeNull()
      expect(after.getAttribute('aria-label')).not.toMatch(/, new/)
    })
  })
})
