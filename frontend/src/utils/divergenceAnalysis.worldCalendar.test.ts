import { afterEach, describe, expect, it } from 'vitest'
import { analyzeEventDivergence, comparisonCalendar, comparisonSide, formatDivergenceDate } from './divergenceAnalysis'
import { useWorldCalendarStore } from '@/stores/worldCalendarStore'
import type { Event, GraphCalendar } from '@/types'
import {
  type DatePrecision,
  calendarIn,
  datePrecisionMetadata,
  isoOfAxisTime,
  legacyCalendarSet,
  positionOf,
  toInstant,
} from '@althistory/calendar'

const AR: GraphCalendar = legacyCalendarSet({ epochYear: 1000, eraLabel: 'AR' })
const NE: GraphCalendar = legacyCalendarSet({ epochYear: 1200, eraLabel: 'NE' })

const event = (id: string, timestamp: string): Event => ({
  id,
  description: id,
  actor: 'a',
  target: 'b',
  timestamp,
  created_at: timestamp,
  updated_at: timestamp,
})

afterEach(() => useWorldCalendarStore.getState().setCalendar(null))

describe('comparisonCalendar', () => {
  it("gives a side's date its own graph's calendar", () => {
    expect(comparisonCalendar('baseline', { baseline: AR, counterfactual: null })).toBe(AR)
    expect(comparisonCalendar('counterfactual', { baseline: AR, counterfactual: null })).toBeNull()
  })

  it('gives a shared date the common calendar, or none when the calendars differ', () => {
    expect(comparisonCalendar('both', { baseline: AR, counterfactual: { ...AR } })).toBe(AR)
    expect(comparisonCalendar('both', { baseline: AR, counterfactual: NE })).toBeNull()
    expect(comparisonCalendar('both', { baseline: AR, counterfactual: null })).toBeNull()
  })

  it("falls back to the open graph's calendar for a side not given", () => {
    useWorldCalendarStore.getState().setCalendar(AR)
    expect(comparisonCalendar('both')).toEqual(AR)
    expect(comparisonCalendar('counterfactual', { baseline: null })).toEqual(AR)
  })

  it('maps statuses to sides', () => {
    expect(comparisonSide('divergent_added')).toBe('counterfactual')
    expect(comparisonSide('event_removed')).toBe('baseline')
    expect(comparisonSide('modified')).toBe('both')
  })
})

describe('point-of-divergence descriptions', () => {
  it("write the date in the calendar of the graph it comes from, not the open graph's", () => {
    useWorldCalendarStore.getState().setCalendar(NE)
    const added = analyzeEventDivergence([event('a', '1843-01-01T00:00:00Z')], [event('a', '1843-01-01T00:00:00Z'), event('b', '1844-02-01T00:00:00Z')], {
      baseline: null,
      counterfactual: AR,
    })
    expect(added.metrics.pointOfDivergence?.description).toBe('First new counterfactual event: "b" (Feb 1, 845 AR)')

    const removed = analyzeEventDivergence([event('a', '1843-01-01T00:00:00Z')], [], { baseline: null, counterfactual: AR })
    expect(removed.metrics.pointOfDivergence?.description).toBe('Prevented/omitted event: "a" (Jan 1, 1843)')
  })
})

describe('the point of divergence, dated at the precision its event was given at', () => {
  const given = (id: string, timestamp: string, read: { precision: DatePrecision; calendar?: string }): Event => ({
    ...event(id, timestamp),
    metadata: datePrecisionMetadata(read),
  })

  it('shows a year or a month as given, not the day it is stored at, in a plain graph', () => {
    const year = analyzeEventDivergence([], [given('Treaty', '1871-01-01T00:00:00.000Z', { precision: 'year' })], { baseline: null, counterfactual: null })
    const pod = year.metrics.pointOfDivergence!
    expect(formatDivergenceDate(pod, null)).toBe('1871')
    expect(pod.description).toBe('First new counterfactual event: "Treaty" (1871)')

    const month = analyzeEventDivergence([given('Siege', '1871-03-01T00:00:00.000Z', { precision: 'month' })], [], { baseline: null, counterfactual: null })
    expect(formatDivergenceDate(month.metrics.pointOfDivergence!, null)).toBe('Mar 1871')
    expect(month.metrics.pointOfDivergence!.description).toBe('Prevented/omitted event: "Siege" (Mar 1871)')

    // A day is still a day.
    const day = analyzeEventDivergence([], [event('Coup', '1871-03-18T00:00:00.000Z')], { baseline: null, counterfactual: null })
    expect(formatDivergenceDate(day.metrics.pointOfDivergence!, null)).toBe('Mar 18, 1871')
  })

  it("shows a world's year as given, in the calendar it was given in", () => {
    const calendarId = AR.calendars[0]!.id
    const start = positionOf(calendarIn(AR), { year: 845, part: 0, day: 1, hour: 0, minute: 0, second: 0 })!
    const timestamp = isoOfAxisTime(start)
    const added = analyzeEventDivergence([], [given('Accord', timestamp, { precision: 'year', calendar: calendarId })], { baseline: null, counterfactual: AR })
    const pod = added.metrics.pointOfDivergence!
    expect(formatDivergenceDate(pod, AR)).toBe('845 AR')
    expect(pod.description).toBe('First new counterfactual event: "Accord" (845 AR)')
  })

  it('finds the earliest of two divergences a second apart near 200 million years BCE', () => {
    // A double has no whole seconds there: getTime() calls these the same moment.
    const later = event('later', '-200000000-01-01T00:00:00.500Z')
    const earlier = event('earlier', '-200000001-12-31T23:59:59.500Z')
    expect(toInstant(later.timestamp).getTime()).toBe(toInstant(earlier.timestamp).getTime())
    const { metrics } = analyzeEventDivergence([], [later, earlier], { baseline: null, counterfactual: null })
    expect(metrics.pointOfDivergence?.event?.id).toBe('earlier')
  })
})
