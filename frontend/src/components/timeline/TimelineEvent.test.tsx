/**
 * The event mark's highlighted state.
 *
 * The exploration panel's "highlight evidence" button sets a set of event ids;
 * without a mark for them the button changed nothing anyone could see.
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
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

describe('TimelineEvent', () => {
  it('marks a highlighted event', () => {
    render(
      <svg>
        <TimelineEvent event={event} x={10} y={20} isHighlighted />
      </svg>
    )

    const mark = screen.getByRole('button', { name: /A treaty is signed/ })
    const circle = mark.querySelector('circle')

    // The highlight is a bigger mark with a contrasting stroke, so it reads as
    // highlighted rather than as a slightly different event.
    expect(circle?.getAttribute('r')).toBe('9')
    expect(circle?.getAttribute('stroke')).toBe('#1d4ed8')
  })

  it('leaves an ordinary event unmarked', () => {
    render(
      <svg>
        <TimelineEvent event={event} x={10} y={20} />
      </svg>
    )

    const mark = screen.getByRole('button', { name: /A treaty is signed/ })
    const circle = mark.querySelector('circle')

    expect(circle?.getAttribute('r')).toBe('6')
    expect(circle?.getAttribute('stroke')).toBe('#ffffff')
  })
})
