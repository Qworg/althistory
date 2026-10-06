import React, { memo, useCallback } from 'react'
import { ArcWithUIState } from './arcHierarchyUtils'

export type ArcResizeEdge = 'start' | 'end'

export interface TimelineArcProps {
  arc: ArcWithUIState
  x: number
  y: number
  width: number
  onClick?: (arc: ArcWithUIState) => void
  onContextMenu?: (e: React.MouseEvent, arc: ArcWithUIState) => void
  /** Toggles whether the arc's child arcs are shown. */
  onToggleExpand?: (arc: ArcWithUIState) => void
  /** Begins a horizontal resize gesture for one edge of the arc. */
  onResizeStart?: (arc: ArcWithUIState, edge: ArcResizeEdge, native: React.MouseEvent) => void
  /** Keyboard equivalent of a resize: direction is -1 (earlier) or +1 (later). */
  onResizeKey?: (arc: ArcWithUIState, edge: ArcResizeEdge, direction: -1 | 1) => void
  /**
   * Called when the arc is hovered or focused. `position` is the arc's inner-SVG
   * coordinate, used by the parent to place a tooltip.
   */
  onHoverEnter?: (arc: ArcWithUIState, position: { x: number; y: number }) => void
  /** Called when the pointer or focus leaves the arc. */
  onHoverLeave?: (arc: ArcWithUIState) => void
}

/**
 * Memoized timeline arc component.
 *
 * This component is memoized to prevent unnecessary re-renders when the parent
 * Timeline component updates. The onClick and onContextMenu handlers are wrapped
 * in useCallback to maintain stable references within this component.
 *
 * Expand/resize/hover affordances are React-rendered and use React props
 * (ADR-001 Tier 1); the parent supplies stable callbacks so memoisation holds.
 *
 * @see impl/deferredplans/01-timeline-architecture-refactor.md (Phase 3.2)
 * @see impl/deferredplans/ADR-001-d3-react-integration.md
 */
