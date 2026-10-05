import { QueryClient } from '@tanstack/react-query'

/**
 * Errors rejected by the API layer carry an HTTP `status` (see `APIError`),
 * but TanStack Query types the query error as a plain `Error`. Widening the
 * error to this view lets the default retry policy read the status without an
 * unchecked cast at the call site.
 */
interface HttpStatusError extends Error {
  status?: number
}

const withStatus = (error: Error): HttpStatusError => error as HttpStatusError

// Create a client
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Global defaults for queries
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 10 * 60 * 1000, // 10 minutes (formerly cacheTime)
      retry: (failureCount, error) => {
        const status = withStatus(error).status
        // Don't retry on 4xx errors (client errors)
        if (status !== undefined && status >= 400 && status < 500) {
          return false
        }
        // Retry up to 3 times for other errors
        return failureCount < 3
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    },
    mutations: {
      // Global defaults for mutations
      retry: false, // Don't retry mutations by default
    },
  },
})