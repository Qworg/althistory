import { afterEach, describe, expect, it } from 'vitest'
import { dateFieldIso, dateFieldValue, readDateFieldValue } from './dateField'
import { useWorldCalendarStore } from '@/stores/worldCalendarStore'
import { VAEL, vael } from '@/test/fixtures/worldCalendars'

afterEach(() => useWorldCalendarStore.getState().setCalendar(null))

describe('a date field without a world calendar', () => {
  it('holds a UTC picker value, and reads it as UTC', () => {
    expect(dateFieldValue('1843-11-20T14:30:00Z', 'datetime', { calendar: null })).toBe('1843-11-20T14:30')
    expect(dateFieldValue('1843-11-20T14:30:00Z', 'date', { calendar: null })).toBe('1843-11-20')
    expect(dateFieldIso('1843-11-20T14:30', { calendar: null })).toBe('1843-11-20T14:30:00.000Z')
    // A year a picker cannot hold, or a date that does not exist, is none.
    expect(dateFieldValue('-000043-03-15T00:00:00Z', 'date', { calendar: null })).toBe('')
    expect(dateFieldIso('2019-02-31', { calendar: null })).toBe('')
  })
})

describe('a date field in a world calendar', () => {
  it("holds the world's notation, and reads it back as the same instant", () => {
    const date = vael(312, 2, 4, 6, 50)
    const text = dateFieldValue(date, 'datetime', { calendar: VAEL })
    expect(text).toBe('Thaw 4, 312 AR, 06:50')
    expect(dateFieldIso(text, { calendar: VAEL })).toBe(date.toISOString())
  })

  it('reads a month or a year as the start of it, or as an end its last moment, with its precision', () => {
    expect(readDateFieldValue('Thaw 312 AR', { calendar: VAEL })).toEqual({ ok: true, iso: vael(312, 2, 1).toISOString(), precision: 'month', calendar: 'reckoning' })
    expect(dateFieldIso('Thaw 312 AR', { calendar: VAEL, edge: 'end' })).toBe(new Date(vael(312, 3, 1).getTime() - 1).toISOString())
    // An end on a day's last moment is shown as the day.
    expect(dateFieldValue(new Date(vael(312, 2, 5).getTime() - 1), 'datetime', { calendar: VAEL, edge: 'end' })).toBe('Thaw 4, 312 AR')
  })

  it('says why it cannot read a date', () => {
    const read = readDateFieldValue('Thaw 31, 312 AR', { calendar: VAEL })
    expect(read.ok).toBe(false)
    if (!read.ok) expect(read.error).toBe('Thaw has 30 days that year, so no day 31.')
  })

  it("follows the open graph's calendar, and the one the viewer picked", () => {
    useWorldCalendarStore.getState().setCalendar(VAEL)
    expect(dateFieldValue(vael(312, 2, 4), 'date')).toBe('Thaw 4, 312 AR')
    useWorldCalendarStore.getState().showCalendar('tide')
    expect(dateFieldValue(vael(312, 2, 4), 'date')).toMatch(/^(Ebbing|Flooding) \d+, \d+ TC$/)
  })
})
