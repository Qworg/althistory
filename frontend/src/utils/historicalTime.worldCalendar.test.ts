import { afterEach, describe, expect, it } from 'vitest'
import {
  formatEventDate,
  formatHistoricalDate,
  formatHistoricalDateAt,
  formatHistoricalRange,
  formatHistoricalTimestamp,
  historicalYear,
} from './historicalTime'
import { useWorldCalendarStore } from '@/stores/worldCalendarStore'
import { AR, VAEL, vael } from '@/test/fixtures/worldCalendars'

const DATE_OPTIONS: Intl.DateTimeFormatOptions = { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' }

afterEach(() => {
  useWorldCalendarStore.getState().setCalendar(null)
})

describe('historical dates in a calendar of the earlier form (relabelled Gregorian years)', () => {
  it('relabels the year with the era label, keeping month and day as stored', () => {
    expect(formatHistoricalDate('1311-03-04T00:00:00Z', 'en-US', AR)).toBe('Mar 4, 312 AR')
    expect(formatHistoricalDate('1000-01-01T00:00:00Z', 'en-US', AR)).toBe('Jan 1, 1 AR')
    expect(formatHistoricalDate('0999-06-01T00:00:00Z', 'en-US', AR)).toBe('Jun 1, 1 before AR')
  })

  it('shows each precision, and the time when there is one', () => {
    const stored = '1311-03-04T00:00:00Z'
    expect(formatHistoricalDateAt(stored, 'month', 'en-US', AR)).toBe('Mar 312 AR')
    expect(formatHistoricalDateAt(stored, 'year', 'en-US', AR)).toBe('312 AR')
    expect(formatEventDate({ timestamp: stored, metadata: { datePrecision: 'month' } }, 'en-US', AR)).toBe('Mar 312 AR')
    expect(formatHistoricalTimestamp('1311-03-04T14:30:00Z', 'en-US', AR)).toBe('Mar 4, 312 AR, 14:30')
    expect(formatHistoricalTimestamp(stored, 'en-US', AR)).toBe('Mar 4, 312 AR')
    expect(formatHistoricalRange(stored, '1320-12-31T00:00:00Z', 'en-US', AR)).toBe('Mar 4, 312 AR – Dec 31, 321 AR')
  })
})

describe("historical dates in Vael's own calendars", () => {
  it('writes them in its months, festivals and hours, in any locale', () => {
    for (const locale of [undefined, 'en-US', 'de-DE', 'ja-JP', 'ar-EG', 'th-TH']) {
      expect(formatHistoricalDate(vael(312, 2, 4), locale, VAEL)).toBe('Thaw 4, 312 AR')
    }
    expect(formatHistoricalDate(vael(312, 6, 1), 'en-US', VAEL)).toBe("Midyear's Day, 312 AR")
    expect(formatHistoricalTimestamp(vael(312, 2, 4, 19, 99), 'en-US', VAEL)).toBe('Thaw 4, 312 AR, 19:99')
    expect(formatHistoricalDateAt(vael(312, 2, 4), 'month', 'en-US', VAEL)).toBe('Thaw 312 AR')
    expect(formatHistoricalDateAt(vael(-5, 0, 1), 'year', 'en-US', VAEL)).toBe('6 before AR')
    expect(historicalYear(vael(312, 2, 4), VAEL)).toBe('312 AR')
  })

  it('writes them in the calendar the viewer picked', () => {
    const store = useWorldCalendarStore.getState()
    store.setCalendar(VAEL)
    const date = vael(312, 2, 4)
    expect(formatHistoricalDate(date, 'en-US')).toBe('Thaw 4, 312 AR')
    store.showCalendar('tide')
    expect(formatHistoricalDate(date, 'en-US')).toMatch(/^(Ebbing|Flooding) \d+, \d+ TC$/)
    expect(historicalYear(date)).toMatch(/^\d+ TC$/)
  })

  it("uses the open graph's calendars when none is passed, and none for an explicit null", () => {
    useWorldCalendarStore.getState().setCalendar(VAEL)
    expect(formatEventDate({ timestamp: vael(312, 2, 4).toISOString() }, 'en-US')).toBe('Thaw 4, 312 AR')
    expect(formatHistoricalDate('1843-11-20T00:00:00Z', 'en-US', null)).toBe('Nov 20, 1843')
    expect(historicalYear('1843-11-20T00:00:00Z', null)).toBe('1843')
  })

  it('still says an unreadable date is invalid', () => {
    expect(formatHistoricalDate('not a date', 'en-US', VAEL)).toBe('Invalid date')
    expect(formatHistoricalDateAt('not a date', 'year', 'en-US', VAEL)).toBe('Invalid date')
    expect(historicalYear('not a date', VAEL)).toBe('?')
  })
})

describe('historical dates without a world calendar', () => {
  // Byte for byte what the formatters wrote before calendars existed.
  const samples = ['1843-11-20T00:00:00Z', '1843-11-20T14:30:00Z', '0044-03-15T00:00:00Z', '2024-02-29T00:00:00Z']
  const locales = [undefined, 'en-US', 'de-DE', 'ja-JP', 'th-TH']

  it('is unchanged in every locale and precision', () => {
    for (const locale of locales) {
      for (const sample of samples) {
        const date = new Date(sample)
        // Always on the Gregorian calendar, the one the dates are stored and
        // the axis drawn on, whatever the locale's own.
        expect(formatHistoricalDate(sample, locale)).toBe(date.toLocaleDateString(locale, { ...DATE_OPTIONS, calendar: 'gregory' }))
        expect(formatHistoricalDateAt(sample, 'month', locale)).toBe(
          date.toLocaleDateString(locale, { timeZone: 'UTC', year: 'numeric', month: 'short', calendar: 'gregory' })
        )
        expect(formatHistoricalDateAt(sample, 'year', locale)).toBe(
          date.toLocaleDateString(locale, { timeZone: 'UTC', year: 'numeric', calendar: 'gregory' })
        )
      }
    }
    expect(formatHistoricalDate('-000043-03-15T00:00:00Z', 'en-US')).toBe('Mar 15, 44 BC')
    expect(formatHistoricalTimestamp('1843-11-20T14:30:00Z', 'en-US')).toBe('Nov 20, 1843, 14:30 UTC')
    expect(formatHistoricalRange('1843-11-20T00:00:00Z', '1868-01-09T00:00:00Z', 'en-US')).toBe(
      'Nov 20, 1843 – Jan 9, 1868'
    )
  })

  it('is unchanged once a calendar is cleared', () => {
    useWorldCalendarStore.getState().setCalendar(VAEL)
    useWorldCalendarStore.getState().setCalendar(null)
    expect(formatHistoricalDate('1843-11-20T00:00:00Z', 'en-US')).toBe('Nov 20, 1843')
  })
})
