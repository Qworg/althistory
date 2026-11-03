import React, { memo, useCallback } from 'react'
import { Event } from '@/types'
import { formatHistoricalTimestamp } from '@/utils/historicalTime'
import {
  truncateLabel,
  PRIORITY_LABEL_MAX_CHARS,
  LABEL_FONT_SIZE,
  TIMELINE_LABEL_CONFIG,
  type EventLabelPlacement,
} from './eventLabelLayout'
import { EVENT_STEM_LENGTH } from './timelineLayout'

/**
 * Radius of the transparent hit area: a 24px target, twice the 12px dot, so
 * the mark is easy to click without the dot itself growing.
 */
const HIT_RADIUS = 12

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
  /** Whether this event is the active selection in the timeline inspector. */
  isSelected?: boolean
  /**
   * Whether the event exists only in this branch: it falls after the point of
   * divergence and has no counterpart in the ghosted baseline. Drawn in the
   * divergence amber so the branch's own history reads apart from the
   * history it shares with its baseline.
   */
  isBranchOwn?: boolean
  /**
   * Whether the mark is the timeline's single tab stop (roving tabindex).
   * Timeline makes exactly one mark tabbable and moves focus between marks
   * with the arrow keys; standalone, the mark is tabbable on its own.
   */
  isTabStop?: boolean
  /**
   * Where to draw the event's label, decided by Timeline's collision-free
   * layout (see eventLabelLayout.ts). `null` means no room: the mark is
   * unlabelled. When omitted, a selected or highlighted mark falls back to a
   * label directly above it, so the component still names those on its own.
   */
  label?: EventLabelPlacement | null
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
  isSelected = false,
  isBranchOwn = false,
  isTabStop = true,
  label,
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

  const placement: EventLabelPlacement | null =
    label !== undefined
      ? label
      : isSelected || isHighlighted
        ? {
            offset: TIMELINE_LABEL_CONFIG.rowOffsets[0] ?? -18,
            anchor: 'middle',
            text: truncateLabel(event.description, PRIORITY_LABEL_MAX_CHARS),
            emphasis: true,
          }
        : null

  // The mark is a role="button", so it must answer the keys a button answers.
  // Space is prevented so it does not also scroll the page. Every other key
  // (arrows, retiming, the context-menu key, Escape) bubbles to Timeline,
  // which owns navigation between marks.
  const handleKeyDown = useCallback((e: React.KeyboardEvent<SVGGElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      e.stopPropagation()
      handleClick()
    }
  }, [handleClick])

  return (
    <g
      className="event group"
      data-event-id={event.id}
      data-timeline-mark="event"
      data-mark-key={`event:${event.id}`}
      data-branch-own={isBranchOwn ? 'true' : undefined}
      transform={`translate(${x}, ${y})`}
      tabIndex={isTabStop ? 0 : -1}
      role="button"
      aria-label={`Event: ${event.description} by ${event.actor} targeting ${event.target} at ${formatHistoricalTimestamp(event.timestamp)}${isBranchOwn ? ' (this branch only)' : ''}`}
      // The whole group takes the click, so the stem and label (which sit
      // over and around the dot) never swallow it.
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onMouseDown={handleMouseDown}
      onMouseEnter={handleHoverEnter}
      onMouseLeave={handleHoverLeave}
      onFocus={handleHoverEnter}
      onBlur={handleHoverLeave}
      onKeyDown={handleKeyDown}
      style={{ cursor: 'grab', outline: 'none' }}
    >
      {/* Transparent 24px hit area, under everything else. */}
      <circle className="event-hit-area" r={HIT_RADIUS} fill="transparent" pointerEvents="all" />
      {/* The stem is drawn before the dot so the dot covers its top end. */}
      <line
        className="event-stem"
        x1={0}
        y1={0}
        x2={0}
        y2={EVENT_STEM_LENGTH}
        stroke={isSelected ? 'var(--accent-selected)' : 'var(--text-muted)'}
        strokeWidth={isSelected ? 1.5 : 1}
        pointerEvents="none"
      />
      {/* Keyboard focus ring. Browsers draw no reliable outline around an SVG
          <g>, so the ring is a mark of its own, shown only while the group
          matches :focus-visible (keyboard focus, not a mouse click). */}
      <circle
        className="event-focus-ring opacity-0 group-focus-visible:opacity-100"
        r={15}
        fill="none"
        stroke="var(--accent-selected)"
        strokeWidth={2}
        pointerEvents="none"
      />
      <circle
        className="event-marker"
        r={isHighlighted ? 9 : isSelected ? 8 : 6}
        // Shared history is the cobalt baseline; amber is reserved for
        // divergence: the branch's own events, and the highlighted
        // (pressure evidence) ring.
        fill={
          isSelected
            ? 'var(--accent-selected)'
            : isBranchOwn
              ? 'var(--accent-divergence)'
              : 'var(--accent-baseline)'
        }
        stroke={isHighlighted ? 'var(--accent-divergence)' : 'var(--surface-card)'}
        strokeWidth={isHighlighted || isSelected ? 3 : 2}
      />
      {isSelected && (
        <circle
          className="event-selected-ring"
          r={13}
          fill="none"
          stroke="var(--accent-selected)"
          strokeWidth={1.75}
          strokeDasharray="3 2"
          pointerEvents="none"
        />
      )}
      {placement && (
        <text
          className="event-label"
          y={placement.offset}
          textAnchor={placement.anchor}
          fontSize={LABEL_FONT_SIZE}
          fontWeight={isSelected || isHighlighted ? 600 : 400}
          // Ink tokens, not fixed navy: fixed dark fills vanished on the dark canvas.
          fill={
            isSelected
              ? 'var(--accent-selected)'
              : isHighlighted
                ? 'var(--text-primary)'
                : 'var(--text-secondary)'
          }
          // A card-coloured halo keeps the label legible where it crosses an
          // arc's dashed edge or another mark's stem.
          stroke="var(--surface-card)"
          strokeWidth={3}
          strokeLinejoin="round"
          paintOrder="stroke"
          pointerEvents="none"
        >
          {placement.text}
        </text>
      )}
    </g>
  )
})

export default TimelineEvent
