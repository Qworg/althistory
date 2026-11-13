import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { DateField } from './DateField'
import { dateFieldIso, dateFieldValue } from '@/utils/dateField'
import { useWorldCalendarStore } from '@/stores/worldCalendarStore'

/** A field holding what it is given and handing back what is typed, as a form does. */
function Form({ initial, onValue }: { initial: string; onValue?: (value: string) => void }) {
  const [value, setValue] = useState(initial)
  return (
    <DateField
      aria-label="Date"
      kind="date"
      value={value}
      onChange={(next) => {
        setValue(next)
        onValue?.(next)
      }}
    />
  )
}

afterEach(() => {
  useWorldCalendarStore.getState().setCalendar(null)
})

describe('a date field in a graph without a world calendar', () => {
  it('is the native picker for a date the picker holds', () => {
    render(<Form initial="1843-11-20" />)
    expect(screen.getByLabelText('Date')).toHaveAttribute('type', 'date')
  })

  it('takes 300000 BCE typed, as every other typed date is read', () => {
    const typed = vi.fn()
    render(<Form initial="" onValue={typed} />)
    fireEvent.click(screen.getByRole('button', { name: /type a year before 1 CE or after 9999/i }))
    const input = screen.getByLabelText('Date')
    expect(input).toHaveAttribute('type', 'text')
    fireEvent.change(input, { target: { value: '300000 BCE' } })
    expect(typed).toHaveBeenLastCalledWith('300000 BCE')
    expect(dateFieldIso('300000 BCE', { calendar: null })).toBe('-299999-01-01T00:00:00.000Z')
    // And a field left on a date it cannot hold says why, if it is wrong.
    fireEvent.change(input, { target: { value: '300000 BCE, maybe' } })
    fireEvent.blur(input)
    expect(screen.getByLabelText('Date')).toHaveAttribute('aria-invalid', 'true')
  })

  it('shows a deep date as text, and reads the text back to the same moment', () => {
    const text = dateFieldValue('+300000-06-15T00:00:00.000Z', 'date', { calendar: null })
    expect(text).toBe('300000-06-15')
    render(<Form initial={text} />)
    expect(screen.getByLabelText('Date')).toHaveAttribute('type', 'text')
    expect(screen.getByLabelText('Date')).toHaveValue('300000-06-15')
    expect(dateFieldIso(text, { calendar: null })).toBe('+300000-06-15T00:00:00.000Z')
  })

  it('shows 44 BCE as text, which the picker could not hold', () => {
    render(<Form initial={dateFieldValue('-000043-03-15T00:00:00.000Z', 'date', { calendar: null })} />)
    expect(screen.getByLabelText('Date')).toHaveValue('44-03-15 BCE')
  })
})
