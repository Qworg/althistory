import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { renderWithProviders } from '@/test/utils'
import { createMockArc } from '@/test/fixtures/modalFixtures'
import { ArcDetailPanel } from '@/components/modals/ArcDetailPanel'
import { ArcCreationModal } from '@/components/timeline/ArcCreationModal'
import { TimeRangeSelector } from '@/components/filters/TimeRangeSelector'
import { WorldDateHint } from './WorldDateHint'
import { useWorldCalendarStore } from '@/stores/worldCalendarStore'

afterEach(() => useWorldCalendarStore.getState().setCalendar(null))

describe('WorldDateHint', () => {
  it('shows nothing without a world calendar', () => {
    const { container } = render(<WorldDateHint id="hint" value="1311-03-04T00:00" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the world date of a stored datetime-local value, read as UTC', () => {
    useWorldCalendarStore.getState().setCalendar({ epochYear: 1000, eraLabel: 'AR' })
    render(<WorldDateHint id="hint" value="1311-03-04T00:00" />)
    expect(screen.getByText(/^= Mar 4, 312 AR$/)).toBeInTheDocument()
  })

  it('follows a calendar change', () => {
    render(<WorldDateHint id="hint" value="1311-03-04T14:30" />)
    act(() => useWorldCalendarStore.getState().setCalendar({ epochYear: 1000 }))
    expect(screen.getByText(/Mar 4, Year 312, 14:30 UTC/)).toBeInTheDocument()
  })
})

describe('world-date hints on stored-date fields', () => {
  const AR = { epochYear: 1000, eraLabel: 'AR' }
  afterEach(() => useWorldCalendarStore.getState().setCalendar(null))

  it('ties the arc editor hints to their fields with aria-describedby', async () => {
    useWorldCalendarStore.getState().setCalendar(AR)
    const arc = createMockArc({ start_time: '1311-03-04T00:00:00Z', end_time: '1320-01-01T00:00:00Z' })
    const { container } = renderWithProviders(
      <ArcDetailPanel
        arc={arc}
        isOpen
        onClose={vi.fn()}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        containedEvents={[]}
        childArcs={[]}
        parentArc={null}
      />
    )
    const editButton = screen.queryByRole('button', { name: /^Edit/ })
    if (editButton) fireEvent.click(editButton)
    const start = screen.getByLabelText(/Start Time/)
    expect(start).toHaveAttribute('aria-describedby', 'arc-start-time-world')
    expect(document.getElementById('arc-start-time-world')).toHaveTextContent('= Mar 4, 312 AR')
    expect(screen.getByLabelText(/End Time/)).toHaveAttribute('aria-describedby', 'arc-end-time-world')
    expect(await axe(container)).toHaveNoViolations()
  })

  it('ties the arc creation hints to their fields, and drops the reference without a calendar', () => {
    const props = {
      isOpen: true,
      onClose: vi.fn(),
      timeRange: { start: new Date('1311-03-04T00:00:00Z'), end: new Date('1320-01-01T00:00:00Z') },
      containedEvents: [],
      parentArcs: [],
    }
    const { unmount } = renderWithProviders(<ArcCreationModal {...props} />)
    expect(screen.getByLabelText(/Start Time/)).not.toHaveAttribute('aria-describedby')
    unmount()

    useWorldCalendarStore.getState().setCalendar(AR)
    renderWithProviders(<ArcCreationModal {...props} />)
    expect(screen.getByLabelText(/Start Time/)).toHaveAttribute('aria-describedby', 'arc-start-time-world')
    expect(document.getElementById('arc-start-time-world')).toHaveTextContent('= Mar 4, 312 AR')
  })

  it('adds the hint to the time range selector, and its range follows the calendar', () => {
    const range = { start: new Date('1311-03-04T00:00:00Z'), end: new Date('1320-01-01T00:00:00Z') }
    renderWithProviders(<TimeRangeSelector value={range} onChange={vi.fn()} showPresets={false} />)
    expect(screen.getByText(/Mar 4, 1311/)).toBeInTheDocument()

    act(() => useWorldCalendarStore.getState().setCalendar(AR))
    // Subscribed: the selected range and the hints change with the calendar.
    expect(screen.getByText(/Mar 4, 312 AR → Jan 1, 321 AR/)).toBeInTheDocument()
    const start = screen.getByLabelText(/Start Date/)
    expect(start).toHaveAttribute('aria-describedby', 'time-range-start-world')
    expect(document.getElementById('time-range-start-world')).toHaveTextContent('= Mar 4, 312 AR')
  })
})
