/**
 * The "Time order" layout of the causal graph: events left to right by date,
 * as the timeline reads, so a cause always sits to the left of its effects and
 * the arrangement is the same on every load. (A force layout settles into a
 * different shape each time, so the graph never looked the same twice.)
 *
 * x follows time. Events too close in x to share a row (their labels would
 * overprint) stack into further rows, alternating above and below the axis so
 * the picture stays centred on it.
 */
import type { Core, NodeSingular } from 'cytoscape'
import { toInstant } from '@althistory/calendar'

export interface TimedNode {
  id: string
  time: number
}

export interface TimeOrderOptions {
  /** Width the timespan is spread over, in graph units. */
  width?: number
  /** Least horizontal room between two nodes in one row (their labels). */
  minGap?: number
  /** Vertical pitch between rows. */
  rowPitch?: number
}

/** Positions for `nodes` (see the module comment). Untimed nodes go at the end. */
export function timeOrderPositions(
  nodes: readonly TimedNode[],
  { width, minGap = 150, rowPitch = 96 }: TimeOrderOptions = {}
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>()
  if (nodes.length === 0) return positions
  const timed = nodes.filter((n) => Number.isFinite(n.time)).sort((a, b) => a.time - b.time || a.id.localeCompare(b.id))
  const untimed = nodes.filter((n) => !Number.isFinite(n.time))
  // Wide enough to read as a time axis, narrow enough that the canvas's fit
  // keeps labels at a legible size: crowding goes into more rows, not into
  // a wider strip that the fit then shrinks until the labels are culled.
  const span = Math.max(1, width ?? Math.min(1400, Math.max(600, Math.sqrt(timed.length) * 170)))
  const t0 = timed[0]?.time ?? 0
  const t1 = timed[timed.length - 1]?.time ?? t0
  const scale = (t: number) => (t1 === t0 ? span / 2 : ((t - t0) / (t1 - t0)) * span)

  // Rows in the order 0, -1, +1, -2, +2 …, each remembering its last x.
  const rowEnds: number[] = []
  const rowY = (index: number) => (index === 0 ? 0 : (index % 2 === 1 ? -1 : 1) * Math.ceil(index / 2) * rowPitch)
  for (const node of timed) {
    const x = scale(node.time)
    let row = rowEnds.findIndex((end) => x - end >= minGap)
    if (row === -1) {
      row = rowEnds.length
      rowEnds.push(x)
    } else {
      rowEnds[row] = x
    }
    positions.set(node.id, { x, y: rowY(row) })
  }
  untimed.forEach((node, i) => positions.set(node.id, { x: span + minGap * (i + 1), y: 0 }))
  return positions
}

/** The least zoom at which a node label still reads once the canvas fits the graph. */
const LEGIBLE_ZOOM = 0.6

/**
 * Positions whose overall shape matches the canvas they will be fitted into.
 *
 * A fixed span ignored the canvas: on a wide one the stacked rows made the
 * graph taller than the canvas allowed, so the fit used the middle ~40% of the
 * width; on a phone the strip was wider than the screen and shrank to a clump.
 * The span is moved toward the canvas's aspect ratio (a wider span packs fewer
 * rows, a narrower one more) and capped so the fit never zooms labels below
 * legibility.
 */
export function timeOrderPositionsForViewport(
  nodes: readonly TimedNode[],
  viewport: { width: number; height: number } | null,
  { minGap = 150, rowPitch = 96 }: Omit<TimeOrderOptions, 'width'> = {}
): Map<string, { x: number; y: number }> {
  let positions = timeOrderPositions(nodes, { minGap, rowPitch })
  if (!viewport || viewport.width <= 0 || viewport.height <= 0 || nodes.length < 3) return positions
  const aspect = viewport.width / viewport.height
  const maxSpan = Math.max(minGap * 2, viewport.width / LEGIBLE_ZOOM)
  const extentOf = (map: Map<string, { x: number; y: number }>) => {
    const points = [...map.values()]
    const xs = points.map((p) => p.x)
    const ys = points.map((p) => p.y)
    // A row's label sits under its node: count one pitch for it.
    return { width: Math.max(...xs) - Math.min(...xs) + minGap, height: Math.max(...ys) - Math.min(...ys) + rowPitch }
  }
  let span = extentOf(positions).width - minGap
  for (let step = 0; step < 6; step++) {
    const { height } = extentOf(positions)
    // The geometric mean converges without overshooting into the other extreme.
    const next = Math.min(maxSpan, Math.max(minGap * 2, Math.sqrt(span * aspect * height)))
    if (Math.abs(next - span) / span < 0.05) break
    span = next
    positions = timeOrderPositions(nodes, { width: span, minGap, rowPitch })
  }
  return positions
}

/** One computation per layout run, shared by the per-node `positions` calls. */
const cache = new WeakMap<Core, { signature: string; positions: Map<string, { x: number; y: number }> }>()

function nodeTime(node: NodeSingular): number {
  const event = node.data('event') as { timestamp?: string } | undefined
  return event?.timestamp ? toInstant(event.timestamp).getTime() : Number.NaN
}

/** Cytoscape's `preset` layout `positions` callback for the time-order layout. */
export function timeOrderNodePosition(node: NodeSingular): { x: number; y: number } {
  const cy = node.cy()
  const nodes = cy.nodes()
  const timedNodes = nodes.map((n) => ({ id: n.id(), time: nodeTime(n) }))
  const viewport = { width: Math.round(cy.width()), height: Math.round(cy.height()) }
  const signature = `${viewport.width}x${viewport.height}:` + timedNodes.map((n) => `${n.id}@${n.time}`).join('|')
  let entry = cache.get(cy)
  if (!entry || entry.signature !== signature) {
    entry = { signature, positions: timeOrderPositionsForViewport(timedNodes, viewport) }
    cache.set(cy, entry)
  }
  return entry.positions.get(node.id()) ?? { x: 0, y: 0 }
}
