import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
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

describe('a filter bound near 200 million years BCE, where a double holds no whole seconds', () => {
  it('commits a moment a second from the bound it has, which getTime() calls the same', () => {
    const onCommit = vi.fn()
    // One double apart from each other: zero.
    const earlier = '-200000001-12-31T23:59:59.500Z'
    const later = '-200000000-01-01T00:00:00.500Z'
    render(<HistoricalDateInput id="start" label="Start date" edge="start" hintId="hint" onCommit={onCommit} value={earlier} />)
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: later } })
    const read = readDateBound(later, 'start', null)
    if (!read.ok) throw new Error(read.error)
    expect(onCommit).toHaveBeenCalledWith(read.text)
  })
})

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
