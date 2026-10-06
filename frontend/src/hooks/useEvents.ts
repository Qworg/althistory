import { useQuery, useMutation, useQueryClient, UseMutationOptions } from '@tanstack/react-query'
import { apiClient } from '@/services/api'
import { submitMutation, type OfflineWriteOutcome } from '@/offline/offlineSync'
import { Event, EventFilters } from '@/types'
import { useGlobalStore } from '@/stores/globalStore'

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

export function useCreateEvent(
  options?: UseMutationOptions<OfflineWriteOutcome<Event>, Error, Omit<Event, 'id' | 'created_at' | 'updated_at'>>,
) {
  const queryClient = useQueryClient()
  const { addEvent } = useGlobalStore()

  return useMutation({
    // Offline-aware: the create is persisted in the durable offline queue and
    // replayed on reconnect when it cannot be sent now. See src/offline/README.md.
    mutationFn: (data: Omit<Event, 'id' | 'created_at' | 'updated_at'>) =>
      submitMutation<Event>(
        { method: 'POST', url: '/events', body: data },
        { send: () => apiClient.events.create(data) },
      ),
    onSuccess: (outcome) => {
      // Queued writes have no server entity: never add one to local state.
      if (outcome.delivery === 'queued') return
      queryClient.invalidateQueries({ queryKey: ['events'] })
      addEvent(outcome.value)
    },
    ...options,
  })
}

export function useUpdateEvent() {
  const queryClient = useQueryClient()
  const { updateEvent } = useGlobalStore()

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Event> }) =>
      submitMutation<Event>(
        { method: 'PUT', url: `/events/${id}`, body: data, entityKey: `event:${id}` },
        { send: () => apiClient.events.update(id, data) },
      ),
    onSuccess: (outcome) => {
      if (outcome.delivery === 'queued') return
      queryClient.invalidateQueries({ queryKey: ['events'] })
      updateEvent(outcome.value.id, outcome.value)
    },
  })
}

export function useDeleteEvent() {
  const queryClient = useQueryClient()
  const { deleteEvent } = useGlobalStore()

  return useMutation({
    mutationFn: (id: string) =>
      submitMutation<void>(
        { method: 'DELETE', url: `/events/${id}`, entityKey: `event:${id}` },
        { send: () => apiClient.events.delete(id) },
      ),
    onSuccess: (outcome, id) => {
      if (outcome.delivery === 'queued') return
      queryClient.invalidateQueries({ queryKey: ['events'] })
      deleteEvent(id)
    },
  })
}
