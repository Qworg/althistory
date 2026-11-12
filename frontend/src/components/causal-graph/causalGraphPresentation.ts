import type { Event, GraphCalendar } from '@/types'
import { formatHistoricalTimestamp, historicalYear } from '@/utils/historicalTime'
import { getActiveCalendar } from '@/stores/worldCalendarStore'

/**
 * How an event reads on the causal graph.
 *
 * A node used to be labelled "actor → target", so two events between the same
 * pair were indistinguishable and the graph never said what happened. The node
 * now carries the event's own description, shortened to fit under the node;
 * the full description, the actor → target pair and the date are in the hover
 * tooltip and in what assistive technology announces.
 */

/** Longest node label, in characters, before it is cut with an ellipsis. */
export const NODE_LABEL_MAX_CHARS = 28

/** "actor → target", or whichever half is known. */
export function formatActorTarget(event: Pick<Event, 'actor' | 'target'>): string {
  const actor = event.actor?.trim()
  const target = event.target?.trim()
  if (actor && target) return `${actor} → ${target}`
  return actor || target || ''
}

/** Collapse runs of whitespace (descriptions are often pasted prose). */
function normalise(text: string | undefined | null): string {
  return (text ?? '').replace(/\s+/g, ' ').trim()
}

/** Cut `text` to `max` characters, ending in an ellipsis when it was cut. */
export function truncateLabel(text: string, max: number = NODE_LABEL_MAX_CHARS): string {
  const clean = normalise(text)
  if (clean.length <= max) return clean
  return `${clean.slice(0, Math.max(1, max - 1)).trimEnd()}…`
}

/**
 * The label drawn under an event's node: its description, shortened. An event
 * without a description falls back to its actor → target pair.
 */
export function eventNodeLabel(event: Pick<Event, 'description' | 'actor' | 'target'>): string {
  const description = normalise(event.description)
  return truncateLabel(description || formatActorTarget(event))
}

/**
 * The year an event falls in, in UTC, with BCE for years before 1 CE; in the
 * world's own years when the graph has a calendar ("312 AR").
 */
export function eventYear(timestamp: string | Date, calendar?: GraphCalendar | null): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  // In a world, the year as its calendar names it.
  const world = calendar === undefined ? getActiveCalendar() : calendar
  if (world) return historicalYear(date, world)
  const year = date.getUTCFullYear()
  // Astronomical year 0 is 1 BCE, -1 is 2 BCE, and so on.
  return year <= 0 ? `${1 - year} BCE` : String(year)
}

/**
 * The label drawn on the canvas: the year over the description. The graph is
 * laid out by cause, not by date, so without the year a node gave no hint of
 * when it happened and every reading of the graph needed a hover.
 */
export function eventNodeCanvasLabel(
  event: Pick<Event, 'description' | 'actor' | 'target' | 'timestamp'>,
  calendar?: GraphCalendar | null
): string {
  const year = eventYear(event.timestamp, calendar)
  const label = eventNodeLabel(event)
  return year ? `${year}\n${label}` : label
}

/**
 * One sentence that says everything the node stands for: what happened, who
 * acted on whom, and when (in UTC, as all historical dates are).
 */
export function describeEvent(
  event: Pick<Event, 'description' | 'actor' | 'target' | 'timestamp'>,
  calendar?: GraphCalendar | null
): string {
  const parts = [normalise(event.description), formatActorTarget(event), formatHistoricalTimestamp(event.timestamp, undefined, calendar)]
  return parts.filter(Boolean).join('. ')
}

/**
 * The colours the Cytoscape canvas draws with.
 *
 * Cytoscape paints to a <canvas> and cannot read CSS custom properties, so the
 * theme is resolved here into concrete values: text from the ink/surface
 * tokens, and every node and edge colour from a palette per theme mode
 * (light, dark, and the high-contrast variant of each). Each palette colour
 * can also be supplied as a `--graph-*` custom property on <html> (e.g.
 * `--graph-edge-direct`), which wins over the built-in value.
 *
 * Every colour that identifies a node, an edge or a state is at least 3:1
 * against the canvas and card surfaces it is drawn on (WCAG 1.4.11), and at
 * least 4.5:1 in high contrast; causalGraphTheme.contrast.test.ts measures
 * them against the surface tokens parsed from src/index.css. The light and
 * dark palettes reuse the accent tokens where one exists (direct links are
 * --accent-baseline, selection --accent-selected, contributory links
 * --text-muted), and that test also fails if those drift apart.
 */
