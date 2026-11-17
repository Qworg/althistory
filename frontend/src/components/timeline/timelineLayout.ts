/**
 * Vertical layout of the timeline canvas, top to bottom.
 *
 * The canvas used to pin the event track to the bottom of whatever height the
 * parent passed, with the arcs stacked from the top, so any height beyond the
 * content became an empty band between the two. Everything is now stacked
 * from the top instead, and the canvas is as tall as what it holds:
 *
 *   [divergence band]   only when a point of divergence is drawn
 *   arc rows            one per render level, each a 12px label over a 16px bar
 *   event label rows    up to three rows of 12px labels (eventLabelLayout.ts)
 *   event track         the marks, with their stems
 *   [link band]         only when the graph has causal links: each link is an
 *                       arc that leaves the cause's stem and lands on the
 *                       effect's, so causality reads along the time axis
 *   [baseline lane]     only when a branch's baseline is ghosted beneath it
 *   time axis           ticks and 12px tick labels in the bottom margin
 *
 * All values are inner-SVG px (from the top of the plot, inside the margin).
 */
import type { Arc } from '@/types'
import { TIMELINE_LABEL_CONFIG } from './eventLabelLayout'
import { calculateArcHierarchy, processArcsWithUIState } from './arcHierarchyUtils'

export interface TimelineMargin {
  top: number
  right: number
  bottom: number
  left: number
}

export const DEFAULT_TIMELINE_MARGIN: TimelineMargin = { top: 16, right: 16, bottom: 40, left: 56 }

/** The actor timeline's default margin. */
export const DEFAULT_ACTOR_MARGIN: TimelineMargin = { top: 20, right: 20, bottom: 60, left: 80 }

/** The most ticks the main timeline's axis draws: 12px monospace labels need about 96px each. */
export function mainAxisMaxTicks(innerWidth: number): number {
  return Math.min(10, Math.floor(innerWidth / 96))
}

/** The most ticks the actor timeline's axis asks for over a plot of `plotWidth` px (at least 2). */
export function actorAxisMaxTicks(plotWidth: number): number {
  return Math.max(2, Math.floor(Math.abs(plotWidth) / 96))
}

/** Height of an arc bar. */
export const ARC_BAR_HEIGHT = 16
/** Pitch of the arc rows: a 12px label above a 16px bar, with clear space between rows. */
export const ARC_LEVEL_HEIGHT = 34
/** Space above the first arc bar, which holds that row's label. */
export const ARC_TOP = 16
/** The band above the arcs that carries the divergence diamond and its label. */
export const DIVERGENCE_BAND_HEIGHT = 24
/** Clear space between the lowest arc bar and the top of the event labels. */
const ARC_TO_LABELS_GAP = 10
/** From the event mark's centre up to the top of its highest label row. */
const EVENT_LABEL_CLEARANCE = -Math.min(...TIMELINE_LABEL_CONFIG.rowOffsets) + TIMELINE_LABEL_CONFIG.fontSize
/** Length of the stem drawn below each event mark. */
export const EVENT_STEM_LENGTH = 20
/** From the event mark's centre to the axis when no baseline lane is drawn. */
const EVENT_TO_AXIS = 30
/** From the event mark's centre to the ghosted baseline lane. */
export const GHOST_LANE_OFFSET = 46
/** From the baseline lane to the axis. */
const GHOST_TO_AXIS = 22
/**
 * Depth of the causal-link band under the stems. Deep enough that a link
 * across the whole axis still curves clear of its neighbours, shallow enough
 * that the track, its labels and the axis stay in one glance.
 */
export const LINK_BAND_HEIGHT = 120
/** From the bottom of the link band to the baseline lane or the axis. */
const LINK_BAND_TO_NEXT = 14
/** Room for a short track with no arcs and no labels: the canvas never collapses below this. */
const MIN_INNER_HEIGHT = 96

export interface TimelineLayoutInput {
  /** The deepest arc render level drawn, or -1 when there are no arcs. */
  maxArcLevel: number
  /** Whether a ghosted baseline lane is drawn beneath the event track. */
  hasGhostLane?: boolean
  /** Whether a point of divergence is drawn (it takes a band above the arcs). */
  hasDivergence?: boolean
  /** Whether causal links are drawn (they take a band under the stems). */
  hasLinks?: boolean
  margin?: TimelineMargin
}

