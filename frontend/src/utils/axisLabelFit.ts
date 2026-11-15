/**
 * Fitting an axis's tick labels into the room they have: anchoring an end
 * label inward when, centred, it would run past the plot's edge, and
 * thinning ticks whose labels would overprint. A tick set is chosen by
 * count, not by its labels' width, so a long label can be wider than the
 * step between two ticks.
 */

export type LabelAnchor = 'start' | 'middle' | 'end'

export interface LabelFit {
  /** How wide one character of the labels is, in pixels. */
  charPx: number
  /** The clear space kept between two labels. */
  gapPx: number
}

interface Placed {
  x: number
  label: string
  anchor?: LabelAnchor
}

/** The left and right edges of a label, drawn at its tick with its anchor. */
export function labelExtent(tick: Placed, charPx: number): [number, number] {
  const width = tick.label.length * charPx
  if (tick.anchor === 'start') return [tick.x, tick.x + width]
  if (tick.anchor === 'end') return [tick.x - width, tick.x]
  return [tick.x - width / 2, tick.x + width / 2]
}

/**
 * Each label centred on its tick, unless centred it would run past `left` or
 * `right` (the room the SVG gives, in the plot's coordinates, margins
 * included): then anchored inward, starting or ending at its tick.
 */
export function anchorInward<T extends Placed>(
  ticks: readonly T[],
  charPx: number,
  room: { left: number; right: number }
): Array<T & { anchor: LabelAnchor }> {
  return ticks.map((tick) => {
    const half = (tick.label.length * charPx) / 2
    const anchor: LabelAnchor = tick.x - half < room.left ? 'start' : tick.x + half > room.right ? 'end' : 'middle'
    return { ...tick, anchor }
  })
}

/** Whether two labels, drawn with their anchors, keep the gap between them. */
function fits(a: Placed, b: Placed, { charPx, gapPx }: LabelFit): boolean {
  return labelExtent(b, charPx)[0] - labelExtent(a, charPx)[1] >= gapPx
}

/**
 * The ticks whose labels fit side by side: all of them when they do;
 * otherwise a regular stride, the finest whose labels fit, so the gaps
 * between kept ticks stay even (the last tick is kept only when it falls on
 * the stride, and an end tick whose label, anchored inward, would crowd its
 * neighbour gives way rather than coarsen the stride). `mustKeep` ticks (a label that alone names the date, beside
 * bare times of day) are always kept, and the stride is counted from the
 * first of them; a stride tick that would crowd one gives way. Two ticks are
 * kept whenever two fit.
 */
export function thinTickLabels<T extends Placed>(ticks: readonly T[], fit: LabelFit, mustKeep: (tick: T) => boolean = () => false): T[] {
  if (ticks.length <= 1) return [...ticks]
  const allFit = (kept: readonly T[]) => kept.every((tick, i) => i === 0 || fits(kept[i - 1]!, tick, fit))
  if (allFit(ticks)) return [...ticks]
  const must = new Set(ticks.flatMap((tick, index) => (mustKeep(tick) ? [index] : [])))
  const origin = must.size > 0 ? Math.min(...must) : 0
  const last = ticks.length - 1
  for (let stride = 1; stride <= ticks.length; stride++) {
    const chosen = new Set(must)
    for (let index = origin % stride; index <= last; index += stride) chosen.add(index)
    let kept = [...chosen].sort((a, b) => a - b)
    // A stride tick that would crowd one that must stay gives way to it.
    kept = kept.filter((index, i) => {
      if (must.has(index)) return true
      const before = kept[i - 1]
      const after = kept[i + 1]
      return !(
        (before !== undefined && must.has(before) && !fits(ticks[before]!, ticks[index]!, fit)) ||
        (after !== undefined && must.has(after) && !fits(ticks[index]!, ticks[after]!, fit))
      )
    })
    // Two ticks whenever two fit: the last, beside a lone first.
    if (kept.length === 1 && kept[0] !== last && fits(ticks[kept[0]!]!, ticks[last]!, fit)) kept.push(last)
    const candidate = kept.map((index) => ticks[index]!)
    if (allFit(candidate)) return candidate
    // An end label anchored inward reaches further in than a centred one:
    // dropping that end, unless it must stay, keeps the stride (and the rest).
    const droppable = (index: number | undefined) => index !== undefined && !must.has(index)
    for (const [dropFirst, dropLast] of [[false, true], [true, false], [true, true]] as const) {
      if ((dropFirst && !droppable(kept[0])) || (dropLast && !droppable(kept[kept.length - 1]))) continue
      const trimmed = candidate.slice(dropFirst ? 1 : 0, dropLast ? -1 : undefined)
      if (trimmed.length >= 2 && allFit(trimmed)) return trimmed
    }
  }
  const required = [...must].sort((a, b) => a - b).map((index) => ticks[index]!)
  if (required.length > 0 && allFit(required)) return required
  return [ticks[must.size > 0 ? origin : 0]!]
}