export type GraphThemeMode = 'light' | 'dark' | 'high-contrast-light' | 'high-contrast-dark'

export interface GraphPalette {
  /** An event. */
  nodeFill: string
  nodeBorder: string
  /** The selected event. */
  selectedFill: string
  selectedBorder: string
  /**
   * The hovered event, and the events of a highlighted path: the node's own
   * fill with the selection accent as its ring (and a halo, in the
   * stylesheet), so hover stays on the token palette. It was an off-palette
   * rose, a colour that meant nothing anywhere else.
   */
  highlightedFill: string
  highlightedBorder: string
  /** The cause picked while drawing a link. */
  linkSourceFill: string
  linkSourceBorder: string
  /** A placeholder for an event in another graph (or a broken reference). */
  foreignFill: string
  foreignBorder: string
  /** A point of divergence (also drawn as a diamond). */
  divergenceFill: string
  divergenceBorder: string
  /**
   * An event that cannot be the effect of the picked cause. Deliberately
   * dimmed: it is inactive, which WCAG 1.4.11 exempts from the 3:1 floor.
   */
  inactiveFill: string
  inactiveBorder: string
  /** Links, by relationship type (each also has its own line style). */
  edgeDirect: string
  edgeIndirect: string
  edgeContributory: string
  /** A link to or from another graph. */
  edgeCrossGraph: string
  edgeSelected: string
  edgeHighlighted: string
  /** Path exploration: the current step, the steps passed, the steps ahead. */
  pathCurrent: string
  pathVisited: string
  pathUnvisited: string
  /** Suggested links, by confidence (>= 0.8, >= 0.6, >= 0.4, below). */
  suggestionHigh: string
  suggestionMedium: string
  suggestionLow: string
  suggestionMinimal: string
}

export interface GraphCanvasTheme {
  mode: GraphThemeMode
  /** Label text: the theme's primary ink. */
  ink: string
  /** Edge-label text. */
  inkSecondary: string
  /** The pill behind a label: the card surface the canvas sits on. */
  surface: string
  /** Hairline around edge labels. */
  line: string
  /** The interface's sans-serif stack. */
  fontFamily: string
  /** Node and edge colours. */
  colors: GraphPalette
}

const LIGHT_PALETTE: GraphPalette = {
  nodeFill: '#2563eb',
  nodeBorder: '#1e3a8a',
  selectedFill: '#4f46e5',
  selectedBorder: '#312e81',
  highlightedFill: '#2563eb',
  highlightedBorder: '#4f46e5',
  linkSourceFill: '#7c3aed',
  linkSourceBorder: '#4c1d95',
  foreignFill: '#7c3aed',
  foreignBorder: '#4c1d95',
  divergenceFill: '#c2410c',
  divergenceBorder: '#7c2d12',
  inactiveFill: '#9ca3af',
  inactiveBorder: '#6b7280',
  edgeDirect: '#1d4ed8',
  edgeIndirect: '#0f766e',
  edgeContributory: '#5d697c',
  edgeCrossGraph: '#7c3aed',
  edgeSelected: '#4f46e5',
  edgeHighlighted: '#4f46e5',
  pathCurrent: '#b91c1c',
  pathVisited: '#047857',
  pathUnvisited: '#6b7280',
  suggestionHigh: '#047857',
  suggestionMedium: '#b45309',
  suggestionLow: '#b91c1c',
  suggestionMinimal: '#6b7280'
}

const DARK_PALETTE: GraphPalette = {
  nodeFill: '#3b82f6',
  nodeBorder: '#93c5fd',
  selectedFill: '#818cf8',
  selectedBorder: '#e0e7ff',
  highlightedFill: '#3b82f6',
  highlightedBorder: '#818cf8',
  linkSourceFill: '#a78bfa',
  linkSourceBorder: '#ede9fe',
  foreignFill: '#a78bfa',
  foreignBorder: '#ddd6fe',
  divergenceFill: '#fb923c',
  divergenceBorder: '#ffedd5',
  inactiveFill: '#475569',
  inactiveBorder: '#64748b',
  edgeDirect: '#60a5fa',
  edgeIndirect: '#2dd4bf',
  edgeContributory: '#94a3b8',
  edgeCrossGraph: '#c4b5fd',
  edgeSelected: '#818cf8',
  edgeHighlighted: '#818cf8',
  pathCurrent: '#f87171',
  pathVisited: '#34d399',
  pathUnvisited: '#94a3b8',
  suggestionHigh: '#34d399',
  suggestionMedium: '#fbbf24',
  suggestionLow: '#f87171',
  suggestionMinimal: '#94a3b8'
}

