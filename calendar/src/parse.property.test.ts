import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { calendarProblems, parseEpochYear, parseMonthNames } from './index'
import * as arb from './test/arbitraries'

/** Every way the docs say a list of month names can be written. */
const SPELLINGS: Array<[string, (names: string[]) => string]> = [
  ['a JSON list', (names) => JSON.stringify(names)],
  ['a pretty-printed JSON list', (names) => JSON.stringify(names, null, 2)],
  ['one per line', (names) => names.join('\n')],
  ['one per line, CRLF', (names) => names.join('\r\n')],
  ['one per line with trailing commas', (names) => names.map((name) => `${name},`).join('\n')],
  ['one per line between blank lines', (names) => `\n\n${names.join('\n')}\n\n`],
  ['comma-separated', (names) => names.join(',')],
  ['comma-and-space-separated', (names) => names.join(', ')],
  ['comma-separated with a trailing comma', (names) => `${names.join(',')},`],
  ['comma-separated, padded', (names) => `  ${names.join(' ,  ')} , `],
]

describe('month names as text, for every list of twelve good names', () => {
  for (const [spelling, write] of SPELLINGS) {
    it(`reads ${spelling} back as the same twelve`, () => {
      fc.assert(
        fc.property(arb.monthNames, (names) => {
          expect(parseMonthNames(write(names))).toEqual(names)
        })
      )
    })
  }

  it('never throws, and returns names already trimmed', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 200 }), (text) => {
        for (const name of parseMonthNames(text)) expect(name).toBe(name.trim())
      }),
      arb.runs(2000)
    )
  })
})

describe('the epoch year as typed or sent', () => {
  it('reads every integer back, however it is written', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e9, max: 1e9 }), (year) => {
        expect(parseEpochYear(year)).toBe(year)
        expect(parseEpochYear(String(year))).toBe(year)
        expect(parseEpochYear(`  ${year}\t`)).toBe(year)
        if (year >= 0) expect(parseEpochYear(`+${year}`)).toBe(year)
        if (year >= 0) expect(parseEpochYear(`000${year}`)).toBe(year)
      })
    )
  })

  it('reads nothing that is not a whole number as one', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 9999 }), (year) => {
        for (const text of [`${year}.5`, `${year}e0`, `${year}.0`, `1,${year}`, `${year}_0`, `0x${year}`, `${year} AR`, `--${year}`, `+-${year}`]) {
          expect(parseEpochYear(text), text).toBeNull()
        }
        expect(parseEpochYear(year + 0.5)).toBeNull()
        // Digits other than ASCII are not read as a year: the form and the CLI agree on that.
        expect(parseEpochYear(new Intl.NumberFormat('ar-EG', { useGrouping: false }).format(year))).toBeNull()
      })
    )
    // However many digits, a run of them is a whole number out of range, refused for its range.
    fc.assert(
      fc.property(fc.integer({ min: 16, max: 400 }), fc.constantFrom('', '+', '-'), (length, sign) => {
        const year = parseEpochYear(`${sign}${'9'.repeat(length)}`)
        expect(Number.isInteger(year)).toBe(true)
        expect(calendarProblems({ epochYear: year })).toEqual(['calendar.epochYear must be between 1 and 9999'])
      })
    )
    for (const value of ['', ' ', '+', '-', NaN, Infinity, -Infinity, null, undefined, {}, [1000], true]) {
      expect(parseEpochYear(value), String(value)).toBeNull()
    }
  })
})
