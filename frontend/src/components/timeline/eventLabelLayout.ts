/**
 * Collision-free placement of event labels on the timeline's event track.
 *
 * Unlabelled marks read as anonymous dots, but labelling every mark turns a
 * dense track into overprinted text. So labels are placed greedily, left to
 * right, into a few rows above the track, and a label that fits
 * in no row is simply not drawn (its mark keeps its tooltip and aria-label).
 * The selected and highlighted events are placed first, in the nearest row, so
 * the marks the user is working with are always named.
 */

export type LabelAnchor = 'start' | 'middle' | 'end'

export interface EventLabelPlacement {
  /** Baseline offset from the event mark's centre (negative = above). */
  offset: number
  anchor: LabelAnchor
  /** The (possibly truncated) text to draw. */
  text: string
  /** Whether this is a priority (selected/highlighted) label. */
  emphasis: boolean
}

export interface EventLabelInput {
  id: string
  /** Inner-SVG x of the mark. */
  x: number
  description: string
  /** Selected or highlighted: always labelled, in the first row. */
  priority?: boolean
  /**
   * How much the event sets in motion. Among unprioritised events, the
   * further-reaching are labelled first, so when there is not room for every
   * name the consequential events keep theirs.
   */
  weight?: number
}

/** Font size of the main timeline's labels: the smallest size a label the user must read may take. */
export const LABEL_FONT_SIZE = 12

/** Which rows labels may take, and the font size their width is estimated at. */
export interface LabelLayoutConfig {
  /** Baseline offsets of the label rows, nearest the track first. */
  rowOffsets: readonly number[]
  fontSize: number
  /** Longest unprioritised label, in characters (default LABEL_MAX_CHARS). */
  maxChars?: number
}

/**
 * The main timeline: four rows of 12px labels. The pitch is the font plus a
 * little leading, and the first row clears the mark's 15px focus ring.
 * timelineLayout.ts reserves room above the event track for every row.
 */
export const TIMELINE_LABEL_CONFIG: LabelLayoutConfig = {
  rowOffsets: [-20, -34, -48, -62],
  fontSize: LABEL_FONT_SIZE,
  maxChars: 28,
}

/** Baseline offsets of the default layout's two rows (ActorTimeline's 10px labels). */
export const LABEL_ROW_OFFSETS = [-13, -26] as const

const DEFAULT_CONFIG: LabelLayoutConfig = { rowOffsets: LABEL_ROW_OFFSETS, fontSize: 10 }

/** Approximate advance of one character, as a share of the font size. */
const CHAR_WIDTH_EM = 0.56
/** Minimum clear space between two labels in the same row. */
const LABEL_GAP_PX = 6
/** Clear space between a leader line and a label it passes. */
const LEADER_GAP_PX = 3
/** Inset from the plot edge when a label is anchored to one side. */
const EDGE_INSET_PX = 2

export const PRIORITY_LABEL_MAX_CHARS = 32
export const LABEL_MAX_CHARS = 18

/**
 * Shorten to at most `maxChars`, ending on a whole word where one ends late
 * enough ("Babbage completes the Analytical…", not "Babbage completes the…"
 * cut mid-word). A word break earlier than two thirds of the way in would
 * throw away too much, so then the cut is mid-word.
 */
export function truncateLabel(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const room = text.slice(0, maxChars - 1)
  const lastSpace = room.lastIndexOf(' ')
  const cut = lastSpace >= Math.floor((maxChars * 2) / 3) ? room.slice(0, lastSpace) : room
  return `${cut.replace(/[\s,;:.\u2013\u2014-]+$/, '')}…`
}

function estimateWidth(text: string, fontSize: number): number {
  return text.length * fontSize * CHAR_WIDTH_EM
}

type Extent = { left: number; right: number; anchor: LabelAnchor }

/** Horizontal extent and anchor of a label centred on x, kept inside [0, innerWidth]. */
function extentFor(x: number, width: number, innerWidth: number): Extent {
  if (x - width / 2 < 0) {
    const left = Math.max(0, x - EDGE_INSET_PX)
    return { left, right: left + width, anchor: 'start' }
  }
  if (x + width / 2 > innerWidth) {
    const right = Math.min(innerWidth, x + EDGE_INSET_PX)
    return { left: right - width, right, anchor: 'end' }
  }
  return { left: x - width / 2, right: x + width / 2, anchor: 'middle' }
}

