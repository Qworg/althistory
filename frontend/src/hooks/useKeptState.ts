import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react'

const kept = new Map<string, { key: unknown; value: unknown }>()

/**
 * `useState` whose value passes, under `name`, to the component that
 * replaces this one in the same render, while `key` stays the same; it
 * starts again from `initial` when `key` changes (another graph). A view
 * remounted to show another of the world's calendars (WorldCalendarBoundary)
 * keeps, say, what was selected. A view that is simply unmounted takes its
 * value with it.
 */
export function useKeptState<T>(name: string, key: unknown, initial: T): [T, (next: SetStateAction<T>) => void] {
  const [value, setValue] = useState<T>(() => {
    const held = kept.get(name)
    return held && Object.is(held.key, key) ? (held.value as T) : initial
  })
  const keyRef = useRef(key)
  const initialRef = useRef(initial)

  useEffect(() => {
    if (Object.is(keyRef.current, key)) return
    keyRef.current = key
    setValue(initialRef.current)
  }, [key])

  // Held while mounted; the component that replaces this one read it while
  // rendering, before this cleanup, and holds it again in its own effect.
  useEffect(() => {
    const held = { key: keyRef.current, value }
    kept.set(name, held)
    return () => {
      if (kept.get(name) === held) kept.delete(name)
    }
  }, [name, value, key])

  const set = useCallback((next: SetStateAction<T>) => setValue(next), [])
  return [value, set]
}
