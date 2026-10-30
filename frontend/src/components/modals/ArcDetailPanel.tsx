import React, { useState, useEffect } from 'react'
import { Arc, Event, UpdateArcRequest, CreateArcRequest } from '@/types'
import { formatDuration } from '../timeline/arcHierarchyUtils'

// Helper to convert ISO string to datetime-local format (YYYY-MM-DDTHH:mm)
const isoToDatetimeLocal = (isoString: string): string => {
  if (!isoString) return ''
  try {
    const date = new Date(isoString)
    if (isNaN(date.getTime())) return ''
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    return `${year}-${month}-${day}T${hours}:${minutes}`
  } catch {
    return ''
  }
}

// Helper to convert datetime-local format to ISO string
const datetimeLocalToIso = (datetimeLocal: string): string => {
  if (!datetimeLocal) return ''
  try {
    const date = new Date(datetimeLocal)
    if (isNaN(date.getTime())) return ''
    return date.toISOString()
  } catch {
    return ''
  }
}

export interface ArcDetailPanelProps {
  arc: Arc | null
  isOpen: boolean
  onClose: () => void
  onSave: (updates: UpdateArcRequest) => Promise<void>
  onCreate?: (data: CreateArcRequest) => Promise<void>
  onDelete?: () => Promise<void>
  containedEvents?: Event[]
  childArcs?: Arc[]
  parentArc?: Arc | null
  className?: string
}

