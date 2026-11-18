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
 * - the plate's own leader may pass behind a label (it is drawn beneath the
 *   labels, which carry a card-coloured halo), so it hides nothing.
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
  /**
   * Not a label but something else drawn there (a link's curve, another mark's
   * stem): never covered, and not counted among the labels the plate's leader
   * passes behind.
   */
  obstacle?: boolean
  /** An obstacle that is part of the selection's own trace (its links and loops): a plate's leader passing through it is ranked down. */
  traced?: boolean
  /**
   * Where the text's measured ink reaches, top and bottom (absolute y). A plate in a row it may not grow in is shortened, or its text
   * lifted, so as not to cover the ink of a label beside it, and a plate grown for accents does not grow over the ink above it.
   * It changes nothing about where a plate is placed, or what it hides.
   */
  inkTop?: number
  inkBottom?: number
  /** The vertical hairline that joins it to its mark (it goes when the label does). */
  leader?: { x: number; top: number; bottom: number }
}

export interface PinnedPlan {
  /** Baseline offset from the mark's y. */
  offset: number
  anchor: 'start' | 'middle' | 'end'
  left: number
  right: number
  /** How far the plate reaches above and below its baseline. */
  ascent: number
  descent: number
  /** Labels the plate hides entirely. */
  hidden: string[]
  /** How many kept labels the plate's leader passes behind (each is a halo that breaks it). */
  crossings: number
  /** How many pieces of the selection's own trace the plate's leader runs through. */
  tracedHits: number
  /** The size the text is drawn at where it is not the usual one (an accented name in the plate-only row is drawn smaller to fit). */
  fontSize?: number
  /** How far the text's baseline is raised above the row's, so that a plate shortened at the bottom (see `PlacedLabelBox.inkTop`) still holds it. */
  lift?: number
}

/** The plate reaches this far above its baseline and below it (14px in all, the pitch of the label rows, so it never touches the rows beside it), and past the text on each side. */
export const PLATE_ASCENT = 10.5
export const PLATE_DESCENT = 3.5
/** The plate-only row's plate is 12px tall (9 above its baseline, 3 below): it fits between the lowest arc bar's foot and the top label row's text. */
export const PLATE_ONLY_ASCENT = 9
export const PLATE_ONLY_DESCENT = 3
export const PLATE_PAD = 3
/** The smallest the text of a plate is drawn, to fit the plate-only row's 12px plate: below 10px it stops being easy to read. */
export const PLATE_MIN_FONT_SIZE = 10
/**
 * How far a glyph may reach past a plate's edge and still count as inside it:
 * the plate's 1px stroke is centred on its edge, so its inner half is under the ink.
 */
export const PLATE_INK_SLACK = 0.5
/** The share of a label a plate covers before the label is hidden rather than refused. */
const HIDE_SHARE = 0.5

function overlapArea(a: { left: number; right: number; top: number; bottom: number }, b: { left: number; right: number; top: number; bottom: number }): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left)
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
  return w > 0 && h > 0 ? w * h : 0
}

/** The ink a text reaches above and below its baseline. */
export interface PlateInk {
  ascent: number
  descent: number
}

/** A name set at a size: its measured width and ink. */
export interface PlateSize {
  fontSize: number
  width: number
  ink: PlateInk
}

/** A name the plate may carry: its measured width, and the ink it reaches above and below its baseline. */
export interface PlateText {
  text: string
  width: number
  ink?: PlateInk
  /** The same name at smaller sizes, largest first, for a row whose plate cannot hold the ink at the usual size (see `plateBox`). */
  sizes?: ReadonlyArray<PlateSize>
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
  /**
   * The plate's reach above and below its baseline in a row (default: PLATE_ASCENT and PLATE_DESCENT). A `fixed` row cannot
   * grow (the plate-only row is squeezed between an arc bar and the top label row): text whose measured ink does not fit
   * it is drawn at the largest of its `sizes` that does (the smallest if none), and is never moved to another row for it.
   * In any other row the plate is drawn taller to hold the ink.
   */
  plateBox?: (offset: number) => { ascent: number; descent: number; fixed?: boolean }
  /** The text's measured ink above and below its baseline (a capital with an accent rises above the font's ascenders). */
  ink?: PlateInk
  /** The text at smaller sizes (see `plateBox`). */
  sizes?: ReadonlyArray<PlateSize>
  /**
   * The last resort: a label the plate touches, or whose leader runs through
   * it, is hidden whole (with its leader) however little the plate covers it,
   * unless it is protected. Without it, such a placement is refused.
   */
  relaxed?: boolean
}

