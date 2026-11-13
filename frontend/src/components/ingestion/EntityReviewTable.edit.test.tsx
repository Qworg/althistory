import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { EntityReviewTable } from './EntityReviewTable'
import type { ExtractedEvent } from '@/types'
import { useWorldCalendarStore } from '@/stores/worldCalendarStore'
import { VAEL, vael } from '@/test/fixtures/worldCalendars'

const source = { type: 'text', extractedAt: '2024-01-01T00:00:00Z' } as const

/** The table with its edits applied, as the wizard applies them. */
function Harness({ initial }: { initial: ExtractedEvent[] }) {
  const [entities, setEntities] = useState(initial)
  return (
    <EntityReviewTable
      entityType="event"
      entities={entities}
      onToggleSelection={vi.fn()}
      onEdit={(tempId, changes) => setEntities((all) => all.map((e) => (e.tempId === tempId ? { ...e, ...changes, edited: true } : e)))}
      onSelectAll={vi.fn()}
      onDeselectAll={vi.fn()}
      onSelectByConfidence={vi.fn()}
    />
  )
}

const reading = (field: HTMLElement) => document.getElementById(field.getAttribute('aria-describedby')!.split(' ')[0]!)?.textContent

describe('a review date typed over an extracted month', () => {
  afterEach(() => useWorldCalendarStore.getState().setCalendar(null))

  it('reads as what was typed, not as the month the text gave', async () => {
    const user = userEvent.setup()
    render(<Harness initial={[{ tempId: 't1', description: 'd', actor: 'a', target: 'b', timestamp: '1871-03-01T00:00:00.000Z', datePrecision: 'month', confidence: 0.9, source, selected: true, edited: false }]} />)
    const field = screen.getByLabelText(/^Date for event t1/)
    expect(reading(field)).toMatch(/Mar 1871: the text gives no day/)
    await user.clear(field)
    await user.type(field, '1871-03-05')
    expect(reading(field)).toBe('Mar 5, 1871')
  })

  it("in a world, a month given in another calendar is shown in it, and a typed day reads as that day", async () => {
    useWorldCalendarStore.getState().setCalendar(VAEL)
    const user = userEvent.setup()
    const tide = { tempId: 't1', description: 'd', actor: 'a', target: 'b', timestamp: vael(312, 2, 1).toISOString(), datePrecision: 'month' as const, dateCalendar: 'tide', confidence: 0.9, source, selected: true, edited: false }
    render(<Harness initial={[tide]} />)
    const field = screen.getByLabelText(/^Date for event t1/)
    expect((field as HTMLInputElement).value).toMatch(/ TC$/)
    await user.clear(field)
    await user.type(field, 'Thaw 4, 312 AR')
    expect(reading(field)).toBe('Thaw 4, 312 AR')
  })
})
