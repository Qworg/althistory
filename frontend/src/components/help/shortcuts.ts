/**
 * Every keyboard shortcut the app actually handles, in one place.
 *
 * This is the data behind the "Help & reference" dialog. Each entry was taken
 * from a real handler, not from a tooltip; where the bindings already live in
 * a shared table (view switching, causal-graph layouts) the entries are derived
 * from that table so they cannot drift. ViewToolbar's tooltips are checked
 * against this list by a test in `ViewToolbar.test.tsx`.
 *
 * A combo is the list of keys pressed together, written the way the toolbar's
 * tooltips write them (`Ctrl`, `Shift`, `Alt`, a letter or a named key), so
 * `formatCombo(['Ctrl', 'Shift', 'A'])` is `Ctrl+Shift+A`.
 */
import { VIEW_SHORTCUT_CONFIGS } from '@/hooks/useViewShortcuts'
import { ACTION_SHORTCUTS, LAYOUT_SHORTCUTS } from '@/utils/layoutManagerUtils'
import type { ViewMode } from '@/types'

export type ShortcutScope =
  | 'global'
  | 'timeline'
  | 'timeline-canvas'
  | 'causal'
  | 'causal-canvas'
  | 'causal-chain'
  | 'actor'
  | 'dialogs'

export type KeyCombo = readonly string[]

export interface Shortcut {
  id: string
  scope: ShortcutScope
  /** Alternatives: any one of these combos does the same thing. */
  combos: readonly KeyCombo[]
  description: string
  /** When the shortcut applies, or a caveat about it. */
  note?: string
}

export interface ShortcutScopeInfo {
  id: ShortcutScope
  title: string
  description: string
}

/** In display order. */
export const SHORTCUT_SCOPES: readonly ShortcutScopeInfo[] = [
  {
    id: 'global',
    title: 'Anywhere',
    description: 'In every view, unless you are typing in a field.',
  },
  {
    id: 'timeline',
    title: 'Timeline view',
    description: 'While the Timeline view is open.',
  },
  {
    id: 'timeline-canvas',
    title: 'Timeline canvas',
    description: 'The timeline is one Tab stop. On the canvas the keys pan and zoom; on a focused event or arc they move between marks and act on the mark.',
  },
  {
    id: 'causal',
    title: 'Causal graph view',
    description: 'While the Causal Graph view is open.',
  },
  {
    id: 'causal-canvas',
    title: 'Causal graph canvas',
    description: 'When the graph canvas has keyboard focus.',
  },
  {
    id: 'causal-chain',
    title: 'Exploring a causal chain',
    description: 'While stepping through a causal chain in the Causal Graph view.',
  },
  {
    id: 'actor',
    title: 'Actor perspective view',
    description: 'While the Actor Perspective view is open.',
  },
  {
    id: 'dialogs',
    title: 'Menus and dialogs',
    description: 'While a menu or dialog is open.',
  },
]

const VIEW_LABELS: Record<ViewMode, string> = {
  timeline: 'Timeline',
  causal: 'Causal Graph',
  'actor-perspective': 'Actor Perspective',
}

/** Names for the layouts in `LAYOUT_SHORTCUTS` (the layout manager's own labels). */
export const LAYOUT_LABELS: Record<string, string> = {
  time: 'time order',
  cose: 'clusters',
  breadthfirst: 'tree',
  circle: 'ring',
  grid: 'grid',
  concentric: 'hubs at centre',
  dagre: 'cause to effect',
  'cose-bilkent': 'tight clusters',
  random: 'scatter',
}

const LAYOUT_ACTION_DESCRIPTIONS: Record<string, string> = {
  fit: 'Fit the whole graph in view',
  reset: 'Reset the graph zoom',
}

const viewSwitchShortcuts: Shortcut[] = VIEW_SHORTCUT_CONFIGS.map((config) => ({
  id: `view-${config.mode}`,
  scope: 'global',
  combos: [['Alt', config.shortcut]],
  description: `Switch to the ${VIEW_LABELS[config.mode]} view`,
}))

const layoutShortcuts: Shortcut[] = Object.entries(LAYOUT_SHORTCUTS)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([key, layout]) => ({
    id: `layout-${layout}`,
    scope: 'causal',
    combos: [[key]],
    description: `Use the ${LAYOUT_LABELS[layout] ?? layout} layout`,
  }))

const layoutActionShortcuts: Shortcut[] = Object.entries(ACTION_SHORTCUTS).map(([key, action]) => ({
  id: `graph-${action}`,
  scope: 'causal',
  combos: [[key.toUpperCase()]],
  description: LAYOUT_ACTION_DESCRIPTIONS[action] ?? action,
}))

