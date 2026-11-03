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
/** Room for a short track with no arcs and no labels: the canvas never collapses below this. */
const MIN_INNER_HEIGHT = 96

export interface TimelineLayoutInput {
  /** The deepest arc render level drawn, or -1 when there are no arcs. */
  maxArcLevel: number
  /** Whether a ghosted baseline lane is drawn beneath the event track. */
  hasGhostLane?: boolean
  /** Whether a point of divergence is drawn (it takes a band above the arcs). */
  hasDivergence?: boolean
  margin?: TimelineMargin
}

export interface TimelineLayout {
  /** y of the top of the level-0 arc bar. */
  arcTop: number
  /** y of the event marks' centres. */
  eventY: number
  /** y of the ghosted baseline lane, or null when there is none. */
  ghostY: number | null
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
  margin = DEFAULT_TIMELINE_MARGIN,
}: TimelineLayoutInput): TimelineLayout {
  const arcTop = (hasDivergence ? DIVERGENCE_BAND_HEIGHT : 0) + ARC_TOP
  const arcsBottom =
    maxArcLevel >= 0 ? arcRowY(maxArcLevel, arcTop) + ARC_BAR_HEIGHT + ARC_TO_LABELS_GAP : arcTop - ARC_TOP
  const eventY = arcsBottom + EVENT_LABEL_CLEARANCE
  const ghostY = hasGhostLane ? eventY + GHOST_LANE_OFFSET : null
  const axisY = Math.max(MIN_INNER_HEIGHT, ghostY !== null ? ghostY + GHOST_TO_AXIS : eventY + EVENT_TO_AXIS)
  return {
    arcTop,
    eventY,
    ghostY,
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
  options: { ghost?: boolean; divergence?: boolean; margin?: TimelineMargin } = {}
): number {
  const { maxLevel } =
    arcs.length > 0
      ? calculateArcHierarchy(processArcsWithUIState(arcs, [], new Set(), new Set()))
      : { maxLevel: -1 }
  return computeTimelineLayout({
    maxArcLevel: arcs.length > 0 ? maxLevel : -1,
    hasGhostLane: options.ghost ?? false,
    hasDivergence: options.divergence ?? false,
    margin: options.margin,
  }).height
}
