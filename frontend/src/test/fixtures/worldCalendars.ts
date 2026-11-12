import { type CalendarDefinition, type WorldCalendarSet, legacyCalendarSet, positionOf, calendarIn } from '@althistory/calendar'

/** A Gregorian calendar with its years relabelled: stored 1000 is 1 AR (the earlier form of calendar). */
export const AR: WorldCalendarSet = legacyCalendarSet({ epochYear: 1000, eraLabel: 'AR', name: 'the Reckoning of Vael' })

/**
 * Vael's reckoning: thirteen months of thirty days, two festivals (the
 * Drowned Days gaining a fifth day every sixth year), a five-day week that
 * skips the festivals, and a day of 30 Earth hours divided into 20 of its own.
 */
export const RECKONING: CalendarDefinition = {
  id: 'reckoning',
  name: 'the Reckoning of the Rising',
  parts: [
    ...['Lowtide', 'Greywater', 'Thaw', 'Seedtide', 'Brightwater', 'Highsun'].map((name) => ({ name, days: 30 })),
    { name: "Midyear's Day", days: 1, intercalary: true },
    ...['Saltreap', 'Panfire', 'Gale', 'Ebb', 'Wrack', 'Longnight'].map((name) => ({ name, days: 30 })),
    { name: 'The Drowned Days', days: 4, intercalary: true },
  ],
  leapRules: [{ every: 6, part: 13, days: 1 }],
  epoch: 0,
  eras: [{ label: 'AR', from: 1 }],
  week: { days: ['Firstfast', 'Netday', 'Saltday', 'Moonsday', 'Restday'], skipsIntercalary: true },
  time: { hoursPerDay: 20, minutesPerHour: 100, secondsPerMinute: 100 },
}

/** The coast's count: two half-years, its year 1 a hundred days before the Reckoning's. */
export const TIDE_COUNT: CalendarDefinition = {
  id: 'tide',
  name: 'the Tide-count',
  parts: [{ name: 'Ebbing', days: 183 }, { name: 'Flooding', days: 183 }],
  epoch: -100,
  eras: [{ label: 'TC', from: 1 }],
}

/** Vael: the Reckoning shown, the Tide-count beside it. */
export const VAEL: WorldCalendarSet = { version: 2, dayLength: 30 * 3600, calendars: [RECKONING, TIDE_COUNT], primary: 'reckoning' }

/** Vael with only the Reckoning. */
export const VAEL_ONE: WorldCalendarSet = { ...VAEL, calendars: [RECKONING] }

/** The timeline position of a date in Vael's Reckoning (part is the 0-based month or festival). */
export function vael(year: number, part: number, day: number, hour = 0, minute = 0): Date {
  return new Date(positionOf(calendarIn(VAEL), { year, part, day, hour, minute, second: 0 })!)
}
