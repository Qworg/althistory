import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
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
  /**
   * A name under which the history passes to the component that replaces
   * this one in the same render, while `resetKey` stays the same: a view
   * remounted to show another of the world's calendars (WorldCalendarBoundary)
   * keeps what can be undone. A view that is simply unmounted takes its
   * history with it, as before.
   */
  keepAs?: string
}

interface HistoryState {
  key: unknown
  past: EditHistoryEntry[]
  future: EditHistoryEntry[]
  message: string | null
  /** An undo or redo is under way (one at a time, whichever component holds the history). */
  busy: boolean
  /** The mounted components showing this history, re-rendered when it changes. */
  views: Set<() => void>
}

const kept = new Map<string, HistoryState>()

/** The history kept under `name` for `key`, or a new one (kept, when named, in its place). */
function historyFor(name: string | undefined, key: unknown): HistoryState {
  const held = name ? kept.get(name) : undefined
  if (held && Object.is(held.key, key)) return held
  const fresh: HistoryState = { key, past: [], future: [], message: null, busy: false, views: new Set() }
  if (name) kept.set(name, fresh)
  return fresh
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
  keepAs,
}: UseEditHistoryOptions = {}): EditHistory {
  const [initial] = useState(() => historyFor(keepAs, resetKey))
  const history = useRef(initial)

  // Held under its name while mounted. The component that replaces this one
  // took it while rendering, before this cleanup; its own effect holds it again.
  useEffect(() => {
    if (!keepAs) return
    const held = history.current
    kept.set(keepAs, held)
    return () => {
      if (kept.get(keepAs) === held) kept.delete(keepAs)
    }
  }, [keepAs])
  const [, rerenderThis] = useReducer((n: number) => n + 1, 0)
  // Every view of the history re-renders when it changes: an undo begun
  // before a remount finishes in the view that replaced the one it began in.
  useEffect(() => {
    const views = history.current.views
    views.add(rerenderThis)
    return () => {
      views.delete(rerenderThis)
    }
  })
  const rerender = useCallback(() => {
    rerenderThis()
    for (const view of history.current.views) view()
  }, [])

  const clear = useCallback(() => {
    history.current.past = []
    history.current.future = []
    history.current.message = null
    rerender()
  }, [rerender])

  // A different graph has different entities: its history does not apply.
  useEffect(() => {
    if (Object.is(history.current.key, resetKey)) return
    history.current = historyFor(keepAs, resetKey)
    if (keepAs) kept.set(keepAs, history.current)
    rerender()
  }, [resetKey, keepAs, rerender])

  const record = useCallback((entry: EditHistoryEntry) => {
    history.current.past = [...history.current.past, entry].slice(-limit)
    history.current.future = []
    history.current.message = entry.description
    rerender()
  }, [limit, rerender])

  // An undo or redo finishes in the history it began in, even if another
  // graph's has been shown since; only that history's views redraw.
  const step = useCallback(async (from: 'past' | 'future') => {
    const held = history.current
    const entry = held[from][held[from].length - 1]
    if (!entry || held.busy) return
    held.busy = true
    try {
      if (await (from === 'past' ? entry.undo() : entry.redo())) {
        const to = from === 'past' ? 'future' : 'past'
        held[from] = held[from].slice(0, -1)
        held[to] = [...held[to], entry]
        held.message = `${from === 'past' ? 'Undone' : 'Redone'}: ${entry.description}`
        if (history.current === held) rerender()
        else for (const view of held.views) view()
      }
    } finally {
      held.busy = false
    }
  }, [rerender])
  const undo = useCallback(() => step('past'), [step])
  const redo = useCallback(() => step('future'), [step])

  useEffect(() => {
    if (!enableShortcuts) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      // Text fields have their own undo; a modal dialog owns the keyboard.
      if (shouldIgnoreAppShortcut(event)) return
      const key = event.key.toLowerCase()
      const isUndo = key === 'z' && !event.shiftKey
      const isRedo = (key === 'z' && event.shiftKey) || (key === 'y' && event.ctrlKey && !event.shiftKey)
      if (isUndo && history.current.past.length > 0) {
        event.preventDefault()
        void undo()
      } else if (isRedo && history.current.future.length > 0) {
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
    canUndo: history.current.past.length > 0,
    canRedo: history.current.future.length > 0,
    lastMessage: history.current.message,
    clear,
  }
}
