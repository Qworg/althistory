import { InferredPressure, Arc, Event } from '@/types'
import {
  PressureWithContext,
  PressureIndicatorData,
  PressureTooltipData,
  DEFAULT_PRESSURE_COLORS
} from '@/types/pressure'

/**
 * Processes raw pressure data with context for visualization
 */
export function processPressuresWithContext(
  pressures: InferredPressure[],
  arcs: Arc[],
  events: Event[],
  // Retained for call-site arity (the real selection filter is still a backend
  // concern); deliberately no default so it is never "assigned" an unused value.
  _selectedPressures?: Set<string>,
  highlightedPressures: Set<string> = new Set()
): PressureWithContext[] {
  return pressures.map(pressure => {
    // The arcs the pressure falls in, by the period the backend inferred it
    // over. The backend reports that period (`time_range`); without it the
    // pressure could not be placed in time at all.
    const affectedArcs = pressure.time_range
      ? arcs.filter(arc => {
          const arcStart = new Date(arc.start_time).getTime()
          const arcEnd = new Date(arc.end_time).getTime()
          const rangeStart = new Date(pressure.time_range!.start).getTime()
          const rangeEnd = new Date(pressure.time_range!.end).getTime()
          return arcStart <= rangeEnd && arcEnd >= rangeStart
        })
      : []

    // The events the inference rests on, by their ids. The backend reports
    // them (`evidence_event_ids`); before that, every event inside every arc
    // counted as evidence for every pressure.
    const evidenceIds = new Set(pressure.evidence_event_ids ?? [])
    const evidenceEvents =
      evidenceIds.size > 0 ? events.filter(event => evidenceIds.has(event.id)) : []

    // Calculate influence strength based on confidence and evidence count
    const influenceStrength = Math.min(
      pressure.confidence_score * (1 + Math.log(evidenceEvents.length + 1) / 10),
      1.0
    )

    // Determine render properties
    const renderColor = DEFAULT_PRESSURE_COLORS[pressure.pressure_type]
    const renderOpacity = calculatePressureOpacity(pressure.confidence_score)

    return {
      ...pressure,
      affectedArcs,
      evidenceEvents,
      influenceStrength,
      isVisible: pressure.confidence_score >= 0.1, // Hide very low confidence pressures
      isHighlighted: highlightedPressures.has(pressure.id),
      renderColor,
      renderOpacity
    }
  })
}

/**
 * Calculates opacity based on confidence score
 */
export function calculatePressureOpacity(confidenceScore: number): number {
  // Map confidence score (0-1) to opacity range (0.2-0.8)
  const minOpacity = 0.2
  const maxOpacity = 0.8
  return minOpacity + (confidenceScore * (maxOpacity - minOpacity))
}

/**
 * Generates pressure indicator render data for D3 visualization
 */
export function generatePressureIndicators(
  pressuresWithContext: PressureWithContext[],
  _arcs: Arc[],
  timeScale: (date: Date) => number,
  yScale: (level: number) => number,
  arcLevelMap: Map<string, number>
): PressureIndicatorData[] {
  const indicators: PressureIndicatorData[] = []

  pressuresWithContext.forEach(pressure => {
    if (!pressure.isVisible) return

    pressure.affectedArcs.forEach(arc => {
      // An arc that is not in the rendered hierarchy (a collapsed child) has
      // no level, and defaulting it to 0 drew its indicator in the root's row
      // -- on top of the root's own indicator.
      const arcLevel = arcLevelMap.get(arc.id)
      if (arcLevel === undefined) return
      const startX = timeScale(new Date(arc.start_time))
      const endX = timeScale(new Date(arc.end_time))
      const y = yScale(arcLevel)
      
      // Create indicator positioned on top of the arc
      const indicator: PressureIndicatorData = {
        id: `${pressure.id}-${arc.id}`,
        pressure,
        arc,
        x: startX,
        y: y - 25, // Position above the arc
        width: Math.max(endX - startX, 20), // Minimum width for visibility
        height: 4,
        color: pressure.renderColor,
        opacity: pressure.renderOpacity,
        strokeColor: pressure.isHighlighted ? '#ffffff' : 'none',
        strokeWidth: pressure.isHighlighted ? 2 : 0
      }

      indicators.push(indicator)
    })
  })

  return indicators
}

/**
 * Formats pressure tooltip data
 */
export function formatPressureTooltip(
  pressure: PressureWithContext,
  position: { x: number; y: number }
): PressureTooltipData {
  const confidenceLevel = getConfidenceLevel(pressure.confidence_score)
  const formattedConfidence = `${Math.round(pressure.confidence_score * 100)}%`

  return {
    pressure,
    position,
    evidenceCount: pressure.evidenceEvents.length,
    confidenceLevel,
    formattedConfidence
  }
}

/**
 * Categorizes confidence score into levels
 */
export function getConfidenceLevel(confidenceScore: number): 'low' | 'medium' | 'high' {
  if (confidenceScore < 0.3) return 'low'
  if (confidenceScore < 0.7) return 'medium'
  return 'high'
}

/**
 * Formats pressure type for display
 */
export function formatPressureType(pressureType: string): string {
  return pressureType.charAt(0).toUpperCase() + pressureType.slice(1)
}

/**
 * Gets pressure type icon (using text symbols for now)
 */
export function getPressureTypeIcon(pressureType: string): string {
  const icons = {
    economic: '💰',
    social: '👥',
    environmental: '🌍',
    political: '🏛️'
  }
  return icons[pressureType as keyof typeof icons] || '❓'
}

/**
 * Calculates pressure indicator position to avoid overlaps
 */
export function calculatePressurePositions(
  indicators: PressureIndicatorData[]
): PressureIndicatorData[] {
  // Sort indicators by x position
  const sortedIndicators = [...indicators].sort((a, b) => a.x - b.x)
  
  // Adjust y positions to avoid overlaps
  const adjustedIndicators = sortedIndicators.map((indicator, index) => {
    let adjustedY = indicator.y
    
    // Check for overlaps with previous indicators
    for (let i = index - 1; i >= 0; i--) {
      const prevIndicator = sortedIndicators[i]
      if (!prevIndicator) continue

      const xOverlap = indicator.x < prevIndicator.x + prevIndicator.width + 5
      const yOverlap = Math.abs(adjustedY - prevIndicator.y) < 8

      if (xOverlap && yOverlap) {
        adjustedY = prevIndicator.y - 8 // Stack vertically
      }
    }
    
    return {
      ...indicator,
      y: adjustedY
    }
  })
  
  return adjustedIndicators
}

/**
 * Filters pressures by confidence threshold
 */
export function filterPressuresByConfidence(
  pressures: PressureWithContext[],
  threshold: number
): PressureWithContext[] {
  return pressures.filter(pressure => pressure.confidence_score >= threshold)
}

/**
 * Groups pressures by type
 */
export function groupPressuresByType(
  pressures: PressureWithContext[]
): Record<string, PressureWithContext[]> {
  return pressures.reduce((groups, pressure) => {
    const type = pressure.pressure_type
    if (!groups[type]) {
      groups[type] = []
    }
    groups[type].push(pressure)
    return groups
  }, {} as Record<string, PressureWithContext[]>)
}
