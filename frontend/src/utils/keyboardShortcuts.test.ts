import { describe, it, expect, afterEach } from 'vitest'
import { isTypingTarget, isModalOpen, shouldIgnoreAppShortcut } from './keyboardShortcuts'

const keydown = (target: EventTarget, init: KeyboardEventInit = {}) => {
  let seen: KeyboardEvent | null = null
  const capture = (e: Event) => { seen = e as KeyboardEvent }
  document.addEventListener('keydown', capture)
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', bubbles: true, ...init }))
  document.removeEventListener('keydown', capture)
  if (!seen) throw new Error('no keydown seen')
  return seen as KeyboardEvent
}

describe('app shortcut guard', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('treats text fields and editable regions as typing, buttons as not', () => {
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    const inside = document.createElement('span')
    editable.appendChild(inside)
    const off = document.createElement('div')
    off.setAttribute('contenteditable', 'false')

    expect(isTypingTarget(document.createElement('input'))).toBe(true)
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true)
    expect(isTypingTarget(document.createElement('select'))).toBe(true)
    expect(isTypingTarget(inside)).toBe(true)
    expect(isTypingTarget(off)).toBe(false)
    expect(isTypingTarget(document.createElement('button'))).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })

  it('lets a shortcut through from a plain button with nothing open', () => {
    const button = document.createElement('button')
    document.body.appendChild(button)

    expect(shouldIgnoreAppShortcut(keydown(button))).toBe(false)
  })

  it('stands aside while typing in a field', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)

    expect(shouldIgnoreAppShortcut(keydown(input))).toBe(true)
  })

  it('stands aside during IME composition', () => {
    const button = document.createElement('button')
    document.body.appendChild(button)

    expect(shouldIgnoreAppShortcut(keydown(button, { isComposing: true }))).toBe(true)
  })

  it('stands aside while a modal dialog is open, even when focus is on its buttons', () => {
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    const save = document.createElement('button')
    dialog.appendChild(save)
    document.body.appendChild(dialog)

    expect(isModalOpen()).toBe(true)
    expect(shouldIgnoreAppShortcut(keydown(save))).toBe(true)
  })
})
