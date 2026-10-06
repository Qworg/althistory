import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api'
import { submitMutation, type OfflineWriteOutcome } from '@/offline/offlineSync'
import { Arc, ArcFilters } from '@/types'

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

export function useCreateArc() {
  const queryClient = useQueryClient()

  return useMutation({
    // Offline-aware: persisted in the durable offline queue and replayed on
    // reconnect when it cannot be sent now. See src/offline/README.md.
    mutationFn: (data: Omit<Arc, 'id' | 'created_at' | 'updated_at'>) =>
      submitMutation<Arc>(
        { method: 'POST', url: '/arcs', body: data },
        { send: () => apiClient.arcs.create(data) },
      ),
    onSuccess: (outcome: OfflineWriteOutcome<Arc>) => {
      // Queued writes have no server entity: the arc list is left untouched.
      if (outcome.delivery === 'queued') return
      queryClient.invalidateQueries({ queryKey: ['arcs'] })
    },
  })
}

export function useUpdateArc() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Arc> }) =>
      submitMutation<Arc>(
        { method: 'PUT', url: `/arcs/${id}`, body: data, entityKey: `arc:${id}` },
        { send: () => apiClient.arcs.update(id, data) },
      ),
    onSuccess: (outcome: OfflineWriteOutcome<Arc>) => {
      if (outcome.delivery === 'queued') return
      queryClient.invalidateQueries({ queryKey: ['arcs'] })
    },
  })
}

export function useDeleteArc() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) =>
      submitMutation<void>(
        { method: 'DELETE', url: `/arcs/${id}`, entityKey: `arc:${id}` },
        { send: () => apiClient.arcs.delete(id) },
      ),
    onSuccess: (outcome: OfflineWriteOutcome<void>) => {
      if (outcome.delivery === 'queued') return
      queryClient.invalidateQueries({ queryKey: ['arcs'] })
    },
  })
}
