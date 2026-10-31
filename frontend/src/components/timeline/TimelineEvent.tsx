import React, { memo, useCallback } from 'react'
import { Event } from '@/types'

export interface TimelineEventProps {
  event: Event
  x: number
  y: number
  /**
   * Whether the event is part of the evidence of the selected pressure.
   *
   * The exploration panel's "highlight evidence" button sets the ids; without
   * a mark for them the button changed nothing anyone could see.
   */
  isHighlighted?: boolean
  onClick?: (event: Event) => void
  onContextMenu?: (e: React.MouseEvent, event: Event) => void
  /**
   * Called when a genuine drag gesture begins on the event mark (mousedown).
   * The parent (Timeline) owns the gesture and converts pointer movement into a
   * new timestamp via the shared d3 time scale.
   */
  onDragStart?: (event: Event, native: React.MouseEvent) => void
  /**
   * Called when the event mark is hovered or focused. `position` is the mark's
   * inner-SVG coordinate, used by the parent to place a tooltip.
   */
  onHoverEnter?: (event: Event, position: { x: number; y: number }) => void
  /** Called when the pointer or focus leaves the event mark. */
  onHoverLeave?: (event: Event) => void
}

/**
 * Memoized timeline event component.
 *
 * This component is memoized to prevent unnecessary re-renders when the parent
 * Timeline component updates. The onClick and onContextMenu handlers are wrapped
 * in useCallback to maintain stable references within this component.
 *
 * Interaction is handled with plain React props (ADR-001 Tier 1): the mark stays
 * React-rendered, and the parent supplies stable callbacks so memoisation holds.
 *
 * @see docs/adr-001-d3-react-integration.md
 */
export const TimelineEvent = memo(function TimelineEvent({
  event,
  x,
  y,
  isHighlighted = false,
  onClick,
  onContextMenu,
  onDragStart,
  onHoverEnter,
  onHoverLeave
}: TimelineEventProps) {
  // Stable click handler that captures the event
  const handleClick = useCallback(() => {
    onClick?.(event)
  }, [onClick, event])

  // Stable context menu handler that captures the event
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    onContextMenu?.(e, event)
  }, [onContextMenu, event])

  // Mousedown begins a potential drag; Timeline decides whether it becomes one
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    onDragStart?.(event, e)
  }, [onDragStart, event])

  const handleHoverEnter = useCallback(() => {
    onHoverEnter?.(event, { x, y })
  }, [onHoverEnter, event, x, y])

  const handleHoverLeave = useCallback(() => {
    onHoverLeave?.(event)
  }, [onHoverLeave, event])

  return (
    <g
      className="event"
      data-event-id={event.id}
      data-timeline-mark="event"
      transform={`translate(${x}, ${y})`}
      tabIndex={0}
      role="button"
      aria-label={`Event: ${event.description} by ${event.actor} targeting ${event.target} at ${new Date(event.timestamp).toLocaleString()}`}
      onMouseDown={handleMouseDown}
      onMouseEnter={handleHoverEnter}
      onMouseLeave={handleHoverLeave}
      onFocus={handleHoverEnter}
      onBlur={handleHoverLeave}
      style={{ cursor: 'grab' }}
    >
      <circle
        className="event-marker"
        r={isHighlighted ? 9 : 6}
        fill="#f59e0b"
        stroke={isHighlighted ? '#1d4ed8' : '#ffffff'}
        strokeWidth={isHighlighted ? 3 : 2}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      />
      <line x1={0} y1={0} x2={0} y2={20} stroke="#6b7280" strokeWidth={1} />
    </g>
  )
})

export default TimelineEvent
