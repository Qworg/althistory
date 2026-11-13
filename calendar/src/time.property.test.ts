import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  AxisDate,
  MAX_AXIS_MS,
  MIN_AXIS_MS,
  addMs,
  axisOf,
  axisTimeOf,
  axisTimeOfIso,
  civilOfAxisTime,
  compareAxisTime,
  dateOfAxisTime,
  formatHistoricalDate,
  formatHistoricalTimestamp,
  instantOfAxisTime,
  isoOfAxisTime,
  parseIsoInstant,
  readTimestamp,
  toAxisTime,
  toInstant,
} from './index'
import * as arb from './test/arbitraries'

describe('the axis time (docs/specs/deep-time.md, Req 1-6)', () => {
  it('writes the text a Date writes, for every instant a Date holds (Req 2)', () => {
    fc.assert(
      fc.property(arb.instant, (date) => {
        expect(isoOfAxisTime(BigInt(date.getTime()))).toBe(date.toISOString())
        expect(axisTimeOf(date)).toBe(BigInt(date.getTime()))
      }),
      arb.runs(3000)
    )
  })

  it('reads back the text it writes, over the whole range, beyond a Date and before it (Req 2)', () => {
    fc.assert(
      fc.property(arb.axisTime, (time) => {
        const iso = isoOfAxisTime(time)
        expect(axisTimeOfIso(iso), iso).toBe(time)
        // Every reader of stored text reads it alike.
        expect(toAxisTime(iso), iso).toBe(time)
        expect(axisOf(toInstant(iso)), iso).toBe(time)
        expect(readTimestamp(iso)).toEqual({ iso, time, precision: 'day' })
        // A year outside 0000-9999 is expanded, signed, and at least six digits.
        const year = /^([+-]\d{6,9}|\d{4})-/.exec(iso)
        expect(year, iso).not.toBeNull()
        const written = civilOfAxisTime(time).year
        expect(/^\d{4}-/.test(iso)).toBe(written >= 0 && written <= 9999)
      }),
      arb.runs(4000)
    )
  })

  it('orders as the numbers do (Req 3)', () => {
    fc.assert(
      fc.property(arb.axisTime, arb.axisTime, (a, b) => {
        expect(compareAxisTime(a, b)).toBe(a < b ? -1 : a > b ? 1 : 0)
        // Text sorts as time does within a sign and a width; the axis time is the order.
        expect(compareAxisTime(toAxisTime(isoOfAxisTime(a))!, toAxisTime(isoOfAxisTime(b))!)).toBe(compareAxisTime(a, b))
      }),
      arb.runs(2000)
    )
  })

  it('reads every stored text as it was read before, in every range a Date holds (Req 4)', () => {
    fc.assert(
      fc.property(arb.instant, fc.constantFrom('iso', 'date', 'year', 'month', 'space', 'offset', 'ms'), (date, shape) => {
        const iso = date.toISOString()
        const text =
          shape === 'iso'
            ? iso
            : shape === 'date'
              ? iso.slice(0, 10)
              : shape === 'year'
                ? iso.slice(0, iso.startsWith('-') || iso.startsWith('+') ? 7 : 4)
                : shape === 'month'
                  ? iso.slice(0, iso.startsWith('-') || iso.startsWith('+') ? 10 : 7)
                  : shape === 'space'
                    ? iso.replace('T', ' ')
                    : shape === 'offset'
                      ? iso.replace('Z', '+00:00')
                      : String(date.getTime())
        const old = toInstant(shape === 'ms' ? date.getTime() : text)
        const read = toAxisTime(shape === 'ms' ? date.getTime() : text)
        expect(read === null ? NaN : Number(read), text).toBe(old.getTime())
        expect(toAxisTime(old)).toBe(Number.isNaN(old.getTime()) ? null : BigInt(old.getTime()))
      }),
      arb.runs(3000)
    )
    for (const text of ['not a date', '', '2019-02-31', '2019-1-5T25:00']) {
      expect(toAxisTime(text), text).toBeNull()
    }
  })

  it('adds and compares exactly where a double cannot (Req 3)', () => {
    fc.assert(
      fc.property(arb.axisTime, fc.integer({ min: -1_000_000, max: 1_000_000 }), (time, ms) => {
        const sum = addMs(time, ms)
        if (sum === null) return
        expect(sum - time).toBe(BigInt(ms))
        expect(compareAxisTime(sum, time)).toBe(ms === 0 ? 0 : ms > 0 ? 1 : -1)
      }),
      arb.runs(2000)
    )
    expect(addMs(MAX_AXIS_MS, 1)).toBeNull()
    expect(addMs(MIN_AXIS_MS, -1)).toBeNull()
  })

  it('refuses only what is past the bound (Req 5)', () => {
    expect(axisTimeOf(MAX_AXIS_MS)).toBe(MAX_AXIS_MS)
    expect(axisTimeOf(MAX_AXIS_MS + 1n)).toBeNull()
    expect(axisTimeOf(MIN_AXIS_MS - 1n)).toBeNull()
    expect(instantOfAxisTime(MAX_AXIS_MS + 1n)).toBeNull()
    expect(parseIsoInstant('+285200617-01-01')).toBeNull()
    expect(parseIsoInstant('+285200615-01-01')).not.toBeNull()
    expect(parseIsoInstant('+1000000000-01-01')).toBeNull()
    expect(axisTimeOfIso(isoOfAxisTime(MAX_AXIS_MS))).toBe(MAX_AXIS_MS)
    expect(axisTimeOfIso(isoOfAxisTime(MIN_AXIS_MS))).toBe(MIN_AXIS_MS)
  })

  it('keeps the years 0-99 where they are, never reading them as 19xx (Req 6)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 99 }), fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 28 }), (year, month, day) => {
        const text = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
        const time = toAxisTime(text)!
        expect(civilOfAxisTime(time)).toMatchObject({ year, month, day })
        expect(isoOfAxisTime(time).startsWith(`${String(year).padStart(4, '0')}-`)).toBe(true)
        expect(toInstant(text).getUTCFullYear()).toBe(year)
      }),
      arb.runs(500)
    )
  })
})

