import { 
  useQuery, 
  useMutation, 
  useQueryClient,
  UseQueryOptions,
  UseMutationOptions
} from '@tanstack/react-query'
import { apiClient, APIError } from '@/services/api'
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
    pressures: (arcId?: string) => [...queryKeys.inference.all, 'pressures', arcId] as const,
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

export function useCreateEvent(options?: UseMutationOptions<Event, APIError, CreateEventRequest>) {
  const queryClient = useQueryClient()
  const { addEvent } = useGlobalStore(state => ({
    addEvent: state.addEvent
  }))
  
  return useMutation({
    mutationFn: (data: CreateEventRequest) => apiClient.events.create(data),
    onSuccess: (newEvent) => {
      // Update local state
      addEvent(newEvent)
      
      // Invalidate and refetch related queries
      queryClient.invalidateQueries({ queryKey: queryKeys.events.all })
    },
    ...options
  })
}

export function useUpdateEvent(options?: UseMutationOptions<Event, APIError, { id: string; data: UpdateEventRequest }>) {
  const queryClient = useQueryClient()
  const { updateEvent } = useGlobalStore(state => ({
    updateEvent: state.updateEvent
  }))
  
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateEventRequest }) => 
      apiClient.events.update(id, data),
    onSuccess: (updatedEvent, { id }) => {
      // Update local state
      updateEvent(id, updatedEvent)
      
      // Invalidate and refetch related queries
      queryClient.invalidateQueries({ queryKey: queryKeys.events.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.causal.all })
    },
    ...options
  })
}

export function useDeleteEvent(options?: UseMutationOptions<void, APIError, string>) {
  const queryClient = useQueryClient()
  const { deleteEvent } = useGlobalStore(state => ({
    deleteEvent: state.deleteEvent
  }))
  
  return useMutation({
    mutationFn: (id: string) => apiClient.events.delete(id),
    onSuccess: (_, id) => {
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

export function useCreateArc(options?: UseMutationOptions<Arc, APIError, CreateArcRequest>) {
  const queryClient = useQueryClient()
  const { addArc } = useGlobalStore(state => ({
    addArc: state.addArc
  }))
  
  return useMutation({
    mutationFn: (data: CreateArcRequest) => apiClient.arcs.create(data),
    onSuccess: (newArc) => {
      // Update local state
      addArc(newArc)
      
      // Invalidate and refetch related queries
      queryClient.invalidateQueries({ queryKey: queryKeys.arcs.all })
    },
    ...options
  })
}

export function useUpdateArc(options?: UseMutationOptions<Arc, APIError, { id: string; data: UpdateArcRequest }>) {
  const queryClient = useQueryClient()
  const { updateArc } = useGlobalStore(state => ({
    updateArc: state.updateArc
  }))
  
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateArcRequest }) => 
      apiClient.arcs.update(id, data),
    onSuccess: (updatedArc, { id }) => {
      // Update local state
      updateArc(id, updatedArc)
      
      // Invalidate and refetch related queries
      queryClient.invalidateQueries({ queryKey: queryKeys.arcs.all })
    },
    ...options
  })
}

export function useDeleteArc(options?: UseMutationOptions<void, APIError, string>) {
  const queryClient = useQueryClient()
  const { deleteArc } = useGlobalStore(state => ({
    deleteArc: state.deleteArc
  }))
  
  return useMutation({
    mutationFn: (id: string) => apiClient.arcs.delete(id),
    onSuccess: (_, id) => {
      // Update local state
      deleteArc(id)
      
      // Invalidate and refetch related queries
      queryClient.invalidateQueries({ queryKey: queryKeys.arcs.all })
    },
    ...options
  })
}

// Causal relationship hooks
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
  const { addCausalRelationship } = useGlobalStore(state => ({
    addCausalRelationship: state.addCausalRelationship
  }))
  
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

export function useUpdateCausalLink(options?: UseMutationOptions<CausalRelationship, APIError, { id: string; data: Partial<CausalRelationship> }>) {
  const queryClient = useQueryClient()
  const { updateCausalRelationship } = useGlobalStore(state => ({
    updateCausalRelationship: state.updateCausalRelationship
  }))
  
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CausalRelationship> }) =>
      apiClient.causal.updateLink(id, data),
    onSuccess: (updatedRelationship, { id }) => {
      // Update local state
      updateCausalRelationship(id, updatedRelationship)
      
      // Invalidate and refetch related queries
      queryClient.invalidateQueries({ queryKey: queryKeys.causal.all })
    },
    ...options
  })
}

export function useDeleteCausalLink(options?: UseMutationOptions<void, APIError, string>) {
  const queryClient = useQueryClient()
  const { deleteCausalRelationship } = useGlobalStore(state => ({
    deleteCausalRelationship: state.deleteCausalRelationship
  }))
  
  return useMutation({
    mutationFn: (id: string) => apiClient.causal.deleteLink(id),
    onSuccess: (_, id) => {
      // Update local state
      deleteCausalRelationship(id)
      
      // Invalidate and refetch related queries
      queryClient.invalidateQueries({ queryKey: queryKeys.causal.all })
    },
    ...options
  })
}

// Inference hooks
export function useInferredPressures(arcId?: string, options?: Omit<UseQueryOptions<InferredPressure[], APIError>, 'queryKey' | 'queryFn'>) {
  return useQuery({
    queryKey: queryKeys.inference.pressures(arcId),
    queryFn: () => apiClient.inference.getPressures(arcId),
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
