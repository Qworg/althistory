import { describe, expect, it } from 'vitest'
import {
  calendarDraftErrors,
  calendarFromDraft,
  calendarRequest,
  parseMonthNames,
  describeCalendar,
  draftFromCalendar,
  formatWorldYear,
  sameCalendar,
  storedYear,
  worldYear,
} from './worldCalendar'

describe('world calendar arithmetic (same as the backend)', () => {
  const AR = { epochYear: 1000, eraLabel: 'AR' }

  it('maps stored years to world years and back', () => {
    expect(worldYear(1000, AR)).toBe(1)
    expect(worldYear(1311, AR)).toBe(312)
    expect(worldYear(999, AR)).toBe(0)
    expect(storedYear(312, AR)).toBe(1311)
  })

  it('formats years, counting back before year 1', () => {
    expect(formatWorldYear(1311, AR)).toBe('312 AR')
    expect(formatWorldYear(1311, { epochYear: 1000 })).toBe('Year 312')
    expect(formatWorldYear(999, AR)).toBe('1 before AR')
    expect(formatWorldYear(999, { epochYear: 1000 })).toBe('1 before Year 1')
    expect(formatWorldYear(900, { epochYear: 1000, eraLabel: ' AR ' })).toBe('100 before AR')
  })

  it('describes a calendar in one line', () => {
    expect(describeCalendar({ ...AR, name: 'the Reckoning of Vael' })).toBe(
      'the Reckoning of Vael: stored year 1000 is 1 AR'
    )
  })

  it('compares calendars by what they show', () => {
    expect(sameCalendar(AR, { epochYear: 1000, eraLabel: ' AR' })).toBe(true)
    expect(sameCalendar(AR, { epochYear: 1001, eraLabel: 'AR' })).toBe(false)
    expect(sameCalendar(null, undefined)).toBe(true)
    expect(sameCalendar(AR, null)).toBe(false)
  })
})

