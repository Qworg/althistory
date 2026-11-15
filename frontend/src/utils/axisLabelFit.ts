/**
 * Thinning an axis's ticks so their labels do not overprint. A tick set is
 * chosen by count, not by its labels' width, so a long label can be wider
 * than the step between two ticks.
 */

export interface LabelFit {
  /** How wide one character of the labels is, in pixels. */
  charPx: number
  /** The clear space kept between two labels. */
  gapPx: number
}

/** Whether two labels, centred on their ticks, keep the gap between them. */
function fits(a: { x: number; label: string }, b: { x: number; label: string }, { charPx, gapPx }: LabelFit): boolean {
  return b.x - a.x >= ((a.label.length + b.label.length) * charPx) / 2 + gapPx
}

/**
 * The ticks whose labels fit side by side: all of them when they do;
 * otherwise the first, the last and a regular stride between, the finest
 * stride whose labels fit. A tick on the stride that would crowd the last
 * gives way to it. Two ticks are kept whenever two fit, one only when even
 * the first and the last cannot.
 */
export function thinTickLabels<T extends { x: number; label: string }>(ticks: readonly T[], fit: LabelFit): T[] {
  if (ticks.length <= 1) return [...ticks]
  const allFit = (kept: readonly T[]) => kept.every((tick, i) => i === 0 || fits(kept[i - 1]!, tick, fit))
  const last = ticks.length - 1
  for (let stride = 1; stride <= last; stride++) {
    const kept: T[] = []
    for (let index = 0; index < last; index += stride) kept.push(ticks[index]!)
    // The last tick is always kept; a stride tick too close to it gives way.
    while (kept.length > 1 && !fits(kept[kept.length - 1]!, ticks[last]!, fit)) kept.pop()
    kept.push(ticks[last]!)
    if (allFit(kept)) return kept
  }
  return [ticks[0]!]
}
