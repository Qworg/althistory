/**
 * Collision-free placement of event labels on the timeline's event track.
 *
 * Unlabelled marks read as anonymous dots, but labelling every mark turns a
 * dense track into overprinted text. So labels are placed greedily, left to
 * right, into a few rows above the track, and a label that fits
 * in no row is simply not drawn (its mark keeps its tooltip and aria-label).
 * Where causal links hang under the track, its rows under the track are used
 * too, once the rows above are full, and never over a link.
 *
 * The layout is a function of the marks' positions and weights alone. The
 * main timeline gives it no `priority`, so selecting or highlighting an event
 * never re-packs the rows: a label stays where it was, and the selection is
 * shown by styling it. (`priority` remains for a caller whose priority does
 * not change with the user's selection, such as the comparison's point of
 * divergence.)
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
  /**
   * Under the track, set beside its mark rather than over it (so its text
   * clears the stem and the link that leaves it): the mark joins it by a short
   * dash at the label's baseline.
   */
  beside?: boolean
  /** With `beside`: where the text is anchored, in px from the mark's x (the label's start or end). */
  dx?: number
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
  /**
   * Where a row has room, a label may run to this many characters before it
   * is shortened to `maxChars` (and then to LABEL_MAX_CHARS) to fit.
   */
  fullChars?: number
  /** Pack at `maxChars` first, then lengthen names toward `fullChars` where their row has room. */
  lengthen?: boolean
  /**
   * Rows under the track, nearest first, for a label with no room in the rows
   * above. Each has x spans where something else is drawn (the causal links'
   * curves): a label never covers one, so a link wins over a label. A label
   * takes a row under the track only after every row above is full, and is
   * not shortened to do it.
   */
  belowRows?: ReadonlyArray<{ offset: number; blocked: ReadonlyArray<readonly [number, number]> }>
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
  fullChars: 44,
  lengthen: true,
}

/**
 * Baseline offsets of the main timeline's rows under the track, from the
 * event mark's centre. The stem ends 20px down, so the first row hangs just
 * below it and the second reaches up to it with a leader.
 */
export const TIMELINE_BELOW_ROW_OFFSETS = [34, 48] as const

/** Baseline offsets of the default layout's two rows (ActorTimeline's 10px labels). */
export const LABEL_ROW_OFFSETS = [-13, -26] as const

const DEFAULT_CONFIG: LabelLayoutConfig = { rowOffsets: LABEL_ROW_OFFSETS, fontSize: 10 }

/** Approximate advance of one character, as a share of the font size. */
const CHAR_WIDTH_EM = 0.56
/** Minimum clear space between two labels in the same row. */
const LABEL_GAP_PX = 6
/** Clear space between a leader line and a label it passes. */
const LEADER_GAP_PX = 3
/** How far beside its mark a label under the track starts, clearing the stem and the link's padding. */
export const BESIDE_PX = 8
/** The clear space between a link's blocked span and a title set beside it. */
const BESIDE_GAP_PX = 2
/** The furthest a title set beside its mark may start from it: its own link's first stretch and a little more. */
export const BESIDE_MAX_PX = 18
/** Inset from the plot edge when a label is anchored to one side. */
const EDGE_INSET_PX = 2

export const PRIORITY_LABEL_MAX_CHARS = 32
/** A selected or highlighted event's label where its row has room for more. */
export const PRIORITY_LABEL_FULL_CHARS = 60
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

type Extent = { left: number; right: number; anchor: LabelAnchor; beside?: boolean }

