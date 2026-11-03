import { isTypingTarget } from './keyboardShortcuts'
import React from 'react'
import type { LayoutOptions as CytoscapeLayoutOptions } from 'cytoscape'

/**
 * A bag of Cytoscape layout options.
 *
 * Cytoscape's own `LayoutOptions` is a large discriminated union keyed on
 * `name`, and these helpers deliberately return *partial* bags (the defaults are
 * merged with caller-supplied overrides, and several entries are explicitly
 * `undefined` so Cytoscape picks its own value). Modelling that as
 * `Record<string, unknown>` keeps the merges honest and assignable, where the
 * union would force a cast at every call site.
 */
export type LayoutOptions = Record<string, unknown>

/**
 * Bridge a partial `LayoutOptions` bag to Cytoscape's own `LayoutOptions`.
 *
 * Cytoscape types `Core#layout()` as taking a discriminated union of *complete*
 * layout option sets, which these bags deliberately are not. Keeping the single
 * documented widening here means call sites stay cast-free and the mismatch is
 * stated in exactly one place.
 */
export function toCytoscapeLayoutOptions(options: LayoutOptions): CytoscapeLayoutOptions {
  // Every node draws its label (the event's short description) below it, up
  // to 120px wide. Cytoscape sizes nodes without their labels unless told
  // otherwise, so the layouts packed nodes by the 30-60px circle alone and
  // neighbouring labels
  // overlapped. Counting the label makes every layout leave room for it; a
  // caller can still opt out by passing the option explicitly.
  return { nodeDimensionsIncludeLabels: true, ...options } as unknown as CytoscapeLayoutOptions
}

export interface LayoutConfig {
  name: string
  label: string
  description: string
  category: 'force' | 'hierarchical' | 'circular' | 'grid'
  shortcutKey?: string | null
  icon?: React.ReactNode
  options: LayoutOptions
}

/**
 * Keyboard shortcut mapping for layout types
 */
export const LAYOUT_SHORTCUTS: Record<string, string> = {
  '1': 'cose',
  '2': 'breadthfirst',
  '3': 'circle',
  '4': 'grid',
  '5': 'concentric',
  '6': 'dagre',
  '7': 'cose-bilkent',
  '8': 'random'
}

/**
 * The layouts the layout panel always shows, in order. These are the ones that
 * read a causal graph best: force-directed for clusters, and the two layered
 * layouts for cause-before-effect flow. The rest stay one click away under
 * "More layouts" (and on their number keys).
 */
export const PRIMARY_LAYOUT_NAMES: readonly string[] = ['cose', 'breadthfirst', 'dagre']

/** Whether a layout is shown without opening "More layouts". */
export function isPrimaryLayout(layoutName: string): boolean {
  return PRIMARY_LAYOUT_NAMES.includes(layoutName)
}

/**
 * Action shortcuts for quick actions
 */
export const ACTION_SHORTCUTS: Record<string, string> = {
  f: 'fit',
  r: 'reset'
}

/**
 * Get layout name from keyboard shortcut
 */
export function getLayoutFromShortcut(key: string): string | null {
  return LAYOUT_SHORTCUTS[key] ?? null
}

/**
 * Get the keyboard shortcut for a layout
 */
export function getShortcutForLayout(layoutName: string): string | null {
  const entry = Object.entries(LAYOUT_SHORTCUTS).find(([, name]) => name === layoutName)
  return entry ? entry[0] : null
}

/**
 * Check if a key is an action shortcut
 */
export function isActionShortcut(key: string): boolean {
  return key.toLowerCase() in ACTION_SHORTCUTS
}

/**
 * Get the action name from shortcut key
 */
export function getActionFromShortcut(key: string): string | null {
  return ACTION_SHORTCUTS[key.toLowerCase()] ?? null
}

/**
 * Check if keyboard shortcut should be ignored (input focused)
 */
export function shouldIgnoreKeyboardShortcut(): boolean {
  return isTypingTarget(document.activeElement)
}

/**
 * Group layouts by their category
 */
export function getLayoutsByCategory(layouts: LayoutConfig[]): Record<string, LayoutConfig[]> {
  return layouts.reduce(
    (acc, layout) => {
      if (!acc[layout.category]) {
        acc[layout.category] = []
      }
      acc[layout.category]!.push(layout)
      return acc
    },
    {} as Record<string, LayoutConfig[]>
  )
}

/**
 * Category display labels
 */
export const CATEGORY_LABELS: Record<string, string> = {
  force: 'Force-Based',
  hierarchical: 'Hierarchical',
  circular: 'Circular',
  grid: 'Grid-Based'
}

/**
 * Get display label for a category
 */
export function getCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category
}

/**
 * Padding, in px, between the graph and the canvas edge when it is fitted.
 * Kept small: on a 400px-tall canvas 50px each side gave a quarter of the
 * height to margin.
 */
export const FIT_PADDING = 30

/**
 * Default layout options for each layout type -- the one source the canvas,
 * the layout panel and the keyboard shortcuts all start from.
 *
 * The force layouts are tuned to spread a graph out rather than pack it: the
 * old cose settings (gravity 80, 100px edges) pulled every component into a
 * tight ball that, once fitted, filled the canvas height and ~40% of its
 * width. Lower gravity, longer ideal edges, matching repulsion and wider
 * spacing between disconnected components let it breathe, and the canvas
 * then stretches the result to its own aspect (see canvasStretch).
 */
