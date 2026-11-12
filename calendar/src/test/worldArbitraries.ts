/**
 * Generators of world calendars for the property tests: any number of parts
 * of any length, festival days, leap rules, eras, weeks, days of other
 * lengths divided their own way, and notations. Only valid definitions are
 * kept (the validation is tested on its own).
 */

import fc from 'fast-check'
import {
  type CalendarDefinition,
  type WorldCalendarSet,
  calendarDefinitionIssues,
} from '../world/definition'
import { calendarSetIssues } from '../world/check'

const nameUnit = fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzþæéß'.split(''))
const name = fc.string({ unit: nameUnit, minLength: 2, maxLength: 8 }).map((text) => `Q${text}`)
/** Names a reader could tell apart: distinct ignoring case. */
const names = (min: number, max: number) => fc.uniqueArray(name, { minLength: min, maxLength: max, selector: (text) => text.toLowerCase() })

const part = fc.record({ days: fc.integer({ min: 1, max: 60 }), intercalary: fc.boolean() })

const NOTATIONS = [
  {},
  { date: '{day} {month} {year}', month: '{month} of {year}' },
  { date: '{year}, {month} {day}', month: '{year}, {month}', festival: '{year}: {month}' },
  { date: 'the {day} of {month}, {year}', time: '{hour}h{minute}' },
  { date: '{month} {day}, {year}', time: '{hour}.{minute}.{second}' },
]

const ERA_LABELS = ['AR', 'Second Age', 'DR', 'Reckoning', 'of the Tide']

export const definition: fc.Arbitrary<CalendarDefinition> = fc
  .record({
    names: names(1, 16),
    parts: fc.array(part, { minLength: 16, maxLength: 16 }),
    rules: fc.array(
      fc.record({
        every: fc.constantFrom(1, 2, 3, 4, 5, 7, 10, 12, 100, 400),
        offset: fc.integer({ min: -10, max: 10 }),
        part: fc.nat(15),
        days: fc.integer({ min: -2, max: 3 }).filter((days) => days !== 0),
      }),
      { maxLength: 3 }
    ),
    epoch: fc.oneof(fc.integer({ min: -1_000_000, max: 1_000_000 }), fc.constant(0)),
    eraCount: fc.integer({ min: 0, max: 3 }),
    eraStarts: fc.uniqueArray(fc.integer({ min: -3000, max: 3000 }), { minLength: 3, maxLength: 3 }),
    beforeEra: fc.option(fc.constantFrom('BAR', 'before the Tide'), { nil: undefined }),
    week: fc.option(
      fc.record({ days: names(1, 10), epochWeekday: fc.nat(9), skipsIntercalary: fc.boolean() }),
      { nil: undefined }
    ),
    time: fc.option(
      fc.record({
        hoursPerDay: fc.integer({ min: 1, max: 40 }),
        minutesPerHour: fc.integer({ min: 1, max: 100 }),
        secondsPerMinute: fc.integer({ min: 1, max: 100 }),
      }),
      { nil: undefined }
    ),
    notation: fc.constantFrom(...NOTATIONS),
  })
  .map((r): CalendarDefinition => {
    const parts = r.names.map((partName, index) => ({ name: partName, days: r.parts[index]!.days, ...(r.parts[index]!.intercalary ? { intercalary: true } : {}) }))
    if (parts.every((p) => p.intercalary)) delete parts[0]!.intercalary
    const starts = [...r.eraStarts].sort((a, b) => a - b)
    const eras =
      r.eraCount === 0 ? [{ label: '', from: 1 }] : ERA_LABELS.slice(0, r.eraCount).map((label, index) => ({ label, from: starts[index]! }))
    return {
      id: 'world',
      name: 'The Reckoning',
      parts,
      leapRules: r.rules.map((rule) => ({ ...rule, part: rule.part % parts.length })),
      epoch: r.epoch,
      eras,
      ...(r.beforeEra && r.eraCount > 0 ? { beforeEra: r.beforeEra } : {}),
      ...(r.week ? { week: { ...r.week, epochWeekday: r.week.epochWeekday % r.week.days.length } } : {}),
      ...(r.time ? { time: r.time } : {}),
      notation: r.notation,
    }
  })
  .filter((candidate) => calendarDefinitionIssues(candidate, 'calendar', 86_400).length === 0)

/** A world's day in seconds: Earth's, and longer and shorter ones. */
export const dayLength = fc.constantFrom(86_400, 30 * 3600, 1000, 100_000, 7)

const IDS = ['world', 'second', 'third']
const CALENDAR_NAMES = ['The Reckoning', 'The Tide Count', 'The Old Count']

/** A world with one calendar, or with two or three (any of them shown first), of any shapes. */
export const calendarSet: fc.Arbitrary<WorldCalendarSet> = fc
  .tuple(fc.array(definition, { minLength: 1, maxLength: 3 }), dayLength, fc.nat(2))
  .map(([definitions, length, shown]) => {
    // Each calendar counts its own eras (two that both write "5 AR" or
    // "Year 5" are refused, rightly); names may still collide, and are filtered.
    const calendars = definitions.map((calendar, index) => ({
      ...calendar,
      id: IDS[index]!,
      name: CALENDAR_NAMES[index]!,
      eras: index === 0 ? calendar.eras : calendar.eras!.map((era) => ({ ...era, label: `${era.label || 'Count'} ${'XY'[index - 1]}` })),
      ...(index > 0 && calendar.beforeEra ? { beforeEra: `${calendar.beforeEra} ${'XY'[index - 1]}` } : {}),
    }))
    return { version: 2 as const, dayLength: length, calendars, primary: calendars[shown % calendars.length]!.id }
  })
  .filter((set) => calendarSetIssues(set).length === 0)
