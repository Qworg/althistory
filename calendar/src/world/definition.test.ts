import { describe, expect, it } from 'vitest'
import { type CalendarDefinition, calendarSetIssues, gregorianDefinition, normalizeCalendarSet, storedCalendarSet } from './index'

const vael: CalendarDefinition = {
  id: 'reckoning',
  name: 'the Reckoning of the Rising',
  parts: [
    { name: 'Lowtide', days: 30 },
    { name: 'Greywater', days: 30 },
    { name: 'Thaw', days: 30 },
    { name: 'Seedtide', days: 30 },
    { name: 'Brightwater', days: 30 },
    { name: 'Highsun', days: 30 },
    { name: "Midyear's Day", days: 1, intercalary: true },
    { name: 'Saltreap', days: 30 },
    { name: 'Panfire', days: 30 },
    { name: 'Gale', days: 30 },
    { name: 'Ebb', days: 30 },
    { name: 'Wrack', days: 30 },
    { name: 'Longnight', days: 30 },
    { name: 'The Drowned Days', days: 4, intercalary: true },
  ],
  leapRules: [{ every: 6, part: 13, days: 1 }],
  epoch: 0,
  eras: [{ label: 'AR', from: 1 }],
  week: { days: ['Firstfast', 'Netday', 'Saltday', 'Moonsday', 'Restday'], skipsIntercalary: true },
  time: { hoursPerDay: 20, minutesPerHour: 100, secondsPerMinute: 100 },
}
const set = (calendars: unknown[], extra: Record<string, unknown> = {}) => ({ version: 2, dayLength: 30 * 3600, calendars, primary: 'reckoning', ...extra })