const HIGH_CONTRAST_LIGHT_PALETTE: GraphPalette = {
  nodeFill: '#1e40af',
  nodeBorder: '#000000',
  selectedFill: '#3730a3',
  selectedBorder: '#000000',
  highlightedFill: '#1e40af',
  highlightedBorder: '#3730a3',
  linkSourceFill: '#5b21b6',
  linkSourceBorder: '#000000',
  foreignFill: '#5b21b6',
  foreignBorder: '#000000',
  divergenceFill: '#9a3412',
  divergenceBorder: '#000000',
  inactiveFill: '#9ca3af',
  inactiveBorder: '#4b5563',
  edgeDirect: '#1e3a8a',
  edgeIndirect: '#115e59',
  edgeContributory: '#111827',
  edgeCrossGraph: '#5b21b6',
  edgeSelected: '#3730a3',
  edgeHighlighted: '#3730a3',
  pathCurrent: '#991b1b',
  pathVisited: '#065f46',
  pathUnvisited: '#374151',
  suggestionHigh: '#065f46',
  suggestionMedium: '#92400e',
  suggestionLow: '#991b1b',
  suggestionMinimal: '#374151'
}

const HIGH_CONTRAST_DARK_PALETTE: GraphPalette = {
  nodeFill: '#93c5fd',
  nodeBorder: '#ffffff',
  selectedFill: '#c7d2fe',
  selectedBorder: '#ffffff',
  highlightedFill: '#93c5fd',
  highlightedBorder: '#c7d2fe',
  linkSourceFill: '#c4b5fd',
  linkSourceBorder: '#ffffff',
  foreignFill: '#c4b5fd',
  foreignBorder: '#ffffff',
  divergenceFill: '#fdba74',
  divergenceBorder: '#ffffff',
  inactiveFill: '#475569',
  inactiveBorder: '#94a3b8',
  edgeDirect: '#93c5fd',
  edgeIndirect: '#5eead4',
  edgeContributory: '#e2e8f0',
  edgeCrossGraph: '#ddd6fe',
  edgeSelected: '#c7d2fe',
  edgeHighlighted: '#c7d2fe',
  pathCurrent: '#fca5a5',
  pathVisited: '#6ee7b7',
  pathUnvisited: '#cbd5e1',
  suggestionHigh: '#6ee7b7',
  suggestionMedium: '#fcd34d',
  suggestionLow: '#fca5a5',
  suggestionMinimal: '#cbd5e1'
}

/** The built-in palette for each theme mode. */
export const GRAPH_PALETTES: Record<GraphThemeMode, GraphPalette> = {
  light: LIGHT_PALETTE,
  dark: DARK_PALETTE,
  'high-contrast-light': HIGH_CONTRAST_LIGHT_PALETTE,
  'high-contrast-dark': HIGH_CONTRAST_DARK_PALETTE
}

const FONT_SANS = "'IBM Plex Sans', 'Source Sans 3', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"

/** Text fallbacks per mode: the tokens of src/index.css, for when no stylesheet is loaded. */
const TEXT_FALLBACKS: Record<GraphThemeMode, Pick<GraphCanvasTheme, 'ink' | 'inkSecondary' | 'surface' | 'line'>> = {
  light: { ink: '#18181b', inkSecondary: '#475569', surface: '#ffffff', line: '#e2dfd7' },
  dark: { ink: '#f8fafc', inkSecondary: '#cbd5e1', surface: '#162036', line: '#2c3a55' },
  'high-contrast-light': { ink: '#000000', inkSecondary: '#000000', surface: '#ffffff', line: '#000000' },
  'high-contrast-dark': { ink: '#ffffff', inkSecondary: '#ffffff', surface: '#162036', line: '#e2e8f0' }
}

export const LIGHT_GRAPH_THEME: GraphCanvasTheme = {
  mode: 'light',
  ...TEXT_FALLBACKS.light,
  fontFamily: FONT_SANS,
  colors: LIGHT_PALETTE
}

