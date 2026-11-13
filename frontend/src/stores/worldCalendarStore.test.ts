import { afterEach, describe, expect, it } from 'vitest'
import { legacyCalendarSet, type WorldCalendarSet } from '@althistory/calendar'
import { act, renderHook } from '@testing-library/react'
import { VAEL } from '@/test/fixtures/worldCalendars'
import { calendarKey, getActiveCalendar, useViewOfCalendars, useWorldCalendarStore } from './worldCalendarStore'

const MONTHS = ['Lowtide', 'Greywater', 'Thaw', 'Seedtide', 'Brightwater', 'Highsun', 'Saltreap', 'Panfire', 'Gale', 'Ebb', 'Wrack', 'Longnight']

/** Two calendars on one timeline: the Reckoning and the Tide Count. */
const TWO: WorldCalendarSet = {
  ...legacyCalendarSet({ epochYear: 1000, eraLabel: 'AR', name: 'the Reckoning' }),
  calendars: [
    legacyCalendarSet({ epochYear: 1000, eraLabel: 'AR', name: 'the Reckoning' }).calendars[0]!,
    { ...legacyCalendarSet({ epochYear: 1200, eraLabel: 'TC', name: 'the Tide Count' }).calendars[0]!, id: 'tide' },
  ],
}

afterEach(() => useWorldCalendarStore.getState().setCalendar(null))

describe('the world calendar store', () => {
  it('changes its key when the month names change, so the views remount with the new labels', () => {
    const plain = calendarKey(legacyCalendarSet({ epochYear: 1000, eraLabel: 'AR' }))
    const named = calendarKey(legacyCalendarSet({ epochYear: 1000, eraLabel: 'AR', monthNames: MONTHS }))
    const renamed = calendarKey(legacyCalendarSet({ epochYear: 1000, eraLabel: 'AR', monthNames: ['Melt', ...MONTHS.slice(1)] }))
    expect(new Set([plain, named, renamed]).size).toBe(3)
    expect(calendarKey(legacyCalendarSet({ epochYear: 1000, eraLabel: 'AR', monthNames: [...MONTHS] }))).toBe(named)
  })

  it('reads a calendar stored in the earlier form, keeping the world years when its month names are unusable', () => {
    useWorldCalendarStore.getState().setCalendar({ epochYear: 1000, eraLabel: 'AR', monthNames: MONTHS.slice(0, 3) })
    expect(getActiveCalendar()).toEqual(legacyCalendarSet({ epochYear: 1000, eraLabel: 'AR' }))
  })

  it('shows another of the world’s calendars as its primary, and forgets the choice for another world', () => {
    const store = useWorldCalendarStore.getState()
    store.setCalendar(TWO)
    expect(getActiveCalendar()?.primary).toBe('calendar')
    store.showCalendar('tide')
    expect(getActiveCalendar()).toEqual({ ...TWO, primary: 'tide' })
    expect(calendarKey(getActiveCalendar())).not.toBe(calendarKey(TWO))
    // The same world again keeps the choice; one without that calendar does not.
    store.setCalendar(TWO)
    expect(getActiveCalendar()?.primary).toBe('tide')
    store.setCalendar(legacyCalendarSet({ epochYear: 1000, eraLabel: 'AR' }))
    expect(getActiveCalendar()?.primary).toBe('calendar')
    store.showCalendar('nowhere')
    expect(getActiveCalendar()?.primary).toBe('calendar')
  })
})

describe('the calendar the viewer picked', () => {
  it("is that graph's: another world with a calendar of the same id opens on its own primary", () => {
    const store = useWorldCalendarStore.getState()
    store.setCalendar(TWO, 'vael')
    store.showCalendar('tide')
    expect(getActiveCalendar()?.primary).toBe('tide')
    // A refetch of the same graph keeps it.
    store.setCalendar(TWO, 'vael')
    expect(getActiveCalendar()?.primary).toBe('tide')
    // Another graph, with calendars of the same ids, does not inherit it.
    store.setCalendar({ ...TWO, calendars: TWO.calendars.map((c) => ({ ...c, name: `${c.name} elsewhere` })) }, 'other')
    expect(getActiveCalendar()?.primary).toBe('calendar')
  })
})

describe("another graph's calendars as the viewer sees them", () => {
  it("are in the calendar picked when they are the open graph's, and as kept otherwise", () => {
    useWorldCalendarStore.getState().setCalendar(VAEL, 'vael')
    const { result } = renderHook(() => useViewOfCalendars())
    const branch = JSON.parse(JSON.stringify(VAEL)) as WorldCalendarSet
    expect(result.current(branch)?.primary).toBe(VAEL.primary)

    act(() => useWorldCalendarStore.getState().showCalendar('tide'))
    expect(result.current(branch)?.primary).toBe('tide')
    const other = legacyCalendarSet({ epochYear: 1000, eraLabel: 'AR' })
    expect(result.current(other)).toBe(other)
    expect(result.current(null)).toBeNull()
  })
})
