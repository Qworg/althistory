import { 
  useQuery, 
  useMutation, 
  useQueryClient,
  UseQueryOptions,
  UseMutationOptions
} from '@tanstack/react-query'
import { apiClient, APIError } from '@/services/api'
import { useActiveGraphId } from './useGraphs'
import { submitMutation, type OfflineWriteOutcome } from '@/offline/offlineSync'
import { useGlobalStore } from '@/stores/globalStore'
import { 
  Event, 
  Arc, 
  CausalRelationship, 
  InferredPressure,
  CreateEventRequest,
  UpdateEventRequest,
  CreateArcRequest,
  UpdateArcRequest,
  CausalRelationshipData,
  EventFilters,
  ArcFilters,
  CausalPath,
  CausalSuggestion,
  CopyResult,
  EntityFilter,
  TimeRange
} from '@/types'

// Query keys for React Query
export const queryKeys = {
  events: {
    all: ['events'] as const,
    lists: () => [...queryKeys.events.all, 'list'] as const,
    list: (filters?: EventFilters) => [...queryKeys.events.lists(), filters] as const,
    details: () => [...queryKeys.events.all, 'detail'] as const,
    detail: (id: string) => [...queryKeys.events.details(), id] as const,
    searches: () => [...queryKeys.events.all, 'search'] as const,
    search: (query: string, filters?: EventFilters) => [...queryKeys.events.searches(), query, filters] as const,
  },
  arcs: {
    all: ['arcs'] as const,
    lists: () => [...queryKeys.arcs.all, 'list'] as const,
    list: (filters?: ArcFilters) => [...queryKeys.arcs.lists(), filters] as const,
    details: () => [...queryKeys.arcs.all, 'detail'] as const,
    detail: (id: string) => [...queryKeys.arcs.details(), id] as const,
    hierarchy: () => [...queryKeys.arcs.all, 'hierarchy'] as const,
    childArcs: (parentId: string) => [...queryKeys.arcs.all, 'childArcs', parentId] as const,
  },
  causal: {
    all: ['causal'] as const,
    relationships: (eventId?: string) => [...queryKeys.causal.all, 'relationships', eventId] as const,
    chains: (startEventId: string, maxDepth?: number) => [...queryKeys.causal.all, 'chains', startEventId, maxDepth] as const,
    suggestions: (eventId: string) => [...queryKeys.causal.all, 'suggestions', eventId] as const,
  },
  inference: {
    all: ['inference'] as const,
    // The graph is part of the key: the backend scopes the request to the
    // active graph, so two graphs must not share a cache entry.
    pressures: (graphId?: string | null, filters?: unknown) =>
      [...queryKeys.inference.all, 'pressures', graphId ?? '', filters ?? {}] as const,
  },
  graph: {
    all: ['graph'] as const,
    copyStatus: (id: string) => [...queryKeys.graph.all, 'copyStatus', id] as const,
  }
} as const

// Event hooks
export function useEvents(filters?: EventFilters, options?: Omit<UseQueryOptions<Event[], APIError>, 'queryKey' | 'queryFn'>) {
  return useQuery({
    queryKey: queryKeys.events.list(filters),
    queryFn: () => apiClient.events.getAll(filters),
    staleTime: 5 * 60 * 1000, // 5 minutes
    ...options
  })
}

export function useEvent(id: string, options?: Omit<UseQueryOptions<Event, APIError>, 'queryKey' | 'queryFn'>) {
  return useQuery({
    queryKey: queryKeys.events.detail(id),
    queryFn: () => apiClient.events.getById(id),
    enabled: !!id,
    ...options
  })
}

export function useSearchEvents(query: string, filters?: EventFilters, options?: Omit<UseQueryOptions<Event[], APIError>, 'queryKey' | 'queryFn'>) {
  return useQuery({
    queryKey: queryKeys.events.search(query, filters),
    queryFn: () => apiClient.events.search(query, filters),
    enabled: query.length > 0,
    ...options
  })
}

