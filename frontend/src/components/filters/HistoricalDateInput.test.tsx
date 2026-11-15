import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { HistoricalDateInput } from './HistoricalDateInput'
import { formatDateBound, readDateBound } from './filterUtils'
import { useWorldCalendar, useWorldCalendarStore } from '@/stores/worldCalendarStore'
import { VAEL } from '@/test/fixtures/worldCalendars'

afterEach(() => useWorldCalendarStore.getState().setCalendar(null))

/** The bound as FilterPanelContainer hands it down: the stored instant, written in the calendar shown. */
function Bound({ instant }: { instant: Date }) {
  const calendar = useWorldCalendar()
  return (
    <HistoricalDateInput
      id="start"
      label="Start date"
      edge="start"
      hintId="hint"
      onCommit={vi.fn()}
      value={formatDateBound(instant, 'start', calendar)}
    />
  )
}

describe('a filter bound when another calendar is shown', () => {
  it('is written again in that calendar, though the old text still reads', () => {
    useWorldCalendarStore.getState().setCalendar(VAEL)
    const read = readDateBound('Thaw 312 AR', 'start', VAEL)
    if (!read.ok) throw new Error(read.error)
    render(<Bound instant={read.date} />)
    expect(screen.getByLabelText('Start date')).toHaveValue('Thaw 312 AR')

    act(() => useWorldCalendarStore.getState().showCalendar('tide'))
    expect((screen.getByLabelText('Start date') as HTMLInputElement).value).toMatch(/ TC$/)
    act(() => useWorldCalendarStore.getState().showCalendar('reckoning'))
    expect(screen.getByLabelText('Start date')).toHaveValue('Thaw 312 AR')
  })
})
