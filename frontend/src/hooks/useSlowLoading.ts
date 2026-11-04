import { useEffect, useState } from 'react'

/** How long a load runs before the view admits it is slow (ms). */
export const SLOW_LOAD_MS = 8000

/**
 * True once `isLoading` has stayed true for `afterMs`. A request that fails
 * is retried several times before React Query reports the error, so without
 * this the view shows a spinner for most of a minute with no word on why.
 */
export function useSlowLoading(isLoading: boolean, afterMs: number = SLOW_LOAD_MS): boolean {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (!isLoading) {
      setSlow(false)
      return
    }
    const timer = setTimeout(() => setSlow(true), afterMs)
    return () => clearTimeout(timer)
  }, [isLoading, afterMs])
  return slow
}
