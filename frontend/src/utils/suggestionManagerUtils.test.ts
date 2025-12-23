import { describe, it, expect } from 'vitest'
import {
  relationshipExists,
  getConfidenceLevel,
  getConfidenceStyle,
  formatSuggestionWeight,
  formatConfidenceAsPercentage,
  validateFeedback,
  isFeedbackValid,
  sortSuggestionsByConfidence,
  sortSuggestionsByWeight,
  filterSuggestionsByMinConfidence,
  filterExistingSuggestions,
  getHighConfidenceSuggestions,
  getSuggestionStatistics,
  getFeedbackRatingStyle,
  formatRatingForDisplay,
  createInitialFeedback,
  CONFIDENCE_THRESHOLDS,
  VALIDATION_ERRORS,
  FEEDBACK_RATING_OPTIONS
} from './suggestionManagerUtils'
import { CausalRelationship, CausalSuggestion } from '@/types'

const createRelationship = (
  causeId: string,
  effectId: string,
  overrides: Partial<CausalRelationship> = {}
): CausalRelationship => ({
  id: `rel-${causeId}-${effectId}`,
  cause_event_id: causeId,
  effect_event_id: effectId,
  weight: 0.8,
  confidence: 0.9,
  evidence: 'test evidence',
  relationship_type: 'direct',
  created_at: '2023-01-01T00:00:00Z',
  updated_at: '2023-01-01T00:00:00Z',
  ...overrides
})

const createSuggestion = (overrides: Partial<CausalSuggestion> = {}): CausalSuggestion => ({
  id: 'suggestion-1',
  cause_event_id: 'event-1',
  effect_event_id: 'event-2',
  suggested_weight: 0.7,
  confidence: 0.8,
  reasoning: 'AI-generated reasoning',
  ...overrides
})