export function useCreateEvent(options?: UseMutationOptions<OfflineWriteOutcome<Event>, Error, CreateEventRequest>) {
  const queryClient = useQueryClient()
  const addEvent = useGlobalStore(state => state.addEvent)
  
  return useMutation({
    // Offline-aware: an event create made while offline is persisted in the
    // durable queue and replayed on reconnect, instead of being lost. See
    // src/offline/README.md.
    mutationFn: (data: CreateEventRequest) =>
      submitMutation<Event>(
        { method: 'POST', url: '/events', body: data },
        { send: () => apiClient.events.create(data) },
      ),
    onSuccess: (outcome) => {
      // A queued write has no server entity yet: it must not be pushed into
      // local state as if the server had accepted it.
      if (outcome.delivery === 'queued') return

      // Update local state
      addEvent(outcome.value)
      
      // Invalidate and refetch related queries
      queryClient.invalidateQueries({ queryKey: queryKeys.events.all })
    },
    ...options
  })
}

export function useUpdateEvent(options?: UseMutationOptions<OfflineWriteOutcome<Event>, Error, { id: string; data: UpdateEventRequest }>) {
  const queryClient = useQueryClient()
  const updateEvent = useGlobalStore(state => state.updateEvent)
  
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateEventRequest }) =>
      submitMutation<Event>(
        { method: 'PUT', url: `/events/${id}`, body: data, entityKey: `event:${id}` },
        { send: () => apiClient.events.update(id, data) },
      ),
    onSuccess: (outcome, { id }) => {
      if (outcome.delivery === 'queued') return

      // Update local state
      updateEvent(id, outcome.value)
      
      // Invalidate and refetch related queries
      queryClient.invalidateQueries({ queryKey: queryKeys.events.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.causal.all })
    },
    ...options
  })
}

export function useDeleteEvent(options?: UseMutationOptions<OfflineWriteOutcome<void>, Error, string>) {
  const queryClient = useQueryClient()
  const deleteEvent = useGlobalStore(state => state.deleteEvent)
  
  return useMutation({
    mutationFn: (id: string) =>
      submitMutation<void>(
        { method: 'DELETE', url: `/events/${id}`, entityKey: `event:${id}` },
        { send: () => apiClient.events.delete(id) },
      ),
    onSuccess: (outcome, id) => {
      if (outcome.delivery === 'queued') return

      // Update local state
      deleteEvent(id)
      
      // Invalidate and refetch related queries
      queryClient.invalidateQueries({ queryKey: queryKeys.events.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.causal.all })
    },
    ...options
  })
}

// Arc hooks
export function useArcs(filters?: ArcFilters, options?: Omit<UseQueryOptions<Arc[], APIError>, 'queryKey' | 'queryFn'>) {
  return useQuery({
    queryKey: queryKeys.arcs.list(filters),
    queryFn: () => apiClient.arcs.getAll(filters),
    staleTime: 5 * 60 * 1000, // 5 minutes
    ...options
  })
}

export function useArc(id: string, options?: Omit<UseQueryOptions<Arc, APIError>, 'queryKey' | 'queryFn'>) {
  return useQuery({
    queryKey: queryKeys.arcs.detail(id),
    queryFn: () => apiClient.arcs.getById(id),
    enabled: !!id,
    ...options
  })
}

export function useArcHierarchy(options?: Omit<UseQueryOptions<Arc[], APIError>, 'queryKey' | 'queryFn'>) {
  return useQuery({
    queryKey: queryKeys.arcs.hierarchy(),
    queryFn: () => apiClient.arcs.getHierarchy(),
    staleTime: 5 * 60 * 1000, // 5 minutes
    ...options
  })
}

export function useCreateArc(options?: UseMutationOptions<OfflineWriteOutcome<Arc>, Error, CreateArcRequest>) {
  const queryClient = useQueryClient()
  const addArc = useGlobalStore(state => state.addArc)
  
  return useMutation({
    // Offline-aware, like the event hooks above.
    mutationFn: (data: CreateArcRequest) =>
      submitMutation<Arc>(
        { method: 'POST', url: '/arcs', body: data },
        { send: () => apiClient.arcs.create(data) },
      ),
    onSuccess: (outcome) => {
      if (outcome.delivery === 'queued') return

      // Update local state
      addArc(outcome.value)
      
      // Invalidate and refetch related queries
      queryClient.invalidateQueries({ queryKey: queryKeys.arcs.all })
    },
    ...options
  })
}

