/**
 * Graph Management Hooks
 * 
 * React Query hooks for managing multiple graphs, versions, and branching.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { apiClient } from '@/services/api'
import {
  CreateGraphRequest,
  UpdateGraphRequest,
  BranchGraphRequest,
  MergeGraphRequest,
  GraphStatus
} from '@/types'

// Query keys
export const graphKeys = {
  all: ['graphs'] as const,
  lists: () => [...graphKeys.all, 'list'] as const,
  list: (filters: { status?: GraphStatus }) => [...graphKeys.lists(), filters] as const,
  details: () => [...graphKeys.all, 'detail'] as const,
  detail: (id: string) => [...graphKeys.details(), id] as const,
  versions: (id: string) => [...graphKeys.detail(id), 'versions'] as const,
  branches: (id: string) => [...graphKeys.detail(id), 'branches'] as const,
}

/**
 * Hook to get current active graph ID
 */
export function useActiveGraphId() {
  const [activeGraphId, setActiveGraphId] = useState<string | null>(() => {
    return localStorage.getItem('active_graph_id')
  })

  useEffect(() => {
    const handleGraphSwitch = (event: CustomEvent<{ graphId: string }>) => {
      setActiveGraphId(event.detail.graphId)
    }

    window.addEventListener('graph-switched', handleGraphSwitch as EventListener)
    return () => {
      window.removeEventListener('graph-switched', handleGraphSwitch as EventListener)
    }
  }, [])

  return activeGraphId
}

/**
 * Hook to list all graphs
 */
export function useGraphs(options?: { status?: GraphStatus; limit?: number; offset?: number }) {
  return useQuery({
    queryKey: graphKeys.list({ status: options?.status }),
    queryFn: () => apiClient.graphs.getAll(options),
    staleTime: 30000, // 30 seconds
  })
}

/**
 * Hook to get a single graph by ID
 */
export function useGraph(id: string | null | undefined) {
  return useQuery({
    queryKey: graphKeys.detail(id!),
    queryFn: () => apiClient.graphs.getById(id!),
    enabled: !!id,
  })
}

/**
 * Hook to get current active graph
 */
export function useActiveGraph() {
  const activeGraphId = useActiveGraphId()
  return useGraph(activeGraphId)
}

/**
 * Hook to get graph version history
 */
export function useGraphVersions(id: string | null | undefined, limit?: number) {
  return useQuery({
    queryKey: graphKeys.versions(id!),
    queryFn: () => apiClient.graphs.getVersions(id!, limit),
    enabled: !!id,
  })
}

/**
 * Hook to get graph branches
 */
export function useGraphBranches(id: string | null | undefined) {
  return useQuery({
    queryKey: graphKeys.branches(id!),
    queryFn: () => apiClient.graphs.getBranches(id!),
    enabled: !!id,
  })
}

/**
 * Hook to create a new graph
 */
export function useCreateGraph() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: CreateGraphRequest) => apiClient.graphs.create(data),
    onSuccess: (newGraph) => {
      // Invalidate and refetch graph list
      queryClient.invalidateQueries({ queryKey: graphKeys.lists() })
      // Add to cache
      queryClient.setQueryData(graphKeys.detail(newGraph.id), newGraph)
    },
  })
}

/**
 * Hook to update a graph
 */
export function useUpdateGraph() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateGraphRequest }) => 
      apiClient.graphs.update(id, data),
    onSuccess: (updatedGraph) => {
      queryClient.setQueryData(graphKeys.detail(updatedGraph.id), updatedGraph)
      queryClient.invalidateQueries({ queryKey: graphKeys.lists() })
    },
  })
}

/**
 * Hook to delete a graph
 */
export function useDeleteGraph() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => apiClient.graphs.delete(id),
    onSuccess: (_, deletedId) => {
      queryClient.removeQueries({ queryKey: graphKeys.detail(deletedId) })
      queryClient.invalidateQueries({ queryKey: graphKeys.lists() })
    },
  })
}

/**
 * Hook to branch a graph
 */
export function useBranchGraph() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: BranchGraphRequest }) => 
      apiClient.graphs.branch(id, data),
    onSuccess: (newBranch, { id }) => {
      queryClient.invalidateQueries({ queryKey: graphKeys.lists() })
      queryClient.invalidateQueries({ queryKey: graphKeys.branches(id) })
      queryClient.setQueryData(graphKeys.detail(newBranch.id), newBranch)
    },
  })
}

