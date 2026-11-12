import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { calendarDraftErrors, calendarFromDraft, calendarProblems, draftFromCalendar, normalizeCalendar, parseEpochYear, parseMonthNames } from './index'
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
    for (const value of ['', ' ', '+', '-', NaN, Infinity, -Infinity, null, undefined, {}, [1000], true]) {
      expect(parseEpochYear(value), String(value)).toBeNull()
    }
  })
})

describe('the calendar form, for every draft', () => {
  /** A field as a person might type it: something good, something padded, or anything at all. */
  const typed = (good: fc.Arbitrary<string>) =>
    fc.oneof(good, good.map((value) => `  ${value}\n`), fc.string({ unit: 'binary', maxLength: 30 }), fc.constant(''))
  const draft = fc.record({
    epochYear: typed(arb.epochYear.map(String)),
    eraLabel: typed(arb.eraLabel),
    name: typed(arb.calendarName),
    monthNames: fc.oneof(
      arb.monthNames.map((names) => names.join('\n')),
      arb.monthNames.map((names) => names.join(', ')),
      arb.monthNames.map((names) => JSON.stringify(names)),
      fc.string({ unit: 'binary', maxLength: 60 }),
      fc.constant('')
    ),
  })

  it('accepts exactly what it can send, and sends only what the API accepts', () => {
    fc.assert(
      fc.property(draft, (value) => {
        const errors = calendarDraftErrors(value)
        const calendar = calendarFromDraft(value)
        expect(calendar === null).toBe(Object.keys(errors).length > 0)
        if (calendar) {
          expect(calendarProblems(calendar)).toEqual([])
          expect(normalizeCalendar(calendar)).toEqual(calendar)
        }
      }),
      arb.runs(3000)
    )
  })

  it('says, for each field it refuses, that the API would refuse that field', () => {
    fc.assert(
      fc.property(draft, (value) => {
        const errors = calendarDraftErrors(value)
        const epoch = parseEpochYear(value.epochYear)
        const months = parseMonthNames(value.monthNames)
        const fields: Record<keyof typeof errors, Record<string, unknown>> = {
          epochYear: { epochYear: epoch ?? value.epochYear },
          eraLabel: { epochYear: 1, eraLabel: value.eraLabel },
          name: { epochYear: 1, name: value.name },
          monthNames: months.length > 0 ? { epochYear: 1, monthNames: months } : { epochYear: 1 },
        }
        for (const [field, request] of Object.entries(fields)) {
          const refused = calendarProblems(request).length > 0
          expect(field in errors, `${field}: ${JSON.stringify(request)}`).toBe(refused)
        }
      }),
      arb.runs(3000)
    )
  })

  it('opens every calendar for editing and saves it back unchanged', () => {
    fc.assert(
      fc.property(arb.calendar, (calendar) => {
        const opened = draftFromCalendar(calendar)
        expect(calendarDraftErrors(opened)).toEqual({})
        expect(calendarFromDraft(opened)).toEqual(normalizeCalendar(calendar))
      })
    )
  })
})
