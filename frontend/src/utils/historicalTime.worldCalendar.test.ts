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
    expect(formatHistoricalDate(date, 'en-GB', AR)).toBe('4 Mar 312 AR')
    expect(formatHistoricalDate(date, 'fr-FR', AR)).toBe('4 mars 312 AR')
  })

  it("drops the locale's year markers, which belong to a number and not to a world year", () => {
    const stored = '1311-03-04T00:00:00Z'
    // Year first: the marker after it (年, 년, hu's ". ", lt's "-") goes.
    expect(formatHistoricalDate(stored, 'ja-JP', AR)).toBe('312 AR 3月4日')
    expect(formatHistoricalDate(stored, 'zh-CN', AR)).toBe('312 AR 3月4日')
    expect(formatHistoricalDate(stored, 'ko-KR', AR)).toBe('312 AR 3월 4일')
    expect(formatHistoricalDate(stored, 'hu-HU', AR)).toBe('312 AR márc. 4.')
    expect(formatHistoricalDate(stored, 'lt-LT', AR)).toBe('312 AR 03-04')
    expect(formatHistoricalDateAt(stored, 'month', 'ja-JP', AR)).toBe('312 AR 3月')
    // Two numbers never run together.
    expect(formatHistoricalDate(stored, 'ja-JP', UNLABELLED)).toBe('Year 312, 3月4日')
    // Year last: the " г." of ru and bg goes; a numeric date is set off by a comma.
    expect(formatHistoricalDate(stored, 'ru-RU', AR)).toBe('4 мар. 312 AR')
    expect(formatHistoricalDate(stored, 'bg-BG', AR)).toBe('4.03, 312 AR')
    expect(formatHistoricalTimestamp('1311-03-04T14:30:00Z', 'ja-JP', AR)).toBe('312 AR 3月4日, 14:30 UTC')
  })

  it("writes the world year in the locale's digits", () => {
    expect(formatHistoricalDate('1311-03-04T00:00:00Z', 'ar-EG', AR)).toBe('٤ مارس ٣١٢ AR')
    expect(formatHistoricalDate('1311-03-04T00:00:00Z', 'fa-IR', AR)).toBe('۴ مارس ۳۱۲ AR')
    expect(formatHistoricalDate('1311-03-04T00:00:00Z', 'en-US-u-nu-arab', AR)).toBe('Mar ٤, ٣١٢ AR')
    expect(formatHistoricalDateAt('1311-03-04T00:00:00Z', 'year', 'ar-EG', AR)).toBe('٣١٢ AR')
    // Never grouped: 1500, not 1,500.
    expect(formatHistoricalDate('-000500-03-04T00:00:00Z', 'en-US', AR)).toBe('Mar 4, 1500 before AR')
  })

  it('ignores a locale calendar extension and its era', () => {
    expect(formatHistoricalDate('1311-03-04T00:00:00Z', 'ja-JP-u-ca-japanese', AR)).toBe('312 AR 3月4日')
    expect(formatHistoricalDate('1311-03-04T00:00:00Z', 'en-US-u-ca-buddhist', AR)).toBe('Mar 4, 312 AR')
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
        // A month or a year is the Gregorian one whatever the locale's calendar:
        // th-TH's Buddhist year 2386 started in April 1843, so "2386" for an
        // event known only to be in 1843 named the wrong year for a quarter of
        // it. (Every Gregorian locale reads as it did.)
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
    useWorldCalendarStore.getState().setCalendar(AR)
    useWorldCalendarStore.getState().setCalendar(null)
    expect(formatHistoricalDate('1843-11-20T00:00:00Z', 'en-US')).toBe('Nov 20, 1843')
  })
})

describe('a world year after a numeric date', () => {
  // Found in review: the locale's separator hung off the world year
  // ("4/03/ 312 AR"), and a comma with no space made "ಮಾರ್ಚ್ 4,312".
  it.each([
    ['pt-PT', 'day', '4/03, 312 AR'],
    ['pt-PT', 'month', '03, 312 AR'],
    ['bg-BG', 'day', '4.03, 312 AR'],
    ['sk-SK', 'month', '3, 312 AR'],
    ['kn-IN', 'day', 'ಮಾರ್ಚ್ 4, 312 AR'],
    ['ru-RU', 'day', '4 мар. 312 AR'],
  ] as const)('%s at %s precision reads %s', (locale, precision, expected) => {
    expect(formatHistoricalDateAt('1311-03-04T00:00:00Z', precision, locale, { epochYear: 1000, eraLabel: 'AR' })).toBe(expected)
  })
})

