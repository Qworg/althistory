import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { TimeRangeSelector } from './TimeRangeSelector'
import type { TimeRange } from '@/types'
import { useWorldCalendarStore } from '@/stores/worldCalendarStore'
import { VAEL } from '@/test/fixtures/worldCalendars'
import { readWorldTimestamp, toAxisTime, toInstant } from '@althistory/calendar'
import { useGlobalStore } from '@/stores/globalStore'

afterEach(() => useWorldCalendarStore.getState().setCalendar(null))

/** The picker as GraphCopyModal holds it: the range it was last sent. */
function Held({ initial, sent }: { initial: TimeRange | null; sent: (range: TimeRange | null) => void }) {
  const [range, setRange] = useState(initial)
  return (
    <TimeRangeSelector
      value={range}
      showPresets={false}
      onChange={(next) => {
        sent(next)
        setRange(next)
      }}
    />
  )
}

const type = (label: RegExp, text: string) => fireEvent.change(screen.getByLabelText(label), { target: { value: text } })

describe('the time range picker', () => {
  it('starts from a range it is given, without sending anything back', () => {
    const sent = vi.fn()
    const range = { start: new Date('1871-03-01T00:00:00Z'), end: new Date('1871-03-31T23:59:00Z') }
    render(<Held initial={range} sent={sent} />)
    expect(sent).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/Start Date/)).toHaveValue('1871-03-01T00:00')
  })

  it('in a world, says when the end is before the start, sending nothing and leaving the text as typed', () => {
    useWorldCalendarStore.getState().setCalendar(VAEL)
    const sent = vi.fn()
    render(<Held initial={null} sent={sent} />)
    type(/Start Date/, 'Thaw 10, 312 AR')
    type(/End Date/, 'Thaw 12, 312 AR')
    expect(sent).toHaveBeenLastCalledWith({
      start: new Date(readWorldTimestamp(VAEL, 'Thaw 10, 312 AR')!.iso),
      end: new Date(readWorldTimestamp(VAEL, 'Thaw 12, 312 AR', 'end')!.iso),
    })
    sent.mockClear()

    // Part-way through retyping the end's year.
    type(/End Date/, 'Thaw 12, 3 AR')
    expect(sent).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('The end is before the start.')
    expect(screen.getByLabelText(/Start Date/)).toHaveValue('Thaw 10, 312 AR')
    expect(screen.getByLabelText(/End Date/)).toHaveValue('Thaw 12, 3 AR')

    type(/End Date/, 'Thaw 12, 313 AR')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(sent).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText(/End Date/)).toHaveValue('Thaw 12, 313 AR')
  })
})

describe('the time range picker past what a double holds', () => {
  afterEach(() => useGlobalStore.setState({ events: [] }))

  it('"all events" spans the first and last event exactly, odd milliseconds included', () => {
    const first = '+300001-01-01T00:00:00.001Z'
    const last = '+300003-01-01T00:00:00.003Z'
    const event = (id: string, timestamp: string) =>
      ({ id, description: id, actor: 'A', target: 'B', timestamp, created_at: first, updated_at: first }) as never
    // The last one first, so the order of the list is not what makes it the maximum.
    useGlobalStore.setState({ events: [event('b', last), event('a', first)] })
    const sent = vi.fn()
    render(<TimeRangeSelector value={null} onChange={sent} />)
    fireEvent.click(screen.getByRole('button', { name: /all events/i }))
    const { start, end } = sent.mock.lastCall![0] as TimeRange
    expect(toAxisTime(start)).toBe(toAxisTime(toInstant(first)))
    expect(toAxisTime(end)).toBe(toAxisTime(toInstant(last)))
  })
})
