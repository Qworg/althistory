import React from 'react'
import { PressureWithContext } from '@/types/pressure'
import { Event } from '@/types'
import { 
  formatPressureType, 
  getPressureTypeIcon, 
  getConfidenceLevel 
} from '@/utils/pressureVisualization'

export interface PressureDetailModalProps {
  pressure: PressureWithContext | null
  isOpen: boolean
  onClose: () => void
  onEvidenceEventClick?: (event: Event) => void
  onHighlightEvidence?: (events: Event[]) => void
  onClearHighlight?: () => void
  className?: string
}

export const PressureDetailModal: React.FC<PressureDetailModalProps> = ({
  pressure,
  isOpen,
  onClose,
  onEvidenceEventClick,
  onHighlightEvidence,
  onClearHighlight,
  className = ''
}) => {
  if (!isOpen || !pressure) return null

  const confidenceLevel = getConfidenceLevel(pressure.confidence_score)
  const confidencePercentage = Math.round(pressure.confidence_score * 100)
  const influencePercentage = Math.round(pressure.influenceStrength * 100)

  const handleEvidenceHighlight = () => {
    onHighlightEvidence?.(pressure.evidenceEvents)
  }

  const handleClearHighlight = () => {
    onClearHighlight?.()
  }

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  const getConfidenceLevelColor = (level: string) => {
    switch (level) {
      case 'high': return 'text-green-600'
      case 'medium': return 'text-yellow-600'
      case 'low': return 'text-red-600'
      default: return 'text-gray-600'
    }
  }

  const getConfidenceLevelBg = (level: string) => {
    switch (level) {
      case 'high': return 'bg-green-100'
      case 'medium': return 'bg-yellow-100'
      case 'low': return 'bg-red-100'
      default: return 'bg-gray-100'
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pressure-modal-title"
      className={`fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 ${className}`}
      onClick={handleBackdropClick}
      data-testid="pressure-detail-modal"
    >
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center space-x-3">
            <span className="text-2xl" aria-hidden="true">{getPressureTypeIcon(pressure.pressure_type)}</span>
            <div>
              <h2 id="pressure-modal-title" className="text-xl font-semibold text-gray-900">
                {formatPressureType(pressure.pressure_type)} Pressure
              </h2>
              <div className="flex items-center space-x-4 mt-1">
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${getConfidenceLevelBg(confidenceLevel)} ${getConfidenceLevelColor(confidenceLevel)}`}>
                  {confidenceLevel.toUpperCase()} CONFIDENCE
                </span>
                <span className="text-sm text-gray-500">
                  {confidencePercentage}% confident
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close modal"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-120px)]">
          {/* Description */}
          <div className="mb-6">
            <h3 className="text-lg font-medium text-gray-900 mb-2">Description</h3>
            <p className="text-gray-700 leading-relaxed">{pressure.description}</p>
          </div>

          {/* Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="text-sm font-medium text-gray-500">Confidence Score</div>
              <div className="mt-1">
                <div className="flex items-center space-x-2">
                  <div className="flex-1 bg-gray-200 rounded-full h-2">
                    <div 
                      className={`h-2 rounded-full ${confidenceLevel === 'high' ? 'bg-green-500' : confidenceLevel === 'medium' ? 'bg-yellow-500' : 'bg-red-500'}`}
                      style={{ width: `${confidencePercentage}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium text-gray-900">{confidencePercentage}%</span>
                </div>
              </div>
            </div>

            <div className="bg-gray-50 rounded-lg p-4">
              <div className="text-sm font-medium text-gray-500">Influence Strength</div>
              <div className="mt-1">
                <div className="flex items-center space-x-2">
                  <div className="flex-1 bg-gray-200 rounded-full h-2">
                    <div 
                      className="h-2 rounded-full bg-blue-500"
                      style={{ width: `${influencePercentage}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium text-gray-900">{influencePercentage}%</span>
                </div>
              </div>
            </div>

            <div className="bg-gray-50 rounded-lg p-4">
              <div className="text-sm font-medium text-gray-500">Evidence Events</div>
              <div className="mt-1 text-2xl font-bold text-gray-900">
                {pressure.evidenceEvents.length}
              </div>
            </div>
          </div>

          {/* Affected Arcs */}
          <div className="mb-6">
            <h3 className="text-lg font-medium text-gray-900 mb-3">Affected Arcs</h3>
            <div className="space-y-2">
              {pressure.affectedArcs.map(arc => (
                <div key={arc.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <div className="font-medium text-gray-900">{arc.name}</div>
                    <div className="text-sm text-gray-500">{arc.description}</div>
                  </div>
                  <div className="text-sm text-gray-500">
                    {new Date(arc.start_time).toLocaleDateString()} - {new Date(arc.end_time).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Evidence Events */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-medium text-gray-900">Evidence Events</h3>
              <div className="space-x-2">
                <button
                  onClick={handleEvidenceHighlight}
                  className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded-md hover:bg-blue-200 transition-colors"
                >
                  Highlight All
                </button>
                <button
                  onClick={handleClearHighlight}
                  className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors"
                >
                  Clear Highlight
                </button>
              </div>
            </div>
            
            {pressure.evidenceEvents.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <svg className="w-12 h-12 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p>No evidence events found for this pressure</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {pressure.evidenceEvents.map(event => (
                  <div 
                    key={event.id} 
                    className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => onEvidenceEventClick?.(event)}
                  >
                    <div className="flex-1">
                      <div className="font-medium text-gray-900">{event.description}</div>
                      <div className="text-sm text-gray-500 mt-1">
                        <span className="font-medium">Actor:</span> {event.actor} → 
                        <span className="font-medium ml-1">Target:</span> {event.target}
                      </div>
                    </div>
                    <div className="text-sm text-gray-500 ml-4">
                      {new Date(event.timestamp).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Metadata */}
          <div className="border-t border-gray-200 pt-4">
            <h3 className="text-lg font-medium text-gray-900 mb-3">Metadata</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <span className="font-medium text-gray-500">Pressure ID:</span>
                <span className="ml-2 text-gray-900 font-mono">{pressure.id}</span>
              </div>
              <div>
                <span className="font-medium text-gray-500">Type:</span>
                <span className="ml-2 text-gray-900">{formatPressureType(pressure.pressure_type)}</span>
              </div>
              <div>
                <span className="font-medium text-gray-500">Period:</span>
                <span className="ml-2 text-gray-900">
                  {pressure.time_range
                    ? `${new Date(pressure.time_range.start).toLocaleString()} – ${new Date(
                        pressure.time_range.end
                      ).toLocaleString()}`
                    : 'not reported'}
                </span>
              </div>
              <div>
                <span className="font-medium text-gray-500">Evidence events:</span>
                <span className="ml-2 text-gray-900">
                  {pressure.evidence_event_ids?.length ?? 0}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end space-x-3 p-6 border-t border-gray-200 bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export default PressureDetailModal