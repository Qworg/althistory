import { afterEach, describe, expect, it } from 'vitest'
import { legacyCalendarSet, type WorldCalendarSet } from '@althistory/calendar'
import { calendarKey, getActiveCalendar, useWorldCalendarStore } from './worldCalendarStore'

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