export interface TimelineLayout {
  /** y of the top of the level-0 arc bar. */
  arcTop: number
  /** y of the event marks' centres. */
  eventY: number
  /** y of the ghosted baseline lane, or null when there is none. */
  ghostY: number | null
  /** Top and depth of the causal-link band, or null when there is none. */
  linkBand: { top: number; height: number } | null
  /**
   * The highest a plate may reach (its top, in plot y): the clip rect's top at
   * 0, below the divergence band's labels, and where arcs are drawn, the foot of
   * the lowest arc bar (less 2px of tolerance, so a plate may touch a bar's
   * edge). A plate whose top is above it would be cut off or cover a landmark.
   */
  plateTopLimit: number
  /** y of the time axis. */
  axisY: number
  /** The plot height the content needs (axisY; the tick labels sit in the bottom margin). */
  innerHeight: number
  /** The full SVG height the content needs, margins included. */
  height: number
}

/** y of the top of the bar for an arc render level. */
export function arcRowY(level: number, arcTop: number): number {
  return arcTop + level * ARC_LEVEL_HEIGHT
}

export function computeTimelineLayout({
  maxArcLevel,
  hasGhostLane = false,
  hasDivergence = false,
  hasLinks = false,
  margin = DEFAULT_TIMELINE_MARGIN,
}: TimelineLayoutInput): TimelineLayout {
  const arcTop = (hasDivergence ? DIVERGENCE_BAND_HEIGHT : 0) + ARC_TOP
  const arcsBottom =
    maxArcLevel >= 0 ? arcRowY(maxArcLevel, arcTop) + ARC_BAR_HEIGHT + ARC_TO_LABELS_GAP : arcTop - ARC_TOP
  const eventY = arcsBottom + EVENT_LABEL_CLEARANCE
  const linkBand = hasLinks ? { top: eventY + EVENT_STEM_LENGTH, height: LINK_BAND_HEIGHT } : null
  // What sits under the track: the link band when there is one, else the stems.
  const underTrack = linkBand ? linkBand.top + linkBand.height + LINK_BAND_TO_NEXT : null
  // The lane's 12px label sits above it, so it starts a label's height down.
  const ghostY = hasGhostLane ? (underTrack !== null ? underTrack + 10 : eventY + GHOST_LANE_OFFSET) : null
  const axisY = Math.max(
    MIN_INNER_HEIGHT,
    ghostY !== null ? ghostY + GHOST_TO_AXIS : underTrack ?? eventY + EVENT_TO_AXIS
  )
  return {
    arcTop,
    eventY,
    ghostY,
    linkBand,
    plateTopLimit: Math.max(0, maxArcLevel >= 0 ? arcsBottom - ARC_TO_LABELS_GAP - PLATE_BAR_TOLERANCE : arcsBottom),
    axisY,
    innerHeight: axisY,
    height: margin.top + axisY + margin.bottom,
  }
}

/**
 * The SVG height the timeline needs for `arcs` as first drawn (every arc
 * collapsed, so only the top-level arcs and their overlap rows count).
 *
 * The parent can pass this as `height`, or omit `height` altogether: Timeline
 * always grows to fit what it draws (expanding an arc adds rows), so this is
 * the height to reserve, not a cap.
 */
export function timelineContentHeight(
  arcs: Arc[],
  options: { ghost?: boolean; divergence?: boolean; links?: boolean; margin?: TimelineMargin } = {}
): number {
  const { maxLevel } =
    arcs.length > 0
      ? calculateArcHierarchy(processArcsWithUIState(arcs, [], new Set(), new Set()))
      : { maxLevel: -1 }
  return computeTimelineLayout({
    maxArcLevel: arcs.length > 0 ? maxLevel : -1,
    hasGhostLane: options.ghost ?? false,
    hasDivergence: options.divergence ?? false,
    hasLinks: options.links ?? false,
    margin: options.margin,
  }).height
}

/**
 * The row of a plate alone, above the top label row and under the arcs: its
 * bottom just clears the top label row's text (-62 - 9.6), its top is 1.7px
 * over the lowest bar's edge. Offered only where the whole plate lies inside
 * the plot and below the arc band and the divergence band (`plateTopLimit`).
 */
/** An arc bar narrower than this is an obstacle for a plate (a plate over a sliver arc would read as its label). */
export const NARROW_ARC_PX = 120
export const PLATE_ONLY_ROWS = [-75.2] as const
/** How far a plate in the plate-only row may overlap the lowest arc bar's edge (the band under the bars holds 12.4px, a plate 14). */
export const PLATE_BAR_TOLERANCE = 2
/** Below this viewport width the inspector's sheet is docked over the bottom of the page. */
export const DOCKED_SHEET_BELOW_PX = 1024