export function useUpdateArc(options?: UseMutationOptions<OfflineWriteOutcome<Arc>, Error, { id: string; data: UpdateArcRequest }>) {
  const queryClient = useQueryClient()
  const updateArc = useGlobalStore(state => state.updateArc)
  
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateArcRequest }) =>
      submitMutation<Arc>(
        { method: 'PUT', url: `/arcs/${id}`, body: data, entityKey: `arc:${id}` },
        { send: () => apiClient.arcs.update(id, data) },
      ),
    onSuccess: (outcome, { id }) => {
      if (outcome.delivery === 'queued') return

      // Update local state
      updateArc(id, outcome.value)
      
      // Invalidate and refetch related queries
      queryClient.invalidateQueries({ queryKey: queryKeys.arcs.all })
    },
    ...options
  })
}

export function useDeleteArc(options?: UseMutationOptions<OfflineWriteOutcome<void>, Error, string>) {
  const queryClient = useQueryClient()
  const deleteArc = useGlobalStore(state => state.deleteArc)
  
  return useMutation({
    mutationFn: (id: string) =>
      submitMutation<void>(
        { method: 'DELETE', url: `/arcs/${id}`, entityKey: `arc:${id}` },
        { send: () => apiClient.arcs.delete(id) },
      ),
    onSuccess: (outcome, id) => {
      if (outcome.delivery === 'queued') return

      // Update local state
      deleteArc(id)
      
      // Invalidate and refetch related queries
      queryClient.invalidateQueries({ queryKey: queryKeys.arcs.all })
    },
    ...options
  })
}

// Causal relationship hooks.
//
// NOT offline-queued (unlike the event/arc hooks above): these calls post a
// payload the API client transforms (`{causeEventId, effectEventId,
// relationship}` with different field names for create and update). Queueing
// them would mean duplicating that transform outside `services/api.ts`, so an
// offline call fails and is surfaced by the caller instead. It is NOT reported
// as saved. See src/offline/README.md.
export function useCausalRelationships(eventId?: string, options?: Omit<UseQueryOptions<CausalRelationship[], APIError>, 'queryKey' | 'queryFn'>) {
  return useQuery({
    queryKey: queryKeys.causal.relationships(eventId),
    queryFn: () => apiClient.causal.getRelationships(eventId),
    staleTime: 5 * 60 * 1000, // 5 minutes
    ...options
  })
}

export function useCausalChain(startEventId: string, maxDepth: number = 3, options?: Omit<UseQueryOptions<CausalPath[], APIError>, 'queryKey' | 'queryFn'>) {
  return useQuery({
    queryKey: queryKeys.causal.chains(startEventId, maxDepth),
    queryFn: () => apiClient.causal.findChain(startEventId, maxDepth),
    enabled: !!startEventId,
    ...options
  })
}

export function useCausalSuggestions(eventId: string, options?: Omit<UseQueryOptions<CausalSuggestion[], APIError>, 'queryKey' | 'queryFn'>) {
  return useQuery({
    queryKey: queryKeys.causal.suggestions(eventId),
    queryFn: () => apiClient.causal.getSuggestions(eventId),
    enabled: !!eventId,
    ...options
  })
}

export function useCreateCausalLink(options?: UseMutationOptions<CausalRelationship, APIError, { causeId: string; effectId: string; relationship: CausalRelationshipData }>) {
  const queryClient = useQueryClient()
  const addCausalRelationship = useGlobalStore(state => state.addCausalRelationship)
  
  return useMutation({
    mutationFn: ({ causeId, effectId, relationship }: { causeId: string; effectId: string; relationship: CausalRelationshipData }) =>
      apiClient.causal.createLink(causeId, effectId, relationship),
    onSuccess: (newRelationship) => {
      // Update local state
      addCausalRelationship(newRelationship)
      
      // Invalidate and refetch related queries
      queryClient.invalidateQueries({ queryKey: queryKeys.causal.all })
    },
    ...options
  })
}

