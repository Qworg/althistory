import React, { useState, useCallback, useMemo } from 'react'
import { CausalPath, Event } from '@/types'

export interface CausalChainNavigationControlsProps {
  className?: string
  /**
   * The graph's events, so the chain can show what each step *is*.
   *
   * A `CausalPath` names its events by id; without the events the controls
   * could only print ids.
   */
  events?: Event[]
  availablePaths: CausalPath[]
  currentPathIndex: number
  currentStepIndex: number
  isNavigating: boolean
  autoAdvance: boolean
  autoAdvanceInterval: number
  onPathSelect: (pathIndex: number) => void
  onStepNavigate: (stepIndex: number) => void
  onNextStep: () => void
  onPreviousStep: () => void
  onNextPath: () => void
  onPreviousPath: () => void
  onToggleAutoAdvance: () => void
  onSetAutoAdvanceInterval: (interval: number) => void
  onStopNavigation: () => void
}

export const CausalChainNavigationControls: React.FC<CausalChainNavigationControlsProps> = ({
  className = '',
  events = [],
  availablePaths,
  currentPathIndex,
  currentStepIndex,
  isNavigating,
  autoAdvance,
  autoAdvanceInterval,
  onPathSelect,
  onStepNavigate,
  onNextStep,
  onPreviousStep,
  onNextPath,
  onPreviousPath,
  onToggleAutoAdvance,
  onSetAutoAdvanceInterval,
  onStopNavigation
}) => {
  const [showAdvancedControls, setShowAdvancedControls] = useState(false)
  const [intervalInput, setIntervalInput] = useState(autoAdvanceInterval.toString())

  const currentPath = availablePaths[currentPathIndex]
  const hasMultiplePaths = availablePaths.length > 1

  const eventsById = useMemo(() => {
    const index = new Map<string, Event>()
    for (const event of events) index.set(event.id, event)
    return index
  }, [events])

  /** The event a path step names, if the graph still holds it. */
  const eventAt = useCallback(
    (path: CausalPath | undefined, index: number): Event | undefined => {
      const id = path?.events[index]
      return id ? eventsById.get(id) : undefined
    },
    [eventsById]
  )
  const hasMultipleSteps = currentPath && currentPath.events.length > 1

  // Handle interval input change
  const handleIntervalChange = useCallback((value: string) => {
    setIntervalInput(value)
    const numValue = parseInt(value, 10)
    if (!isNaN(numValue) && numValue >= 500) {
      onSetAutoAdvanceInterval(numValue)
    }
  }, [onSetAutoAdvanceInterval])

  // Calculate progress percentages
  const pathProgress = availablePaths.length > 0 ? ((currentPathIndex + 1) / availablePaths.length) * 100 : 0
  const stepProgress = currentPath ? ((currentStepIndex + 1) / currentPath.events.length) * 100 : 0

  if (!isNavigating || availablePaths.length === 0) {
    return null
  }

  return (
    <div className={`causal-chain-navigation bg-white border border-gray-200 rounded-lg shadow-lg ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <div className="flex items-center space-x-3">
          <div className="w-3 h-3 bg-blue-500 rounded-full animate-pulse"></div>
          <h3 className="text-lg font-semibold text-gray-800">Chain Navigation</h3>
          {autoAdvance && (
            <div className="flex items-center space-x-1 text-sm text-blue-600">
              <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>Auto-advancing</span>
            </div>
          )}
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setShowAdvancedControls(!showAdvancedControls)}
            className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
            title="Toggle advanced controls"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
            </svg>
          </button>
          <button
            onClick={onStopNavigation}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            title="Stop navigation"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Path Selection */}
      {hasMultiplePaths && (
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between mb-3">
            <label className="text-sm font-medium text-gray-700">
              Path Selection ({availablePaths.length} paths)
            </label>
            <div className="flex items-center space-x-2">
              <button
                onClick={onPreviousPath}
                disabled={currentPathIndex === 0}
                className="p-1 rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Previous path"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <span className="text-sm text-gray-600 min-w-[60px] text-center">
                {currentPathIndex + 1} / {availablePaths.length}
              </span>
              <button
                onClick={onNextPath}
                disabled={currentPathIndex === availablePaths.length - 1}
                className="p-1 rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Next path"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>

          {/* Path progress bar */}
          <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
            <div 
              className="bg-blue-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${pathProgress}%` }}
            />
          </div>

          {/* Current path info */}
          {currentPath && (
            <div className="text-sm text-gray-600">
              <div className="flex items-center justify-between">
                <span>
                  {currentPath.events.length} events, {currentPath.relationships.length} links
                </span>
                <span>
                  Strength: {((currentPath.total_strength || 0) * 100).toFixed(1)}%
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step Navigation */}
      {hasMultipleSteps && (
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between mb-3">
            <label className="text-sm font-medium text-gray-700">
              Step Navigation ({currentPath.events.length} steps)
            </label>
            <div className="flex items-center space-x-2">
              <button
                onClick={onPreviousStep}
                disabled={currentStepIndex === 0}
                className="p-1 rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Previous step (←)"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <span className="text-sm text-gray-600 min-w-[60px] text-center">
                {currentStepIndex + 1} / {currentPath.events.length}
              </span>
              <button
                onClick={onNextStep}
                disabled={currentStepIndex === currentPath.events.length - 1}
                className="p-1 rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Next step (→)"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>

          {/* Step progress bar */}
          <div className="w-full bg-gray-200 rounded-full h-2 mb-3">
            <div 
              className="bg-green-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${stepProgress}%` }}
            />
          </div>

          {/* Step timeline */}
          <div className="flex space-x-1 overflow-x-auto pb-2">
            {currentPath.events.map((eventId, index) => (
              <button
                key={eventId}
                onClick={() => onStepNavigate(index)}
                className={`flex-shrink-0 w-8 h-8 rounded-full text-xs font-medium transition-all ${
                  index === currentStepIndex
                    ? 'bg-green-500 text-white shadow-md'
                    : index < currentStepIndex
                    ? 'bg-green-200 text-green-800 hover:bg-green-300'
                    : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                }`}
                title={
                  eventAt(currentPath, index)
                    ? `${eventAt(currentPath, index)!.actor} → ${eventAt(currentPath, index)!.target}`
                    : eventId
                }
              >
                {index + 1}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Auto-advance Controls */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between mb-3">
          <label className="text-sm font-medium text-gray-700">Auto-advance</label>
          <button
            onClick={onToggleAutoAdvance}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              autoAdvance ? 'bg-blue-600' : 'bg-gray-200'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                autoAdvance ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {autoAdvance && (
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <label className="text-xs text-gray-600 min-w-[60px]">Interval:</label>
              <input
                type="number"
                min="500"
                max="10000"
                step="100"
                value={intervalInput}
                onChange={(e) => handleIntervalChange(e.target.value)}
                className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-xs text-gray-500">ms</span>
            </div>
            <div className="flex space-x-1">
              {[500, 1000, 2000, 3000].map(interval => (
                <button
                  key={interval}
                  onClick={() => {
                    setIntervalInput(interval.toString())
                    onSetAutoAdvanceInterval(interval)
                  }}
                  className={`px-2 py-1 text-xs rounded-md border transition-colors ${
                    autoAdvanceInterval === interval
                      ? 'bg-blue-100 border-blue-300 text-blue-800'
                      : 'bg-gray-100 border-gray-300 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {interval < 1000 ? `${interval}ms` : `${interval / 1000}s`}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Advanced Controls */}
      {showAdvancedControls && (
        <div className="p-4 border-b border-gray-200 bg-gray-50">
          <h4 className="text-sm font-medium text-gray-700 mb-3">Advanced Controls</h4>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => onStepNavigate(0)}
              className="px-3 py-2 text-xs bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
            >
              First Step
            </button>
            <button
              onClick={() => currentPath && onStepNavigate(currentPath.events.length - 1)}
              className="px-3 py-2 text-xs bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
            >
              Last Step
            </button>
            <button
              onClick={() => onPathSelect(0)}
              className="px-3 py-2 text-xs bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
            >
              First Path
            </button>
            <button
              onClick={() => onPathSelect(availablePaths.length - 1)}
              className="px-3 py-2 text-xs bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
            >
              Last Path
            </button>
          </div>
        </div>
      )}

      {/* Current Step Info */}
      {currentPath && (
        <div className="p-4">
          <h4 className="text-sm font-medium text-gray-700 mb-2">Current Step</h4>
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-gray-800">
                {eventAt(currentPath, currentStepIndex)?.actor ?? 'Unknown'} →{' '}
                {eventAt(currentPath, currentStepIndex)?.target ?? 'Unknown'}
              </span>
              <span className="text-xs text-gray-500">
                {eventAt(currentPath, currentStepIndex)?.timestamp
                  ? new Date(eventAt(currentPath, currentStepIndex)!.timestamp).toLocaleDateString()
                  : 'Unknown date'
                }
              </span>
            </div>
            <p className="text-sm text-gray-600 mb-2">
              {eventAt(currentPath, currentStepIndex)?.description ?? currentPath.events[currentStepIndex]}
            </p>
            
            {/* Relationship info for current step */}
            {currentStepIndex > 0 && currentPath.relationships[currentStepIndex - 1] && (
              <div className="mt-2 pt-2 border-t border-gray-200">
                <div className="text-xs text-gray-600 mb-1">Causal Link:</div>
                <div className="flex items-center justify-between text-xs">
                  <span className="capitalize">
                    {currentPath.relationships[currentStepIndex - 1]?.relationship_type}
                  </span>
                  <div className="flex items-center space-x-2">
                    <span>W: {currentPath.relationships[currentStepIndex - 1]?.weight.toFixed(2)}</span>
                    <span>C: {((currentPath.relationships[currentStepIndex - 1]?.confidence || 0) * 100).toFixed(0)}%</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Keyboard shortcuts */}
      <div className="px-4 py-2 border-t border-gray-200 bg-gray-50 text-xs text-gray-500">
        <div className="flex items-center justify-between">
          <span>Keyboard shortcuts:</span>
          <div className="flex items-center space-x-4">
            <span>← → Steps</span>
            <span>↑ ↓ Paths</span>
            <span>Space Auto-advance</span>
            <span>Esc Stop</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default CausalChainNavigationControls