/**
 * Where the selected event's name goes when the label layout had no room for
 * it. The name is drawn on a plate over the marks, and the labels already
 * placed are not moved. So the plate must go where it hides as little as
 * possible, and what it hides it hides whole:
 *
 * - a label the plate would cover by about half or more is hidden entirely
 *   (a half-covered label reads as a fragment of another name);
 * - a label it would cover by less than that is not covered at all, so the
 *   placement is refused;
 * - protected labels (the selection's own in-place label, the highlighted and
 *   traced events') are never covered;
 * - the leader from the plate to its mark crosses no label that stays.
 *
 * Every row and every extent (centred, starting at the mark, ending at it) is
 * tried; the one that hides the least text wins, the nearest row and the
 * centred extent on a tie. None allowed: no plate.
 */

import { extentsFor } from './eventLabelLayout'

export interface PlacedLabelBox {
  id: string
  left: number
  right: number
  top: number
  bottom: number
  /** Never covered, whatever the plate would gain. */
  protectedLabel?: boolean
  /** How much text it would take with it if hidden. */
  length: number
  /** The vertical hairline that joins it to its mark (it goes when the label does). */
  leader?: { x: number; top: number; bottom: number }
}

export interface PinnedPlan {
  /** Baseline offset from the mark's y. */
  offset: number
  anchor: 'start' | 'middle' | 'end'
  left: number
  right: number
  /** Labels the plate hides entirely. */
  hidden: string[]
}

/** The plate reaches this far above its baseline and below it (14px in all, the pitch of the label rows, so it never touches the rows beside it), and past the text on each side. */
export const PLATE_ASCENT = 10.5
export const PLATE_DESCENT = 3.5
export const PLATE_PAD = 3
/** The share of a label a plate covers before the label is hidden rather than refused. */
const HIDE_SHARE = 0.5

function overlapArea(a: { left: number; right: number; top: number; bottom: number }, b: { left: number; right: number; top: number; bottom: number }): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left)
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
  return w > 0 && h > 0 ? w * h : 0
}

export interface PinnedInput {
  x: number
  markY: number
  /** The text's measured width. */
  width: number
  innerWidth: number
  /** Baseline offsets to try, nearest the mark first. */
  rows: readonly number[]
  labels: readonly PlacedLabelBox[]
  /** The mark's radius, so the leader stops at its edge. */
  markRadius?: number
}

export function planPinnedLabel(input: PinnedInput): PinnedPlan | null {
  const { x, markY, width, innerWidth, rows, labels, markRadius = 8 } = input
  let best: { plan: PinnedPlan; cost: number } | null = null
  for (const offset of rows) {
    for (const extent of extentsFor(x, width, innerWidth)) {
      const plate = {
        left: extent.left - PLATE_PAD,
        right: extent.right + PLATE_PAD,
        top: markY + offset - PLATE_ASCENT,
        bottom: markY + offset + PLATE_DESCENT,
      }
      const hidden: PlacedLabelBox[] = []
      let allowed = true
      for (const label of labels) {
        const covered = overlapArea(plate, label)
        if (covered === 0) continue
        const share = covered / Math.max(1, (label.right - label.left) * (label.bottom - label.top))
        if (label.protectedLabel || share < HIDE_SHARE) {
          allowed = false
          break
        }
        hidden.push(label)
      }
      if (!allowed) continue
      // A kept label's leader through the plate would look like the plate's own
      // (the plate would seem joined to another mark): refused like a covered label.
      const leaderThrough = labels.some(
        (label) =>
          label.leader !== undefined &&
          !hidden.includes(label) &&
          label.leader.x >= plate.left &&
          label.leader.x <= plate.right &&
          label.leader.bottom > plate.top &&
          label.leader.top < plate.bottom
      )
      if (leaderThrough) continue
      // The leader: straight along the mark's x between the plate and the mark.
      const [from, to] = offset < 0 ? [plate.bottom, markY - markRadius] : [markY + markRadius, plate.top]
      const crossed = labels.some(
        (label) =>
          !hidden.includes(label) && x >= label.left - 2 && x <= label.right + 2 && label.bottom > Math.min(from, to) && label.top < Math.max(from, to)
      )
      if (crossed) continue
      const cost = hidden.reduce((sum, label) => sum + label.length, 0)
      if (!best || cost < best.cost) {
        best = { cost, plan: { offset, anchor: extent.anchor, left: extent.left, right: extent.right, hidden: hidden.map((label) => label.id) } }
      }
    }
  }
  return best?.plan ?? null
}

/**
 * The first of several texts (the full name, then shorter forms) for which a
 * plate fits, with its plan: where the whole name has no room, a shorter one
 * may.
 */
export function planPinnedText(
  input: Omit<PinnedInput, 'width'>,
  texts: ReadonlyArray<{ text: string; width: number }>
): { text: string; plan: PinnedPlan } | null {
  for (const { text, width } of texts) {
    const plan = planPinnedLabel({ ...input, width })
    if (plan) return { text, plan }
  }
  return null
}
