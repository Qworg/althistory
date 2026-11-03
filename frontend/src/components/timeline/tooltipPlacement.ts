import type { CSSProperties } from 'react'

/**
 * Where the hover tooltip sits, in container px. Event marks sit on the track
 * just above the time axis, so their tooltip opens ABOVE the mark (below, it
 * covered the axis labels); arcs sit at the top of the plot, so theirs opens
 * below. Past the middle of the canvas the tooltip is anchored by its right
 * edge so it never runs off the right side.
 */
export function tooltipPlacement(
  hovered: { kind: 'event' | 'arc'; x: number; y: number },
  margin: { left: number; top: number },
  canvasWidth: number
): CSSProperties {
  const x = margin.left + hovered.x
  const y = margin.top + hovered.y
  const horizontal: CSSProperties =
    x > canvasWidth / 2 ? { right: Math.max(0, canvasWidth - x + 8) } : { left: x + 8 }
  return hovered.kind === 'event'
    ? { ...horizontal, top: y - 14, transform: 'translateY(-100%)' }
    : { ...horizontal, top: y + 22 }
}
