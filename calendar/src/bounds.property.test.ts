import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  type DateBoundEdge,
  axisOf,
  boundPrecision,
  calendarIn,
  civilOfAxisTime,
  dateAt,
  formatBoundAt,
  formatDateBound,
  formatHistoricalDateBound,
  formatWorldBound,
  formatWorldFields,
  instantOfAxisTime,
  isSignedShortYear,
  parseHistoricalDate,
  parseIsoInstant,
  readDateBound,
  readDateEntry,
  readDateField,
  readHistoricalText,
  readTimestamp,
  readWorldTimestamp,
  toInstant,
  unreadDateReason,
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
    era: fc.constantFrom('', 'word', 'word-lower'),
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
    // A minus sign is refused (tested below), unless before six digits, as ISO 8601's astronomical year.
    else text = era === 'word-lower' ? `${body} bc` : `${body} BCE`
    return { text, year, month, day }
  })

const edge = fc.constantFrom<DateBoundEdge>('start', 'end')

describe("a bound in ISO 8601's own spelling of a year outside 1-9999", () => {
  it('counts astronomically, as toISOString writes it and every other reader reads it', () => {
    fc.assert(
      fc.property(arb.instant, edge, (date, side) => {
        const iso = date.toISOString()
        const yearPart = iso.slice(0, iso.indexOf('-', 1))
        fc.pre(yearPart.length === 7 || yearPart === '0000')
        // The last day a date holds has no end inside the range (refused as out of range).
        fc.pre(!(side === 'end' && date.getTime() > arb.MAX_TIME - 86_400_000))
        const read = parseHistoricalDate(iso.slice(0, iso.indexOf('T')), side)
        expect(read.ok, iso).toBe(true)
        const day = (text: string) => text.slice(0, text.indexOf('T'))
        if (read.ok && side === 'start') expect(day(read.date.toISOString())).toBe(day(iso))
      }),
      arb.runs(500)
    )
    const bce = parseHistoricalDate('-000043-03-15', 'start')
    expect(bce.ok && bce.text).toBe('44-03-15 BCE')
    const zero = parseHistoricalDate('0000', 'start')
    expect(zero.ok && zero.text).toBe('1 BCE')
  })
})

describe('a minus sign before a year of fewer than six digits', () => {
  // "-0043" counted back is 43 BCE; as ISO 8601 counts (0 is 1 BCE) it is 44
  // BCE, the year "-000043" names. A person cannot tell which was meant.
  const signed = fc
    .record({
      year: fc.oneof(fc.integer({ min: 1, max: 99999 }), fc.integer({ min: 1, max: 110 })),
      width: fc.integer({ min: 1, max: 5 }),
      month: fc.option(fc.integer({ min: 1, max: 12 }), { nil: undefined }),
      day: fc.option(fc.integer({ min: 1, max: 28 }), { nil: undefined }),
      time: fc.boolean(),
    })
    .map(({ year, width, month, day, time }) => {
      const rest = `${month !== undefined ? `-${pad2(month)}` : ''}${month !== undefined && day !== undefined ? `-${pad2(day)}` : ''}`
      const text = `-${String(year).padStart(width, '0')}${rest}${time && month !== undefined && day !== undefined ? ' 09:30' : ''}`
      return { text, year, rest }
    })

  it('is refused by every door that reads year-first text, naming both years and both unambiguous spellings', () => {
    fc.assert(
      fc.property(signed, edge, ({ text, year, rest }, side) => {
        const historical = readHistoricalText(text, side)
        expect(historical.ok, text).toBe(false)
        if (historical.ok) return
        expect(historical.error).toContain(`${year} BCE`)
        expect(historical.error).toContain(`${year + 1} BCE`)
        expect(historical.error).toContain(`"-${String(year).padStart(6, '0')}${rest}"`)
        // And the six-digit spelling it offers is the astronomical year: year + 1 BCE.
        const iso = parseHistoricalDate(`-${String(year).padStart(6, '0')}${rest}`, 'start')
        expect(iso.ok && iso.text, text).toBe(`${year + 1}${rest} BCE`)
        if (!text.includes(' ')) {
          expect(parseHistoricalDate(text, side).ok, text).toBe(false)
          expect(readDateBound(text, side, null).ok, text).toBe(false)
          expect(formatHistoricalDateBound(text, side), text).toBe('')
        }
        expect(readDateEntry(text, null, side).ok, text).toBe(false)
        expect(readWorldTimestamp(null, text, side), text).toBeNull()
        expect(readTimestamp(text), text).toBeNull()
        expect(readDateField(text), text).toBeNull()
        expect(unreadDateReason(null, text)).toContain(`${year + 1} BCE`)
        expect(isSignedShortYear(` ${text}`), text).toBe(true)
      }),
      arb.runs(2000)
    )
  })

  it('is told apart from the six-digit year, a year with its era, and a year without a sign', () => {
    for (const text of ['-000043', '-000043-03-15', '44 BCE', '1843', '+010000', '']) expect(isSignedShortYear(text), text).toBe(false)
  })

  it('leaves the stored-text reader as it was (toInstant does not read year-first text)', () => {
    // ISO 8601's six-digit year, exactly; a signed four-digit date starts like
    // ISO and is no date, as before; other text as JavaScript always read it.
    expect(toInstant('-000043-03-15').toISOString()).toBe('-000043-03-15T00:00:00.000Z')
    expect(Number.isNaN(toInstant('-0043-03-15').getTime())).toBe(true)
    expect(toInstant('-44').getTime()).toBe(new Date('-44').getTime())
  })

  it('says so for the examples people type', () => {
    expect(parseHistoricalDate('-0043', 'start')).toEqual({
      ok: false,
      error: 'A minus sign there could mean 43 BCE, or 44 BCE as ISO 8601 counts years (0 is 1 BCE). Write "43 BCE" or "44 BCE", or ISO 8601\'s six-digit "-000043" (44 BCE).',
    })
    expect(readDateEntry('-44-03-15', null)).toMatchObject({ ok: false, error: expect.stringContaining('"44-03-15 BCE" or "45-03-15 BCE"') })
    expect(parseHistoricalDate('-0', 'start')).toEqual({ ok: false, error: 'There is no year 0: 1 BCE is followed by 1 CE.' })
    expect(parseHistoricalDate('-44 BCE', 'start')).toEqual({ ok: false, error: 'Use a minus sign or an era, not both.' })
    expect(readDateEntry('-000043', null)).toMatchObject({ ok: true, iso: '-000043-01-01T00:00:00.000Z', precision: 'year' })
  })
})

