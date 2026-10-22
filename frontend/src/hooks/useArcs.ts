/**
 * The arc *queries*.
 *
 * The arc mutations live in `@/hooks/useAPI`, which is what the app imports;
 * they are the offline-aware ones. A second copy used to live here and was
 * never imported.
 */

import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/services/api'
import { ArcFilters } from '@/types'

export function useArcs(filters?: ArcFilters) {
  return useQuery({
    queryKey: ['arcs', filters],
    queryFn: () => apiClient.arcs.getAll(filters),
  })
}

export function useArc(id: string) {
  return useQuery({
    queryKey: ['arcs', id],
    queryFn: () => apiClient.arcs.getById(id),
    enabled: !!id,
  })
}