/**
 * Where a label may sit relative to its mark, best first: centred over it,
 * then starting at it (running right), then ending at it (running left). The
 * mark's x is inside every extent, so a leader from the mark always meets it.
 */
function extentsFor(x: number, width: number, innerWidth: number): Extent[] {
  const centred = extentFor(x, width, innerWidth)
  if (centred.anchor !== 'middle') return [centred]
  const extents: Extent[] = [centred]
  if (x - EDGE_INSET_PX + width <= innerWidth) {
    extents.push({ left: x - EDGE_INSET_PX, right: x - EDGE_INSET_PX + width, anchor: 'start' })
  }
  if (x + EDGE_INSET_PX - width >= 0) {
    extents.push({ left: x + EDGE_INSET_PX - width, right: x + EDGE_INSET_PX, anchor: 'end' })
  }
  return extents
}

function overlaps(intervals: Array<[number, number]>, left: number, right: number): boolean {
  return intervals.some(([l, r]) => left < r + LABEL_GAP_PX && right + LABEL_GAP_PX > l)
}

/**
 * Decide which events get a label, in which row, and how it is anchored.
 * Events outside [0, innerWidth] are ignored.
 */
export function layoutEventLabels(
  items: EventLabelInput[],
  innerWidth: number,
  config: LabelLayoutConfig = DEFAULT_CONFIG
): Map<string, EventLabelPlacement> {
  const placements = new Map<string, EventLabelPlacement>()
  const { rowOffsets, fontSize } = config
  const rows: Array<Array<[number, number]>> = rowOffsets.map(() => [])
  // A label above the first row hangs from a hairline leader down to its mark
  // (Timeline draws them). The leader crosses every nearer row at the mark's
  // x, so those rows record it; clean placements keep labels off it.
  const leaders: number[][] = rowOffsets.map(() => [])
  const inView = items.filter((item) => item.x >= 0 && item.x <= innerWidth)

  /**
   * Try every row and side for the label. With `clean`, a placement whose
   * leader would pass behind a nearer label (or a label sitting over another
   * mark's leader) is refused. Labels are drawn over a knockout halo above all
   * leaders, so a crossing stays legible; it is just the second choice.
   */
  const tryPlace = (item: EventLabelInput, text: string, width: number, rowIndices: number[], clean: boolean) => {
    const extents = extentsFor(item.x, width, innerWidth)
    for (const rowIndex of rowIndices) {
      const row = rows[rowIndex]
      const offset = rowOffsets[rowIndex]
      if (!row || offset === undefined) continue
      if (clean) {
        let blocked = false
        for (let nearer = 0; nearer < rowIndex; nearer++) {
          if (rows[nearer]?.some(([l, r]) => item.x > l - LEADER_GAP_PX && item.x < r + LEADER_GAP_PX)) {
            blocked = true
            break
          }
        }
        if (blocked) continue
      }
      for (const { left, right, anchor } of extents) {
        if (overlaps(row, left, right)) continue
        if (clean && leaders[rowIndex]?.some((lx) => lx > left - LEADER_GAP_PX && lx < right + LEADER_GAP_PX)) continue
        row.push([left, right])
        for (let nearer = 0; nearer < rowIndex; nearer++) leaders[nearer]?.push(item.x)
        placements.set(item.id, { offset, anchor, text, emphasis: Boolean(item.priority) })
        return true
      }
    }
    return false
  }

  const place = (item: EventLabelInput, maxChars: number, rowIndices: number[]) => {
    const text = truncateLabel(item.description, maxChars)
    const width = estimateWidth(text, fontSize)
    if (width > innerWidth) return
    if (!tryPlace(item, text, width, rowIndices, true)) tryPlace(item, text, width, rowIndices, false)
  }

  const allRows = rowOffsets.map((_, i) => i)

  // Priority labels claim space first. The first goes in row 0 unconditionally
  // in practice (the rows are empty); later ones take whichever row is free.
  for (const item of inView.filter((i) => i.priority)) {
    place(item, PRIORITY_LABEL_MAX_CHARS, allRows)
  }

  // Further-reaching events first; equal weight (or none) left to right, which
  // packs the most labels into the rows.
  const rest = inView
    .filter((i) => !i.priority)
    .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0) || a.x - b.x)
  for (const item of rest) {
    place(item, config.maxChars ?? LABEL_MAX_CHARS, allRows)
  }

  return placements
}
