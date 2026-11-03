/**
 * Whether the viewer is on an Apple platform, where the edit modifier is ⌘
 * rather than Ctrl. Used only to *label* shortcuts; handlers accept both.
 */
export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  const platform = nav.userAgentData?.platform || nav.platform || ''
  return /mac|iphone|ipad|ipod/i.test(platform)
}

/** Key hints for the platform's undo/redo, e.g. `⌘Z` / `Ctrl+Z`. */
export function editShortcutLabels(apple: boolean = isApplePlatform()): { undo: string; redo: string } {
  return apple ? { undo: '⌘Z', redo: '⇧⌘Z' } : { undo: 'Ctrl+Z', redo: 'Ctrl+Shift+Z' }
}
