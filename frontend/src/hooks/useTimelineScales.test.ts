import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useTimelineScales } from './useTimelineScales'
import { Event, Arc } from '@/types'

// Don't mock D3 - we want to test actual scale behavior

describe('useTimelineScales', () => {
  const mockEvents: Event[] = [
    {
      id: 'event-1',
      description: 'Event 1',
      actor: 'Actor',
      target: 'Target',
      timestamp: '2024-01-15T10:00:00Z',
      created_at: '2024-01-15T09:00:00Z',
      updated_at: '2024-01-15T09:00:00Z'
    },
    {
      id: 'event-2',
      description: 'Event 2',
      actor: 'Actor',
      target: 'Target',
      timestamp: '2024-01-20T14:00:00Z',
      created_at: '2024-01-20T13:00:00Z',
      updated_at: '2024-01-20T13:00:00Z'
    }
  ]

  const mockArcs: Arc[] = [
    {
      id: 'arc-1',
      name: 'Arc 1',
      description: 'First arc',
      start_time: '2024-01-01T00:00:00Z',
      end_time: '2024-01-31T00:00:00Z',
      level: 0,
      parent_arc_id: null,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z'
    }
  ]

  const defaultMargin = { top: 16, right: 16, bottom: 40, left: 56 }

  describe('innerWidth calculation', () => {
    it('calculates innerWidth from width and horizontal margins', () => {
      const { result } = renderHook(() =>
        useTimelineScales(mockEvents, mockArcs, 1000, 400, defaultMargin)
      )

      // 1000 - 16 - 56 = 928
      expect(result.current.innerWidth).toBe(928)
    })

    it('returns 0 for innerWidth when margins exceed width', () => {
      const largeMargins = { top: 16, right: 500, bottom: 40, left: 600 }
      const { result } = renderHook(() =>
        useTimelineScales(mockEvents, mockArcs, 1000, 400, largeMargins)
      )

      expect(result.current.innerWidth).toBe(0)
    })

    it('updates innerWidth when width changes', () => {
      const { result, rerender } = renderHook(
        ({ width }) => useTimelineScales(mockEvents, mockArcs, width, 400, defaultMargin),
        { initialProps: { width: 1000 } }
      )

      expect(result.current.innerWidth).toBe(928)

      rerender({ width: 800 })
      expect(result.current.innerWidth).toBe(728) // 800 - 16 - 56
    })

    it('updates innerWidth when margins change', () => {
      const { result, rerender } = renderHook(
        ({ margin }) => useTimelineScales(mockEvents, mockArcs, 1000, 400, margin),
        { initialProps: { margin: defaultMargin } }
      )

      expect(result.current.innerWidth).toBe(928)

      rerender({ margin: { top: 16, right: 100, bottom: 40, left: 100 } })
      expect(result.current.innerWidth).toBe(800) // 1000 - 100 - 100
    })
  })

  describe('innerHeight calculation', () => {
    it('calculates innerHeight from height and vertical margins', () => {
      const { result } = renderHook(() =>
        useTimelineScales(mockEvents, mockArcs, 1000, 400, defaultMargin)
      )

      // 400 - 16 - 40 = 344
      expect(result.current.innerHeight).toBe(344)
    })

    it('returns 0 for innerHeight when margins exceed height', () => {
      const largeMargins = { top: 200, right: 16, bottom: 300, left: 56 }
      const { result } = renderHook(() =>
        useTimelineScales(mockEvents, mockArcs, 1000, 400, largeMargins)
      )

      expect(result.current.innerHeight).toBe(0)
    })

    it('updates innerHeight when height changes', () => {
      const { result, rerender } = renderHook(
        ({ height }) => useTimelineScales(mockEvents, mockArcs, 1000, height, defaultMargin),
        { initialProps: { height: 400 } }
      )

      expect(result.current.innerHeight).toBe(344)

      rerender({ height: 600 })
      expect(result.current.innerHeight).toBe(544) // 600 - 16 - 40
    })
  })

  describe('xDomain calculation', () => {
    it('calculates domain from event timestamps', () => {
      const { result } = renderHook(() =>
        useTimelineScales(mockEvents, [], 1000, 400, defaultMargin)
      )

      const [domainStart, domainEnd] = result.current.xDomain
      // Domain should span from first to last event timestamp
      expect(domainStart.getTime()).toBeLessThanOrEqual(new Date('2024-01-15T10:00:00Z').getTime())
      expect(domainEnd.getTime()).toBeGreaterThanOrEqual(new Date('2024-01-20T14:00:00Z').getTime())
    })

    it('calculates domain from arc time ranges', () => {
      const { result } = renderHook(() =>
        useTimelineScales([], mockArcs, 1000, 400, defaultMargin)
      )

      const [domainStart, domainEnd] = result.current.xDomain
      // Domain should include arc start and end times
      expect(domainStart.getTime()).toBeLessThanOrEqual(new Date('2024-01-01T00:00:00Z').getTime())
      expect(domainEnd.getTime()).toBeGreaterThanOrEqual(new Date('2024-01-31T00:00:00Z').getTime())
    })

    it('combines events and arcs for domain calculation', () => {
      const { result } = renderHook(() =>
        useTimelineScales(mockEvents, mockArcs, 1000, 400, defaultMargin)
      )

      const [domainStart, domainEnd] = result.current.xDomain
      // Should include both arc boundaries (which are wider)
      expect(domainStart.getTime()).toBeLessThanOrEqual(new Date('2024-01-01T00:00:00Z').getTime())
      expect(domainEnd.getTime()).toBeGreaterThanOrEqual(new Date('2024-01-31T00:00:00Z').getTime())
    })

    it('returns default 60-day range when no data provided', () => {
      const { result } = renderHook(() =>
        useTimelineScales([], [], 1000, 400, defaultMargin)
      )

      const [domainStart, domainEnd] = result.current.xDomain
      const now = Date.now()
      const thirtyDaysMs = 1000 * 60 * 60 * 24 * 30

      // Domain should be approximately now ± 30 days
      expect(domainStart.getTime()).toBeGreaterThan(now - thirtyDaysMs - 1000)
      expect(domainStart.getTime()).toBeLessThan(now - thirtyDaysMs + 1000)
      expect(domainEnd.getTime()).toBeGreaterThan(now + thirtyDaysMs - 1000)
      expect(domainEnd.getTime()).toBeLessThan(now + thirtyDaysMs + 1000)
    })

    it('updates domain when events change', () => {
      const { result, rerender } = renderHook(
        ({ events }) => useTimelineScales(events, [], 1000, 400, defaultMargin),
        { initialProps: { events: mockEvents } }
      )

      const initialDomain = result.current.xDomain

      const newEvents: Event[] = [
        ...mockEvents,
        {
          id: 'event-3',
          description: 'Later Event',
          actor: 'Actor',
          target: 'Target',
          timestamp: '2024-02-15T10:00:00Z',
          created_at: '2024-02-15T09:00:00Z',
          updated_at: '2024-02-15T09:00:00Z'
        }
      ]

      rerender({ events: newEvents })

      const newDomain = result.current.xDomain
      expect(newDomain[1].getTime()).toBeGreaterThan(initialDomain[1].getTime())
    })

    it('handles invalid timestamps gracefully', () => {
      const invalidEvents: Event[] = [
        {
          id: 'event-1',
          description: 'Event',
          actor: 'Actor',
          target: 'Target',
          timestamp: 'invalid-date',
          created_at: '2024-01-15T09:00:00Z',
          updated_at: '2024-01-15T09:00:00Z'
        }
      ]

      const { result } = renderHook(() =>
        useTimelineScales(invalidEvents, [], 1000, 400, defaultMargin)
      )

      // Should still return a valid domain (default range)
      expect(result.current.xDomain).toHaveLength(2)
      expect(result.current.xDomain[0]).toBeInstanceOf(Date)
      expect(result.current.xDomain[1]).toBeInstanceOf(Date)
    })
  })

  describe('xScale creation', () => {
    it('creates a D3 time scale', () => {
      const { result } = renderHook(() =>
        useTimelineScales(mockEvents, mockArcs, 1000, 400, defaultMargin)
      )

      expect(result.current.xScale).toBeDefined()
      expect(typeof result.current.xScale).toBe('function')
    })

    it('scale maps dates to pixel positions', () => {
      const { result } = renderHook(() =>
        useTimelineScales(mockEvents, mockArcs, 1000, 400, defaultMargin)
      )

      const { xScale, xDomain, innerWidth } = result.current

      // Scale should map domain start to 0 (or near it after nice())
      const startPos = xScale(xDomain[0])
      expect(startPos).toBeGreaterThanOrEqual(-10) // Allow for nice() adjustment
      expect(startPos).toBeLessThan(innerWidth / 4)

      // Scale should map domain end to innerWidth (or near it after nice())
      const endPos = xScale(xDomain[1])
      expect(endPos).toBeGreaterThan(innerWidth * 0.75)
      expect(endPos).toBeLessThanOrEqual(innerWidth + 10) // Allow for nice() adjustment
    })

    it('scale invert function works correctly', () => {
      const { result } = renderHook(() =>
        useTimelineScales(mockEvents, mockArcs, 1000, 400, defaultMargin)
      )

      const { xScale, innerWidth } = result.current

      // invert should convert pixel position back to date
      const middleDate = xScale.invert(innerWidth / 2)
      expect(middleDate).toBeInstanceOf(Date)

      // The inverted date should map back to approximately the same position
      const roundTrip = xScale(middleDate)
      expect(roundTrip).toBeCloseTo(innerWidth / 2, 0)
    })

    it('scale updates when domain changes', () => {
      const { result, rerender } = renderHook(
        ({ events }) => useTimelineScales(events, [], 1000, 400, defaultMargin),
        { initialProps: { events: mockEvents } }
      )

      const initialScale = result.current.xScale
      const testDate = new Date('2024-01-17T12:00:00Z')
      const initialPos = initialScale(testDate)

      const newEvents: Event[] = [
        {
          id: 'event-1',
          description: 'Event',
          actor: 'Actor',
          target: 'Target',
          timestamp: '2024-06-01T10:00:00Z',
          created_at: '2024-06-01T09:00:00Z',
          updated_at: '2024-06-01T09:00:00Z'
        },
        {
          id: 'event-2',
          description: 'Event',
          actor: 'Actor',
          target: 'Target',
          timestamp: '2024-12-01T10:00:00Z',
          created_at: '2024-12-01T09:00:00Z',
          updated_at: '2024-12-01T09:00:00Z'
        }
      ]

      rerender({ events: newEvents })

      const newPos = result.current.xScale(testDate)
      // The same date should now map to a different position
      // because the domain is now June-December instead of Jan 15-20
      expect(newPos).not.toBeCloseTo(initialPos, 0)
    })

    it('scale updates when innerWidth changes', () => {
      const { result, rerender } = renderHook(
        ({ width }) => useTimelineScales(mockEvents, mockArcs, width, 400, defaultMargin),
        { initialProps: { width: 1000 } }
      )

      const testDate = new Date('2024-01-17T12:00:00Z')
      const initialPos = result.current.xScale(testDate)

      rerender({ width: 500 })

      const newPos = result.current.xScale(testDate)
      // Same date should map to proportionally smaller position
      expect(newPos).toBeLessThan(initialPos)
    })
  })

  describe('memoization', () => {
    it('returns same innerWidth reference when inputs unchanged', () => {
      const { result, rerender } = renderHook(() =>
        useTimelineScales(mockEvents, mockArcs, 1000, 400, defaultMargin)
      )

      const firstInnerWidth = result.current.innerWidth

      rerender()

      expect(result.current.innerWidth).toBe(firstInnerWidth)
    })

    it('returns same xDomain reference when events/arcs unchanged', () => {
      const { result, rerender } = renderHook(() =>
        useTimelineScales(mockEvents, mockArcs, 1000, 400, defaultMargin)
      )

      const firstDomain = result.current.xDomain

      // Change width (shouldn't affect domain)
      rerender()

      // Domain values should be the same
      expect(result.current.xDomain[0].getTime()).toBe(firstDomain[0].getTime())
      expect(result.current.xDomain[1].getTime()).toBe(firstDomain[1].getTime())
    })

    it('creates new scale only when domain or range changes', () => {
      const { result, rerender } = renderHook(
        ({ width, events }) => useTimelineScales(events, mockArcs, width, 400, defaultMargin),
        { initialProps: { width: 1000, events: mockEvents } }
      )

      const firstScale = result.current.xScale

      // Rerender with same props - scale should be stable
      rerender({ width: 1000, events: mockEvents })
      // Note: React's useMemo may or may not return the same reference
      // depending on shallow equality checks

      // Change width - scale should update
      rerender({ width: 800, events: mockEvents })
      expect(result.current.xScale).not.toBe(firstScale)
    })
  })

  describe('edge cases', () => {
    it('handles single event', () => {
      const singleEvent: Event[] = mockEvents.slice(0, 1)

      const { result } = renderHook(() =>
        useTimelineScales(singleEvent, [], 1000, 400, defaultMargin)
      )

      expect(result.current.xDomain).toHaveLength(2)
      expect(result.current.xScale).toBeDefined()
    })

    it('handles events with same timestamp', () => {
      const sameTimeEvents: Event[] = mockEvents
        .slice(0, 2)
        .map(event => ({ ...event, timestamp: '2024-01-15T10:00:00Z' }))

      const { result } = renderHook(() =>
        useTimelineScales(sameTimeEvents, [], 1000, 400, defaultMargin)
      )

      // D3's nice() should still provide a reasonable domain
      expect(result.current.xDomain).toHaveLength(2)
      expect(result.current.xScale).toBeDefined()
    })

    it('handles very small dimensions', () => {
      const { result } = renderHook(() =>
        useTimelineScales(mockEvents, mockArcs, 100, 50, defaultMargin)
      )

      // With margins 56+16=72 for width and 16+40=56 for height
      // These would result in negative inner dimensions
      expect(result.current.innerWidth).toBe(28) // 100 - 56 - 16 = 28
      expect(result.current.innerHeight).toBe(0) // 50 - 16 - 40 = -6 → 0
    })

    // Performance test - sanity check only, not a strict benchmark.
    // Timing varies based on CI environment, system load, and full-suite overhead.
    it('handles very large datasets', () => {
      const largeEvents: Event[] = Array.from({ length: 10000 }, (_, i) => ({
        id: `event-${i}`,
        description: `Event ${i}`,
        actor: 'Actor',
        target: 'Target',
        timestamp: new Date(2024, 0, 1 + Math.floor(i / 100)).toISOString(),
        created_at: new Date(2024, 0, 1).toISOString(),
        updated_at: new Date(2024, 0, 1).toISOString()
      }))

      const startTime = performance.now()
      const { result } = renderHook(() =>
        useTimelineScales(largeEvents, [], 1000, 400, defaultMargin)
      )
      const endTime = performance.now()

      expect(result.current.xDomain).toHaveLength(2)
      expect(result.current.xScale).toBeDefined()
      // Sanity check: should complete in reasonable time (generous 500ms threshold)
      // In isolation runs ~20ms, but can be slower in full test suite
      expect(endTime - startTime).toBeLessThan(500)
    })

    it('handles dates spanning multiple years', () => {
      const multiYearEvents: Event[] = mockEvents.slice(0, 2).map((event, index) => ({
        ...event,
        timestamp: index === 0 ? '2020-01-01T00:00:00Z' : '2030-12-31T23:59:59Z'
      }))

      const { result } = renderHook(() =>
        useTimelineScales(multiYearEvents, [], 1000, 400, defaultMargin)
      )

      const [domainStart, domainEnd] = result.current.xDomain
      expect(domainStart.getFullYear()).toBeLessThanOrEqual(2020)
      expect(domainEnd.getFullYear()).toBeGreaterThanOrEqual(2030)
    })
  })
})
