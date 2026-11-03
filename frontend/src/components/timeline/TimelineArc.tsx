import React, { memo, useCallback } from 'react'
import { ArcWithUIState } from './arcHierarchyUtils'
import { formatHistoricalRange } from '@/utils/historicalTime'
import { truncateLabel, LABEL_FONT_SIZE } from './eventLabelLayout'
import { ARC_BAR_HEIGHT } from './timelineLayout'

export type ArcResizeEdge = 'start' | 'end'

export interface TimelineArcProps {
  arc: ArcWithUIState
  x: number
  y: number
  width: number
  /**
   * Whether the arc is the timeline's single tab stop (roving tabindex).
   * Timeline makes exactly one mark tabbable and moves focus between marks
   * with the arrow keys; standalone, the arc is tabbable on its own.
   */
  isTabStop?: boolean
  onClick?: (arc: ArcWithUIState) => void
  onContextMenu?: (e: React.MouseEvent, arc: ArcWithUIState) => void
  /** Toggles whether the arc's child arcs are shown. */
  onToggleExpand?: (arc: ArcWithUIState) => void
  /** Begins a horizontal resize gesture for one edge of the arc (pointer only; the keyboard resizes through Timeline). */
  onResizeStart?: (arc: ArcWithUIState, edge: ArcResizeEdge, native: React.MouseEvent) => void
  /**
   * Called when the arc is hovered or focused. `position` is the arc's inner-SVG
   * coordinate, used by the parent to place a tooltip.
   */
  onHoverEnter?: (arc: ArcWithUIState, position: { x: number; y: number }) => void
  /** Called when the pointer or focus leaves the arc. */
  onHoverLeave?: (arc: ArcWithUIState) => void
}

/** Approximate advance of one character of the 12px arc label. */
const LABEL_CHAR_WIDTH_PX = LABEL_FONT_SIZE * 0.56
/** Fewer characters than this and the label is omitted (the tooltip and aria-label still name the arc). */
const MIN_LABEL_CHARS = 3

/** What a screen reader hears for the arc mark. */
function arcAccessibleName(arc: ArcWithUIState): string {
  const events = `${arc.eventCount} ${arc.eventCount === 1 ? 'event' : 'events'}`
  const children = arc.childArcs.length
  const nesting =
    children > 0
      ? `, ${children} ${children === 1 ? 'sub-arc' : 'sub-arcs'}, ${arc.isExpanded ? 'expanded' : 'collapsed'}`
      : ''
  const selected = arc.isSelected ? ', selected' : ''
  return `Arc: ${arc.name}, ${formatHistoricalRange(arc.start_time, arc.end_time)}, ${events}${nesting}${selected}`
}

/**
 * Memoized timeline arc component.
 *
 * The arc is one focusable, selectable mark (role="button"): Enter or Space
 * selects it, like a click, and Shift+Enter expands or collapses its sub-arcs.
 * Resizing is a keyboard mode of the focused arc, handled by Timeline (which
 * owns the time scale); the edge handles and the disclosure square drawn here
 * are pointer affordances, hidden from assistive tech and out of the tab order,
 * so the arc is reached once rather than as four separate controls.
 *
 * Interaction is React props (ADR-001 Tier 1); the parent supplies stable
 * callbacks so memoisation holds.
 *
 * @see docs/adr-001-d3-react-integration.md
 */
