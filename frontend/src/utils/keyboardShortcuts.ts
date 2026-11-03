/**
 * The one rule for when an app keyboard shortcut must stand aside.
 *
 * Every document-level shortcut handler (toolbar, view switching, causal graph
 * tools and layouts, undo/redo, help) calls this first, so they all agree on
 * when keys belong to something else:
 *
 * - the user is typing: an input, textarea, select or contenteditable has the
 *   key (the event target, or the focused element for handlers that look);
 * - an IME composition is in progress (the keystroke is building a character);
 * - a modal dialog is open: keys belong to the dialog, so a bare `E` pressed
 *   on its Save button does not open another form behind it, and Escape closes
 *   the dialog without also clearing the selection underneath.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return true
  }
  if (target instanceof HTMLElement && target.isContentEditable) return true
  // jsdom does not implement isContentEditable, and an editable ancestor makes
  // its descendants editable too.
  return target.closest('[contenteditable]:not([contenteditable="false"])') !== null
}

export function isModalOpen(): boolean {
  return document.querySelector('[aria-modal="true"]') !== null
}

export function shouldIgnoreAppShortcut(event: KeyboardEvent): boolean {
  if (event.isComposing) return true
  if (isTypingTarget(event.target) || isTypingTarget(document.activeElement)) return true
  return isModalOpen()
}
