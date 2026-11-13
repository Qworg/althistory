import { describe, it, expect } from 'vitest';
import { type WorldCalendarSet, readWorldTimestamp } from '@althistory/calendar';
import { formatHistoricalDate, formatHistoricalSpan } from './historicalDate';

const VAEL: WorldCalendarSet = {
  version: 2,
  dayLength: 30 * 3600,
  primary: 'reckoning',
  calendars: [
    {
      id: 'reckoning',
      name: 'the Reckoning of the Rising',
      parts: [
        ...['Lowtide', 'Greywater', 'Thaw', 'Seedtide', 'Brightwater', 'Highsun', 'Saltreap', 'Panfire', 'Gale', 'Ebb', 'Wrack', 'Longnight'].map((name) => ({ name, days: 30 })),
        { name: 'The Drowned Days', days: 5, intercalary: true },
      ],
      epoch: 0,
      eras: [{ label: 'AR', from: 1 }],
      time: { hoursPerDay: 20, minutesPerHour: 100, secondsPerMinute: 100 },
    },
  ],
};

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

describe('a span in a graph with world calendars', () => {
  it("is written in the world's calendar, not the Gregorian one", () => {
    const start = readWorldTimestamp(VAEL, 'Thaw 4, 312 AR')!.iso;
    const end = readWorldTimestamp(VAEL, 'Gale 9, 312 AR')!.iso;
    expect(formatHistoricalSpan(start, end, VAEL)).toMatch(/^from Thaw 4, 312 AR.* to Gale 9, 312 AR/);
    expect(formatHistoricalSpan(start, end, VAEL)).not.toMatch(/CE|BCE|\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/);
  });
});
