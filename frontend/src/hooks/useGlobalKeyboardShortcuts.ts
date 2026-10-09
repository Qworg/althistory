/**
 * Hook for managing global application keyboard shortcuts.
 *
 * Provides standardized shortcuts for:
 * - Ctrl+N: Create new event
 * - Ctrl+Shift+C / Ctrl+Shift+N: Create new arc
 * - F: Toggle filter panel (when no input is focused)
 * - Escape: Close modal / clear selection
 */

import { useEffect, useCallback } from 'react'

export interface GlobalKeyboardShortcutOptions {
  onNewEvent?: () => void
  onNewArc?: () => void
  onToggleFilterPanel?: () => void
  onEscape?: () => void
  enabled?: boolean
}

export function useGlobalKeyboardShortcuts({
  onNewEvent,
  onNewArc,
  onToggleFilterPanel,
  onEscape,
  enabled = true,
}: GlobalKeyboardShortcutOptions = {}): void {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Do not process shortcuts when user is actively interacting with form fields
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement ||
        (event.target instanceof HTMLElement && event.target.isContentEditable)
      ) {
        return
      }

      const key = event.key.toLowerCase()

      // Escape key: dismiss or clear selection
      if (key === 'escape') {
        if (onEscape) {
          event.preventDefault()
          onEscape()
        }
        return
      }

      // Ctrl+Shift+C or Ctrl+Shift+N: Create new arc
      if (event.ctrlKey && event.shiftKey && (key === 'c' || key === 'n')) {
        if (onNewArc) {
          event.preventDefault()
          onNewArc()
        }
        return
      }

      // Ctrl+N (without Shift): Create new event
      if (event.ctrlKey && !event.shiftKey && !event.altKey && key === 'n') {
        if (onNewEvent) {
          event.preventDefault()
          onNewEvent()
        }
        return
      }

      // F (standalone): Toggle filter panel
      if (!event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey && key === 'f') {
        if (onToggleFilterPanel) {
          event.preventDefault()
          onToggleFilterPanel()
        }
        return
      }
    },
    [onNewEvent, onNewArc, onToggleFilterPanel, onEscape]
  )

  useEffect(() => {
    if (!enabled) return

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [enabled, handleKeyDown])
}
