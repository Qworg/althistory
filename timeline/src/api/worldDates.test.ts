import { describe, expect, it } from 'vitest';
import { type WorldCalendarSet, calendarIn, positionOf } from '@althistory/calendar';
import { readRequestTime } from './worldDates';
import { ValidationError } from '../utils/errors';

/** Vael's Reckoning alone: thirteen months of thirty days and a festival, a 30-hour day of 20 hours. */
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
  positionOf(calendarIn(VAEL), { year, part, day, hour, minute: 0, second: 0 })!;
const calendarOf = async () => VAEL;

describe('a time sent for a graph with world calendars', () => {
  it('reads ISO 8601 as it always did, without asking for the calendar', async () => {
    const read = await readRequestTime('1843-11-20T14:30:00Z', 'timestamp', async () => {
      throw new Error('not needed');
    });
    expect(read).toEqual({ date: new Date('1843-11-20T14:30:00Z') });
  });

  it("reads the world's notation and fields, recording a month's or a year's precision", async () => {
    expect(await readRequestTime('Thaw 4, 312 AR', 'timestamp', calendarOf)).toEqual({ date: new Date(at(312, 2, 4)) });
    expect(await readRequestTime('Thaw 312 AR', 'timestamp', calendarOf)).toEqual({ date: new Date(at(312, 2, 1)), precision: 'month' });
    expect(await readRequestTime({ year: 312, month: 'Thaw', day: 4, hour: 6 }, 'timestamp', calendarOf)).toEqual({ date: new Date(at(312, 2, 4, 6)) });
  });

  it("reads an arc's end as the last moment of the day, month or year it names, unless it gives a time", async () => {
    const end = async (value: unknown) => (await readRequestTime(value, 'end_time', calendarOf, 'end')).date.getTime();
    expect(await end('Thaw 4, 312 AR')).toBe(at(312, 2, 5) - 1);
    expect(await end('Thaw 312 AR')).toBe(at(312, 3, 1) - 1);
    expect(await end('312 AR')).toBe(at(313, 0, 1) - 1);
    // A time, even midnight, names that moment.
    expect(await end('Thaw 4, 312 AR, 00:00')).toBe(at(312, 2, 4));
    expect(await end({ year: 312, month: 'Thaw', day: 4, hour: 0 })).toBe(at(312, 2, 4));
  });

  it('refuses a date the world does not have, naming the field', async () => {
    await expect(readRequestTime('Thaw 31, 312 AR', 'timestamp', calendarOf)).rejects.toThrow(ValidationError);
    await expect(readRequestTime({ year: 312, month: 'Thaw', day: 31 }, 'timestamp', calendarOf)).rejects.toThrow(/timestamp: Thaw has 30 days/);
    await expect(readRequestTime({ year: 312 }, 'timestamp', async () => undefined)).rejects.toThrow(/needs a graph with a world calendar/);
  });
});
