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
  rowOffsets: [-18, -32, -46, -60],
  fontSize: LABEL_FONT_SIZE,
  maxChars: 22,
}

/** Baseline offsets of the default layout's two rows (ActorTimeline's 10px labels). */
export const LABEL_ROW_OFFSETS = [-13, -26] as const

const DEFAULT_CONFIG: LabelLayoutConfig = { rowOffsets: LABEL_ROW_OFFSETS, fontSize: 10 }

/** Approximate advance of one character, as a share of the font size. */
const CHAR_WIDTH_EM = 0.56
/** Minimum clear space between two labels in the same row. */
const LABEL_GAP_PX = 6
/** Inset from the plot edge when a label is anchored to one side. */
const EDGE_INSET_PX = 2

export const PRIORITY_LABEL_MAX_CHARS = 24
export const LABEL_MAX_CHARS = 18

export function truncateLabel(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text
}

function estimateWidth(text: string, fontSize: number): number {
  return text.length * fontSize * CHAR_WIDTH_EM
}

/** Horizontal extent and anchor of a label centred on x, kept inside [0, innerWidth]. */
function extentFor(x: number, width: number, innerWidth: number): { left: number; right: number; anchor: LabelAnchor } {
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
  const inView = items.filter((item) => item.x >= 0 && item.x <= innerWidth)

  const place = (item: EventLabelInput, maxChars: number, rowIndices: number[]) => {
    const text = truncateLabel(item.description, maxChars)
    const width = estimateWidth(text, fontSize)
    if (width > innerWidth) return
    const { left, right, anchor } = extentFor(item.x, width, innerWidth)
    for (const rowIndex of rowIndices) {
      const row = rows[rowIndex]
      const offset = rowOffsets[rowIndex]
      if (!row || offset === undefined) continue
      if (overlaps(row, left, right)) continue
      row.push([left, right])
      placements.set(item.id, { offset, anchor, text, emphasis: Boolean(item.priority) })
      return
    }
  }

  const allRows = rowOffsets.map((_, i) => i)

  // Priority labels claim space first. The first goes in row 0 unconditionally
  // in practice (the rows are empty); later ones take whichever row is free.
  for (const item of inView.filter((i) => i.priority)) {
    place(item, PRIORITY_LABEL_MAX_CHARS, allRows)
  }

  const rest = inView.filter((i) => !i.priority).sort((a, b) => a.x - b.x)
  for (const item of rest) {
    place(item, config.maxChars ?? LABEL_MAX_CHARS, allRows)
  }

  return placements
}
