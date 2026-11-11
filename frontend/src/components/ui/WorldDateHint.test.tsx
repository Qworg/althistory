import { afterEach, describe, expect, it } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { WorldDateHint } from './WorldDateHint'
import { useWorldCalendarStore } from '@/stores/worldCalendarStore'

afterEach(() => useWorldCalendarStore.getState().setCalendar(null))

describe('WorldDateHint', () => {
  it('shows nothing without a world calendar', () => {
    const { container } = render(<WorldDateHint value="1311-03-04T00:00" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the world date of a stored datetime-local value, read as UTC', () => {
    useWorldCalendarStore.getState().setCalendar({ epochYear: 1000, eraLabel: 'AR' })
    render(<WorldDateHint value="1311-03-04T00:00" />)
    expect(screen.getByText(/^= Mar 4, 312 AR$/)).toBeInTheDocument()
  })

  it('follows a calendar change', () => {
    render(<WorldDateHint value="1311-03-04T14:30" />)
    act(() => useWorldCalendarStore.getState().setCalendar({ epochYear: 1000 }))
    expect(screen.getByText(/Mar 4, Year 312, 14:30 UTC/)).toBeInTheDocument()
  })
})