/**
 * Hook to merge graphs
 */
export function useMergeGraph() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: MergeGraphRequest }) => 
      apiClient.graphs.merge(id, data),
    onSuccess: (mergedGraph, { id }) => {
      queryClient.setQueryData(graphKeys.detail(id), mergedGraph)
      queryClient.invalidateQueries({ queryKey: graphKeys.lists() })
      queryClient.invalidateQueries({ queryKey: graphKeys.branches(id) })
      queryClient.invalidateQueries({ queryKey: graphKeys.versions(id) })
    },
  })
}

/**
 * Hook to rollback a graph to a previous version
 */
export function useRollbackGraph() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) => 
      apiClient.graphs.rollback(id, version),
    onSuccess: (updatedGraph, { id }) => {
      queryClient.setQueryData(graphKeys.detail(id), updatedGraph)
      queryClient.invalidateQueries({ queryKey: graphKeys.versions(id) })
      // Invalidate all data queries as the graph data has changed
      queryClient.invalidateQueries({ queryKey: ['events'] })
      queryClient.invalidateQueries({ queryKey: ['arcs'] })
      queryClient.invalidateQueries({ queryKey: ['causal'] })
    },
  })
}

/**
 * Hook to switch active graph
 */
export function useSwitchGraph() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => apiClient.graphs.switch(id),
    onSuccess: () => {
      // Invalidate all data queries to refresh with new graph's data
      queryClient.invalidateQueries({ queryKey: ['events'] })
      queryClient.invalidateQueries({ queryKey: ['arcs'] })
      queryClient.invalidateQueries({ queryKey: ['causal'] })
      queryClient.invalidateQueries({ queryKey: ['pressures'] })
    },
  })
}

/**
 * Combined hook for graph management with common operations
 */
export function useGraphManagement() {
  const activeGraphId = useActiveGraphId()
  const { data: graphs, isLoading: isLoadingGraphs, error: graphsError } = useGraphs()
  const { data: activeGraph, isLoading: isLoadingActive } = useActiveGraph()
  
  const createGraph = useCreateGraph()
  const updateGraph = useUpdateGraph()
  const deleteGraph = useDeleteGraph()
  const branchGraph = useBranchGraph()
  const mergeGraph = useMergeGraph()
  const rollbackGraph = useRollbackGraph()
  const switchGraph = useSwitchGraph()

  const handleSwitchGraph = useCallback((graphId: string) => {
    switchGraph.mutate(graphId)
  }, [switchGraph])

  const handleCreateGraph = useCallback((data: CreateGraphRequest) => {
    return createGraph.mutateAsync(data)
  }, [createGraph])

  const handleBranchGraph = useCallback((graphId: string, branchName: string, version?: number) => {
    return branchGraph.mutateAsync({ id: graphId, data: { branchName, version } })
  }, [branchGraph])

  const handleRollback = useCallback((graphId: string, version: number) => {
    return rollbackGraph.mutateAsync({ id: graphId, version })
  }, [rollbackGraph])

  return {
    // State
    activeGraphId,
    activeGraph,
    graphs: graphs?.graphs || [],
    totalGraphs: graphs?.total || 0,
    
    // Loading states
    isLoading: isLoadingGraphs || isLoadingActive,
    isLoadingGraphs,
    isLoadingActive,
    
    // Errors
    error: graphsError,
    
    // Mutations
    createGraph: handleCreateGraph,
    updateGraph: updateGraph.mutate,
    deleteGraph: deleteGraph.mutate,
    branchGraph: handleBranchGraph,
    mergeGraph: mergeGraph.mutate,
    rollbackGraph: handleRollback,
    switchGraph: handleSwitchGraph,
    
    // Mutation states
    isCreating: createGraph.isPending,
    isUpdating: updateGraph.isPending,
    isDeleting: deleteGraph.isPending,
    isBranching: branchGraph.isPending,
    isMerging: mergeGraph.isPending,
    isRollingBack: rollbackGraph.isPending,
    isSwitching: switchGraph.isPending,
  }
}