export function useUpdateCausalLink(options?: UseMutationOptions<CausalRelationship, APIError, { causeEventId: string; effectEventId: string; data: Partial<CausalRelationshipData> }>) {
  const queryClient = useQueryClient()
  const updateCausalRelationship = useGlobalStore(state => state.updateCausalRelationship)

  return useMutation({
    mutationFn: ({ causeEventId, effectEventId, data }: { causeEventId: string; effectEventId: string; data: Partial<CausalRelationshipData> }) =>
      apiClient.causal.updateLink(causeEventId, effectEventId, data),
    onSuccess: (updatedRelationship, { causeEventId, effectEventId }) => {
      // Update local state
      const id = `${causeEventId}_${effectEventId}`
      updateCausalRelationship(id, updatedRelationship)

      // Invalidate and refetch related queries
      queryClient.invalidateQueries({ queryKey: queryKeys.causal.all })
    },
    ...options
  })
}

export function useDeleteCausalLink(options?: UseMutationOptions<void, APIError, { causeEventId: string; effectEventId: string }>) {
  const queryClient = useQueryClient()
  const deleteCausalRelationship = useGlobalStore(state => state.deleteCausalRelationship)

  return useMutation({
    mutationFn: ({ causeEventId, effectEventId }: { causeEventId: string; effectEventId: string }) =>
      apiClient.causal.deleteLink(causeEventId, effectEventId),
    onSuccess: (_, { causeEventId, effectEventId }) => {
      // Update local state
      const id = `${causeEventId}_${effectEventId}`
      deleteCausalRelationship(id)

      // Invalidate and refetch related queries
      queryClient.invalidateQueries({ queryKey: queryKeys.causal.all })
    },
    ...options
  })
}

// Inference hooks
export function useInferredPressures(
  /**
   * The filters the backend applies. They are sent with the request, because
   * the backend filters on them server-side.
   */
  filters?: {
    type?: string
    minStrength?: number
    minConfidence?: number
    limit?: number
    offset?: number
  },
  options?: Omit<UseQueryOptions<InferredPressure[], APIError>, 'queryKey' | 'queryFn'>
) {
  // The pressures are inferred over the graph, so the key carries the active
  // graph: without it, the pressures of one graph were served for another.
  const graphId = useActiveGraphId()
  return useQuery({
    queryKey: queryKeys.inference.pressures(graphId, filters),
    queryFn: () => apiClient.inference.getPressures(filters),
    staleTime: 10 * 60 * 1000, // 10 minutes - inference data changes less frequently
    ...options
  })
}

// Graph copy hooks
export function useCopyStatus(copyId: string, options?: Omit<UseQueryOptions<CopyResult, APIError>, 'queryKey' | 'queryFn'>) {
  return useQuery({
    queryKey: queryKeys.graph.copyStatus(copyId),
    queryFn: () => apiClient.graph.getCopyStatus(copyId),
    enabled: !!copyId,
    refetchInterval: (query) => {
      const data = query.state.data
      return data?.status === 'in_progress' ? 2000 : false
    },
    ...options
  })
}

export function useCopyFullGraph(options?: UseMutationOptions<CopyResult, APIError, string>) {
  return useMutation({
    mutationFn: (targetName: string) => apiClient.graph.copyFull(targetName),
    ...options
  })
}

export function useCopyGraphByTimeRange(options?: UseMutationOptions<CopyResult, APIError, { timeRange: TimeRange; targetName: string }>) {
  return useMutation({
    mutationFn: ({ timeRange, targetName }: { timeRange: TimeRange; targetName: string }) =>
      apiClient.graph.copyByTimeRange(timeRange, targetName),
    ...options
  })
}

export function useCopyGraphByFilter(options?: UseMutationOptions<CopyResult, APIError, { filter: EntityFilter; targetName: string }>) {
  return useMutation({
    mutationFn: ({ filter, targetName }: { filter: EntityFilter; targetName: string }) =>
      apiClient.graph.copyByFilter(filter, targetName),
    ...options
  })
}
