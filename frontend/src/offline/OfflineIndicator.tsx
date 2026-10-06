import { useGlobalStore } from '@/stores/globalStore'

/**
 * Small always-on-top connectivity indicator (Req 14.2). Renders nothing while
 * online with no queued work, so it is unobtrusive in the common case.
 *
 * This shows *connectivity and outstanding queue depth*. It does not show
 * whether any individual write reached the server; a rejected replay is
 * surfaced separately through `addError` / NotificationCenter.
 */
export function OfflineIndicator() {
  const isOnline = useGlobalStore((state) => state.isOnline)
  const pendingMutationCount = useGlobalStore((state) => state.pendingMutationCount)

  if (isOnline && pendingMutationCount === 0) return null

  const changes = pendingMutationCount === 1 ? 'change' : 'changes'
  const message = isOnline
    ? `Syncing ${pendingMutationCount} queued ${changes}…`
    : `Offline — ${pendingMutationCount} ${changes} queued`

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="offline-indicator"
      data-online={isOnline}
      className={
        isOnline
          ? 'fixed bottom-4 left-4 z-50 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 shadow-lg'
          : 'fixed bottom-4 left-4 z-50 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 shadow-lg'
      }
    >
      {message}
    </div>
  )
}
