import React, { useState, useCallback, useEffect, useRef } from 'react'
import { Event, CausalSuggestion, CausalRelationshipData } from '@/types'
import { useGlobalStore } from '@/stores/globalStore'
import { apiClient } from '@/services/api'
import { SuggestionWithState, SuggestionFeedback } from '@/hooks/useCausalSuggestions'
import {
  relationshipExists,
  getConfidenceStyle,
  getFeedbackRatingStyle,
  formatRatingForDisplay,
  createInitialFeedback,
  FEEDBACK_RATING_OPTIONS
} from '@/utils/suggestionManagerUtils'

export interface CausalSuggestionManagerProps {
  className?: string
  focusEventId?: string
  onSuggestionAccept?: (suggestion: CausalSuggestion) => void
  onSuggestionReject?: (suggestion: CausalSuggestion) => void
  onSuggestionFeedback?: (suggestion: CausalSuggestion, feedback: SuggestionFeedback) => void
  showSuggestionsAsOverlay?: boolean
  maxSuggestions?: number
}

export const CausalSuggestionManager: React.FC<CausalSuggestionManagerProps> = ({
  className = '',
  focusEventId,
  onSuggestionAccept,
  onSuggestionReject,
  onSuggestionFeedback,
  maxSuggestions = 5
}) => {
  const [suggestions, setSuggestions] = useState<SuggestionWithState[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [selectedSuggestion, setSelectedSuggestion] = useState<SuggestionWithState | null>(null)
  const [showFeedbackModal, setShowFeedbackModal] = useState(false)
  const [feedbackForm, setFeedbackForm] = useState<SuggestionFeedback>(createInitialFeedback())

  const {
    events,
    causalRelationships,
    addCausalRelationship,
    addError
  } = useGlobalStore()

  // Ref for cancelling pending API requests
  const abortControllerRef = useRef<AbortController | null>(null)

  // Cleanup on unmount - cancel any pending requests
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [])

  // Load suggestions for a specific event
  const loadSuggestions = useCallback(async (eventId: string) => {
    // Cancel any pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    // Create new abort controller for this request
    const abortController = new AbortController()
    abortControllerRef.current = abortController

    setIsLoading(true)

    try {
      const rawSuggestions = await apiClient.causal.getSuggestions(eventId, abortController.signal)

      // Check if this request was cancelled (double-check for race conditions)
      if (abortController.signal.aborted) {
        return
      }

      // Limit suggestions and add state
      const suggestionsWithState: SuggestionWithState[] = rawSuggestions
        .slice(0, maxSuggestions)
        .map(suggestion => ({
          ...suggestion,
          isVisible: true,
          isProcessing: false
        }))

      setSuggestions(suggestionsWithState)

    } catch (error) {
      // Ignore abort errors
      if (error instanceof Error && error.name === 'AbortError') {
        return
      }
      console.error('Failed to load causal suggestions:', error)
      addError({
        message: 'Failed to load causal suggestions',
        type: 'network'
      })
    } finally {
      // Only clear loading if this is still the active request
      if (!abortController.signal.aborted) {
        setIsLoading(false)
      }
    }
  }, [maxSuggestions, addError])

  // Accept a suggestion and create the causal relationship
  const acceptSuggestion = useCallback(async (suggestion: SuggestionWithState) => {
    // Mark as processing
    setSuggestions(prev => prev.map(s => 
      s.id === suggestion.id ? { ...s, isProcessing: true } : s
    ))

    try {
      // Check if relationship already exists
      if (relationshipExists(suggestion.cause_event_id, suggestion.effect_event_id, causalRelationships)) {
        addError({
          message: 'Causal relationship already exists between these events',
          type: 'validation'
        })
        return
      }

      // Create relationship data from suggestion
      const relationshipData: CausalRelationshipData = {
        weight: suggestion.suggested_weight,
        evidence: suggestion.reasoning,
        confidence: suggestion.confidence,
        relationship_type: 'direct' // Default, could be inferred from suggestion
      }

      // Create the relationship via API
      const newRelationship = await apiClient.causal.createLink(
        suggestion.cause_event_id,
        suggestion.effect_event_id,
        relationshipData
      )

      // Update global state
      addCausalRelationship(newRelationship)

      // Remove suggestion from list
      setSuggestions(prev => prev.filter(s => s.id !== suggestion.id))

      // Notify parent component
      onSuggestionAccept?.({
        id: suggestion.id,
        cause_event_id: suggestion.cause_event_id,
        effect_event_id: suggestion.effect_event_id,
        suggested_weight: suggestion.suggested_weight,
        confidence: suggestion.confidence,
        reasoning: suggestion.reasoning
      })
      // Note: Success feedback removed - visual feedback (relationship appearing in graph, suggestion removed from list) is sufficient
      // Using addError for success messages is semantically incorrect

    } catch (error) {
      console.error('Failed to accept suggestion:', error)
      addError({
        message: 'Failed to create causal relationship from suggestion',
        type: 'network'
      })
    } finally {
      // Remove processing state
      setSuggestions(prev => prev.map(s => 
        s.id === suggestion.id ? { ...s, isProcessing: false } : s
      ))
    }
  }, [causalRelationships, addCausalRelationship, addError, onSuggestionAccept])

  // Reject a suggestion
  const rejectSuggestion = useCallback((suggestion: SuggestionWithState) => {
    // Remove suggestion from list
    setSuggestions(prev => prev.filter(s => s.id !== suggestion.id))
    
    // Notify parent component
    onSuggestionReject?.({
      id: suggestion.id,
      cause_event_id: suggestion.cause_event_id,
      effect_event_id: suggestion.effect_event_id,
      suggested_weight: suggestion.suggested_weight,
      confidence: suggestion.confidence,
      reasoning: suggestion.reasoning
    })
  }, [onSuggestionReject])

  // Show feedback modal for a suggestion
  const showFeedbackForSuggestion = useCallback((suggestion: SuggestionWithState) => {
    setSelectedSuggestion(suggestion)
    setFeedbackForm(createInitialFeedback())
    setShowFeedbackModal(true)
  }, [])

  // Submit feedback for a suggestion
  const submitFeedback = useCallback(async () => {
    if (!selectedSuggestion) return

    try {
      // Update suggestion with feedback
      setSuggestions(prev => prev.map(s => 
        s.id === selectedSuggestion.id 
          ? { ...s, userFeedback: feedbackForm }
          : s
      ))

      // Notify parent component
      onSuggestionFeedback?.({
        id: selectedSuggestion.id,
        cause_event_id: selectedSuggestion.cause_event_id,
        effect_event_id: selectedSuggestion.effect_event_id,
        suggested_weight: selectedSuggestion.suggested_weight,
        confidence: selectedSuggestion.confidence,
        reasoning: selectedSuggestion.reasoning
      }, feedbackForm)

      // Close modal
      setShowFeedbackModal(false)
      setSelectedSuggestion(null)
      // Note: Success feedback removed - modal closing is sufficient visual feedback
      // Using addError for success messages is semantically incorrect

    } catch (error) {
      console.error('Failed to submit feedback:', error)
      addError({
        message: 'Failed to submit feedback',
        type: 'network'
      })
    }
  }, [selectedSuggestion, feedbackForm, onSuggestionFeedback, addError])

  // Hide a suggestion without rejecting it
  const hideSuggestion = useCallback((suggestion: SuggestionWithState) => {
    setSuggestions(prev => prev.map(s => 
      s.id === suggestion.id ? { ...s, isVisible: false } : s
    ))
  }, [])

  // Show all hidden suggestions
  const showAllSuggestions = useCallback(() => {
    setSuggestions(prev => prev.map(s => ({ ...s, isVisible: true })))
  }, [])

  // Get event by ID
  const getEventById = useCallback((eventId: string): Event | undefined => {
    return events.find(event => event.id === eventId)
  }, [events])

  // Load suggestions when focus event changes
  useEffect(() => {
    if (focusEventId) {
      loadSuggestions(focusEventId)
    } else {
      setSuggestions([])
    }
  }, [focusEventId, loadSuggestions])

  // Filter visible suggestions
  const visibleSuggestions = suggestions.filter(s => s.isVisible)
  const hiddenSuggestions = suggestions.filter(s => !s.isVisible)

  if (!focusEventId || suggestions.length === 0) {
    return null
  }

  return (
    <div className={`causal-suggestion-manager ${className}`}>
      {/* Suggestions Panel */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center space-x-3">
            <div className="w-3 h-3 bg-purple-500 rounded-full animate-pulse"></div>
            <h3 className="text-lg font-semibold text-gray-800">AI Suggestions</h3>
            {isLoading && (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-purple-600"></div>
            )}
          </div>
          <div className="flex items-center space-x-2 text-sm text-gray-600">
            <span>{visibleSuggestions.length} suggestions</span>
            {hiddenSuggestions.length > 0 && (
              <button
                onClick={showAllSuggestions}
                className="text-purple-600 hover:text-purple-800 underline"
              >
                Show {hiddenSuggestions.length} hidden
              </button>
            )}
          </div>
        </div>

        {/* Suggestions List */}
        <div className="max-h-96 overflow-y-auto">
          {visibleSuggestions.map((suggestion) => {
            const causeEvent = getEventById(suggestion.cause_event_id)
            const effectEvent = getEventById(suggestion.effect_event_id)

            if (!causeEvent || !effectEvent) return null

            return (
              <div
                key={suggestion.id}
                className="p-4 border-b border-gray-100 hover:bg-gray-50 transition-colors"
              >
                {/* Suggestion Header */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-grow">
                    <div className="flex items-center space-x-2 mb-1">
                      <span className="text-sm font-medium text-gray-800">
                        Suggested Causal Link
                      </span>
                      <div className="flex items-center space-x-1">
                        <div className="w-2 h-2 bg-purple-400 rounded-full"></div>
                        <span className="text-xs text-purple-600">AI Generated</span>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2 text-xs text-gray-500">
                      <span>Confidence: {(suggestion.confidence * 100).toFixed(0)}%</span>
                      <span>Weight: {suggestion.suggested_weight.toFixed(2)}</span>
                    </div>
                  </div>
                  <div className="flex items-center space-x-1">
                    <button
                      onClick={() => hideSuggestion(suggestion)}
                      className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
                      title="Hide suggestion"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Causal Relationship Visualization */}
                <div className="mb-3">
                  <div className="flex items-center space-x-3">
                    {/* Cause Event */}
                    <div className="flex-1 p-2 bg-blue-50 rounded-lg border border-blue-200">
                      <div className="text-sm font-medium text-blue-800">
                        {causeEvent.actor} → {causeEvent.target}
                      </div>
                      <div className="text-xs text-blue-600 truncate">
                        {causeEvent.description}
                      </div>
                      <div className="text-xs text-blue-500 mt-1">
                        {new Date(causeEvent.timestamp).toLocaleDateString()}
                      </div>
                    </div>

                    {/* Arrow */}
                    <div className="flex-shrink-0 text-purple-500">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                    </div>

                    {/* Effect Event */}
                    <div className="flex-1 p-2 bg-green-50 rounded-lg border border-green-200">
                      <div className="text-sm font-medium text-green-800">
                        {effectEvent.actor} → {effectEvent.target}
                      </div>
                      <div className="text-xs text-green-600 truncate">
                        {effectEvent.description}
                      </div>
                      <div className="text-xs text-green-500 mt-1">
                        {new Date(effectEvent.timestamp).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Reasoning */}
                <div className="mb-3 p-3 bg-gray-50 rounded-lg">
                  <div className="text-xs font-medium text-gray-700 mb-1">AI Reasoning:</div>
                  <div className="text-sm text-gray-600 italic">
                    "{suggestion.reasoning}"
                  </div>
                </div>

                {/* Confidence Indicator */}
                <div className="mb-3">
                  <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
                    <span>Confidence Level</span>
                    <span>{(suggestion.confidence * 100).toFixed(0)}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all duration-300 ${getConfidenceStyle(suggestion.confidence).progressBarColor}`}
                      style={{ width: `${suggestion.confidence * 100}%` }}
                    />
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => acceptSuggestion(suggestion)}
                      disabled={suggestion.isProcessing}
                      className="px-3 py-1 bg-green-600 text-white text-sm rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {suggestion.isProcessing ? 'Creating...' : 'Accept'}
                    </button>
                    <button
                      onClick={() => rejectSuggestion(suggestion)}
                      disabled={suggestion.isProcessing}
                      className="px-3 py-1 bg-red-600 text-white text-sm rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      Reject
                    </button>
                  </div>
                  <button
                    onClick={() => showFeedbackForSuggestion(suggestion)}
                    className="px-3 py-1 text-gray-600 text-sm border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                  >
                    Feedback
                  </button>
                </div>

                {/* User Feedback Display */}
                {suggestion.userFeedback && (
                  <div className="mt-3 p-2 bg-blue-50 rounded-lg border border-blue-200">
                    <div className="flex items-center space-x-2 mb-1">
                      <span className="text-xs font-medium text-blue-800">Your Feedback:</span>
                      <span className={`text-xs px-2 py-1 rounded-full ${getFeedbackRatingStyle(suggestion.userFeedback.rating).bgColor} ${getFeedbackRatingStyle(suggestion.userFeedback.rating).textColor}`}>
                        {formatRatingForDisplay(suggestion.userFeedback.rating)}
                      </span>
                    </div>
                    {suggestion.userFeedback.comment && (
                      <div className="text-xs text-blue-600">
                        "{suggestion.userFeedback.comment}"
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Empty State */}
        {visibleSuggestions.length === 0 && !isLoading && (
          <div className="p-8 text-center text-gray-500">
            <svg className="w-12 h-12 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            <p className="text-lg font-medium mb-2">No suggestions available</p>
            <p className="text-sm">
              The AI couldn't find any potential causal relationships for this event.
            </p>
          </div>
        )}
      </div>

      {/* Feedback Modal */}
      {showFeedbackModal && selectedSuggestion && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">
                Provide Feedback
              </h3>
              
              <div className="space-y-4">
                {/* Rating */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    How helpful was this suggestion?
                  </label>
                  <div className="space-y-2">
                    {FEEDBACK_RATING_OPTIONS.map(option => (
                      <label key={option.value} className="flex items-center">
                        <input
                          type="radio"
                          name="rating"
                          value={option.value}
                          checked={feedbackForm.rating === option.value}
                          onChange={(e) => setFeedbackForm(prev => ({
                            ...prev,
                            rating: e.target.value as SuggestionFeedback['rating']
                          }))}
                          className="mr-2"
                        />
                        <span className="text-sm text-gray-700">{option.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Comment */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Additional comments (optional)
                  </label>
                  <textarea
                    value={feedbackForm.comment}
                    onChange={(e) => setFeedbackForm(prev => ({
                      ...prev,
                      comment: e.target.value
                    }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                    rows={3}
                    placeholder="Tell us more about your experience with this suggestion..."
                  />
                </div>

                {/* Improvement Suggestion */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    How could we improve? (optional)
                  </label>
                  <textarea
                    value={feedbackForm.improvementSuggestion}
                    onChange={(e) => setFeedbackForm(prev => ({
                      ...prev,
                      improvementSuggestion: e.target.value
                    }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                    rows={2}
                    placeholder="Suggest improvements for future AI suggestions..."
                  />
                </div>
              </div>

              {/* Modal Actions */}
              <div className="flex items-center justify-end space-x-3 mt-6">
                <button
                  onClick={() => {
                    setShowFeedbackModal(false)
                    setSelectedSuggestion(null)
                  }}
                  className="px-4 py-2 text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={submitFeedback}
                  className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors"
                >
                  Submit Feedback
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default CausalSuggestionManager