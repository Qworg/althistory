/**
 * API Key Dashboard Modal
 * Admin interface for managing API keys
 */

import React, { useState, useCallback } from 'react'
import { ModalBase } from '@/components/modals/ModalBase'
import { 
  useApiKeys, 
  useApiKeyStats, 
  useCreateApiKey, 
  useRevokeApiKey,
  useDeleteApiKey 
} from '@/hooks/useApiKeys'
import type { ApiKey, Permission, CreateApiKeyRequest, CreateApiKeyResponse } from '@/types'

interface ApiKeyDashboardProps {
  isOpen: boolean
  onClose: () => void
}

const PERMISSION_LABELS: Record<Permission, string> = {
  'read:events': 'Read Events',
  'write:events': 'Write Events',
  'read:arcs': 'Read Arcs',
  'write:arcs': 'Write Arcs',
  'read:relationships': 'Read Relationships',
  'write:relationships': 'Write Relationships',
  'read:graphs': 'Read Graphs',
  'write:graphs': 'Write Graphs',
  'export': 'Export',
  'import': 'Import',
  'ingest': 'Ingest',
  'admin': 'Admin',
}

const PERMISSION_GROUPS = {
  readOnly: ['read:events', 'read:arcs', 'read:relationships', 'read:graphs', 'export'] as Permission[],
  readWrite: ['read:events', 'write:events', 'read:arcs', 'write:arcs', 'read:relationships', 'write:relationships', 'read:graphs', 'write:graphs', 'export', 'import'] as Permission[],
  full: ['read:events', 'write:events', 'read:arcs', 'write:arcs', 'read:relationships', 'write:relationships', 'read:graphs', 'write:graphs', 'export', 'import', 'ingest'] as Permission[],
}

