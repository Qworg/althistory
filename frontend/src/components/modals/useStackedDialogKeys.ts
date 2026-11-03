import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

const MODAL_SELECTOR = '[aria-modal="true"]'

/** The open modal dialogs, outermost first (document order). */
function openDialogs(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(MODAL_SELECTOR))
}

function focusablesIn(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    element => !element.closest('[hidden], [inert]')
  )
}

/**
 * Escape and Tab for a dialog that may sit on top of other dialogs. ModalBase
 * and PanelBase use it, so every dialog built on them stacks correctly.
 *
 * Per-dialog `document` listeners broke stacking (the branch comparison opens
 * over the graph manager, the merge over the comparison): one Escape closed
 * every open dialog, and an outer dialog's focus trap could pull Tab out of
 * the inner one -- its focusable list includes the nested dialog's controls,
 * so its "last element" is inside the inner dialog and it wrapped focus back
 * to its own first control.
 *
 * This hook listens on `window` in the capture phase, which runs before any
 * `document` listener, and acts only while its dialog is the topmost open
 * `aria-modal` dialog (the last one in document order: a nested or later
 * dialog is drawn on top). Escape closes that dialog and stops there, so the
 * dialogs beneath -- and app shortcuts like "Escape clears the selection" --
 * stay untouched. Tab wraps within it before an outer trap can move focus.
 * An open popup inside the dialog (focus on an expanded aria-haspopup trigger,
 * or inside a menu / listbox) gets Escape first, so it closes before the
 * dialog does. A plain disclosure (aria-expanded without a popup) does not.
 *
 * @param anchorRef Any element rendered inside the dialog; the dialog is
 *   found from it, because ModalBase does not expose a ref.
 * @param onEscape Called on Escape while the dialog is topmost.
 * @param escapeEnabled When false (e.g. while a write is in flight) Escape is
 *   swallowed without closing, so it does not fall through to a dialog below.
 */
export function useStackedDialogKeys(
  anchorRef: RefObject<HTMLElement | null>,
  isOpen: boolean,
  onEscape: () => void,
  escapeEnabled = true
): void {
  const onEscapeRef = useRef(onEscape)
  const escapeEnabledRef = useRef(escapeEnabled)
  useEffect(() => {
    onEscapeRef.current = onEscape
    escapeEnabledRef.current = escapeEnabled
  }, [onEscape, escapeEnabled])

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' && event.key !== 'Tab') return
      const dialog = anchorRef.current?.closest<HTMLElement>(MODAL_SELECTOR)
      if (!dialog) return
      const dialogs = openDialogs()
      if (dialogs[dialogs.length - 1] !== dialog) return

      if (event.key === 'Escape') {
        // Let an open menu / listbox inside the dialog close itself first
        const target = event.target instanceof Element ? event.target : null
        if (
          target &&
          dialog.contains(target) &&
          target.closest('[aria-haspopup][aria-expanded="true"], [role="menu"], [role="listbox"]')
        ) return
        event.preventDefault()
        event.stopPropagation()
        if (escapeEnabledRef.current) onEscapeRef.current()
        return
      }

      const focusables = focusablesIn(dialog)
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (!first || !last) return
      const active = document.activeElement
      if (!(active instanceof HTMLElement || active instanceof SVGElement) || !dialog.contains(active)) {
        event.preventDefault()
        first.focus()
        return
      }
      if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [isOpen, anchorRef])
}