describe('Suggestion Manager Utils', () => {
  describe('relationshipExists', () => {
    const relationships: CausalRelationship[] = [
      createRelationship('event-1', 'event-2'),
      createRelationship('event-3', 'event-4')
    ]

    it('returns true when relationship exists', () => {
      expect(relationshipExists('event-1', 'event-2', relationships)).toBe(true)
    })

    it('returns false when relationship does not exist', () => {
      expect(relationshipExists('event-1', 'event-3', relationships)).toBe(false)
    })

    it('returns false for empty relationships', () => {
      expect(relationshipExists('event-1', 'event-2', [])).toBe(false)
    })

    it('is directional - reverse does not match', () => {
      expect(relationshipExists('event-2', 'event-1', relationships)).toBe(false)
    })
  })

  describe('getConfidenceLevel', () => {
    it('returns high for confidence >= 0.8', () => {
      expect(getConfidenceLevel(0.8)).toBe('high')
      expect(getConfidenceLevel(0.9)).toBe('high')
      expect(getConfidenceLevel(1.0)).toBe('high')
    })

    it('returns medium for confidence >= 0.5 and < 0.8', () => {
      expect(getConfidenceLevel(0.5)).toBe('medium')
      expect(getConfidenceLevel(0.7)).toBe('medium')
      expect(getConfidenceLevel(0.79)).toBe('medium')
    })

    it('returns low for confidence < 0.5', () => {
      expect(getConfidenceLevel(0.49)).toBe('low')
      expect(getConfidenceLevel(0.3)).toBe('low')
      expect(getConfidenceLevel(0)).toBe('low')
    })
  })

  describe('getConfidenceStyle', () => {
    it('returns green style for high confidence', () => {
      const style = getConfidenceStyle(0.9)
      expect(style.bgColor).toBe('bg-green-100')
      expect(style.textColor).toBe('text-green-800')
      expect(style.label).toBe('High')
      expect(style.progressBarColor).toBe('bg-green-500')
    })

    it('returns yellow style for medium confidence', () => {
      const style = getConfidenceStyle(0.6)
      expect(style.bgColor).toBe('bg-yellow-100')
      expect(style.textColor).toBe('text-yellow-800')
      expect(style.label).toBe('Medium')
      expect(style.progressBarColor).toBe('bg-yellow-500')
    })

    it('returns red style for low confidence', () => {
      const style = getConfidenceStyle(0.3)
      expect(style.bgColor).toBe('bg-red-100')
      expect(style.textColor).toBe('text-red-800')
      expect(style.label).toBe('Low')
      expect(style.progressBarColor).toBe('bg-red-500')
    })

    it('handles boundary values correctly', () => {
      expect(getConfidenceStyle(0.8).label).toBe('High')
      expect(getConfidenceStyle(0.5).label).toBe('Medium')
      expect(getConfidenceStyle(0.49).label).toBe('Low')
    })
  })

  describe('formatSuggestionWeight', () => {
    it('formats weight with two decimal places', () => {
      expect(formatSuggestionWeight(0.8)).toBe('W: 0.80')
      expect(formatSuggestionWeight(0.123456)).toBe('W: 0.12')
      expect(formatSuggestionWeight(1)).toBe('W: 1.00')
    })
  })

  describe('formatConfidenceAsPercentage', () => {
    it('formats confidence as percentage string', () => {
      expect(formatConfidenceAsPercentage(0.9)).toBe('90%')
      expect(formatConfidenceAsPercentage(0.85)).toBe('85%')
      expect(formatConfidenceAsPercentage(1)).toBe('100%')
      expect(formatConfidenceAsPercentage(0)).toBe('0%')
    })
  })

  describe('validateFeedback', () => {
    it('returns empty array for valid feedback', () => {
      const errors = validateFeedback({
        rating: 'helpful',
        comment: 'Good suggestion'
      })
      expect(errors).toHaveLength(0)
    })

    it('requires rating', () => {
      const errors = validateFeedback({
        rating: '' as any,
        comment: ''
      })
      expect(errors).toContain(VALIDATION_ERRORS.RATING_REQUIRED)
    })

    it('accepts all valid rating values', () => {
      expect(validateFeedback({ rating: 'helpful' })).toHaveLength(0)
      expect(validateFeedback({ rating: 'not_helpful' })).toHaveLength(0)
      // needs_improvement requires an improvementSuggestion
      expect(
        validateFeedback({ rating: 'needs_improvement', improvementSuggestion: 'Add more context' })
      ).toHaveLength(0)
    })

    it('requires improvement suggestion when rating is needs_improvement', () => {
      const errors = validateFeedback({
        rating: 'needs_improvement',
        improvementSuggestion: ''
      })
      expect(errors).toContain(VALIDATION_ERRORS.IMPROVEMENT_REQUIRED)
    })

    it('requires improvement suggestion when rating is needs_improvement and field is undefined', () => {
      const errors = validateFeedback({
        rating: 'needs_improvement'
      })
      expect(errors).toContain(VALIDATION_ERRORS.IMPROVEMENT_REQUIRED)
    })

    it('accepts needs_improvement with valid improvement suggestion', () => {
      const errors = validateFeedback({
        rating: 'needs_improvement',
        improvementSuggestion: 'Consider adding temporal evidence'
      })
      expect(errors).toHaveLength(0)
    })
  })

  describe('isFeedbackValid', () => {
    it('returns true for valid feedback', () => {
      expect(isFeedbackValid({ rating: 'helpful' })).toBe(true)
    })

    it('returns false for invalid feedback', () => {
      expect(isFeedbackValid({ rating: '' as any })).toBe(false)
    })
  })

  describe('sortSuggestionsByConfidence', () => {
    it('sorts suggestions from highest to lowest confidence', () => {
      const suggestions = [
        createSuggestion({ id: '1', confidence: 0.5 }),
        createSuggestion({ id: '2', confidence: 0.9 }),
        createSuggestion({ id: '3', confidence: 0.7 })
      ]

      const sorted = sortSuggestionsByConfidence(suggestions)

      expect(sorted[0]!.confidence).toBe(0.9)
      expect(sorted[1]!.confidence).toBe(0.7)
      expect(sorted[2]!.confidence).toBe(0.5)
    })

    it('does not mutate original array', () => {
      const suggestions = [
        createSuggestion({ id: '1', confidence: 0.5 }),
        createSuggestion({ id: '2', confidence: 0.9 })
      ]

      sortSuggestionsByConfidence(suggestions)

      expect(suggestions[0]!.confidence).toBe(0.5)
    })
  })

  describe('sortSuggestionsByWeight', () => {
    it('sorts suggestions from highest to lowest weight', () => {
      const suggestions = [
        createSuggestion({ id: '1', suggested_weight: 0.3 }),
        createSuggestion({ id: '2', suggested_weight: 0.9 }),
        createSuggestion({ id: '3', suggested_weight: 0.6 })
      ]

      const sorted = sortSuggestionsByWeight(suggestions)

      expect(sorted[0]!.suggested_weight).toBe(0.9)
      expect(sorted[1]!.suggested_weight).toBe(0.6)
      expect(sorted[2]!.suggested_weight).toBe(0.3)
    })
  })

  describe('filterSuggestionsByMinConfidence', () => {
    const suggestions = [
      createSuggestion({ id: '1', confidence: 0.3 }),
      createSuggestion({ id: '2', confidence: 0.6 }),
      createSuggestion({ id: '3', confidence: 0.9 })
    ]

    it('filters suggestions by minimum confidence', () => {
      const filtered = filterSuggestionsByMinConfidence(suggestions, 0.5)

      expect(filtered).toHaveLength(2)
      expect(filtered[0]!.confidence).toBe(0.6)
      expect(filtered[1]!.confidence).toBe(0.9)
    })

    it('returns all suggestions when minConfidence is 0', () => {
      expect(filterSuggestionsByMinConfidence(suggestions, 0)).toHaveLength(3)
    })

    it('returns empty array when minConfidence is too high', () => {
      expect(filterSuggestionsByMinConfidence(suggestions, 1.0)).toHaveLength(0)
    })
  })

  describe('filterExistingSuggestions', () => {
    const relationships = [createRelationship('event-1', 'event-2')]

    it('filters out suggestions where relationship already exists', () => {
      const suggestions = [
        createSuggestion({ cause_event_id: 'event-1', effect_event_id: 'event-2' }),
        createSuggestion({ cause_event_id: 'event-3', effect_event_id: 'event-4' })
      ]

      const filtered = filterExistingSuggestions(suggestions, relationships)

      expect(filtered).toHaveLength(1)
      expect(filtered[0]!.cause_event_id).toBe('event-3')
    })

    it('returns all suggestions when no relationships exist', () => {
      const suggestions = [
        createSuggestion({ cause_event_id: 'event-3', effect_event_id: 'event-4' })
      ]

      expect(filterExistingSuggestions(suggestions, [])).toHaveLength(1)
    })
  })

  describe('getHighConfidenceSuggestions', () => {
    it('returns suggestions with confidence >= 0.8', () => {
      const suggestions = [
        createSuggestion({ id: '1', confidence: 0.7 }),
        createSuggestion({ id: '2', confidence: 0.8 }),
        createSuggestion({ id: '3', confidence: 0.9 })
      ]

      const highConfidence = getHighConfidenceSuggestions(suggestions)

      expect(highConfidence).toHaveLength(2)
    })
  })

  describe('getSuggestionStatistics', () => {
    it('returns zero statistics for empty array', () => {
      const stats = getSuggestionStatistics([])

      expect(stats.total).toBe(0)
      expect(stats.highConfidence).toBe(0)
      expect(stats.mediumConfidence).toBe(0)
      expect(stats.lowConfidence).toBe(0)
      expect(stats.averageConfidence).toBe(0)
      expect(stats.averageWeight).toBe(0)
    })

    it('calculates statistics correctly', () => {
      const suggestions = [
        createSuggestion({ confidence: 0.9, suggested_weight: 0.8 }), // high
        createSuggestion({ confidence: 0.6, suggested_weight: 0.6 }), // medium
        createSuggestion({ confidence: 0.3, suggested_weight: 0.4 }) // low
      ]

      const stats = getSuggestionStatistics(suggestions)

      expect(stats.total).toBe(3)
      expect(stats.highConfidence).toBe(1)
      expect(stats.mediumConfidence).toBe(1)
      expect(stats.lowConfidence).toBe(1)
      expect(stats.averageConfidence).toBeCloseTo(0.6, 2)
      expect(stats.averageWeight).toBeCloseTo(0.6, 2)
    })
  })

  describe('getFeedbackRatingStyle', () => {
    it('returns correct style for helpful', () => {
      const style = getFeedbackRatingStyle('helpful')
      expect(style.bgColor).toBe('bg-green-100')
      expect(style.textColor).toBe('text-green-800')
    })

    it('returns correct style for not_helpful', () => {
      const style = getFeedbackRatingStyle('not_helpful')
      expect(style.bgColor).toBe('bg-yellow-100')
      expect(style.textColor).toBe('text-yellow-800')
    })

    it('returns correct style for needs_improvement', () => {
      const style = getFeedbackRatingStyle('needs_improvement')
      expect(style.bgColor).toBe('bg-orange-100')
      expect(style.textColor).toBe('text-orange-800')
    })
  })

  describe('formatRatingForDisplay', () => {
    it('replaces underscores with spaces', () => {
      expect(formatRatingForDisplay('not_helpful')).toBe('not helpful')
      expect(formatRatingForDisplay('helpful')).toBe('helpful')
    })
  })

  describe('createInitialFeedback', () => {
    it('creates feedback with default values', () => {
      const feedback = createInitialFeedback()

      expect(feedback.rating).toBe('helpful')
      expect(feedback.comment).toBe('')
      expect(feedback.improvementSuggestion).toBe('')
    })
  })

  describe('Constants', () => {
    it('has correct CONFIDENCE_THRESHOLDS', () => {
      expect(CONFIDENCE_THRESHOLDS.HIGH).toBe(0.8)
      expect(CONFIDENCE_THRESHOLDS.MEDIUM).toBe(0.5)
    })

    it('has correct FEEDBACK_RATING_OPTIONS', () => {
      expect(FEEDBACK_RATING_OPTIONS).toHaveLength(3)
      expect(FEEDBACK_RATING_OPTIONS[0]!.value).toBe('helpful')
      expect(FEEDBACK_RATING_OPTIONS[1]!.value).toBe('not_helpful')
      expect(FEEDBACK_RATING_OPTIONS[2]!.value).toBe('needs_improvement')
    })
  })
})
