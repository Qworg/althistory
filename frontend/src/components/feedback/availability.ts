import { useQuery } from '@tanstack/react-query'
import { apiClient, APIError } from '@/services/api'
import { DEMO_MODE } from '@/demo/flag'
import { FEEDBACK_BUILT_IN } from './buildFlag'

export { FEEDBACK_BUILT_IN }

/**
 * What the server says about feedback (`GET /api/feedback/config`): whether it
 * is on (FEEDBACK_ENABLED), whether the server files reports, and where. The
 * demo has no server, so it asks nothing.
 */
export function useFeedbackConfig() {
  return useQuery({
    queryKey: ['feedback-config'],
    queryFn: () => apiClient.feedback.getConfig(),
    enabled: FEEDBACK_BUILT_IN && !DEMO_MODE,
    // Asked again on focus after a while, so a long-open tab follows the
    // operator's switch; opening feedback asks again too (FeedbackHost).
    staleTime: 5 * 60_000,
    // The app's usual retries: one failed call must not decide it.
  })
}

/**
 * Whether to offer feedback: built in, and not turned off by the server. It
 * fails closed. Until the server has answered it is not offered, so a private
 * install that turned it off never shows the button, even for a moment. Only a
 * 404, a server older than this feature, offers it without an answer (GitHub's
 * form needs no server). A 5xx while the API restarts, a network error, or a
 * proxy's 403 says nothing about the operator's choice, so it offers nothing.
 */
export function feedbackAvailable(
  config: Pick<ReturnType<typeof useFeedbackConfig>, 'data' | 'error'>,
  /** Whether the server has ever answered 404 here: a later failed refetch does not make it newer. */
  sawNotFound = false
): boolean {
  if (!FEEDBACK_BUILT_IN) return false
  if (DEMO_MODE) return true
  if (config.data) return config.data.enabled !== false
  return sawNotFound || isNotFound(config.error)
}

export function isNotFound(error: unknown): boolean {
  return error instanceof APIError && error.status === 404
}