/** Which palette the classes on <html> call for (.dark, .high-contrast). */
export function graphThemeMode(root: Element | null = typeof document === 'undefined' ? null : document.documentElement): GraphThemeMode {
  const classes = root?.classList
  const dark = Boolean(classes?.contains('dark'))
  const highContrast = Boolean(classes?.contains('high-contrast'))
  if (highContrast) return dark ? 'high-contrast-dark' : 'high-contrast-light'
  return dark ? 'dark' : 'light'
}

/** `nodeFill` -> `--graph-node-fill`: the custom property that can override a palette colour. */
export function graphTokenName(key: keyof GraphPalette): string {
  return `--graph-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`
}

/** Resolve the current theme from <html>: its mode classes and its tokens. */
export function readGraphCanvasTheme(): GraphCanvasTheme {
  if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') {
    return LIGHT_GRAPH_THEME
  }
  const root = document.documentElement
  const mode = graphThemeMode(root)
  const text = TEXT_FALLBACKS[mode]
  const palette = GRAPH_PALETTES[mode]
  const styles = window.getComputedStyle(root)
  const read = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback
  const colors = { ...palette }
  for (const key of Object.keys(palette) as (keyof GraphPalette)[]) {
    colors[key] = read(graphTokenName(key), palette[key])
  }
  return {
    mode,
    ink: read('--text-primary', text.ink),
    inkSecondary: read('--text-secondary', text.inkSecondary),
    surface: read('--surface-card', text.surface),
    line: read('--border-subtle', text.line),
    fontFamily: read('--font-sans', FONT_SANS),
    colors
  }
}

/** Whether the theme is one of the high-contrast modes. */
export function isHighContrastTheme(theme: Pick<GraphCanvasTheme, 'mode'>): boolean {
  return theme.mode === 'high-contrast-light' || theme.mode === 'high-contrast-dark'
}

/**
 * How each relationship type is drawn. The type is never carried by colour
 * alone: each has its own line style too, and the canvas legend names both.
 * `dash` is the Cytoscape `line-dash-pattern` (and the legend's SVG
 * stroke-dasharray); contributory links are round-capped dots.
 */
export const RELATIONSHIP_LINE_STYLES = {
  direct: { label: 'Direct', pattern: 'solid', lineStyle: 'solid', dash: null, cap: 'butt', paletteKey: 'edgeDirect' },
  indirect: { label: 'Indirect', pattern: 'dashed', lineStyle: 'dashed', dash: [10, 6], cap: 'butt', paletteKey: 'edgeIndirect' },
  contributory: { label: 'Contributory', pattern: 'dotted', lineStyle: 'dashed', dash: [1, 9], cap: 'round', paletteKey: 'edgeContributory' }
} as const satisfies Record<string, {
  label: string
  /** What the legend calls the line. */
  pattern: 'solid' | 'dashed' | 'dotted'
  lineStyle: 'solid' | 'dashed'
  dash: readonly number[] | null
  cap: 'butt' | 'round'
  paletteKey: keyof GraphPalette
}>

export type RelationshipLineType = keyof typeof RELATIONSHIP_LINE_STYLES

/** Node labels are drawn at this size (model px; scaled by the zoom). */
export const NODE_LABEL_FONT_SIZE = 12

/**
 * Below this on-screen size Cytoscape skips drawing a label at all. Zoomed far
 * out, a label would otherwise shrink to a few unreadable pixels; hiding it
 * leaves the shape of the graph legible, and zooming in brings the labels back.
 */
export const MIN_ZOOMED_FONT_SIZE = 8

/** On-screen label size the graph holds across ordinary zoom levels. */
const LABEL_SCREEN_PX = 11.5
/** Labels never grow past this in model px (so zooming in still enlarges them sensibly). */
const LABEL_MAX_MODEL_PX = 26
/** Label wrap width, on screen. */
const LABEL_SCREEN_WRAP_PX = 110

