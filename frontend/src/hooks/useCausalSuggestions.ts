import { useState, useCallback, useRef, useEffect } from 'react'
import { CausalSuggestion, CausalRelationshipData } from '@/types'
import { useGlobalStore } from '@/stores/globalStore'
import { apiClient } from '@/services/api'

export interface SuggestionFeedback {
  rating: 'helpful' | 'not_helpful' | 'needs_improvement'
  comment?: string
  improvementSuggestion?: string
}

export interface SuggestionWithState extends CausalSuggestion {
  isVisible: boolean
  isProcessing: boolean
  userFeedback?: SuggestionFeedback
  displayPosition?: { x: number; y: number }
  isAccepted?: boolean
  isRejected?: boolean
}

export interface SuggestionFilters {
  minConfidence: number
  maxSuggestions: number
  includeProcessed: boolean
  sortBy: 'confidence' | 'weight' | 'timestamp'
  sortOrder: 'asc' | 'desc'
}

export interface SuggestionStats {
  total: number
  visible: number
  hidden: number
  accepted: number
  rejected: number
  avgConfidence: number
  highConfidenceCount: number
}

export const useCausalSuggestions = (initialFilters?: Partial<SuggestionFilters>) => {
  const [suggestions, setSuggestions] = useState<SuggestionWithState[]>([])
  const [filters, setFilters] = useState<SuggestionFilters>({
    minConfidence: 0.3,
    maxSuggestions: 10,
    includeProcessed: false,
    sortBy: 'confidence',
    sortOrder: 'desc',
    ...initialFilters
  })
  
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastFocusEventId, setLastFocusEventId] = useState<string | null>(null)
  
  const feedbackCache = useRef<Map<string, SuggestionFeedback>>(new Map())
  const { events, causalRelationships, addCausalRelationship, addError } = useGlobalStore()

  // Calculate suggestion statistics
  const calculateStats = useCallback((): SuggestionStats => {
    const total = suggestions.length
    const visible = suggestions.filter(s => s.isVisible).length
    const hidden = suggestions.filter(s => !s.isVisible).length
    const accepted = suggestions.filter(s => s.isAccepted).length
    const rejected = suggestions.filter(s => s.isRejected).length
    const avgConfidence = suggestions.length > 0 
      ? suggestions.reduce((sum, s) => sum + s.confidence, 0) / suggestions.length 
      : 0
    const highConfidenceCount = suggestions.filter(s => s.confidence >= 0.8).length

    return {
      total,
      visible,
      hidden,
      accepted,
      rejected,
      avgConfidence,
      highConfidenceCount
    }
  }, [suggestions])

  // Filter and sort suggestions
  const getFilteredSuggestions = useCallback((): SuggestionWithState[] => {
    const filtered = suggestions.filter(suggestion => {
      // Confidence filter
      if (suggestion.confidence < filters.minConfidence) return false
      
      // Processed filter
      if (!filters.includeProcessed && (suggestion.isAccepted || suggestion.isRejected)) {
        return false
      }
      
      return true
    })

    // Sort suggestions
    filtered.sort((a, b) => {
      let comparison = 0
      
      switch (filters.sortBy) {
        case 'confidence':
          comparison = a.confidence - b.confidence
          break
        case 'weight':
          comparison = a.suggested_weight - b.suggested_weight
          break
        case 'timestamp': {
          // Sort by cause event timestamp as proxy
          const aEvent = events.find(e => e.id === a.cause_event_id)
          const bEvent = events.find(e => e.id === b.cause_event_id)
          if (aEvent && bEvent) {
            comparison = new Date(aEvent.timestamp).getTime() - new Date(bEvent.timestamp).getTime()
          }
          break
        }
      }
      
      return filters.sortOrder === 'desc' ? -comparison : comparison
    })

    // Limit results
    return filtered.slice(0, filters.maxSuggestions)
  }, [suggestions, filters, events])

  // Ref to track if suggestions have been loaded (avoids dependency on suggestions.length)
  const hasLoadedRef = useRef(false)

  // Load suggestions for a specific event
  const loadSuggestions = useCallback(async (eventId: string, force = false) => {
    // Don't reload if same event and not forced (use ref to avoid dependency cycle)
    if (!force && lastFocusEventId === eventId && hasLoadedRef.current) {
      return
    }

    setIsLoading(true)
    setError(null)
    setLastFocusEventId(eventId)

    try {
      const rawSuggestions = await apiClient.causal.getSuggestions(eventId)

      // Transform to suggestions with state
      const suggestionsWithState: SuggestionWithState[] = rawSuggestions.map(suggestion => ({
        ...suggestion,
        isVisible: true,
        isProcessing: false,
        userFeedback: feedbackCache.current.get(suggestion.id),
        isAccepted: false,
        isRejected: false
      }))

      setSuggestions(suggestionsWithState)
      hasLoadedRef.current = true

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load suggestions'
      setError(errorMessage)
      addError({
        message: errorMessage,
        type: 'network'
      })
      hasLoadedRef.current = false
    } finally {
      setIsLoading(false)
    }
  }, [lastFocusEventId, addError]) // Removed suggestions.length to break dependency cycle

  // Accept a suggestion and create causal relationship
  const acceptSuggestion = useCallback(async (suggestion: SuggestionWithState) => {
    // Mark as processing
    setSuggestions(prev => prev.map(s => 
      s.id === suggestion.id ? { ...s, isProcessing: true } : s
    ))

    try {
      // Check if relationship already exists
      const existingRelationship = causalRelationships.find(rel => 
        rel.cause_event_id === suggestion.cause_event_id && 
        rel.effect_event_id === suggestion.effect_event_id
      )
      
      if (existingRelationship) {
        throw new Error('Causal relationship already exists between these events')
      }

      // Validate temporal ordering
      const causeEvent = events.find(e => e.id === suggestion.cause_event_id)
      const effectEvent = events.find(e => e.id === suggestion.effect_event_id)
      
      if (!causeEvent || !effectEvent) {
        throw new Error('Referenced events not found')
      }

      const causeTime = new Date(causeEvent.timestamp)
      const effectTime = new Date(effectEvent.timestamp)
      
      if (causeTime > effectTime) {
        throw new Error('Cause event must occur before effect event')
      }

      // Create relationship data
      const relationshipData: CausalRelationshipData = {
        weight: suggestion.suggested_weight,
        evidence: suggestion.reasoning,
        confidence: suggestion.confidence,
        relationship_type: 'direct' // Could be enhanced to infer from suggestion
      }

      // Create via API
      const newRelationship = await apiClient.causal.createLink(
        suggestion.cause_event_id,
        suggestion.effect_event_id,
        relationshipData
      )

      // Update global state
      addCausalRelationship(newRelationship)

      // Mark suggestion as accepted
      setSuggestions(prev => prev.map(s => 
        s.id === suggestion.id 
          ? { ...s, isProcessing: false, isAccepted: true, isVisible: filters.includeProcessed }
          : s
      ))

      return newRelationship

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to accept suggestion'
      setError(errorMessage)
      addError({
        message: errorMessage,
        type: 'validation'
      })

      // Remove processing state
      setSuggestions(prev => prev.map(s => 
        s.id === suggestion.id ? { ...s, isProcessing: false } : s
      ))

      throw err
    }
  }, [causalRelationships, events, addCausalRelationship, addError, filters.includeProcessed])

  // Reject a suggestion
  const rejectSuggestion = useCallback((suggestion: SuggestionWithState, reason?: string) => {
    setSuggestions(prev => prev.map(s => 
      s.id === suggestion.id 
        ? { 
            ...s, 
            isRejected: true, 
            isVisible: filters.includeProcessed,
            userFeedback: reason ? { 
              rating: 'not_helpful' as const, 
              comment: reason 
            } : s.userFeedback
          }
        : s
    ))
  }, [filters.includeProcessed])

  // Hide a suggestion temporarily
  const hideSuggestion = useCallback((suggestion: SuggestionWithState) => {
    setSuggestions(prev => prev.map(s => 
      s.id === suggestion.id ? { ...s, isVisible: false } : s
    ))
  }, [])

  // Show a hidden suggestion
  const showSuggestion = useCallback((suggestion: SuggestionWithState) => {
    setSuggestions(prev => prev.map(s => 
      s.id === suggestion.id ? { ...s, isVisible: true } : s
    ))
  }, [])

  // Show all hidden suggestions
  const showAllSuggestions = useCallback(() => {
    setSuggestions(prev => prev.map(s => ({ ...s, isVisible: true })))
  }, [])

  // Hide all suggestions
  const hideAllSuggestions = useCallback(() => {
    setSuggestions(prev => prev.map(s => ({ ...s, isVisible: false })))
  }, [])

  // Add feedback to a suggestion
  const addFeedback = useCallback((suggestion: SuggestionWithState, feedback: SuggestionFeedback) => {
    // Cache feedback
    feedbackCache.current.set(suggestion.id, feedback)
    
    // Update suggestion state
    setSuggestions(prev => prev.map(s => 
      s.id === suggestion.id ? { ...s, userFeedback: feedback } : s
    ))
  }, [])

  // Clear all suggestions
  const clearSuggestions = useCallback(() => {
    setSuggestions([])
    setLastFocusEventId(null)
    setError(null)
    hasLoadedRef.current = false
  }, [])

  // Update filters
  const updateFilters = useCallback((newFilters: Partial<SuggestionFilters>) => {
    setFilters(prev => ({ ...prev, ...newFilters }))
  }, [])

  // Bulk accept suggestions above confidence threshold
  const bulkAcceptByConfidence = useCallback(async (minConfidence: number) => {
    const toAccept = suggestions.filter(s => 
      s.confidence >= minConfidence && 
      s.isVisible && 
      !s.isAccepted && 
      !s.isRejected &&
      !s.isProcessing
    )

    const results = await Promise.allSettled(
      toAccept.map(suggestion => acceptSuggestion(suggestion))
    )

    const successful = results.filter(r => r.status === 'fulfilled').length
    const failed = results.filter(r => r.status === 'rejected').length

    return { successful, failed, total: toAccept.length }
  }, [suggestions, acceptSuggestion])

  // Bulk reject suggestions below confidence threshold
  const bulkRejectByConfidence = useCallback((maxConfidence: number, reason?: string) => {
    const toReject = suggestions.filter(s => 
      s.confidence <= maxConfidence && 
      s.isVisible && 
      !s.isAccepted && 
      !s.isRejected
    )

    toReject.forEach(suggestion => {
      rejectSuggestion(suggestion, reason)
    })

    return toReject.length
  }, [suggestions, rejectSuggestion])

  // Get suggestions for a specific event pair
  const getSuggestionsForEventPair = useCallback((causeEventId: string, effectEventId: string) => {
    return suggestions.filter(s => 
      s.cause_event_id === causeEventId && s.effect_event_id === effectEventId
    )
  }, [suggestions])

  // Check if a suggestion exists for an event pair
  const hasSuggestionForEventPair = useCallback((causeEventId: string, effectEventId: string) => {
    return suggestions.some(s => 
      s.cause_event_id === causeEventId && s.effect_event_id === effectEventId
    )
  }, [suggestions])

  // Track previous causalRelationships length to detect actual changes
  const prevRelationshipsLengthRef = useRef(causalRelationships.length)

  // Auto-refresh suggestions when causal relationships change (not on initial load or focus change)
  useEffect(() => {
    // Only refresh if relationships actually changed (not just on mount or focus change)
    const relationshipsChanged = prevRelationshipsLengthRef.current !== causalRelationships.length
    prevRelationshipsLengthRef.current = causalRelationships.length

    if (relationshipsChanged && lastFocusEventId && hasLoadedRef.current) {
      // Debounce refresh to avoid excessive API calls
      const timeoutId = setTimeout(() => {
        // Use ref to avoid dependency on loadSuggestions
        apiClient.causal.getSuggestions(lastFocusEventId)
          .then(rawSuggestions => {
            const suggestionsWithState: SuggestionWithState[] = rawSuggestions.map(suggestion => ({
              ...suggestion,
              isVisible: true,
              isProcessing: false,
              userFeedback: feedbackCache.current.get(suggestion.id),
              isAccepted: false,
              isRejected: false
            }))
            setSuggestions(suggestionsWithState)
          })
          .catch(err => {
            console.error('Failed to refresh suggestions:', err)
          })
      }, 1000)

      return () => clearTimeout(timeoutId)
    }
  }, [causalRelationships.length, lastFocusEventId])

  return {
    // State
    suggestions: getFilteredSuggestions(),
    allSuggestions: suggestions,
    filters,
    isLoading,
    error,
    stats: calculateStats(),

    // Actions
    loadSuggestions,
    acceptSuggestion,
    rejectSuggestion,
    hideSuggestion,
    showSuggestion,
    showAllSuggestions,
    hideAllSuggestions,
    addFeedback,
    clearSuggestions,
    updateFilters,

    // Bulk operations
    bulkAcceptByConfidence,
    bulkRejectByConfidence,

    // Utilities
    getSuggestionsForEventPair,
    hasSuggestionForEventPair
  }
}

export default useCausalSuggestions