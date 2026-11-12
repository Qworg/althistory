import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  type DateBoundEdge,
  boundPrecision,
  calendarIn,
  dateAt,
  formatBoundAt,
  formatDateBound,
  formatHistoricalDateBound,
  formatWorldBound,
  formatWorldFields,
  parseHistoricalDate,
  readDateBound,
  readDateField,
  worldBound,
} from './index'
import * as arb from './test/arbitraries'
import * as warb from './test/worldArbitraries'

// ── An oracle that does not use Date ─────────────────────────────────────

const DAY = 86_400_000

/** Days from 1970-01-01 to a proleptic Gregorian date (astronomical year), by Hinnant's days_from_civil. */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year
  const era = Math.floor(y / 400)
  const yoe = y - era * 400
  const mp = (month + 9) % 12
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

function isLeap(year: number): boolean {
  const mod = (n: number, d: number) => ((n % d) + d) % d
  return (mod(year, 4) === 0 && mod(year, 100) !== 0) || mod(year, 400) === 0
}

function daysInMonth(year: number, month: number): number {
  return [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!
}

const pad2 = (n: number) => String(n).padStart(2, '0')

// ── Bounds ───────────────────────────────────────────────────────────────

/** An astronomical year (1 BCE = 0), weighted towards the edges. */
const astronomicalYear = fc.oneof(
  fc.integer({ min: -275000, max: 280000 }),
  fc.integer({ min: -110, max: 110 }),
  fc.integer({ min: 275755, max: 275765 }),
  fc.integer({ min: -271825, max: -271815 }),
  fc.constantFrom(1900, 2000, 2100, 1600, -100, -400, -4)
)

/** A bound as a person types it: the year in any of its spellings, month and day optional, padded or not. */
const typedBound = fc
  .record({
    year: astronomicalYear,
    month: fc.option(fc.integer({ min: 0, max: 13 }), { nil: undefined }),
    day: fc.option(fc.integer({ min: 0, max: 32 }), { nil: undefined }),
    pad: fc.boolean(),
    era: fc.constantFrom('', 'word', 'word-lower', 'minus'),
  })
  .filter(({ year }) => (year >= 1 ? year : 1 - year) <= 999999)
  .map((bound) => {
    const { year, pad, era } = bound
    const month = bound.month
    const day = month === undefined ? undefined : bound.day
    const shown = year >= 1 ? year : 1 - year
    const unit = (n: number) => (pad ? pad2(n) : String(n))
    const body = `${shown}${month !== undefined ? `-${unit(month)}` : ''}${day !== undefined ? `-${unit(day)}` : ''}`
    let text: string
    if (year >= 1) text = era === 'word' ? `${body} CE` : era === 'word-lower' ? `${body} ad` : body
    else text = era === 'minus' ? `-${body}` : era === 'word-lower' ? `${body} bc` : `${body} BCE`
    return { text, year, month, day }
  })

const edge = fc.constantFrom<DateBoundEdge>('start', 'end')

describe('a typed bound, for every year, month and day', () => {
  it('names the right period, or says exactly why it cannot', () => {
    fc.assert(
      fc.property(typedBound, edge, ({ text, year, month, day }, side) => {
        const parsed = parseHistoricalDate(text, side)
        if (month !== undefined && (month < 1 || month > 12)) {
          expect(parsed).toEqual({ ok: false, error: 'The month must be 01 to 12.' })
          return
        }
        if (month !== undefined && day !== undefined && (day < 1 || day > daysInMonth(year, month))) {
          expect(parsed).toEqual({ ok: false, error: `That month has no day ${day}.` })
          return
        }
        const start = daysFromCivil(year, month ?? 1, day ?? 1) * DAY
        const next =
          day !== undefined
            ? start + DAY
            : month !== undefined
              ? start + daysInMonth(year, month) * DAY
              : daysFromCivil(year + 1, 1, 1) * DAY
        const instant = side === 'start' ? start : next - 1
        if (Math.abs(instant) > arb.MAX_TIME) {
          expect(parsed, text).toEqual({ ok: false, error: 'That date is out of range.' })
          return
        }
        expect(parsed.ok, `${text}: ${JSON.stringify(parsed)}`).toBe(true)
        if (!parsed.ok) return
        expect(parsed.date.getTime(), text).toBe(instant)
        const shown = year >= 1 ? year : 1 - year
        const canonical = `${shown}${month !== undefined ? `-${pad2(month)}` : ''}${day !== undefined ? `-${pad2(day)}` : ''}${year <= 0 ? ' BCE' : ''}`
        expect(parsed.text).toBe(canonical)
        expect(boundPrecision(parsed.text)).toBe(day !== undefined ? 'day' : month !== undefined ? 'month' : 'year')
        // Typed, a bound keeps its precision; as an instant, it is the widest
        // period it starts (or ends): 1 January reads as the year.
        expect(formatHistoricalDateBound(text, side)).toBe(canonical)
        const firstDay = (month ?? 1) === 1 && (day ?? 1) === 1
        const firstOfMonth = (day ?? 1) === 1
        const lastDay = (month ?? 12) === 12 && (day ?? 31) === 31
        const lastOfMonth = day === undefined || (month !== undefined && day === daysInMonth(year, month))
        const spelled = `${shown}`
        const era = year <= 0 ? ' BCE' : ''
        const widest =
          side === 'start'
            ? firstDay
              ? `${spelled}${era}`
              : firstOfMonth
                ? `${spelled}-${pad2(month!)}${era}`
                : canonical
            : lastDay
              ? `${spelled}${era}`
              : lastOfMonth
                ? `${spelled}-${pad2(month!)}${era}`
                : canonical
        expect(formatHistoricalDateBound(parsed.date, side)).toBe(widest)
      }),
      arb.runs(5000)
    )
  })

  it('never throws on any text', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 30 }), edge, (text, side) => {
        const parsed = parseHistoricalDate(text, side)
        if (parsed.ok) expect(Number.isNaN(parsed.date.getTime())).toBe(false)
      }),
      arb.runs(3000)
    )
  })

  it('has no year 0: the end of 1 BCE is the moment before the start of 1 CE', () => {
    const end = parseHistoricalDate('1 BCE', 'end')
    const start = parseHistoricalDate('1', 'start')
    expect(end.ok && start.ok && start.date.getTime() - end.date.getTime()).toBe(1)
    expect(parseHistoricalDate('0', 'start').ok).toBe(false)
    expect(parseHistoricalDate('-0', 'start').ok).toBe(false)
  })
})

