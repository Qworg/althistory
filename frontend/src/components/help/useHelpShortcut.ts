import { useEffect } from 'react'
import { isTypingTarget, shouldIgnoreAppShortcut } from '@/utils/keyboardShortcuts'
import { useHelpStore } from './helpStore'

// Shared with every other shortcut handler; re-exported for existing callers.
export { isTypingTarget }

/**
 * Registers the global `?` (Shift+/) shortcut that opens the help dialog.
 * Mount once, at the layout level.
 *
 * `event.key === '?'` is layout-independent: whatever the user presses to type
 * a question mark opens help. It is ignored with Ctrl/Alt/Meta held, while
 * typing, and while another modal dialog is open (two focus traps would fight).
 */
export function useHelpShortcut() {
  const openHelp = useHelpStore((state) => state.openHelp)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '?' || event.ctrlKey || event.altKey || event.metaKey) return
      if (event.defaultPrevented || shouldIgnoreAppShortcut(event)) return

      event.preventDefault()
      openHelp('shortcuts')
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [openHelp])
}
