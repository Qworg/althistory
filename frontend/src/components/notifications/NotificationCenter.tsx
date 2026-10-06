import { useGlobalStore } from '@/stores/globalStore'
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
    container: 'bg-gray-50 border-gray-200 text-gray-800',
    icon: 'text-gray-600',
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
      className="pointer-events-none fixed top-4 right-4 z-50 flex w-full max-w-md flex-col gap-2"
    >
      {loadingOperations.size > 0 && (
        <div
          role="status"
          className="pointer-events-auto flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 shadow-lg"
        >
          <svg
            className="h-4 w-4 flex-shrink-0 animate-spin text-blue-600"
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
            role="alert"
            data-testid={`notification-${error.type}`}
            className={`pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 shadow-lg ${style.container}`}
          >
            {errorIcon(style.icon)}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wide opacity-80">{style.label}</p>
              <p className="mt-0.5 text-sm break-words">{error.message}</p>
            </div>
            <button
              type="button"
              onClick={() => removeError(error.id)}
              aria-label={`Dismiss ${style.label.toLowerCase()}`}
              className="flex-shrink-0 rounded p-1 hover:bg-black/5 focus:outline-none focus:ring-2 focus:ring-current"
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
          className="pointer-events-auto self-end rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400"
        >
          Dismiss all
        </button>
      )}
    </div>
  )
}
