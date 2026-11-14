import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { formatWorldDate } from '../describe'
import * as arb from '../test/arbitraries'
import { MAX_TIME } from '../test/arbitraries'
import * as warb from '../test/worldArbitraries'
import {
  type CompiledCalendar,
  type WorldDateFields,
  calendarIn,
  compileCalendar,
  dateAt,
  daysBeforeYear,
  formatWorldFields,
  formatWorldPosition,
  formatWorldYearOf,
  gregorianDefinition,
  legacyCalendarSet,
  parseWorldDate,
  parseWorldText,
  partLengths,
  positionOf,
  worldPeriod,
} from './index'

/** A position the calendar can name, on its axis. */
const position = fc.oneof(
  fc.integer({ min: -MAX_TIME, max: MAX_TIME }),
  fc.integer({ min: -1e12, max: 1e12 }),
  fc.integer({ min: -1e6, max: 1e6 })
)

/** A compiled calendar from a generated set. */
const compiled = warb.calendarSet.map((set) => calendarIn(set))

const tuple = (d: WorldDateFields) => [d.year, d.part, d.day, d.hour, d.minute, d.second]
const compare = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!
  return 0
}

/** Positions whose date the calendar can name in full (a year that starts and ends within the range). */
const inRange = (calendar: CompiledCalendar, p: number) => {
  const year = dateAt(calendar, p).year
  const first = (calendar.definition.epoch + daysBeforeYear(calendar, year)) * calendar.dayMs
  const next = (calendar.definition.epoch + daysBeforeYear(calendar, year + 1)) * calendar.dayMs
  return Math.abs(first) <= MAX_TIME && Math.abs(next) <= MAX_TIME
}

describe('the Gregorian definition, against JavaScript\'s own UTC calendar', () => {
  it('names every millisecond a Date holds as Date names it (Req 13)', () => {
    const gregorian = compileCalendar(gregorianDefinition({}), 86_400)
    fc.assert(
      fc.property(arb.instant, (date) => {
        const d = dateAt(gregorian, date.getTime())
        expect([d.year, d.part, d.day, d.hour, d.minute, d.second]).toEqual([
          date.getUTCFullYear(),
          date.getUTCMonth(),
          date.getUTCDate(),
          date.getUTCHours(),
          date.getUTCMinutes(),
          date.getUTCSeconds(),
        ])
        expect(positionOf(gregorian, d)).toBe(BigInt(Math.floor(date.getTime() / 1000) * 1000))
      }),
      arb.runs(5000)
    )
  })
})

describe('a calendar stored in the earlier form (Req 12)', () => {
  it('shows every date exactly as it did, at every precision', () => {
    fc.assert(
      fc.property(arb.calendar, arb.instant, fc.constantFrom('day', 'month', 'year') as fc.Arbitrary<'day' | 'month' | 'year'>, (legacy, date, precision) => {
        const calendar = calendarIn(legacyCalendarSet(legacy))
        const fields = dateAt(calendar, date.getTime())
        expect(formatWorldFields(calendar, fields, precision)).toBe(formatWorldDate(date, legacy, precision))
      }),
      arb.runs(3000)
    )
  })
})

