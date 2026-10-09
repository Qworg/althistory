import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useGlobalKeyboardShortcuts } from './useGlobalKeyboardShortcuts'

describe('useGlobalKeyboardShortcuts', () => {
  it('triggers onNewEvent when Ctrl+N is pressed', () => {
    const onNewEvent = vi.fn()
    renderHook(() => useGlobalKeyboardShortcuts({ onNewEvent }))

    const event = new KeyboardEvent('keydown', {
      key: 'n',
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    })
    window.dispatchEvent(event)

    expect(onNewEvent).toHaveBeenCalledTimes(1)
  })

  it('triggers onNewArc when Ctrl+Shift+C is pressed', () => {
    const onNewArc = vi.fn()
    renderHook(() => useGlobalKeyboardShortcuts({ onNewArc }))

    const event = new KeyboardEvent('keydown', {
      key: 'c',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true
    })
    window.dispatchEvent(event)

    expect(onNewArc).toHaveBeenCalledTimes(1)
  })

  it('triggers onNewArc when Ctrl+Shift+N is pressed as alternative', () => {
    const onNewArc = vi.fn()
    renderHook(() => useGlobalKeyboardShortcuts({ onNewArc }))

    const event = new KeyboardEvent('keydown', {
      key: 'n',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true
    })
    window.dispatchEvent(event)

    expect(onNewArc).toHaveBeenCalledTimes(1)
  })

  it('triggers onToggleFilterPanel when F is pressed', () => {
    const onToggleFilterPanel = vi.fn()
    renderHook(() => useGlobalKeyboardShortcuts({ onToggleFilterPanel }))

    const event = new KeyboardEvent('keydown', {
      key: 'f',
      bubbles: true,
      cancelable: true
    })
    window.dispatchEvent(event)

    expect(onToggleFilterPanel).toHaveBeenCalledTimes(1)
  })

  it('triggers onEscape when Escape is pressed', () => {
    const onEscape = vi.fn()
    renderHook(() => useGlobalKeyboardShortcuts({ onEscape }))

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true
    })
    window.dispatchEvent(event)

    expect(onEscape).toHaveBeenCalledTimes(1)
  })

  it('ignores shortcuts when focused on an input element', () => {
    const onNewEvent = vi.fn()
    renderHook(() => useGlobalKeyboardShortcuts({ onNewEvent }))

    const input = document.createElement('input')
    document.body.appendChild(input)

    const event = new KeyboardEvent('keydown', {
      key: 'n',
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    })
    Object.defineProperty(event, 'target', { value: input, enumerable: true })
    window.dispatchEvent(event)

    expect(onNewEvent).not.toHaveBeenCalled()
    document.body.removeChild(input)
  })

  it('does nothing when enabled is false', () => {
    const onNewEvent = vi.fn()
    renderHook(() => useGlobalKeyboardShortcuts({ onNewEvent, enabled: false }))

    const event = new KeyboardEvent('keydown', {
      key: 'n',
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    })
    window.dispatchEvent(event)

    expect(onNewEvent).not.toHaveBeenCalled()
  })
})
