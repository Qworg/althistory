import { CausalSuggestion, CausalRelationship } from '@/types'
import { SuggestionFeedback } from '@/hooks/useCausalSuggestions'

/**
 * Extended suggestion with UI state
 */
export interface SuggestionState {
  isVisible: boolean
  isProcessing: boolean
  userFeedback?: SuggestionFeedback
}

/**
 * Confidence level thresholds
 */
export const CONFIDENCE_THRESHOLDS = {
  HIGH: 0.8,
  MEDIUM: 0.5
} as const

/**
 * Check if a relationship already exists between two events
 */
export function relationshipExists(
  causeId: string,
  effectId: string,
  relationships: CausalRelationship[]
): boolean {
  return relationships.some(
    rel => rel.cause_event_id === causeId && rel.effect_event_id === effectId
  )
}

/**
 * Confidence level classification
 */
export type ConfidenceLevel = 'high' | 'medium' | 'low'

/**
 * Get confidence level from numeric value
 */
export function getConfidenceLevel(confidence: number): ConfidenceLevel {
  if (confidence >= CONFIDENCE_THRESHOLDS.HIGH) {
    return 'high'
  } else if (confidence >= CONFIDENCE_THRESHOLDS.MEDIUM) {
    return 'medium'
  } else {
    return 'low'
  }
}

/**
 * Confidence style configuration
 */
export interface ConfidenceStyle {
  bgColor: string
  textColor: string
  label: string
  progressBarColor: string
}

/**
 * Get styling configuration for a confidence level
 */
// Status tokens (index.css): the light pills these were (green-100 and
// so on) stayed light in dark mode.
export function getConfidenceStyle(confidence: number): ConfidenceStyle {
  const level = getConfidenceLevel(confidence)

  switch (level) {
    case 'high':
      return {
        bgColor: 'bg-success/15',
        textColor: 'text-success',
        label: 'High',
        progressBarColor: 'bg-success'
      }
    case 'medium':
      return {
        bgColor: 'bg-warning/15',
        textColor: 'text-warning',
        label: 'Medium',
        progressBarColor: 'bg-warning'
      }
    case 'low':
      return {
        bgColor: 'bg-danger/10',
        textColor: 'text-danger',
        label: 'Low',
        progressBarColor: 'bg-danger'
      }
  }
}

/**
 * Format suggestion weight for display
 */
export function formatSuggestionWeight(weight: number): string {
  return `W: ${weight.toFixed(2)}`
}

/**
 * Format confidence as percentage string
 */
export function formatConfidenceAsPercentage(confidence: number): string {
  return `${(confidence * 100).toFixed(0)}%`
}

/**
 * Validation error messages
 */
export const VALIDATION_ERRORS = {
  RATING_REQUIRED: 'Please select a rating',
  IMPROVEMENT_REQUIRED: 'Please provide an improvement suggestion'
} as const

/**
 * Validate feedback form
 */
export function validateFeedback(feedback: SuggestionFeedback): string[] {
  const errors: string[] = []

  if (!feedback.rating) {
    errors.push(VALIDATION_ERRORS.RATING_REQUIRED)
  }

  // Require improvement suggestion when rating is 'needs_improvement'
  if (
    feedback.rating === 'needs_improvement' &&
    (!feedback.improvementSuggestion || feedback.improvementSuggestion.trim() === '')
  ) {
    errors.push(VALIDATION_ERRORS.IMPROVEMENT_REQUIRED)
  }

  return errors
}

/**
 * Check if feedback is valid
 */
export function isFeedbackValid(feedback: SuggestionFeedback): boolean {
  return validateFeedback(feedback).length === 0
}

/**
 * Sort suggestions by confidence (highest first)
 */
export function sortSuggestionsByConfidence(suggestions: CausalSuggestion[]): CausalSuggestion[] {
  return [...suggestions].sort((a, b) => b.confidence - a.confidence)
}

/**
 * Sort suggestions by weight (highest first)
 */
