import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  type GraphCalendar,
  formatHistoricalDate,
  formatHistoricalDateAt,
  formatHistoricalTimestamp,
  formatWorldDate,
  formatWorldYearIn,
  isoDatePart,
  worldMonthName,
} from './index'
import * as arb from './test/arbitraries'

/** A calendar whose month names, if any, are letters alone, so a digit in the output is a number. */
const calendar: fc.Arbitrary<GraphCalendar> = fc.record(
  { epochYear: arb.epochYear, eraLabel: fc.constantFrom('AR', 'Reckoning', 'a.R.', 'ص'), monthNames: arb.letterMonthNames },
  { requiredKeys: ['epochYear'] }
)

/** Instants a person would date events at: the world years a calendar is made for. */
const instant = fc.oneof(
  arb.instant,
  fc.date({ min: new Date('-002000-01-01T00:00:00Z'), max: new Date('9999-12-31T23:59:59Z'), noInvalidDate: true })
)

const day = (date: Date) => new Date(Date.UTC(2000, 0, 1)).setUTCFullYear(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())

/**
 * What may stand beside a phrase set into a date: nothing, a space, or a
 * comma; or, before a month, a day written as an ordinal by its locale, as
 * de's "4. März" and uz's "1-yanvar" are ("4. Thaw", "1-Thaw").
 */
function delimited(text: string, phrase: string): boolean {
  let from = 0
  for (;;) {
    const at = text.indexOf(phrase, from)
    if (at < 0) return false
    const before = text.slice(0, at)
    const after = text.slice(at + phrase.length)
    if ((before === '' || /([\s,،]|\p{Nd}-)$/u.test(before)) && (after === '' || /^[\s,،.]/u.test(after))) return true
    from = at + 1
  }
}

describe('a date in a world calendar, in every locale and time zone', () => {
  it('holds the world year as one phrase, set off from the rest', () => {
    fc.assert(
      fc.property(instant, arb.locale, calendar, fc.constantFrom('day', 'month', 'year') as fc.Arbitrary<'day' | 'month' | 'year'>, (date, locale, world, precision) => {
        const text = formatHistoricalDateAt(date, precision, locale, world)
        const year = formatWorldYearIn(date, locale, world)
        expect(delimited(text, year), `${locale}: "${text}" around "${year}"`).toBe(true)
      }),
      arb.runs(3000)
    )
  })

  it("holds the world's month name, set off from the rest, in place of the locale's", () => {
    fc.assert(
      fc.property(instant, arb.locale, calendar, fc.constantFrom('day', 'month') as fc.Arbitrary<'day' | 'month'>, (date, locale, world, precision) => {
        fc.pre(world.monthNames !== undefined)
        const text = formatHistoricalDateAt(date, precision, locale, world)
        const month = worldMonthName(date.getUTCMonth(), world)!
        expect(delimited(text, month), `${locale}: "${text}" around "${month}"`).toBe(true)
      }),
      arb.runs(3000)
    )
  })

  it('never shows the stored year', () => {
    fc.assert(
      fc.property(instant, arb.locale, calendar, (date, locale, world) => {
        const stored = date.getUTCFullYear()
        // Only where the stored year could not also be another number in the date.
        fc.pre(world.epochYear > 1 && stored >= world.epochYear && stored >= 100)
        const digits = new Intl.NumberFormat(locale, {
          numberingSystem: new Intl.DateTimeFormat(locale).resolvedOptions().numberingSystem,
          useGrouping: false,
        })
        const text = formatHistoricalDate(date, locale, world)
        expect(text, locale).not.toContain(digits.format(stored))
      }),
      arb.runs(3000)
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
        fc.pre(day(a) !== day(b))
        expect(formatHistoricalDate(a, locale, world), `${a.toISOString()} ${b.toISOString()} ${locale}`).not.toBe(formatHistoricalDate(b, locale, world))
        if (a.getUTCFullYear() !== b.getUTCFullYear()) {
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
        expect(formatWorldDate(zoneless, world)).toBe(formatWorldDate(second, world))
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
      fc.property(instant, arb.locale, calendar, (date, locale, world) => {
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
      fc.property(instant, arb.locale, calendar, (date, locale, world) => {
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
