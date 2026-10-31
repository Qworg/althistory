import React, { useState } from 'react'
import { Event, Arc } from '@/types'
import { formatHistoricalDate, formatHistoricalTimestamp } from '@/utils/historicalTime'

export interface EventArcAssignmentProps {
  event: Event
  availableArcs: Arc[]
  currentArcId?: string | null
  onAssign: (eventId: string, arcId: string | null) => Promise<void>
  onCancel: () => void
  className?: string
}

export const EventArcAssignment: React.FC<EventArcAssignmentProps> = ({
  event,
  availableArcs,
  currentArcId = null,
  onAssign,
  onCancel,
  className = ''
}) => {
  const [selectedArcId, setSelectedArcId] = useState<string | null>(currentArcId)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Filter arcs that can contain this event (temporal containment)
  const compatibleArcs = availableArcs.filter(arc => {
    const eventTime = new Date(event.timestamp).getTime()
    const arcStart = new Date(arc.start_time).getTime()
    const arcEnd = new Date(arc.end_time).getTime()
    
    return eventTime >= arcStart && eventTime <= arcEnd
  })

  const incompatibleArcs = availableArcs.filter(arc => {
    const eventTime = new Date(event.timestamp).getTime()
    const arcStart = new Date(arc.start_time).getTime()
    const arcEnd = new Date(arc.end_time).getTime()
    
    return eventTime < arcStart || eventTime > arcEnd
  })

  const handleAssign = async () => {
    setIsLoading(true)
    setError(null)
    
    try {
      await onAssign(event.id, selectedArcId)
    } catch {
      setError('Failed to assign event to arc. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const formatTimeRange = (arc: Arc): string => {
    const start = formatHistoricalDate(arc.start_time)
    const end = formatHistoricalDate(arc.end_time)
    return `${start} - ${end}`
  }

  const getArcHierarchyPath = (arc: Arc): string => {
    // Find parent arcs to show hierarchy
    const parents: Arc[] = []
    let currentParentId = arc.parent_arc_id
    
    while (currentParentId) {
      const parent = availableArcs.find(a => a.id === currentParentId)
      if (parent) {
        parents.unshift(parent)
        currentParentId = parent.parent_arc_id
      } else {
        break
      }
    }
    
    if (parents.length > 0) {
      return parents.map(p => p.name).join(' > ') + ' > ' + arc.name
    }
    
    return arc.name
  }

  return (
    <div className={`bg-white border border-gray-200 rounded-lg shadow-lg p-4 max-w-md ${className}`}>
      {/* Header */}
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Assign Event to Arc</h3>
        <div className="bg-gray-50 rounded-md p-3">
          <p className="text-sm font-medium text-gray-900">{event.description}</p>
          <p className="text-xs text-gray-500 mt-1">
            {event.actor} → {event.target} • {new Date(event.timestamp).toLocaleString()}
          </p>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-3">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Arc Selection */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Select Arc
        </label>
        
        {/* No assignment option */}
        <div className="mb-3">
          <label className="flex items-center">
            <input
              type="radio"
              name="arc-selection"
              value=""
              checked={selectedArcId === null}
              onChange={() => setSelectedArcId(null)}
              className="mr-2"
            />
            <span className="text-sm text-gray-700">No arc assignment (remove from current arc)</span>
          </label>
        </div>

        {/* Compatible arcs */}
        {compatibleArcs.length > 0 && (
          <div className="mb-4">
            <h4 className="text-sm font-medium text-green-700 mb-2">Compatible Arcs</h4>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {compatibleArcs.map(arc => (
                <label key={arc.id} className="flex items-start">
                  <input
                    type="radio"
                    name="arc-selection"
                    value={arc.id}
                    checked={selectedArcId === arc.id}
                    onChange={() => setSelectedArcId(arc.id)}
                    className="mr-2 mt-1"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {getArcHierarchyPath(arc)}
                    </p>
                    <p className="text-xs text-gray-500">
                      {formatTimeRange(arc)}
                    </p>
                    {arc.description && (
                      <p className="text-xs text-gray-400 mt-1 truncate">
                        {arc.description}
                      </p>
                    )}
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Incompatible arcs (shown but disabled) */}
        {incompatibleArcs.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-red-700 mb-2">
              Incompatible Arcs (Event outside time range)
            </h4>
            <div className="space-y-2 max-h-32 overflow-y-auto">
              {incompatibleArcs.map(arc => (
                <div key={arc.id} className="flex items-start opacity-50">
                  <input
                    type="radio"
                    name="arc-selection"
                    value={arc.id}
                    disabled
                    className="mr-2 mt-1"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-600 truncate">
                      {getArcHierarchyPath(arc)}
                    </p>
                    <p className="text-xs text-red-500">
                      {formatTimeRange(arc)} (Event: {formatHistoricalDate(event.timestamp)})
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* No arcs available */}
        {compatibleArcs.length === 0 && incompatibleArcs.length === 0 && (
          <div className="text-center py-4">
            <p className="text-sm text-gray-500">No arcs available for assignment</p>
          </div>
        )}
      </div>

      {/* Validation Info */}
      {selectedArcId && (
        <div className="mb-4 bg-blue-50 border border-blue-200 rounded-md p-3">
          <p className="text-sm text-blue-700">
            <strong>Validation:</strong> Event timestamp ({formatHistoricalTimestamp(event.timestamp)}) 
            is within the selected arc's time range.
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="flex space-x-3">
        <button
          onClick={handleAssign}
          disabled={isLoading}
          className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isLoading ? 'Assigning...' : 'Assign'}
        </button>
        <button
          onClick={onCancel}
          disabled={isLoading}
          className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

export default EventArcAssignment