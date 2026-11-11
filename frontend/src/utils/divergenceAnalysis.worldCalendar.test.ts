import { afterEach, describe, expect, it } from 'vitest'
import { analyzeEventDivergence, comparisonCalendar, comparisonSide } from './divergenceAnalysis'
import { useWorldCalendarStore } from '@/stores/worldCalendarStore'
import type { Event, GraphCalendar } from '@/types'

const AR: GraphCalendar = { epochYear: 1000, eraLabel: 'AR' }
const NE: GraphCalendar = { epochYear: 1200, eraLabel: 'NE' }

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
    expect(comparisonCalendar('both')).toBe(AR)
    expect(comparisonCalendar('counterfactual', { baseline: null })).toBe(AR)
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