describe('a date with a time of day, to the second or the millisecond', () => {
  const pad = (value: number, width = 2) => String(value).padStart(width, '0')
  it('reads back as the moment it names, at any magnitude', () => {
    fc.assert(
      fc.property(arb.axisTime, fc.constantFrom('minute', 'second', 'millisecond'), (time, precision) => {
        const civil = civilOfAxisTime(time)
        const unit = precision === 'minute' ? 60_000n : precision === 'second' ? 1000n : 1n
        const at = time - (((time % unit) + unit) % unit)
        const day = formatBoundAt(instantOfAxisTime(at)!, 'day')
        const clock = `${pad(civil.hour)}:${pad(civil.minute)}${precision === 'minute' ? '' : `:${pad(civil.second)}`}${precision === 'millisecond' ? `.${pad(civil.millisecond, 3)}` : ''}`
        const text = `${day} ${clock}`
        const read = readHistoricalText(text, 'start')
        expect(read.ok && read.time, text).toBe(at)
        expect(read.ok && read.precision, text).toBe('day')
      }),
      arb.runs(2000)
    )
  })

  it('refuses a second or a millisecond out of range, and a fraction too fine', () => {
    for (const text of ['1843-11-20 14:30:60', '1843-11-20 14:30:5', '1843-11-20 14:30:05.1234', '1843-11-20 14:30.5']) {
      expect(readHistoricalText(text, 'start').ok, text).toBe(false)
    }
    expect(readHistoricalText('1843-11-20 14:30:05.5', 'start')).toMatchObject({ ok: true, iso: '1843-11-20T14:30:05.500Z' })
    expect(readHistoricalText('44-03-15 BCE 11:59:50', 'start')).toMatchObject({ ok: true, iso: '-000043-03-15T11:59:50.000Z' })
  })
})

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
        const start = BigInt(daysFromCivil(year, month ?? 1, day ?? 1)) * BigInt(DAY)
        const next =
          day !== undefined
            ? start + BigInt(DAY)
            : month !== undefined
              ? start + BigInt(daysInMonth(year, month) * DAY)
              : BigInt(daysFromCivil(year + 1, 1, 1)) * BigInt(DAY)
        const instant = side === 'start' ? start : next - 1n
        expect(parsed.ok, `${text}: ${String(parsed.ok ? '' : parsed.error)}`).toBe(true)
        if (!parsed.ok) return
        // Exactly, however far from 1970: a Date's range is no limit.
        expect(parsed.time, text).toBe(instant)
        expect(axisOf(parsed.date), text).toBe(instant)
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
        // "312", "44 BCE" or an ISO month name no date of the world's (an ISO date or date and time is a day, as at every door).
        fc.pre(!worldBound(set, text, side).ok)
        const asIso = parseIsoInstant(text)
        fc.pre(!asIso || asIso.precision === 'month' || asIso.precision === 'year')
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
