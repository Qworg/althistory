/**
 * CreateGraphModal Component
 * 
 * A modal for creating new graphs with name and description inputs.
 * Includes validation and loading states.
 */

import { memo, useState, useCallback, useEffect } from 'react'
import { ModalBase } from '@/components/modals/ModalBase'
import { CreateGraphRequest } from '@/types'

interface CreateGraphModalProps {
  /** Whether the modal is open */
  isOpen: boolean
  /** Called when the modal should close */
  onClose: () => void
  /** Called when a new graph should be created */
  onCreate: (request: CreateGraphRequest) => void | Promise<void>
  /** Whether a create operation is in progress */
  isCreating?: boolean
}

interface FormErrors {
  name?: string
}

export const CreateGraphModal = memo(function CreateGraphModal({
  isOpen,
  onClose,
  onCreate,
  isCreating = false,
}: CreateGraphModalProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [errors, setErrors] = useState<FormErrors>({})
  const [touched, setTouched] = useState<Record<string, boolean>>({})

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setName('')
      setDescription('')
      setErrors({})
      setTouched({})
    }
  }, [isOpen])

  // Validation
  const validate = useCallback((): boolean => {
    const newErrors: FormErrors = {}

    if (!name.trim()) {
      newErrors.name = 'Name is required'
    } else if (name.trim().length < 2) {
      newErrors.name = 'Name must be at least 2 characters'
    } else if (name.trim().length > 100) {
      newErrors.name = 'Name must be less than 100 characters'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }, [name])

  // Handle field blur for validation
  const handleBlur = useCallback((field: string) => {
    setTouched(prev => ({ ...prev, [field]: true }))
    validate()
  }, [validate])

  // Handle form submission
  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    
    setTouched({ name: true })
    
    if (!validate()) {
      return
    }

    try {
      await onCreate({
        name: name.trim(),
        description: description.trim() || undefined,
      })
      onClose()
    } catch (error) {
      console.error('Failed to create graph:', error)
    }
  }, [name, description, validate, onCreate, onClose])

  const handleCancel = useCallback(() => {
    onClose()
  }, [onClose])

  const footer = (
    <div className="flex justify-end gap-3">
      <button
        type="button"
        onClick={handleCancel}
        disabled={isCreating}
        className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded transition-colors disabled:opacity-50"
      >
        Cancel
      </button>
      <button
        type="submit"
        form="create-graph-form"
        disabled={isCreating || !name.trim()}
        className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
      >
        {isCreating ? (
          <>
            <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Creating...
          </>
        ) : (
          'Create Graph'
        )}
      </button>
    </div>
  )

  return (
    <ModalBase
      isOpen={isOpen}
      onClose={onClose}
      title="Create New Graph"
      size="md"
      footer={footer}
    >
      <form id="create-graph-form" onSubmit={handleSubmit} className="space-y-4">
        {/* Name Input */}
        <div>
          <label htmlFor="graph-name" className="block text-sm font-medium text-gray-700 mb-1">
            Name <span className="text-red-500">*</span>
          </label>
          <input
            id="graph-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => handleBlur('name')}
            placeholder="Enter graph name..."
            className={`
              w-full px-3 py-2 border rounded-lg text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
              ${touched.name && errors.name ? 'border-red-300 bg-red-50' : 'border-gray-300'}
            `}
            disabled={isCreating}
            autoFocus
          />
          {touched.name && errors.name && (
            <p className="mt-1 text-xs text-red-600">{errors.name}</p>
          )}
        </div>

        {/* Description Input */}
        <div>
          <label htmlFor="graph-description" className="block text-sm font-medium text-gray-700 mb-1">
            Description
          </label>
          <textarea
            id="graph-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Enter a description (optional)..."
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            disabled={isCreating}
          />
          <p className="mt-1 text-xs text-gray-400">
            Briefly describe the purpose or content of this graph.
          </p>
        </div>

        {/* Info Box */}
        <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
          <div className="flex gap-2">
            <svg className="w-5 h-5 text-blue-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" 
              />
            </svg>
            <div className="text-sm text-blue-700">
              <p className="font-medium">Creating a new graph</p>
              <p className="text-blue-600 mt-1">
                This will create an empty graph. You can add events, arcs, and relationships after creation.
              </p>
            </div>
          </div>
        </div>
      </form>
    </ModalBase>
  )
})

export default CreateGraphModal
