import React from 'react'
import { PressureWithContext } from '@/types/pressure'
import { Event } from '@/types'
import { 
  formatPressureType, 
  getPressureTypeIconPath,
  getConfidenceLevel 
} from '@/utils/pressureVisualization'
import { formatHistoricalDate, formatHistoricalTimestamp, formatEventDate } from '@/utils/historicalTime'
import { Portal } from '@/components/ui/Portal'

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
  const confidenceScore = pressure.confidence_score.toFixed(2)

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
      case 'high': return 'text-green-800'
      case 'medium': return 'text-yellow-800'
      case 'low': return 'text-red-800'
      default: return 'text-ink-secondary'
    }
  }

  const getConfidenceLevelBg = (level: string) => {
    switch (level) {
      case 'high': return 'bg-green-100'
      case 'medium': return 'bg-yellow-100'
      case 'low': return 'bg-red-100'
      default: return 'bg-subtle'
    }
  }

  return (
    <Portal>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pressure-modal-title"
        className={`fixed inset-0 bg-black/50 flex items-center justify-center z-50 ${className}`}
        onClick={handleBackdropClick}
        data-testid="pressure-detail-modal"
      >
        <div className="bg-card text-ink border border-line rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-line">
            <div className="flex items-center space-x-3">
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-subtle text-ink-secondary"
                aria-hidden="true"
              >
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={getPressureTypeIconPath(pressure.pressure_type)} />
                </svg>
              </span>
              <div>
                <h2 id="pressure-modal-title" className="font-display text-xl font-semibold text-ink">
                  {formatPressureType(pressure.pressure_type)} Pressure
                </h2>
                <div className="flex items-center space-x-4 mt-1">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${getConfidenceLevelBg(confidenceLevel)} ${getConfidenceLevelColor(confidenceLevel)}`}>
                    {confidenceLevel.toUpperCase()} CONFIDENCE
                  </span>
                  {/* On the 0–1 scale the Timeline view's thresholds use. */}
                  <span className="text-sm text-ink-muted">
                    confidence <span className="font-mono-code text-ink-secondary">{confidenceScore}</span>
                  </span>
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-ink-muted hover:text-ink transition-colors"
              aria-label="Close modal"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="p-6 overflow-y-auto max-h-[calc(90vh-120px)]">
            {/* Description */}
            <div className="mb-6">
              <h3 className="text-base font-semibold text-ink mb-2">Description</h3>
              <p className="text-ink-secondary leading-relaxed">{pressure.description}</p>
            </div>

            {/* Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <div className="bg-subtle rounded-lg p-4">
                <div className="text-sm font-medium text-ink-muted">Confidence Score</div>
                <div className="mt-1">
                  <div className="flex items-center space-x-2">
                    <div className="flex-1 bg-line rounded-full h-2">
                      <div 
                        className={`h-2 rounded-full ${confidenceLevel === 'high' ? 'bg-success' : confidenceLevel === 'medium' ? 'bg-yellow-500' : 'bg-red-500'}`}
                        style={{ width: `${confidencePercentage}%` }}
                      />
                    </div>
                    <span className="font-mono-code text-sm font-medium text-ink">{confidenceScore}</span>
                  </div>
                </div>
              </div>

              {/* An "Influence Strength" tile stood here: confidence scaled by
                  the evidence count and capped at 1, so it read 100% for nearly
                  every pressure and said nothing the two tiles beside it do not.
                  The period is under Metadata. */}
              <div className="bg-subtle rounded-lg p-4">
                <div className="text-sm font-medium text-ink-muted">Evidence Events</div>
                <div className="mt-1 text-2xl font-bold text-ink">
                  {pressure.evidenceEvents.length}
                </div>
              </div>
            </div>

            {/* Affected Arcs */}
            <div className="mb-6">
              <h3 className="text-base font-semibold text-ink mb-3">Affected Arcs</h3>
              <div className="space-y-2">
                {pressure.affectedArcs.map(arc => (
                  <div key={arc.id} className="flex items-center justify-between p-3 bg-subtle rounded-lg">
                    <div>
                      <div className="font-medium text-ink">{arc.name}</div>
                      <div className="text-sm text-ink-muted">{arc.description}</div>
                    </div>
                    <div className="text-sm text-ink-muted">
                      {formatHistoricalDate(arc.start_time)} - {formatHistoricalDate(arc.end_time)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Evidence Events */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-semibold text-ink">Evidence Events</h3>
                <div className="space-x-2">
                  <button
                    onClick={handleEvidenceHighlight}
                    className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded-md hover:bg-blue-200 transition-colors"
                  >
                    Highlight All
                  </button>
                  <button
                    onClick={handleClearHighlight}
                    className="px-3 py-1 text-sm bg-subtle text-ink-secondary rounded-md hover:bg-line transition-colors"
                  >
                    Clear Highlight
                  </button>
                </div>
              </div>
            
              {pressure.evidenceEvents.length === 0 ? (
                <div className="text-center py-8 text-ink-muted">
                  <svg className="w-12 h-12 mx-auto mb-4 text-ink-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <p>No evidence events found for this pressure</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {pressure.evidenceEvents.map(event => (
                    <div 
                      key={event.id} 
                      className="flex items-center justify-between p-3 bg-card border border-line rounded-lg hover:bg-subtle cursor-pointer transition-colors"
                      onClick={() => onEvidenceEventClick?.(event)}
                    >
                      <div className="flex-1">
                        <div className="font-medium text-ink">{event.description}</div>
                        <div className="text-sm text-ink-muted mt-1">
                          <span className="font-medium">Actor:</span> {event.actor} → 
                          <span className="font-medium ml-1">Target:</span> {event.target}
                        </div>
                      </div>
                      <div className="font-mono-code text-sm text-ink-muted ml-4 shrink-0">
                        {formatEventDate(event)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Metadata */}
            <div className="border-t border-line pt-4">
              <h3 className="text-base font-semibold text-ink mb-3">Metadata</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="font-medium text-ink-muted">Pressure ID:</span>
                  <span className="ml-2 text-ink font-mono-code">{pressure.id}</span>
                </div>
                <div>
                  <span className="font-medium text-ink-muted">Type:</span>
                  <span className="ml-2 text-ink">{formatPressureType(pressure.pressure_type)}</span>
                </div>
                <div>
                  <span className="font-medium text-ink-muted">Period:</span>
                  <span className="ml-2 text-ink">
                    {pressure.time_range
                      ? `${formatHistoricalTimestamp(pressure.time_range.start)} – ${formatHistoricalTimestamp(
                          pressure.time_range.end
                        )}`
                      : 'not reported'}
                  </span>
                </div>
                <div>
                  <span className="font-medium text-ink-muted">Evidence events:</span>
                  <span className="ml-2 text-ink">
                    {pressure.evidence_event_ids?.length ?? 0}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end space-x-3 p-6 border-t border-line bg-subtle">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-ink-secondary bg-card border border-line rounded-md hover:bg-subtle transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </Portal>
  )
}

export default PressureDetailModal