/**
 * What a change pushed by the live feed does to the screen.
 *
 * Pure functions, so every rule is testable without a socket:
 *
 *   - `queryRootsFor`: which cached queries a change makes stale. The app
 *     invalidates them and the active ones refetch, so the timeline, causal
 *     graph and panels update without a reload.
 *   - `describeChanges`: who changed what, in a line a person can read ("An
 *     agent added 3 events to The Tide War").
 *   - `freshIdsOf`: which items to highlight for a moment.
 *
 * Pressures are never stored; the server infers them from the events on every
 * read, so a change to events, arcs or links is also a change to pressures.
 */

import type { ChangeActor, ChangedEntityType, LiveChange } from '@/types'

/** How long a new or changed item stays highlighted. */
export const FRESH_MS = 6000

/** A query key root: invalidating it refetches every query whose key starts with it. */
type QueryRoot = readonly [string]

const EVENTS: QueryRoot = ['events']
const ARCS: QueryRoot = ['arcs']
const CAUSAL: QueryRoot = ['causal']
const INFERENCE: QueryRoot = ['inference']
const GRAPHS: QueryRoot = ['graphs']

/**
 * The cached queries a batch of changes to one graph makes stale.
 *
 * `activeGraphId` is the graph on screen: the data queries (events, arcs,
 * links, pressures) read the active graph, so a change to another graph only
 * touches the graph list.
 */
export function queryRootsFor(changes: readonly LiveChange[], activeGraphId: string | null): QueryRoot[] {
  const roots = new Map<string, QueryRoot>()
  const add = (...list: QueryRoot[]): void => {
    for (const root of list) roots.set(root[0], root)
  }

  for (const change of changes) {
    const onScreen = change.graphId === activeGraphId
    switch (change.kind) {
      case 'entities': {
        add(GRAPHS)
        if (!onScreen) break
        for (const entity of change.entities) {
          if (entity.type === 'event') add(EVENTS, INFERENCE, CAUSAL)
          else if (entity.type === 'arc') add(ARCS, INFERENCE)
          else if (entity.type === 'relationship') add(CAUSAL, INFERENCE)
          else add(INFERENCE)
        }
        break
      }
      case 'replaced':
        add(GRAPHS)
        if (onScreen) add(EVENTS, ARCS, CAUSAL, INFERENCE)
        break
      case 'graph':
        add(GRAPHS)
        // A new calendar changes how every date on screen is written.
        if (onScreen && change.fields?.includes('calendar')) add(EVENTS, ARCS)
        break
      case 'generation':
        // Progress is not data; a finished run changes the graph list's counts.
        if (change.status !== 'running') add(GRAPHS)
        break
    }
  }
  return Array.from(roots.values())
}

/** The items to highlight for a change: what was added or changed, never what was deleted. */
export function freshIdsOf(change: LiveChange): Array<{ type: ChangedEntityType; id: string }> {
  if (change.kind !== 'entities' || change.operation === 'delete') return []
  return change.entities.filter((entity) => entity.type !== 'pressure')
}

/** Who made a change, as a person reads it: "An agent (Claude)", "The command line". */
export function actorLabel(actor: ChangeActor): string {
  const named = (label: string): string => (actor.name ? `${label} (${actor.name})` : label)
  switch (actor.kind) {
    case 'agent':
      return named('An agent')
    case 'cli':
      return named('The command line')
    case 'person':
      return named('Someone in another window')
    case 'api':
      return named('Another client')
    case 'generation':
      return actor.name ?? 'A generation job'
    default:
      return 'The app'
  }
}

const NOUN: Record<ChangedEntityType, [string, string]> = {
  event: ['event', 'events'],
  arc: ['arc', 'arcs'],
  relationship: ['link', 'links'],
  pressure: ['pressure', 'pressures'],
}

const VERB = { create: 'added', update: 'changed', delete: 'removed' } as const

function countOf(n: number, type: ChangedEntityType): string {
  const [one, many] = NOUN[type]
  return `${n} ${n === 1 ? one : many}`
}

function listOf(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

const REPLACED: Record<string, string> = {
  rollback: 'rolled back',
  branch: 'branched',
  merge: 'merged another graph into',
  import: 'imported into',
  commit: 'committed changes to',
}

/**
 * One line per author and graph for a batch of changes, newest first not
 * implied: the order is the order the authors first appear.
 *
 * "An agent (Claude) added 3 events and 2 links to The Tide War",
 * "The command line rolled back The Tide War". A generation run reports only
 * when it ends ("Timeline generation by Claude: Wrote 8 events, 1 arc and 7 links"):
 * its writes are already counted, and every progress step would be noise.
 */
export function describeChanges(
  changes: readonly LiveChange[],
  graphName: (graphId: string) => string
): string[] {
  const lines = new Map<string, { actor: string; graph: string; counts: Map<string, number>; other: string[] }>()

  for (const change of changes) {
    if (change.kind === 'generation') continue
    const actor = actorLabel(change.actor)
    const graph = change.kind === 'graph' && change.name ? `“${change.name}”` : graphName(change.graphId)
    const key = `${actor}\u0000${change.graphId}`
    let line = lines.get(key)
    if (!line) {
      line = { actor, graph, counts: new Map(), other: [] }
      lines.set(key, line)
    }
    if (change.kind === 'entities') {
      for (const entity of change.entities) {
        if (entity.type === 'pressure') continue
        const k = `${change.operation}:${entity.type}`
        line.counts.set(k, (line.counts.get(k) ?? 0) + 1)
      }
    } else if (change.kind === 'replaced') {
      line.other.push(`${REPLACED[change.reason] ?? 'rebuilt'} ${graph}`)
    } else if (change.kind === 'graph') {
      line.other.push(
        change.operation === 'create'
          ? `created the graph ${graph}`
          : change.operation === 'delete'
            ? `deleted the graph ${graph}`
            : change.fields?.includes('calendar') && change.fields.length === 1
              ? `changed the calendar of ${graph}`
              : `changed the graph ${graph}`
      )
    }
  }

  const out: string[] = []
  for (const line of lines.values()) {
    const byVerb = new Map<keyof typeof VERB, string[]>()
    for (const [k, n] of line.counts) {
      const [operation, type] = k.split(':') as [keyof typeof VERB, ChangedEntityType]
      byVerb.set(operation, [...(byVerb.get(operation) ?? []), countOf(n, type)])
    }
    const phrases = [
      ...Array.from(byVerb, ([operation, parts]) => `${VERB[operation]} ${listOf(parts)} ${operation === 'delete' ? 'from' : operation === 'create' ? 'to' : 'in'} ${line.graph}`),
      ...Array.from(new Set(line.other)),
    ]
    if (phrases.length > 0) out.push(`${line.actor} ${listOf(phrases)}`)
  }

  // A finished generation run is announced once, in its own words.
  for (const change of changes) {
    if (change.kind === 'generation' && change.status !== 'running') {
      const name = change.actor.name ?? 'Generation'
      out.push(
        change.status === 'completed'
          ? `${name}: ${change.message}${change.source === 'template' ? ' (a template draft: rewrite it)' : ''}`
          : `${name} ${change.status === 'cancelled' ? 'was cancelled' : 'failed'}: ${change.message}`
      )
    }
  }
  return out
}