describe('a Date for an instant beyond a Date (Req 7)', () => {
  it('is a plain Date within a Date\'s range and an AxisDate beyond it, exact either way', () => {
    fc.assert(
      fc.property(arb.axisTime, (time) => {
        const date = instantOfAxisTime(time)!
        expect(date instanceof AxisDate).toBe(dateOfAxisTime(time) === null)
        expect(date instanceof Date).toBe(true)
        expect(axisOf(date)).toBe(time)
        expect(date.toISOString()).toBe(isoOfAxisTime(time))
        expect(JSON.stringify(date)).toBe(JSON.stringify(isoOfAxisTime(time)))
        expect(Number.isNaN(date.getTime())).toBe(false)
        const civil = civilOfAxisTime(time)
        expect([date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()]).toEqual([
          civil.year,
          civil.month,
          civil.day,
          civil.hour,
          civil.minute,
          civil.second,
          civil.millisecond,
        ])
        // The nearest double, which orders loosely but never the wrong way round.
        expect(date.getTime()).toBe(Number(time))
      }),
      arb.runs(2000)
    )
  })

  it('has the weekday a Date has, wherever a Date has one', () => {
    fc.assert(
      fc.property(arb.instant, (date) => {
        expect(civilOfAxisTime(BigInt(date.getTime())).weekday).toBe(date.getUTCDay())
      }),
      arb.runs(1000)
    )
  })
})

describe('showing an instant beyond a Date, without a world (Req 12)', () => {
  it('is identical to Intl for every instant a Date holds, and has the true year beyond it', () => {
    fc.assert(
      fc.property(arb.deepAxisTime, arb.locale, (time, locale) => {
        const date = instantOfAxisTime(time)!
        const text = formatHistoricalDate(date, locale, null)
        const { year } = civilOfAxisTime(time)
        const digits = new Intl.NumberFormat(locale, { useGrouping: false }).format(year >= 1 ? year : 1 - year)
        expect(text, `${time} ${locale}`).toContain(digits)
        expect(text).not.toBe('Invalid Date')
        const stamp = formatHistoricalTimestamp(date, locale, null)
        expect(stamp).toContain(digits)
      }),
      arb.runs(300)
    )
    expect(formatHistoricalDate(toInstant('+300000-03-15'), 'en-US', null)).toBe('Mar 15, 300000')
    expect(formatHistoricalDate(toInstant('-300000-03-15'), 'en-US', null)).toBe('Mar 15, 300001 BC')
    expect(formatHistoricalTimestamp(toInstant('+300000-03-15T14:30:00Z'), 'en-US', null)).toBe('Mar 15, 300000, 14:30 UTC')
  })
})
