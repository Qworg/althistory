import { useGlobalStore } from '@/stores/globalStore'
import { useActiveGraph, useActiveGraphId } from '@/hooks/useGraphs'
import { discardUnscopedMutations, sendUnscopedToGraph } from './offlineSync'

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
/**
 * Writes saved before graphs were recorded do not say where they belong. They
 * wait here for a choice instead of being sent to a guess or thrown away.
 */
function UnscopedPrompt({ count }: { count: number }) {
  const activeGraphId = useActiveGraphId()
  const { data: graph } = useActiveGraph()
  const name = graph?.name ?? 'the open graph'
  const noun = count === 1 ? 'change' : 'changes'
  return (
    <div
      role="group"
      aria-label="Changes saved before this update"
      data-testid="unscoped-prompt"
      className="fixed bottom-16 left-4 z-[var(--z-notices)] max-w-sm rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink shadow-lg lg:bottom-14"
    >
      <p>
        {count} {noun} saved before this update {count === 1 ? "doesn't" : "don't"} record their graph.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => sendUnscopedToGraph(activeGraphId)}
          className="rounded-md bg-selected px-3 py-1.5 font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-selected focus-visible:ring-offset-2"
        >
          Send to {name}
        </button>
        <button
          type="button"
          onClick={() => discardUnscopedMutations()}
          className="rounded-md border border-line px-3 py-1.5 font-medium text-ink hover:bg-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-selected"
        >
          Discard
        </button>
      </div>
    </div>
  )
}

export function OfflineIndicator() {
  const isOnline = useGlobalStore((state) => state.isOnline)
  const pendingMutationCount = useGlobalStore((state) => state.pendingMutationCount)
  const syncInProgress = useGlobalStore((state) => state.syncInProgress)
  const unscoped = useGlobalStore((state) => state.unscopedMutationCount)

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
    <>
      {unscoped > 0 && <UnscopedPrompt count={unscoped} />}
    <div
      role="status"
      aria-live="polite"
      data-testid="offline-indicator"
      data-online={isOnline}
      className={
        isOnline
          ? 'fixed bottom-4 left-4 z-[var(--z-notices)] rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 shadow-lg'
          : 'fixed bottom-4 left-4 z-[var(--z-notices)] rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 shadow-lg'
      }
    >
      {message}
    </div>
    </>
  )
}
