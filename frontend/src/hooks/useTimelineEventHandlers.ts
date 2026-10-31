// frontend/src/hooks/useTimelineEventHandlers.ts
// See: docs/adr-001-d3-react-integration.md

import React, { useCallback, useRef } from 'react'
import { Event } from '@/types'
import { ArcWithUIState } from '@/components/timeline/arcHierarchyUtils'
import {
  TimelineEventHandlerProps,
  UseTimelineEventHandlersResult
} from '@/types/timeline'

/**
 * Custom hook for stable timeline event handlers.
 * 
 * This hook uses the ref pattern to avoid infinite update loops caused by
 * callback functions being included in useEffect dependencies. By storing
 * callbacks in refs, we maintain stable function identities while always
 * calling the latest callback version.
 * 
 * @param props - Event handler configuration
 * @returns Stable event handler functions
 */
export function useTimelineEventHandlers({
  onEventSelect,
  onArcSelect,
  onEventCreate,
  xScale,
  margin,
  innerWidth
}: TimelineEventHandlerProps): UseTimelineEventHandlersResult {
  // Use refs to store callbacks - this breaks the dependency cycle
  // that causes infinite loops when callbacks are in useEffect deps
  const onEventSelectRef = useRef(onEventSelect)
  onEventSelectRef.current = onEventSelect
  
  const onArcSelectRef = useRef(onArcSelect)
  onArcSelectRef.current = onArcSelect
  
  const onEventCreateRef = useRef(onEventCreate)
  onEventCreateRef.current = onEventCreate

  // Stable handler for event clicks
  const handleEventClick = useCallback((event: Event) => {
    onEventSelectRef.current?.(event)
  }, []) // No dependencies - uses ref

  // Stable handler for arc clicks
  // Note: Accepts ArcWithUIState but passes to onArcSelect which expects Arc
  // This works because ArcWithUIState extends Arc
  const handleArcClick = useCallback((arc: ArcWithUIState) => {
    onArcSelectRef.current?.(arc)
  }, []) // No dependencies - uses ref

  // Stable handler for SVG double-click (create event at position)
  const handleSvgDoubleClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const createHandler = onEventCreateRef.current
    if (!createHandler || !xScale) return

    const svg = e.currentTarget
    if (!svg) return

    // Create SVG point for coordinate transformation
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY

    // Get the screen CTM (current transformation matrix)
    const ctm = svg.getScreenCTM()
    if (!ctm) return

    // Invert the CTM to convert screen coordinates to SVG coordinates
    const inv = ctm.inverse()
    const local = pt.matrixTransform(inv)

    // Adjust for margin and clamp to valid range
    const x = local.x - margin.left
    const clampedX = Math.max(0, Math.min(innerWidth, x))

    // Convert x position to timestamp using the scale
    const timestamp = xScale.invert(clampedX)
    createHandler(timestamp)
  }, [xScale, margin.left, innerWidth]) // These are stable/memoized values

  return {
    handleEventClick,
    handleArcClick,
    handleSvgDoubleClick
  }
}

export default useTimelineEventHandlers
