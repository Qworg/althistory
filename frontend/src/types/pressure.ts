import { InferredPressure, Event, Arc } from './index'

// Extended pressure interface for UI state management
export interface PressureWithContext extends InferredPressure {
  // Relations
  affectedArcs: Arc[]
  evidenceEvents: Event[]
  influenceStrength: number
  
  // UI state
  isVisible: boolean
  isHighlighted: boolean
  renderColor: string
  renderOpacity: number
}

// Pressure visualization configuration
export interface PressureVisualizationConfig {
  showIndicators: boolean
  confidenceThreshold: number
  colorScheme: PressureColorScheme
  opacityRange: [number, number]
  showTooltips: boolean
  showEvidenceHighlight: boolean
}

// Color schemes for different pressure types
export interface PressureColorScheme {
  economic: string
  social: string
  environmental: string
  political: string
}

// Default color schemes
export const DEFAULT_PRESSURE_COLORS: PressureColorScheme = {
  economic: '#10b981', // emerald-500
  social: '#f59e0b',   // amber-500
  environmental: '#06b6d4', // cyan-500
  political: '#8b5cf6'  // violet-500
}

// Pressure indicator render data
export interface PressureIndicatorData {
  id: string
  pressure: PressureWithContext
  arc: Arc
  x: number
  y: number
  width: number
  height: number
  color: string
  opacity: number
  strokeColor: string
  strokeWidth: number
}

// Pressure tooltip data
export interface PressureTooltipData {
  pressure: PressureWithContext
  position: { x: number; y: number }
  evidenceCount: number
  confidenceLevel: 'low' | 'medium' | 'high'
  formattedConfidence: string
}

// Pressure exploration state
export interface PressureExplorationState {
  selectedPressure: PressureWithContext | null
  highlightedEvidence: Set<string>
  showEvidenceModal: boolean
  confidenceTracking: Map<string, number[]> // pressure id -> confidence history
}