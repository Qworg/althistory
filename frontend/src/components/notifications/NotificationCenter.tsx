import { useGlobalStore } from '@/stores/globalStore'
import { useEffect, useMemo, useState } from 'react'
import { ErrorState } from '@/types'

type ErrorType = ErrorState['type']

interface NotificationStyle {
  label: string
  container: string
  icon: string
}

const STYLES: Record<ErrorType, NotificationStyle> = {
  network: {
    label: 'Network error',
    container: 'bg-red-50 border-red-200 text-red-800',
    icon: 'text-red-600',
  },
  validation: {
    label: 'Validation error',
    container: 'bg-amber-50 border-amber-200 text-amber-800',
    icon: 'text-amber-600',
  },
  visualization: {
    label: 'Visualization error',
    container: 'bg-purple-50 border-purple-200 text-purple-800',
    icon: 'text-purple-600',
  },
  general: {
    label: 'Error',
    container: 'bg-card border-line text-ink',
    icon: 'text-ink-secondary',
  },
  info: {
    label: 'Notice',
    container: 'bg-card border-line text-ink',
    icon: 'text-baseline',
  },
}

function errorIcon(className: string) {
  return (
    <svg
      className={`w-5 h-5 flex-shrink-0 ${className}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  )
}

/**
 * The wait still to go on a rate-limit notice, counting down once a second.
 *
 * It sits inside an assertive live region, so the ticking text is hidden from
 * assistive technology (`aria-hidden`): read out every second it would drown
 * the page. What is announced instead is a spoken sentence fixed when `retryAt`
 * is set or moved ("Try again in about 12 seconds."), and, once, a polite
 * "You can try again now." when the wait is over. The timer stops there.
 */
export function RetryCountdown({ retryAt, className }: { retryAt?: number; className?: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (retryAt === undefined) return
    setNow(Date.now())
    if (retryAt - Date.now() <= 0) return
    const timer = setInterval(() => {
      const current = Date.now()
      setNow(current)
      if (retryAt - current <= 0) clearInterval(timer)
    }, 1000)
    return () => clearInterval(timer)
  }, [retryAt])

  // Fixed per retryAt, not per tick.
  const spoken = useMemo(() => {
    if (retryAt === undefined) return 'Try again in a moment.'
    const seconds = Math.ceil((retryAt - Date.now()) / 1000)
    if (seconds <= 0) return ''
    return `Try again in about ${seconds} ${seconds === 1 ? 'second' : 'seconds'}.`
  }, [retryAt])

  const remaining = retryAt === undefined ? null : Math.ceil((retryAt - now) / 1000)
  const done = remaining !== null && remaining <= 0
  return (
    <p className={className}>
      <span aria-hidden="true" data-testid="retry-countdown">
        {remaining === null ? (
          'Try again in a moment.'
        ) : done ? (
          'You can try again now.'
        ) : (
          <>
            Try again in <span className="font-mono-code">{remaining}</span> {remaining === 1 ? 'second' : 'seconds'}.
          </>
        )}
      </span>
      <span className="sr-only" data-testid="retry-spoken">{done ? '' : spoken}</span>
      <span role="status" className="sr-only">{done ? 'You can try again now.' : ''}</span>
    </p>
  )
}

/**
 * Non-blocking feedback surface. Renders the global store's `errors` (written
 * by `addError` from every API/validation failure handler) and any in-flight
 * `loadingOperations`, and lets the user dismiss individual entries or clear
 * them all.
 *
 * This is intentionally independent of the routing tree so a failure in a view
 * still surfaces a message.
 */
export function NotificationCenter() {
  const errors = useGlobalStore((state) => state.errors)
  const loadingOperations = useGlobalStore((state) => state.loadingOperations)
  const removeError = useGlobalStore((state) => state.removeError)
  const clearErrors = useGlobalStore((state) => state.clearErrors)

  return (
    <div
      aria-live="polite"
      aria-label="Notifications"
      // Bottom right, not top right: up there a notice covered the header's
      // graph selector, often the very control it was about. On a phone it
      // sits above the bottom navigation bar.
      className="pointer-events-none fixed bottom-4 right-4 z-[var(--z-notices)] flex w-full max-w-md flex-col gap-2 max-lg:inset-x-4 max-lg:bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] max-lg:w-auto max-h-[calc(100dvh-var(--app-header-h,7rem)-5rem)] overflow-y-auto max-lg:max-h-[calc(100dvh-var(--app-header-h,7rem)-7rem-env(safe-area-inset-bottom,0px))]"
    >
      {loadingOperations.size > 0 && (
        <div
          role="status"
          className="pointer-events-auto flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 shadow-lg"
        >
          <svg
            className="h-4 w-4 flex-shrink-0 animate-spin text-baseline"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          <span>Working… {[...loadingOperations].join(', ')}</span>
        </div>
      )}

      {errors.map((error) => {
        const style = STYLES[error.type]
        return (
          <div
            key={error.id}
            role={error.type === 'info' ? 'status' : 'alert'}
            data-testid={`notification-${error.type}`}
            className={`pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 shadow-lg ${style.container}`}
          >
            {errorIcon(style.icon)}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{style.label}</p>
              <p className="mt-0.5 text-sm break-words">{error.message}</p>
              {error.refusal !== undefined && (
                <RetryCountdown retryAt={error.retryAt} className="text-sm" />
              )}
            </div>
            <button
              type="button"
              onClick={() => removeError(error.id)}
              aria-label={`Dismiss ${style.label.toLowerCase()}`}
              className="flex-shrink-0 rounded p-1 hover:bg-current/10 focus:outline-none focus:ring-2 focus:ring-current"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )
      })}

      {errors.length > 1 && (
        <button
          type="button"
          onClick={clearErrors}
          className="pointer-events-auto self-end rounded-md border border-line bg-card px-3 py-1.5 text-xs font-medium text-ink-secondary shadow-sm hover:bg-subtle hover:text-ink focus:outline-none focus:ring-2 focus:ring-selected"
        >
          Dismiss all
        </button>
      )}
    </div>
  )
}
