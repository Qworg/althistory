import { describe, expect, it } from 'vitest';
import { type WorldCalendarSet, calendarIn, positionOf } from '@althistory/calendar';
import { readAgentTimestamp } from './timestamps';

/** Vael's Reckoning: twelve months of thirty days and the Drowned Days, a day of 30 Earth hours divided into 20. */
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
const at = (year: number, part: number, day: number, hour = 0) =>
  new Date(positionOf(calendarIn(VAEL), { year, part, day, hour, minute: 0, second: 0 })!).toISOString();
const before = (iso: string) => new Date(Date.parse(iso) - 1).toISOString();

describe('a date an agent gives', () => {
  it("reads the world's notation, with the precision it states", () => {
    expect(readAgentTimestamp('Thaw 4, 312 AR', VAEL)).toEqual({ iso: at(312, 2, 4), precision: 'day', calendar: 'reckoning' });
    expect(readAgentTimestamp('Thaw 312 AR', VAEL)).toEqual({ iso: at(312, 2, 1), precision: 'month', calendar: 'reckoning' });
    expect(readAgentTimestamp('312 AR', VAEL)).toEqual({ iso: at(312, 0, 1), precision: 'year', calendar: 'reckoning' });
    expect(readAgentTimestamp('1843-11-20', VAEL)).toEqual({ iso: '1843-11-20T00:00:00.000Z', precision: 'day' });
  });

  it("reads an end without a time as the last moment of what it names, as the API does", () => {
    expect(readAgentTimestamp('Thaw 4, 312 AR', VAEL, 'end').iso).toBe(before(at(312, 2, 5)));
    expect(readAgentTimestamp('Thaw 312 AR', VAEL, 'end').iso).toBe(before(at(312, 3, 1)));
    expect(readAgentTimestamp('312 AR', VAEL, 'end').iso).toBe(before(at(313, 0, 1)));
    // A time names that moment, midnight included; an ISO date alone, as an end, is its UTC day's last moment.
    expect(readAgentTimestamp('Thaw 4, 312 AR, 00:00', VAEL, 'end').iso).toBe(at(312, 2, 4));
    expect(readAgentTimestamp('1843-11-20', VAEL, 'end').iso).toBe('1843-11-20T23:59:59.999Z');
    expect(readAgentTimestamp('1843-11-20T00:00:00Z', VAEL, 'end').iso).toBe('1843-11-20T00:00:00.000Z');
    // A Gregorian month is no month of the world's.
    expect(() => readAgentTimestamp('1871-03', VAEL)).toThrow(/Gregorian month/);
  });

  it("refuses what it cannot read, with an example in the world's notation", () => {
    expect(() => readAgentTimestamp('Thaw 31, 312 AR', VAEL)).toThrow(/Thaw has 30 days.*reads like "Lowtide 1, 1 AR"/);
    expect(() => readAgentTimestamp('soon', undefined)).toThrow(/an ISO 8601 date/);
  });
});