describe('a calendar set', () => {
  it('accepts a world calendar of twelve months and two festivals, a leap cycle, a five-day week and its own hours', () => {
    expect(calendarSetIssues(set([vael]))).toEqual([])
    expect(normalizeCalendarSet(set([vael])).calendars[0]!.parts).toHaveLength(14)
  })

  it('accepts the Gregorian calendar as a definition', () => {
    expect(calendarSetIssues({ version: 2, dayLength: 86_400, calendars: [gregorianDefinition({ id: 'reckoning' })], primary: 'reckoning' })).toEqual([])
  })

  it('refuses each thing that would make dates unreadable, and says where', () => {
    const cases: Array<[Partial<CalendarDefinition> | Record<string, unknown>, RegExp]> = [
      [{ parts: [] }, /parts must list 1 to 100/],
      [{ parts: [{ name: 'A', days: 0 }] }, /days must be a whole number from 1 to 1000/],
      [{ parts: [{ name: 'Thaw', days: 3 }, { name: 'thaw', days: 3 }] }, /another month or festival is already called "thaw"/],
      [{ parts: [{ name: 'Fest', days: 3, intercalary: true }] }, /at least one month/],
      [{ parts: [{ name: 'Th{aw', days: 3 }] }, /braces/],
      [{ leapRules: [{ every: 4, part: 0, days: -30 }] }, /leave Lowtide with 0 days/],
      [{ leapRules: [{ every: 99991, part: 0, days: 1 }, { every: 99989, part: 1, days: 1 }] }, /repeat over more than 100000 years/],
      [{ leapRules: [{ every: 4, part: 99, days: 1 }] }, /part must be the index/],
      [{ epoch: 1e15 }, /epoch must be a whole axis day within the range/],
      [{ eras: [{ label: 'AR', from: 5 }, { label: 'SR', from: 5 }] }, /after the previous era's/],
      [{ eras: [{ label: 'Age 2', from: 1 }] }, /cannot contain a digit/],
      [{ eras: [{ label: 'before Tide', from: 1 }] }, /cannot start with "before"/],
      [{ beforeEra: 'AR' }, /must differ from every era's label/],
      [{ week: { days: [] } }, /week must name 1 to 100 days/],
      [{ time: { hoursPerDay: 0 } }, /hoursPerDay must be a whole number from 1/],
      [{ notation: { date: '{month}{day} {year}' } }, /separate its placeholders/],
      [{ notation: { date: '{month} {year}' } }, /must hold \{day\} exactly once/],
      [{ notation: { date: '{month} {day}, {year} {weekday}' } }, /unknown placeholder \{weekday\}/],
      [{ id: 'Bad Id' }, /id must be 1 to 32 lowercase/],
      [{ colour: 'blue' }, /unknown field "colour"/],
    ]
    for (const [change, message] of cases) {
      const messages = calendarSetIssues(set([{ ...vael, ...change }])).map((issue) => issue.message)
      expect(messages.join(' | '), JSON.stringify(change)).toMatch(message)
    }
  })

  it('refuses a second shorter than a millisecond, which no position could tell apart', () => {
    const messages = calendarSetIssues(set([vael], { dayLength: 7 })).map((issue) => issue.message)
    expect(messages.join(' | ')).toMatch(/each must last at least a millisecond/)
  })

  it('needs its primary among its calendars, and distinct ids', () => {
    expect(calendarSetIssues(set([vael], { primary: 'other' })).map((issue) => issue.message).join()).toMatch(/primary must be the id/)
    expect(calendarSetIssues(set([vael, vael])).map((issue) => issue.message).join()).toMatch(/distinct ids/)
  })
})

describe('a stored calendar set read back', () => {
  it('keeps the calendars that still check out, and moves the primary to one that does', () => {
    const broken = { ...vael, id: 'broken', parts: [{ name: 'Th|aw', days: 3 }] }
    const read = storedCalendarSet({ ...set([broken, { ...vael, id: 'tide' }]), primary: 'broken' })
    expect(read?.calendars.map((definition) => definition.id)).toEqual(['tide'])
    expect(read?.primary).toBe('tide')
  })

  it('reads the earlier form as one Gregorian-shaped calendar', () => {
    const read = storedCalendarSet({ epochYear: 1000, eraLabel: 'AR' })
    expect(read?.calendars[0]!.parts).toHaveLength(12)
    expect(read?.calendars[0]!.eras).toEqual([{ label: 'AR', from: 1 }])
  })

  it('has none without a calendar that checks out', () => {
    expect(storedCalendarSet(null)).toBeNull()
    expect(storedCalendarSet({ version: 2, dayLength: 86_400, calendars: [], primary: 'x' })).toBeNull()
  })
})

describe('a set whose text would not read back', () => {
  const base = (parts: Array<{ name: string; days: number; intercalary?: boolean }>, extra: Record<string, unknown> = {}) => ({
    version: 2,
    dayLength: 86_400,
    primary: 'a',
    calendars: [{ id: 'a', name: 'A', parts, epoch: 0, eras: [{ label: 'AR', from: 1 }], ...extra }],
  })

  it('is refused when a festival writes what reads as a day of a month', () => {
    const issues = calendarSetIssues(base([{ name: 'Midyear', days: 30 }, { name: 'Midyear 3', days: 1, intercalary: true }]))
    expect(issues.map((issue) => issue.path)).toContain('calendar.calendars[0].parts[1].name')
    expect(issues[0]!.message).toMatch(/cannot contain a digit/)
  })

  it('is refused when a year reads as a month', () => {
    const issues = calendarSetIssues({
      ...base([{ name: 'Year', days: 30 }, { name: 'Thaw', days: 30 }]),
      calendars: [{ id: 'a', name: 'A', parts: [{ name: 'Year', days: 30 }, { name: 'Thaw', days: 30 }], epoch: 0, notation: { year: 'Year {year}' } }],
    })
    expect(issues.length).toBeGreaterThan(0)
  })

  it('is refused when two calendars write the same text for different days', () => {
    const one = { id: 'a', name: 'A', parts: [{ name: 'Thaw', days: 30 }], epoch: 0 }
    const issues = calendarSetIssues({ version: 2, dayLength: 86_400, primary: 'a', calendars: [one, { ...one, id: 'b', name: 'B', epoch: 5 }] })
    expect(issues.some((issue) => /also a date in A|also a date in B/.test(issue.message))).toBe(true)
    // An era label of its own tells them apart.
    expect(
      calendarSetIssues({ version: 2, dayLength: 86_400, primary: 'a', calendars: [one, { ...one, id: 'b', name: 'B', epoch: 5, eras: [{ label: 'TC', from: 1 }] }] })
    ).toEqual([])
  })

  it('accepts the default templates written out', () => {
    expect(
      calendarSetIssues(base([{ name: 'Thaw', days: 30 }], { notation: { date: '{month} {day}, {year}', month: '{month} {year}', festival: '{month}, {year}' } }))
    ).toEqual([])
    expect(calendarSetIssues(base([{ name: 'Thaw', days: 30 }], { notation: { date: '{day}{month} {year}' } }))[0]!.message).toMatch(/separate its placeholders/)
  })

  it('is still shown when stored before the rule', () => {
    const stored = base([{ name: 'Midyear', days: 30 }, { name: 'Midyear 3', days: 1, intercalary: true }])
    expect(storedCalendarSet(stored)?.calendars[0]!.parts).toHaveLength(2)
  })
})

describe('the read-back check, in years it might have missed', () => {
  it('refuses a festival that collides only in leap years', () => {
    const issues = calendarSetIssues({
      version: 2,
      dayLength: 86_400,
      primary: 'a',
      calendars: [{
        id: 'a', name: 'A', epoch: 0, eras: [{ label: 'AR', from: 1 }],
        parts: [{ name: 'Thaw', days: 30 }, { name: 'Sun', days: 30 }, { name: 'Thaw 31', days: 1, intercalary: true }],
        leapRules: [{ every: 4, offset: 2, part: 0, days: 1 }],
      }],
    })
    expect(issues.length).toBeGreaterThan(0)
  })

  it('refuses a collision though the first era begins beyond the reach of a date', () => {
    const issues = calendarSetIssues({
      version: 2,
      dayLength: 86_400,
      primary: 'a',
      calendars: [{
        id: 'a', name: 'A', epoch: 0, eras: [{ label: 'AR', from: 1_000_000_000 }],
        parts: [{ name: 'Midyear', days: 30 }, { name: 'Midyear 3', days: 1, intercalary: true }],
      }],
    })
    expect(issues.length).toBeGreaterThan(0)
    expect(issues[0]!.message).not.toMatch(/reads back as "([^"]+)".*\1/)
  })
})

describe('calendars that share a year word', () => {
  it('are refused, as their text could name a date in either', () => {
    const a = { id: 'a', name: 'A', parts: [{ name: 'Thaw', days: 30 }, { name: 'Gale', days: 30 }], epoch: 0, eras: [{ label: 'AR', from: 1 }, { label: 'SR', from: 500 }] }
    const b = { id: 'b', name: 'B', parts: [{ name: 'Seed', days: 30 }, { name: 'Gale', days: 30 }], epoch: 7, eras: [{ label: 'QR', from: 1 }, { label: 'SR', from: 100 }] }
    const issues = calendarSetIssues({ version: 2, dayLength: 86_400, primary: 'a', calendars: [a, b] })
    expect(issues.some((issue) => issue.path === 'calendar.calendars[1].eras' && /writes its years with "SR", as A does/.test(issue.message))).toBe(true)
    // Two calendars without labels both write "Year 5".
    const plain = (id: string) => ({ id, name: id.toUpperCase(), parts: [{ name: id === 'a' ? 'Thaw' : 'Seed', days: 30 }], epoch: 0 })
    expect(calendarSetIssues({ version: 2, dayLength: 86_400, primary: 'a', calendars: [plain('a'), plain('b')] }).length).toBeGreaterThan(0)
  })
})