export const DEFAULT_LAYOUT_OPTIONS: Record<string, LayoutOptions> = {
  cose: {
    name: 'cose',
    animationDuration: 1000,
    fit: true,
    padding: FIT_PADDING,
    nodeRepulsion: 1000000,
    nodeOverlap: 20,
    idealEdgeLength: 160,
    edgeElasticity: 100,
    nestingFactor: 5,
    gravity: 0.25,
    componentSpacing: 120,
    numIter: 1500,
    initialTemp: 200,
    coolingFactor: 0.95,
    minTemp: 1.0,
    randomize: false
  },
  'cose-bilkent': {
    name: 'cose-bilkent',
    animationDuration: 1000,
    fit: true,
    padding: FIT_PADDING,
    nodeRepulsion: 12000,
    idealEdgeLength: 120,
    edgeElasticity: 0.45,
    nestingFactor: 0.1,
    gravity: 0.15,
    numIter: 2500,
    tile: true,
    tilingPaddingVertical: 40,
    tilingPaddingHorizontal: 60,
    gravityRangeCompound: 1.5,
    gravityCompound: 1.0,
    gravityRange: 3.8,
    initialEnergyOnIncremental: 0.5
  },
  breadthfirst: {
    name: 'breadthfirst',
    animationDuration: 1000,
    fit: true,
    padding: FIT_PADDING,
    directed: true,
    spacingFactor: 1.75,
    avoidOverlap: true,
    maximal: false,
    grid: false
  },
  dagre: {
    name: 'dagre',
    animationDuration: 1000,
    fit: true,
    padding: FIT_PADDING,
    rankDir: 'TB',
    ranker: 'network-simplex',
    nodeSep: 70,
    edgeSep: 10,
    rankSep: 90
  },
  circle: {
    name: 'circle',
    animationDuration: 1000,
    fit: true,
    padding: FIT_PADDING,
    avoidOverlap: true,
    radius: undefined,
    startAngle: -Math.PI / 2,
    sweep: 2 * Math.PI,
    clockwise: true,
    sort: undefined,
    animate: true
  },
  concentric: {
    name: 'concentric',
    animationDuration: 1000,
    fit: true,
    padding: FIT_PADDING,
    avoidOverlap: true,
    spacingFactor: 1.75,
    radius: undefined,
    startAngle: -Math.PI / 2,
    sweep: 2 * Math.PI,
    clockwise: true,
    equidistant: false,
    minNodeSpacing: 10
  },
  grid: {
    name: 'grid',
    animationDuration: 1000,
    fit: true,
    padding: FIT_PADDING,
    avoidOverlap: true,
    avoidOverlapPadding: 10,
    spacingFactor: 1.75,
    condense: false,
    rows: undefined,
    cols: undefined,
    animate: true
  },
  random: {
    name: 'random',
    animationDuration: 1000,
    fit: true,
    padding: FIT_PADDING,
    animate: true
  }
}

/**
 * Layouts whose result has no meaningful shape of its own, so the canvas may
 * stretch it to its aspect. Layered, circular and grid layouts keep theirs.
 */
export const CANVAS_STRETCH_LAYOUTS: readonly string[] = ['cose', 'cose-bilkent']

/** The most a layout is stretched along one axis to meet the canvas aspect. */
export const MAX_CANVAS_STRETCH = 2.5

/**
 * How far to stretch a laid-out graph so that, fitted, it fills the canvas.
 *
 * A force layout settles into a roughly round cloud; fitted into a wide
 * canvas it fills the height and leaves the sides empty. Scaling the node
 * positions (never shrinking, only spreading, so nothing new overlaps) along
 * the short axis until the cloud has the canvas's aspect lets the fit use the
 * whole canvas. Capped at MAX_CANVAS_STRETCH so a single chain does not
 * become a line of distant dots. `bounds` is the box of the node positions;
 * `canvas` the canvas size less its fit padding.
 */
export function canvasStretch(
  bounds: { w: number; h: number },
  canvas: { width: number; height: number },
  max: number = MAX_CANVAS_STRETCH
): { sx: number; sy: number } {
  const none = { sx: 1, sy: 1 }
  const valid = (n: number) => Number.isFinite(n) && n > 0
  if (!valid(canvas.width) || !valid(canvas.height)) return none
  // A single node, or every node on one line, has no aspect to correct
  if (!valid(bounds.w) || !valid(bounds.h)) return none
  const target = canvas.width / canvas.height
  const current = bounds.w / bounds.h
  if (current < target) return { sx: Math.min(max, target / current), sy: 1 }
  if (current > target) return { sx: 1, sy: Math.min(max, current / target) }
  return none
}

/**
 * Get default options for a layout type
 */
export function getDefaultLayoutOptions(layoutName: string): LayoutOptions {
  return DEFAULT_LAYOUT_OPTIONS[layoutName] ?? { name: layoutName }
}

/**
 * Merge custom options with default options for a layout
 */
export function mergeLayoutOptions(
  layoutName: string,
  customOptions?: LayoutOptions
): LayoutOptions {
  const defaults = getDefaultLayoutOptions(layoutName)
  return { ...defaults, ...customOptions }
}

/**
 * Get preview-optimized layout options (faster animation, no fit)
 */
export function getPreviewLayoutOptions(layoutName: string): LayoutOptions {
  const defaults = getDefaultLayoutOptions(layoutName)
  return {
    ...defaults,
    animationDuration: 300,
    fit: false
  }
}

/**
 * Layout timeout constant in milliseconds
 */
export const LAYOUT_TIMEOUT_MS = 30000

/**
 * Preview timeout constant in milliseconds
 */
export const PREVIEW_TIMEOUT_MS = 2000

/**
 * Default zoom level
 */
export const DEFAULT_ZOOM = 1

/**
 * Check if a layout name is valid
 */
export function isValidLayoutName(layoutName: string): boolean {
  return layoutName in DEFAULT_LAYOUT_OPTIONS
}

/**
 * Get all available layout names
 */
export function getAvailableLayoutNames(): string[] {
  return Object.keys(DEFAULT_LAYOUT_OPTIONS)
}
