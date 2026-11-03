import { describe, it, expect, vi, afterEach } from 'vitest'
import { editShortcutLabels, isApplePlatform } from './platform'

describe('platform shortcut labels', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('labels undo/redo with ⌘ on Apple platforms and Ctrl elsewhere', () => {
    expect(editShortcutLabels(true)).toEqual({ undo: '⌘Z', redo: '⇧⌘Z' })
    expect(editShortcutLabels(false)).toEqual({ undo: 'Ctrl+Z', redo: 'Ctrl+Shift+Z' })
  })

  it('detects macOS from the navigator platform', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel' })
    expect(isApplePlatform()).toBe(true)
    vi.stubGlobal('navigator', { platform: 'Win32' })
    expect(isApplePlatform()).toBe(false)
    vi.stubGlobal('navigator', { platform: '', userAgentData: { platform: 'macOS' } })
    expect(isApplePlatform()).toBe(true)
  })
})