/**
 * Node-label sizing for a zoom level. A fixed model font made labels vanish at
 * the zoom a graph is first fitted at (12px x 0.45 zoom < MIN_ZOOMED_FONT_SIZE),
 * so every node was anonymous on first view. Instead the model size is scaled
 * against the zoom so the label holds ~11.5px on screen; it is clamped to
 * [NODE_LABEL_FONT_SIZE, LABEL_MAX_MODEL_PX], so zooming in past 1:1 still
 * enlarges labels, and zooming far out still shrinks them below
 * MIN_ZOOMED_FONT_SIZE, where Cytoscape stops drawing them (nodes are too
 * close together there for labels to be anything but overprint).
 */
export function nodeLabelSizing(zoom: number): { 'font-size': string; 'text-max-width': string } {
  const z = zoom > 0 && Number.isFinite(zoom) ? zoom : 1
  const fontPx = Math.max(NODE_LABEL_FONT_SIZE, Math.min(LABEL_MAX_MODEL_PX, LABEL_SCREEN_PX / z))
  const wrapPx = Math.max(120, Math.min(260, LABEL_SCREEN_WRAP_PX / z))
  return { 'font-size': `${fontPx.toFixed(2)}px`, 'text-max-width': `${wrapPx.toFixed(0)}px` }
}

export interface LabelBox {
  id: string
  /** Higher wins a contested spot (the selected node, then the most connected). */
  priority: number
  /** The label's box in model coordinates. */
  box: { x1: number; y1: number; x2: number; y2: number }
}

/**
 * Which node labels to draw so that none overprints another. Greedy, highest
 * priority first (ties broken by id, so the result is stable): a label is kept
 * only if its box, grown by `gap`, overlaps no label already kept. A label
 * with an empty box (nothing to draw) is kept. This is the causal graph's
 * counterpart of the timeline's eventLabelLayout: a hidden label's node still
 * has its tooltip, and hovering or selecting it reveals the label.
 */
export function pickVisibleLabels(
  items: LabelBox[],
  gap = 2,
  /**
   * Node bodies, by node id. A label drawn over another node hides that node,
   * so it counts as a collision too; a label may of course cover its own node.
   */
  obstacles: Array<{ id: string; box: LabelBox['box'] }> = []
): Set<string> {
  const ordered = [...items].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
  const kept: LabelBox['box'][] = []
  const overlaps = (a: LabelBox['box'], b: LabelBox['box']) =>
    a.x1 - gap < b.x2 && a.x2 + gap > b.x1 && a.y1 - gap < b.y2 && a.y2 + gap > b.y1
  const visible = new Set<string>()
  // A node's body blocks lower-ranked labels only: the highest-ranked label in
  // a crowded spot is still drawn, and the ones under it give way.
  const labelled = new Set(items.map((item) => item.id))
  const placed = new Set<string>()
  for (const item of ordered) {
    placed.add(item.id)
    const { x1, y1, x2, y2 } = item.box
    if (!(x2 > x1 && y2 > y1)) {
      visible.add(item.id)
      continue
    }
    const collides =
      kept.some((k) => overlaps(item.box, k)) ||
      obstacles.some(
        (o) => o.id !== item.id && (placed.has(o.id) || !labelled.has(o.id)) && overlaps(item.box, o.box)
      )
    if (collides) continue
    kept.push(item.box)
    visible.add(item.id)
  }
  return visible
}

/** Inset of the hover readout from the canvas edge (px). */
const READOUT_INSET = 12
/** Clearance under the canvas's top-right tool buttons (px). */
const READOUT_TOOLBAR_CLEARANCE = 56

/**
 * Where a hover readout sits on the causal canvas: in the corner diagonally
 * opposite the hovered node or link.
 *
 * Opened beside the pointer, the readout covered the labels of the
 * neighbouring nodes, which are what one reads while hovering. A node can be
 * anywhere on a free-form graph, so there is no side of it that is reliably
 * clear; the far corner is. The hovered element stays highlighted on the
 * canvas, so the readout and its node read as one.
 */
export function hoverReadoutPlacement(
  point: { x: number; y: number },
  canvas: { width: number; height: number }
): { left?: number; right?: number; top: number; transform?: string } {
  const onLeft = point.x < canvas.width / 2
  const onTop = point.y < canvas.height / 2
  const horizontal = onLeft ? { right: READOUT_INSET } : { left: READOUT_INSET }
  if (onTop) {
    return { ...horizontal, top: canvas.height - READOUT_INSET, transform: 'translateY(-100%)' }
  }
  return { ...horizontal, top: onLeft ? READOUT_TOOLBAR_CLEARANCE : READOUT_INSET }
}
