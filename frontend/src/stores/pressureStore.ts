import { create } from 'zustand'
import {
  PressureExplorationState,
  PressureVisualizationConfig,
  PressureWithContext,
  DEFAULT_PRESSURE_COLORS
} from '@/types/pressure'

/**
 * The pressure visualisation's state, shared by everything that shows it.
 *
 * It used to live in `usePressures`'s own `useState`, which meant the panel and
 * the timeline each had their own copy: "Hide indicators" in the panel changed
 * the panel's own configuration and nothing else, and the confidence slider
 * moved a threshold the timeline never saw.
 *
 * The state is shared, so it belongs in a store. The pressure DATA is not
 * here -- that comes from the query -- but the configuration over it and the
 * exploration state (what is selected, what is highlighted) are.
 */
interface PressureStoreState {
  /** How the pressures are drawn and which of them are shown. */
  visualConfig: PressureVisualizationConfig
  /** What the user has selected and highlighted. */
  explorationState: PressureExplorationState

  /** Change part of the visualisation configuration. */
  updateVisualizationConfig: (updates: Partial<PressureVisualizationConfig>) => void
  /** Only the pressures at or above this confidence are shown. */
  setConfidenceThreshold: (threshold: number) => void
  /** Show or hide the indicators on the timeline. */
  togglePressureIndicators: () => void

  /** Select a pressure, or clear the selection. */
  selectPressure: (pressure: PressureWithContext | null) => void
  /** Highlight the events a pressure rests on. */
  highlightPressureEvidence: (pressure: PressureWithContext) => void
  /** Clear the evidence highlighting. */
  clearPressureHighlight: () => void
  /** Highlight a set of event ids. */
  setHighlightedEvidence: (eventIds: Set<string>) => void
  /** Open or close the evidence modal. */
  setEvidenceModalVisible: (visible: boolean) => void
  /** Record a new confidence value for a pressure. */
  trackConfidenceChange: (pressureId: string, confidence: number) => void
  /**
   * Forget everything the previous graph left behind.
   *
   * The exploration state belongs to the graph that was open: a pressure
   * selected in one graph would otherwise still be selected in the next.
   */
  resetForGraphSwitch: () => void
}

const INITIAL_CONFIG: PressureVisualizationConfig = {
  showIndicators: true,
  confidenceThreshold: 0.1,
  colorScheme: DEFAULT_PRESSURE_COLORS,
  opacityRange: [0.2, 0.8],
  showTooltips: true,
  showEvidenceHighlight: true,
}

const INITIAL_EXPLORATION: PressureExplorationState = {
  selectedPressure: null,
  highlightedEvidence: new Set(),
  showEvidenceModal: false,
  confidenceTracking: new Map(),
}

export const usePressureStore = create<PressureStoreState>((set) => ({
  visualConfig: INITIAL_CONFIG,
  explorationState: INITIAL_EXPLORATION,

  updateVisualizationConfig: (updates) =>
    set((state) => ({ visualConfig: { ...state.visualConfig, ...updates } })),

  setConfidenceThreshold: (confidenceThreshold) =>
    set((state) => ({
      visualConfig: { ...state.visualConfig, confidenceThreshold },
    })),

  togglePressureIndicators: () =>
    set((state) => ({
      visualConfig: {
        ...state.visualConfig,
        showIndicators: !state.visualConfig.showIndicators,
      },
    })),

  selectPressure: (selectedPressure) =>
    set((state) => ({
      explorationState: {
        ...state.explorationState,
        selectedPressure,
        highlightedEvidence: selectedPressure
          ? new Set(selectedPressure.evidenceEvents.map(event => event.id))
          : state.explorationState.highlightedEvidence,
      },
    })),

  highlightPressureEvidence: (pressure) =>
    set((state) => ({
      explorationState: {
        ...state.explorationState,
        highlightedEvidence: new Set(pressure.evidenceEvents.map(event => event.id)),
      },
    })),

  clearPressureHighlight: () =>
    set((state) => ({
      explorationState: { ...state.explorationState, highlightedEvidence: new Set() },
    })),

  setHighlightedEvidence: (highlightedEvidence) =>
    set((state) => ({ explorationState: { ...state.explorationState, highlightedEvidence } })),

  setEvidenceModalVisible: (showEvidenceModal) =>
    set((state) => ({ explorationState: { ...state.explorationState, showEvidenceModal } })),

  trackConfidenceChange: (pressureId, newConfidence) =>
    set((state) => {
      const history = state.explorationState.confidenceTracking.get(pressureId) ?? []
      // Keep only the last ten confidence scores.
      const next = [...history, newConfidence].slice(-10)
      const confidenceTracking = new Map(state.explorationState.confidenceTracking)
      confidenceTracking.set(pressureId, next)
      return {
        explorationState: { ...state.explorationState, confidenceTracking },
      }
    }),

  resetForGraphSwitch: () =>
    set({
      visualConfig: INITIAL_CONFIG,
      explorationState: {
        ...INITIAL_EXPLORATION,
        confidenceTracking: new Map(),
        highlightedEvidence: new Set(),
      },
    }),
}))
