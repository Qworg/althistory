import React, { useState, useCallback } from 'react'
import { Event } from '@/types'
import { PressureWithContext } from '@/types/pressure'
import { usePressures } from '@/hooks/usePressures'
import PressureDetailModal from '@/components/modals/PressureDetailModal'
import PressureConfidenceTracker from './PressureConfidenceTracker'

export interface PressureExplorationProps {
  arcId?: string
  selectedEvents?: Set<string>
  onEventHighlight?: (eventIds: Set<string>) => void
  onEventSelect?: (event: Event) => void
  className?: string
}

export const PressureExploration: React.FC<PressureExplorationProps> = ({
  arcId,
  selectedEvents = new Set(),
  onEventHighlight,
  onEventSelect,
  className = ''
}) => {
  const {
    visiblePressures,
    pressureStats,
    selectedPressure,
    explorationState,
    visualConfig,
    selectPressure,
    highlightPressureEvidence,
    clearPressureHighlight,
    showEvidenceModalAction,
    hideEvidenceModal,
    trackConfidenceChange,
    setConfidenceThreshold,
    togglePressureIndicators
  } = usePressures(arcId)

  const [showConfidenceTracker, setShowConfidenceTracker] = useState(false)

  // Handle pressure selection from timeline
  const handlePressureSelect = useCallback((pressure: PressureWithContext) => {
    selectPressure(pressure)
    showEvidenceModalAction(pressure)
  }, [selectPressure, showEvidenceModalAction])

  // Handle evidence highlighting
  const handleHighlightEvidence = useCallback((events: Event[]) => {
    const eventIds = new Set(events.map(e => e.id))
    onEventHighlight?.(eventIds)
    highlightPressureEvidence(selectedPressure!)
  }, [onEventHighlight, highlightPressureEvidence, selectedPressure])

  // Handle clearing highlights
  const handleClearHighlight = useCallback(() => {
    onEventHighlight?.(new Set())
    clearPressureHighlight()
  }, [onEventHighlight, clearPressureHighlight])

  // Handle evidence event clicks
  const handleEvidenceEventClick = useCallback((event: Event) => {
    onEventSelect?.(event)
  }, [onEventSelect])

  // Handle confidence updates
  const handleConfidenceUpdate = useCallback((pressureId: string, newConfidence: number) => {
    trackConfidenceChange(pressureId, newConfidence)
  }, [trackConfidenceChange])

  return (
    <div className={`pressure-exploration ${className}`}>
      {/* Pressure Controls */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Pressure Analysis</h2>
          <div className="flex items-center space-x-2">
            <button
              onClick={togglePressureIndicators}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${
                visualConfig.showIndicators
                  ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {visualConfig.showIndicators ? 'Hide' : 'Show'} Indicators
            </button>
            <button
              onClick={() => setShowConfidenceTracker(!showConfidenceTracker)}
              className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors"
            >
              {showConfidenceTracker ? 'Hide' : 'Show'} Tracker
            </button>
          </div>
        </div>

        {/* Pressure Statistics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total</div>
            <div className="text-2xl font-bold text-gray-900">{pressureStats.totalPressures}</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Visible</div>
            <div className="text-2xl font-bold text-blue-600">{pressureStats.visibleCount}</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Avg Confidence</div>
            <div className="text-2xl font-bold text-green-600">
              {Math.round(pressureStats.averageConfidence * 100)}%
            </div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Hidden</div>
            <div className="text-2xl font-bold text-gray-400">{pressureStats.hiddenCount}</div>
          </div>
        </div>

        {/* Confidence Threshold Control */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-700">
              Confidence Threshold
            </label>
            <span className="text-sm text-gray-500">
              {Math.round(visualConfig.confidenceThreshold * 100)}%
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={visualConfig.confidenceThreshold}
            onChange={(e) => setConfidenceThreshold(parseFloat(e.target.value))}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
          />
        </div>

        {/* Pressure Type Distribution */}
        <div>
          <h3 className="text-sm font-medium text-gray-700 mb-2">Pressure Types</h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(pressureStats.typeDistribution).map(([type, count]) => (
              <div
                key={type}
                className="flex items-center space-x-2 px-3 py-1 bg-gray-100 rounded-full"
              >
                <span className="text-sm">
                  {type === 'economic' && '💰'}
                  {type === 'social' && '👥'}
                  {type === 'environmental' && '🌍'}
                  {type === 'political' && '🏛️'}
                </span>
                <span className="text-sm font-medium text-gray-700 capitalize">{type}</span>
                <span className="text-sm text-gray-500">({count})</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Pressure List */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="p-4 border-b border-gray-200">
          <h3 className="text-lg font-medium text-gray-900">Detected Pressures</h3>
        </div>
        <div className="divide-y divide-gray-200">
          {visiblePressures.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <div className="text-4xl mb-4">🔍</div>
              <p className="text-lg font-medium mb-2">No pressures detected</p>
              <p className="text-sm">
                Try lowering the confidence threshold or check if pressure indicators are enabled.
              </p>
            </div>
          ) : (
            visiblePressures.map((pressure) => (
              <div
                key={pressure.id}
                className="p-4 hover:bg-gray-50 cursor-pointer transition-colors"
                onClick={() => handlePressureSelect(pressure)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-2">
                      <span className="text-xl">
                        {pressure.pressure_type === 'economic' && '💰'}
                        {pressure.pressure_type === 'social' && '👥'}
                        {pressure.pressure_type === 'environmental' && '🌍'}
                        {pressure.pressure_type === 'political' && '🏛️'}
                      </span>
                      <div>
                        <h4 className="font-medium text-gray-900 capitalize">
                          {pressure.pressure_type} Pressure
                        </h4>
                        <div className="flex items-center space-x-4 text-sm text-gray-500">
                          <span>Confidence: {Math.round(pressure.confidence_score * 100)}%</span>
                          <span>Evidence: {pressure.evidenceEvents.length} events</span>
                          <span>Influence: {Math.round(pressure.influenceStrength * 100)}%</span>
                        </div>
                      </div>
                    </div>
                    <p className="text-gray-700 text-sm leading-relaxed">
                      {pressure.description}
                    </p>
                  </div>
                  <div className="ml-4">
                    <div 
                      className="w-3 h-3 rounded-full"
                      style={{ 
                        backgroundColor: pressure.renderColor,
                        opacity: pressure.renderOpacity 
                      }}
                    />
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Confidence Tracker */}
      {showConfidenceTracker && selectedPressure && (
        <div className="mt-4">
          <PressureConfidenceTracker
            pressure={selectedPressure}
            confidenceHistory={explorationState.confidenceTracking.get(selectedPressure.id) || []}
            onConfidenceUpdate={(newConfidence) => 
              handleConfidenceUpdate(selectedPressure.id, newConfidence)
            }
            showHistory={true}
          />
        </div>
      )}

      {/* Pressure Detail Modal */}
      <PressureDetailModal
        pressure={selectedPressure}
        isOpen={explorationState.showEvidenceModal}
        onClose={hideEvidenceModal}
        onEvidenceEventClick={handleEvidenceEventClick}
        onHighlightEvidence={handleHighlightEvidence}
        onClearHighlight={handleClearHighlight}
      />
    </div>
  )
}

export default PressureExploration