/** Horizontal extent and anchor of a label centred on x, kept inside [0, innerWidth]. */
export function extentFor(x: number, width: number, innerWidth: number): Extent {
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
export function extentsFor(
  x: number,
  width: number,
  innerWidth: number,
  under?: { blocked: ReadonlyArray<readonly [number, number]>; marks: readonly number[] }
): Extent[] {
  const centred = extentFor(x, width, innerWidth)
  if (centred.anchor !== 'middle') return [centred]
  const extents: Extent[] = [centred]
  if (x - EDGE_INSET_PX + width <= innerWidth) {
    extents.push({ left: x - EDGE_INSET_PX, right: x - EDGE_INSET_PX + width, anchor: 'start' })
  }
  if (x + EDGE_INSET_PX - width >= 0) {
    extents.push({ left: x + EDGE_INSET_PX - width, right: x + EDGE_INSET_PX, anchor: 'end' })
  }
  // Under the track a linked mark's link leaves it straight down, so every
  // extent holding its x is crossed: beside it, clear of the stem and of its
  // own link's first stretch (the blocked span around x), is where its title
  // can go. It must start right next to its mark (within BESIDE_MAX_PX), and
  // the dash that joins them must not pass another mark: a title that would
  // have to sit further off, or across another mark, goes unnamed here.
  if (under) {
    const own = under.blocked.find(([l, r]) => x >= l && x <= r)
    const from = own ? own[1] + BESIDE_GAP_PX : x + BESIDE_PX
    const to = own ? own[0] - BESIDE_GAP_PX : x - BESIDE_PX
    const clearOf = (a: number, b: number) => !under.marks.some((mark) => Math.abs(mark - x) >= 1 && mark > Math.min(a, b) - 1 && mark < Math.max(a, b) + 1)
    if (from - x <= BESIDE_MAX_PX && from + width <= innerWidth && clearOf(x, from)) extents.push({ left: from, right: from + width, anchor: 'start', beside: true })
    if (x - to <= BESIDE_MAX_PX && to - width >= 0 && clearOf(to, x)) extents.push({ left: to - width, right: to, anchor: 'end', beside: true })
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
  // The rows above the track, then the rows under it (nearest first in each).
  const below = config.belowRows ?? []
  const offsets = [...rowOffsets, ...below.map((row) => row.offset)]
  // x spans something else is drawn over (a link's curve), per row: never covered.
  const blockedSpans = [...rowOffsets.map(() => [] as ReadonlyArray<readonly [number, number]>), ...below.map((row) => row.blocked)]
  // The rows nearer the track than a row, on its side of it: a leader from a
  // mark to a label in the row crosses every one of them.
  const nearerRows = offsets.map((_, index) => {
    const first = index < rowOffsets.length ? 0 : rowOffsets.length
    return Array.from({ length: index - first }, (_x, i) => first + i)
  })
  const rows: Array<Array<[number, number]>> = offsets.map(() => [])
  // A label above the first row hangs from a hairline leader down to its mark
  // (Timeline draws them), as one under the track's first row does from the
  // stem's end. The leader crosses every nearer row at the mark's
  // x, so those rows record it; clean placements keep labels off it.
  const leaders: number[][] = offsets.map(() => [])
  /** Where each label went, so a second pass can lengthen it in place. */
  const placedAt = new Map<string, { rowIndex: number; interval: [number, number]; anchor: LabelAnchor; item: EventLabelInput }>()
  const inView = items.filter((item) => item.x >= 0 && item.x <= innerWidth)
  const markXs = inView.map((item) => item.x)

  /**
   * Try every row and side for the label. With `clean`, a placement whose
   * leader would pass behind a nearer label (or a label sitting over another
   * mark's leader) is refused. Labels are drawn over a knockout halo above all
   * leaders, so a crossing stays legible; it is just the second choice.
   */
  const tryPlace = (item: EventLabelInput, text: string, width: number, rowIndices: number[], clean: boolean) => {
    for (const rowIndex of rowIndices) {
            const extents = extentsFor(item.x, width, innerWidth, rowIndex >= rowOffsets.length ? { blocked: blockedSpans[rowIndex] ?? [], marks: markXs } : undefined)
      const row = rows[rowIndex]
      const offset = offsets[rowIndex]
      if (!row || offset === undefined) continue
      const nearer = nearerRows[rowIndex] ?? []
      if (clean && nearer.some((index) => rows[index]?.some(([l, r]) => item.x > l - LEADER_GAP_PX && item.x < r + LEADER_GAP_PX))) continue
      for (const { left, right, anchor, beside } of extents) {
        if (overlaps(row, left, right)) continue
        // Never over a link's curve, clean or not: the label goes elsewhere.
        if (blockedSpans[rowIndex]?.some(([l, r]) => left < r && right > l)) continue
        if (clean && leaders[rowIndex]?.some((lx) => lx > left - LEADER_GAP_PX && lx < right + LEADER_GAP_PX)) continue
        const interval: [number, number] = [left, right]
        row.push(interval)
        for (const index of nearer) leaders[index]?.push(item.x)
        placements.set(item.id, { offset, anchor, text, emphasis: Boolean(item.priority), ...(beside ? { beside, dx: (anchor === 'start' ? left : right) - item.x } : {}) })
        placedAt.set(item.id, { rowIndex, interval, anchor, item })
        return true
      }
    }
    return false
  }

  /**
   * Place the longest version of the label that fits: the whole description
   * (up to `longest` characters) where its row has room, shortened step by
   * step only where it would collide. Cutting every label to one length
   * truncated names that had the space to be read in full.
   */
  const place = (item: EventLabelInput, lengths: readonly number[], rowIndices: number[]) => {
    // Under the track a title has only the gap between the links that leave
    // the marks on either side, so there the lengths between the usual steps
    // are tried too (two characters apart): a name as long as its gap allows,
    // not cut to the next step down.
    const underTrack = rowIndices.filter((index) => index >= rowOffsets.length)
    const steps = lengths.map((chars) => ({ chars, rows: rowIndices }))
    if (underTrack.length > 0 && lengths.length > 0) {
      for (let chars = Math.max(...lengths) - 1; chars > Math.min(...lengths); chars--) {
        if (!lengths.includes(chars) && (Math.max(...lengths) - chars) % 2 === 0) steps.push({ chars, rows: underTrack })
      }
      steps.sort((a, b) => b.chars - a.chars)
    }
    let lastText = ''
    for (const { chars, rows: stepRows } of steps) {
      const text = truncateLabel(item.description, chars)
      if (stepRows === rowIndices) {
        if (text === lastText) continue
        lastText = text
      }
      const width = estimateWidth(text, fontSize)
      if (width > innerWidth) continue
      if (tryPlace(item, text, width, stepRows, true)) return
    }
    // Nothing fits cleanly: the shortest version, allowed across a leader.
    const width = estimateWidth(lastText, fontSize)
    if (width <= innerWidth) tryPlace(item, lastText, width, rowIndices, false)
  }

  const allRows = offsets.map((_, i) => i)

  // Priority labels claim space first. The first goes in row 0 unconditionally
  // in practice (the rows are empty); later ones take whichever row is free.
  for (const item of inView.filter((i) => i.priority)) {
    place(item, [PRIORITY_LABEL_FULL_CHARS, PRIORITY_LABEL_MAX_CHARS], allRows)
  }

  // Further-reaching events first; equal weight (or none) left to right, which
  // packs the most labels into the rows.
  const rest = inView
    .filter((i) => !i.priority)
    .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0) || a.x - b.x)
  // With `lengthen`, a first pass names as many events as the shorter lengths
  // allow (long titles must not take room another event's name could have),
  // and a second lengthens each name in place where its row has room.
  const restLengths = [config.lengthen ? undefined : config.fullChars, config.maxChars ?? LABEL_MAX_CHARS, LABEL_MAX_CHARS]
    .filter((n): n is number => n !== undefined)
    .filter((n, i, all) => all.indexOf(n) === i)
    .sort((a, b) => b - a)
  for (const item of rest) {
    place(item, restLengths, allRows)
  }

  if (config.lengthen && config.fullChars !== undefined) {
    // Every length from the full one down, two characters apart: a name takes
    // the longest its row has room for.
    const longer: number[] = []
    for (let chars = config.fullChars; chars > LABEL_MAX_CHARS; chars -= 2) longer.push(chars)
    for (const item of rest) {
      const at = placedAt.get(item.id)
      const current = placements.get(item.id)
      if (!at || !current) continue
      const row = rows[at.rowIndex]!
      const others = row.filter((interval) => interval !== at.interval)
      for (const maxChars of longer) {
        const text = truncateLabel(item.description, maxChars)
        if (text.length <= current.text.length) break
        const width = estimateWidth(text, fontSize)
        const [left0, right0] = at.interval
        const left = at.anchor === 'start' ? left0 : at.anchor === 'end' ? right0 - width : item.x - width / 2
        const right = left + width
        if (left < 0 || right > innerWidth) continue
        if (overlaps(others, left, right)) continue
        if (blockedSpans[at.rowIndex]?.some(([l, r]) => left < r && right > l)) continue
        if (leaders[at.rowIndex]?.some((lx) => lx > left - LEADER_GAP_PX && lx < right + LEADER_GAP_PX)) continue
        at.interval[0] = left
        at.interval[1] = right
        placements.set(item.id, { ...current, text })
        break
      }
    }
  }

  return placements
}
