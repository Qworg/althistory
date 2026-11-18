/**
 * Where the selected event's name goes on the main timeline when the label
 * layout had no room for it: the rows above the track, a plate-only row above
 * the top label row, and (only where the sheet below does not cover them) the
 * rows under the track. Under the track the plate must not cover what is
 * drawn there: another mark's stem, or a link's curve. First every link is an
 * obstacle; failing that only the selection's own trace (its links, and the
 * small loops of simultaneous events) is, so another link may be covered
 * locally and the selection's own never is. See pinnedLabel.ts for the rest.
 *
 * The order of the passes, best first: (1) the full name where it covers no label, link or arc, then
 * (2) the same with the name cut short (down to MIN_PLATE_CHARS); then (3) ordinary hiding (a label the plate covers by half or more
 * is hidden whole), then (4) covering untraced links, then (5) the last resort, which hides a neighbour whole. A shorter name comes
 * before any pass that hides a neighbour or covers a link: it costs the reader the tail of a name the inspector shows in full,
 * where those cost a neighbour's name or a curve the reader is following.
 *
 * Covering an untraced link stays the last resort that still names the selection, and is accepted as such: the demo's "Clerks Prevail"
 * branch without its arcs, at 390px, selecting the Manchester clerks, has no clear spot at any length down to the minimum (the label rows
 * above are protected, the plate-only row meets the divergence diamond, and links hang under the whole track), so its plate lies over faint,
 * dimmed curves of other links. Cutting the name to eight characters finds a spot only by hiding a neighbour's name, which is worse.
 */

import { PLATE_ASCENT, PLATE_DESCENT, PLATE_ONLY_ASCENT, PLATE_ONLY_DESCENT, planPinnedText, type PinnedPlan, type PlacedLabelBox, type PlateText } from './pinnedLabel'
import { truncateLabel } from './eventLabelLayout'
import { linkSpansInBands } from './timelineLinks'

/**
 * The shortest a plate's text may be made to find a clear spot: eleven characters, the ellipsis included, so at least ten
 * of the name ("Manchester…"). That is about the first word of a name, about 65px in the 12px bold type: short enough to
 * go in the gaps between labels, and still enough to tell what the mark is. Below it a plate says less than the mark's own
 * tooltip does, and a covered link is the better price.
 */
export const MIN_PLATE_CHARS = 11
/** The longest the shortened forms start from: one under the shortest of the ordinary forms (14). */
const SHORTENED_FROM_CHARS = 13

/**
 * The shorter forms of a name the plate may take where the ordinary forms find no clear spot: every cut between 13 and 11
 * characters (word ends where the name has one, as the layout's labels do), each ending in an ellipsis, each measured so the
 * plate fits the text as drawn. Forms already among `known` are left out.
 */
export function shortenedPlateTexts(description: string, measure: (text: string) => PlateText, known: readonly string[] = []): PlateText[] {
  const seen = new Set(known)
  const found: PlateText[] = []
  for (let chars = SHORTENED_FROM_CHARS; chars >= MIN_PLATE_CHARS; chars--) {
    const text = truncateLabel(description, chars)
    if (text.length < MIN_PLATE_CHARS || text.length > chars || seen.has(text)) continue
    seen.add(text)
    found.push(measure(text))
  }
  return found
}

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
  texts: ReadonlyArray<PlateText>
  /**
   * Shorter forms of the name (see `shortenedPlateTexts`), tried only once the full forms found no spot that covers and
   * hides nothing, and before any pass that hides a label or covers a link.
   */
  shortTexts?: ReadonlyArray<PlateText>
  /** Try the rows above the track alone first (a docked sheet covers the rows under it). */
  preferAbove?: boolean
}

export function planSelectionPlate(input: SelectionPlateInput): { text: string; plan: PinnedPlan } | null {
  const { x, selectedId, markY, innerWidth, aboveRows, plateOnlyRows, belowRows, linkBandHeight, stemLength, labels, softObstacles = [], marks, links, texts, shortTexts = [], preferAbove = false } = input
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
  // The plate-only row's plate cannot grow (an arc bar's foot above it, the top label row's text below): text whose measured ink does not fit it goes in another row.
  const plateBox = (offset: number) => (plateOnlyRows.includes(offset) ? { ascent: PLATE_ONLY_ASCENT, descent: PLATE_ONLY_DESCENT, fixed: true } : { ascent: PLATE_ASCENT, descent: PLATE_DESCENT })
  const attempt = (rows: readonly number[]) => {
    // Every pass that hides no label comes before any that may: covering a sliver arc's edge, or an untraced link, is better than hiding a neighbour.
    const passes = [
      [...labels, ...softObstacles, ...obstacles(links)],
      [...labels, ...obstacles(links)],
      [...labels, ...obstacles(links.filter((link) => link.traced || Math.abs(link.x2 - link.x1) < 2))],
    ]
    // First, passes 1 and 2 (every link an obstacle) for a plate that hides nothing at all: the ordinary rules still let a plate hide a
    // label it covers by half or more, so a pass can find a plate that does while a later one finds one that does not. Pass 3 (which lets
    // a plate cover an untraced link) is not among them: links win over hiding nothing, so it comes after the ordinary hiding of pass 1.
    // Then every pass with the ordinary rules, and with the last resort.
    // The shorter forms of the name come second: a shorter name in a clear spot is better than a full one that hides a
    // neighbour's name (the selection's own is in the inspector), or covers a link (structure the reader is following).
    for (const forms of shortTexts.length ? [texts, shortTexts] : [texts]) {
      for (const pass of passes.slice(0, 2)) {
        const found = planPinnedText({ x, markY, innerWidth, rows, labels: pass, plateBox }, forms, false)
        if (found && found.plan.hidden.length === 0) return found
      }
    }
    const every = [...texts, ...shortTexts]
    for (const allowHide of [false, true]) {
      for (const pass of passes) {
        const found = planPinnedText({ x, markY, innerWidth, rows, labels: pass, plateBox }, every, allowHide)
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
