import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  calendarIssues,
  calendarProblems,
  formatWorldYear,
  normalizeCalendar,
  sameCalendar,
  storedCalendar,
  usableCalendar,
  worldMonthName,
} from './index'
import * as arb from './test/arbitraries'

describe('checking a calendar, for every input', () => {
  it('never throws, and says what is wrong in words', () => {
    fc.assert(
      fc.property(arb.untrustedCalendar, (value) => {
        const problems = calendarProblems(value)
        expect(problems).toHaveLength(calendarIssues(value).length)
        for (const problem of problems) expect(problem).toMatch(/^calendar/)
      }),
      arb.runs(2000)
    )
  })

  it('accepts every calendar in the stored shape, and stores it unchanged', () => {
    fc.assert(
      fc.property(arb.calendar, (calendar) => {
        expect(calendarProblems(calendar)).toEqual([])
        expect(normalizeCalendar(calendar)).toEqual(calendar)
        expect(storedCalendar(calendar)).toEqual(calendar)
        // The app keeps the very object: an unchanged calendar must not remount the views.
        expect(usableCalendar(calendar)).toBe(calendar)
      })
    )
  })

  it('normalizes to a calendar that checks out, is stable, and survives JSON', () => {
    fc.assert(
      fc.property(arb.paddedCalendar, (value) => {
        expect(calendarProblems(value)).toEqual([])
        const normalized = normalizeCalendar(value)
        expect(calendarProblems(normalized)).toEqual([])
        expect(normalizeCalendar(normalized)).toEqual(normalized)
        expect(JSON.parse(JSON.stringify(normalized))).toEqual(normalized)
        expect(storedCalendar(value)).toEqual(normalized)
      }),
      arb.runs(2000)
    )
  })

  it('refuses a forbidden character anywhere in a label, a name or a month name', () => {
    fc.assert(
      fc.property(
        arb.calendar,
        arb.eraLabel,
        fc.constantFrom(...arb.FORBIDDEN_LABEL_CHARS),
        fc.constantFrom(...arb.FORBIDDEN_MONTH_CHARS),
        fc.nat(),
        (calendar, base, labelChar, monthChar, at) => {
          // Inside the text, not at its ends, where trim() would take a line break away.
          const short = base.slice(0, 13)
          const cut = at % (short.length + 1)
          const bad = `x${short.slice(0, cut)}${labelChar}${short.slice(cut)}x`
          expect(calendarIssues({ ...calendar, eraLabel: bad })).toContainEqual({ field: 'eraLabel', code: 'forbidden' })
          expect(calendarIssues({ ...calendar, name: bad })).toContainEqual({ field: 'name', code: 'forbidden' })
          const months = [...(calendar.monthNames ?? Array.from({ length: 12 }, (_, i) => `M${i}`))]
          months[at % 12] = `M${monthChar}x`
          expect(calendarIssues({ ...calendar, monthNames: months })).toContainEqual({ field: 'monthNames', code: 'forbidden' })
        }
      )
    )
  })
})