export const SHORTCUTS: readonly Shortcut[] = [
  // ── Anywhere ───────────────────────────────────────────────────────────
  {
    id: 'help',
    scope: 'global',
    combos: [['?']],
    description: 'Open this help and reference',
  },
  ...viewSwitchShortcuts,
  {
    id: 'toggle-filters',
    scope: 'global',
    combos: [['Shift', 'F']],
    description: 'Show or hide the filter panel',
  },
  {
    id: 'clear-filters',
    scope: 'global',
    combos: [['Shift', 'R']],
    description: 'Clear all filters',
    note: 'When a filter is active',
  },
  {
    id: 'clear-selection',
    scope: 'global',
    combos: [['Escape']],
    description: 'Clear the selection',
    note: 'When something is selected',
  },
  {
    id: 'copy-graph',
    scope: 'global',
    combos: [['Shift', 'B']],
    description: 'Branch the graph (a linked what-if fork) or make a plain copy',
  },
  {
    id: 'copy-progress',
    scope: 'global',
    combos: [['Shift', 'S']],
    description: 'Show copies in progress',
  },
  {
    id: 'copy-history',
    scope: 'global',
    combos: [['Shift', 'H']],
    description: 'Show copy history',
  },

  // ── Timeline view ─────────────────────────────────────────────────────
  {
    id: 'timeline-fit',
    scope: 'timeline',
    combos: [['F']],
    description: 'Zoom to fit all events',
  },
  {
    id: 'create-event',
    scope: 'timeline',
    combos: [['E']],
    description: 'Create an event',
  },
  {
    id: 'create-arc',
    scope: 'timeline',
    combos: [['A']],
    description: 'Create an arc',
  },
  {
    id: 'timeline-undo',
    scope: 'timeline',
    combos: [['Ctrl', 'Z'], ['Cmd', 'Z']],
    description: 'Undo the last drag or resize',
  },
  {
    id: 'timeline-redo',
    scope: 'timeline',
    combos: [['Ctrl', 'Shift', 'Z'], ['Cmd', 'Shift', 'Z'], ['Ctrl', 'Y']],
    description: 'Redo',
  },
  {
    id: 'timeline-cancel-drag',
    scope: 'timeline',
    combos: [['Escape']],
    description: 'Cancel a drag or resize in progress',
  },

  // ── Timeline canvas ───────────────────────────────────────────────────
  {
    id: 'timeline-pan',
    scope: 'timeline-canvas',
    combos: [['ArrowLeft'], ['ArrowRight']],
    description: 'Pan earlier or later',
  },
  {
    id: 'timeline-pan-page',
    scope: 'timeline-canvas',
    combos: [['PageUp'], ['PageDown']],
    description: 'Pan earlier or later by a larger step',
  },
  {
    id: 'timeline-zoom-in',
    scope: 'timeline-canvas',
    combos: [['+'], ['=']],
    description: 'Zoom in',
  },
  {
    id: 'timeline-zoom-out',
    scope: 'timeline-canvas',
    combos: [['-']],
    description: 'Zoom out',
  },
  {
    id: 'timeline-reset-zoom',
    scope: 'timeline-canvas',
    combos: [['0']],
    description: 'Reset the zoom',
  },
  {
    id: 'timeline-enter-marks',
    scope: 'timeline-canvas',
    combos: [['Enter'], ['Home'], ['End']],
    description: 'From the canvas: move into the marks (Home/End: first or last event)',
  },
  {
    id: 'timeline-mark-move',
    scope: 'timeline-canvas',
    combos: [['ArrowLeft'], ['ArrowRight']],
    description: 'On a mark: previous or next mark in the same row, in time order',
    note: 'On the canvas itself these pan instead',
  },
  {
    id: 'timeline-mark-lane',
    scope: 'timeline-canvas',
    combos: [['ArrowUp'], ['ArrowDown']],
    description: 'On a mark: move between arc rows and the event track',
  },
  {
    id: 'timeline-mark-first-last',
    scope: 'timeline-canvas',
    combos: [['Home'], ['End']],
    description: 'On a mark: first or last mark in its row',
  },
  {
    id: 'timeline-select-mark',
    scope: 'timeline-canvas',
    combos: [['Enter'], ['Space']],
    description: 'Select the focused event or arc (shows it in the inspector)',
  },
  {
    id: 'timeline-retime',
    scope: 'timeline-canvas',
    combos: [['Shift', 'ArrowLeft'], ['Shift', 'ArrowRight']],
    description: 'Move the focused event (or whole arc) earlier or later by one step',
    note: 'Validated and undoable like a drag',
  },
  {
    id: 'timeline-mark-menu',
    scope: 'timeline-canvas',
    combos: [['Shift', 'F10'], ['ContextMenu']],
    description: 'Open the focused mark’s actions (edit, assign, branch, delete)',
  },
  {
    id: 'timeline-toggle-arc',
    scope: 'timeline-canvas',
    combos: [['Shift', 'Enter']],
    description: 'Expand or collapse the focused arc’s sub-arcs',
  },
  {
    id: 'timeline-arc-start-edge',
    scope: 'timeline-canvas',
    combos: [['['], ['Shift', '[']],
    description: 'Focused arc: start edge earlier ([) or later (Shift+[)',
  },
  {
    id: 'timeline-arc-end-edge',
    scope: 'timeline-canvas',
    combos: [[']'], ['Shift', ']']],
    description: 'Focused arc: end edge later (]) or earlier (Shift+])',
  },
  {
    id: 'timeline-mark-escape',
    scope: 'timeline-canvas',
    combos: [['Escape']],
    description: 'Return focus from a mark to the canvas',
  },

  // ── Causal graph view ─────────────────────────────────────────────────
  ...layoutShortcuts,
  ...layoutActionShortcuts,
  {
    id: 'draw-link',
    scope: 'causal',
    combos: [['D']],
    description: 'Draw Link: link the two selected events, or click a cause and then its effect',
  },
  {
    id: 'causal-escape',
    scope: 'causal',
    combos: [['Escape']],
    description: 'Cancel drawing a link, or close the open graph tool',
  },

  // ── Causal graph canvas ───────────────────────────────────────────────
  {
    id: 'graph-next-event',
    scope: 'causal-canvas',
    combos: [['ArrowRight'], ['ArrowDown']],
    description: 'Select the next event',
  },
  {
    id: 'graph-previous-event',
    scope: 'causal-canvas',
    combos: [['ArrowLeft'], ['ArrowUp']],
    description: 'Select the previous event',
  },
  {
    id: 'graph-open-event',
    scope: 'causal-canvas',
    combos: [['Enter']],
    description: 'Show details for the selected event',
  },

  // ── Causal chain exploration ──────────────────────────────────────────
  {
    id: 'chain-step',
    scope: 'causal-chain',
    combos: [['ArrowLeft'], ['ArrowRight']],
    description: 'Previous or next step along the chain',
  },
  {
    id: 'chain-path',
    scope: 'causal-chain',
    combos: [['ArrowUp'], ['ArrowDown']],
    description: 'Previous or next path',
  },
  {
    id: 'chain-auto-advance',
    scope: 'causal-chain',
    combos: [['Space']],
    description: 'Start or stop auto-advance',
  },
  {
    id: 'chain-stop',
    scope: 'causal-chain',
    combos: [['Escape']],
    description: 'Stop exploring',
  },

  // ── Actor perspective view ────────────────────────────────────────────
  {
    id: 'actor-chronological',
    scope: 'actor',
    combos: [['C']],
    description: 'Chronological layout',
    note: 'The Layout control in the view',
  },
  {
    id: 'actor-thematic',
    scope: 'actor',
    combos: [['T']],
    description: 'Thematic layout',
    note: 'The Layout control in the view',
  },
  {
    id: 'actor-stats',
    scope: 'actor',
    combos: [['S']],
    description: 'Show or hide actor statistics',
  },
  {
    id: 'actor-activate-event',
    scope: 'actor',
    combos: [['Enter'], ['Space']],
    description: 'Select the focused event',
  },

  // ── Menus and dialogs ─────────────────────────────────────────────────
  {
    id: 'dialog-close',
    scope: 'dialogs',
    combos: [['Escape']],
    description: 'Close the open menu or dialog',
  },
  {
    id: 'menu-move',
    scope: 'dialogs',
    combos: [['ArrowUp'], ['ArrowDown']],
    description: 'Move through the Graph menu',
  },
  {
    id: 'menu-ends',
    scope: 'dialogs',
    combos: [['Home'], ['End']],
    description: 'First or last item in the Graph menu',
  },
  {
    id: 'tabs-move',
    scope: 'dialogs',
    combos: [['ArrowLeft'], ['ArrowRight']],
    description: 'Switch tabs in a tabbed dialog',
  },
]