export function planPinnedLabel(input: PinnedInput): PinnedPlan | null {
  const { x, markY, width, innerWidth, rows, labels, relaxed = false, plateBox, ink, sizes } = input
  let best: { plan: PinnedPlan; hidden: number; text: number } | null = null
  for (const offset of rows) {
    const row = plateBox?.(offset) ?? { ascent: PLATE_ASCENT, descent: PLATE_DESCENT }
    const { ascent, descent } = row
    // The name at each size it may be drawn at, the usual one first. In a row that cannot grow, the text is set smaller until its ink
    // fits (it stays at the smallest size if none does).
    const ladder: Array<{ fontSize?: number; width: number; ink?: PlateInk }> = [{ width, ink }, ...(ink ? (sizes ?? []) : [])]
    const fits = (i: PlateInk | undefined) => !i || (i.ascent <= row.ascent + PLATE_INK_SLACK && i.descent <= row.descent + PLATE_INK_SLACK)
    const start = row.fixed ? Math.max(0, ladder.findIndex((entry) => fits(entry.ink)) === -1 ? ladder.length - 1 : ladder.findIndex((entry) => fits(entry.ink))) : 0
    for (const extent of extentsFor(x, ladder[start]!.width, innerWidth)) {
      const plate = {
        left: extent.left - PLATE_PAD,
        right: extent.right + PLATE_PAD,
        top: markY + offset - ascent,
        bottom: markY + offset + descent,
      }
      const hidden: PlacedLabelBox[] = []
      /** Hide a label whole (relaxed only, never a protected one): false when it cannot be. */
      const hide = (label: PlacedLabelBox): boolean => {
        if (!relaxed || label.protectedLabel) return false
        if (!hidden.includes(label)) hidden.push(label)
        return true
      }
      let allowed = true
      for (const label of labels) {
        const covered = overlapArea(plate, label)
        if (covered === 0) continue
        const share = covered / Math.max(1, (label.right - label.left) * (label.bottom - label.top))
        if (!label.protectedLabel && share >= HIDE_SHARE) hidden.push(label)
        else if (!hide(label)) {
          allowed = false
          break
        }
      }
      if (!allowed) continue
      // A kept label's leader through the plate would look like the plate's own
      // (the plate would seem joined to another mark): refused like a covered label.
      for (const label of labels) {
        const leader = label.leader
        if (!leader || hidden.includes(label)) continue
        if (leader.x >= plate.left && leader.x <= plate.right && leader.bottom > plate.top && leader.top < plate.bottom && !hide(label)) {
          allowed = false
          break
        }
      }
      if (!allowed) continue
      // The leader runs from the plate to its mark's edge: count the kept labels it passes behind.
      const [from, to] = offset < 0 ? [plate.bottom, markY - 8] : [markY + 8, plate.top]
      const tracedHits = labels.filter(
        (label) => label.traced && x >= label.left - 1 && x <= label.right + 1 && label.bottom > Math.min(from, to) && label.top < Math.max(from, to)
      ).length
      const crossings = labels.filter(
        (label) =>
          !label.obstacle && !hidden.includes(label) && x >= label.left - 2 && x <= label.right + 2 && label.bottom > Math.min(from, to) && label.top < Math.max(from, to)
      ).length
      // Fewest labels hidden, then the fewest the leader passes behind, then the least text; the nearest row and centred extent on a tie.
      const text = hidden.reduce((sum, label) => sum + label.length, 0)
      const better =
        !best ||
        hidden.length < best.hidden ||
        (hidden.length === best.hidden &&
          (tracedHits < best.plan.tracedHits ||
            (tracedHits === best.plan.tracedHits && (crossings < best.plan.crossings || (crossings === best.plan.crossings && text < best.text)))))
      if (better) {
        // What is drawn. Judged by the row's own box above; here the text is fitted to what lies beside the plate.
        const y0 = markY + offset
        const beside = labels.filter((label) => !hidden.includes(label) && label.right > plate.left && label.left < plate.right)
        let k = start
        let drawnAscent = ascent
        let drawnDescent = descent
        let lift = 0
        const reach = (entry: { ink?: PlateInk }) => ({ a: entry.ink ? Math.max(ascent, entry.ink.ascent + PLATE_INK_SLACK) : ascent, d: entry.ink ? Math.max(descent, entry.ink.descent + PLATE_INK_SLACK) : descent })
        if (!row.fixed) {
          // An ordinary row's plate grows a little upward for accents; it is set smaller instead where that would cover the ink of the label above.
          const above = beside.filter((label) => label.inkBottom !== undefined && label.bottom <= plate.top + 0.01)
          const clear = (entry: { ink?: PlateInk }) => above.every((label) => label.inkBottom! <= y0 - reach(entry).a)
          k = Math.max(0, ladder.findIndex(clear) === -1 ? ladder.length - 1 : ladder.findIndex(clear))
          ;({ a: drawnAscent, d: drawnDescent } = reach(ladder[k]!))
        } else {
          // The plate-only row's plate ends at its own text's ink where a label's ink in the row below would reach under it, and the text
          // is set smaller and lifted, to meet the plate's top, where that is not enough.
          const limit = Math.min(...beside.filter((label) => label.inkTop !== undefined && label.top >= plate.top).map((label) => label.inkTop!))
          if (limit < plate.bottom) {
            const room = (entry: { ink?: PlateInk }) => {
              const d = entry.ink?.descent ?? 0
              const need = y0 + d - PLATE_INK_SLACK - limit
              const max = entry.ink ? Math.max(0, ascent + PLATE_INK_SLACK - entry.ink.ascent) : 0
              return { need: Math.max(0, need), max }
            }
            const j = ladder.findIndex((entry, i) => i >= start && room(entry).need <= room(entry).max)
            k = j === -1 ? ladder.length - 1 : j
            const { need, max } = room(ladder[k]!)
            lift = Math.min(need, max)
            drawnDescent = Math.min(descent, (ladder[k]!.ink?.descent ?? 0) - PLATE_INK_SLACK - lift)
          }
        }
        const entry = ladder[k]!
        let { left, right } = extent
        if (entry.width !== ladder[start]!.width) {
          if (extent.anchor === 'start') right = left + entry.width
          else if (extent.anchor === 'end') left = right - entry.width
          else {
            const centre = (left + right) / 2
            left = centre - entry.width / 2
            right = centre + entry.width / 2
          }
        }
        best = {
          hidden: hidden.length,
          text,
          plan: {
            offset,
            anchor: extent.anchor,
            left,
            right,
            ascent: drawnAscent,
            descent: drawnDescent,
            ...(entry.fontSize !== undefined ? { fontSize: entry.fontSize } : {}),
            ...(lift > 0 ? { lift } : {}),
            hidden: hidden.map((label) => label.id),
            crossings,
            tracedHits,
          },
        }
      }
    }
  }
  return best?.plan ?? null
}

