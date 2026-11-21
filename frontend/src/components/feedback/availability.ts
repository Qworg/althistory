import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/services/api'
import { DEMO_MODE } from '@/demo/flag'

/**
 * Whether this build has feedback at all. `VITE_FEEDBACK_ENABLED=false` at
 * build time leaves it out: no button, no shortcut, nothing captured.
 */
export const FEEDBACK_BUILT_IN = import.meta.env.VITE_FEEDBACK_ENABLED !== 'false'

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
    staleTime: Infinity,
    retry: false,
  })
}

/**
 * Whether to offer feedback: built in, and not turned off by the server. Until
 * the server has answered it is not offered, so a private install that turned
 * it off never shows the button, even for a moment. If the server cannot say
 * (an older server, or no connection), it is offered: GitHub's form needs no
 * server.
 */
export function feedbackAvailable(config: ReturnType<typeof useFeedbackConfig>): boolean {
  if (!FEEDBACK_BUILT_IN) return false
  if (DEMO_MODE) return true
  if (config.isError) return true
  if (!config.data) return false
  return config.data.enabled !== false
}
