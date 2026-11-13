import { InferredPressure, Arc, Event } from '@/types'
import {
  PressureWithContext,
  PressureIndicatorData,
  PressureTooltipData,
  DEFAULT_PRESSURE_COLORS
} from '@/types/pressure'
import { toAxisTime, toInstant } from '@althistory/calendar'

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
          // Exact axis times: `new Date(text)` cannot read the expanded-year
          // ISO text the backend writes beyond +-275,760 years.
          const arcStart = toAxisTime(arc.start_time)
          const arcEnd = toAxisTime(arc.end_time)
          const rangeStart = toAxisTime(pressure.time_range!.start)
          const rangeEnd = toAxisTime(pressure.time_range!.end)
          if (arcStart === null || arcEnd === null || rangeStart === null || rangeEnd === null) return false
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
      const startX = timeScale(toInstant(arc.start_time))
      const endX = timeScale(toInstant(arc.end_time))
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
 * SVG path data (24×24 viewBox, drawn with stroke="currentColor", round caps)
 * for each pressure type, in the app's outline icon set. Shared by React
 * consumers and by string-built tooltips, which can wrap a path in an <svg>.
 */
export const PRESSURE_TYPE_ICON_PATHS = {
  economic:
    'M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  social:
    'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
  environmental:
    'M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9',
  political: 'M3 21h18M4 18h16M6 18v-7m4 7v-7m4 7v-7m4 7v-7M12 3l9 5H3l9-5z',
} as const

/** Path for a pressure type not in the set: a circled question mark. */
export const UNKNOWN_PRESSURE_ICON_PATH =
  'M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'

/**
 * SVG path data for a pressure type's icon; see PRESSURE_TYPE_ICON_PATHS.
 */
export function getPressureTypeIconPath(pressureType: string): string {
  return Object.prototype.hasOwnProperty.call(PRESSURE_TYPE_ICON_PATHS, pressureType)
    ? PRESSURE_TYPE_ICON_PATHS[pressureType as keyof typeof PRESSURE_TYPE_ICON_PATHS]
    : UNKNOWN_PRESSURE_ICON_PATH
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