export const TimelineArc = memo(function TimelineArc({
  arc,
  x,
  y,
  width,
  isTabStop = true,
  onClick,
  onContextMenu,
  onToggleExpand,
  onResizeStart,
  onHoverEnter,
  onHoverLeave
}: TimelineArcProps) {
  const hasChildren = arc.childArcs.length > 0
  const height = ARC_BAR_HEIGHT

  const handleClick = useCallback(() => {
    onClick?.(arc)
  }, [onClick, arc])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    onContextMenu?.(e, arc)
  }, [onContextMenu, arc])

  const handleToggle = useCallback((e: React.MouseEvent) => {
    // The disclosure sits inside the bar's group: it must not also select.
    e.stopPropagation()
    onToggleExpand?.(arc)
  }, [onToggleExpand, arc])

  // Enter/Space select (a button's keys); Shift+Enter toggles the sub-arcs.
  // Every other key bubbles to Timeline, which owns navigation and resizing.
  const handleKeyDown = useCallback((e: React.KeyboardEvent<SVGGElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault()
      e.stopPropagation()
      if (hasChildren) onToggleExpand?.(arc)
      return
    }
    if (e.shiftKey) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      e.stopPropagation()
      onClick?.(arc)
    }
  }, [onClick, onToggleExpand, arc, hasChildren])

  const handleStartResizeMouseDown = useCallback((e: React.MouseEvent) => {
    onResizeStart?.(arc, 'start', e)
  }, [onResizeStart, arc])

  const handleEndResizeMouseDown = useCallback((e: React.MouseEvent) => {
    onResizeStart?.(arc, 'end', e)
  }, [onResizeStart, arc])

  // Anchored at the visible start of the bar, so an arc panned partly off the
  // left edge does not open its tooltip off the canvas.
  const handleHoverEnter = useCallback(() => {
    onHoverEnter?.(arc, { x: Math.max(x, 0), y })
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

  // The label rides above the visible part of the bar (a bar panned partly off
  // the left edge keeps its name in view) and is cut to the bar's width, so it
  // never runs over the next arc in the same row.
  const labelX = Math.max(x, 0) + 4
  const labelRoom = x + width - labelX - 2
  const labelChars = Math.floor(labelRoom / LABEL_CHAR_WIDTH_PX)
  const labelText = labelChars >= MIN_LABEL_CHARS ? truncateLabel(arc.name, labelChars) : null

  return (
    <g
      className="arc"
      data-arc-id={arc.id}
      data-timeline-mark="arc"
      onMouseEnter={handleHoverEnter}
      onMouseLeave={handleHoverLeave}
    >
      <g
        className="arc-mark group"
        data-mark-key={`arc:${arc.id}`}
        role="button"
        tabIndex={isTabStop ? 0 : -1}
        aria-label={arcAccessibleName(arc)}
        aria-keyshortcuts={hasChildren ? 'Enter Shift+Enter' : undefined}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onKeyDown={handleKeyDown}
        onFocus={handleHoverEnter}
        onBlur={handleHoverLeave}
        style={{ cursor: 'pointer', outline: 'none' }}
      >
        {/* Keyboard focus ring, shown only on :focus-visible (see TimelineEvent). */}
        <rect
          className="arc-focus-ring opacity-0 group-focus-visible:opacity-100"
          x={x - 3}
          y={y - 3}
          width={width + 6}
          height={height + 6}
          rx={5}
          fill="none"
          stroke="var(--accent-selected)"
          strokeWidth={2}
          pointerEvents="none"
        />
        <rect
          className="arc-main"
          x={x}
          y={y}
          width={width}
          height={height}
          // Theme variables (index.css): the light values are unchanged, and
          // html.dark swaps the pale bars for a quieter translucent cobalt.
          style={{
            fill: arc.isSelected ? 'var(--arc-fill-selected)' : 'var(--arc-fill)',
            stroke: arc.isSelected ? 'var(--accent-selected)' : 'var(--arc-stroke)',
          }}
          strokeWidth={arc.isSelected ? 1.5 : 1}
          rx={3}
        />
        {labelText && (
          <text
            className="arc-label"
            x={labelX}
            y={y - 4}
            fontSize={LABEL_FONT_SIZE}
            fontWeight={arc.isSelected ? 600 : 400}
            style={{ fill: arc.isSelected ? 'var(--text-primary)' : 'var(--text-secondary)' }}
          >
            {labelText}
          </text>
        )}
      </g>

      {/* Edge resize handles: pointer only. The keyboard resizes the focused
          arc through Timeline ([ and ]), so these stay out of the tab order. */}
      <g
        className="arc-resize-handle arc-resize-start"
        data-resize-edge="start"
        aria-hidden="true"
        onMouseDown={handleStartResizeMouseDown}
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
          style={{ stroke: 'var(--arc-grip)' }}
          strokeWidth={1}
          pointerEvents="none"
        />
      </g>

      <g
        className="arc-resize-handle arc-resize-end"
        data-resize-edge="end"
        aria-hidden="true"
        onMouseDown={handleEndResizeMouseDown}
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
          style={{ stroke: 'var(--arc-grip)' }}
          strokeWidth={1}
          pointerEvents="none"
        />
      </g>

      {/* Expand/collapse disclosure, only present when the arc has children.
          A pointer affordance: the arc mark itself carries the state in its
          name and answers Shift+Enter. */}
      {hasChildren && (
        <g
          className="arc-toggle"
          data-arc-toggle={arc.id}
          data-expanded={arc.isExpanded ? 'true' : 'false'}
          aria-hidden="true"
          onClick={handleToggle}
          style={{ cursor: 'pointer' }}
        >
          <rect
            x={toggleX}
            y={toggleY}
            width={toggleSize}
            height={toggleSize}
            rx={2}
            // The disclosure sits on the canvas, so it takes the card and ink
            // tokens rather than a fixed white that glared in dark mode.
            style={{ fill: 'var(--surface-card)', stroke: 'var(--text-muted)' }}
            strokeWidth={1}
          />
          <path
            d={
              arc.isExpanded
                ? `M ${toggleX + 2.5} ${toggleY + 5} h 5`
                : `M ${toggleX + 2.5} ${toggleY + 5} h 5 M ${toggleX + 5} ${toggleY + 2.5} v 5`
            }
            style={{ stroke: 'var(--text-secondary)' }}
            strokeWidth={1}
            fill="none"
          />
        </g>
      )}
    </g>
  )
})

export default TimelineArc
