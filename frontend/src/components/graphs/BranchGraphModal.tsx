/**
 * BranchGraphModal Component
 * 
 * A modal for creating a branch from an existing graph.
 * Shows source graph information and allows naming the new branch.
 */

import { memo, useState, useCallback, useEffect } from 'react'
import { ModalBase } from '@/components/modals/ModalBase'
import { Graph } from '@/types'

interface BranchGraphModalProps {
  /** Whether the modal is open */
  isOpen: boolean
  /** Called when the modal should close */
  onClose: () => void
  /** The source graph to branch from */
  sourceGraph: Graph | null
  /** Called when a branch should be created */
  onBranch: (branchName: string, description?: string) => void | Promise<void>
  /** Whether a branch operation is in progress */
  isBranching?: boolean
}

interface FormErrors {
  branchName?: string
}

export const BranchGraphModal = memo(function BranchGraphModal({
  isOpen,
  onClose,
  sourceGraph,
  onBranch,
  isBranching = false,
}: BranchGraphModalProps) {
  const [branchName, setBranchName] = useState('')
  const [description, setDescription] = useState('')
  const [errors, setErrors] = useState<FormErrors>({})
  const [touched, setTouched] = useState<Record<string, boolean>>({})

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setBranchName('')
      setDescription('')
      setErrors({})
      setTouched({})
    }
  }, [isOpen])

  // Validation
  const validate = useCallback((): boolean => {
    const newErrors: FormErrors = {}

    if (!branchName.trim()) {
      newErrors.branchName = 'Branch name is required'
    } else if (branchName.trim().length < 2) {
      newErrors.branchName = 'Branch name must be at least 2 characters'
    } else if (branchName.trim().length > 50) {
      newErrors.branchName = 'Branch name must be less than 50 characters'
    } else if (!/^[a-zA-Z0-9-_]+$/.test(branchName.trim())) {
      newErrors.branchName = 'Branch name can only contain letters, numbers, hyphens, and underscores'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }, [branchName])

  // Handle field blur for validation
  const handleBlur = useCallback((field: string) => {
    setTouched(prev => ({ ...prev, [field]: true }))
    validate()
  }, [validate])

  // Handle form submission
  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    
    setTouched({ branchName: true })
    
    if (!validate()) {
      return
    }

    try {
      await onBranch(branchName.trim(), description.trim() || undefined)
      onClose()
    } catch (error) {
      console.error('Failed to create branch:', error)
    }
  }, [branchName, description, validate, onBranch, onClose])

  const handleCancel = useCallback(() => {
    onClose()
  }, [onClose])

  const footer = (
    <div className="flex justify-end gap-3">
      <button
        type="button"
        onClick={handleCancel}
        disabled={isBranching}
        className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded transition-colors disabled:opacity-50"
      >
        Cancel
      </button>
      <button
        type="submit"
        form="branch-graph-form"
        disabled={isBranching || !branchName.trim()}
        className="px-4 py-2 text-sm bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
      >
        {isBranching ? (
          <>
            <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Creating Branch...
          </>
        ) : (
          <>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" 
              />
            </svg>
            Create Branch
          </>
        )}
      </button>
    </div>
  )

  if (!sourceGraph) {
    return null
  }

  return (
    <ModalBase
      isOpen={isOpen}
      onClose={onClose}
      title="Branch Graph"
      size="md"
      footer={footer}
    >
      <form id="branch-graph-form" onSubmit={handleSubmit} className="space-y-4">
        {/* Source Graph Info */}
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">Branching from</div>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold text-gray-900">{sourceGraph.name}</div>
              {sourceGraph.description && (
                <div className="text-sm text-gray-500 mt-1 line-clamp-1">{sourceGraph.description}</div>
              )}
            </div>
            <div className="text-right">
              <div className="text-sm text-gray-600">Version {sourceGraph.version}</div>
              <div className="text-xs text-gray-400">
                {sourceGraph.metadata.eventCount} events, {sourceGraph.metadata.arcCount} arcs
              </div>
            </div>
          </div>
        </div>

        {/* Branch Name Input */}
        <div>
          <label htmlFor="branch-name" className="block text-sm font-medium text-gray-700 mb-1">
            Branch Name <span className="text-red-500">*</span>
          </label>
          <input
            id="branch-name"
            type="text"
            value={branchName}
            onChange={(e) => setBranchName(e.target.value)}
            onBlur={() => handleBlur('branchName')}
            placeholder="e.g., what-if-scenario, alternate-timeline"
            className={`
              w-full px-3 py-2 border rounded-lg text-sm
              focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent
              ${touched.branchName && errors.branchName ? 'border-red-300 bg-red-50' : 'border-gray-300'}
            `}
            disabled={isBranching}
            autoFocus
          />
          {touched.branchName && errors.branchName && (
            <p className="mt-1 text-xs text-red-600">{errors.branchName}</p>
          )}
          <p className="mt-1 text-xs text-gray-400">
            Use letters, numbers, hyphens, or underscores only.
          </p>
        </div>

        {/* Description Input */}
        <div>
          <label htmlFor="branch-description" className="block text-sm font-medium text-gray-700 mb-1">
            Description
          </label>
          <textarea
            id="branch-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the purpose of this branch (optional)..."
            rows={2}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
            disabled={isBranching}
          />
        </div>

        {/* Info Box */}
        <div className="bg-purple-50 border border-purple-100 rounded-lg p-3">
          <div className="flex gap-2">
            <svg className="w-5 h-5 text-purple-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" 
              />
            </svg>
            <div className="text-sm text-purple-700">
              <p className="font-medium">What is branching?</p>
              <p className="text-purple-600 mt-1">
                Branching creates a copy of the current graph that you can modify independently. 
                Perfect for exploring "what-if" scenarios or alternative timelines.
              </p>
            </div>
          </div>
        </div>
      </form>
    </ModalBase>
  )
})

export default BranchGraphModal
