import { describe, it, expect } from 'vitest';
import {
  calendarProblems,
  describeCalendar,
  formatWorldDate,
  formatWorldYear,
  normalizeCalendar,
  storedYear,
  worldYear,
} from './worldCalendar';

describe('worldCalendar', () => {
  const reckoning = { epochYear: 1000, eraLabel: 'AR' };

  it('makes the epoch year the world year 1, and back', () => {
    expect(worldYear(1000, reckoning)).toBe(1);
    expect(worldYear(1311, reckoning)).toBe(312);
    expect(storedYear(312, reckoning)).toBe(1311);
    expect(storedYear(worldYear(1234, reckoning), reckoning)).toBe(1234);
  });

  it('writes a year with its label, or as "Year N" without one', () => {
    expect(formatWorldYear(1311, reckoning)).toBe('312 AR');
    expect(formatWorldYear(1311, { epochYear: 1000 })).toBe('Year 312');
    expect(formatWorldYear(1311, { epochYear: 1000, eraLabel: '   ' })).toBe('Year 312');
  });

  it('counts back before year 1 instead of writing a year 0 or a minus sign', () => {
    expect(formatWorldYear(999, reckoning)).toBe('1 before AR');
    expect(formatWorldYear(990, reckoning)).toBe('10 before AR');
    expect(formatWorldYear(999, { epochYear: 1000 })).toBe('1 before Year 1');
  });

  it('formats a stored timestamp in the world calendar at each precision, in UTC', () => {
    expect(formatWorldDate('1311-03-04T00:00:00Z', reckoning)).toBe('Mar 4, 312 AR');
    expect(formatWorldDate('1311-03-04T00:00:00Z', reckoning, 'month')).toBe('Mar 312 AR');
    expect(formatWorldDate('1311-03-04T00:00:00Z', reckoning, 'year')).toBe('312 AR');
    // The last instant of a UTC year is still that year, whatever the host's zone.
    expect(formatWorldDate('1311-12-31T23:59:59Z', reckoning, 'year')).toBe('312 AR');
  });

  it('formats as an ISO date when there is no calendar', () => {
    expect(formatWorldDate('1311-03-04T10:00:00Z', undefined)).toBe('1311-03-04');
    expect(formatWorldDate('1311-03-04T10:00:00Z', undefined, 'year')).toBe('1311');
  });

  it('describes how the calendar maps', () => {
    expect(describeCalendar({ ...reckoning, name: 'the Reckoning' })).toBe('the Reckoning: stored year 1000 is 1 AR');
  });

  describe('checking', () => {
    it('accepts a calendar with an epoch year alone', () => {
      expect(calendarProblems({ epochYear: 1000 })).toEqual([]);
    });

    it('refuses what is not a usable calendar', () => {
      expect(calendarProblems(null)).not.toEqual([]);
      expect(calendarProblems([])).not.toEqual([]);
      expect(calendarProblems({})).toContain('calendar.epochYear must be an integer year');
      expect(calendarProblems({ epochYear: 1000.5 })).toContain('calendar.epochYear must be an integer year');
      expect(calendarProblems({ epochYear: '1000' })).toContain('calendar.epochYear must be an integer year');
      expect(calendarProblems({ epochYear: 0 })[0]).toMatch(/between 1 and 9999/);
      expect(calendarProblems({ epochYear: 10000 })[0]).toMatch(/between 1 and 9999/);
      expect(calendarProblems({ epochYear: 1000, eraLabel: 'x'.repeat(17) })[0]).toMatch(/at most 16/);
      expect(calendarProblems({ epochYear: 1000, eraLabel: 7 })).toContain('calendar.eraLabel must be a string');
      expect(calendarProblems({ epochYear: 1000, name: 'x'.repeat(81) })[0]).toMatch(/at most 80/);
      expect(calendarProblems({ epochYear: 1000, offset: 3 })).toContain('calendar has an unknown field "offset"');
    });

    it('trims the text and drops empty optional fields', () => {
      expect(normalizeCalendar({ epochYear: 1000, eraLabel: '  AR ', name: '  ' })).toEqual({
        epochYear: 1000,
        eraLabel: 'AR',
      });
    });

    it('throws with every problem when normalizing a bad calendar', () => {
      expect(() => normalizeCalendar({ epochYear: 0, eraLabel: 5 })).toThrow(/epochYear.*eraLabel/);
    });
  });
});