describe('an instant as a bound', () => {
  // Away from the ends of the range, where the period a bound names can run past what a Date holds.
  const inner = fc.date({ min: new Date(-arb.MAX_TIME + 400 * 366 * DAY), max: new Date(arb.MAX_TIME - 400 * 366 * DAY), noInvalidDate: true })

  it('names a period that holds the instant', () => {
    fc.assert(
      fc.property(fc.oneof(inner, arb.instant.filter((d) => Math.abs(d.getTime()) < arb.MAX_TIME - 400 * 366 * DAY)), edge, (date, side) => {
        const text = formatHistoricalDateBound(date, side)
        const start = parseHistoricalDate(text, 'start')
        const end = parseHistoricalDate(text, 'end')
        expect(start.ok && end.ok, text).toBe(true)
        if (!start.ok || !end.ok) return
        expect(start.date.getTime()).toBeLessThanOrEqual(date.getTime())
        expect(date.getTime()).toBeLessThanOrEqual(end.date.getTime())
      }),
      arb.runs(3000)
    )
  })
})

describe('an instant as a bound at a stated precision', () => {
  it('reads back as the period it names, starting at the instant', () => {
    fc.assert(
      fc.property(arb.instant.filter((d) => Math.abs(d.getTime()) < arb.MAX_TIME - 400 * 366 * DAY), fc.constantFrom('day', 'month', 'year') as fc.Arbitrary<'day' | 'month' | 'year'>, (date, precision) => {
        const text = formatBoundAt(date, precision)
        const parsed = parseHistoricalDate(text, 'start')
        expect(parsed.ok, text).toBe(true)
        if (!parsed.ok) return
        expect(boundPrecision(parsed.text)).toBe(precision)
        expect(parsed.date.getTime()).toBeLessThanOrEqual(date.getTime())
      })
    )
    // The 1st of a month at day precision stays a day.
    expect(formatBoundAt(new Date('1871-03-01T00:00:00Z'), 'day')).toBe('1871-03-01')
    expect(formatBoundAt(new Date('-000043-03-15T00:00:00Z'), 'month')).toBe('44-03 BCE')
  })
})

