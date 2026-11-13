import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react'

/**
 * Values that pass, under a name, to the component that replaces their own in
 * the same render: a view remounted to show another of the world's calendars
 * (WorldCalendarBoundary) keeps, say, what was selected. A component takes a
 * value while rendering, which is before the one it replaces is cleaned up;
 * one that is simply unmounted takes its value with it.
 */
const kept = new Map<string, { key: unknown; value: unknown }>()

function takeKept<T>(name: string, key: unknown): { found: true; value: T } | { found: false } {
  const held = kept.get(name)
  return held && Object.is(held.key, key) ? { found: true, value: held.value as T } : { found: false }
}

/** Holds `entry` under `name` while the caller is mounted. */
function useHolding(name: string, entry: { key: unknown; value: unknown } | null): void {
  useEffect(() => {
    if (!entry) return
    kept.set(name, entry)
    return () => {
      if (kept.get(name) === entry) kept.delete(name)
    }
  }, [name, entry])
}

/**
 * `useState` kept across such a remount while `key` (the graph) stays the
 * same. The value is stored with the key it was set under, and a value set
 * under another key is never given out, not even for one render: it is
 * `initial` again.
 */
export function useKeptState<T>(name: string, key: unknown, initial: T): [T, (next: SetStateAction<T>) => void] {
  const [state, setState] = useState<{ key: unknown; value: T }>(() => {
    const held = takeKept<T>(name, key)
    return { key, value: held.found ? held.value : initial }
  })
  const stale = !Object.is(state.key, key)
  // A value set under another key (the graph before) is not this key's.
  const current = stale ? { key, value: initial } : state
  useHolding(name, stale ? null : state)

  const set = useCallback(
    (next: SetStateAction<T>) =>
      setState((previous) => {
        const base = Object.is(previous.key, key) ? previous.value : initial
        const value = typeof next === 'function' ? (next as (value: T) => T)(base) : next
        return { key, value }
      }),
    // `initial` is a constant for a caller (null, a default).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key]
  )
  return [current.value, set]
}

/**
 * A ref kept across such a remount while `key` stays the same: the same
 * object, so a callback made by the component that was replaced (an undo
 * entry) reads what the mounted one last put in it. Another key, another ref.
 */
export function useKeptRef<T>(name: string, key: unknown, initial: T): { current: T } {
  const entry = useRef<{ key: unknown; value: { current: T } } | null>(null)
  if (!entry.current || !Object.is(entry.current.key, key)) {
    // Taking is idempotent (nothing is removed), so a render done twice takes the same ref.
    const held = entry.current ? { found: false as const } : takeKept<{ current: T }>(name, key)
    entry.current = { key, value: held.found ? held.value : { current: initial } }
  }
  useHolding(name, entry.current)
  return entry.current.value
}
