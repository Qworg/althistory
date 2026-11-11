import { afterEach, describe, expect, it } from 'vitest'
import {
  formatEventDate,
  formatHistoricalDate,
  formatHistoricalDateAt,
  formatHistoricalRange,
  formatHistoricalTimestamp,
  worldYearLabel,
} from './historicalTime'
import { useWorldCalendarStore } from '@/stores/worldCalendarStore'
import type { GraphCalendar } from '@/types'

const AR: GraphCalendar = { epochYear: 1000, eraLabel: 'AR', name: 'the Reckoning of Vael' }
const UNLABELLED: GraphCalendar = { epochYear: 1000 }

const DATE_OPTIONS: Intl.DateTimeFormatOptions = { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' }

afterEach(() => {
  useWorldCalendarStore.getState().setCalendar(null)
})

describe('historical dates in a world calendar', () => {
  it('relabels the year with the era label, keeping month and day as stored', () => {
    expect(formatHistoricalDate('1311-03-04T00:00:00Z', 'en-US', AR)).toBe('Mar 4, 312 AR')
    expect(formatHistoricalDate('1000-01-01T00:00:00Z', 'en-US', AR)).toBe('Jan 1, 1 AR')
  })

  it('writes "Year N" without a label (or with a blank one)', () => {
    expect(formatHistoricalDate('1311-03-04T00:00:00Z', 'en-US', UNLABELLED)).toBe('Mar 4, Year 312')
    expect(formatHistoricalDate('1311-03-04T00:00:00Z', 'en-US', { epochYear: 1000, eraLabel: '  ' })).toBe(
      'Mar 4, Year 312'
    )
  })

  it('counts back before year 1', () => {
    expect(formatHistoricalDate('0999-06-01T00:00:00Z', 'en-US', AR)).toBe('Jun 1, 1 before AR')
    expect(formatHistoricalDate('0990-06-01T00:00:00Z', 'en-US', AR)).toBe('Jun 1, 10 before AR')
    expect(formatHistoricalDate('0999-06-01T00:00:00Z', 'en-US', UNLABELLED)).toBe('Jun 1, 1 before Year 1')
  })

  it('shows each precision', () => {
    const stored = '1311-03-04T00:00:00Z'
    expect(formatHistoricalDateAt(stored, 'day', 'en-US', AR)).toBe('Mar 4, 312 AR')
    expect(formatHistoricalDateAt(stored, 'month', 'en-US', AR)).toBe('Mar 312 AR')
    expect(formatHistoricalDateAt(stored, 'year', 'en-US', AR)).toBe('312 AR')
    expect(formatEventDate({ timestamp: stored, metadata: { datePrecision: 'month' } }, 'en-US', AR)).toBe('Mar 312 AR')
    expect(formatEventDate({ timestamp: stored, metadata: { datePrecision: 'year' } }, 'en-US', UNLABELLED)).toBe('Year 312')
  })

  it('keeps the UTC time of a timestamp that is not midnight', () => {
    expect(formatHistoricalTimestamp('1311-03-04T14:30:00Z', 'en-US', AR)).toBe('Mar 4, 312 AR, 14:30 UTC')
    expect(formatHistoricalTimestamp('1311-03-04T00:00:00Z', 'en-US', AR)).toBe('Mar 4, 312 AR')
  })

  it('formats both ends of a range', () => {
    expect(formatHistoricalRange('1311-03-04T00:00:00Z', '1320-12-31T00:00:00Z', 'en-US', AR)).toBe(
      'Mar 4, 312 AR – Dec 31, 321 AR'
    )
  })

  it("keeps a non-English locale's order and month names", () => {
    const date = new Date('1311-03-04T00:00:00Z')
    const stored = date.toLocaleDateString('de-DE', DATE_OPTIONS)
    expect(stored).toMatch(/1311$/)
    expect(formatHistoricalDate(date, 'de-DE', AR)).toBe(stored.replace('1311', '312 AR'))

    const japanese = date.toLocaleDateString('ja-JP', DATE_OPTIONS)
    expect(formatHistoricalDate(date, 'ja-JP', AR)).toBe(japanese.replace('1311', '312 AR'))
  })

  it('shows the stored month and day in a locale whose default calendar is not Gregorian', () => {
    // th-TH counts Buddhist years; the world calendar replaces the year and keeps 4 March.
    const formatted = formatHistoricalDate('1311-03-04T00:00:00Z', 'th-TH', AR)
    expect(formatted).toMatch(/^4 /)
    expect(formatted).toMatch(/312 AR$/)
  })

  it("uses the active graph's calendar when none is passed, and none for an explicit null", () => {
    useWorldCalendarStore.getState().setCalendar(AR)
    expect(formatHistoricalDate('1311-03-04T00:00:00Z', 'en-US')).toBe('Mar 4, 312 AR')
    expect(formatEventDate({ timestamp: '1311-03-04T00:00:00Z' }, 'en-US')).toBe('Mar 4, 312 AR')
    expect(formatHistoricalDate('1311-03-04T00:00:00Z', 'en-US', null)).toBe('Mar 4, 1311')
    expect(worldYearLabel(1311)).toBe('312 AR')
    expect(worldYearLabel(1311, null)).toBeNull()
  })

  it('still says an unreadable date is invalid', () => {
    expect(formatHistoricalDate('not a date', 'en-US', AR)).toBe('Invalid date')
    expect(formatHistoricalDateAt('not a date', 'year', 'en-US', AR)).toBe('Invalid date')
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
        expect(formatHistoricalDate(sample, locale)).toBe(date.toLocaleDateString(locale, DATE_OPTIONS))
        expect(formatHistoricalDateAt(sample, 'month', locale)).toBe(
          date.toLocaleDateString(locale, { timeZone: 'UTC', year: 'numeric', month: 'short' })
        )
        expect(formatHistoricalDateAt(sample, 'year', locale)).toBe(
          date.toLocaleDateString(locale, { timeZone: 'UTC', year: 'numeric' })
        )
      }
    }
    expect(formatHistoricalTimestamp('1843-11-20T14:30:00Z', 'en-US')).toBe('Nov 20, 1843, 14:30 UTC')
    expect(formatHistoricalRange('1843-11-20T00:00:00Z', '1868-01-09T00:00:00Z', 'en-US')).toBe(
      'Nov 20, 1843 – Jan 9, 1868'
    )
  })

  it('is unchanged once a calendar is cleared', () => {
    useWorldCalendarStore.getState().setCalendar(AR)
    useWorldCalendarStore.getState().setCalendar(null)
    expect(formatHistoricalDate('1843-11-20T00:00:00Z', 'en-US')).toBe('Nov 20, 1843')
  })
})
