import React, { useEffect, useCallback, useRef } from 'react'
import { Core } from 'cytoscape'
import { CausalSuggestion } from '@/types'

export interface CausalSuggestionOverlayProps {
  cytoscapeInstance: Core | null
  suggestions: CausalSuggestion[]
  onSuggestionClick?: (suggestion: CausalSuggestion) => void
  onSuggestionHover?: (suggestion: CausalSuggestion | null) => void
  showConfidenceLabels?: boolean
  animateSuggestions?: boolean
}

export interface SuggestionEdgeData {
  id: string
  source: string
  target: string
  suggestion: CausalSuggestion
  weight: number
  confidence: number
  isSuggestion: true
}

export const CausalSuggestionOverlay: React.FC<CausalSuggestionOverlayProps> = ({
  cytoscapeInstance,
  suggestions,
  onSuggestionClick,
  onSuggestionHover,
  showConfidenceLabels = true,
  animateSuggestions = true
}) => {
  const suggestionEdgeIds = useRef<Set<string>>(new Set())
  const animationRef = useRef<number | null>(null)

  // Define suggestion edge styles
  const getSuggestionEdgeStyle = useCallback((confidence: number) => {
    const opacity = Math.max(0.4, confidence)
    const width = 2 + (confidence * 4) // 2-6px range
    
    // Color based on confidence
    let color = '#9CA3AF' // gray-400 for low confidence
    if (confidence >= 0.8) {
      color = '#10B981' // green-500 for high confidence
    } else if (confidence >= 0.6) {
      color = '#F59E0B' // yellow-500 for medium confidence
    } else if (confidence >= 0.4) {
      color = '#EF4444' // red-500 for low-medium confidence
    }

    return {
      'line-color': color,
      'target-arrow-color': color,
      'target-arrow-shape': 'triangle',
      'curve-style': 'bezier',
      'line-style': 'dashed',
      'line-dash-pattern': [6, 3],
      'width': width,
      'opacity': opacity,
      'z-index': 50,
      'overlay-opacity': 0.1,
      'overlay-color': color,
      'arrow-scale': 1.0
    }
  }, [])

  // Add suggestion edges to the graph
  const addSuggestionEdges = useCallback(() => {
    if (!cytoscapeInstance) return

    // Remove existing suggestion edges
    removeSuggestionEdges()

    // Add new suggestion edges
    suggestions.forEach(suggestion => {
      const edgeId = `suggestion-${suggestion.id}`
      
      // Check if both nodes exist
      const sourceNode = cytoscapeInstance.getElementById(suggestion.cause_event_id)
      const targetNode = cytoscapeInstance.getElementById(suggestion.effect_event_id)
      
      if (sourceNode.length === 0 || targetNode.length === 0) {
        return // Skip if nodes don't exist
      }

      // Check if a real relationship already exists
      const existingEdge = cytoscapeInstance.edges().filter(edge => {
        const data = edge.data()
        return data.source === suggestion.cause_event_id && 
               data.target === suggestion.effect_event_id &&
               !data.isSuggestion
      })

      if (existingEdge.length > 0) {
        return // Skip if real relationship exists
      }

      // Create suggestion edge data
      const edgeData: SuggestionEdgeData = {
        id: edgeId,
        source: suggestion.cause_event_id,
        target: suggestion.effect_event_id,
        suggestion,
        weight: suggestion.suggested_weight,
        confidence: suggestion.confidence,
        isSuggestion: true
      }

      // Add edge to graph
      const edge = cytoscapeInstance.add({
        group: 'edges',
        data: edgeData
      })

      // Apply suggestion styling
      edge.style(getSuggestionEdgeStyle(suggestion.confidence))

      // Add confidence label if enabled
      if (showConfidenceLabels) {
        edge.style({
          'label': `${(suggestion.confidence * 100).toFixed(0)}%`,
          'font-size': '10px',
          'color': '#6B7280',
          'text-background-color': '#FFFFFF',
          'text-background-opacity': 0.8,
          'text-background-padding': '2px',
          'text-border-color': '#D1D5DB',
          'text-border-width': 1,
          'text-border-opacity': 0.5
        })
      }

      // Add to tracking set
      suggestionEdgeIds.current.add(edgeId)

      // Add event handlers
      edge.on('tap', () => {
        onSuggestionClick?.(suggestion)
      })

      edge.on('mouseover', () => {
        edge.style({
          'opacity': Math.min(1, suggestion.confidence + 0.3),
          'width': getSuggestionEdgeStyle(suggestion.confidence).width + 2,
          'z-index': 100
        })
        onSuggestionHover?.(suggestion)
      })

      edge.on('mouseout', () => {
        edge.style(getSuggestionEdgeStyle(suggestion.confidence))
        onSuggestionHover?.(null)
      })
    })

    // Animate suggestions if enabled
    if (animateSuggestions) {
      animateSuggestionEdges()
    }
  }, [cytoscapeInstance, suggestions, getSuggestionEdgeStyle, showConfidenceLabels, onSuggestionClick, onSuggestionHover, animateSuggestions]) // eslint-disable-line react-hooks/exhaustive-deps

  // Remove suggestion edges from the graph
  const removeSuggestionEdges = useCallback(() => {
    if (!cytoscapeInstance) return

    // Remove all suggestion edges
    suggestionEdgeIds.current.forEach(edgeId => {
      const edge = cytoscapeInstance.getElementById(edgeId)
      if (edge.length > 0) {
        edge.remove()
      }
    })

    // Clear tracking set
    suggestionEdgeIds.current.clear()

    // Stop animation
    if (animationRef.current) {
      clearInterval(animationRef.current)
      animationRef.current = null
    }
  }, [cytoscapeInstance])

  // Animate suggestion edges with pulsing effect
  const animateSuggestionEdges = useCallback(() => {
    if (!cytoscapeInstance || animationRef.current) return

    let phase = 0
    animationRef.current = setInterval(() => {
      phase += 0.1
      
      suggestionEdgeIds.current.forEach(edgeId => {
        const edge = cytoscapeInstance.getElementById(edgeId)
        if (edge.length > 0) {
          const data = edge.data() as SuggestionEdgeData
          const baseOpacity = Math.max(0.4, data.confidence)
          const pulseOpacity = baseOpacity + (Math.sin(phase) * 0.2)
          
          edge.style({
            'opacity': Math.max(0.2, Math.min(1, pulseOpacity))
          })
        }
      })
    }, 100)
  }, [cytoscapeInstance])

  // Stop animation
  const stopAnimation = useCallback(() => {
    if (animationRef.current) {
      clearInterval(animationRef.current)
      animationRef.current = null
    }
  }, [])

  // Update suggestions when they change
  useEffect(() => {
    if (cytoscapeInstance) {
      addSuggestionEdges()
    }

    return () => {
      removeSuggestionEdges()
    }
  }, [cytoscapeInstance, suggestions, addSuggestionEdges, removeSuggestionEdges])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAnimation()
      if (cytoscapeInstance) {
        removeSuggestionEdges()
      }
    }
  }, [cytoscapeInstance, stopAnimation, removeSuggestionEdges])

  // This component doesn't render anything - it only manages Cytoscape styling
  return null
}

export default CausalSuggestionOverlay