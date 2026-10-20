/**
 * useApiKeyDashboard -- data access unit of the API key dashboard.
 *
 * The dashboard component no longer talks to React Query directly: it asks
 * this hook for the key list, the aggregate stats and the create/revoke/delete
 * mutations. The underlying queries, mutations and their cache invalidation
 * live in `@/hooks/useApiKeys`; this unit is the single place the dashboard
 * binds them together and where mutation failures are reported.
 *
 * The name is deliberately not `useApiKeys`: that is the design's name for the
 * lower-level hook in `@/hooks/useApiKeys`, which still exists and still owns
 * the queries. Two exported hooks with the same name and different contracts
 * would make an auto-import pick the wrong one.
 */

import { useCallback } from 'react'
import {
  useApiKeys as useApiKeysQuery,
  useApiKeyStats as useApiKeyStatsQuery,
  useCreateApiKey as useCreateApiKeyMutation,
  useRevokeApiKey as useRevokeApiKeyMutation,
  useDeleteApiKey as useDeleteApiKeyMutation,
} from '@/hooks/useApiKeys'
import type { ApiKey, ApiKeyStats, CreateApiKeyRequest, CreateApiKeyResponse } from '@/types'

export interface UseApiKeyDashboardResult {
  /** The API keys known to the server. */
  readonly keys: ApiKey[]
  /** Aggregate usage stats, undefined until they have loaded. */
  readonly stats: ApiKeyStats | undefined
  /** Whether the key list is still loading. */
  readonly isLoading: boolean
  /** The error raised while loading the key list, if any. */
  readonly error: Error | null
  /** Whether a create request is in flight. */
  readonly isCreating: boolean
  /** Whether a revoke request is in flight. */
  readonly isRevoking: boolean
  /** Whether a delete request is in flight. */
  readonly isDeleting: boolean
  /**
   * Creates a key. Resolves with the created key -- whose secret is only
   * returned once -- or null when the request failed.
   */
  readonly createKey: (request: CreateApiKeyRequest) => Promise<CreateApiKeyResponse | null>
  /** Revokes a key. Failures are logged, not thrown. */
  readonly revokeKey: (id: string) => Promise<void>
  /** Deletes a key. Failures are logged, not thrown. */
  readonly deleteKey: (id: string) => Promise<void>
}

/**
 * Provides the API key dashboard with its queries, mutations and
 * invalidation.
 */
export function useApiKeyDashboard(): UseApiKeyDashboardResult {
  const { data, isLoading, error } = useApiKeysQuery()
  const { data: stats } = useApiKeyStatsQuery()
  const createMutation = useCreateApiKeyMutation()
  const revokeMutation = useRevokeApiKeyMutation()
  const deleteMutation = useDeleteApiKeyMutation()

  // The dependencies are the mutation's stable members, not the mutation
  // object: `useMutation` returns a new object on every render, so depending
  // on it would rebuild these callbacks every render -- and the memoized list
  // item would never skip one either.
  const { mutateAsync: createAsync } = createMutation
  const { mutateAsync: revokeAsync } = revokeMutation
  const { mutateAsync: deleteAsync } = deleteMutation

  const createKey = useCallback(async (request: CreateApiKeyRequest): Promise<CreateApiKeyResponse | null> => {
    try {
      return await createAsync(request)
    } catch (err) {
      console.error('Failed to create API key:', err)
      return null
    }
  }, [createAsync])

  const revokeKey = useCallback(async (id: string): Promise<void> => {
    try {
      await revokeAsync(id)
    } catch (err) {
      console.error('Failed to revoke API key:', err)
    }
  }, [revokeAsync])

  const deleteKey = useCallback(async (id: string): Promise<void> => {
    try {
      await deleteAsync(id)
    } catch (err) {
      console.error('Failed to delete API key:', err)
    }
  }, [deleteAsync])

  return {
    keys: data?.keys || [],
    stats,
    isLoading,
    error,
    isCreating: createMutation.isPending,
    isRevoking: revokeMutation.isPending,
    isDeleting: deleteMutation.isPending,
    createKey,
    revokeKey,
    deleteKey,
  }
}
