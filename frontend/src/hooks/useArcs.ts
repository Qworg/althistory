import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api'
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
    mutationFn: (data: Omit<Arc, 'id' | 'created_at' | 'updated_at'>) =>
      apiClient.arcs.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['arcs'] })
    },
  })
}

export function useUpdateArc() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Arc> }) =>
      apiClient.arcs.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['arcs'] })
    },
  })
}

export function useDeleteArc() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => apiClient.arcs.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['arcs'] })
    },
  })
}