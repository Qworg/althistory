import { describe, it, expect } from 'vitest'
import { formatEventDate, formatHistoricalDate, formatHistoricalRange, formatHistoricalTimestamp } from './historicalTime'

describe('historical time formatting', () => {
  it('shows a stored date (UTC midnight) as the date alone', () => {
    expect(formatHistoricalTimestamp('1843-11-20T00:00:00.000Z', 'en-US')).toBe('Nov 20, 1843')
  })

  it('does not move a date to the previous day west of Greenwich', () => {
    // The formatter pins UTC, so the result cannot depend on the runner's zone;
    // this is the date that rendered as "11/19/1843, 4:07:02 PM" in Pacific time.
    const formatted = formatHistoricalDate(new Date(Date.UTC(1843, 10, 20)), 'en-US')
    expect(formatted).toBe('Nov 20, 1843')
  })

  it('shows a time of day, in UTC, only when the timestamp has one', () => {
    expect(formatHistoricalTimestamp('1916-07-01T07:30:00.000Z', 'en-US')).toBe('Jul 1, 1916, 07:30 UTC')
  })

  it('formats ranges', () => {
    expect(formatHistoricalRange('1855-08-20T00:00:00Z', '1868-01-09T00:00:00Z', 'en-US')).toBe(
      'Aug 20, 1855 – Jan 9, 1868'
    )
  })

  it('says so for an invalid date rather than printing NaN', () => {
    expect(formatHistoricalTimestamp('not a date', 'en-US')).toBe('Invalid date')
  })
})

describe('event dates at the precision their source gave', () => {
  const at = (datePrecision?: string) => ({ timestamp: '1871-03-01T00:00:00.000Z', metadata: datePrecision ? { datePrecision } : {} })

  it('does not invent a day for "March 1871", or a month for "1871"', () => {
    expect(formatEventDate(at('month'), 'en-US')).toBe('Mar 1871')
    expect(formatEventDate(at('year'), 'en-US')).toBe('1871')
  })

  it('shows a full date when the precision is a day or unrecorded', () => {
    expect(formatEventDate(at('day'), 'en-US')).toBe('Mar 1, 1871')
    expect(formatEventDate(at(), 'en-US')).toBe('Mar 1, 1871')
    expect(formatEventDate(at('fortnight'), 'en-US')).toBe('Mar 1, 1871')
  })
})
