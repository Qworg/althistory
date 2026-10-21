/**
 * Hook for managing API keys
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api'
import type { 
  ApiKey, 
  CreateApiKeyRequest, 
  CreateApiKeyResponse, 
  UpdateApiKeyRequest,
  ApiKeyStats,
  ApiKeyUsage
} from '@/types'

const QUERY_KEYS = {
  keys: ['apiKeys'] as const,
  key: (id: string) => ['apiKeys', id] as const,
  stats: ['apiKeys', 'stats'] as const,
  usage: (id: string) => ['apiKeys', id, 'usage'] as const,
}

/**
 * Hook to fetch all API keys
 */
export function useApiKeys(options?: { activeOnly?: boolean }) {
  return useQuery({
    queryKey: [...QUERY_KEYS.keys, options],
    queryFn: () => apiClient.keys.getAll(options),
    staleTime: 30000, // 30 seconds
  })
}

/**
 * Hook to fetch a single API key by ID
 * Note: Reserved for future API key detail/edit page
 */
export function useApiKey(id: string) {
  return useQuery({
    queryKey: QUERY_KEYS.key(id),
    queryFn: () => apiClient.keys.getById(id),
    enabled: !!id,
  })
}

/**
 * Hook to fetch API key statistics
 */
export function useApiKeyStats() {
  return useQuery({
    queryKey: QUERY_KEYS.stats,
    queryFn: () => apiClient.keys.getStats(),
    staleTime: 60000, // 1 minute
  })
}

/**
 * Hook to fetch the current usage of one API key.
 *
 * The query is disabled without an id, so a component can hold the hook for
 * the key it is showing and only fetch when there is one.
 */
export function useApiKeyUsage(id: string) {
  return useQuery({
    queryKey: QUERY_KEYS.usage(id),
    queryFn: (): Promise<ApiKeyUsage> => apiClient.keys.getUsage(id),
    enabled: !!id,
    staleTime: 15000, // 15 seconds -- the usage moves quickly
    // An open panel would otherwise keep showing a count whose window has
    // already reset, until the window regains focus.
    refetchInterval: 30000,
  })
}

/**
 * Hook to create a new API key
 */
export function useCreateApiKey() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: CreateApiKeyRequest) => apiClient.keys.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.keys })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.stats })
    },
  })
}

/**
 * Hook to update an API key
 */
export function useUpdateApiKey() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateApiKeyRequest }) =>
      apiClient.keys.update(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.keys })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.key(id) })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.stats })
    },
  })
}

/**
 * Hook to revoke an API key
 */
export function useRevokeApiKey() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => apiClient.keys.revoke(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.keys })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.stats })
    },
  })
}

/**
 * Hook to delete an API key
 */
export function useDeleteApiKey() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => apiClient.keys.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.keys })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.stats })
    },
  })
}

export type { ApiKey, CreateApiKeyRequest, CreateApiKeyResponse, UpdateApiKeyRequest, ApiKeyStats }
