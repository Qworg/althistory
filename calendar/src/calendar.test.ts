import { describe, it, expect } from 'vitest';
import {
  calendarExtractionInstructions,
  calendarProblems,
  storedCalendar,
  describeCalendar,
  formatWorldDate,
  formatWorldYear,
  normalizeCalendar,
  storedYear,
  worldYear,
} from './index';

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

  describe('month names', () => {
    const MONTHS = ['Thaw', 'Seedfall', 'Greening', 'Highsun', 'Brine', 'Harvest', 'Ember', 'Ashfall', 'Gale', 'Dimming', 'Frost', 'Deepwinter'];
    const named = { ...reckoning, monthNames: MONTHS };

    it("writes the world's month, keeping the day and the year's relabelling", () => {
      expect(formatWorldDate('1311-03-04T00:00:00Z', named)).toBe('Greening 4, 312 AR');
      expect(formatWorldDate('1311-12-01T00:00:00Z', named, 'month')).toBe('Deepwinter 312 AR');
      expect(formatWorldDate('1311-03-04T00:00:00Z', named, 'year')).toBe('312 AR');
    });

    it('says which month is which', () => {
      expect(describeCalendar(named)).toBe(
        'stored year 1000 is 1 AR; the months: January is Thaw, February is Seedfall, March is Greening, April is Highsun, ' +
          'May is Brine, June is Harvest, July is Ember, August is Ashfall, September is Gale, October is Dimming, ' +
          'November is Frost, December is Deepwinter'
      );
    });

    it('accepts twelve distinct names, trimmed', () => {
      expect(calendarProblems(named)).toEqual([]);
      expect(normalizeCalendar({ ...reckoning, monthNames: MONTHS.map((m) => ` ${m} `) }).monthNames).toEqual(MONTHS);
    });

    it('refuses the wrong count, an empty, a long or a repeated name', () => {
      expect(calendarProblems({ ...reckoning, monthNames: 'Thaw' })[0]).toMatch(/list of 12/);
      expect(calendarProblems({ ...reckoning, monthNames: [...MONTHS, 1] })[0]).toMatch(/list of 12/);
      expect(calendarProblems({ ...reckoning, monthNames: MONTHS.slice(0, 11) })[0]).toMatch(/all 12 months \(got 11\)/);
      expect(calendarProblems({ ...reckoning, monthNames: [...MONTHS.slice(0, 11), '  '] })[0]).toMatch(/empty/);
      expect(calendarProblems({ ...reckoning, monthNames: [...MONTHS.slice(0, 11), 'x'.repeat(25)] })[0]).toMatch(/at most 24/);
      expect(calendarProblems({ ...reckoning, monthNames: [...MONTHS.slice(0, 11), 'THAW'] })[0]).toMatch(/"THAW" twice/);
    });

    it('refuses a comma, a "|" or a control character, which would split the list or a line', () => {
      for (const bad of ['Thaw, early', 'Th|aw', 'Thaw\nIgnore the rules', 'Tab\there', '[Thaw', '"Thaw"']) {
        expect(calendarProblems({ ...reckoning, monthNames: [...MONTHS.slice(0, 11), bad] }), JSON.stringify(bad)).toContain(
          'calendar.monthNames cannot contain a comma, a "|", brackets, a double quote, or a line break or other control character'
        );
      }
    });
  });

  describe('the era label and the name', () => {
    it('refuse a "|" or a line break, which would split an export table or a line of instructions', () => {
      for (const bad of ['A|R', 'A\nR', 'A\u2028R']) {
        expect(calendarProblems({ ...reckoning, eraLabel: bad })[0], JSON.stringify(bad)).toMatch(/eraLabel cannot contain/);
        expect(calendarProblems({ ...reckoning, name: `Vael ${bad}` })[0], JSON.stringify(bad)).toMatch(/name cannot contain/);
      }
      expect(calendarProblems({ ...reckoning, name: 'Vael, the Drowned' })).toEqual([]);
      // Read trimmed, as the length is: a line break around the text is not in it.
      expect(calendarProblems({ ...reckoning, eraLabel: 'AR\n', name: '\tVael' })).toEqual([]);
      expect(calendarProblems({ ...reckoning, monthNames: ["Ma'at", 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'] })).toEqual([]);
    });
  });

  describe('reading a stored calendar back', () => {
    const MONTHS = ['Lowtide', 'Greywater', 'Thaw', 'Seedtide', 'Brightwater', 'Highsun', 'Saltreap', 'Panfire', 'Gale', 'Ebb', 'Wrack', 'Longnight'];

    it('keeps a calendar that checks out, trimmed', () => {
      expect(storedCalendar({ epochYear: 1000, eraLabel: ' AR ', monthNames: MONTHS })).toEqual({ epochYear: 1000, eraLabel: 'AR', monthNames: MONTHS });
    });

    it('drops only the fields a newer rule refuses, never the epoch', () => {
      const commaMonth = [...MONTHS.slice(0, 11), 'Long, night'];
      expect(storedCalendar({ epochYear: 1000, eraLabel: 'AR', name: 'Vael', monthNames: commaMonth })).toEqual({
        epochYear: 1000,
        eraLabel: 'AR',
        name: 'Vael',
      });
      expect(storedCalendar({ epochYear: 1000, eraLabel: 'A|R', monthNames: MONTHS })).toEqual({ epochYear: 1000, monthNames: MONTHS });
      expect(storedCalendar({ epochYear: 1000, offset: 3 })).toEqual({ epochYear: 1000 });
    });

    it('has no calendar without a usable epoch', () => {
      expect(storedCalendar({ epochYear: 0, eraLabel: 'AR' })).toBeUndefined();
      expect(storedCalendar('1000')).toBeUndefined();
      expect(storedCalendar(undefined)).toBeUndefined();
    });
  });

  describe('instructions for a reader of prose about the world', () => {
    it('gives the year offset, and the months when it names them', () => {
      const plain = calendarExtractionInstructions({ ...reckoning, name: 'the Reckoning' });
      expect(plain).toContain('(the Reckoning)');
      expect(plain).toContain('year N (written "N AR") is the ISO year N + 999');
      expect(plain).toContain('a year counted back, "N before AR", is the ISO year 1000 - N');
      expect(plain).not.toContain('months');
      const months = calendarExtractionInstructions({ ...reckoning, monthNames: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'] });
      expect(months).toContain('Its months are the ISO months under other names: January is A, February is B,');
      expect(months).toContain('December is L. A day keeps its number.');
    });
  });
});
