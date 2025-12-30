import { useCallback, useRef } from 'react'

export interface UseLongPressOptions {
  delay?: number
  onContextMenu?: (e: React.MouseEvent) => void
}

export interface UseLongPressHandlers {
  onTouchStart: (e: React.TouchEvent) => void
  onTouchEnd: () => void
  onTouchMove: () => void
  onContextMenu: (e: React.MouseEvent) => void
}

/**
 * Hook for detecting long-press gestures on mobile devices
 * Also handles right-click context menu on desktop
 */
export function useLongPress(
  onLongPress: (position: { x: number; y: number }) => void,
  options: UseLongPressOptions = {}
): UseLongPressHandlers {
  const { delay = 500, onContextMenu } = options
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const touchPositionRef = useRef<{ x: number; y: number } | null>(null)
  const isLongPressRef = useRef(false)

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    // Store the initial touch position
    const touch = e.touches[0]
    if (!touch) return
    touchPositionRef.current = { x: touch.clientX, y: touch.clientY }
    isLongPressRef.current = false

    // Start the long-press timer
    timerRef.current = setTimeout(() => {
      isLongPressRef.current = true
      if (touchPositionRef.current) {
        onLongPress(touchPositionRef.current)
      }
    }, delay)
  }, [delay, onLongPress])

  const handleTouchEnd = useCallback(() => {
    clearTimer()
    touchPositionRef.current = null
  }, [clearTimer])

  const handleTouchMove = useCallback(() => {
    // Cancel long-press if the user moves their finger (likely scrolling)
    clearTimer()
    touchPositionRef.current = null
  }, [clearTimer])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    // Prevent the default browser context menu
    e.preventDefault()
    e.stopPropagation()

    // Get the position from the mouse event
    const position = { x: e.clientX, y: e.clientY }

    // Use the custom handler if provided, otherwise use onLongPress
    if (onContextMenu) {
      onContextMenu(e)
    } else {
      onLongPress(position)
    }
  }, [onContextMenu, onLongPress])

  return {
    onTouchStart: handleTouchStart,
    onTouchEnd: handleTouchEnd,
    onTouchMove: handleTouchMove,
    onContextMenu: handleContextMenu,
  }
}
