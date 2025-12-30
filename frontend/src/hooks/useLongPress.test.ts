import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLongPress } from './useLongPress'

describe('useLongPress', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  describe('Long Press Detection', () => {
    it('triggers onLongPress after default delay (500ms)', () => {
      const onLongPress = vi.fn()
      const { result } = renderHook(() => useLongPress(onLongPress))

      const touchEvent = {
        touches: [{ clientX: 100, clientY: 200 }]
      } as unknown as React.TouchEvent

      act(() => {
        result.current.onTouchStart(touchEvent)
      })

      // Should not trigger before 500ms
      act(() => {
        vi.advanceTimersByTime(499)
      })
      expect(onLongPress).not.toHaveBeenCalled()

      // Should trigger at 500ms
      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect(onLongPress).toHaveBeenCalledTimes(1)
      expect(onLongPress).toHaveBeenCalledWith({ x: 100, y: 200 })
    })

    it('triggers onLongPress after custom delay', () => {
      const onLongPress = vi.fn()
      const { result } = renderHook(() => useLongPress(onLongPress, { delay: 1000 }))

      const touchEvent = {
        touches: [{ clientX: 50, clientY: 75 }]
      } as unknown as React.TouchEvent

      act(() => {
        result.current.onTouchStart(touchEvent)
      })

      // Should not trigger before 1000ms
      act(() => {
        vi.advanceTimersByTime(999)
      })
      expect(onLongPress).not.toHaveBeenCalled()

      // Should trigger at 1000ms
      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect(onLongPress).toHaveBeenCalledTimes(1)
      expect(onLongPress).toHaveBeenCalledWith({ x: 50, y: 75 })
    })

    it('passes correct position to onLongPress', () => {
      const onLongPress = vi.fn()
      const { result } = renderHook(() => useLongPress(onLongPress))

      const touchEvent = {
        touches: [{ clientX: 250, clientY: 350 }]
      } as unknown as React.TouchEvent

      act(() => {
        result.current.onTouchStart(touchEvent)
        vi.advanceTimersByTime(500)
      })

      expect(onLongPress).toHaveBeenCalledWith({ x: 250, y: 350 })
    })
  })

  describe('Touch End', () => {
    it('cancels long press when touch ends before delay', () => {
      const onLongPress = vi.fn()
      const { result } = renderHook(() => useLongPress(onLongPress))

      const touchEvent = {
        touches: [{ clientX: 100, clientY: 200 }]
      } as unknown as React.TouchEvent

      act(() => {
        result.current.onTouchStart(touchEvent)
      })

      // End touch before delay completes
      act(() => {
        vi.advanceTimersByTime(300)
        result.current.onTouchEnd()
      })

      // Advance past the delay
      act(() => {
        vi.advanceTimersByTime(500)
      })

      expect(onLongPress).not.toHaveBeenCalled()
    })
  })

  describe('Touch Move', () => {
    it('cancels long press when finger moves (scroll detection)', () => {
      const onLongPress = vi.fn()
      const { result } = renderHook(() => useLongPress(onLongPress))

      const touchEvent = {
        touches: [{ clientX: 100, clientY: 200 }]
      } as unknown as React.TouchEvent

      act(() => {
        result.current.onTouchStart(touchEvent)
      })

      // Move finger (simulates scrolling)
      act(() => {
        vi.advanceTimersByTime(200)
        result.current.onTouchMove()
      })

      // Advance past the delay
      act(() => {
        vi.advanceTimersByTime(500)
      })

      expect(onLongPress).not.toHaveBeenCalled()
    })
  })

  describe('Context Menu (Right-Click)', () => {
    it('triggers onLongPress on right-click by default', () => {
      const onLongPress = vi.fn()
      const { result } = renderHook(() => useLongPress(onLongPress))

      const mouseEvent = {
        clientX: 150,
        clientY: 250,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn()
      } as unknown as React.MouseEvent

      act(() => {
        result.current.onContextMenu(mouseEvent)
      })

      expect(mouseEvent.preventDefault).toHaveBeenCalled()
      expect(mouseEvent.stopPropagation).toHaveBeenCalled()
      expect(onLongPress).toHaveBeenCalledWith({ x: 150, y: 250 })
    })

    it('uses custom onContextMenu handler when provided', () => {
      const onLongPress = vi.fn()
      const onContextMenu = vi.fn()
      const { result } = renderHook(() =>
        useLongPress(onLongPress, { onContextMenu })
      )

      const mouseEvent = {
        clientX: 150,
        clientY: 250,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn()
      } as unknown as React.MouseEvent

      act(() => {
        result.current.onContextMenu(mouseEvent)
      })

      expect(onContextMenu).toHaveBeenCalledWith(mouseEvent)
      expect(onLongPress).not.toHaveBeenCalled()
    })

    it('prevents default browser context menu', () => {
      const onLongPress = vi.fn()
      const { result } = renderHook(() => useLongPress(onLongPress))

      const mouseEvent = {
        clientX: 100,
        clientY: 200,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn()
      } as unknown as React.MouseEvent

      act(() => {
        result.current.onContextMenu(mouseEvent)
      })

      expect(mouseEvent.preventDefault).toHaveBeenCalled()
    })
  })

  describe('Multiple Touch Sequences', () => {
    it('handles multiple touch sequences correctly', () => {
      const onLongPress = vi.fn()
      const { result } = renderHook(() => useLongPress(onLongPress))

      // First touch - cancel early
      const touchEvent1 = {
        touches: [{ clientX: 100, clientY: 200 }]
      } as unknown as React.TouchEvent

      act(() => {
        result.current.onTouchStart(touchEvent1)
        vi.advanceTimersByTime(200)
        result.current.onTouchEnd()
      })

      expect(onLongPress).not.toHaveBeenCalled()

      // Second touch - complete long press
      const touchEvent2 = {
        touches: [{ clientX: 300, clientY: 400 }]
      } as unknown as React.TouchEvent

      act(() => {
        result.current.onTouchStart(touchEvent2)
        vi.advanceTimersByTime(500)
      })

      expect(onLongPress).toHaveBeenCalledTimes(1)
      expect(onLongPress).toHaveBeenCalledWith({ x: 300, y: 400 })
    })

    it('resets state after each touch sequence', () => {
      const onLongPress = vi.fn()
      const { result } = renderHook(() => useLongPress(onLongPress))

      // Complete first long press
      const touchEvent1 = {
        touches: [{ clientX: 100, clientY: 200 }]
      } as unknown as React.TouchEvent

      act(() => {
        result.current.onTouchStart(touchEvent1)
        vi.advanceTimersByTime(500)
        result.current.onTouchEnd()
      })

      expect(onLongPress).toHaveBeenCalledTimes(1)

      // Complete second long press
      const touchEvent2 = {
        touches: [{ clientX: 150, clientY: 250 }]
      } as unknown as React.TouchEvent

      act(() => {
        result.current.onTouchStart(touchEvent2)
        vi.advanceTimersByTime(500)
      })

      expect(onLongPress).toHaveBeenCalledTimes(2)
      expect(onLongPress).toHaveBeenLastCalledWith({ x: 150, y: 250 })
    })
  })

  describe('Edge Cases', () => {
    it('handles empty touches array gracefully', () => {
      const onLongPress = vi.fn()
      const { result } = renderHook(() => useLongPress(onLongPress))

      const touchEvent = {
        touches: []
      } as unknown as React.TouchEvent

      // Should not throw
      act(() => {
        result.current.onTouchStart(touchEvent)
        vi.advanceTimersByTime(500)
      })

      expect(onLongPress).not.toHaveBeenCalled()
    })

    it('handles rapid touch start/end cycles', () => {
      const onLongPress = vi.fn()
      const { result } = renderHook(() => useLongPress(onLongPress))

      const touchEvent = {
        touches: [{ clientX: 100, clientY: 200 }]
      } as unknown as React.TouchEvent

      // Rapid tapping
      for (let i = 0; i < 5; i++) {
        act(() => {
          result.current.onTouchStart(touchEvent)
          vi.advanceTimersByTime(100)
          result.current.onTouchEnd()
        })
      }

      expect(onLongPress).not.toHaveBeenCalled()
    })

    it('clears timer on touch move without throwing', () => {
      const onLongPress = vi.fn()
      const { result } = renderHook(() => useLongPress(onLongPress))

      // Call touch move without prior touch start
      act(() => {
        result.current.onTouchMove()
      })

      // Should not throw
      expect(onLongPress).not.toHaveBeenCalled()
    })

    it('clears timer on touch end without prior touch start', () => {
      const onLongPress = vi.fn()
      const { result } = renderHook(() => useLongPress(onLongPress))

      // Call touch end without prior touch start
      act(() => {
        result.current.onTouchEnd()
      })

      // Should not throw
      expect(onLongPress).not.toHaveBeenCalled()
    })
  })

  describe('Return Value Structure', () => {
    it('returns all expected handlers', () => {
      const onLongPress = vi.fn()
      const { result } = renderHook(() => useLongPress(onLongPress))

      expect(result.current).toHaveProperty('onTouchStart')
      expect(result.current).toHaveProperty('onTouchEnd')
      expect(result.current).toHaveProperty('onTouchMove')
      expect(result.current).toHaveProperty('onContextMenu')
      expect(typeof result.current.onTouchStart).toBe('function')
      expect(typeof result.current.onTouchEnd).toBe('function')
      expect(typeof result.current.onTouchMove).toBe('function')
      expect(typeof result.current.onContextMenu).toBe('function')
    })

    it('maintains stable handler references between renders', () => {
      const onLongPress = vi.fn()
      const { result, rerender } = renderHook(() => useLongPress(onLongPress))

      const firstHandlers = { ...result.current }

      rerender()

      // Handlers should be stable (same reference) due to useCallback
      expect(result.current.onTouchEnd).toBe(firstHandlers.onTouchEnd)
      expect(result.current.onTouchMove).toBe(firstHandlers.onTouchMove)
    })
  })
})
