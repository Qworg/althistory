/**
 * useApiKeys -- data access unit of the API key dashboard.
 *
 * The dashboard component no longer talks to React Query directly: it asks
 * this hook for the key list, the usage stats and the create/revoke/delete
 * mutations. The underlying queries, mutations and their cache invalidation
 * live in `@/hooks/useApiKeys`; this unit is the single place the dashboard
 * binds them together and where mutation failures are reported.
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

export interface UseApiKeysResult {
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
export function useApiKeys(): UseApiKeysResult {
  const { data, isLoading, error } = useApiKeysQuery()
  const { data: stats } = useApiKeyStatsQuery()
  const createMutation = useCreateApiKeyMutation()
  const revokeMutation = useRevokeApiKeyMutation()
  const deleteMutation = useDeleteApiKeyMutation()

  const createKey = useCallback(async (request: CreateApiKeyRequest): Promise<CreateApiKeyResponse | null> => {
    try {
      return await createMutation.mutateAsync(request)
    } catch (err) {
      console.error('Failed to create API key:', err)
      return null
    }
  }, [createMutation])

  const revokeKey = useCallback(async (id: string): Promise<void> => {
    try {
      await revokeMutation.mutateAsync(id)
    } catch (err) {
      console.error('Failed to revoke API key:', err)
    }
  }, [revokeMutation])

  const deleteKey = useCallback(async (id: string): Promise<void> => {
    try {
      await deleteMutation.mutateAsync(id)
    } catch (err) {
      console.error('Failed to delete API key:', err)
    }
  }, [deleteMutation])

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
