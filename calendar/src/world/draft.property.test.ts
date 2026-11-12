import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import * as arb from '../test/arbitraries'
import * as warb from '../test/worldArbitraries'
import {
  type WorldCalendarSet,
  type WorldDraft,
  draftFromSet,
  formatInWorld,
  legacyCalendarSet,
  newCalendarDraft,
  newWorldDraft,
  readWorldDraft,
  calendarSetIssues,
  sameCalendarSet,
  storedCalendarSet,
  worldDraftErrors,
} from './index'

/** A set with what a form cannot tell apart from its absence left out: empty lists, false flags, no templates. */
function canonical(set: WorldCalendarSet): unknown {
  return JSON.parse(
    JSON.stringify(set, (key, value) => {
      if (key === 'leapRules' && Array.isArray(value) && value.length === 0) return undefined
      if ((key === 'intercalary' || key === 'skipsIntercalary') && value === false) return undefined
      if (key === 'notation' && value && Object.keys(value).length === 0) return undefined
      return value
    })
  )
}

/** Every key an error can be filed under is a field the editor has. */
const FIELD_KEY =
  /^(dayHours|primary|calendars(\.\d+(\.(id|name|epoch|beforeEra|weekDays|epochWeekday|skipsIntercalary|hoursPerDay|minutesPerHour|secondsPerMinute|notation(\.(date|month|year|festival|time))?|time|parts(\.\d+(\.(name|days|festival))?)?|leapRules(\.\d+(\.(every|offset|part|days))?)?|eras(\.\d+(\.(label|from))?)?))?)?)$/

describe('the world calendar editor', () => {
  it('holds any calendar set, and sends it back as the API stores it', () => {
    fc.assert(
      fc.property(warb.calendarSet, (set) => {
        const read = readWorldDraft(draftFromSet(set))
        expect(read.ok, JSON.stringify(read.ok ? null : read.errors)).toBe(true)
        if (!read.ok) return
        expect(canonical(read.set)).toEqual(canonical(set))
        // So a calendar opened in the editor and saved unchanged is not sent.
        expect(sameCalendarSet(read.set, set)).toBe(true)
      }),
      arb.runs(1000)
    )
  })

  it('starts a new world, and a new calendar in it, that the API takes', () => {
    const world = newWorldDraft()
    expect(readWorldDraft(world).ok).toBe(true)
    fc.assert(
      fc.property(warb.calendarSet, fc.integer({ min: 1, max: 4 }), (set, added) => {
        const draft = draftFromSet(set)
        for (let index = 0; index < added && draft.calendars.length < 8; index++) {
          draft.calendars.push(newCalendarDraft(draft, `Added ${'I'.repeat(index + 1)}`))
        }
        expect(worldDraftErrors(draft)).toEqual({})
      }),
      arb.runs(300)
    )
  })

  it('reads a year 1 given as an ISO date as the day it falls on', () => {
    const draft = newWorldDraft()
    draft.calendars[0]!.epoch = '1970-01-03'
    const read = readWorldDraft(draft)
    expect(read.ok && read.set.calendars[0]!.epoch).toBe(2)
    draft.dayHours = '48'
    const longer = readWorldDraft(draft)
    expect(longer.ok && longer.set.calendars[0]!.epoch).toBe(1)
  })

  it('files every problem under a field it has, as a sentence', () => {
    const corrupt = fc.constantFrom('', 'x', '-1', '0', '1.5', '99999999', ' ')
    fc.assert(
      fc.property(warb.calendarSet, fc.nat(), fc.nat(), corrupt, (set, which, index, bad) => {
        const draft: WorldDraft = draftFromSet(set)
        const calendar = draft.calendars[index % draft.calendars.length]!
        const targets: Array<() => void> = [
          () => (draft.dayHours = bad),
          () => (draft.primary = bad),
          () => (calendar.name = bad),
          () => (calendar.epoch = bad),
          () => (calendar.parts[index % calendar.parts.length]!.days = bad),
          () => (calendar.parts[index % calendar.parts.length]!.name = bad),
          () => calendar.leapRules.length > 0 && (calendar.leapRules[index % calendar.leapRules.length]!.every = bad),
          () => calendar.eras.length > 0 && (calendar.eras[index % calendar.eras.length]!.from = bad),
          () => (calendar.hoursPerDay = bad),
          () => (calendar.weekDays = bad === '' ? '' : `${bad}\n${bad}`),
          () => (calendar.notation.date = bad),
        ]
        targets[which % targets.length]!()
        const errors = worldDraftErrors(draft)
        for (const [key, message] of Object.entries(errors)) {
          expect(key).toMatch(FIELD_KEY)
          expect(message).toMatch(/^[A-Z"].*[.!?]$/)
          expect(message).not.toMatch(/calendar\.calendars\[/)
        }
        // The draft is sent only when it has no problems.
        expect(readWorldDraft(draft).ok).toBe(Object.keys(errors).length === 0)
      }),
      arb.runs(1500)
    )
  })
})

describe('telling two calendar sets apart', () => {
  it('finds a set the same as itself however its keys are ordered, and as its earlier form', () => {
    fc.assert(
      fc.property(warb.calendarSet, (set) => {
        const reordered = JSON.parse(JSON.stringify(set, (_key, value) =>
          value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).reverse()) : value
        ))
        expect(sameCalendarSet(set, reordered)).toBe(true)
      }),
      arb.runs(300)
    )
    fc.assert(
      fc.property(arb.calendar, (calendar) => {
        // An earlier-form calendar a set can hold reads as that set; one it
        // cannot, as what of it a set can hold.
        const set = legacyCalendarSet(calendar)
        if (calendarSetIssues(set).length === 0) expect(sameCalendarSet(calendar, set)).toBe(true)
        else expect(calendarSetIssues(storedCalendarSet(calendar)).length).toBe(0)
      }),
      arb.runs(300)
    )
  })

  it('tells apart two sets that date some position differently', () => {
    fc.assert(
      fc.property(warb.calendarSet, warb.calendarSet, fc.integer({ min: -1e12, max: 1e12 }), (a, b, position) => {
        const differ = formatInWorld(a, position, 'day', a.primary) !== formatInWorld(b, position, 'day', b.primary)
        if (differ) expect(sameCalendarSet(a, b)).toBe(false)
        expect(sameCalendarSet(a, null)).toBe(false)
      }),
      arb.runs(500)
    )
  })
})