/** How a key is shown on its keycap, and what a screen reader hears. */
const KEY_DISPLAY: Record<string, { label: string; spoken: string }> = {
  ArrowLeft: { label: '←', spoken: 'Left arrow' },
  ArrowRight: { label: '→', spoken: 'Right arrow' },
  ArrowUp: { label: '↑', spoken: 'Up arrow' },
  ArrowDown: { label: '↓', spoken: 'Down arrow' },
  Escape: { label: 'Esc', spoken: 'Escape' },
  PageUp: { label: 'PgUp', spoken: 'Page up' },
  PageDown: { label: 'PgDn', spoken: 'Page down' },
  ContextMenu: { label: 'Menu', spoken: 'Context menu key' },
  '[': { label: '[', spoken: 'Left bracket' },
  ']': { label: ']', spoken: 'Right bracket' },
  Cmd: { label: '⌘', spoken: 'Command' },
  '?': { label: '?', spoken: 'Question mark' },
  '+': { label: '+', spoken: 'Plus' },
  '-': { label: '−', spoken: 'Minus' },
  '=': { label: '=', spoken: 'Equals' },
}

export function keyDisplay(key: string): { label: string; spoken: string } {
  return KEY_DISPLAY[key] ?? { label: key, spoken: key }
}

/** `['Ctrl', 'Shift', 'A']` → `Ctrl+Shift+A`, the spelling the toolbar tooltips use. */
export function formatCombo(combo: KeyCombo): string {
  return combo.join('+')
}

export function shortcutsForScope(scope: ShortcutScope): Shortcut[] {
  return SHORTCUTS.filter((shortcut) => shortcut.scope === scope)
}
