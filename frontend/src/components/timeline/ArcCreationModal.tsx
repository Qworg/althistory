import React, { useState, useEffect, useCallback, useRef } from 'react'
import { TimeRange, CreateArcRequest, Event, Arc } from '@/types'
import { useCreateArc } from '@/hooks/useAPI'
import { formatHistoricalDate, formatHistoricalTimestamp, formatHistoricalEnd, formatEventDate } from '@/utils/historicalTime'
import { Portal } from '@/components/ui/Portal'
import { DateField } from '@/components/ui/DateField'
import { readDateFieldValue } from '@/utils/dateField'
import { useDateFieldText } from '@/hooks/useDateFieldText'
import { toInstant } from '@althistory/calendar'

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
  // The dates' fields: a UTC picker, or the world's notation (see useDateFieldText).
  const dates = useDateFieldText('datetime')
  const worldCalendar = dates.calendar
  const toField = dates.fill
  const toIso = dates.toIso
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

  // The dates as they are now, for the switch below (read, not set, in an effect).
  const dateTexts = useRef({ start: formData.start_time || '', end: formData.end_time || '' })
  useEffect(() => {
    dateTexts.current = { start: formData.start_time || '', end: formData.end_time || '' }
  }, [formData.start_time, formData.end_time])

  // Another calendar shown rewrites the dates (and only the dates) in it. The
  // new text is worked out here, once; the update only sets it (React may run
  // an updater twice).
  const { takeSwitch, rewrite } = dates
  useEffect(() => {
    const switched = takeSwitch()
    if (!switched) return
    const start_time = rewrite(dateTexts.current.start, 'start', switched.from)
    const end_time = rewrite(dateTexts.current.end, 'end', switched.from)
    dateTexts.current = { start: start_time, end: end_time }
    setFormData((current) => ({ ...current, start_time, end_time }))
  }, [takeSwitch, rewrite])

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
  const calculateLevel = useCallback((parentId: string | null): number => {
    if (!parentId) return 0
    const parentArc = parentArcs.find(arc => arc.id === parentId)
    // Use parent's level + 1, or default to 1 if parent has no level
    return parentArc?.level !== undefined ? parentArc.level + 1 : 1
  }, [parentArcs])

  // Initialize form data when timeRange changes
  useEffect(() => {
    if (timeRange && isOpen) {
      setFormData({
        name: '',
        description: '',
        start_time: toField(timeRange.start.toISOString(), 'start'),
        end_time: toField(timeRange.end.toISOString(), 'end'),
        level: calculateLevel(selectedParentId),
        parent_arc_id: selectedParentId
      })
      setErrors({})
    }
  }, [timeRange, isOpen, selectedParentId, calculateLevel, toField])

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

    // A date the field cannot read says why (in a world, typed in its notation).
    for (const edge of ['start', 'end'] as const) {
      const value = formData[`${edge}_time`]
      const read = value ? readDateFieldValue(value, { calendar: worldCalendar, edge }) : null
      if (read && !read.ok) newErrors[`${edge}_time`] = read.error
    }

    if (formData.start_time && formData.end_time) {
      const startTime = toInstant(toIso(formData.start_time, 'start'))
      const endTime = toInstant(toIso(formData.end_time, 'end'))
      
      if (startTime >= endTime) {
        newErrors.end_time = 'End time must be after start time'
      }

      // Validate against parent arc constraints
      if (selectedParentId) {
        const parentArc = parentArcs.find(arc => arc.id === selectedParentId)
        if (parentArc) {
          const parentStart = toInstant(parentArc.start_time)
          const parentEnd = toInstant(parentArc.end_time)
          
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
          const siblingStart = toInstant(sibling.start_time)
          const siblingEnd = toInstant(sibling.end_time)
          
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
        start_time: toIso(formData.start_time, 'start'),
        end_time: toIso(formData.end_time, 'end')
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

  const duration = formatDuration(toInstant(toIso(formData.start_time, 'start')), toInstant(toIso(formData.end_time, 'end')))

  return (
    <Portal>
      <div className={`fixed inset-0 bg-black/50 flex items-center justify-center z-50 ${className}`}>
        <div role="dialog" aria-modal="true" aria-label="Create New Arc" className="bg-card rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-line">
            <h2 className="font-display text-xl font-semibold text-ink">Create New Arc</h2>
            <button
              onClick={handleCancel}
              className="p-2 hover:bg-subtle rounded-md transition-colors"
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
              <h3 className="text-base font-semibold text-blue-900 mb-2">Selected Time Range</h3>
              <div className="text-sm text-blue-700 space-y-1">
                <div>Start: <span className="font-mono-code">{formatHistoricalTimestamp(toIso(formData.start_time, 'start'))}</span></div>
                <div>End: <span className="font-mono-code">{formatHistoricalEnd(toIso(formData.end_time, 'end'))}</span></div>
                <div>Duration: {duration}</div>
                {containedEvents.length > 0 && (
                  <div>Contains {containedEvents.length} event{containedEvents.length !== 1 ? 's' : ''}</div>
                )}
              </div>
            </div>

            {/* Basic Information */}
            <div className="space-y-4">
              <div>
                <label htmlFor="arc-name" className="block text-sm font-medium text-ink-secondary mb-1">
                  Name *
                </label>
                <input
                  id="arc-name"
                  type="text"
                  value={formData.name}
                  onChange={(e) => handleInputChange('name', e.target.value)}
                  className={`w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-selected focus:border-selected ${
                    errors.name ? 'border-red-300' : 'border-line'
                  }`}
                  placeholder="Enter arc name"
                  required
                />
                {errors.name && <p className="mt-1 text-sm text-red-600">{errors.name}</p>}
              </div>

              <div>
                <label htmlFor="arc-description" className="block text-sm font-medium text-ink-secondary mb-1">
                  Description *
                </label>
                <textarea
                  id="arc-description"
                  value={formData.description}
                  onChange={(e) => handleInputChange('description', e.target.value)}
                  rows={3}
                  className={`w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-selected focus:border-selected ${
                    errors.description ? 'border-red-300' : 'border-line'
                  }`}
                  placeholder="Enter arc description"
                  required
                />
                {errors.description && <p className="mt-1 text-sm text-red-600">{errors.description}</p>}
              </div>
            </div>

            {/* Time Range Adjustment */}
            <div className="space-y-4">
              <h3 className="text-base font-semibold text-ink">Time Range</h3>
            
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="arc-start-time" className="block text-sm font-medium text-ink-secondary mb-1">
                    Start Time
                  </label>
                  <DateField
                    id="arc-start-time"
                    kind="datetime"
                    edge="start"
                    value={formData.start_time}
                    onChange={(value) => handleInputChange('start_time', value)}
                    className={`w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-selected focus:border-selected ${
                      errors.start_time ? 'border-red-300' : 'border-line'
                    }`}
                    required
                  />
                  {errors.start_time && <p className="mt-1 text-sm text-red-600">{errors.start_time}</p>}
                </div>

                <div>
                  <label htmlFor="arc-end-time" className="block text-sm font-medium text-ink-secondary mb-1">
                    End Time
                  </label>
                  <DateField
                    id="arc-end-time"
                    kind="datetime"
                    edge="end"
                    value={formData.end_time}
                    onChange={(value) => handleInputChange('end_time', value)}
                    className={`w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-selected focus:border-selected ${
                      errors.end_time ? 'border-red-300' : 'border-line'
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
                <h3 className="text-base font-semibold text-ink">Hierarchy (Optional)</h3>
              
                <div>
                  <label htmlFor="parent-arc" className="block text-sm font-medium text-ink-secondary mb-1">
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
                    className="w-full px-3 py-2 border border-line rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-selected focus:border-selected"
                  >
                    <option value="">No parent (top-level arc)</option>
                    {parentArcs.map(arc => (
                      <option key={arc.id} value={arc.id}>
                        {arc.name} ({formatHistoricalDate(arc.start_time)} - {formatHistoricalDate(arc.end_time)})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* Contained Events Preview */}
            {containedEvents.length > 0 && (
              <div className="space-y-4">
                <h3 className="text-base font-semibold text-ink">
                  Events to be contained ({containedEvents.length})
                </h3>
              
                <div className="max-h-32 overflow-y-auto space-y-2">
                  {containedEvents.map(event => (
                    <div key={event.id} className="bg-subtle rounded-md p-2">
                      <p className="text-sm font-medium text-ink">{event.description}</p>
                      <p className="text-xs text-ink-muted">
                        {event.actor} → {event.target} • <span className="font-mono-code">{formatEventDate(event)}</span>
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex space-x-3 pt-4 border-t border-line">
              <button
                type="submit"
                disabled={createArcMutation.isPending}
                className="flex-1 bg-baseline text-on-accent px-4 py-2 rounded-md hover:bg-baseline/90 focus:outline-none focus:ring-2 focus:ring-selected focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {createArcMutation.isPending ? 'Creating...' : 'Create Arc'}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                disabled={createArcMutation.isPending}
                className="px-4 py-2 border border-line rounded-md text-ink-secondary hover:bg-subtle focus:outline-none focus:ring-2 focus:ring-selected focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </Portal>
  )
}

export default ArcCreationModal