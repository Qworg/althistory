import React, { useEffect, useCallback, useRef } from 'react'
import { Core } from 'cytoscape'
import { CausalPath } from '@/types'

export interface CausalPathHighlighterProps {
  cytoscapeInstance: Core | null
  highlightedPath: CausalPath | null
  currentStepIndex?: number
  showCumulativeStrength?: boolean
  animationDuration?: number
  onPathAnimationComplete?: () => void
}

export interface PathHighlightStyle {
  node: {
    highlighted: any
    current: any
    visited: any
    unvisited: any
  }
  edge: {
    highlighted: any
    current: any
    visited: any
    unvisited: any
  }
}

export const CausalPathHighlighter: React.FC<CausalPathHighlighterProps> = ({
  cytoscapeInstance,
  highlightedPath,
  currentStepIndex = 0,
  showCumulativeStrength = true,
  animationDuration = 500,
  onPathAnimationComplete
}) => {
  const animationRef = useRef<any>(null)
  const previousPathRef = useRef<CausalPath | null>(null)

  // Define highlight styles
  const highlightStyles: PathHighlightStyle = {
    node: {
      highlighted: {
        'background-color': '#F59E0B',
        'border-color': '#D97706',
        'border-width': 4,
        'z-index': 100,
        'overlay-opacity': 0.2,
        'overlay-color': '#F59E0B'
      },
      current: {
        'background-color': '#EF4444',
        'border-color': '#DC2626',
        'border-width': 5,
        'z-index': 150,
        'overlay-opacity': 0.3,
        'overlay-color': '#EF4444',
        'width': 'mapData(weight, 0, 1, 40, 80)',
        'height': 'mapData(weight, 0, 1, 40, 80)'
      },
      visited: {
        'background-color': '#10B981',
        'border-color': '#059669',
        'border-width': 3,
        'z-index': 80,
        'opacity': 0.9
      },
      unvisited: {
        'background-color': '#6B7280',
        'border-color': '#4B5563',
        'border-width': 2,
        'z-index': 60,
        'opacity': 0.6
      }
    },
    edge: {
      highlighted: {
        'line-color': '#F59E0B',
        'target-arrow-color': '#F59E0B',
        'width': 'mapData(weight, 0, 1, 4, 12)',
        'opacity': 1,
        'z-index': 100,
        'overlay-opacity': 0.2,
        'overlay-color': '#F59E0B'
      },
      current: {
        'line-color': '#EF4444',
        'target-arrow-color': '#EF4444',
        'width': 'mapData(weight, 0, 1, 6, 16)',
        'opacity': 1,
        'z-index': 150,
        'overlay-opacity': 0.3,
        'overlay-color': '#EF4444'
      },
      visited: {
        'line-color': '#10B981',
        'target-arrow-color': '#10B981',
        'width': 'mapData(weight, 0, 1, 3, 10)',
        'opacity': 0.9,
        'z-index': 80
      },
      unvisited: {
        'line-color': '#6B7280',
        'target-arrow-color': '#6B7280',
        'width': 'mapData(weight, 0, 1, 2, 6)',
        'opacity': 0.4,
        'z-index': 60
      }
    }
  }

  // Clear all path highlights
  const clearHighlights = useCallback(() => {
    if (!cytoscapeInstance) return

    // Remove all path-related classes
    cytoscapeInstance.elements().removeClass([
      'path-highlighted',
      'path-current',
      'path-visited',
      'path-unvisited',
      'path-strength-indicator'
    ])

    // Reset to default styles
    cytoscapeInstance.elements().removeStyle()
  }, [cytoscapeInstance])

  // Apply cumulative strength visualization
  const applyCumulativeStrength = useCallback((path: CausalPath) => {
    if (!cytoscapeInstance || !showCumulativeStrength) return

    let cumulativeStrength = 1.0

    path.events.forEach((event, index) => {
      const node = cytoscapeInstance.getElementById(event.id)
      if (node.length === 0) return

      // Calculate cumulative strength up to this point
      if (index > 0) {
        const relationship = path.relationships[index - 1]
        if (relationship) {
          cumulativeStrength *= relationship.weight * relationship.confidence
        }
      }

      // Apply strength-based styling
      const strengthOpacity = Math.max(0.3, cumulativeStrength)
      const strengthSize = 30 + (cumulativeStrength * 30) // 30-60px range

      node.style({
        'opacity': strengthOpacity,
        'width': strengthSize,
        'height': strengthSize
      })

      // Add strength indicator class
      node.addClass('path-strength-indicator')
    })

    // Apply strength-based edge styling
    path.relationships.forEach((relationship) => {
      const edge = cytoscapeInstance.getElementById(relationship.id)
      if (edge.length === 0) return

      const strength = relationship.weight * relationship.confidence
      const strengthWidth = 2 + (strength * 8) // 2-10px range
      const strengthOpacity = Math.max(0.4, strength)

      edge.style({
        'width': strengthWidth,
        'opacity': strengthOpacity
      })
    })
  }, [cytoscapeInstance, showCumulativeStrength])

  // Highlight entire path
  const highlightPath = useCallback((path: CausalPath) => {
    if (!cytoscapeInstance) return

    // Clear previous highlights
    clearHighlights()

    // Highlight all nodes in path
    path.events.forEach(event => {
      const node = cytoscapeInstance.getElementById(event.id)
      if (node.length > 0) {
        node.addClass('path-highlighted')
        node.style(highlightStyles.node.highlighted)
      }
    })

    // Highlight all edges in path
    path.relationships.forEach(relationship => {
      const edge = cytoscapeInstance.getElementById(relationship.id)
      if (edge.length > 0) {
        edge.addClass('path-highlighted')
        edge.style(highlightStyles.edge.highlighted)
      }
    })

    // Apply cumulative strength visualization
    applyCumulativeStrength(path)

    // Fit view to show entire path
    const pathElements = cytoscapeInstance.elements().filter(ele => 
      ele.hasClass('path-highlighted')
    )
    
    if (pathElements.length > 0) {
      cytoscapeInstance.animate({
        fit: {
          eles: pathElements,
          padding: 50
        }
      }, {
        duration: animationDuration
      })
    }
  }, [cytoscapeInstance, clearHighlights, highlightStyles, applyCumulativeStrength, animationDuration])

  // Highlight path with step progression
  const highlightPathWithSteps = useCallback((path: CausalPath, stepIndex: number) => {
    if (!cytoscapeInstance) return

    // Clear previous highlights
    clearHighlights()

    // Apply step-based highlighting
    path.events.forEach((event, index) => {
      const node = cytoscapeInstance.getElementById(event.id)
      if (node.length === 0) return

      if (index === stepIndex) {
        // Current step
        node.addClass('path-current')
        node.style(highlightStyles.node.current)
      } else if (index < stepIndex) {
        // Visited steps
        node.addClass('path-visited')
        node.style(highlightStyles.node.visited)
      } else {
        // Unvisited steps
        node.addClass('path-unvisited')
        node.style(highlightStyles.node.unvisited)
      }
    })

    // Apply step-based edge highlighting
    path.relationships.forEach((relationship, index) => {
      const edge = cytoscapeInstance.getElementById(relationship.id)
      if (edge.length === 0) return

      if (index === stepIndex - 1 && stepIndex > 0) {
        // Current relationship (leading to current step)
        edge.addClass('path-current')
        edge.style(highlightStyles.edge.current)
      } else if (index < stepIndex - 1) {
        // Visited relationships
        edge.addClass('path-visited')
        edge.style(highlightStyles.edge.visited)
      } else {
        // Unvisited relationships
        edge.addClass('path-unvisited')
        edge.style(highlightStyles.edge.unvisited)
      }
    })

    // Apply cumulative strength visualization
    applyCumulativeStrength(path)

    // Focus on current step
    if (stepIndex < path.events.length) {
      const currentEvent = path.events[stepIndex]
      if (!currentEvent) return
      
      const currentNode = cytoscapeInstance.getElementById(currentEvent.id)
      
      if (currentNode.length > 0) {
        cytoscapeInstance.animate({
          center: { eles: currentNode },
          zoom: Math.min(cytoscapeInstance.zoom() * 1.2, 2.0)
        }, {
          duration: animationDuration,
          complete: onPathAnimationComplete
        })
      }
    }
  }, [cytoscapeInstance, clearHighlights, highlightStyles, applyCumulativeStrength, animationDuration, onPathAnimationComplete])

  // Stop any ongoing animation
  const stopAnimation = useCallback(() => {
    if (animationRef.current) {
      clearTimeout(animationRef.current)
      animationRef.current = null
    }
  }, [])

  // Main effect to handle path highlighting
  useEffect(() => {
    if (!cytoscapeInstance) return

    // Stop any ongoing animation
    stopAnimation()

    if (!highlightedPath) {
      clearHighlights()
      return
    }

    // Check if this is a new path or step change
    const isNewPath = previousPathRef.current?.events[0]?.id !== highlightedPath.events[0]?.id
    
    if (isNewPath) {
      // New path - highlight entire path first, then focus on current step
      highlightPath(highlightedPath)
      setTimeout(() => {
        highlightPathWithSteps(highlightedPath, currentStepIndex)
      }, animationDuration)
    } else {
      // Same path, different step - animate transition
      highlightPathWithSteps(highlightedPath, currentStepIndex)
    }

    // Update previous path reference
    previousPathRef.current = highlightedPath

  }, [cytoscapeInstance, highlightedPath, currentStepIndex, highlightPath, highlightPathWithSteps, clearHighlights, stopAnimation, animationDuration])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAnimation()
      if (cytoscapeInstance) {
        clearHighlights()
      }
    }
  }, [cytoscapeInstance, clearHighlights, stopAnimation])

  // This component doesn't render anything - it only manages Cytoscape styling
  return null
}

export default CausalPathHighlighter