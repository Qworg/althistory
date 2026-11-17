/**
 * Where the selected event's name goes on the main timeline when the label
 * layout had no room for it: the rows above the track, a plate-only row above
 * the top label row, and (only where the sheet below does not cover them) the
 * rows under the track. Under the track the plate must not cover what is
 * drawn there: another mark's stem, or a link's curve. First every link is an
 * obstacle; failing that only the selection's own trace (its links, and the
 * small loops of simultaneous events) is, so another link may be covered
 * locally and the selection's own never is. See pinnedLabel.ts for the rest.
 */

import { PLATE_ASCENT, PLATE_DESCENT, PLATE_ONLY_ASCENT, PLATE_ONLY_DESCENT, planPinnedText, type PinnedPlan, type PlacedLabelBox } from './pinnedLabel'
import { linkSpansInBands } from './timelineLinks'

export interface PlateLink {
  id: string
  /** Where the link leaves its cause and lands on its effect, in the plot's x. */
  x1: number
  x2: number
  /** Whether it is part of the selection's trace. */
  traced: boolean
}

export interface SelectionPlateInput {
  x: number
  selectedId: string
  markY: number
  innerWidth: number
  /** The label rows above the track, nearest first. */
  aboveRows: readonly number[]
  /** Rows above the label rows, for a plate only. */
  plateOnlyRows: readonly number[]
  /** Rows under the track. */
  belowRows: readonly number[]
  /** The depth of the link band under the track, or null when there are no links. */
  linkBandHeight: number | null
  /** How far a mark's stem reaches under it. */
  stemLength: number
  labels: readonly PlacedLabelBox[]
  /**
   * Obstacles the first pass respects and the fallback does not (a narrow arc
   * bar a plate would be mistaken for the label of): better a plate over a
   * sliver's edge than an unnamed selection.
   */
  softObstacles?: readonly PlacedLabelBox[]
  /** Every mark in view: its stem is an obstacle under the track. */
  marks: ReadonlyArray<{ id: string; x: number }>
  links: readonly PlateLink[]
  texts: ReadonlyArray<{ text: string; width: number }>
  /** Try the rows above the track alone first (a docked sheet covers the rows under it). */
  preferAbove?: boolean
}

export function planSelectionPlate(input: SelectionPlateInput): { text: string; plan: PinnedPlan } | null {
  const { x, selectedId, markY, innerWidth, aboveRows, plateOnlyRows, belowRows, linkBandHeight, stemLength, labels, softObstacles = [], marks, links, texts, preferAbove = false } = input
  const above = [...aboveRows, ...plateOnlyRows]
  const obstacles = (subset: readonly PlateLink[]): PlacedLabelBox[] => {
    const boxes: PlacedLabelBox[] = []
    for (const mark of marks) {
      if (mark.id === selectedId) continue
      boxes.push({ id: `stem:${mark.id}`, left: mark.x - 1, right: mark.x + 1, top: markY, bottom: markY + stemLength, length: 0, protectedLabel: true, obstacle: true })
    }
    if (linkBandHeight !== null) {
      const bands = belowRows.map((offset): [number, number] => [offset - PLATE_ASCENT - stemLength, offset + PLATE_DESCENT - stemLength])
      const isTraced = (link: PlateLink) => link.traced || Math.abs(link.x2 - link.x1) < 2
      for (const traced of [true, false]) {
        const spans = linkSpansInBands(subset.filter((link) => isTraced(link) === traced), linkBandHeight, innerWidth, bands, 2)
        belowRows.forEach((offset, i) => {
          for (const [a, b] of spans[i] ?? []) {
            boxes.push({
              id: `link:${traced ? 't' : 'u'}:${i}:${a}`,
              left: a,
              right: b,
              top: markY + offset - PLATE_ASCENT + 0.01,
              bottom: markY + offset + PLATE_DESCENT - 0.01,
              length: 0,
              protectedLabel: true,
              obstacle: true,
              traced,
            })
          }
        })
      }
    }
    return boxes
  }
  const plateBox = (offset: number) => (plateOnlyRows.includes(offset) ? { ascent: PLATE_ONLY_ASCENT, descent: PLATE_ONLY_DESCENT } : { ascent: PLATE_ASCENT, descent: PLATE_DESCENT })
  const attempt = (rows: readonly number[]) => {
    // Every pass that hides no label comes before any that may: covering a sliver arc's edge, or an untraced link, is better than hiding a neighbour.
    const passes = [
      [...labels, ...softObstacles, ...obstacles(links)],
      [...labels, ...obstacles(links)],
      [...labels, ...obstacles(links.filter((link) => link.traced || Math.abs(link.x2 - link.x1) < 2))],
    ]
    for (const allowHide of [false, true]) {
      for (const pass of passes) {
        const found = planPinnedText({ x, markY, innerWidth, rows, labels: pass, plateBox }, texts, allowHide)
        if (found) return found
      }
    }
    return null
  }
  if (preferAbove) {
    const found = attempt(above)
    if (found) return found
  }
  return attempt([...above, ...belowRows])
}