export const ApiKeyDashboard: React.FC<ApiKeyDashboardProps> = ({ isOpen, onClose }) => {
  const [view, setView] = useState<'list' | 'create'>('list')
  const [newKeyResponse, setNewKeyResponse] = useState<CreateApiKeyResponse | null>(null)
  const [copiedKey, setCopiedKey] = useState(false)

  const { data: keysData, isLoading, error } = useApiKeys()
  const { data: stats } = useApiKeyStats()
  const createMutation = useCreateApiKey()
  const revokeMutation = useRevokeApiKey()
  const deleteMutation = useDeleteApiKey()

  const handleCreateKey = useCallback(async (request: CreateApiKeyRequest) => {
    try {
      const response = await createMutation.mutateAsync(request)
      setNewKeyResponse(response)
    } catch (err) {
      console.error('Failed to create API key:', err)
    }
  }, [createMutation])

  const handleCopyKey = useCallback(async () => {
    if (newKeyResponse?.key) {
      await navigator.clipboard.writeText(newKeyResponse.key)
      setCopiedKey(true)
      setTimeout(() => setCopiedKey(false), 2000)
    }
  }, [newKeyResponse])

  const handleCloseNewKey = useCallback(() => {
    setNewKeyResponse(null)
    setView('list')
  }, [])

  const handleRevoke = useCallback(async (id: string) => {
    if (confirm('Are you sure you want to revoke this API key? This action cannot be undone.')) {
      try {
        await revokeMutation.mutateAsync(id)
      } catch (err) {
        console.error('Failed to revoke API key:', err)
      }
    }
  }, [revokeMutation])

  const handleDelete = useCallback(async (id: string) => {
    if (confirm('Are you sure you want to permanently delete this API key? This action cannot be undone.')) {
      try {
        await deleteMutation.mutateAsync(id)
      } catch (err) {
        console.error('Failed to delete API key:', err)
      }
    }
  }, [deleteMutation])

  // Show new key response
  if (newKeyResponse) {
    return (
      <ModalBase
        isOpen={isOpen}
        onClose={handleCloseNewKey}
        title="API Key Created"
        size="lg"
        closeOnBackdrop={false}
      >
        <div className="space-y-4">
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <div className="flex items-start">
              <svg className="w-5 h-5 text-yellow-600 mt-0.5 mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <h4 className="text-yellow-800 font-medium">Save this key now!</h4>
                <p className="text-yellow-700 text-sm mt-1">
                  This is the only time you'll see the full API key. Copy it and store it securely.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">API Key</label>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={newKeyResponse.key}
                className="flex-1 px-3 py-2 bg-gray-100 border border-gray-300 rounded-md font-mono text-sm"
              />
              <button
                onClick={handleCopyKey}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
              >
                {copiedKey ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-500">Name:</span>
              <span className="ml-2 font-medium">{newKeyResponse.name}</span>
            </div>
            <div>
              <span className="text-gray-500">Prefix:</span>
              <span className="ml-2 font-mono">{newKeyResponse.keyPrefix}</span>
            </div>
          </div>

          <div className="flex justify-end pt-4">
            <button
              onClick={handleCloseNewKey}
              className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      </ModalBase>
    )
  }

  return (
    <ModalBase
      isOpen={isOpen}
      onClose={onClose}
      title="API Key Management"
      size="3xl"
      footer={
        <div className="flex justify-between items-center">
          {stats && (
            <div className="text-sm text-gray-600">
              {stats.active} active / {stats.total} total keys
            </div>
          )}
          <div className="flex gap-2">
            {view === 'create' ? (
              <button
                onClick={() => setView('list')}
                className="px-4 py-2 text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
            ) : (
              <button
                onClick={() => setView('create')}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
              >
                Create New Key
              </button>
            )}
          </div>
        </div>
      }
    >
      {view === 'create' ? (
        <CreateKeyForm 
          onSubmit={handleCreateKey} 
          isLoading={createMutation.isPending}
        />
      ) : (
        <KeyList
          keys={keysData?.keys || []}
          isLoading={isLoading}
          error={error}
          onRevoke={handleRevoke}
          onDelete={handleDelete}
          isRevoking={revokeMutation.isPending}
          isDeleting={deleteMutation.isPending}
        />
      )}
    </ModalBase>
  )
}

interface CreateKeyFormProps {
  onSubmit: (data: CreateApiKeyRequest) => void
  isLoading: boolean
}

const CreateKeyForm: React.FC<CreateKeyFormProps> = ({ onSubmit, isLoading }) => {
  const [name, setName] = useState('')
  const [permissionPreset, setPermissionPreset] = useState<'readOnly' | 'readWrite' | 'full' | 'custom'>('readOnly')
  const [customPermissions, setCustomPermissions] = useState<Permission[]>([])
  const [expiresAt, setExpiresAt] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    
    const permissions = permissionPreset === 'custom' 
      ? customPermissions 
      : PERMISSION_GROUPS[permissionPreset]

    onSubmit({
      name,
      permissions,
      expiresAt: expiresAt || undefined,
    })
  }

  const togglePermission = (permission: Permission) => {
    setCustomPermissions(prev => 
      prev.includes(permission)
        ? prev.filter(p => p !== permission)
        : [...prev, permission]
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Key Name *
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., Production API Key"
          required
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Permissions
        </label>
        <div className="space-y-2">
          <select
            value={permissionPreset}
            onChange={(e) => setPermissionPreset(e.target.value as typeof permissionPreset)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="readOnly">Read Only</option>
            <option value="readWrite">Read & Write</option>
            <option value="full">Full Access</option>
            <option value="custom">Custom</option>
          </select>

          {permissionPreset === 'custom' && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 p-3 bg-gray-50 rounded-md">
              {Object.entries(PERMISSION_LABELS).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={customPermissions.includes(key as Permission)}
                    onChange={() => togglePermission(key as Permission)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  {label}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Expiration (optional)
        </label>
        <input
          type="datetime-local"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
          min={new Date().toISOString().slice(0, 16)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
        <p className="text-xs text-gray-500 mt-1">Leave empty for no expiration</p>
      </div>

      <button
        type="submit"
        disabled={!name || isLoading || (permissionPreset === 'custom' && customPermissions.length === 0)}
        className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
      >
        {isLoading ? 'Creating...' : 'Create API Key'}
      </button>
    </form>
  )
}

interface KeyListProps {
  keys: ApiKey[]
  isLoading: boolean
  error: Error | null
  onRevoke: (id: string) => void
  onDelete: (id: string) => void
  isRevoking: boolean
  isDeleting: boolean
}

const KeyList: React.FC<KeyListProps> = ({ 
  keys, 
  isLoading, 
  error, 
  onRevoke, 
  onDelete,
  isRevoking,
  isDeleting 
}) => {
  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600">Failed to load API keys</p>
        <p className="text-sm text-gray-500 mt-1">{error.message}</p>
      </div>
    )
  }

  if (keys.length === 0) {
    return (
      <div className="text-center py-12">
        <svg className="w-12 h-12 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
        </svg>
        <p className="text-gray-600">No API keys yet</p>
        <p className="text-sm text-gray-500 mt-1">Create your first API key to get started</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {keys.map((key) => (
        <KeyListItem
          key={key.id}
          apiKey={key}
          onRevoke={onRevoke}
          onDelete={onDelete}
          isRevoking={isRevoking}
          isDeleting={isDeleting}
        />
      ))}
    </div>
  )
}

interface KeyListItemProps {
  apiKey: ApiKey
  onRevoke: (id: string) => void
  onDelete: (id: string) => void
  isRevoking: boolean
  isDeleting: boolean
}

const KeyListItem: React.FC<KeyListItemProps> = ({ 
  apiKey, 
  onRevoke, 
  onDelete,
  isRevoking,
  isDeleting 
}) => {
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
}

export default ApiKeyDashboard
