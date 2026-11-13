import { describe, expect, it } from 'vitest';
import { type WorldCalendarSet, calendarIn, positionOf } from '@althistory/calendar';
import { newDateMetadata, readRequestTime } from './worldDates';
import { ValidationError } from '../utils/errors';

/** A Reckoning of twelve months of thirty days and five festival days, in a 30-hour day of 20 hours. */
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
    expect(await readRequestTime('Thaw 4, 312 AR', 'timestamp', calendarOf)).toEqual({ date: new Date(at(312, 2, 4)), calendar: 'reckoning' });
    expect(await readRequestTime('Thaw 312 AR', 'timestamp', calendarOf)).toEqual({ date: new Date(at(312, 2, 1)), precision: 'month', calendar: 'reckoning' });
    expect(await readRequestTime({ year: 312, month: 'Thaw', day: 4, hour: 6 }, 'timestamp', calendarOf)).toEqual({ date: new Date(at(312, 2, 4, 6)), calendar: 'reckoning' });
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

describe('ISO 8601 text, the same at every door', () => {
  const plain = async () => undefined;

  it('names a UTC period when it is a date, a month or a year alone, its last moment as an end', async () => {
    expect(await readRequestTime('1871-03', 'timestamp', plain)).toEqual({ date: new Date('1871-03-01T00:00:00Z'), precision: 'month' });
    expect((await readRequestTime('1871-03', 'end_time', plain, 'end')).date.toISOString()).toBe('1871-03-31T23:59:59.999Z');
    expect((await readRequestTime('1871-03-04', 'end_time', plain, 'end')).date.toISOString()).toBe('1871-03-04T23:59:59.999Z');
    expect((await readRequestTime('1871-03-04T00:00:00Z', 'end_time', plain, 'end')).date.toISOString()).toBe('1871-03-04T00:00:00.000Z');
  });

  it('in a world, is read as an instant or a day, and a Gregorian month or year is refused, saying why', async () => {
    expect((await readRequestTime('2358-11-19', 'timestamp', calendarOf)).date.toISOString()).toBe('2358-11-19T00:00:00.000Z');
    await expect(readRequestTime('2358-11', 'timestamp', calendarOf)).rejects.toThrow(/Gregorian month, which is no month of this world/);
  });

  it('records the calendar a world month was given in', async () => {
    const read = await readRequestTime('Thaw 312 AR', 'timestamp', calendarOf);
    expect(read.calendar).toBe('reckoning');
    expect(newDateMetadata(undefined, { keep: 1, datePrecision: 'year', dateCalendar: 'x' }, { precision: 'day' })).toEqual({ keep: 1 });
    expect(newDateMetadata({ datePrecision: 'month' }, { keep: 1 }, { precision: 'day' })).toEqual({ datePrecision: 'month' });
    // A day written in the world's notation states its own precision.
    expect(newDateMetadata({ keep: 1, datePrecision: 'month', dateCalendar: 'tide' }, undefined, { precision: 'day', calendar: 'reckoning' })).toEqual({ keep: 1 });
  });

  it('refuses an ISO date whose end is past the range a date can hold, saying so', async () => {
    await expect(readRequestTime('+275760-09-13', 'end_time', plain, 'end')).rejects.toThrow(/beyond the range a date can hold/);
  });
});
