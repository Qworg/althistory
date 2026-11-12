import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { type DateBoundEdge, type DatePrecision, calendarIn, dateAt, formatDateEntry, parseWorldText, readDateEntry } from './index'
import * as arb from './test/arbitraries'
import * as warb from './test/worldArbitraries'

const edge = fc.constantFrom<DateBoundEdge>('start', 'end')
const precision = fc.constantFrom<DatePrecision>('day', 'month', 'year')

/** What every typed date must do, with or without a world. */
function readsBackAsWritten(position: number, at: DatePrecision, side: DateBoundEdge, calendar: Parameters<typeof readDateEntry>[1]) {
  const text = formatDateEntry(new Date(position), at, calendar, side)
  const read = readDateEntry(text, calendar, side)
  expect(read.ok, text).toBe(true)
  if (!read.ok) return
  // At the precision it was written at, and canonical: the date it reads as is written the same way.
  expect(read.precision).toBe(at)
  expect(formatDateEntry(read.iso, read.precision, calendar, side)).toBe(text)
  const time = Date.parse(read.iso)
  if (side === 'start') {
    // A start covers the date from the first moment of what it names.
    expect(time).toBeLessThanOrEqual(position)
  } else if (at !== 'day') {
    // An end at a month or year covers it to the period's last moment.
    expect(time).toBeGreaterThanOrEqual(position)
  }
}

describe('a typed date without a world', () => {
  it('reads back as written, at its precision, on the right side of the instant', () => {
    fc.assert(
      fc.property(arb.instant, precision, edge, (date, at, side) => {
        // A month or year is written from its first day, which must be a date too.
        fc.pre(at === 'day' || Math.abs(date.getTime()) < arb.MAX_TIME - 4e10)
        readsBackAsWritten(date.getTime(), at, side, null)
      }),
      arb.runs(1500)
    )
  })

  it('reads an end at a day, month or year as its last moment', () => {
    expect(readDateEntry('1843', null, 'end')).toEqual({ ok: true, iso: '1843-12-31T23:59:59.999Z', precision: 'year' })
    expect(readDateEntry('1843-02', null, 'end')).toEqual({ ok: true, iso: '1843-02-28T23:59:59.999Z', precision: 'month' })
    expect(readDateEntry('1843-02-03 14:30', null, 'end')).toEqual({ ok: true, iso: '1843-02-03T14:30:00.000Z', precision: 'day' })
    expect(readDateEntry('44 BCE', null, 'start')).toEqual({ ok: true, iso: '-000043-01-01T00:00:00.000Z', precision: 'year' })
    expect(readDateEntry('1843-02-03 24:00', null).ok).toBe(false)
  })
})

describe('a typed date in a world', () => {
  it('reads back as written, at its precision, on the right side of the instant', () => {
    fc.assert(
      fc.property(warb.calendarSet, fc.integer({ min: -1e13, max: 1e13 }), precision, edge, (set, position, at, side) =>
        readsBackAsWritten(position, at, side, set)
      ),
      arb.runs(2000)
    )
  })

  it('reads an untimed date as the start of what it names, or as an end its last moment', () => {
    fc.assert(
      fc.property(warb.calendarSet, fc.integer({ min: -1e13, max: 1e13 }), precision, (set, position, at) => {
        const text = formatDateEntry(new Date(position), at, set, 'start')
        const start = readDateEntry(text, set, 'start')
        const end = readDateEntry(text, set, 'end')
        fc.pre(start.ok && end.ok)
        if (!start.ok || !end.ok) return
        const world = parseWorldText(set, text)
        if (world.ok && world.timed) expect(end.iso).toBe(start.iso)
        else {
          // The last moment: one more is a different day, month or year.
          const shown = calendarIn(set)
          const last = Date.parse(end.iso)
          expect(formatDateEntry(new Date(last), at, set, 'end')).toBe(text)
          expect(formatDateEntry(new Date(last + 1), at, set, 'start')).not.toBe(text)
          const next = dateAt(shown, last + 1)
          expect([next.hour, next.minute, next.second]).toEqual([0, 0, 0])
        }
      }),
      arb.runs(1000)
    )
  })

  it('reads an ISO 8601 timestamp as itself, and refuses what it cannot read, with the reason', () => {
    fc.assert(
      fc.property(warb.calendarSet, arb.instant, (set, date) => {
        const iso = date.toISOString()
        fc.pre(!parseWorldText(set, iso).ok)
        expect(readDateEntry(iso, set)).toEqual({ ok: true, iso, precision: 'day' })
        const refused = readDateEntry('not a date at all', set)
        expect(refused.ok).toBe(false)
        if (!refused.ok) expect(refused.error).toMatch(/^[A-Z"].*\.$/)
      }),
      arb.runs(300)
    )
  })
})

describe('an ISO date typed as an end', () => {
  it('is the last moment of its day, in a world as without one', () => {
    fc.assert(
      fc.property(warb.calendarSet, arb.fieldInstant, (set, date) => {
        const day = date.toISOString().slice(0, 10)
        fc.pre(!parseWorldText(set, day).ok)
        const end = `${day}T23:59:59.999Z`
        expect(readDateEntry(day, set, 'end')).toEqual({ ok: true, iso: end, precision: 'day' })
        expect(readDateEntry(day, null, 'end')).toEqual({ ok: true, iso: end, precision: 'day' })
        expect(readDateEntry(`${day}T06:00:00Z`, set, 'end')).toEqual({ ok: true, iso: `${day}T06:00:00.000Z`, precision: 'day' })
      }),
      arb.runs(300)
    )
    expect(readDateEntry('1843 14:30', null).ok).toBe(false)
  })
})
