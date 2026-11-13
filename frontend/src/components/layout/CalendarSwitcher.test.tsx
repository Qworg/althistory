import { afterEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CalendarSwitcher } from './CalendarSwitcher'
import { useWorldCalendarStore } from '@/stores/worldCalendarStore'
import { formatHistoricalDate } from '@/utils/historicalTime'
import { AR, VAEL, vael } from '@/test/fixtures/worldCalendars'

afterEach(() => useWorldCalendarStore.getState().setCalendar(null))

describe('CalendarSwitcher', () => {
  it('is not shown for a graph with one calendar or none', () => {
    const { container, rerender } = render(<CalendarSwitcher />)
    expect(container).toBeEmptyDOMElement()
    useWorldCalendarStore.getState().setCalendar(AR)
    rerender(<CalendarSwitcher />)
    expect(container).toBeEmptyDOMElement()
  })

  it("switches every date shown to another of the world's calendars, and back", async () => {
    const user = userEvent.setup()
    useWorldCalendarStore.getState().setCalendar(VAEL)
    render(<CalendarSwitcher />)
    const select = screen.getByLabelText('Calendar')
    expect(select).toHaveValue('reckoning')
    await user.selectOptions(select, 'the Tide-count')
    expect(formatHistoricalDate(vael(312, 2, 4), 'en-US')).toMatch(/ TC$/)
    await user.selectOptions(select, 'the Reckoning of the Rising')
    expect(formatHistoricalDate(vael(312, 2, 4), 'en-US')).toBe('Thaw 4, 312 AR')
  })
})
