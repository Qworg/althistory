import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDebounce } from './useDebounce'

describe('useDebounce', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns initial value immediately', () => {
    const { result } = renderHook(() => useDebounce('initial', 500))

    expect(result.current).toBe('initial')
  })

  it('debounces value changes', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      {
        initialProps: { value: 'initial', delay: 500 }
      }
    )

    expect(result.current).toBe('initial')

    // Change the value
    rerender({ value: 'updated', delay: 500 })

    // Value should not change immediately
    expect(result.current).toBe('initial')

    // Fast-forward time by less than delay
    act(() => {
      vi.advanceTimersByTime(300)
    })

    // Value should still be the old one
    expect(result.current).toBe('initial')

    // Fast-forward time to complete the delay
    act(() => {
      vi.advanceTimersByTime(200)
    })

    // Now the value should be updated
    expect(result.current).toBe('updated')
  })

  it('resets timer on rapid value changes', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      {
        initialProps: { value: 'initial', delay: 500 }
      }
    )

    // Change value multiple times rapidly
    rerender({ value: 'change1', delay: 500 })
    
    act(() => {
      vi.advanceTimersByTime(200)
    })
    
    rerender({ value: 'change2', delay: 500 })
    
    act(() => {
      vi.advanceTimersByTime(200)
    })
    
    rerender({ value: 'final', delay: 500 })

    // Value should still be initial because timer keeps resetting
    expect(result.current).toBe('initial')

    // Complete the full delay from the last change
    act(() => {
      vi.advanceTimersByTime(500)
    })

    // Now should have the final value
    expect(result.current).toBe('final')
  })

  it('works with different data types', () => {
    // Test with numbers
    const { result: numberResult, rerender: numberRerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      {
        initialProps: { value: 0, delay: 100 }
      }
    )

    numberRerender({ value: 42, delay: 100 })
    
    act(() => {
      vi.advanceTimersByTime(100)
    })

    expect(numberResult.current).toBe(42)

    // Test with objects
    const { result: objectResult, rerender: objectRerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      {
        initialProps: { value: { id: 1 }, delay: 100 }
      }
    )

    const newObject = { id: 2 }
    objectRerender({ value: newObject, delay: 100 })
    
    act(() => {
      vi.advanceTimersByTime(100)
    })

    expect(objectResult.current).toBe(newObject)
  })

  it('handles delay changes', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      {
        initialProps: { value: 'initial', delay: 500 }
      }
    )

    // Change value and delay
    rerender({ value: 'updated', delay: 1000 })

    // Advance by original delay amount
    act(() => {
      vi.advanceTimersByTime(500)
    })

    // Should still be initial because delay was increased
    expect(result.current).toBe('initial')

    // Advance by remaining time
    act(() => {
      vi.advanceTimersByTime(500)
    })

    // Now should be updated
    expect(result.current).toBe('updated')
  })

  it('cleans up timeout on unmount', () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    
    const { unmount } = renderHook(() => useDebounce('test', 500))

    unmount()

    expect(clearTimeoutSpy).toHaveBeenCalled()
    
    clearTimeoutSpy.mockRestore()
  })
})