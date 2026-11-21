import { useFeedbackStore } from './feedbackStore'

export function FeedbackIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7 8h10M7 12h6m-9 8l3.6-3H19a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v9a2 2 0 002 2h.5z"
      />
    </svg>
  )
}

/**
 * The header's feedback button (issue #49): an icon beside Help, quiet until
 * wanted. Phones reach feedback from the More sheet instead, where the header
 * has no room.
 */
export function FeedbackButton() {
  const openFeedback = useFeedbackStore((state) => state.openFeedback)
  const phase = useFeedbackStore((state) => state.phase)

  return (
    <button
      type="button"
      onClick={() => void openFeedback()}
      aria-label="Send feedback: report a problem or suggest an idea"
      aria-haspopup="dialog"
      aria-expanded={phase === 'open'}
      aria-keyshortcuts="Shift+I"
      title="Send feedback (Shift+I)"
      className="inline-flex items-center rounded-md px-2 py-1.5 text-ink-muted hover:bg-subtle hover:text-ink focus:outline-none focus:ring-2 focus:ring-selected"
    >
      <FeedbackIcon />
    </button>
  )
}
