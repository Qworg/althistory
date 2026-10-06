/**
 * Browser connectivity detection for the offline subsystem (Req 14.2).
 *
 * `navigator.onLine` is a coarse signal: it reports whether the device has a
 * network interface, not whether the API is reachable. Treating it as "online"
 * only means "attempt the request"; a failed attempt is handled by the caller
 * (queued when offline, surfaced when the failure happens while nominally
 * online). This module does not do reachability probing.
 */

/**
 * Best-effort synchronous connectivity read. Defaults to `true` when the
 * environment has no `navigator` or no boolean `onLine`, so non-browser
 * callers are treated as online.
 */
export function isOnline(): boolean {
  if (typeof navigator === 'undefined') return true
  if (typeof navigator.onLine !== 'boolean') return true
  return navigator.onLine
}

export type ConnectivityListener = (online: boolean) => void

/**
 * Subscribe to `online`/`offline` window events. Returns an unsubscribe
 * function; a no-op unsubscribe is returned outside a browser.
 */
export function subscribeConnectivity(listener: ConnectivityListener): () => void {
  if (typeof window === 'undefined') return () => {}
  const handleOnline = () => listener(true)
  const handleOffline = () => listener(false)
  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)
  return () => {
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
  }
}
