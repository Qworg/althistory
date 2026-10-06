import { Component, ErrorInfo, ReactNode } from 'react'

export interface ErrorBoundaryProps {
  children: ReactNode
  /**
   * Optional custom fallback. When omitted the boundary renders its built-in
   * recovery screen with a reload affordance.
   */
  fallback?: ReactNode
  /**
   * Overrides the reload action used by the default fallback. Defaults to a
   * full page reload; injectable so the recovery path can be exercised in tests
   * where jsdom does not allow `window.location.reload` to be replaced.
   */
  onReload?: () => void
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

/**
 * Catches render/lifecycle errors in the subtree below it so a single broken
 * view cannot blank the whole application. The default fallback is a real
 * screen with a "Reload page" affordance (and a "Try again" reset that retries
 * rendering without a full navigation).
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Keep the original stack visible for debugging; React only forwards it here.
    console.error('ErrorBoundary caught an error:', error, errorInfo)
  }

  private handleReload = (): void => {
    const { onReload } = this.props
    if (onReload) {
      onReload()
      return
    }
    if (typeof window !== 'undefined') {
      window.location.reload()
    }
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false, error: null })
  }

  render(): ReactNode {
    const { hasError, error } = this.state
    const { children, fallback } = this.props

    if (!hasError) {
      return children
    }

    if (fallback !== undefined) {
      return fallback
    }

    return (
      <div
        role="alert"
        className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-12"
      >
        <div className="max-w-md w-full bg-white border border-red-200 rounded-lg shadow-sm p-6">
          <div className="flex items-start gap-3">
            <svg
              className="w-6 h-6 flex-shrink-0 text-red-600"
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
            <div>
              <h1 className="text-lg font-semibold text-red-800">Something went wrong</h1>
              <p className="mt-1 text-sm text-gray-600">
                An unexpected error stopped this part of the interface from rendering.
              </p>
              {error?.message && (
                <pre className="mt-3 overflow-x-auto rounded bg-gray-100 p-2 text-xs text-gray-700">
                  {error.message}
                </pre>
              )}
            </div>
          </div>

          <div className="mt-5 flex gap-3">
            <button
              type="button"
              onClick={this.handleReload}
              className="inline-flex items-center rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
            >
              Reload page
            </button>
            <button
              type="button"
              onClick={this.handleRetry}
              className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    )
  }
}
