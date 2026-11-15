import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  type WorldCalendarSet,
  calendarIn,
  dateAt,
  formatHistoricalDate,
  formatHistoricalDateAt,
  formatHistoricalTimestamp,
  formatWorldDate,
  formatWorldFields,
  formatWorldPosition,
  isoDatePart,
  legacyCalendarSet,
} from './index'
import * as arb from './test/arbitraries'
import * as warb from './test/worldArbitraries'

/** Calendars of the simple form (Gregorian, renamed), as the sets they are stored as. */
const simpleCalendar: fc.Arbitrary<WorldCalendarSet> = arb.calendar.map(legacyCalendarSet)
/** Any world calendar: of any shape, or of the simple form. */
const calendar: fc.Arbitrary<WorldCalendarSet> = fc.oneof(warb.calendarSet, simpleCalendar)

/** Instants a person would date events at. */
const instant = fc.oneof(
  arb.instant,
  fc.date({ min: new Date('-002000-01-01T00:00:00Z'), max: new Date('9999-12-31T23:59:59Z'), noInvalidDate: true })
)

const day = (date: Date) => new Date(Date.UTC(2000, 0, 1)).setUTCFullYear(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())

describe('a date in a world calendar, in every locale and time zone', () => {
  it("is written in the world's own notation, whatever the locale (Req 10, 18)", () => {
    fc.assert(
      fc.property(instant, arb.locale, calendar, (date, locale, world) => {
        const primary = calendarIn(world)
        const fields = dateAt(primary, date.getTime())
        expect(formatHistoricalDate(date, locale, world)).toBe(formatWorldFields(primary, fields, 'day'))
        expect(formatHistoricalDateAt(date, 'month', locale, world)).toBe(formatWorldFields(primary, fields, 'month'))
        expect(formatHistoricalDateAt(date, 'year', locale, world)).toBe(formatWorldFields(primary, fields, 'year'))
        expect(formatHistoricalTimestamp(date, locale, world)).toBe(formatWorldPosition(primary, date.getTime()))
      }),
      arb.runs(2000)
    )
  })

  it('gives two different days two different dates, and two different years two different years', () => {
    // Pairs a formatter could confuse: the same date with one field moved a
    // little (the next day, the month before, a year or a century on, the
    // other side of the era), not two dates drawn thousands of years apart.
    const nearby = fc
      .tuple(
        instant,
        fc.constantFrom<[string, number]>(
          ['day', 1], ['day', -1], ['day', 2], ['month', 1], ['month', -1],
          ['year', 1], ['year', -1], ['year', 10], ['year', 100], ['year', -1000], ['era', 0]
        )
      )
      .map(([a, [field, by]]) => {
        const b = new Date(a)
        if (field === 'day') b.setUTCDate(b.getUTCDate() + by)
        else if (field === 'month') b.setUTCMonth(b.getUTCMonth() + by)
        else if (field === 'year') b.setUTCFullYear(b.getUTCFullYear() + by)
        else b.setUTCFullYear(1 - b.getUTCFullYear())
        return [a, b] as const
      })
      .filter(([a, b]) => !Number.isNaN(b.getTime()) && day(a) !== day(b))
    fc.assert(
      fc.property(fc.oneof(nearby, fc.tuple(instant, instant)), arb.locale, fc.option(calendar, { nil: null }), ([a, b], locale, world) => {
        // Different days: in a world, its own days (which need not be Earth's).
        const dayMs = world ? calendarIn(world).dayMs : 0
        fc.pre(world ? Math.floor(a.getTime() / dayMs) !== Math.floor(b.getTime() / dayMs) : day(a) !== day(b))
        expect(formatHistoricalDate(a, locale, world), `${a.toISOString()} ${b.toISOString()} ${locale}`).not.toBe(formatHistoricalDate(b, locale, world))
        // Gregorian years apart are different years only without a world calendar.
        if (!world && a.getUTCFullYear() !== b.getUTCFullYear()) {
          expect(formatHistoricalDateAt(a, 'year', locale, world)).not.toBe(formatHistoricalDateAt(b, 'year', locale, world))
        }
      }),
      arb.runs(5000)
    )
  })

  it('names the same year at every precision', () => {
    fc.assert(
      fc.property(instant, arb.locale, fc.option(calendar, { nil: null }), (date, locale, world) => {
        const year = formatHistoricalDateAt(date, 'year', locale, world)
        // A world year is one phrase everywhere. A plain year's words can
        // differ by precision (lt writes "1843 m." alone but not in a date; hi
        // puts the era on the other side), so its number is what must match.
        const parts = world ? [year] : year.match(/\p{Nd}+/gu) ?? []
        expect(parts.length, `${locale}: ${year}`).toBeGreaterThan(0)
        for (const part of parts) {
          expect(formatHistoricalDate(date, locale, world), `${locale}: ${year}`).toContain(part)
          expect(formatHistoricalDateAt(date, 'month', locale, world), `${locale}: ${year}`).toContain(part)
        }
      }),
      arb.runs(3000)
    )
  })

  it('reads a timestamp without a zone as UTC, and other text as JavaScript always has', () => {
    fc.assert(
      fc.property(arb.fieldInstant, arb.locale, fc.option(calendar, { nil: null }), (date, locale, world) => {
        const zoneless = date.toISOString().slice(0, 19)
        const second = new Date(Math.floor(date.getTime() / 1000) * 1000)
        expect(formatHistoricalTimestamp(zoneless, locale, world)).toBe(formatHistoricalTimestamp(second, locale, world))
        // Stored data written before the app wrote only ISO: read as it always was.
        expect(formatHistoricalDate(second.toUTCString(), locale, world)).toBe(formatHistoricalDate(new Date(second.toUTCString()), locale, world))
        // An ISO-shaped date that does not exist is no date, never the day it rolls into.
        expect(formatHistoricalDate('2019-02-31', locale, world)).toBe('Invalid date')
      }),
      arb.runs(1000)
    )
  })

  it('tells a year before the common era from the same number after it, without a calendar', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 9999 }), arb.locale, (year, locale) => {
        const ce = new Date(Date.UTC(2000, 2, 15))
        ce.setUTCFullYear(year)
        const bce = new Date(ce)
        bce.setUTCFullYear(1 - year)
        expect(formatHistoricalDate(bce, locale, null), locale).not.toBe(formatHistoricalDate(ce, locale, null))
        expect(formatHistoricalDateAt(bce, 'year', locale, null), locale).not.toBe(formatHistoricalDateAt(ce, 'year', locale, null))
      })
    )
  })

  it('has no stray spaces', () => {
    fc.assert(
      fc.property(instant, arb.locale, calendar.filter((set) => !/\s\s/.test(JSON.stringify(set))), (date, locale, world) => {
        for (const text of [
          formatHistoricalTimestamp(date, locale, world),
          formatHistoricalDateAt(date, 'month', locale, world),
          formatHistoricalDateAt(date, 'year', locale, world),
        ]) {
          expect(text, locale).toBe(text.trim())
          expect(text, locale).not.toMatch(/\s\s/u)
        }
      }),
      arb.runs(2000)
    )
  })

  it('reads the same in every time zone: the UTC day, and the UTC time when it is not midnight', () => {
    fc.assert(
      // Without a calendar: a world's times are its own hours, with no "UTC" (see the first property).
      fc.property(instant, arb.locale, fc.constant(null), (date, locale, world) => {
        const midnight = new Date(day(date))
        expect(formatHistoricalTimestamp(midnight, locale, world)).toBe(formatHistoricalDate(date, locale, world))
        if (+date !== +midnight) {
          const time = date.toLocaleTimeString(locale, { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hour12: false })
          expect(formatHistoricalTimestamp(date, locale, world)).toBe(`${formatHistoricalDate(date, locale, world)}, ${time} UTC`)
        }
      })
    )
  })
})