describe('a bound for a graph', () => {
  it('without a world, is the stored bound', () => {
    fc.assert(
      fc.property(typedBound, edge, ({ text }, side) => {
        expect(readDateBound(text, side, null)).toEqual(parseHistoricalDate(text, side))
        expect(formatDateBound(text, side, null)).toBe(formatHistoricalDateBound(text, side))
      })
    )
  })

  it('in a world, is written in its notation and reads back as itself, on the right side of the instant', () => {
    fc.assert(
      fc.property(warb.calendarSet, fc.integer({ min: -1e13, max: 1e13 }), edge, (set, position, side) => {
        const text = formatDateBound(new Date(position), side, set)
        const read = readDateBound(text, side, set)
        expect(read.ok, text).toBe(true)
        if (!read.ok) return
        // Canonical: the spelling it reads as is the one it was written as.
        expect(read.text).toBe(text)
        expect(formatDateBound(text, side, set)).toBe(text)
        // A start covers the instant from its period's first moment, an end to its last.
        if (side === 'start') expect(read.date.getTime()).toBeLessThanOrEqual(position)
        else expect(read.date.getTime()).toBeGreaterThanOrEqual(position)
        // The bound's own instant is written (perhaps wider: the last day of
        // a year ends it) as text that reads back as exactly that instant.
        const again = readDateBound(formatWorldBound(set, read.date.getTime(), side), side, set)
        expect(again.ok && again.date.getTime()).toBe(read.date.getTime())
      }),
      arb.runs(2000)
    )
  })

  it("in a world, reads a link's instant as itself, and refuses year-first text", () => {
    fc.assert(
      fc.property(warb.calendarSet, typedBound, edge, fc.integer({ min: -1e13, max: 1e13 }), (set, { text }, side, position) => {
        // A link carries the instant (an ISO date and time).
        const iso = new Date(position).toISOString()
        const read = readDateBound(iso, side, set)
        expect(read.ok && read.date.getTime()).toBe(position)
        // "312" or "1843-11" names no date of the world's.
        fc.pre(!worldBound(set, text, side).ok)
        expect(readDateBound(text, side, set).ok).toBe(false)
      })
    )
  })

  it('in a world, refuses a time of day: a bound names a period', () => {
    fc.assert(
      fc.property(warb.calendarSet, fc.integer({ min: -1e13, max: 1e13 }), edge, (set, position, side) => {
        const calendar = calendarIn(set)
        const date = dateAt(calendar, position)
        fc.pre(date.hour !== 0 || date.minute !== 0)
        const text = formatWorldFields(calendar, date, 'day', true)
        fc.pre(!parseHistoricalDate(text, side).ok)
        expect(readDateBound(text, side, set).ok).toBe(false)
      })
    )
  })
})

// ── Date fields ──────────────────────────────────────────────────────────

describe("a date field's value, in every time zone", () => {
  it('is the UTC instant it spells, at whatever precision the field holds', () => {
    fc.assert(
      fc.property(arb.fieldInstant, (date) => {
        const iso = date.toISOString()
        const floor = (unit: number) => Math.floor(date.getTime() / unit) * unit
        expect(readDateField(iso.slice(0, 10))).toEqual({ date: new Date(floor(DAY)), dateOnly: true })
        expect(readDateField(iso.slice(0, 16))).toEqual({ date: new Date(floor(60_000)), dateOnly: false })
        expect(readDateField(iso.slice(0, 19))).toEqual({ date: new Date(floor(1000)), dateOnly: false })
        expect(readDateField(iso)).toEqual({ date, dateOnly: false })
        expect(readDateField(iso.replace('Z', '+00:00'))).toEqual({ date, dateOnly: false })
      }),
      arb.runs(2000)
    )
  })

  it('reads a date that does not exist as nothing, not as the next month', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 9999 }), fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 4 }), (year, month, over) => {
        const day = daysInMonth(year, month) + over
        fc.pre(day <= 99)
        const value = `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`
        expect(readDateField(value), value).toBeNull()
        expect(readDateField(`${value}T00:00`), value).toBeNull()
      })
    )
    for (const value of ['2019-01-01T24:00', '2019-01-01T23:60', '2019-01-01T12:00:60', '2019-00-10', '2019-13-01']) {
      expect(readDateField(value), value).toBeNull()
    }
  })

  it('never throws, and reads back only the day it was given', () => {
    const fieldLike = fc.oneof(
      fc.string({ unit: 'binary', maxLength: 30 }),
      fc
        .tuple(fc.integer({ min: 0, max: 99999 }), fc.integer({ min: 0, max: 99 }), fc.integer({ min: 0, max: 99 }))
        .map(([y, m, d]) => `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}`)
    )
    fc.assert(
      fc.property(fieldLike, (value) => {
        const field = readDateField(value)
        if (!field || !field.dateOnly) return
        const [y, m, d] = value.split('-').map(Number)
        expect(field.date.getTime()).toBe(daysFromCivil(y!, m!, d!) * DAY)
      }),
      arb.runs(3000)
    )
  })
})
