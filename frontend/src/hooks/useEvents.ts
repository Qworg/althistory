import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api'
import { Event } from '@/types'
import { useGlobalStore } from '@/stores/globalStore'

export function useEvents(filters?: Record<string, any>) {
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

export function useCreateEvent() {
  const queryClient = useQueryClient()
  const { addEvent } = useGlobalStore()

  return useMutation({
    mutationFn: (data: Omit<Event, 'id' | 'created_at' | 'updated_at'>) =>
      apiClient.events.create(data),
    onSuccess: (newEvent) => {
      queryClient.invalidateQueries({ queryKey: ['events'] })
      addEvent(newEvent)
    },
  })
}

export function useUpdateEvent() {
  const queryClient = useQueryClient()
  const { updateEvent } = useGlobalStore()

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Event> }) =>
      apiClient.events.update(id, data),
    onSuccess: (updatedEvent) => {
      queryClient.invalidateQueries({ queryKey: ['events'] })
      updateEvent(updatedEvent.id, updatedEvent)
    },
  })
}

export function useDeleteEvent() {
  const queryClient = useQueryClient()
  const { deleteEvent } = useGlobalStore()

  return useMutation({
    mutationFn: (id: string) => apiClient.events.delete(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['events'] })
      deleteEvent(id)
    },
  })
}