describe('a date in plain English (exports, the CLI, a model)', () => {
  it('is the ISO date without a calendar, expanded years included', () => {
    fc.assert(
      fc.property(arb.instant, (date) => {
        const year = date.getUTCFullYear()
        const yyyy = year >= 0 && year <= 9999 ? String(year).padStart(4, '0') : `${year < 0 ? '-' : '+'}${String(Math.abs(year)).padStart(6, '0')}`
        const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
        const dd = String(date.getUTCDate()).padStart(2, '0')
        expect(formatWorldDate(date, null)).toBe(`${yyyy}-${mm}-${dd}`)
        expect(formatWorldDate(date, null, 'month')).toBe(`${yyyy}-${mm}`)
        expect(formatWorldDate(date, null, 'year')).toBe(yyyy)
        expect(isoDatePart(date)).toBe(`${yyyy}-${mm}-${dd}`)
        // And an ISO date reads back as the same day.
        expect(day(new Date(`${formatWorldDate(date, null)}T00:00:00Z`))).toBe(day(date))
      }),
      arb.runs(2000)
    )
  })

  it("is the world's month, the UTC day and the world year", () => {
    fc.assert(
      fc.property(arb.instant, arb.calendar, (date, world) => {
        const month = world.monthNames?.[date.getUTCMonth()] ?? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][date.getUTCMonth()]
        const year = formatWorldDate(date, world, 'year')
        expect(formatWorldDate(date, world)).toBe(`${month} ${date.getUTCDate()}, ${year}`)
        expect(formatWorldDate(date, world, 'month')).toBe(`${month} ${year}`)
        expect(formatWorldDate(date.toISOString(), world)).toBe(formatWorldDate(date, world))
      }),
      arb.runs(2000)
    )
  })
})