describe('text that only looks right', () => {
  it('refuses a label, a name or a month name of invisible characters only', () => {
    fc.assert(
      fc.property(arb.calendar, fc.array(fc.constantFrom(...arb.INVISIBLE_CHARS), { minLength: 1, maxLength: 4 }), fc.nat(11), (calendar, chars, month) => {
        const invisible = chars.join('')
        if (invisible.trim() === '') {
          // trim() takes U+FEFF away: that label is empty, and dropped like any empty one.
          expect(normalizeCalendar({ ...calendar, eraLabel: invisible }).eraLabel).toBeUndefined()
        } else {
          expect(calendarIssues({ ...calendar, eraLabel: invisible })).toContainEqual({ field: 'eraLabel', code: 'invisible' })
          expect(calendarIssues({ ...calendar, name: ` ${invisible} ` })).toContainEqual({ field: 'name', code: 'invisible' })
        }
        const months = [...(calendar.monthNames ?? Array.from({ length: 12 }, (_, i) => `M${i}`))]
        months[month] = invisible
        expect(calendarIssues({ ...calendar, monthNames: months })).toContainEqual({ field: 'monthNames', code: 'empty' })
      })
    )
  })

  it('counts two month names that differ only by invisible characters or case as one', () => {
    fc.assert(
      fc.property(arb.monthNames, fc.constantFrom(...arb.INVISIBLE_CHARS), fc.nat(10), fc.nat(), (names, invisible, at, cut) => {
        const original = names[at]!
        const point = cut % (original.length + 1)
        const months = [...names]
        // The next month spelled the same, in capitals, with an invisible character inside it.
        months[at + 1] = `${original.slice(0, point)}${invisible}${original.slice(point)}`.toUpperCase()
        // Only where capitals come back to the same letters (not "ı", whose capital is "I").
        fc.pre(months[at + 1]!.trim() === months[at + 1] && original.toUpperCase().toLowerCase() === original.toLowerCase())
        expect(calendarIssues({ epochYear: 1000, monthNames: months })).toContainEqual(expect.objectContaining({ field: 'monthNames', code: 'duplicate' }))
      })
    )
  })

  it('counts a precomposed and a decomposed accent as one name', () => {
    expect(calendarIssues({ epochYear: 1000, monthNames: ['Pr\u00e9', 'Pre\u0301', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'] })).toContainEqual(
      expect.objectContaining({ code: 'duplicate' })
    )
  })

  it('keeps a zero-width non-joiner inside a word, as Persian writes it', () => {
    expect(calendarIssues({ epochYear: 1000, eraLabel: 'می\u200cرود' })).toEqual([])
  })
})

describe('reading a calendar back, for every input', () => {
  it('keeps a calendar exactly when the epoch is usable, and never loses the epoch', () => {
    fc.assert(
      fc.property(arb.untrustedCalendar, (value) => {
        const stored = storedCalendar(value)
        const epoch = (value as { epochYear?: unknown } | null)?.epochYear
        const epochUsable =
          typeof value === 'object' && value !== null && !Array.isArray(value) && calendarIssues({ epochYear: epoch }).length === 0
        expect(stored !== undefined).toBe(epochUsable)
        if (!stored) return
        expect(stored.epochYear).toBe(epoch)
        expect(calendarProblems(stored)).toEqual([])
        expect(storedCalendar(stored)).toEqual(stored)
      }),
      arb.runs(3000)
    )
  })

  it('keeps each field that checks out on its own, and only those', () => {
    fc.assert(
      fc.property(arb.untrustedCalendar, (value) => {
        const stored = storedCalendar(value)
        fc.pre(stored !== undefined)
        const record = value as Record<string, unknown>
        for (const field of ['eraLabel', 'name', 'monthNames'] as const) {
          const alone = record[field] !== undefined && calendarIssues({ epochYear: record.epochYear, [field]: record[field] }).length === 0
          const empty = typeof record[field] === 'string' && (record[field] as string).trim() === ''
          expect(field in stored!, `${field}: ${JSON.stringify(record[field])}`).toBe(alone && !empty)
        }
      }),
      arb.runs(3000)
    )
  })

  it('reads the same in the app as in the API', () => {
    fc.assert(
      fc.property(arb.untrustedCalendar, (value) => {
        expect(usableCalendar(value)).toEqual(storedCalendar(value) ?? null)
      }),
      arb.runs(3000)
    )
  })
})

describe('comparing calendars', () => {
  it('is reflexive and symmetric, and sees through trimming', () => {
    fc.assert(
      fc.property(arb.calendar, arb.calendar, (a, b) => {
        expect(sameCalendar(a, a)).toBe(true)
        expect(sameCalendar(a, b)).toBe(sameCalendar(b, a))
        const padded = { ...a, ...(a.eraLabel ? { eraLabel: ` ${a.eraLabel} ` } : {}) }
        expect(sameCalendar(a, padded)).toBe(true)
      })
    )
  })

  it('calls two calendars the same only when they label every year and month the same', () => {
    // Pairs that are often the same: a calendar beside a copy with one field changed, or none.
    const pair = arb.calendar.chain((a) =>
      fc.tuple(
        fc.constant(a),
        fc.oneof(
          fc.constant({ ...a }),
          arb.epochYear.map((epochYear) => ({ ...a, epochYear })),
          fc.option(arb.eraLabel, { nil: undefined }).map((eraLabel) => ({ ...a, eraLabel })),
          fc.option(arb.monthNames, { nil: undefined }).map((monthNames) => ({ ...a, monthNames }))
        )
      )
    )
    fc.assert(
      fc.property(pair, fc.integer({ min: -300000, max: 300000 }), fc.integer({ min: 0, max: 11 }), ([a, b], year, month) => {
        fc.pre(sameCalendar(a, b))
        expect(formatWorldYear(year, a)).toBe(formatWorldYear(year, b))
        expect(worldMonthName(month, a)).toBe(worldMonthName(month, b))
      })
    )
  })

  it('tells calendars apart that label a year differently', () => {
    fc.assert(
      fc.property(arb.calendar, arb.calendar, fc.integer({ min: -300000, max: 300000 }), (a, b, year) => {
        fc.pre(formatWorldYear(year, a) !== formatWorldYear(year, b))
        expect(sameCalendar(a, b)).toBe(false)
      })
    )
  })
})
