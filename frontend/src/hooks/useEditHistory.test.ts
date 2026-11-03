import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, fireEvent } from '@testing-library/react'
import { useEditHistory, type EditHistoryEntry } from './useEditHistory'

const entry = (description: string, overrides: Partial<EditHistoryEntry> = {}): EditHistoryEntry => ({
  description,
  undo: vi.fn(async () => true),
  redo: vi.fn(async () => true),
  ...overrides,
})

describe('useEditHistory', () => {
  it('undoes and redoes the latest edit, reporting each step', async () => {
    const { result } = renderHook(() => useEditHistory())
    const edit = entry('moved "Hastings"')

    act(() => result.current.record(edit))
    expect(result.current.canUndo).toBe(true)
    expect(result.current.lastMessage).toBe('moved "Hastings"')

    await act(() => result.current.undo())
    expect(edit.undo).toHaveBeenCalledTimes(1)
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(true)
    expect(result.current.lastMessage).toBe('Undone: moved "Hastings"')

    await act(() => result.current.redo())
    expect(edit.redo).toHaveBeenCalledTimes(1)
    expect(result.current.canUndo).toBe(true)
    expect(result.current.lastMessage).toBe('Redone: moved "Hastings"')
  })

  it('keeps an edit whose undo was refused, so it can be retried', async () => {
    const { result } = renderHook(() => useEditHistory())
    act(() => result.current.record(entry('resized', { undo: vi.fn(async () => false) })))

    await act(() => result.current.undo())
    expect(result.current.canUndo).toBe(true)
    expect(result.current.canRedo).toBe(false)
  })

  it('a new edit clears the redo stack', async () => {
    const { result } = renderHook(() => useEditHistory())
    act(() => result.current.record(entry('first')))
    await act(() => result.current.undo())
    expect(result.current.canRedo).toBe(true)

    act(() => result.current.record(entry('second')))
    expect(result.current.canRedo).toBe(false)
  })

  it('binds Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y, but not inside text fields or modal dialogs', async () => {
    const { result } = renderHook(() => useEditHistory())
    const edit = entry('moved')
    act(() => result.current.record(edit))

    const input = document.createElement('input')
    document.body.appendChild(input)
    fireEvent.keyDown(input, { key: 'z', ctrlKey: true })
    expect(edit.undo).not.toHaveBeenCalled()
    input.remove()

    const dialog = document.createElement('div')
    dialog.setAttribute('aria-modal', 'true')
    document.body.appendChild(dialog)
    fireEvent.keyDown(document, { key: 'z', ctrlKey: true })
    expect(edit.undo).not.toHaveBeenCalled()
    dialog.remove()

    await act(async () => {
      fireEvent.keyDown(document, { key: 'z', ctrlKey: true })
    })
    expect(edit.undo).toHaveBeenCalledTimes(1)

    await act(async () => {
      fireEvent.keyDown(document, { key: 'Z', ctrlKey: true, shiftKey: true })
    })
    expect(edit.redo).toHaveBeenCalledTimes(1)

    await act(async () => {
      fireEvent.keyDown(document, { key: 'z', metaKey: true })
    })
    expect(edit.undo).toHaveBeenCalledTimes(2)

    await act(async () => {
      fireEvent.keyDown(document, { key: 'y', ctrlKey: true })
    })
    expect(edit.redo).toHaveBeenCalledTimes(2)
  })

  it('discards the history when the reset key changes', () => {
    const { result, rerender } = renderHook(({ graph }) => useEditHistory({ resetKey: graph }), {
      initialProps: { graph: 'g1' },
    })
    act(() => result.current.record(entry('moved')))
    expect(result.current.canUndo).toBe(true)

    rerender({ graph: 'g2' })
    expect(result.current.canUndo).toBe(false)
    expect(result.current.lastMessage).toBeNull()
  })
})
