import React, { memo, useCallback } from 'react'
import { Event } from '@/types'

export interface TimelineEventProps {
  event: Event
  x: number
  y: number
  onClick?: (event: Event) => void
  onContextMenu?: (e: React.MouseEvent, event: Event) => void
}

/**
 * Memoized timeline event component.
 *
 * This component is memoized to prevent unnecessary re-renders when the parent
 * Timeline component updates. The onClick and onContextMenu handlers are wrapped
 * in useCallback to maintain stable references within this component.
 *
 * @see impl/deferredplans/01-timeline-architecture-refactor.md (Phase 3.2)
 */
export const TimelineEvent = memo(function TimelineEvent({
  event,
  x,
  y,
  onClick,
  onContextMenu
}: TimelineEventProps) {
  // Stable click handler that captures the event
  const handleClick = useCallback(() => {
    onClick?.(event)
  }, [onClick, event])

  // Stable context menu handler that captures the event
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    onContextMenu?.(e, event)
  }, [onContextMenu, event])

  return (
    <g
      className="event"
      data-event-id={event.id}
      transform={`translate(${x}, ${y})`}
      tabIndex={0}
      role="button"
      aria-label={`Event: ${event.description} by ${event.actor} targeting ${event.target} at ${new Date(event.timestamp).toLocaleString()}`}
    >
      <circle
        className="event-marker"
        r={6}
        fill="#f59e0b"
        stroke="#ffffff"
        strokeWidth={2}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      />
      <line x1={0} y1={0} x2={0} y2={20} stroke="#6b7280" strokeWidth={1} />
    </g>
  )
})

export default TimelineEvent
