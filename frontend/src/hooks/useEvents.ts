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
