/**
 * Causal links drawn on the timeline, and the ripple of a selected event.
 *
 * A link leaves the bottom of the cause's stem, dips into the link band and
 * lands on the effect's stem. The causal-order invariant (a cause is never
 * after its effect) means every link runs left to right, so the direction of
 * time is the direction of cause; the arrowhead only confirms it.
 *
 * With nothing selected every link is drawn faintly, as the weave the history
 * hangs on. Selecting an event traces its ripple: the events that caused it
 * (one step back) and everything it set in motion (up to RIPPLE_DEPTH steps
 * forward), with the rest of the canvas dimmed.
 */

export type LinkType = 'direct' | 'indirect' | 'contributory'

export interface TimelineLink {
  id: string
  causeId: string
  effectId: string
  type: LinkType
  /** 0–1. Drawn as stroke width. */
  weight: number
}

/** How far forward a selection's ripple is traced. */
export const RIPPLE_DEPTH = 3

export interface Ripple {
  /** Direct causes of the selected event. */
  causes: Set<string>
  /** Downstream events, by the step at which they are reached (1 = direct effect). */
  effects: Map<string, number>
  /** Links on the ripple: `cause` for a link into the selection, else the step of its effect. */
  links: Map<string, 'cause' | number>
}

export const EMPTY_RIPPLE: Ripple = { causes: new Set(), effects: new Map(), links: new Map() }

/** The ripple of `selectedId` through `links` (see the module comment). */
export function computeRipple(selectedId: string | null, links: readonly TimelineLink[]): Ripple {
  if (!selectedId) return EMPTY_RIPPLE
  const causes = new Set<string>()
  const effects = new Map<string, number>()
  const rippleLinks = new Map<string, 'cause' | number>()

  const outgoing = new Map<string, TimelineLink[]>()
  for (const link of links) {
    if (link.effectId === selectedId) {
      causes.add(link.causeId)
      rippleLinks.set(link.id, 'cause')
    }
    const list = outgoing.get(link.causeId)
    if (list) list.push(link)
    else outgoing.set(link.causeId, [link])
  }

  // Breadth-first, so an event reached by two paths takes its nearest step.
  let frontier = [selectedId]
  for (let step = 1; step <= RIPPLE_DEPTH && frontier.length > 0; step++) {
    const next: string[] = []
    for (const id of frontier) {
      for (const link of outgoing.get(id) ?? []) {
        if (link.effectId === selectedId) continue
        if (!rippleLinks.has(link.id)) rippleLinks.set(link.id, step)
        if (!effects.has(link.effectId)) {
          effects.set(link.effectId, step)
          next.push(link.effectId)
        }
      }
    }
    frontier = next
  }

  return { causes, effects, links: rippleLinks }
}

/** Dash pattern per link type: the legend's solid / dashed / dotted. */
export const LINK_DASH: Record<LinkType, string | undefined> = {
  direct: undefined,
  indirect: '6 4',
  contributory: '1.5 3.5',
}

/** Stroke width for a weight in [0, 1]. */
export function linkStrokeWidth(weight: number): number {
  const w = Number.isFinite(weight) ? Math.min(1, Math.max(0, weight)) : 0.5
  return 1 + w * 2.5
}

/**
 * The path of a link from x1 (cause) to x2 (effect), hanging from `top` into a
 * band `depth` deep. Longer links sag further, so links that share an end
 * fan apart instead of overprinting; a link between simultaneous events is a
 * small loop that still reads as one. The sag is measured against the plot's
 * width, so the longest possible link reaches the floor of the band at any
 * size and a narrow canvas does not leave the band empty.
 */
export function linkPath(x1: number, x2: number, top: number, depth: number, plotWidth: number): string {
  const span = Math.abs(x2 - x1)
  const reach = Math.min(1, span / Math.max(1, plotWidth))
  // How deep the link's lowest point hangs.
  const sag = Math.min(depth - 6, 10 + Math.sqrt(reach) * (depth - 16))
  if (span < 2) {
    return `M ${x1} ${top} C ${x1 - 10} ${top + 18}, ${x1 + 10} ${top + 18}, ${x2} ${top}`
  }
  // A cubic whose control points sit under each end: a level-bottomed swag.
  // Its lowest point is 3/4 of the way to the control points.
  const y = top + sag / 0.75
  return `M ${x1} ${top} C ${x1} ${y}, ${x2} ${y}, ${x2} ${top}`
}