describe('the calendar form draft', () => {
  const draft = (epochYear: string, eraLabel = '', name = '', monthNames = '') => ({ epochYear, eraLabel, name, monthNames })
  const MONTHS = ['Thaw', 'Seedfall', 'Greening', 'Highsun', 'Brine', 'Harvest', 'Ember', 'Ashfall', 'Gale', 'Dimming', 'Frost', 'Deepwinter']

  it('validates like the backend: an integer epoch 1..9999, a label up to 16, a name up to 80', () => {
    expect(calendarDraftErrors(draft('1000', 'AR', 'Vael'))).toEqual({})
    expect(calendarDraftErrors(draft('1')).epochYear).toBeUndefined()
    expect(calendarDraftErrors(draft('9999')).epochYear).toBeUndefined()
    expect(calendarDraftErrors(draft('')).epochYear).toBeDefined()
    expect(calendarDraftErrors(draft('0')).epochYear).toMatch(/1 to 9999/)
    expect(calendarDraftErrors(draft('10000')).epochYear).toMatch(/1 to 9999/)
    expect(calendarDraftErrors(draft('12.5')).epochYear).toBeDefined()
    expect(calendarDraftErrors(draft('abc')).epochYear).toBeDefined()
    expect(calendarDraftErrors(draft('1000', 'x'.repeat(16))).eraLabel).toBeUndefined()
    expect(calendarDraftErrors(draft('1000', 'x'.repeat(17))).eraLabel).toMatch(/16/)
    // Trimmed first, as the backend does.
    expect(calendarDraftErrors(draft('1000', `  ${'x'.repeat(16)}  `)).eraLabel).toBeUndefined()
    expect(calendarDraftErrors(draft('1000', '', 'n'.repeat(80))).name).toBeUndefined()
    expect(calendarDraftErrors(draft('1000', '', 'n'.repeat(81))).name).toMatch(/80/)
  })

  it('builds the calendar to send, trimmed and without empty fields', () => {
    expect(calendarFromDraft(draft(' 1000 ', ' AR ', ''))).toEqual({ epochYear: 1000, eraLabel: 'AR' })
    expect(calendarFromDraft(draft('1000', '', ' Vael '))).toEqual({ epochYear: 1000, name: 'Vael' })
    expect(calendarFromDraft(draft('0'))).toBeNull()
    expect(draftFromCalendar({ epochYear: 1000, eraLabel: 'AR' })).toEqual(draft('1000', 'AR', ''))
  })

  it('sends a calendar, null to remove one, or nothing', () => {
    const original = { epochYear: 1000, eraLabel: 'AR' }
    expect(calendarRequest(false, draft(''), undefined)).toEqual({ ok: true, calendar: undefined })
    expect(calendarRequest(false, draft('1000', 'AR'), original)).toEqual({ ok: true, calendar: null })
    expect(calendarRequest(true, draft('1000', 'AR'), original)).toEqual({ ok: true, calendar: undefined })
    expect(calendarRequest(true, draft('1200', 'AR'), original)).toEqual({
      ok: true,
      calendar: { epochYear: 1200, eraLabel: 'AR' },
    })
    expect(calendarRequest(true, draft('1000'), null)).toEqual({ ok: true, calendar: { epochYear: 1000 } })
    expect(calendarRequest(true, draft(''), null)).toEqual({ ok: false })
  })

  it('reads the month names one per line, or comma-separated on one line', () => {
    expect(parseMonthNames('')).toEqual([])
    expect(parseMonthNames('  \n ')).toEqual([])
    expect(parseMonthNames(`\n${MONTHS.join('\n')}\n`)).toEqual(MONTHS)
    expect(parseMonthNames(MONTHS.join(', '))).toEqual(MONTHS)
    // A name with a comma in it survives one per line.
    expect(parseMonthNames('Ash, Late\nB')).toEqual(['Ash, Late', 'B'])
  })

  it('checks the month names like the backend: all twelve, distinct, none empty or too long', () => {
    expect(calendarDraftErrors(draft('1000', '', '', MONTHS.join('\n'))).monthNames).toBeUndefined()
    expect(calendarDraftErrors(draft('1000', '', '', MONTHS.slice(0, 11).join('\n'))).monthNames).toMatch(/all 12.*11 names/)
    expect(calendarDraftErrors(draft('1000', '', '', [...MONTHS, 'Extra'].join('\n'))).monthNames).toMatch(/13 names/)
    const blank = [...MONTHS]
    blank[4] = ''
    expect(calendarDraftErrors(draft('1000', '', '', blank.join('\n'))).monthNames).toMatch(/empty/)
    const twice = [...MONTHS]
    twice[11] = 'thaw'
    expect(calendarDraftErrors(draft('1000', '', '', twice.join('\n'))).monthNames).toMatch(/two months/)
    const long = [...MONTHS]
    long[0] = 'x'.repeat(25)
    expect(calendarDraftErrors(draft('1000', '', '', long.join('\n'))).monthNames).toMatch(/24/)
  })

  it('sends the month names, and round-trips them through the form', () => {
    const calendar = { epochYear: 1000, monthNames: MONTHS }
    expect(calendarFromDraft(draft('1000', '', '', MONTHS.join(',')))).toEqual(calendar)
    expect(calendarFromDraft(draftFromCalendar(calendar))).toEqual(calendar)
    // Changing a month is a change; the same names are not.
    expect(calendarRequest(true, draftFromCalendar(calendar), calendar)).toEqual({ ok: true, calendar: undefined })
    const renamed = [...MONTHS]
    renamed[0] = 'Melt'
    expect(calendarRequest(true, draft('1000', '', '', renamed.join('\n')), calendar)).toEqual({
      ok: true,
      calendar: { epochYear: 1000, monthNames: renamed },
    })
    expect(calendarRequest(true, draft('1000'), calendar)).toEqual({ ok: true, calendar: { epochYear: 1000 } })
  })
})
