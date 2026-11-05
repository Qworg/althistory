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
// Each hue is at least 3:1 on the card surface in both themes (WCAG 1.4.11:
// these are marks, not text). Amber is reserved for divergence, so social
// pressure, which was amber-500, is rose; emerald-500 measured 2.5:1 on white.
export const DEFAULT_PRESSURE_COLORS: PressureColorScheme = {
  economic: '#059669', // emerald-600
  social: '#e11d48',   // rose-600
  environmental: '#0891b2', // cyan-600
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