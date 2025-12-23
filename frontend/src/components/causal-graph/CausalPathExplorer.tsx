import React, { useState, useCallback, useEffect, useRef } from 'react'
import { CausalPath } from '@/types'
import { useGlobalStore } from '@/stores/globalStore'
import { apiClient } from '@/services/api'
import {
  calculateCumulativeStrength,
  transformPathToSteps,
  CausalChainStep
} from '@/utils/causalPathCalculations'

export interface CausalPathExplorerProps {
  className?: string
  focusEventId?: string
  maxDepth?: number
  onPathSelect?: (path: CausalPath) => void
  onPathHighlight?: (path: CausalPath | null) => void
}

// Re-export CausalChainStep for backwards compatibility
export type { CausalChainStep }

export interface ExplorationState {
  isExploring: boolean
  currentPath: CausalPath | null
  availablePaths: CausalPath[]
  currentStepIndex: number
  explorationDepth: number
}

export const CausalPathExplorer: React.FC<CausalPathExplorerProps> = ({
  className = '',
  focusEventId,
  maxDepth = 3,
  onPathSelect,
  onPathHighlight
}) => {
  const [explorationState, setExplorationState] = useState<ExplorationState>({
    isExploring: false,
    currentPath: null,
    availablePaths: [],
    currentStepIndex: 0,
    explorationDepth: maxDepth
  })
  
  const [isLoading, setIsLoading] = useState(false)
  // TODO: Use highlightedPath for visual indication or remove if not needed
  // const [highlightedPath, setHighlightedPath] = useState<CausalPath | null>(null)

  // Ref for cancelling pending API requests
  const abortControllerRef = useRef<AbortController | null>(null)
  // Request counter to prevent race conditions in loading state
  const requestIdRef = useRef(0)

  const { addError } = useGlobalStore()

  // Cleanup on unmount - cancel any pending requests
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [])

  // Start causal chain exploration from a specific event
  const startExploration = useCallback(async (startEventId: string, depth: number = maxDepth) => {
    // Cancel any pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    // Create new abort controller for this request
    const abortController = new AbortController()
    abortControllerRef.current = abortController

    // Increment request ID to track this specific request
    const currentRequestId = ++requestIdRef.current

    setIsLoading(true)
    setExplorationState(prev => ({
      ...prev,
      isExploring: true,
      explorationDepth: depth
    }))

    try {
      // Fetch causal chains from the API with abort signal
      const paths = await apiClient.causal.findChain(startEventId, depth, abortController.signal)

      // Check if this request was cancelled or superseded (double-check for race conditions)
      if (abortController.signal.aborted || currentRequestId !== requestIdRef.current) {
        return
      }

      // Calculate cumulative strengths and sort by strength
      const pathsWithStrength = paths.map(path => ({
        ...path,
        totalWeight: calculateCumulativeStrength(path.relationships)
      })).sort((a, b) => b.totalWeight - a.totalWeight)

      setExplorationState(prev => ({
        ...prev,
        availablePaths: pathsWithStrength,
        currentPath: pathsWithStrength[0] || null,
        currentStepIndex: 0
      }))

      // Highlight the strongest path by default
      if (pathsWithStrength.length > 0) {
        const strongestPath = pathsWithStrength[0]
        if (strongestPath) {
          // TODO: Implement visual highlighting
          // setHighlightedPath(strongestPath)
          onPathHighlight?.(strongestPath)
          onPathSelect?.(strongestPath)
        }
      }

    } catch (error) {
      // Ignore abort errors or if this request was superseded
      if (error instanceof Error && error.name === 'AbortError') {
        return
      }
      // Only report error if this is still the active request
      if (currentRequestId === requestIdRef.current) {
        console.error('Failed to explore causal chains:', error)
        addError({
          message: 'Failed to explore causal chains',
          type: 'network'
        })
      }
    } finally {
      // Only clear loading if this is still the active request (check both abort and request ID)
      if (!abortController.signal.aborted && currentRequestId === requestIdRef.current) {
        setIsLoading(false)
      }
    }
  }, [maxDepth, addError, onPathHighlight, onPathSelect])

  // Stop exploration and clear highlights
  const stopExploration = useCallback(() => {
    // Cancel any pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }

    setIsLoading(false)
    setExplorationState({
      isExploring: false,
      currentPath: null,
      availablePaths: [],
      currentStepIndex: 0,
      explorationDepth: maxDepth
    })
    // TODO: Implement visual highlighting
    // setHighlightedPath(null)
    onPathHighlight?.(null)
  }, [maxDepth, onPathHighlight])

  // Select a different path from available paths
  const selectPath = useCallback((pathIndex: number) => {
    const selectedPath = explorationState.availablePaths[pathIndex]
    if (selectedPath) {
      setExplorationState(prev => ({
        ...prev,
        currentPath: selectedPath,
        currentStepIndex: 0
      }))
      // TODO: Implement visual highlighting
      // setHighlightedPath(selectedPath)
      onPathHighlight?.(selectedPath)
      onPathSelect?.(selectedPath)
    }
  }, [explorationState.availablePaths, onPathHighlight, onPathSelect])

  // Navigate to specific step in current path
  const navigateToStep = useCallback((stepIndex: number) => {
    if (explorationState.currentPath && stepIndex >= 0 && stepIndex < explorationState.currentPath.events.length) {
      setExplorationState(prev => ({
        ...prev,
        currentStepIndex: stepIndex
      }))
    }
  }, [explorationState.currentPath])

  // Navigate to next step
  const nextStep = useCallback(() => {
    if (explorationState.currentPath && explorationState.currentStepIndex < explorationState.currentPath.events.length - 1) {
      navigateToStep(explorationState.currentStepIndex + 1)
    }
  }, [explorationState.currentPath, explorationState.currentStepIndex, navigateToStep])

  // Navigate to previous step
  const previousStep = useCallback(() => {
    if (explorationState.currentStepIndex > 0) {
      navigateToStep(explorationState.currentStepIndex - 1)
    }
  }, [explorationState.currentStepIndex, navigateToStep])

  // Auto-start exploration when focusEventId changes
  useEffect(() => {
    if (focusEventId && !explorationState.isExploring) {
      startExploration(focusEventId, explorationState.explorationDepth)
    }
  }, [focusEventId, explorationState.isExploring, explorationState.explorationDepth, startExploration])

  // Handle keyboard navigation
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!explorationState.isExploring) return

    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault()
        nextStep()
        break
      case 'ArrowLeft':
        event.preventDefault()
        previousStep()
        break
      case 'Escape':
        event.preventDefault()
        stopExploration()
        break
    }
  }, [explorationState.isExploring, nextStep, previousStep, stopExploration])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Get current chain steps for display
  const currentSteps = explorationState.currentPath ? transformPathToSteps(explorationState.currentPath) : []

  if (!explorationState.isExploring) {
    return null
  }

  return (
    <div className={`causal-path-explorer bg-white border border-gray-200 rounded-lg shadow-lg ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <div className="flex items-center space-x-3">
          <div className="w-3 h-3 bg-blue-500 rounded-full animate-pulse"></div>
          <h3 className="text-lg font-semibold text-gray-800">Causal Chain Explorer</h3>
          {isLoading && (
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
          )}
        </div>
        <button
          onClick={stopExploration}
          className="text-gray-400 hover:text-gray-600 transition-colors"
          title="Stop exploration (Escape)"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Path Selection */}
      {explorationState.availablePaths.length > 1 && (
        <div className="p-4 border-b border-gray-200">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Available Paths ({explorationState.availablePaths.length})
          </label>
          <div className="space-y-2">
            {explorationState.availablePaths.slice(0, 5).map((path, index) => (
              <button
                key={index}
                onClick={() => selectPath(index)}
                className={`w-full text-left p-2 rounded-md border transition-colors ${
                  explorationState.currentPath === path
                    ? 'bg-blue-50 border-blue-200 text-blue-800'
                    : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm">
                    Path {index + 1}: {path.events.length} events
                  </span>
                  <div className="flex items-center space-x-2">
                    <span className="text-xs text-gray-500">
                      Strength: {(path.totalWeight * 100).toFixed(1)}%
                    </span>
                    <div 
                      className="w-12 h-2 bg-gray-200 rounded-full overflow-hidden"
                      title={`Cumulative strength: ${(path.totalWeight * 100).toFixed(1)}%`}
                    >
                      <div 
                        className="h-full bg-blue-500 transition-all duration-300"
                        style={{ width: `${Math.max(path.totalWeight * 100, 5)}%` }}
                      />
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Current Path Navigation */}
      {explorationState.currentPath && (
        <div className="p-4">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-md font-medium text-gray-800">
              Path Navigation ({currentSteps.length} steps)
            </h4>
            <div className="flex items-center space-x-2">
              <button
                onClick={previousStep}
                disabled={explorationState.currentStepIndex === 0}
                className="p-1 rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Previous step (←)"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <span className="text-sm text-gray-600">
                {explorationState.currentStepIndex + 1} / {currentSteps.length}
              </span>
              <button
                onClick={nextStep}
                disabled={explorationState.currentStepIndex === currentSteps.length - 1}
                className="p-1 rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Next step (→)"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>

          {/* Step Timeline */}
          <div className="space-y-3">
            {currentSteps.map((step, index) => (
              <div
                key={step.event.id}
                className={`flex items-center space-x-3 p-3 rounded-lg border transition-all cursor-pointer ${
                  index === explorationState.currentStepIndex
                    ? 'bg-blue-50 border-blue-200 shadow-sm'
                    : index < explorationState.currentStepIndex
                    ? 'bg-green-50 border-green-200'
                    : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                }`}
                onClick={() => navigateToStep(index)}
              >
                {/* Step indicator */}
                <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  index === explorationState.currentStepIndex
                    ? 'bg-blue-500 text-white'
                    : index < explorationState.currentStepIndex
                    ? 'bg-green-500 text-white'
                    : 'bg-gray-300 text-gray-600'
                }`}>
                  {index + 1}
                </div>

                {/* Event details */}
                <div className="flex-grow min-w-0">
                  <div className="flex items-center justify-between">
                    <div className="truncate">
                      <span className="font-medium text-gray-800">
                        {step.event.actor} → {step.event.target}
                      </span>
                    </div>
                    <div className="flex items-center space-x-2 text-xs text-gray-500">
                      <span>{new Date(step.event.timestamp).toLocaleDateString()}</span>
                      {step.relationship && (
                        <span className="px-2 py-1 bg-gray-200 rounded-full">
                          W: {step.relationship.weight.toFixed(2)}
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="text-sm text-gray-600 truncate mt-1">
                    {step.event.description}
                  </p>
                  
                  {/* Relationship details */}
                  {step.relationship && (
                    <div className="mt-2 p-2 bg-white rounded border border-gray-200">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-600">Causal Link:</span>
                        <div className="flex items-center space-x-2">
                          <span className="capitalize">{step.relationship.relationship_type}</span>
                          <div className="flex items-center space-x-1">
                            <span>Confidence: {(step.relationship.confidence * 100).toFixed(0)}%</span>
                            <div className="w-8 h-1 bg-gray-200 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-blue-500"
                                style={{ width: `${step.relationship.confidence * 100}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                      {step.relationship.evidence && (
                        <p className="text-xs text-gray-600 mt-1 italic">
                          "{step.relationship.evidence}"
                        </p>
                      )}
                    </div>
                  )}

                  {/* Cumulative strength indicator */}
                  <div className="mt-2 flex items-center space-x-2">
                    <span className="text-xs text-gray-500">Cumulative strength:</span>
                    <div className="flex-grow h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-gradient-to-r from-green-500 to-red-500 transition-all duration-300"
                        style={{ width: `${Math.max(step.cumulativeWeight * 100, 2)}%` }}
                      />
                    </div>
                    <span className="text-xs font-medium text-gray-700">
                      {(step.cumulativeWeight * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>

                {/* Connection arrow */}
                {index < currentSteps.length - 1 && (
                  <div className="flex-shrink-0 text-gray-400">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Path Summary */}
          <div className="mt-4 p-3 bg-gray-50 rounded-lg">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">Path Summary:</span>
              <div className="flex items-center space-x-4">
                <span>
                  <span className="font-medium">{explorationState.currentPath.events.length}</span> events
                </span>
                <span>
                  <span className="font-medium">{explorationState.currentPath.relationships.length}</span> links
                </span>
                <span>
                  Overall strength: <span className="font-medium">{(explorationState.currentPath.totalWeight * 100).toFixed(1)}%</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* No paths found */}
      {!isLoading && explorationState.availablePaths.length === 0 && explorationState.isExploring && (
        <div className="p-8 text-center text-gray-500">
          <svg className="w-12 h-12 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 12h6m-6-4h6m2 5.291A7.962 7.962 0 0112 15c-2.34 0-4.47.881-6.08 2.33" />
          </svg>
          <p className="text-lg font-medium mb-2">No causal chains found</p>
          <p className="text-sm">
            No causal relationships were found starting from the selected event within {explorationState.explorationDepth} steps.
          </p>
        </div>
      )}

      {/* Keyboard shortcuts help */}
      <div className="px-4 py-2 border-t border-gray-200 bg-gray-50 text-xs text-gray-500">
        <div className="flex items-center justify-between">
          <span>Keyboard shortcuts:</span>
          <div className="flex items-center space-x-4">
            <span>← → Navigate steps</span>
            <span>Esc Close</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default CausalPathExplorer