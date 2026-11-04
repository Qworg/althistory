import type { CSSProperties } from 'react'

/**
 * Room below an event mark (px) the tooltip needs to open there: three lines
 * of 12px text with padding, and a margin so it stops short of the axis.
 */
export const EVENT_TOOLTIP_ROOM = 90

/**
 * Where the hover tooltip sits, in container px.
 *
 * Event marks sit on the track with their labels in rows above them. When the
 * canvas draws causal links there is a band under the track (decorative: the
 * inspector lists the links in words), so the tooltip opens BELOW the mark,
 * over the links, and leaves the neighbouring labels readable. Without that
 * band the time axis is just below, so it opens above. Arcs sit at the top of
 * the plot, so theirs opens below. Past the middle of the canvas the tooltip
 * is anchored by its right edge so it never runs off the right side.
 *
 * `roomBelowEvent` is the clear space under an event mark before the axis.
 */
export function tooltipPlacement(
  hovered: { kind: 'event' | 'arc'; x: number; y: number },
  margin: { left: number; top: number },
  canvasWidth: number,
  roomBelowEvent = 0
): CSSProperties {
  const x = margin.left + hovered.x
  const y = margin.top + hovered.y
  const horizontal: CSSProperties =
    x > canvasWidth / 2 ? { right: Math.max(0, canvasWidth - x + 8) } : { left: x + 8 }
  if (hovered.kind === 'arc') return { ...horizontal, top: y + 22 }
  return roomBelowEvent >= EVENT_TOOLTIP_ROOM
    ? { ...horizontal, top: y + 14 }
    : { ...horizontal, top: y - 14, transform: 'translateY(-100%)' }
}
