import { afterEach, describe, expect, it } from 'vitest'
import { calendarKey, getActiveCalendar, useWorldCalendarStore } from './worldCalendarStore'

const MONTHS = ['Lowtide', 'Greywater', 'Thaw', 'Seedtide', 'Brightwater', 'Highsun', 'Saltreap', 'Panfire', 'Gale', 'Ebb', 'Wrack', 'Longnight']

afterEach(() => useWorldCalendarStore.getState().setCalendar(null))

describe('the world calendar store', () => {
  it('changes its key when the month names change, so the views remount with the new labels', () => {
    const plain = calendarKey({ epochYear: 1000, eraLabel: 'AR' })
    const named = calendarKey({ epochYear: 1000, eraLabel: 'AR', monthNames: MONTHS })
    const renamed = calendarKey({ epochYear: 1000, eraLabel: 'AR', monthNames: ['Melt', ...MONTHS.slice(1)] })
    expect(new Set([plain, named, renamed]).size).toBe(3)
    expect(calendarKey({ epochYear: 1000, eraLabel: 'AR', monthNames: [...MONTHS] })).toBe(named)
  })

  it('keeps the world years when the server sends unusable month names', () => {
    useWorldCalendarStore.getState().setCalendar({ epochYear: 1000, eraLabel: 'AR', monthNames: MONTHS.slice(0, 3) })
    expect(getActiveCalendar()).toEqual({ epochYear: 1000, eraLabel: 'AR' })
  })
})