export function sortSuggestionsByWeight(suggestions: CausalSuggestion[]): CausalSuggestion[] {
  return [...suggestions].sort((a, b) => b.suggested_weight - a.suggested_weight)
}

/**
 * Filter suggestions by minimum confidence
 */
export function filterSuggestionsByMinConfidence(
  suggestions: CausalSuggestion[],
  minConfidence: number
): CausalSuggestion[] {
  return suggestions.filter(s => s.confidence >= minConfidence)
}

/**
 * Filter out suggestions where relationship already exists
 */
export function filterExistingSuggestions(
  suggestions: CausalSuggestion[],
  relationships: CausalRelationship[]
): CausalSuggestion[] {
  return suggestions.filter(
    s => !relationshipExists(s.cause_event_id, s.effect_event_id, relationships)
  )
}

/**
 * Get high confidence suggestions
 */
export function getHighConfidenceSuggestions(
  suggestions: CausalSuggestion[]
): CausalSuggestion[] {
  return filterSuggestionsByMinConfidence(suggestions, CONFIDENCE_THRESHOLDS.HIGH)
}

/**
 * Get suggestions statistics
 */
export interface SuggestionStatistics {
  total: number
  highConfidence: number
  mediumConfidence: number
  lowConfidence: number
  averageConfidence: number
  averageWeight: number
}

export function getSuggestionStatistics(suggestions: CausalSuggestion[]): SuggestionStatistics {
  if (suggestions.length === 0) {
    return {
      total: 0,
      highConfidence: 0,
      mediumConfidence: 0,
      lowConfidence: 0,
      averageConfidence: 0,
      averageWeight: 0
    }
  }

  const highConfidence = suggestions.filter(
    s => s.confidence >= CONFIDENCE_THRESHOLDS.HIGH
  ).length
  const mediumConfidence = suggestions.filter(
    s => s.confidence >= CONFIDENCE_THRESHOLDS.MEDIUM && s.confidence < CONFIDENCE_THRESHOLDS.HIGH
  ).length
  const lowConfidence = suggestions.filter(s => s.confidence < CONFIDENCE_THRESHOLDS.MEDIUM).length

  const totalConfidence = suggestions.reduce((sum, s) => sum + s.confidence, 0)
  const totalWeight = suggestions.reduce((sum, s) => sum + s.suggested_weight, 0)

  return {
    total: suggestions.length,
    highConfidence,
    mediumConfidence,
    lowConfidence,
    averageConfidence: totalConfidence / suggestions.length,
    averageWeight: totalWeight / suggestions.length
  }
}

/**
 * Feedback rating options
 */
export const FEEDBACK_RATING_OPTIONS = [
  { value: 'helpful' as const, label: 'Helpful - Good suggestion' },
  { value: 'not_helpful' as const, label: 'Not helpful - Irrelevant' },
  { value: 'needs_improvement' as const, label: 'Needs improvement - Could be better' }
] as const

/**
 * Get feedback rating style
 */
export function getFeedbackRatingStyle(
  rating: SuggestionFeedback['rating']
): { bgColor: string; textColor: string } {
  switch (rating) {
    case 'helpful':
      return { bgColor: 'bg-success/15', textColor: 'text-success' }
    case 'not_helpful':
      return { bgColor: 'bg-danger/10', textColor: 'text-danger' }
    case 'needs_improvement':
      return { bgColor: 'bg-warning/15', textColor: 'text-warning' }
    default:
      return { bgColor: 'bg-subtle', textColor: 'text-ink-secondary' }
  }
}

/**
 * Format rating for display (replace underscores with spaces)
 */
export function formatRatingForDisplay(rating: string): string {
  return rating.replace(/_/g, ' ')
}

/**
 * Create initial feedback form state
 */
export function createInitialFeedback(): SuggestionFeedback {
  return {
    rating: 'helpful',
    comment: '',
    improvementSuggestion: ''
  }
}
