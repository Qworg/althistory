import React from 'react'

export interface LayoutConfig {
  name: string
  label: string
  description: string
  category: 'force' | 'hierarchical' | 'circular' | 'grid'
  shortcutKey?: string | null
  icon?: React.ReactNode
  options: Record<string, any>
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
  const activeElement = document.activeElement
  const tagName = activeElement?.tagName.toLowerCase()
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select'
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
 * Default layout options for each layout type
 */
export const DEFAULT_LAYOUT_OPTIONS: Record<string, Record<string, any>> = {
  cose: {
    name: 'cose',
    animationDuration: 1000,
    fit: true,
    padding: 50,
    nodeRepulsion: 400000,
    nodeOverlap: 10,
    idealEdgeLength: 100,
    edgeElasticity: 100,
    nestingFactor: 5,
    gravity: 80,
    numIter: 1000,
    initialTemp: 200,
    coolingFactor: 0.95,
    minTemp: 1.0,
    randomize: false
  },
  'cose-bilkent': {
    name: 'cose-bilkent',
    animationDuration: 1000,
    fit: true,
    padding: 50,
    nodeRepulsion: 4500,
    idealEdgeLength: 50,
    edgeElasticity: 0.45,
    nestingFactor: 0.1,
    gravity: 0.25,
    numIter: 2500,
    tile: true,
    tilingPaddingVertical: 10,
    tilingPaddingHorizontal: 10,
    gravityRangeCompound: 1.5,
    gravityCompound: 1.0,
    gravityRange: 3.8,
    initialEnergyOnIncremental: 0.5
  },
  breadthfirst: {
    name: 'breadthfirst',
    animationDuration: 1000,
    fit: true,
    padding: 50,
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
    padding: 50,
    rankDir: 'TB',
    ranker: 'network-simplex',
    nodeSep: 50,
    edgeSep: 10,
    rankSep: 50
  },
  circle: {
    name: 'circle',
    animationDuration: 1000,
    fit: true,
    padding: 50,
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
    padding: 50,
    avoidOverlap: true,
    nodeDimensionsIncludeLabels: false,
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
    padding: 50,
    avoidOverlap: true,
    avoidOverlapPadding: 10,
    nodeDimensionsIncludeLabels: false,
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
    padding: 50,
    animate: true
  }
}

/**
 * Get default options for a layout type
 */
export function getDefaultLayoutOptions(layoutName: string): Record<string, any> {
  return DEFAULT_LAYOUT_OPTIONS[layoutName] ?? { name: layoutName }
}

/**
 * Merge custom options with default options for a layout
 */
export function mergeLayoutOptions(
  layoutName: string,
  customOptions?: Record<string, any>
): Record<string, any> {
  const defaults = getDefaultLayoutOptions(layoutName)
  return { ...defaults, ...customOptions }
}

/**
 * Get preview-optimized layout options (faster animation, no fit)
 */
export function getPreviewLayoutOptions(layoutName: string): Record<string, any> {
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
 * Fit padding constant
 */
export const FIT_PADDING = 50

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
