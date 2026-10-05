import { useState, useCallback, useRef, useEffect } from 'react'
import { CausalPath } from '@/types'
import { useGlobalStore } from '@/stores/globalStore'
import { apiClient } from '@/services/api'

export interface CausalPathHighlight {
  path: CausalPath
  highlightedEventIds: Set<string>
  highlightedRelationshipIds: Set<string>
  isActive: boolean
}

export interface PathExplorationOptions {
  maxDepth: number
  minConfidence: number
  minWeight: number
  includeIndirect: boolean
}

export interface PathNavigationState {
  currentPathIndex: number
  currentStepIndex: number
  isNavigating: boolean
  autoAdvance: boolean
  autoAdvanceInterval: number
}

export const useCausalPathExploration = (initialOptions?: Partial<PathExplorationOptions>) => {
  const [explorationOptions, setExplorationOptions] = useState<PathExplorationOptions>({
    maxDepth: 3,
    minConfidence: 0.1,
    minWeight: 0.1,
    includeIndirect: true,
    ...initialOptions
  })

  const [availablePaths, setAvailablePaths] = useState<CausalPath[]>([])
  const [currentHighlight, setCurrentHighlight] = useState<CausalPathHighlight | null>(null)
  const [navigationState, setNavigationState] = useState<PathNavigationState>({
    currentPathIndex: 0,
    currentStepIndex: 0,
    isNavigating: false,
    autoAdvance: false,
    autoAdvanceInterval: 2000
  })

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  const autoAdvanceTimerRef = useRef<number | null>(null)
  const { addError } = useGlobalStore()

  // Calculate path metrics
  const calculatePathMetrics = useCallback((path: CausalPath) => {
    const totalWeight = path.relationships.reduce((sum, rel) => sum + rel.weight, 0) / path.relationships.length || 0
    const avgConfidence = path.relationships.reduce((sum, rel) => sum + rel.confidence, 0) / path.relationships.length || 0
    const cumulativeStrength = path.relationships.reduce((product, rel) => product * (rel.weight * rel.confidence), 1)
    
    return {
      totalWeight,
      avgConfidence,
      cumulativeStrength,
      length: path.events.length,
      relationshipCount: path.relationships.length
    }
  }, [])

  // Filter paths based on exploration options
  const filterPaths = useCallback((paths: CausalPath[]): CausalPath[] => {
    return paths.filter(path => {
      // Filter by minimum confidence
      const avgConfidence = path.relationships.reduce((sum, rel) => sum + rel.confidence, 0) / path.relationships.length || 0
      if (avgConfidence < explorationOptions.minConfidence) return false

      // Filter by minimum weight
      const avgWeight = path.relationships.reduce((sum, rel) => sum + rel.weight, 0) / path.relationships.length || 0
      if (avgWeight < explorationOptions.minWeight) return false

      // Filter by relationship type
      if (!explorationOptions.includeIndirect) {
        const hasIndirect = path.relationships.some(rel => rel.relationship_type === 'indirect')
        if (hasIndirect) return false
      }

      return true
    })
  }, [explorationOptions])

  // Start exploration from a specific event
  const startExploration = useCallback(async (startEventId: string) => {
    setIsLoading(true)
    setError(null)
    
    try {
      // Fetch causal chains from API
      const rawPaths = await apiClient.causal.findChain(startEventId, explorationOptions.maxDepth)
      
      // Filter and enhance paths with metrics
      const filteredPaths = filterPaths(rawPaths)
      const pathsWithMetrics = filteredPaths.map(path => ({
        ...path,
        ...calculatePathMetrics(path)
      }))

      // Sort by cumulative strength (strongest first)
      pathsWithMetrics.sort((a, b) => b.cumulativeStrength - a.cumulativeStrength)

      setAvailablePaths(pathsWithMetrics)
      
      // Reset navigation state
      setNavigationState({
        currentPathIndex: 0,
        currentStepIndex: 0,
        isNavigating: pathsWithMetrics.length > 0,
        autoAdvance: false,
        autoAdvanceInterval: 2000
      })

      // Highlight the first path if available
      if (pathsWithMetrics.length > 0 && pathsWithMetrics[0]) {
        highlightPath(pathsWithMetrics[0])
      }

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to explore causal paths'
      setError(errorMessage)
      addError({
        message: errorMessage,
        type: 'network'
      })
    } finally {
      setIsLoading(false)
    }
  }, [explorationOptions, filterPaths, calculatePathMetrics, addError]) // eslint-disable-line react-hooks/exhaustive-deps

  // Highlight a specific path
  const highlightPath = useCallback((path: CausalPath) => {
    const highlightedEventIds = new Set(path.events.map(event => event.id))
    const highlightedRelationshipIds = new Set(path.relationships.map(rel => rel.id))

    const highlight: CausalPathHighlight = {
      path,
      highlightedEventIds,
      highlightedRelationshipIds,
      isActive: true
    }

    setCurrentHighlight(highlight)
  }, [])

  // Clear current highlight
  const clearHighlight = useCallback(() => {
    setCurrentHighlight(null)
  }, [])

  // Navigate to a specific path
  const navigateToPath = useCallback((pathIndex: number) => {
    if (pathIndex >= 0 && pathIndex < availablePaths.length) {
      setNavigationState(prev => ({
        ...prev,
        currentPathIndex: pathIndex,
        currentStepIndex: 0
      }))
      const path = availablePaths[pathIndex]
      if (path) {
        highlightPath(path)
      }
    }
  }, [availablePaths, highlightPath])

  // Navigate to a specific step within current path
  const navigateToStep = useCallback((stepIndex: number) => {
    const currentPath = availablePaths[navigationState.currentPathIndex]
    if (currentPath && stepIndex >= 0 && stepIndex < currentPath.events.length) {
      setNavigationState(prev => ({
        ...prev,
        currentStepIndex: stepIndex
      }))
    }
  }, [availablePaths, navigationState.currentPathIndex])

  // Navigate to next step
  const nextStep = useCallback(() => {
    const currentPath = availablePaths[navigationState.currentPathIndex]
    if (currentPath && navigationState.currentStepIndex < currentPath.events.length - 1) {
      navigateToStep(navigationState.currentStepIndex + 1)
      return true
    }
    return false
  }, [availablePaths, navigationState, navigateToStep])

  // Navigate to previous step
  const previousStep = useCallback(() => {
    if (navigationState.currentStepIndex > 0) {
      navigateToStep(navigationState.currentStepIndex - 1)
      return true
    }
    return false
  }, [navigationState.currentStepIndex, navigateToStep])

  // Navigate to next path
  const nextPath = useCallback(() => {
    if (navigationState.currentPathIndex < availablePaths.length - 1) {
      navigateToPath(navigationState.currentPathIndex + 1)
      return true
    }
    return false
  }, [availablePaths.length, navigationState.currentPathIndex, navigateToPath])

  // Navigate to previous path
  const previousPath = useCallback(() => {
    if (navigationState.currentPathIndex > 0) {
      navigateToPath(navigationState.currentPathIndex - 1)
      return true
    }
    return false
  }, [navigationState.currentPathIndex, navigateToPath])

  // Toggle auto-advance mode
  const toggleAutoAdvance = useCallback(() => {
    setNavigationState(prev => ({
      ...prev,
      autoAdvance: !prev.autoAdvance
    }))
  }, [])

  // Set auto-advance interval
  const setAutoAdvanceInterval = useCallback((interval: number) => {
    setNavigationState(prev => ({
      ...prev,
      autoAdvanceInterval: Math.max(500, interval) // Minimum 500ms
    }))
  }, [])

  // Stop exploration and clear all state
  const stopExploration = useCallback(() => {
    setAvailablePaths([])
    setCurrentHighlight(null)
    setNavigationState({
      currentPathIndex: 0,
      currentStepIndex: 0,
      isNavigating: false,
      autoAdvance: false,
      autoAdvanceInterval: 2000
    })
    setError(null)
    
    // Clear auto-advance timer
    if (autoAdvanceTimerRef.current) {
      clearTimeout(autoAdvanceTimerRef.current)
      autoAdvanceTimerRef.current = null
    }
  }, [])

  // Update exploration options
  const updateExplorationOptions = useCallback((updates: Partial<PathExplorationOptions>) => {
    setExplorationOptions(prev => ({
      ...prev,
      ...updates
    }))
  }, [])

  // Get current path and step information
  const getCurrentPathInfo = useCallback(() => {
    const currentPath = availablePaths[navigationState.currentPathIndex]
    if (!currentPath) return null

    const currentEvent = currentPath.events[navigationState.currentStepIndex]
    const currentRelationship = navigationState.currentStepIndex > 0 
      ? currentPath.relationships[navigationState.currentStepIndex - 1] 
      : null

    return {
      path: currentPath,
      event: currentEvent,
      relationship: currentRelationship,
      stepIndex: navigationState.currentStepIndex,
      pathIndex: navigationState.currentPathIndex,
      isFirstStep: navigationState.currentStepIndex === 0,
      isLastStep: navigationState.currentStepIndex === currentPath.events.length - 1,
      isFirstPath: navigationState.currentPathIndex === 0,
      isLastPath: navigationState.currentPathIndex === availablePaths.length - 1
    }
  }, [availablePaths, navigationState])

  // Auto-advance effect
  useEffect(() => {
    if (navigationState.autoAdvance && navigationState.isNavigating) {
      autoAdvanceTimerRef.current = setTimeout(() => {
        const advanced = nextStep()
        if (!advanced) {
          // If we can't advance to next step, try next path
          const pathAdvanced = nextPath()
          if (!pathAdvanced) {
            // If we can't advance to next path, stop auto-advance
            setNavigationState(prev => ({ ...prev, autoAdvance: false }))
          }
        }
      }, navigationState.autoAdvanceInterval)

      return () => {
        if (autoAdvanceTimerRef.current) {
          clearTimeout(autoAdvanceTimerRef.current)
          autoAdvanceTimerRef.current = null
        }
      }
    }
  }, [navigationState.autoAdvance, navigationState.isNavigating, navigationState.autoAdvanceInterval, nextStep, nextPath])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (autoAdvanceTimerRef.current) {
        clearTimeout(autoAdvanceTimerRef.current)
      }
    }
  }, [])

  return {
    // State
    availablePaths,
    currentHighlight,
    navigationState,
    explorationOptions,
    isLoading,
    error,

    // Actions
    startExploration,
    stopExploration,
    highlightPath,
    clearHighlight,
    navigateToPath,
    navigateToStep,
    nextStep,
    previousStep,
    nextPath,
    previousPath,
    toggleAutoAdvance,
    setAutoAdvanceInterval,
    updateExplorationOptions,

    // Computed values
    getCurrentPathInfo,
    
    // Utilities
    calculatePathMetrics,
    filterPaths
  }
}

export default useCausalPathExploration