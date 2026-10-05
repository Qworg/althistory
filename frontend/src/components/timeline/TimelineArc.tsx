import React, { memo, useCallback } from 'react'
import { ArcWithUIState } from './arcHierarchyUtils'

export interface TimelineArcProps {
  arc: ArcWithUIState
  x: number
  y: number
  width: number
  onClick?: (arc: ArcWithUIState) => void
  onContextMenu?: (e: React.MouseEvent, arc: ArcWithUIState) => void
}

/**
 * Memoized timeline arc component.
 *
 * This component is memoized to prevent unnecessary re-renders when the parent
 * Timeline component updates. The onClick and onContextMenu handlers are wrapped
 * in useCallback to maintain stable references within this component.
 *
 * @see impl/deferredplans/01-timeline-architecture-refactor.md (Phase 3.2)
 */
export const TimelineArc = memo(function TimelineArc({
  arc,
  x,
  y,
  width,
  onClick,
  onContextMenu
}: TimelineArcProps) {
  // Stable click handler that captures the arc
  const handleClick = useCallback(() => {
    onClick?.(arc)
  }, [onClick, arc])

  // Stable context menu handler that captures the arc
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    onContextMenu?.(e, arc)
  }, [onContextMenu, arc])

  return (
    <g className="arc" data-arc-id={arc.id}>
      <rect
        className="arc-main"
        x={x}
        y={y}
        width={width}
        height={16}
        fill={arc.isSelected ? '#60a5fa' : '#93c5fd'}
        stroke="#6b7280"
        strokeWidth={1}
        rx={3}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      />
      <text x={x + 4} y={y - 2} fontSize={10} fill="#6b7280">
        {arc.name}
      </text>
    </g>
  )
})

export default TimelineArc
