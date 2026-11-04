function describe(error: unknown): string | null {
  if (error instanceof Error && error.message) return error.message
  return null
}

interface ViewLoadErrorProps {
  /** What failed to load, as a noun phrase: "this graph's events". */
  what: string
  error: unknown
  onRetry: () => void
  isRetrying?: boolean
}

/**
 * A view's history could not be fetched. Says so plainly, and says that the
 * history itself is untouched: an empty-looking canvas after a failed request
 * otherwise reads as lost work, and invites re-ingesting or rebuilding it.
 */
export function ViewLoadError({ what, error, onRetry, isRetrying = false }: ViewLoadErrorProps) {
  const detail = describe(error)
  return (
    <div role="alert" className="mx-auto max-w-prose py-12 text-center">
      <h3 className="font-display text-xl font-semibold text-ink">Couldn’t load {what}</h3>
      <p className="mt-2 text-sm text-ink-secondary text-pretty">
        The server didn’t answer. Nothing has been deleted: your history is still there and will
        reappear once the connection is back.
      </p>
      {detail && (
        <p className="mt-2 font-mono-code text-xs text-ink-muted break-words">{detail}</p>
      )}
      <button
        type="button"
        onClick={onRetry}
        disabled={isRetrying}
        className="mt-5 inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isRetrying ? 'Trying again…' : 'Try again'}
      </button>
    </div>
  )
}

interface SlowLoadNoticeProps {
  onRetry: () => void
}

/** Shown under a loading placeholder once the load has run long. */
export function SlowLoadNotice({ onRetry }: SlowLoadNoticeProps) {
  return (
    <p role="status" className="mt-4 text-center text-sm text-ink-secondary">
      Still loading. The server is taking longer than usual.{' '}
      <button
        type="button"
        onClick={onRetry}
        className="font-medium text-baseline underline underline-offset-2 hover:no-underline"
      >
        Try again now
      </button>
    </p>
  )
}
