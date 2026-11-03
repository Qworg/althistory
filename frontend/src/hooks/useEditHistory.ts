import { useCallback, useEffect, useReducer, useRef } from 'react'
import { shouldIgnoreAppShortcut } from '@/utils/keyboardShortcuts'

/**
 * One reversible edit. `undo` and `redo` perform the write (and any guardrail
 * check) themselves and resolve to whether it was applied; a refused or failed
 * step leaves the history where it was, so the user can see why and retry.
 */
export interface EditHistoryEntry {
  /** What the edit did, in the past tense: `Moved "Hastings" to 14 Oct 1066`. */
  description: string
  undo: () => Promise<boolean>
  redo: () => Promise<boolean>
}

export interface UseEditHistoryOptions {
  /** Bind Ctrl/⌘+Z (undo) and Ctrl/⌘+Shift+Z or Ctrl+Y (redo) on the document. */
  enableShortcuts?: boolean
  /** History is discarded whenever this changes (e.g. the active graph id). */
  resetKey?: unknown
  /** Oldest entries are dropped beyond this many. */
  limit?: number
}

export interface EditHistory {
  record: (entry: EditHistoryEntry) => void
  undo: () => Promise<void>
  redo: () => Promise<void>
  canUndo: boolean
  canRedo: boolean
  /** A one-line account of the latest edit, undo or redo, for a status line. */
  lastMessage: string | null
  clear: () => void
}

/**
 * An undo/redo stack for direct-manipulation edits (dragging an event,
 * resizing an arc). Entries describe how to reverse themselves, so the hook
 * knows nothing about events or arcs.
 */
export function useEditHistory({
  enableShortcuts = true,
  resetKey,
  limit = 50,
}: UseEditHistoryOptions = {}): EditHistory {
  const pastRef = useRef<EditHistoryEntry[]>([])
  const futureRef = useRef<EditHistoryEntry[]>([])
  const messageRef = useRef<string | null>(null)
  const busyRef = useRef(false)
  const [, rerender] = useReducer((n: number) => n + 1, 0)

  const clear = useCallback(() => {
    pastRef.current = []
    futureRef.current = []
    messageRef.current = null
    rerender()
  }, [])

  // A different graph has different entities: its history does not apply.
  const resetKeyRef = useRef(resetKey)
  useEffect(() => {
    if (Object.is(resetKeyRef.current, resetKey)) return
    resetKeyRef.current = resetKey
    clear()
  }, [resetKey, clear])

  const record = useCallback((entry: EditHistoryEntry) => {
    pastRef.current = [...pastRef.current, entry].slice(-limit)
    futureRef.current = []
    messageRef.current = entry.description
    rerender()
  }, [limit])

  const undo = useCallback(async () => {
    const entry = pastRef.current[pastRef.current.length - 1]
    if (!entry || busyRef.current) return
    busyRef.current = true
    try {
      if (await entry.undo()) {
        pastRef.current = pastRef.current.slice(0, -1)
        futureRef.current = [...futureRef.current, entry]
        messageRef.current = `Undone: ${entry.description}`
        rerender()
      }
    } finally {
      busyRef.current = false
    }
  }, [])

  const redo = useCallback(async () => {
    const entry = futureRef.current[futureRef.current.length - 1]
    if (!entry || busyRef.current) return
    busyRef.current = true
    try {
      if (await entry.redo()) {
        futureRef.current = futureRef.current.slice(0, -1)
        pastRef.current = [...pastRef.current, entry]
        messageRef.current = `Redone: ${entry.description}`
        rerender()
      }
    } finally {
      busyRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!enableShortcuts) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      // Text fields have their own undo; a modal dialog owns the keyboard.
      if (shouldIgnoreAppShortcut(event)) return
      const key = event.key.toLowerCase()
      const isUndo = key === 'z' && !event.shiftKey
      const isRedo = (key === 'z' && event.shiftKey) || (key === 'y' && event.ctrlKey && !event.shiftKey)
      if (isUndo && pastRef.current.length > 0) {
        event.preventDefault()
        void undo()
      } else if (isRedo && futureRef.current.length > 0) {
        event.preventDefault()
        void redo()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [enableShortcuts, undo, redo])

  return {
    record,
    undo,
    redo,
    canUndo: pastRef.current.length > 0,
    canRedo: futureRef.current.length > 0,
    lastMessage: messageRef.current,
    clear,
  }
}
