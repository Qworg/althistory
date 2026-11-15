import { describe, it, expect } from 'vitest';
import { type WorldCalendarSet, readWorldTimestamp } from '@althistory/calendar';
import { formatHistoricalDate, formatHistoricalSpan, formatTypedDate } from './historicalDate';

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

describe('formatTypedDate', () => {
  const at = (iso: string) => new Date(iso);

  it('writes a date as it was typed, at the precision it is known to', () => {
    expect(formatTypedDate(at('1871-01-01T00:00:00.000Z'), 'year')).toBe('1871');
    expect(formatTypedDate(at('1871-03-01T00:00:00.000Z'), 'month')).toBe('1871-03');
    expect(formatTypedDate(at('1871-03-01T00:00:00.000Z'))).toBe('1871-03-01');
    expect(formatTypedDate(at('-000043-01-01T00:00:00.000Z'), 'year')).toBe('44 BCE');
    expect(formatTypedDate(at('-000043-03-15T00:00:00.000Z'))).toBe('44-03-15 BCE');
    expect(formatTypedDate(at('1843-11-20T14:30:00.000Z'))).toBe('1843-11-20 14:30');
    expect(formatTypedDate(at('1843-11-20T23:59:59.999Z'), 'day', 'end')).toBe('1843-11-20');
  });

  it('adds the instant when the text cannot name it exactly', () => {
    expect(formatTypedDate(at('1843-11-20T14:30:15.000Z'))).toBe('1843-11-20 14:30 (1843-11-20T14:30:15.000Z)');
    // A year-precision event that is not at its year's start (a hand-edited store).
    expect(formatTypedDate(at('1871-06-01T00:00:00.000Z'), 'year')).toBe('1871 (1871-06-01T00:00:00.000Z)');
  });

  it('reads back, by the one rule, as the instant it names, for days either side of 1 CE', () => {
    for (let ms = Date.UTC(-1, 0, 1); ms < Date.UTC(2, 0, 1); ms += 86_400_000 * 7 + 3_600_000) {
      const date = new Date(ms);
      const text = formatTypedDate(date);
      expect(readWorldTimestamp(null, text)?.iso, text).toBe(date.toISOString());
    }
  });
});