/**
 * The best plate over several texts (the full name, then shorter forms). Of the
 * placements the ordinary rules allow, the one that hides the fewest labels
 * wins; then the one whose leader runs through the fewest pieces of the
 * selection's own trace; then the one whose leader passes behind the fewest
 * labels; then the one that hides the least text; then the longest name. Only
 * where the ordinary rules allow none does the last resort run (a plate may
 * hide a neighbour it touches, whole), ranked the same way, so that every
 * selection that can be named is.
 */
export function planPinnedText(
  input: Omit<PinnedInput, 'width' | 'relaxed' | 'ink' | 'sizes'>,
  texts: ReadonlyArray<PlateText>,
  /** Whether the last resort may run (default: it may). Without it, only the ordinary rules are tried. */
  allowHide = true
): { text: string; plan: PinnedPlan } | null {
  const lengthOf = (ids: string[]) => ids.reduce((sum, id) => sum + (input.labels.find((label) => label.id === id)?.length ?? 0), 0)
  const rank = (relaxed: boolean) => {
    let best: { text: string; plan: PinnedPlan; width: number } | null = null
    for (const { text, width, ink, sizes } of texts) {
      const plan = planPinnedLabel({ ...input, width, ink, sizes, relaxed })
      if (!plan) continue
      const better =
        !best ||
        plan.hidden.length < best.plan.hidden.length ||
        (plan.hidden.length === best.plan.hidden.length &&
          (plan.tracedHits < best.plan.tracedHits ||
            (plan.tracedHits === best.plan.tracedHits &&
              (plan.crossings < best.plan.crossings ||
                (plan.crossings === best.plan.crossings &&
                  (lengthOf(plan.hidden) < lengthOf(best.plan.hidden) || (lengthOf(plan.hidden) === lengthOf(best.plan.hidden) && width > best.width)))))))
      if (better) best = { text, plan, width }
    }
    return best ? { text: best.text, plan: best.plan } : null
  }
  return rank(false) ?? (allowHide ? rank(true) : null)
}
