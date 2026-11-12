import { describe, expect, it } from 'vitest'
import { compactReviewDate, isReadableReviewDate, readReviewDate } from './reviewLabels'
import { formatHistoricalTimestamp } from '@/utils/historicalTime'
import { readTimestamp } from '@althistory/calendar'
import { VAEL, vael } from '@/test/fixtures/worldCalendars'

describe('a date in the ingestion review', () => {
  // What a model writes for a date: ISO 8601 in its several forms, and the
  // prose it sometimes gives instead.
  const readable = [
    '1843-11-20T00:00:00Z',
    '1843-11-20T00:00:00.000Z',
    '1843-11-20',
    '1871-03',
    '1066',
    '1870-02-14 09:30',
    '1870-02-14T09:30:00+0545',
    '1843-11-20t00:00z',
    '-000043-03-15T00:00:00Z',
  ]
  const unreadable = ['', '  ', 'Feb 14 1870', 'March 1871', '14/02/1870', '2019-02-31', '1870-02-14T24:00']

  it('is readable exactly when the server will take it, and then shows a date, never "Invalid date"', () => {
    for (const raw of readable) {
      expect(isReadableReviewDate(raw), raw).toBe(true)
      expect(formatHistoricalTimestamp(raw.trim(), 'en-US', null), raw).not.toBe('Invalid date')
    }
    // Unreadable text shows "Not a date" under the field (EntityReviewTable), not a guessed date.
    for (const raw of unreadable) expect(isReadableReviewDate(raw), raw).toBe(false)
    // The server's ingestion reads with readTimestamp: the review agrees with it on every input.
    for (const raw of [...readable, ...unreadable]) expect(isReadableReviewDate(raw), raw).toBe(readTimestamp(raw) !== null)
  })

  it('reads a reduced-precision date as its first day, in UTC', () => {
    expect(formatHistoricalTimestamp('1066', 'en-US', null)).toBe('Jan 1, 1066')
    expect(formatHistoricalTimestamp('1871-03', 'en-US', null)).toBe('Mar 1, 1871')
    expect(formatHistoricalTimestamp('1870-02-14 09:30', 'en-US', null)).toBe('Feb 14, 1870, 09:30 UTC')
  })
})

describe('review dates in a world calendar', () => {
  it("shows an extracted timestamp in the world's notation, at the precision the text gave", () => {
    expect(compactReviewDate(vael(312, 2, 4).toISOString(), VAEL)).toBe('Thaw 4, 312 AR')
    expect(compactReviewDate(vael(312, 2, 1).toISOString(), VAEL, 'month')).toBe('Thaw 312 AR')
    // What the reviewer is typing is left as it is.
    expect(compactReviewDate('Thaw 4', VAEL)).toBe('Thaw 4')
  })

  it("reads the world's notation first, then ISO 8601, as the importer does", () => {
    expect(readReviewDate('Thaw 312 AR', VAEL)).toEqual({ iso: vael(312, 2, 1).toISOString(), precision: 'month', calendar: 'reckoning' })
    expect(readReviewDate('1843-11-20', VAEL)).toEqual({ iso: '1843-11-20T00:00:00.000Z', precision: 'day' })
    expect(isReadableReviewDate('Thaw 31, 312 AR', VAEL)).toBe(false)
    expect(isReadableReviewDate('Thaw 312 AR', null)).toBe(false)
  })
})
