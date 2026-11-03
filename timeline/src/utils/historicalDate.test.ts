import { describe, it, expect } from 'vitest';
import { formatHistoricalDate, formatHistoricalSpan } from './historicalDate';

describe('formatHistoricalDate', () => {
  it('writes a short month, day and year in UTC', () => {
    expect(formatHistoricalDate(new Date('1847-05-31T00:00:00Z'))).toBe('May 31, 1847');
    expect(formatHistoricalDate('1066-10-14T00:00:00.000Z')).toBe('Oct 14, 1066');
  });

  it('does not move a UTC-midnight date to the previous day', () => {
    // toDateString in a zone west of Greenwich wrote May 30 for this instant.
    expect(formatHistoricalDate(Date.UTC(1847, 4, 31))).toBe('May 31, 1847');
  });

  it('names an unparseable date rather than printing "Invalid Date"', () => {
    expect(formatHistoricalDate('not a date')).toBe('an unknown date');
  });
});

describe('formatHistoricalSpan', () => {
  it('writes a range as "from … to …"', () => {
    expect(formatHistoricalSpan(new Date('1847-05-31Z'), new Date('1847-06-03Z'))).toBe(
      'from May 31, 1847 to Jun 3, 1847'
    );
  });

  it('writes a single day as "on …"', () => {
    expect(formatHistoricalSpan('1847-05-31T00:00:00Z', '1847-05-31T12:00:00Z')).toBe('on May 31, 1847');
  });
});
