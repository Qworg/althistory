import { useState, useEffect } from 'react'
import { Event } from '@/types'

interface EventDetailModalProps {
  event: Event | null
  isOpen: boolean
  onClose: () => void
  onSave: (updates: Partial<Event>) => Promise<void>
  onDelete?: () => Promise<void>
  relatedArcs?: any[]
  causalRelationships?: any[]
  className?: string
}

interface EventFormData {
  description: string
  actor: string
  target: string
  timestamp: string
  event_type: string
  confidence: number
  evidence: string
}

export function EventDetailModal({
  event,
  isOpen,
  onClose,
  onSave,
  onDelete,
  relatedArcs = [],
  causalRelationships = [],
  className = ''
}: EventDetailModalProps) {
  const [formData, setFormData] = useState<EventFormData>({
    description: '',
    actor: '',
    target: '',
    timestamp: '',
    event_type: '',
    confidence: 1.0,
    evidence: ''
  })
  const [isLoading, setIsLoading] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // Update form data when event changes
  useEffect(() => {
    if (event) {
      setFormData({
        description: event.description || '',
        actor: event.actor || '',
        target: event.target || '',
        timestamp: event.timestamp || '',
        event_type: '', // Not in Event type
        confidence: 1.0, // Not in Event type
        evidence: '' // Not in Event type
      })
    } else {
      setFormData({
        description: '',
        actor: '',
        target: '',
        timestamp: '',
        event_type: '',
        confidence: 1.0,
        evidence: ''
      })
    }
    setErrors({})
    setShowDeleteConfirm(false)
  }, [event])

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
      document.body.style.overflow = 'hidden'
    }

    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = 'unset'
    }
  }, [isOpen, onClose])

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (!formData.description.trim()) {
      newErrors.description = 'Description is required'
    }

    if (!formData.actor.trim()) {
      newErrors.actor = 'Actor is required'
    }

    if (!formData.timestamp.trim()) {
      newErrors.timestamp = 'Timestamp is required'
    } else {
      // Validate timestamp format
      const timestampRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/
      if (!timestampRegex.test(formData.timestamp)) {
        newErrors.timestamp = 'Invalid timestamp format (use ISO 8601)'
      }
    }

    if (formData.confidence < 0 || formData.confidence > 1) {
      newErrors.confidence = 'Confidence must be between 0 and 1'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleInputChange = (field: keyof EventFormData, value: string | number) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }))

    // Clear error for this field
    if (errors[field]) {
      setErrors(prev => ({
        ...prev,
        [field]: ''
      }))
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!validateForm()) {
      return
    }

    setIsLoading(true)
    try {
      await onSave(formData)
      onClose()
    } catch (error) {
      console.error('Failed to save event:', error)
      setErrors({ submit: 'Failed to save event. Please try again.' })
    } finally {
      setIsLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!onDelete) return
    setIsLoading(true)
    try {
      await onDelete()
      onClose()
    } catch (error) {
      console.error('Failed to delete event:', error)
      setErrors({ submit: 'Failed to delete event. Please try again.' })
    } finally {
      setIsLoading(false)
      setShowDeleteConfirm(false)
    }
  }

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  if (!isOpen) {
    return null
  }

  return (
    <div
      className={`fixed inset-0 z-50 overflow-y-auto ${className}`}
      aria-labelledby="event-modal-title"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0"
        onClick={handleBackdropClick}
      >
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" aria-hidden="true" />

        <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">
          &#8203;
        </span>

        <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-2xl sm:w-full">
          <form onSubmit={handleSubmit}>
            <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
              <div className="sm:flex sm:items-start">
                <div className="w-full">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg leading-6 font-medium text-gray-900" id="event-modal-title">
                      {event ? 'Edit Event' : 'Create Event'}
                    </h3>
                    <button
                      type="button"
                      onClick={onClose}
                      className="rounded-md text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      aria-label="Close modal"
                    >
                      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  {errors.submit && (
                    <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
                      {errors.submit}
                    </div>
                  )}

                  <div className="space-y-4">
                    {/* Description */}
                    <div>
                      <label htmlFor="description" className="block text-sm font-medium text-gray-700">
                        Description *
                      </label>
                      <textarea
                        id="description"
                        rows={3}
                        value={formData.description}
                        onChange={(e) => handleInputChange('description', e.target.value)}
                        className={`mt-1 block w-full border rounded-md shadow-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                          errors.description ? 'border-red-300' : 'border-gray-300'
                        }`}
                        placeholder="Enter event description..."
                        required
                      />
                      {errors.description && (
                        <p className="mt-1 text-sm text-red-600">{errors.description}</p>
                      )}
                    </div>

                    {/* Actor and Target */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="actor" className="block text-sm font-medium text-gray-700">
                          Actor *
                        </label>
                        <input
                          type="text"
                          id="actor"
                          value={formData.actor}
                          onChange={(e) => handleInputChange('actor', e.target.value)}
                          className={`mt-1 block w-full border rounded-md shadow-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                            errors.actor ? 'border-red-300' : 'border-gray-300'
                          }`}
                          placeholder="Enter actor..."
                          required
                        />
                        {errors.actor && (
                          <p className="mt-1 text-sm text-red-600">{errors.actor}</p>
                        )}
                      </div>

                      <div>
                        <label htmlFor="target" className="block text-sm font-medium text-gray-700">
                          Target
                        </label>
                        <input
                          type="text"
                          id="target"
                          value={formData.target}
                          onChange={(e) => handleInputChange('target', e.target.value)}
                          className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          placeholder="Enter target..."
                        />
                      </div>
                    </div>

                    {/* Timestamp and Event Type */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="timestamp" className="block text-sm font-medium text-gray-700">
                          Timestamp *
                        </label>
                        <input
                          type="datetime-local"
                          id="timestamp"
                          value={formData.timestamp.slice(0, 16)} // Remove seconds for datetime-local
                          onChange={(e) => handleInputChange('timestamp', e.target.value + ':00Z')}
                          className={`mt-1 block w-full border rounded-md shadow-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                            errors.timestamp ? 'border-red-300' : 'border-gray-300'
                          }`}
                          required
                        />
                        {errors.timestamp && (
                          <p className="mt-1 text-sm text-red-600">{errors.timestamp}</p>
                        )}
                      </div>

                      <div>
                        <label htmlFor="event_type" className="block text-sm font-medium text-gray-700">
                          Event Type
                        </label>
                        <input
                          type="text"
                          id="event_type"
                          value={formData.event_type}
                          onChange={(e) => handleInputChange('event_type', e.target.value)}
                          className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          placeholder="Enter event type..."
                        />
                      </div>
                    </div>

                    {/* Confidence */}
                    <div>
                      <label htmlFor="confidence" className="block text-sm font-medium text-gray-700">
                        Confidence: {formData.confidence.toFixed(2)}
                      </label>
                      <input
                        type="range"
                        id="confidence"
                        min="0"
                        max="1"
                        step="0.01"
                        value={formData.confidence}
                        onChange={(e) => handleInputChange('confidence', parseFloat(e.target.value))}
                        className="mt-1 block w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
                      />
                      <div className="flex justify-between text-xs text-gray-500 mt-1">
                        <span>0.00</span>
                        <span>1.00</span>
                      </div>
                      {errors.confidence && (
                        <p className="mt-1 text-sm text-red-600">{errors.confidence}</p>
                      )}
                    </div>

                    {/* Evidence */}
                    <div>
                      <label htmlFor="evidence" className="block text-sm font-medium text-gray-700">
                        Evidence
                      </label>
                      <textarea
                        id="evidence"
                        rows={3}
                        value={formData.evidence}
                        onChange={(e) => handleInputChange('evidence', e.target.value)}
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="Enter supporting evidence..."
                      />
                    </div>

                    {/* Related Information */}
                    {event && (relatedArcs.length > 0 || causalRelationships.length > 0) && (
                      <div className="border-t pt-4">
                        <h4 className="text-sm font-medium text-gray-900 mb-3">Related Information</h4>
                        
                        {relatedArcs.length > 0 && (
                          <div className="mb-3">
                            <h5 className="text-xs font-medium text-gray-700 mb-2">Related Arcs</h5>
                            <div className="space-y-1">
                              {relatedArcs.map((arc) => (
                                <div key={arc.id} className="text-sm text-gray-600 bg-gray-50 px-2 py-1 rounded">
                                  {arc.name}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {causalRelationships.length > 0 && (
                          <div>
                            <h5 className="text-xs font-medium text-gray-700 mb-2">Causal Relationships</h5>
                            <div className="space-y-1">
                              {causalRelationships.map((rel) => (
                                <div key={rel.id} className="text-sm text-gray-600 bg-gray-50 px-2 py-1 rounded">
                                  {rel.relationship_type} (Weight: {rel.weight})
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
              <button
                type="submit"
                disabled={isLoading}
                className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-blue-600 text-base font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? 'Saving...' : 'Save'}
              </button>

              <button
                type="button"
                onClick={onClose}
                className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
              >
                Cancel
              </button>

              {event && (
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="mt-3 w-full inline-flex justify-center rounded-md border border-red-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 sm:mt-0 sm:w-auto sm:text-sm"
                >
                  Delete
                </button>
              )}
            </div>
          </form>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-60 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" />
            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="sm:flex sm:items-start">
                  <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10">
                    <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                  </div>
                  <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                    <h3 className="text-lg leading-6 font-medium text-gray-900">
                      Delete Event
                    </h3>
                    <div className="mt-2">
                      <p className="text-sm text-gray-500">
                        Are you sure you want to delete this event? This action cannot be undone.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={isLoading}
                  className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-red-600 text-base font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50"
                >
                  {isLoading ? 'Deleting...' : 'Delete'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}