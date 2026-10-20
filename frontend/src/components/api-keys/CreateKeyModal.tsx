/**
 * CreateKeyModal -- the create view of the API key dashboard.
 *
 * The unit owns the form body only: the modal chrome (title, footer buttons
 * and dismissal) belongs to the composition root, so the dashboard keeps
 * rendering exactly one dialog and the focus trap / ARIA wiring of the
 * shared ModalBase is untouched.
 */

import React, { useState } from 'react'
import type { CreateApiKeyRequest, Permission } from '@/types'
import { PERMISSION_GROUPS, PERMISSION_LABELS } from './permissions'

export interface CreateKeyModalProps {
  /** Whether the create view is showing. */
  readonly isOpen: boolean
  /** Called with the create request when the form is submitted. */
  readonly onCreate: (request: CreateApiKeyRequest) => void
  /** Whether a create request is in flight. */
  readonly isLoading: boolean
}

export const CreateKeyModal: React.FC<CreateKeyModalProps> = ({ isOpen, onCreate, isLoading }) => {
  const [name, setName] = useState('')
  const [permissionPreset, setPermissionPreset] = useState<'readOnly' | 'readWrite' | 'full' | 'custom'>('readOnly')
  const [customPermissions, setCustomPermissions] = useState<Permission[]>([])
  const [expiresAt, setExpiresAt] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    const permissions = permissionPreset === 'custom'
      ? customPermissions
      : PERMISSION_GROUPS[permissionPreset]

    onCreate({
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

  if (!isOpen) return null

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

export default CreateKeyModal
