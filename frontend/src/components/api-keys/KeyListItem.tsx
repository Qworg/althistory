/**
 * KeyListItem -- a single API key in the dashboard list.
 *
 * Presentational: the key, the revoke/delete callbacks and the in-flight
 * flags of the surrounding mutations are handed in by the parent.
 */

import { memo, useState } from 'react'
import type { ApiKey } from '@/types'
import { PERMISSION_LABELS } from './permissions'
import { KeyUsagePanel } from './KeyUsagePanel'

export interface KeyListItemProps {
  /** The key to render. */
  readonly apiKey: ApiKey
  /** Called with the key id when the user asks to revoke the key. */
  readonly onRevoke: (id: string) => void
  /** Called with the key id when the user asks to delete the key. */
  readonly onDelete: (id: string) => void
  /** Whether a revoke request is in flight. */
  readonly isRevoking: boolean
  /** Whether a delete request is in flight. */
  readonly isDeleting: boolean
}

export const KeyListItem = memo(function KeyListItem({
  apiKey,
  onRevoke,
  onDelete,
  isRevoking,
  isDeleting,
}: KeyListItemProps) {
  const [showUsage, setShowUsage] = useState(false)
  const isExpired = apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date()
  const statusColor = !apiKey.isActive
    ? 'bg-gray-100 text-gray-600'
    : isExpired
      ? 'bg-red-100 text-red-600'
      : 'bg-green-100 text-green-600'
  const statusText = !apiKey.isActive
    ? 'Revoked'
    : isExpired
      ? 'Expired'
      : 'Active'

  return (
    <div className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors">
      <div className="flex justify-between items-start">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h4 className="font-medium text-gray-900">{apiKey.name}</h4>
            <span className={`px-2 py-0.5 text-xs rounded-full ${statusColor}`}>
              {statusText}
            </span>
          </div>
          <p className="text-sm font-mono text-gray-500">{apiKey.keyPrefix}...</p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setShowUsage((open) => !open)}
            className="px-3 py-1 text-sm text-gray-600 hover:bg-gray-50 rounded-md transition-colors"
            aria-expanded={showUsage}
          >
            {showUsage ? 'Hide usage' : 'Usage'}
          </button>
          {apiKey.isActive && !isExpired && (
            <button
              onClick={() => onRevoke(apiKey.id)}
              disabled={isRevoking}
              className="px-3 py-1 text-sm text-yellow-600 hover:bg-yellow-50 rounded-md transition-colors disabled:opacity-50"
            >
              Revoke
            </button>
          )}
          <button
            onClick={() => onDelete(apiKey.id)}
            disabled={isDeleting}
            className="px-3 py-1 text-sm text-red-600 hover:bg-red-50 rounded-md transition-colors disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1">
        {apiKey.permissions.slice(0, 5).map((perm) => (
          <span key={perm} className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">
            {PERMISSION_LABELS[perm]}
          </span>
        ))}
        {apiKey.permissions.length > 5 && (
          <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">
            +{apiKey.permissions.length - 5} more
          </span>
        )}
      </div>

      {showUsage && <KeyUsagePanel keyId={apiKey.id} />}

      <div className="mt-2 flex gap-4 text-xs text-gray-500">
        <span>Created: {new Date(apiKey.createdAt).toLocaleDateString()}</span>
        {apiKey.lastUsedAt && (
          <span>Last used: {new Date(apiKey.lastUsedAt).toLocaleDateString()}</span>
        )}
        {apiKey.expiresAt && (
          <span>Expires: {new Date(apiKey.expiresAt).toLocaleDateString()}</span>
        )}
      </div>
    </div>
  )
})

export default KeyListItem