describe('any world calendar', () => {
  it('names every position, and the first position of its second reads back the same (Req 13)', () => {
    fc.assert(
      fc.property(compiled, position, (calendar, p) => {
        fc.pre(inRange(calendar, p))
        const d = dateAt(calendar, p)
        const start = positionOf(calendar, d)
        expect(start).not.toBeNull()
        expect(start!).toBeLessThanOrEqual(BigInt(p))
        expect(dateAt(calendar, start!)).toEqual(d)
        if (start! - 1n >= -BigInt(MAX_TIME)) expect(compare(tuple(dateAt(calendar, start! - 1n)), tuple(d))).toBeLessThan(0)
      }),
      arb.runs(3000)
    )
  })

  it('reads every valid date back unchanged (Req 13)', () => {
    fc.assert(
      fc.property(compiled, fc.integer({ min: -5000, max: 5000 }), fc.nat(), fc.nat(), fc.nat(), fc.nat(), fc.nat(), (calendar, year, partSeed, daySeed, h, m, s) => {
        const part = partSeed % calendar.definition.parts.length
        const day = 1 + (daySeed % partLengths(calendar, year)[part]!)
        const fields = {
          year,
          part,
          day,
          hour: h % calendar.time.hoursPerDay,
          minute: m % calendar.time.minutesPerHour,
          second: s % calendar.time.secondsPerMinute,
        }
        const p = positionOf(calendar, fields)
        fc.pre(p !== null)
        const { calendar: _id, weekday: _weekday, ...back } = dateAt(calendar, p!)
        expect(back).toEqual(fields)
      }),
      arb.runs(3000)
    )
  })

  it('never names a later position by an earlier date (Req 13)', () => {
    // Ordered by construction, not by `fc.pre`: half of all pairs are the wrong
    // way round, and every rejected pair still costs a generated calendar.
    const ordered = fc.tuple(position, position).map(([x, y]): [number, number] => (x <= y ? [x, y] : [y, x]))
    fc.assert(
      fc.property(compiled, ordered, (calendar, [a, b]) => {
        fc.pre(inRange(calendar, a) && inRange(calendar, b))
        expect(compare(tuple(dateAt(calendar, a)), tuple(dateAt(calendar, b)))).toBeLessThanOrEqual(0)
      }),
      arb.runs(3000)
    )
  })

  it('leaves no day out: the day after a date is the next day of its month, the next month, or the next year (Req 13)', () => {
    fc.assert(
      fc.property(compiled, position, (calendar, p) => {
        const today = Math.floor(p / calendar.dayMs)
        fc.pre(Math.abs((today + 2) * calendar.dayMs) <= MAX_TIME && inRange(calendar, p))
        const a = dateAt(calendar, today * calendar.dayMs)
        const b = dateAt(calendar, (today + 1) * calendar.dayMs)
        const length = partLengths(calendar, a.year)[a.part]!
        if (a.day < length) expect([b.year, b.part, b.day]).toEqual([a.year, a.part, a.day + 1])
        else if (a.part + 1 < calendar.definition.parts.length) expect([b.year, b.part, b.day]).toEqual([a.year, a.part + 1, 1])
        else expect([b.year, b.part, b.day]).toEqual([a.year + 1, 0, 1])
        expect([a.hour, a.minute, a.second]).toEqual([0, 0, 0])
      }),
      arb.runs(3000)
    )
  })

  it('repeats its leap rules over their cycle, and its years are the sum of their parts (Req 5)', () => {
    fc.assert(
      fc.property(compiled, fc.integer({ min: -100000, max: 100000 }), (calendar, year) => {
        const lengths = partLengths(calendar, year)
        expect(partLengths(calendar, year + calendar.cycleYears)).toEqual(lengths)
        expect(lengths.every((days) => days >= 1)).toBe(true)
        expect(daysBeforeYear(calendar, year + 1) - daysBeforeYear(calendar, year)).toBe(lengths.reduce((sum, days) => sum + days, 0))
      }),
      arb.runs(2000)
    )
  })

  it('runs its week through every day it counts, and skips the festival days it leaves out (Req 9)', () => {
    fc.assert(
      fc.property(compiled, position, (calendar, p) => {
        const week = calendar.definition.week
        fc.pre(week !== undefined)
        const today = Math.floor(p / calendar.dayMs)
        fc.pre(Math.abs((today + 400) * calendar.dayMs) <= MAX_TIME && inRange(calendar, p))
        let last: number | null = null
        for (let day = today; day < today + 40; day++) {
          const d = dateAt(calendar, day * calendar.dayMs)
          const skipped = Boolean(week!.skipsIntercalary && calendar.definition.parts[d.part]!.intercalary)
          if (skipped) {
            expect(d.weekday).toBeNull()
            continue
          }
          expect(d.weekday).not.toBeNull()
          if (last !== null) expect(d.weekday).toBe((last + 1) % week!.days.length)
          last = d.weekday
        }
      }),
      arb.runs(1000)
    )
  })

  it('never writes a year as 0 or with a minus sign (Req 7)', () => {
    fc.assert(
      fc.property(compiled, fc.integer({ min: -100000, max: 100000 }), (calendar, year) => {
        const text = formatWorldYearOf(calendar.definition, year)
        expect(text).not.toMatch(/(^|\s)0(\s|$)|-\d/)
      }),
      arb.runs(2000)
    )
  })

  it('reads back every date it writes, at every precision, with its time (Req 14)', () => {
    fc.assert(
      fc.property(compiled, position, fc.constantFrom('day', 'month', 'year') as fc.Arbitrary<'day' | 'month' | 'year'>, fc.boolean(), (calendar, p, precision, withTime) => {
        fc.pre(inRange(calendar, p))
        const d = dateAt(calendar, p)
        const timed = withTime && precision === 'day'
        const text = formatWorldFields(calendar, d, precision, timed)
        const parsed = parseWorldDate(calendar, text)
        expect(parsed.ok, `${text}: ${parsed.ok ? '' : parsed.error}`).toBe(true)
        if (!parsed.ok) return
        expect(parsed.precision).toBe(precision)
        const expected = {
          year: d.year,
          part: precision === 'year' ? 0 : d.part,
          day: precision === 'day' ? d.day : 1,
          hour: timed ? d.hour : 0,
          minute: timed ? d.minute : 0,
          second: timed && calendar.definition.notation?.time?.includes('{second}') ? d.second : 0,
        }
        expect(parsed.fields, text).toEqual(expected)
      }),
      arb.runs(3000)
    )
  })

  it('refuses a day its month does not have, saying so (Req 14)', () => {
    fc.assert(
      fc.property(compiled, fc.integer({ min: -3000, max: 3000 }), fc.nat(), (calendar, year, seed) => {
        const part = seed % calendar.definition.parts.length
        fc.pre(!calendar.definition.parts[part]!.intercalary)
        const length = partLengths(calendar, year)[part]!
        const text = formatWorldFields(calendar, { year, part, day: 1, hour: 0, minute: 0, second: 0 }).replace(/(\D|^)1(\D|$)/, `$1${length + 1}$2`)
        const parsed = parseWorldDate(calendar, text)
        if (parsed.ok) expect(parsed.fields.day).not.toBe(length + 1)
      }),
      arb.runs(1000)
    )
  })

  it('names periods that hold their dates and meet without gaps (Req 15)', () => {
    fc.assert(
      fc.property(compiled, position, fc.constantFrom('day', 'month', 'year') as fc.Arbitrary<'day' | 'month' | 'year'>, (calendar, p, precision) => {
        fc.pre(inRange(calendar, p))
        const period = worldPeriod(calendar, dateAt(calendar, p), precision)
        fc.pre(period !== null && period.end + 1n <= BigInt(MAX_TIME))
        expect(period!.start).toBeLessThanOrEqual(BigInt(p))
        expect(BigInt(p)).toBeLessThanOrEqual(period!.end)
        // The next period starts the millisecond after this one ends.
        const next = worldPeriod(calendar, dateAt(calendar, period!.end + 1n), precision)
        fc.pre(next !== null)
        expect(next!.start).toBe(period!.end + 1n)
      }),
      arb.runs(3000)
    )
  })

  it('formats a position as its date, with the time when it is not the start of a day', () => {
    fc.assert(
      fc.property(compiled, position, (calendar, p) => {
        fc.pre(inRange(calendar, p))
        const parsed = parseWorldDate(calendar, formatWorldPosition(calendar, p))
        expect(parsed.ok).toBe(true)
      }),
      arb.runs(1000)
    )
  })
})

describe('a set the rules accept (Req 3, 14)', () => {
  it('reads every date back, in every one of its calendars, from the text alone', () => {
    fc.assert(
      fc.property(warb.calendarSet, fc.integer({ min: -1e13, max: 1e13 }), fc.constantFrom('day', 'month', 'year') as fc.Arbitrary<'day' | 'month' | 'year'>, fc.boolean(), (set, position, precision, withTime) => {
        for (const definition of set.calendars) {
          const calendar = calendarIn(set, definition.id)
          const date = dateAt(calendar, position)
          const text = formatWorldFields(calendar, date, precision, withTime && precision === 'day')
          const read = parseWorldText(set, text)
          expect(read.ok, `${definition.name}: ${text}`).toBe(true)
          if (!read.ok) return
          expect(read.calendar).toBe(definition.id)
          expect(formatWorldFields(calendar, read.fields, precision, withTime && precision === 'day')).toBe(text)
        }
      }),
      arb.runs(3000)
    )
  })
})