export const TimelineArc = memo(function TimelineArc({
  arc,
  x,
  y,
  width,
  onClick,
  onContextMenu,
  onToggleExpand,
  onResizeStart,
  onResizeKey,
  onHoverEnter,
  onHoverLeave
}: TimelineArcProps) {
  const hasChildren = arc.childArcs.length > 0
  const height = 16

  // Stable click handler that captures the arc
  const handleClick = useCallback(() => {
    onClick?.(arc)
  }, [onClick, arc])

  // Stable context menu handler that captures the arc
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    onContextMenu?.(e, arc)
  }, [onContextMenu, arc])

  const handleToggle = useCallback(() => {
    onToggleExpand?.(arc)
  }, [onToggleExpand, arc])

  const handleToggleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault()
      onToggleExpand?.(arc)
    }
  }, [onToggleExpand, arc])

  const handleStartResizeMouseDown = useCallback((e: React.MouseEvent) => {
    onResizeStart?.(arc, 'start', e)
  }, [onResizeStart, arc])

  const handleEndResizeMouseDown = useCallback((e: React.MouseEvent) => {
    onResizeStart?.(arc, 'end', e)
  }, [onResizeStart, arc])

  const handleStartResizeKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      onResizeKey?.(arc, 'start', -1)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      onResizeKey?.(arc, 'start', 1)
    }
  }, [onResizeKey, arc])

  const handleEndResizeKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      onResizeKey?.(arc, 'end', -1)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      onResizeKey?.(arc, 'end', 1)
    }
  }, [onResizeKey, arc])

  const handleHoverEnter = useCallback(() => {
    onHoverEnter?.(arc, { x, y })
  }, [onHoverEnter, arc, x, y])

  const handleHoverLeave = useCallback(() => {
    onHoverLeave?.(arc)
  }, [onHoverLeave, arc])

  // Two resize handles must never sit on top of each other: each takes at most
  // a third of the bar, so the middle of the bar stays clickable. When the bar
  // is narrower than the minimum usable handle the handles overhang its ends
  // rather than piling up over it (each edge keeps a real hit area).
  const handleWidth = Math.max(3, Math.min(8, width / 3))
  const handleOverhang = Math.max(0, handleWidth - width / 3)
  const startHandleX = x - handleOverhang
  const startHandleRight = x + handleWidth - handleOverhang
  const endHandleX = x + width - handleWidth + handleOverhang

  // The disclosure lives in the gutter to the right of the start handle, so it
  // never steals the start resize handle's hit area. A bar too narrow to host
  // it drops the toggle below the bar, which keeps the same separation.
  const toggleSize = 10
  const toggleGap = 2
  const toggleFitsInline = endHandleX - startHandleRight >= toggleSize + toggleGap * 2
  const toggleX = toggleFitsInline ? startHandleRight + toggleGap : x
  const toggleY = toggleFitsInline ? y + 3 : y + height + toggleGap

  return (
    <g
      className="arc"
      data-arc-id={arc.id}
      data-timeline-mark="arc"
      onMouseEnter={handleHoverEnter}
      onMouseLeave={handleHoverLeave}
      onFocus={handleHoverEnter}
      onBlur={handleHoverLeave}
    >
      <rect
        className="arc-main"
        x={x}
        y={y}
        width={width}
        height={height}
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

      {/* Start-edge resize handle */}
      <g
        className="arc-resize-handle arc-resize-start"
        data-resize-edge="start"
        role="button"
        tabIndex={0}
        aria-label={`Resize start of arc ${arc.name}`}
        onMouseDown={handleStartResizeMouseDown}
        onKeyDown={handleStartResizeKeyDown}
        style={{ cursor: 'ew-resize' }}
      >
        <rect
          x={startHandleX}
          y={y}
          width={handleWidth}
          height={height}
          fill="transparent"
          pointerEvents="all"
        />
        <line
          x1={x + 1}
          y1={y + 3}
          x2={x + 1}
          y2={y + height - 3}
          stroke="#374151"
          strokeWidth={1}
        />
      </g>

      {/* End-edge resize handle */}
      <g
        className="arc-resize-handle arc-resize-end"
        data-resize-edge="end"
        role="button"
        tabIndex={0}
        aria-label={`Resize end of arc ${arc.name}`}
        onMouseDown={handleEndResizeMouseDown}
        onKeyDown={handleEndResizeKeyDown}
        style={{ cursor: 'ew-resize' }}
      >
        <rect
          x={endHandleX}
          y={y}
          width={handleWidth}
          height={height}
          fill="transparent"
          pointerEvents="all"
        />
        <line
          x1={x + width - 1}
          y1={y + 3}
          x2={x + width - 1}
          y2={y + height - 3}
          stroke="#374151"
          strokeWidth={1}
        />
      </g>

      {/* Expand/collapse disclosure, only present when the arc has children */}
      {hasChildren && (
        <g
          className="arc-toggle"
          data-arc-toggle={arc.id}
          role="button"
          tabIndex={0}
          aria-label={arc.isExpanded ? `Collapse arc ${arc.name}` : `Expand arc ${arc.name}`}
          aria-expanded={arc.isExpanded}
          onClick={handleToggle}
          onKeyDown={handleToggleKeyDown}
          style={{ cursor: 'pointer' }}
        >
          <rect
            x={toggleX}
            y={toggleY}
            width={toggleSize}
            height={toggleSize}
            rx={2}
            fill="#ffffff"
            stroke="#6b7280"
            strokeWidth={1}
          />
          <path
            d={
              arc.isExpanded
                ? `M ${toggleX + 2.5} ${toggleY + 5} h 5`
                : `M ${toggleX + 2.5} ${toggleY + 5} h 5 M ${toggleX + 5} ${toggleY + 2.5} v 5`
            }
            stroke="#374151"
            strokeWidth={1}
            fill="none"
          />
        </g>
      )}
    </g>
  )
})

export default TimelineArc
