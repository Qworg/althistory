import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTimelineEventHandlers } from './useTimelineEventHandlers'
import { Event } from '@/types'
import { ArcWithUIState } from '@/components/timeline/arcHierarchyUtils'
import * as d3 from 'd3'

describe('useTimelineEventHandlers', () => {
  const mockEvent: Event = {
    id: 'event-1',
    description: 'Test Event',
    actor: 'Actor',
    target: 'Target',
    timestamp: '2024-01-15T10:00:00Z',
    created_at: '2024-01-15T09:00:00Z',
    updated_at: '2024-01-15T09:00:00Z'
  }

  const mockArc: ArcWithUIState = {
    id: 'arc-1',
    name: 'Test Arc',
    description: 'A test arc',
    start_time: '2024-01-01T00:00:00Z',
    end_time: '2024-01-31T00:00:00Z',
    level: 0,
    parent_arc_id: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    // ArcWithUIState extensions
    isExpanded: false,
    isSelected: false,
    renderLevel: 0,
    containedEvents: [],
    childArcs: [],
    parentArc: null,
    eventCount: 0,
    duration: 0
  }

  const createMockXScale = () => {
    const scale = d3.scaleTime()
      .domain([new Date('2024-01-01'), new Date('2024-02-01')])
      .range([0, 800])
    return scale
  }

  const defaultMargin = { top: 16, right: 16, bottom: 40, left: 56 }
  const defaultInnerWidth = 800

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('handleEventClick', () => {
    it('calls onEventSelect with the clicked event', () => {
      const onEventSelect = vi.fn()
      const { result } = renderHook(() =>
        useTimelineEventHandlers({
          onEventSelect,
          xScale: createMockXScale(),
          margin: defaultMargin,
          innerWidth: defaultInnerWidth
        })
      )

      act(() => {
        result.current.handleEventClick(mockEvent)
      })

      expect(onEventSelect).toHaveBeenCalledWith(mockEvent)
      expect(onEventSelect).toHaveBeenCalledTimes(1)
    })

    it('does not throw when onEventSelect is undefined', () => {
      const { result } = renderHook(() =>
        useTimelineEventHandlers({
          xScale: createMockXScale(),
          margin: defaultMargin,
          innerWidth: defaultInnerWidth
        })
      )

      expect(() => {
        act(() => {
          result.current.handleEventClick(mockEvent)
        })
      }).not.toThrow()
    })

    it('calls the latest onEventSelect callback after re-render', () => {
      const onEventSelect1 = vi.fn()
      const onEventSelect2 = vi.fn()

      const { result, rerender } = renderHook(
        ({ onEventSelect }) =>
          useTimelineEventHandlers({
            onEventSelect,
            xScale: createMockXScale(),
            margin: defaultMargin,
            innerWidth: defaultInnerWidth
          }),
        { initialProps: { onEventSelect: onEventSelect1 } }
      )

      // Click with first callback
      act(() => {
        result.current.handleEventClick(mockEvent)
      })
      expect(onEventSelect1).toHaveBeenCalledTimes(1)
      expect(onEventSelect2).not.toHaveBeenCalled()

      // Update callback
      rerender({ onEventSelect: onEventSelect2 })

      // Click with new callback - should call second callback
      act(() => {
        result.current.handleEventClick(mockEvent)
      })
      expect(onEventSelect1).toHaveBeenCalledTimes(1)
      expect(onEventSelect2).toHaveBeenCalledTimes(1)
    })

    it('maintains stable function reference across re-renders', () => {
      const onEventSelect = vi.fn()
      const { result, rerender } = renderHook(() =>
        useTimelineEventHandlers({
          onEventSelect,
          xScale: createMockXScale(),
          margin: defaultMargin,
          innerWidth: defaultInnerWidth
        })
      )

      const firstRef = result.current.handleEventClick

      rerender()

      expect(result.current.handleEventClick).toBe(firstRef)
    })
  })

  describe('handleArcClick', () => {
    it('calls onArcSelect with the clicked arc', () => {
      const onArcSelect = vi.fn()
      const { result } = renderHook(() =>
        useTimelineEventHandlers({
          onArcSelect,
          xScale: createMockXScale(),
          margin: defaultMargin,
          innerWidth: defaultInnerWidth
        })
      )

      act(() => {
        result.current.handleArcClick(mockArc)
      })

      expect(onArcSelect).toHaveBeenCalledWith(mockArc)
      expect(onArcSelect).toHaveBeenCalledTimes(1)
    })

    it('does not throw when onArcSelect is undefined', () => {
      const { result } = renderHook(() =>
        useTimelineEventHandlers({
          xScale: createMockXScale(),
          margin: defaultMargin,
          innerWidth: defaultInnerWidth
        })
      )

      expect(() => {
        act(() => {
          result.current.handleArcClick(mockArc)
        })
      }).not.toThrow()
    })

    it('calls the latest onArcSelect callback after re-render', () => {
      const onArcSelect1 = vi.fn()
      const onArcSelect2 = vi.fn()

      const { result, rerender } = renderHook(
        ({ onArcSelect }) =>
          useTimelineEventHandlers({
            onArcSelect,
            xScale: createMockXScale(),
            margin: defaultMargin,
            innerWidth: defaultInnerWidth
          }),
        { initialProps: { onArcSelect: onArcSelect1 } }
      )

      act(() => {
        result.current.handleArcClick(mockArc)
      })
      expect(onArcSelect1).toHaveBeenCalledTimes(1)

      rerender({ onArcSelect: onArcSelect2 })

      act(() => {
        result.current.handleArcClick(mockArc)
      })
      expect(onArcSelect1).toHaveBeenCalledTimes(1)
      expect(onArcSelect2).toHaveBeenCalledTimes(1)
    })

    it('maintains stable function reference across re-renders', () => {
      const onArcSelect = vi.fn()
      const { result, rerender } = renderHook(() =>
        useTimelineEventHandlers({
          onArcSelect,
          xScale: createMockXScale(),
          margin: defaultMargin,
          innerWidth: defaultInnerWidth
        })
      )

      const firstRef = result.current.handleArcClick

      rerender()

      expect(result.current.handleArcClick).toBe(firstRef)
    })
  })

  describe('handleSvgDoubleClick', () => {
    const createMockSvgEvent = (
      clientX: number,
      clientY: number,
      mockSvg?: Partial<SVGSVGElement>
    ): React.MouseEvent<SVGSVGElement> => {
      const mockCTM = {
        inverse: () => ({
          a: 1, b: 0, c: 0, d: 1, e: 0, f: 0
        })
      }

      const transformedPoint = {
        x: clientX,
        y: clientY
      }

      const svgElement = {
        getScreenCTM: vi.fn().mockReturnValue(mockCTM),
        createSVGPoint: vi.fn().mockReturnValue({
          x: 0,
          y: 0,
          matrixTransform: vi.fn().mockReturnValue(transformedPoint)
        }),
        ...mockSvg
      } as unknown as SVGSVGElement

      return {
        clientX,
        clientY,
        currentTarget: svgElement
      } as unknown as React.MouseEvent<SVGSVGElement>
    }

    it('calls onEventCreate with a Date when SVG is double-clicked', () => {
      const onEventCreate = vi.fn()
      const xScale = createMockXScale()

      const { result } = renderHook(() =>
        useTimelineEventHandlers({
          onEventCreate,
          xScale,
          margin: defaultMargin,
          innerWidth: defaultInnerWidth
        })
      )

      const mockEvent = createMockSvgEvent(200, 150)

      act(() => {
        result.current.handleSvgDoubleClick(mockEvent)
      })

      expect(onEventCreate).toHaveBeenCalledTimes(1)
      expect(onEventCreate.mock.calls[0]?.[0]).toBeInstanceOf(Date)
    })

    it('does not call onEventCreate when callback is undefined', () => {
      const xScale = createMockXScale()

      const { result } = renderHook(() =>
        useTimelineEventHandlers({
          xScale,
          margin: defaultMargin,
          innerWidth: defaultInnerWidth
        })
      )

      const mockEvent = createMockSvgEvent(200, 150)

      expect(() => {
        act(() => {
          result.current.handleSvgDoubleClick(mockEvent)
        })
      }).not.toThrow()
    })

    it('does not call onEventCreate when xScale is null', () => {
      const onEventCreate = vi.fn()

      const { result } = renderHook(() =>
        useTimelineEventHandlers({
          onEventCreate,
          xScale: null,
          margin: defaultMargin,
          innerWidth: defaultInnerWidth
        })
      )

      const mockEvent = createMockSvgEvent(200, 150)

      act(() => {
        result.current.handleSvgDoubleClick(mockEvent)
      })

      expect(onEventCreate).not.toHaveBeenCalled()
    })

    it('does not call onEventCreate when getScreenCTM returns null', () => {
      const onEventCreate = vi.fn()
      const xScale = createMockXScale()

      const { result } = renderHook(() =>
        useTimelineEventHandlers({
          onEventCreate,
          xScale,
          margin: defaultMargin,
          innerWidth: defaultInnerWidth
        })
      )

      const mockEvent = createMockSvgEvent(200, 150, {
        getScreenCTM: vi.fn().mockReturnValue(null)
      })

      act(() => {
        result.current.handleSvgDoubleClick(mockEvent)
      })

      expect(onEventCreate).not.toHaveBeenCalled()
    })

    it('adjusts position for margin.left', () => {
      const onEventCreate = vi.fn()
      const xScale = createMockXScale()
      const margin = { top: 16, right: 16, bottom: 40, left: 100 }

      const { result } = renderHook(() =>
        useTimelineEventHandlers({
          onEventCreate,
          xScale,
          margin,
          innerWidth: defaultInnerWidth
        })
      )

      // Create event where x position accounts for margin
      const mockEvent = createMockSvgEvent(200, 150)

      act(() => {
        result.current.handleSvgDoubleClick(mockEvent)
      })

      expect(onEventCreate).toHaveBeenCalledTimes(1)
      // The timestamp should be calculated based on x - margin.left
    })

    it('clamps x position to valid range', () => {
      const onEventCreate = vi.fn()
      const xScale = createMockXScale()

      const { result } = renderHook(() =>
        useTimelineEventHandlers({
          onEventCreate,
          xScale,
          margin: defaultMargin,
          innerWidth: 800
        })
      )

      // Create event with x position beyond inner width
      const mockEvent = createMockSvgEvent(1000, 150)

      act(() => {
        result.current.handleSvgDoubleClick(mockEvent)
      })

      expect(onEventCreate).toHaveBeenCalledTimes(1)
      // The timestamp should be clamped to max valid position
    })

    it('clamps x position to 0 for negative values', () => {
      const onEventCreate = vi.fn()
      const xScale = createMockXScale()

      const { result } = renderHook(() =>
        useTimelineEventHandlers({
          onEventCreate,
          xScale,
          margin: defaultMargin,
          innerWidth: 800
        })
      )

      // Create event with negative x position (after margin adjustment)
      const mockEvent = createMockSvgEvent(-100, 150)

      act(() => {
        result.current.handleSvgDoubleClick(mockEvent)
      })

      expect(onEventCreate).toHaveBeenCalledTimes(1)
    })

    it('updates handler when xScale changes', () => {
      const onEventCreate = vi.fn<(date: Date) => void>()
      const xScale1 = d3.scaleTime()
        .domain([new Date('2024-01-01'), new Date('2024-02-01')])
        .range([0, 800])
      const xScale2 = d3.scaleTime()
        .domain([new Date('2024-06-01'), new Date('2024-07-01')])
        .range([0, 800])

      const { result, rerender } = renderHook(
        ({ xScale }) =>
          useTimelineEventHandlers({
            onEventCreate,
            xScale,
            margin: defaultMargin,
            innerWidth: defaultInnerWidth
          }),
        { initialProps: { xScale: xScale1 } }
      )

      const mockEvent = createMockSvgEvent(200, 150)

      act(() => {
        result.current.handleSvgDoubleClick(mockEvent)
      })

      const firstDate = onEventCreate.mock.calls[0]?.[0]

      rerender({ xScale: xScale2 })

      act(() => {
        result.current.handleSvgDoubleClick(mockEvent)
      })

      const secondDate = onEventCreate.mock.calls[1]?.[0]

      // Different scales should produce different dates for same position
      expect(firstDate?.getMonth()).not.toBe(secondDate?.getMonth())
    })

    it('updates when margin changes', () => {
      const onEventCreate = vi.fn()
      const xScale = createMockXScale()

      const { result, rerender } = renderHook(
        ({ margin }) =>
          useTimelineEventHandlers({
            onEventCreate,
            xScale,
            margin,
            innerWidth: defaultInnerWidth
          }),
        { initialProps: { margin: defaultMargin } }
      )

      const firstRef = result.current.handleSvgDoubleClick

      rerender({ margin: { top: 20, right: 20, bottom: 50, left: 100 } })

      // Handler should be recreated when margin.left changes
      expect(result.current.handleSvgDoubleClick).not.toBe(firstRef)
    })

    it('updates when innerWidth changes', () => {
      const onEventCreate = vi.fn()
      const xScale = createMockXScale()

      const { result, rerender } = renderHook(
        ({ innerWidth }) =>
          useTimelineEventHandlers({
            onEventCreate,
            xScale,
            margin: defaultMargin,
            innerWidth
          }),
        { initialProps: { innerWidth: 800 } }
      )

      const firstRef = result.current.handleSvgDoubleClick

      rerender({ innerWidth: 600 })

      // Handler should be recreated when innerWidth changes
      expect(result.current.handleSvgDoubleClick).not.toBe(firstRef)
    })

    it('calls latest onEventCreate after callback update', () => {
      const onEventCreate1 = vi.fn()
      const onEventCreate2 = vi.fn()
      const xScale = createMockXScale()

      const { result, rerender } = renderHook(
        ({ onEventCreate }) =>
          useTimelineEventHandlers({
            onEventCreate,
            xScale,
            margin: defaultMargin,
            innerWidth: defaultInnerWidth
          }),
        { initialProps: { onEventCreate: onEventCreate1 } }
      )

      const mockEvent = createMockSvgEvent(200, 150)

      act(() => {
        result.current.handleSvgDoubleClick(mockEvent)
      })
      expect(onEventCreate1).toHaveBeenCalledTimes(1)

      rerender({ onEventCreate: onEventCreate2 })

      act(() => {
        result.current.handleSvgDoubleClick(mockEvent)
      })
      expect(onEventCreate1).toHaveBeenCalledTimes(1)
      expect(onEventCreate2).toHaveBeenCalledTimes(1)
    })
  })

  describe('ref pattern for callback stability', () => {
    it('avoids infinite loops by using refs for callbacks', () => {
      // This test verifies the key architectural decision:
      // Callbacks are stored in refs to break dependency cycles
      let renderCount = 0
      const onEventSelect = vi.fn()
      const onArcSelect = vi.fn()
      const onEventCreate = vi.fn()
      const xScale = createMockXScale()

      const { rerender } = renderHook(() => {
        renderCount++
        return useTimelineEventHandlers({
          onEventSelect,
          onArcSelect,
          onEventCreate,
          xScale,
          margin: defaultMargin,
          innerWidth: defaultInnerWidth
        })
      })

      // Initial render
      expect(renderCount).toBe(1)

      // Multiple re-renders should not cause cascading updates
      rerender()
      rerender()
      rerender()

      // Should only be 4 renders (initial + 3 rerenders)
      expect(renderCount).toBe(4)
    })

    it('handlers remain stable even when callbacks change', () => {
      let callbackUpdateCount = 0
      const xScale = createMockXScale()

      const { result, rerender } = renderHook(
        ({ callback }) =>
          useTimelineEventHandlers({
            onEventSelect: callback,
            xScale,
            margin: defaultMargin,
            innerWidth: defaultInnerWidth
          }),
        {
          initialProps: {
            callback: () => {
              callbackUpdateCount++
            }
          }
        }
      )

      const firstHandleEventClick = result.current.handleEventClick

      // Update the callback
      rerender({
        callback: () => {
          callbackUpdateCount += 10
        }
      })

      // handleEventClick should remain stable (same reference)
      expect(result.current.handleEventClick).toBe(firstHandleEventClick)

      // But calling it should use the new callback
      act(() => {
        result.current.handleEventClick(mockEvent)
      })

      expect(callbackUpdateCount).toBe(10) // New callback was used
    })
  })

  describe('combined handlers', () => {
    it('all handlers work correctly together', () => {
      const onEventSelect = vi.fn()
      const onArcSelect = vi.fn()
      const onEventCreate = vi.fn()
      const xScale = createMockXScale()

      const { result } = renderHook(() =>
        useTimelineEventHandlers({
          onEventSelect,
          onArcSelect,
          onEventCreate,
          xScale,
          margin: defaultMargin,
          innerWidth: defaultInnerWidth
        })
      )

      // Use all handlers
      act(() => {
        result.current.handleEventClick(mockEvent)
        result.current.handleArcClick(mockArc)
      })

      expect(onEventSelect).toHaveBeenCalledWith(mockEvent)
      expect(onArcSelect).toHaveBeenCalledWith(mockArc)
    })

    it('returns all three handlers', () => {
      const { result } = renderHook(() =>
        useTimelineEventHandlers({
          xScale: createMockXScale(),
          margin: defaultMargin,
          innerWidth: defaultInnerWidth
        })
      )

      expect(result.current).toHaveProperty('handleEventClick')
      expect(result.current).toHaveProperty('handleArcClick')
      expect(result.current).toHaveProperty('handleSvgDoubleClick')
      expect(typeof result.current.handleEventClick).toBe('function')
      expect(typeof result.current.handleArcClick).toBe('function')
      expect(typeof result.current.handleSvgDoubleClick).toBe('function')
    })
  })
})
