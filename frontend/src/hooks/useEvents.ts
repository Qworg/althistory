/**
 * The event *queries*.
 *
 * The event mutations live in `@/hooks/useAPI`, which is what the app
 * imports; they are the offline-aware ones (a write made while offline is
 * queued and replayed). A second copy used to live here and was never
 * imported -- the same call with a different implementation, which is a trap
 * rather than a convenience.
 */

import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/services/api'
import { EventFilters } from '@/types'

/**
 * How many events a view asks for: the API's maximum. Without an explicit
 * limit the API returns fifty, so a view that omitted it silently drew part of
 * a larger graph (the causal graph, the actor list, the filter panel's actors).
 */
export const VIEW_EVENT_LIMIT = 1000

export function useEvents(filters?: EventFilters) {
  return useQuery({
    queryKey: ['events', filters],
    queryFn: () => apiClient.events.getAll(filters),
  })
}

export function useEvent(id: string) {
  return useQuery({
    queryKey: ['events', id],
    queryFn: () => apiClient.events.getById(id),
    enabled: !!id,
  })
}
