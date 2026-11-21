import { useEffect } from 'react'
import { shouldIgnoreAppShortcut } from '@/utils/keyboardShortcuts'
import { useFeedbackStore } from './feedbackStore'

/** The key that opens feedback anywhere: Shift+I (a bare key or Shift+key, per CLAUDE.md). */
export const FEEDBACK_SHORTCUT = 'I'

/** Shift+I opens feedback, standing aside while typing or while another dialog is open. */
export function useFeedbackShortcut() {
  const openFeedback = useFeedbackStore((state) => state.openFeedback)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return
      if (event.key.toUpperCase() !== FEEDBACK_SHORTCUT) return
      if (event.defaultPrevented || shouldIgnoreAppShortcut(event)) return
      event.preventDefault()
      void openFeedback()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [openFeedback])
}
