/**
 * What the walkthrough says and where the camera looks. This is the file to
 * edit when the tour should tell a different story; the scene that renders it
 * (`walkthrough.tsx`) only knows how to move a camera over a screenshot.
 *
 * Every `shot` and `focus` name refers to the capture manifest written by
 * `capture/tour.ts`, and the renderer fails if one is missing.
 */

/** Where the camera goes: the whole shot, its top edge, or a named region. */
export type Target = 'full' | 'top' | { focus: string; zoom?: number }

export interface Move {
  to: Target
  /** Seconds to hold once the camera arrives. */
  hold: number
  /** Seconds the camera takes to get there (default 1). */
  travel?: number
  /** Regions to outline while this move plays. */
  highlight?: string[]
  /** Animate a pointer onto the shot's recorded hover/click point. */
  pointer?: 'hover' | 'click'
}

export interface Beat {
  shot: string
  chapter: string
  caption: string
  moves: Move[]
}

export const intro = {
  title: 'althistory',
  subtitle: 'A guided tour',
  premise: 'Demo graph: The Engine Age — what if Babbage finished the Analytical Engine in 1843?',
}

export const beats: Beat[] = [
  {
    shot: 'overview',
    chapter: 'The workspace',
    caption: 'Each graph opens on its timeline. Views on the left, tools along the top, filters on the right.',
    moves: [
      { to: 'full', hold: 0.6, travel: 0 },
      { to: 'full', hold: 1.6, travel: 0, highlight: ['views'] },
      { to: 'full', hold: 1.6, travel: 0, highlight: ['toolbar'] },
      { to: 'full', hold: 1.8, travel: 0, highlight: ['filters'] },
    ],
  },
  {
    shot: 'timeline',
    chapter: 'Timeline',
    caption: 'Arcs group events into periods and sub-periods. Hover any event to see who did what, to whom, and when.',
    moves: [
      { to: { focus: 'timeline' }, hold: 1.4, travel: 0 },
      { to: { focus: 'tooltip', zoom: 2 }, hold: 2.4, pointer: 'hover' },
    ],
  },
  {
    shot: 'pressures',
    chapter: 'Inferred pressures',
    caption: 'althistory reads clusters of events and infers the economic, social and political pressures behind them.',
    moves: [{ to: { focus: 'panel' }, hold: 3.6, travel: 0, highlight: ['panel'] }],
  },
  {
    shot: 'causal-graph',
    chapter: 'Causal graph',
    caption: 'Every cause-and-effect link, weighted and typed. Pick a layout to reorganise the graph.',
    moves: [
      { to: 'top', hold: 0.8, travel: 0 },
      { to: { focus: 'directed', zoom: 1.7 }, hold: 1.4, pointer: 'click', highlight: ['directed'] },
      { to: { focus: 'graph' }, hold: 2.2, travel: 1.6 },
    ],
  },
  {
    shot: 'actor',
    chapter: 'Actor perspective',
    caption: 'Follow one actor through the history: what they did, and what was done to them.',
    moves: [
      { to: 'full', hold: 0.8, travel: 0, highlight: ['picker'] },
      { to: { focus: 'stats' }, hold: 2.6 },
    ],
  },
  {
    shot: 'ingest-text',
    chapter: 'Ingestion',
    caption: 'Bring history in from Wikipedia, Wikidata or plain text.',
    moves: [
      { to: { focus: 'dialog' }, hold: 1.2, travel: 0 },
      { to: { focus: 'dialog' }, hold: 1.4, highlight: ['text'], pointer: 'click', travel: 0.4 },
    ],
  },
  {
    shot: 'ingest-review',
    chapter: 'Review before import',
    caption: 'Nothing is written until you have reviewed it: edit or untick rows, then import the rest.',
    moves: [{ to: { focus: 'dialog' }, hold: 3.4, travel: 0, highlight: ['table'] }],
  },
  {
    shot: 'graphs',
    chapter: 'Graphs and branches',
    caption: 'Keep many graphs side by side, and branch one to explore a counterfactual without touching the original.',
    moves: [
      { to: 'full', hold: 0.8, travel: 0, pointer: 'click' },
      { to: { focus: 'menu', zoom: 1.8 }, hold: 2.6, highlight: ['menu'] },
    ],
  },
]

export const outro = {
  title: 'Script it, too',
  caption: 'Everything in the interface is also a CLI command and an MCP tool for agents.',
  commands: [
    { cmd: './start-local.sh', note: 'the app on localhost:5173' },
    { cmd: './bin/althistory graph create "The Engine Age"', note: '' },
    { cmd: './bin/althistory ingest url <wikipedia-url> -g <graphId>', note: '' },
    { cmd: './bin/althistory export <graphId> --format markdown', note: '' },
    { cmd: './bin/althistory mcp', note: 'for Claude, Cursor and other agents' },
  ],
}