describe('historical dates in a world calendar that names its months', () => {
  const MONTHS = ['Thaw', 'Seedfall', 'Greening', 'Highsun', 'Brine', 'Harvest', 'Ember', 'Ashfall', 'Gale', 'Dimming', 'Frost', 'Deepwinter']
  const NAMED: GraphCalendar = { ...AR, monthNames: MONTHS }

  it("writes the world's month in place of the stored one, keeping the day", () => {
    expect(formatHistoricalDate('1311-03-04T00:00:00Z', 'en-US', NAMED)).toBe('Greening 4, 312 AR')
    expect(formatHistoricalDate('1311-12-31T00:00:00Z', 'en-US', NAMED)).toBe('Deepwinter 31, 312 AR')
    expect(formatHistoricalTimestamp('1311-03-04T14:30:00Z', 'en-US', NAMED)).toBe('Greening 4, 312 AR, 14:30 UTC')
  })

  it('names the month at month precision, and leaves year precision alone', () => {
    expect(formatHistoricalDateAt('1311-03-01T00:00:00Z', 'month', 'en-US', NAMED)).toBe('Greening 312 AR')
    expect(formatHistoricalDateAt('1311-03-01T00:00:00Z', 'year', 'en-US', NAMED)).toBe('312 AR')
  })

  it("keeps the locale's order", () => {
    expect(formatHistoricalDate('1311-03-04T00:00:00Z', 'en-GB', NAMED)).toBe('4 Greening 312 AR')
    expect(formatHistoricalDate('1311-03-04T00:00:00Z', 'de-DE', NAMED)).toBe('4. Greening 312 AR')
  })

  it('drops the mark after a numeric month rather than writing "Greening月"', () => {
    const text = formatHistoricalDate('1311-03-04T00:00:00Z', 'ja-JP', NAMED)
    expect(text).toContain('Greening')
    expect(text).not.toContain('月')
    expect(text).toContain('312 AR')
  })

  it("drops a numeric month's dots and dashes along with the number", () => {
    for (const locale of ['bg-BG', 'fi-FI', 'cs-CZ', 'lt-LT']) {
      const day = formatHistoricalDate('1311-03-04T00:00:00Z', locale, NAMED)
      const month = formatHistoricalDateAt('1311-03-01T00:00:00Z', 'month', locale, NAMED)
      expect(day, locale).toMatch(/(^|\s)Greening(\s|$)/u)
      expect(day, locale).toContain('312 AR')
      expect(month, locale).toMatch(/(^|\s)Greening(\s|$)/u)
      expect(`${day} ${month}`, locale).not.toMatch(/[.-]Greening|Greening[.-]/u)
    }
    // The dot after the day is its ordinal, as de writes "4. Greening".
    expect(formatHistoricalDate('1311-03-04T00:00:00Z', 'cs-CZ', NAMED)).toBe('4. Greening 312 AR')
    expect(formatHistoricalDate('1311-03-04T00:00:00Z', 'fi-FI', NAMED)).toBe('4. Greening 312 AR')
    // bg's dot only separates numbers: it writes "4 март", so "4 Greening".
    expect(formatHistoricalDate('1311-03-04T00:00:00Z', 'bg-BG', NAMED)).toBe('4 Greening 312 AR')
    expect(formatHistoricalDate('1311-03-04T00:00:00Z', 'de-DE', NAMED)).toBe('4. Greening 312 AR')
  })

  it('follows the active calendar when none is passed', () => {
    useWorldCalendarStore.getState().setCalendar(NAMED)
    expect(formatHistoricalDate('1311-03-04T00:00:00Z', 'en-US')).toBe('Greening 4, 312 AR')
  })
})
