import { useGlobalStore } from '@/stores/globalStore'

/**
 * Small always-on-top connectivity indicator (Req 14.2). Renders nothing while
 * online with no queued work, so it is unobtrusive in the common case.
 *
 * What the text claims:
 * - `Offline — N changes saved on this device, not yet sent` means N writes are
 *   in the durable queue. Only writes that go through the offline-aware
 *   mutation hooks reach that queue (event and arc create/update/delete); see
 *   `src/offline/README.md`. The count is not an estimate.
 * - `Syncing N queued changes…` is shown only while a replay pass is actually
 *   running (`syncInProgress`).
 * - `N queued changes — waiting to sync` is the honest state between attempts
 *   (for example while a retry is scheduled).
 *
 * This shows *connectivity and outstanding queue depth*. It does not show
 * whether any individual write reached the server; a rejected replay is
 * surfaced separately through `addError` / NotificationCenter.
 */
export function OfflineIndicator() {
  const isOnline = useGlobalStore((state) => state.isOnline)
  const pendingMutationCount = useGlobalStore((state) => state.pendingMutationCount)
  const syncInProgress = useGlobalStore((state) => state.syncInProgress)

  if (isOnline && pendingMutationCount === 0) return null

  const changes = pendingMutationCount === 1 ? 'change' : 'changes'

  let message: string
  if (!isOnline) {
    message =
      pendingMutationCount === 0
        ? 'Offline — not connected'
        : `Offline — ${pendingMutationCount} ${changes} saved on this device, not yet sent`
  } else if (syncInProgress) {
    message = `Syncing ${pendingMutationCount} queued ${changes}…`
  } else {
    message = `${pendingMutationCount} queued ${changes} — waiting to sync`
  }

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
