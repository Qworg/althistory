import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { parseIsoInstant, readDateField, readTimestamp, toInstant } from './index'
import * as arb from './test/arbitraries'

// An oracle that does not use Date: Hinnant's days_from_civil, written out
// again here rather than imported, so a mistake in the package's copy shows.
const DAY = 86_400_000
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year
  const era = Math.floor(y / 400)
  const yoe = y - era * 400
  const doy = Math.floor((153 * ((month + 9) % 12) + 2) / 5) + day - 1
  return era * 146097 + yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy - 719468
}
function daysIn(year: number, month: number): number {
  return daysFromCivil(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1) - daysFromCivil(year, month, 1)
}
const pad = (n: number, width = 2) => String(n).padStart(width, '0')

describe('an ISO 8601 timestamp, in every time zone', () => {
  it('reads back every instant a Date holds, as toISOString writes it', () => {
    fc.assert(
      fc.property(arb.instant, (date) => {
        expect(parseIsoInstant(date.toISOString())).toEqual({ date, dateOnly: false, precision: 'time' })
        expect(toInstant(date.toISOString())).toEqual(date)
      }),
      arb.runs(3000)
    )
  })

  it('is the instant its fields name, in every spelling, or nothing when one of them does not exist', () => {
    const fields = fc.record({
      year: fc.oneof(fc.integer({ min: -280000, max: 280000 }), fc.integer({ min: -5, max: 2100 })),
      yearSpelling: fc.constantFrom('plain', 'expanded', 'minus-zero'),
      precision: fc.constantFrom('year', 'month', 'day', 'day', 'time', 'time', 'time'),
      month: fc.integer({ min: 0, max: 13 }),
      day: fc.integer({ min: 0, max: 32 }),
      hour: fc.integer({ min: 0, max: 25 }),
      minute: fc.integer({ min: 0, max: 61 }),
      second: fc.option(fc.integer({ min: 0, max: 61 }), { nil: undefined }),
      // One to nine digits after the point: ".5" is 500 ms, ".123456789" is 123.
      fraction: fc.option(fc.stringMatching(/^\d{1,9}$/), { nil: undefined }),
      fractionMark: fc.constantFrom('.', ','),
      separator: fc.constantFrom('T', 't', ' '),
      zone: fc.option(fc.integer({ min: -24 * 60 - 1, max: 24 * 60 + 1 }), { nil: undefined }),
      zoneSpelling: fc.constantFrom('Z', 'z', 'colon', 'basic', 'hours'),
    })
    fc.assert(
      fc.property(fields, (f) => {
        const { year, precision } = f
        let yearText: string
        if (f.yearSpelling === 'minus-zero' && year === 0) yearText = '-000000'
        else if (f.yearSpelling === 'expanded' || year < 0 || year > 999999) yearText = `${year < 0 ? '-' : '+'}${pad(Math.abs(year), 6)}`
        else yearText = pad(year, 4)

        let text = yearText
        let exists = yearText !== '-000000'
        const month = precision === 'year' ? 1 : f.month
        const day = precision === 'year' || precision === 'month' ? 1 : f.day
        if (precision !== 'year') text += `-${pad(f.month)}`
        if (precision === 'day' || precision === 'time') text += `-${pad(f.day)}`
        exists &&= month >= 1 && month <= 12 && day >= 1 && day <= daysIn(year, month)
        let ms = daysFromCivil(year, month, day) * DAY
        if (precision === 'time') {
          text += `${f.separator}${pad(f.hour)}:${pad(f.minute)}`
          exists &&= f.hour <= 23 && f.minute <= 59
          let offset = 0
          if (f.second !== undefined) {
            text += `:${pad(f.second)}`
            exists &&= f.second <= 59
            if (f.fraction !== undefined) text += `${f.fractionMark}${f.fraction}`
          }
          if (f.zone !== undefined) {
            const spelling = f.zone === 0 && (f.zoneSpelling === 'Z' || f.zoneSpelling === 'z') ? f.zoneSpelling : f.zoneSpelling === 'Z' || f.zoneSpelling === 'z' ? 'colon' : f.zoneSpelling
            const hours = Math.floor(Math.abs(f.zone) / 60)
            const minutes = Math.abs(f.zone) % 60
            const sign = f.zone < 0 ? '-' : '+'
            if (spelling === 'Z' || spelling === 'z') text += spelling
            else if (spelling === 'colon') text += `${sign}${pad(hours)}:${pad(minutes)}`
            else if (spelling === 'basic') text += `${sign}${pad(hours)}${pad(minutes)}`
            // "+05" alone when there are no minutes, "+0545" when there are.
            else text += `${sign}${pad(hours)}${minutes === 0 ? '' : pad(minutes)}`
            offset = f.zone
            exists &&= hours <= 23
          }
          const fractionMs = f.second !== undefined && f.fraction !== undefined ? Number(f.fraction.slice(0, 3).padEnd(3, '0')) : 0
          ms += ((f.hour * 60 + f.minute - offset) * 60 + (f.second ?? 0)) * 1000 + fractionMs
        }
        const parsed = parseIsoInstant(text)
        if (!exists || Math.abs(ms) > arb.MAX_TIME) {
          expect(parsed, text).toBeNull()
          // Never the day V8 rolls a day that does not exist into.
          const dayExists = month >= 1 && month <= 12 && day >= 1 && day <= daysIn(year, month)
          if (!dayExists && (precision === 'day' || precision === 'time')) expect(Number.isNaN(toInstant(text).getTime()), text).toBe(true)
        } else {
          expect(parsed, text).toEqual({ date: new Date(ms), dateOnly: precision !== 'time', precision })
          expect(toInstant(` ${text} `)).toEqual(new Date(ms))
        }
      }),
      arb.runs(8000)
    )
  })

  it('reads the forms people and models write: reduced precision, a space, a basic offset, lower case', () => {
    const cases: Array<[string, string | null]> = [
      ['1066', '1066-01-01T00:00:00.000Z'],
      ['1871-03', '1871-03-01T00:00:00.000Z'],
      ['1870-02-14 09:30', '1870-02-14T09:30:00.000Z'],
      ['1870-02-14T09:30:00+0545', '1870-02-14T03:45:00.000Z'],
      ['1870-02-14T09:30:00+05', '1870-02-14T04:30:00.000Z'],
      ['1843-11-20t00:00z', '1843-11-20T00:00:00.000Z'],
      ['1843-11-20T10:00:00.5Z', '1843-11-20T10:00:00.500Z'],
      ['1843-11-20T10:00:00,25Z', '1843-11-20T10:00:00.250Z'],
      ['+000000-01-01', '0000-01-01T00:00:00.000Z'],
      ['-000000-01-01', null],
      ['18431120', null],
      ['1843-1-20', null],
      ['Feb 14 1870', null],
    ]
    for (const [text, expected] of cases) {
      expect(parseIsoInstant(text)?.date.toISOString() ?? null, text).toBe(expected)
    }
    // A date field holds a whole date: a year or a month alone is part-way through typing.
    expect(readDateField('1066')).toBeNull()
    expect(readDateField('1871-03')).toBeNull()
    expect(readDateField('1871-03-04')).toEqual({ date: new Date('1871-03-04T00:00:00Z'), dateOnly: true })
  })

  it('reads text that is not ISO 8601 as no ISO date, and toInstant reads it as JavaScript always has (stored data only)', () => {
    fc.assert(
      fc.property(arb.fieldInstant, (date) => {
        for (const text of [date.toString(), date.toUTCString(), date.toDateString(), date.toLocaleDateString('en-US')]) {
          expect(parseIsoInstant(text), text).toBeNull()
          expect(readTimestamp(text), text).toBeNull()
          expect(toInstant(text).getTime(), text).toBe(new Date(text).getTime())
        }
      })
    )
    // Spellings other programs write, which JavaScript always read: still read so.
    for (const text of ['2023-01-01 12:00:00 UTC', '2023-01-01 12:00:00 +0000 UTC', '2023-01-01 12:00:00 -0800', '2023-01-01 12:00 PM', '2023-1-5', '2023-01-01Z']) {
      expect(toInstant(text).getTime(), text).toBe(new Date(text).getTime())
    }
    // Anything but text, a number or a Date is no date, and never a thrown error.
    for (const value of [null, undefined, {}, [], ['2020-01-01'], true, { $date: '2020-01-01' }]) {
      expect(Number.isNaN(toInstant(value).getTime()), JSON.stringify(value)).toBe(true)
    }
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 40 }), (text) => {
        const parsed = parseIsoInstant(text)
        if (parsed) expect(Number.isNaN(parsed.date.getTime())).toBe(false)
      }),
      arb.runs(2000)
    )
  })
})
