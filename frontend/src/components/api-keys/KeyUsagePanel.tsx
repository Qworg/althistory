/**
 * KeyUsagePanel -- the usage of one API key, fetched when it is opened.
 *
 * The dashboard lists every key, and the usage of each one is a separate
 * request. Fetching them all when the list renders would ask the server for
 * one request per key, so the usage is only fetched once the user opens it.
 *
 * The panel owns the query and hands the result to `KeyUsageStats`, which is
 * presentational.
 */

import React from 'react'
import { useApiKeyUsage } from '@/hooks/useApiKeys'
import { APIError } from '@/services/api'
import { KeyUsageStats } from './KeyUsageStats'

export interface KeyUsagePanelProps {
  /** The key whose usage to show. */
  readonly keyId: string
}

export const KeyUsagePanel: React.FC<KeyUsagePanelProps> = ({ keyId }) => {
  const { data, isLoading, error } = useApiKeyUsage(keyId)

  if (isLoading) {
    return (
      <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-500">
        Loading usage...
      </div>
    )
  }

  if (error) {
    // The key was deleted while its usage was open: there is nothing to show
    // and nothing to complain about. Any other 404 -- a server without this
    // route, say -- is a failure the user should hear about.
    if (
      error instanceof APIError &&
      error.status === 404 &&
      error.code === 'KEY_NOT_FOUND'
    ) {
      return null
    }

    return (
      <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-red-600">
        Could not load the usage of this key.
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      <KeyUsageStats
        keyId={data.keyId}
        rateLimit={data.rateLimit}
        currentUsage={data.currentUsage}
      />
    </div>
  )
}

export default KeyUsagePanel