export const ArcDetailPanel: React.FC<ArcDetailPanelProps> = ({
  arc,
  isOpen,
  onClose,
  onSave,
  onCreate,
  onDelete,
  containedEvents = [],
  childArcs = [],
  parentArc = null,
  className = ''
}) => {
  const isCreateMode = !arc
  const [formData, setFormData] = useState<UpdateArcRequest>({})
  const [isLoading, setIsLoading] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Update form data when arc changes or reset for create mode
  useEffect(() => {
    if (arc) {
      setFormData({
        name: arc.name,
        description: arc.description,
        start_time: isoToDatetimeLocal(arc.start_time),
        end_time: isoToDatetimeLocal(arc.end_time),
        parent_arc_id: arc.parent_arc_id
      })
    } else {
      // Reset form for create mode
      setFormData({
        name: '',
        description: '',
        start_time: '',
        end_time: '',
        level: 0,
        parent_arc_id: null
      })
    }
    setErrors({})
  }, [arc, isOpen])

  // Close panel when Escape key is pressed
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  const handleInputChange = (field: keyof UpdateArcRequest, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }))
    }
  }

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (!formData.name?.trim()) {
      newErrors.name = 'Name is required'
    }

    if (!formData.description?.trim()) {
      newErrors.description = 'Description is required'
    }

    if (!formData.start_time) {
      newErrors.start_time = 'Start time is required'
    }

    if (!formData.end_time) {
      newErrors.end_time = 'End time is required'
    }

    if (formData.start_time && formData.end_time) {
      const startTime = new Date(formData.start_time)
      const endTime = new Date(formData.end_time)
      
      if (startTime >= endTime) {
        newErrors.end_time = 'End time must be after start time'
      }

      // Check if any contained events would be outside the new time range
      const startMs = startTime.getTime()
      const endMs = endTime.getTime()
      
      const eventsOutsideRange = containedEvents.filter(event => {
        const eventTime = new Date(event.timestamp).getTime()
        return eventTime < startMs || eventTime > endMs
      })

      if (eventsOutsideRange.length > 0) {
        newErrors.time_range = `${eventsOutsideRange.length} contained events would be outside the new time range`
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSave = async () => {
    if (!validateForm()) return

    setIsLoading(true)
    try {
      // Convert datetime-local format to ISO strings for API
      const start_time = datetimeLocalToIso(formData.start_time || '')
      const end_time = datetimeLocalToIso(formData.end_time || '')

      if (isCreateMode && onCreate) {
        // Create mode - ensure all required fields are present
        // Calculate level based on parent (default to 0 for top-level)
        const level = parentArc ? (parentArc.level !== undefined ? parentArc.level + 1 : 1) : 0
        const createData: CreateArcRequest = {
          name: formData.name || '',
          description: formData.description || '',
          start_time,
          end_time,
          level,
          parent_arc_id: formData.parent_arc_id
        }
        await onCreate(createData)
      } else {
        await onSave({
          ...formData,
          start_time,
          end_time
        })
      }
      onClose()
    } catch {
      setErrors({ general: `Failed to ${isCreateMode ? 'create' : 'save'} arc. Please try again.` })
    } finally {
      setIsLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!onDelete) return

    const confirmMessage = childArcs.length > 0 
      ? `This arc has ${childArcs.length} child arcs. Deleting it will also delete all child arcs. Are you sure?`
      : 'Are you sure you want to delete this arc?'

    if (!confirm(confirmMessage)) return

    setIsLoading(true)
    try {
      await onDelete()
      onClose()
    } catch {
      setErrors({ general: 'Failed to delete arc. Please try again.' })
    } finally {
      setIsLoading(false)
    }
  }

  if (!isOpen) return null

  const duration = arc ? formatDuration(new Date(arc.start_time), new Date(arc.end_time)) : null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="arc-panel-title"
      className={`fixed inset-y-0 right-0 w-96 bg-white shadow-xl border-l border-gray-200 transform transition-transform duration-300 ease-in-out z-50 ${className}`}
    >
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 id="arc-panel-title" className="text-lg font-semibold text-gray-900">
            {isCreateMode ? 'Create Arc' : 'Arc Details'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-md transition-colors"
            aria-label="Close panel"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* General Error */}
          {errors.general && (
            <div className="bg-red-50 border border-red-200 rounded-md p-3" role="alert">
              <p className="text-sm text-red-600">{errors.general}</p>
            </div>
          )}

          {/* Basic Information */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-gray-900">Basic Information</h3>
            
            <div>
              <label htmlFor="arc-name" className="block text-sm font-medium text-gray-700 mb-1">
                Name <span className="text-red-500">*</span>
              </label>
              <input
                id="arc-name"
                type="text"
                value={formData.name || ''}
                onChange={(e) => handleInputChange('name', e.target.value)}
                aria-required="true"
                aria-invalid={!!errors.name}
                aria-describedby={errors.name ? 'arc-name-error' : undefined}
                className={`w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                  errors.name ? 'border-red-300' : 'border-gray-300'
                }`}
                placeholder="Enter arc name"
              />
              {errors.name && <p id="arc-name-error" role="alert" className="mt-1 text-sm text-red-600">{errors.name}</p>}
            </div>

            <div>
              <label htmlFor="arc-description" className="block text-sm font-medium text-gray-700 mb-1">
                Description <span className="text-red-500">*</span>
              </label>
              <textarea
                id="arc-description"
                value={formData.description || ''}
                onChange={(e) => handleInputChange('description', e.target.value)}
                rows={3}
                aria-required="true"
                aria-invalid={!!errors.description}
                aria-describedby={errors.description ? 'arc-description-error' : undefined}
                className={`w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                  errors.description ? 'border-red-300' : 'border-gray-300'
                }`}
                placeholder="Enter arc description"
              />
              {errors.description && <p id="arc-description-error" role="alert" className="mt-1 text-sm text-red-600">{errors.description}</p>}
            </div>
          </div>

          {/* Time Range */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-gray-900">Time Range</h3>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="arc-start-time" className="block text-sm font-medium text-gray-700 mb-1">
                  Start Time <span className="text-red-500">*</span>
                </label>
                <input
                  id="arc-start-time"
                  type="datetime-local"
                  value={formData.start_time || ''}
                  onChange={(e) => handleInputChange('start_time', e.target.value)}
                  aria-required="true"
                  aria-invalid={!!errors.start_time}
                  aria-describedby={errors.start_time ? 'arc-start-time-error' : undefined}
                  className={`w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                    errors.start_time ? 'border-red-300' : 'border-gray-300'
                  }`}
                />
                {errors.start_time && <p id="arc-start-time-error" role="alert" className="mt-1 text-sm text-red-600">{errors.start_time}</p>}
              </div>

              <div>
                <label htmlFor="arc-end-time" className="block text-sm font-medium text-gray-700 mb-1">
                  End Time <span className="text-red-500">*</span>
                </label>
                <input
                  id="arc-end-time"
                  type="datetime-local"
                  value={formData.end_time || ''}
                  onChange={(e) => handleInputChange('end_time', e.target.value)}
                  aria-required="true"
                  aria-invalid={!!errors.end_time}
                  aria-describedby={errors.end_time ? 'arc-end-time-error' : undefined}
                  className={`w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                    errors.end_time ? 'border-red-300' : 'border-gray-300'
                  }`}
                />
                {errors.end_time && <p id="arc-end-time-error" role="alert" className="mt-1 text-sm text-red-600">{errors.end_time}</p>}
              </div>
            </div>

            {errors.time_range && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3" role="alert">
                <p className="text-sm text-yellow-600">{errors.time_range}</p>
              </div>
            )}

            {duration && (
              <div className="text-sm text-gray-500">
                Duration: {duration}
              </div>
            )}
          </div>

          {/* Hierarchy Information - only show in edit mode */}
          {!isCreateMode && (
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-gray-900">Hierarchy</h3>

              {parentArc && (
                <div className="bg-gray-50 rounded-md p-3">
                  <p className="text-sm text-gray-600">
                    <span className="font-medium">Parent Arc:</span> {parentArc.name}
                  </p>
                </div>
              )}

              {childArcs.length > 0 && (
                <div className="bg-gray-50 rounded-md p-3">
                  <p className="text-sm text-gray-600 mb-2">
                    <span className="font-medium">Child Arcs ({childArcs.length}):</span>
                  </p>
                  <ul className="space-y-1">
                    {childArcs.map(child => (
                      <li key={child.id} className="text-sm text-gray-500 pl-2">
                        • {child.name}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Contained Events - only show in edit mode */}
          {!isCreateMode && (
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-gray-900">
                Contained Events ({containedEvents.length})
              </h3>

              {containedEvents.length > 0 ? (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {containedEvents.map(event => (
                    <div key={event.id} className="bg-gray-50 rounded-md p-3">
                      <p className="text-sm font-medium text-gray-900">{event.description}</p>
                      <p className="text-xs text-gray-500">
                        {event.actor} → {event.target} • {new Date(event.timestamp).toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500 italic">No events contained in this arc</p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 p-4 space-y-3">
          <div className="flex space-x-3">
            <button
              onClick={handleSave}
              disabled={isLoading}
              className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? (isCreateMode ? 'Creating...' : 'Saving...') : (isCreateMode ? 'Create Arc' : 'Save Changes')}
            </button>
            <button
              onClick={onClose}
              disabled={isLoading}
              className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Cancel
            </button>
          </div>

          {!isCreateMode && onDelete && (
            <button
              onClick={handleDelete}
              disabled={isLoading}
              className="w-full bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? 'Deleting...' : 'Delete Arc'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default ArcDetailPanel
