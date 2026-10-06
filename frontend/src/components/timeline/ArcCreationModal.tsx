import React, { useState, useEffect } from 'react'
import { TimeRange, CreateArcRequest, Event, Arc } from '@/types'
import { useCreateArc } from '@/hooks/useAPI'

// Helper to convert ISO string to datetime-local format (YYYY-MM-DDTHH:mm)
const isoToDatetimeLocal = (isoString: string): string => {
  if (!isoString) return ''
  try {
    const date = new Date(isoString)
    if (isNaN(date.getTime())) return ''
    // Format as local datetime
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
    // datetime-local is in local time, create Date from it
    const date = new Date(datetimeLocal)
    if (isNaN(date.getTime())) return ''
    return date.toISOString()
  } catch {
    return ''
  }
}

export interface ArcCreationModalProps {
  isOpen: boolean
  onClose: () => void
  timeRange: TimeRange | null
  containedEvents: Event[]
  parentArcs: Arc[]
  onSuccess?: (arc: Arc) => void
  className?: string
}

export const ArcCreationModal: React.FC<ArcCreationModalProps> = ({
  isOpen,
  onClose,
  timeRange,
  containedEvents = [],
  parentArcs = [],
  onSuccess,
  className = ''
}) => {
  const [formData, setFormData] = useState<CreateArcRequest>({
    name: '',
    description: '',
    start_time: '',
    end_time: '',
    level: 0,
    parent_arc_id: null
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [selectedParentId, setSelectedParentId] = useState<string | null>(null)

  const createArcMutation = useCreateArc({
    onSuccess: (outcome) => {
      // A queued write (offline) has no server entity: the arc was saved on this
      // device and will be created when the connection returns, so `onSuccess`
      // is not called with an id it does not have yet. The offline notification
      // and the pending count are the signal for that case.
      if (outcome.delivery === 'sent') {
        onSuccess?.(outcome.value)
      }
      onClose()
      resetForm()
    }
  })

  // Calculate level based on parent arc selection
  const calculateLevel = (parentId: string | null): number => {
    if (!parentId) return 0
    const parentArc = parentArcs.find(arc => arc.id === parentId)
    // Use parent's level + 1, or default to 1 if parent has no level
    return parentArc?.level !== undefined ? parentArc.level + 1 : 1
  }

  // Initialize form data when timeRange changes
  useEffect(() => {
    if (timeRange && isOpen) {
      setFormData({
        name: '',
        description: '',
        start_time: isoToDatetimeLocal(timeRange.start.toISOString()),
        end_time: isoToDatetimeLocal(timeRange.end.toISOString()),
        level: calculateLevel(selectedParentId),
        parent_arc_id: selectedParentId
      })
      setErrors({})
    }
  }, [timeRange, isOpen, selectedParentId, parentArcs])

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      start_time: '',
      end_time: '',
      level: 0,
      parent_arc_id: null
    })
    setErrors({})
    setSelectedParentId(null)
  }

  const handleInputChange = (field: keyof CreateArcRequest, value: string) => {
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

      // Validate against parent arc constraints
      if (selectedParentId) {
        const parentArc = parentArcs.find(arc => arc.id === selectedParentId)
        if (parentArc) {
          const parentStart = new Date(parentArc.start_time)
          const parentEnd = new Date(parentArc.end_time)
          
          if (startTime < parentStart || endTime > parentEnd) {
            newErrors.time_range = 'Arc must be contained within parent arc time range'
          }
        }
      }

      // Check for overlapping sibling arcs (if parent is selected)
      if (selectedParentId) {
        const siblingArcs = parentArcs.filter(arc => 
          arc.parent_arc_id === selectedParentId && arc.id !== selectedParentId
        )
        
        const hasOverlap = siblingArcs.some(sibling => {
          const siblingStart = new Date(sibling.start_time)
          const siblingEnd = new Date(sibling.end_time)
          
          return (startTime < siblingEnd && endTime > siblingStart)
        })
        
        if (hasOverlap) {
          newErrors.time_range = 'Arc overlaps with existing sibling arcs'
        }
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!validateForm()) return

    try {
      // Convert datetime-local format to ISO strings for API
      const submitData = {
        ...formData,
        start_time: datetimeLocalToIso(formData.start_time),
        end_time: datetimeLocalToIso(formData.end_time)
      }
      await createArcMutation.mutateAsync(submitData)
    } catch {
      setErrors({ general: 'Failed to create arc. Please try again.' })
    }
  }

  const handleCancel = () => {
    resetForm()
    onClose()
  }

  if (!isOpen || !timeRange) return null

  const formatDuration = (start: Date, end: Date): string => {
    const diffMs = end.getTime() - start.getTime()
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24))
    const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
    
    if (days > 0) {
      return `${days} day${days !== 1 ? 's' : ''} ${hours > 0 ? `${hours} hour${hours !== 1 ? 's' : ''}` : ''}`
    }
    return `${hours} hour${hours !== 1 ? 's' : ''}`
  }

  const duration = formatDuration(new Date(formData.start_time), new Date(formData.end_time))

  return (
    <div className={`fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 ${className}`}>
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Create New Arc</h2>
          <button
            onClick={handleCancel}
            className="p-2 hover:bg-gray-100 rounded-md transition-colors"
            aria-label="Close modal"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* General Error */}
          {errors.general && (
            <div className="bg-red-50 border border-red-200 rounded-md p-3">
              <p className="text-sm text-red-600">{errors.general}</p>
            </div>
          )}

          {/* Time Range Info */}
          <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
            <h3 className="text-sm font-medium text-blue-900 mb-2">Selected Time Range</h3>
            <div className="text-sm text-blue-700 space-y-1">
              <div>Start: {new Date(formData.start_time).toLocaleString()}</div>
              <div>End: {new Date(formData.end_time).toLocaleString()}</div>
              <div>Duration: {duration}</div>
              {containedEvents.length > 0 && (
                <div>Contains {containedEvents.length} event{containedEvents.length !== 1 ? 's' : ''}</div>
              )}
            </div>
          </div>

          {/* Basic Information */}
          <div className="space-y-4">
            <div>
              <label htmlFor="arc-name" className="block text-sm font-medium text-gray-700 mb-1">
                Name *
              </label>
              <input
                id="arc-name"
                type="text"
                value={formData.name}
                onChange={(e) => handleInputChange('name', e.target.value)}
                className={`w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                  errors.name ? 'border-red-300' : 'border-gray-300'
                }`}
                placeholder="Enter arc name"
                required
              />
              {errors.name && <p className="mt-1 text-sm text-red-600">{errors.name}</p>}
            </div>

            <div>
              <label htmlFor="arc-description" className="block text-sm font-medium text-gray-700 mb-1">
                Description *
              </label>
              <textarea
                id="arc-description"
                value={formData.description}
                onChange={(e) => handleInputChange('description', e.target.value)}
                rows={3}
                className={`w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                  errors.description ? 'border-red-300' : 'border-gray-300'
                }`}
                placeholder="Enter arc description"
                required
              />
              {errors.description && <p className="mt-1 text-sm text-red-600">{errors.description}</p>}
            </div>
          </div>

          {/* Time Range Adjustment */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-gray-900">Time Range</h3>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="arc-start-time" className="block text-sm font-medium text-gray-700 mb-1">
                  Start Time
                </label>
                <input
                  id="arc-start-time"
                  type="datetime-local"
                  value={formData.start_time}
                  onChange={(e) => handleInputChange('start_time', e.target.value)}
                  className={`w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                    errors.start_time ? 'border-red-300' : 'border-gray-300'
                  }`}
                  required
                />
                {errors.start_time && <p className="mt-1 text-sm text-red-600">{errors.start_time}</p>}
              </div>

              <div>
                <label htmlFor="arc-end-time" className="block text-sm font-medium text-gray-700 mb-1">
                  End Time
                </label>
                <input
                  id="arc-end-time"
                  type="datetime-local"
                  value={formData.end_time}
                  onChange={(e) => handleInputChange('end_time', e.target.value)}
                  className={`w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                    errors.end_time ? 'border-red-300' : 'border-gray-300'
                  }`}
                  required
                />
                {errors.end_time && <p className="mt-1 text-sm text-red-600">{errors.end_time}</p>}
              </div>
            </div>

            {errors.time_range && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3">
                <p className="text-sm text-yellow-600">{errors.time_range}</p>
              </div>
            )}
          </div>

          {/* Parent Arc Selection */}
          {parentArcs.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-gray-900">Hierarchy (Optional)</h3>
              
              <div>
                <label htmlFor="parent-arc" className="block text-sm font-medium text-gray-700 mb-1">
                  Parent Arc
                </label>
                <select
                  id="parent-arc"
                  value={selectedParentId || ''}
                  onChange={(e) => {
                    const value = e.target.value || null
                    setSelectedParentId(value)
                    setFormData(prev => ({
                      ...prev,
                      parent_arc_id: value,
                      level: calculateLevel(value)
                    }))
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">No parent (top-level arc)</option>
                  {parentArcs.map(arc => (
                    <option key={arc.id} value={arc.id}>
                      {arc.name} ({new Date(arc.start_time).toLocaleDateString()} - {new Date(arc.end_time).toLocaleDateString()})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Contained Events Preview */}
          {containedEvents.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-gray-900">
                Events to be contained ({containedEvents.length})
              </h3>
              
              <div className="max-h-32 overflow-y-auto space-y-2">
                {containedEvents.map(event => (
                  <div key={event.id} className="bg-gray-50 rounded-md p-2">
                    <p className="text-sm font-medium text-gray-900">{event.description}</p>
                    <p className="text-xs text-gray-500">
                      {event.actor} → {event.target} • {new Date(event.timestamp).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex space-x-3 pt-4 border-t border-gray-200">
            <button
              type="submit"
              disabled={createArcMutation.isPending}
              className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {createArcMutation.isPending ? 'Creating...' : 'Create Arc'}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={createArcMutation.isPending}
              className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default ArcCreationModal