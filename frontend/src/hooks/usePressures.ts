import { useCallback, useMemo } from 'react'
import { useInferredPressures } from './useAPI'
import { usePressureStore } from '@/stores/pressureStore'
import { PressureWithContext } from '@/types/pressure'
import { Arc, Event } from '@/types'
import { 
  processPressuresWithContext,
  filterPressuresByConfidence,
  groupPressuresByType 
} from '@/utils/pressureVisualization'

/**
 * TanStack Query v5 dropped the per-query `onSuccess` callback from `useQuery`
 * options (it survives only on the query cache config), so the callback below is
 * not part of the declared option type any more. It is kept exactly as it was at
 * runtime and typed explicitly, so the call site stays visible until it is
 * migrated to an effect that syncs the store.
 */
/**
 * Hook for managing pressure data and visualization state
 */
export function usePressures(
  /**
   * The arcs and events of the graph being shown.
   *
   * They are passed in rather than read from the store: the store's copies are
   * only filled by writes made in the current session, so the pressure context
   * was built from an empty graph and every pressure came out with no arcs and
   * no evidence.
   */
  arcs: Arc[] = [],
  events: Event[] = []
) {
  // The visualisation configuration and the exploration state are shared, so
  // the panel's controls reach the timeline and not only the panel.
  const visualConfig = usePressureStore((state) => state.visualConfig)
  const explorationState = usePressureStore((state) => state.explorationState)
  const updateVisualizationConfig = usePressureStore(
    (state) => state.updateVisualizationConfig
  )
  const setConfidenceThreshold = usePressureStore(
    (state) => state.setConfidenceThreshold
  )
  const togglePressureIndicators = usePressureStore(
    (state) => state.togglePressureIndicators
  )
  const selectPressureInStore = usePressureStore((state) => state.selectPressure)
  const highlightEvidenceInStore = usePressureStore(
    (state) => state.highlightPressureEvidence
  )
  const clearHighlightInStore = usePressureStore(
    (state) => state.clearPressureHighlight
  )
  const setEvidenceModalVisible = usePressureStore(
    (state) => state.setEvidenceModalVisible
  )
  const trackConfidence = usePressureStore((state) => state.trackConfidenceChange)

  // Fetch the pressures.
  //
  // The confidence threshold is NOT part of the request: the analyzer never
  // produces a pressure below its own MEDIUM_CONFIDENCE_THRESHOLD, so the
  // server's filter is enough and the threshold is applied to what came back.
  // Sending it meant every step of the slider refetched (and re-ran the cluster
  // analysis over the graph's events) and the indicators disappeared between
  // the answers.
  const { 
    data: pressureData, 
    isLoading, 
    error, 
    refetch 
  } = useInferredPressures({
    // The backend's default limit is 50, which silently cut a graph with more
    // clusters; and the total came back in the pagination, which the client
    // dropped.
    limit: 500,
  })

  // Process pressures with context
  const pressuresWithContext = useMemo(() => {
    const rawPressures = pressureData ?? []
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
  }, [pressureData, arcs, events, explorationState.selectedPressure])

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
    selectPressureInStore(pressure)
  }, [selectPressureInStore])

  const highlightPressureEvidence = useCallback((pressure: PressureWithContext) => {
    highlightEvidenceInStore(pressure)
  }, [highlightEvidenceInStore])

  const clearPressureHighlight = useCallback(() => {
    clearHighlightInStore()
  }, [clearHighlightInStore])

  // Evidence modal handlers
  const showEvidenceModal = useCallback((pressure: PressureWithContext) => {
    selectPressureInStore(pressure)
    setEvidenceModalVisible(true)
  }, [selectPressureInStore, setEvidenceModalVisible])

  const hideEvidenceModal = useCallback(() => {
    setEvidenceModalVisible(false)
  }, [setEvidenceModalVisible])

  // Confidence tracking
  const trackConfidenceChange = useCallback((pressureId: string, newConfidence: number) => {
    trackConfidence(pressureId, newConfidence)
  }, [trackConfidence])

  // Configuration handlers
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