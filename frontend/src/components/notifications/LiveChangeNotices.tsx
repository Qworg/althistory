import { useLiveChangesStore } from '@/stores/liveChangesStore'

/**
 * Says, for a few seconds, who changed what: "An agent (Claude) added 3 events
 * to “The Tide War”". The lines come from the live change feed
 * (`describeChanges`) and only for changes other writers made; your own edits
 * are not announced to you.
 *
 * Bottom left: the notification center holds the bottom right, and a notice up
 * top covers the graph selector. On a phone it sits above the bottom bar.
 */
export function LiveChangeNotices() {
  const notices = useLiveChangesStore((state) => state.notices)
  const dismiss = useLiveChangesStore((state) => state.dismissNotice)

  if (notices.length === 0) return null

  return (
    <div
      aria-live="polite"
      aria-label="Live changes"
      className="pointer-events-none fixed bottom-4 left-4 z-40 flex w-full max-w-md flex-col gap-2 max-lg:inset-x-4 max-lg:bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] max-lg:w-auto"
    >
      {notices.map((notice) => (
        <div
          key={notice.id}
          role="status"
          data-testid="live-change-notice"
          className="pointer-events-auto flex items-start gap-3 rounded-lg border border-line bg-card px-4 py-3 text-ink shadow-lg"
        >
          <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-success" />
          <p className="min-w-0 flex-1 text-sm break-words">{notice.message}</p>
          <button
            type="button"
            onClick={() => dismiss(notice.id)}
            aria-label="Dismiss notice"
            className="flex-shrink-0 rounded p-1 text-ink-secondary hover:bg-subtle hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-selected"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  )
}
