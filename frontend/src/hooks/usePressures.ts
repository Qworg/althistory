import { useState, useCallback, useMemo } from 'react'
import { useInferredPressures } from './useAPI'
import { useGlobalStore } from '@/stores/globalStore'
import { 
  PressureWithContext, 
  PressureExplorationState,
  PressureVisualizationConfig,
  DEFAULT_PRESSURE_COLORS 
} from '@/types/pressure'
import { 
  processPressuresWithContext,
  filterPressuresByConfidence,
  groupPressuresByType 
} from '@/utils/pressureVisualization'

/**
 * Hook for managing pressure data and visualization state
 */
export function usePressures(arcId?: string) {
  // Global state
  const { arcs, events, inferredPressures, setInferredPressures } = useGlobalStore()
  
  // Local state for pressure exploration
  const [explorationState, setExplorationState] = useState<PressureExplorationState>({
    selectedPressure: null,
    highlightedEvidence: new Set(),
    showEvidenceModal: false,
    confidenceTracking: new Map()
  })

  // Visualization configuration
  const [visualConfig, setVisualConfig] = useState<PressureVisualizationConfig>({
    showIndicators: true,
    confidenceThreshold: 0.1,
    colorScheme: DEFAULT_PRESSURE_COLORS,
    opacityRange: [0.2, 0.8],
    showTooltips: true,
    showEvidenceHighlight: true
  })

  // Fetch pressure data
  const { 
    data: pressureData, 
    isLoading, 
    error, 
    refetch 
  } = useInferredPressures(arcId, {
    onSuccess: (data) => {
      setInferredPressures(data)
    }
  })

  // Process pressures with context
  const pressuresWithContext = useMemo(() => {
    const rawPressures = pressureData || inferredPressures
    const selectedPressureIds = explorationState.selectedPressure 
      ? new Set([explorationState.selectedPressure.id]) 
      : new Set<string>()
    const highlightedPressureIds = new Set<string>()

    return processPressuresWithContext(
      rawPressures,
      arcs,
      events,
      selectedPressureIds,
      highlightedPressureIds
    )
  }, [pressureData, inferredPressures, arcs, events, explorationState.selectedPressure])

  // Filter pressures by confidence threshold
  const visiblePressures = useMemo(() => {
    return filterPressuresByConfidence(pressuresWithContext, visualConfig.confidenceThreshold)
  }, [pressuresWithContext, visualConfig.confidenceThreshold])

  // Group pressures by type
  const pressuresByType = useMemo(() => {
    return groupPressuresByType(visiblePressures)
  }, [visiblePressures])

  // Pressure selection handlers
  const selectPressure = useCallback((pressure: PressureWithContext | null) => {
    setExplorationState(prev => ({
      ...prev,
      selectedPressure: pressure,
      highlightedEvidence: pressure ? new Set(pressure.evidenceEvents.map(e => e.id)) : new Set()
    }))
  }, [])

  const highlightPressureEvidence = useCallback((pressure: PressureWithContext) => {
    setExplorationState(prev => ({
      ...prev,
      highlightedEvidence: new Set(pressure.evidenceEvents.map(e => e.id))
    }))
  }, [])

  const clearPressureHighlight = useCallback(() => {
    setExplorationState(prev => ({
      ...prev,
      highlightedEvidence: new Set()
    }))
  }, [])

  // Evidence modal handlers
  const showEvidenceModal = useCallback((pressure: PressureWithContext) => {
    setExplorationState(prev => ({
      ...prev,
      selectedPressure: pressure,
      showEvidenceModal: true,
      highlightedEvidence: new Set(pressure.evidenceEvents.map(e => e.id))
    }))
  }, [])

  const hideEvidenceModal = useCallback(() => {
    setExplorationState(prev => ({
      ...prev,
      showEvidenceModal: false,
      highlightedEvidence: new Set()
    }))
  }, [])

  // Confidence tracking
  const trackConfidenceChange = useCallback((pressureId: string, newConfidence: number) => {
    setExplorationState(prev => {
      const newTracking = new Map(prev.confidenceTracking)
      const history = newTracking.get(pressureId) || []
      history.push(newConfidence)
      
      // Keep only last 10 confidence scores
      if (history.length > 10) {
        history.shift()
      }
      
      newTracking.set(pressureId, history)
      
      return {
        ...prev,
        confidenceTracking: newTracking
      }
    })
  }, [])

  // Configuration handlers
  const updateVisualizationConfig = useCallback((updates: Partial<PressureVisualizationConfig>) => {
    setVisualConfig(prev => ({ ...prev, ...updates }))
  }, [])

  const setConfidenceThreshold = useCallback((threshold: number) => {
    setVisualConfig(prev => ({ ...prev, confidenceThreshold: threshold }))
  }, [])

  const togglePressureIndicators = useCallback(() => {
    setVisualConfig(prev => ({ ...prev, showIndicators: !prev.showIndicators }))
  }, [])

  // Statistics
  const pressureStats = useMemo(() => {
    const totalPressures = pressuresWithContext.length
    const visibleCount = visiblePressures.length
    const averageConfidence = pressuresWithContext.length > 0 
      ? pressuresWithContext.reduce((sum, p) => sum + p.confidence_score, 0) / pressuresWithContext.length
      : 0
    
    const typeDistribution = Object.entries(pressuresByType).reduce((dist, [type, pressures]) => {
      dist[type] = pressures.length
      return dist
    }, {} as Record<string, number>)

    return {
      totalPressures,
      visibleCount,
      averageConfidence,
      typeDistribution,
      hiddenCount: totalPressures - visibleCount
    }
  }, [pressuresWithContext, visiblePressures, pressuresByType])

  return {
    // Data
    pressuresWithContext,
    visiblePressures,
    pressuresByType,
    pressureStats,
    
    // Loading state
    isLoading,
    error,
    refetch,
    
    // Exploration state
    explorationState,
    selectedPressure: explorationState.selectedPressure,
    highlightedEvidence: explorationState.highlightedEvidence,
    showEvidenceModal: explorationState.showEvidenceModal,
    
    // Configuration
    visualConfig,
    
    // Actions
    selectPressure,
    highlightPressureEvidence,
    clearPressureHighlight,
    showEvidenceModalAction: showEvidenceModal,
    hideEvidenceModal,
    trackConfidenceChange,
    updateVisualizationConfig,
    setConfidenceThreshold,
    togglePressureIndicators
  }
}