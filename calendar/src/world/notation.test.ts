import { describe, expect, it } from 'vitest'
import {
  type CalendarDefinition,
  type WorldCalendarSet,
  calendarIn,
  dateAt,
  formatWorldPosition,
  parseWorldDate,
  parseWorldText,
  partLengths,
  positionOf,
  readWorldInput,
  worldPeriod,
} from './index'

/** Vael's calendar: twelve months and two festivals (one with a leap day every sixth year), a five-day week that skips the festivals, a day of 30 Earth hours divided into 20 of its own. */
const reckoning: CalendarDefinition = {
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
const tideCount: CalendarDefinition = {
  id: 'tide',
  name: 'the Tide-count',
  parts: [{ name: 'Ebbing', days: 183 }, { name: 'Flooding', days: 183 }],
  epoch: -100,
  eras: [{ label: 'TC', from: 1 }],
}
const world: WorldCalendarSet = { version: 2, dayLength: 30 * 3600, calendars: [reckoning, tideCount], primary: 'reckoning' }
const calendar = calendarIn(world)

const at = (year: number, part: number, day: number, hour = 0, minute = 0) => positionOf(calendar, { year, part, day, hour, minute, second: 0 })!

describe("Vael's calendar", () => {
  it('writes its dates in its own months, festivals and hours', () => {
    expect(formatWorldPosition(calendar, at(312, 2, 4))).toBe('Thaw 4, 312 AR')
    expect(formatWorldPosition(calendar, at(312, 6, 1))).toBe("Midyear's Day, 312 AR")
    expect(formatWorldPosition(calendar, at(312, 13, 2))).toBe('The Drowned Days 2, 312 AR')
    expect(formatWorldPosition(calendar, at(312, 2, 4, 19, 99))).toBe('Thaw 4, 312 AR, 19:99')
    expect(formatWorldPosition(calendar, at(312, 2, 4), 'month')).toBe('Thaw 312 AR')
    expect(formatWorldPosition(calendar, at(-5, 0, 1), 'year')).toBe('6 before AR')
  })

  it('has a fifth Drowned Day every sixth year', () => {
    expect(partLengths(calendar, 312)[13]).toBe(5)
    expect(partLengths(calendar, 313)[13]).toBe(4)
    expect(parseWorldDate(calendar, 'The Drowned Days 5, 313 AR')).toEqual({ ok: false, error: 'The Drowned Days has 4 days that year, so no day 5' })
    expect(parseWorldDate(calendar, 'The Drowned Days 5, 312 AR').ok).toBe(true)
  })

  it('reads its dates back, at any precision, in any case and spacing', () => {
    const read = parseWorldDate(calendar, '  thaw 4 ,312   ar ')
    expect(read.ok && read.position).toBe(at(312, 2, 4))
    const month = parseWorldDate(calendar, 'Thaw 312 AR')
    expect(month.ok && month.precision).toBe('month')
    const time = parseWorldDate(calendar, 'Thaw 4, 312 AR, 19:99')
    expect(time.ok && time.position).toBe(at(312, 2, 4, 19, 99))
    expect(parseWorldDate(calendar, 'Thaw 4, 312 AR, 20:00')).toEqual({ ok: false, error: 'a day has hours 0 to 19' })
    expect(parseWorldDate(calendar, 'Thaw 31, 312 AR')).toEqual({ ok: false, error: 'Thaw has 30 days that year, so no day 31' })
    expect(parseWorldDate(calendar, 'March 4, 312 AR').ok).toBe(false)
  })

  it('runs its week past the festivals: the day after Highsun 30 and the day after the festival are a weekday apart', () => {
    const before = dateAt(calendar, at(312, 5, 30))
    const festival = dateAt(calendar, at(312, 6, 1))
    const after = dateAt(calendar, at(312, 7, 1))
    expect(festival.weekday).toBeNull()
    expect(after.weekday).toBe((before.weekday! + 1) % 5)
  })

  it('names a month as a period, from its first moment to the last millisecond before the next', () => {
    const thaw = worldPeriod(calendar, dateAt(calendar, at(312, 2, 17)), 'month')!
    expect(thaw.start).toBe(at(312, 2, 1))
    expect(thaw.end).toBe(at(312, 3, 1) - 1)
  })
})

describe('a world with two calendars', () => {
  it('reads text in either, and the same moment names the same position in both', () => {
    const inTide = parseWorldText(world, 'Flooding 20, 5 TC')
    expect(inTide.ok && inTide.calendar).toBe('tide')
    const position = inTide.ok ? inTide.position : NaN
    expect(formatWorldPosition(calendarIn(world, 'tide'), position)).toBe('Flooding 20, 5 TC')
    // Read in the Reckoning, the same position is a Reckoning date.
    const asReckoning = formatWorldPosition(calendar, position)
    const back = parseWorldText(world, asReckoning)
    expect(back.ok && back.position).toBe(position)
  })

  it('takes a date as fields, in a named calendar and era', () => {
    expect(readWorldInput(world, { calendar: 'tide', era: 'TC', year: 5, month: 'Flooding', day: 20 })).toMatchObject({ ok: true, calendar: 'tide', precision: 'day' })
    expect(readWorldInput(world, { era: 'AR', year: 312, month: 3 })).toMatchObject({ ok: true, precision: 'month', position: at(312, 2, 1) })
    expect(readWorldInput(world, { era: 'before AR', year: 6 })).toMatchObject({ ok: true, precision: 'year', position: at(-5, 0, 1) })
    expect(readWorldInput(world, { calendar: 'moon', year: 1 })).toEqual({ ok: false, error: 'the world has no calendar "moon"' })
    expect(readWorldInput(world, { year: 1, month: 'Thaw', hour: 3 })).toEqual({ ok: false, error: 'a time needs a day' })
  })
})

describe('a year counted past the next era', () => {
  const ages: WorldCalendarSet = {
    version: 2,
    dayLength: 86_400,
    primary: 'ages',
    calendars: [{ id: 'ages', name: 'the Count of Ages', parts: [{ name: 'Thaw', days: 30 }], epoch: 0, eras: [{ label: 'FA', from: 1 }, { label: 'SA', from: 900 }] }],
  }

  it('is refused as fields as it is as text, saying which era holds it', () => {
    const text = parseWorldText(ages, 'Thaw 1, 1200 FA')
    const fields = readWorldInput(ages, { era: 'FA', year: 1200, month: 'Thaw', day: 1 })
    expect(text.ok).toBe(false)
    expect(fields).toEqual(text)
    expect(fields).toMatchObject({ error: 'the Count of Ages counts FA only to 899; later years are SA' })
    // The last year of the First Age, and the same year given in the Second.
    expect(readWorldInput(ages, { era: 'FA', year: 899 })).toMatchObject({ ok: true })
    expect(readWorldInput(ages, { era: 'SA', year: 301, month: 'Thaw', day: 1 })).toMatchObject({ ok: true })
  })
})
