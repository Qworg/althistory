import { describe, it, expect } from 'vitest'
import type { ChangeActor, LiveChange } from '@/types'
import { actorLabel, changesGraphCounts, describeChanges, freshIdsOf, queryRootsFor } from './liveChanges'

let seq = 0
function entities(
  graphId: string,
  operation: 'create' | 'update' | 'delete',
  list: Array<['event' | 'arc' | 'relationship' | 'pressure', string]>,
  actor: ChangeActor = { kind: 'agent', name: 'Claude' }
): LiveChange {
  return {
    kind: 'entities',
    graphId,
    seq: ++seq,
    at: '2026-05-01T00:00:00Z',
    actor,
    operation,
    entities: list.map(([type, id]) => ({ type, id })),
    summary: 'x',
  }
}

const names = (id: string): string => (id === 'g1' ? '“The Tide War”' : 'another graph')

describe('queryRootsFor', () => {
  const roots = (changes: LiveChange[], active: string | null = 'g1'): string[] =>
    queryRootsFor(changes, active).map((root) => root[0]).sort()

  it('refreshes events, pressures and links for an event on the open graph, and the graph list', () => {
    expect(roots([entities('g1', 'create', [['event', 'e1']])])).toEqual(['causal', 'events', 'inference'])
  })

  it('refreshes arcs and pressures for an arc, and links and pressures for a link', () => {
    expect(roots([entities('g1', 'update', [['arc', 'a1']])])).toEqual(['arcs', 'inference'])
    expect(roots([entities('g1', 'delete', [['relationship', 'r1']])])).toEqual(['causal', 'inference'])
  })

  it('refreshes no query for an entity change to a graph that is not on screen, nor does one ask for the graph list directly', () => {
    expect(roots([entities('other', 'create', [['event', 'e1']])])).toEqual([])
    expect(roots([entities('g1', 'create', [['event', 'e1']])], null)).toEqual([])
    // The counts the graph list shows are the caller's to refresh, at its own pace.
    expect(changesGraphCounts([entities('other', 'create', [['event', 'e1']])])).toBe(true)
    expect(changesGraphCounts([{ kind: 'replaced', graphId: 'g1', seq: 1, at: 'x', actor: { kind: 'system' }, reason: 'rollback', summary: 'x' }])).toBe(false)
  })

  it('unions a batch', () => {
    expect(roots([entities('g1', 'create', [['event', 'e1']]), entities('g1', 'create', [['arc', 'a1']])])).toEqual([
      'arcs',
      'causal',
      'events',
      'inference',
    ])
  })

  it('refreshes everything for a replaced graph', () => {
    const replaced: LiveChange = { kind: 'replaced', graphId: 'g1', seq: ++seq, at: 'x', actor: { kind: 'system' }, reason: 'rollback', summary: 'x' }
    expect(roots([replaced])).toEqual(['arcs', 'causal', 'events', 'graphs', 'inference'])
  })

  it('refreshes dates when the open graph gets a new calendar, and the list for any other graph change', () => {
    const graph = (graphId: string, fields: string[]): LiveChange => ({
      kind: 'graph',
      graphId,
      seq: ++seq,
      at: 'x',
      actor: { kind: 'system' },
      operation: 'update',
      fields,
      summary: 'x',
    })
    expect(roots([graph('g1', ['calendar'])])).toEqual(['arcs', 'events', 'graphs'])
    expect(roots([graph('g1', ['name'])])).toEqual(['graphs'])
    expect(roots([graph('other', ['calendar'])])).toEqual(['graphs'])
  })

  it('does not refetch for generation progress, only when a run ends', () => {
    const run = (status: 'running' | 'completed'): LiveChange => ({
      kind: 'generation',
      graphId: 'g1',
      seq: ++seq,
      at: 'x',
      actor: { kind: 'generation' },
      jobId: 'j',
      status,
      progress: 50,
      message: 'x',
      summary: 'x',
    })
    expect(roots([run('running')])).toEqual([])
    expect(roots([run('completed')])).toEqual(['graphs'])
  })
})

describe('freshIdsOf', () => {
  it('highlights what was added or changed, never what was deleted or inferred', () => {
    expect(freshIdsOf(entities('g1', 'create', [['event', 'e1'], ['pressure', 'p1'], ['relationship', 'r1']]))).toEqual([
      { type: 'event', id: 'e1' },
      { type: 'relationship', id: 'r1' },
    ])
    expect(freshIdsOf(entities('g1', 'update', [['arc', 'a1']]))).toEqual([{ type: 'arc', id: 'a1' }])
    expect(freshIdsOf(entities('g1', 'delete', [['event', 'e1']]))).toEqual([])
  })
})

describe('actorLabel', () => {
  it('names the kind of writer, and the key when it has a name', () => {
    expect(actorLabel({ kind: 'agent', name: 'Claude' })).toBe('An agent (Claude)')
    expect(actorLabel({ kind: 'agent' })).toBe('An agent')
    expect(actorLabel({ kind: 'cli' })).toBe('The command line')
    expect(actorLabel({ kind: 'person', name: 'Editor key' })).toBe('Someone in another window (Editor key)')
    expect(actorLabel({ kind: 'api' })).toBe('Another client')
    expect(actorLabel({ kind: 'generation', name: 'Timeline generation by Claude' })).toBe('Timeline generation by Claude')
    expect(actorLabel({ kind: 'system' })).toBe('The app')
  })
})

describe('describeChanges', () => {
  it('says who added how many of what to which graph', () => {
    const lines = describeChanges(
      [
        entities('g1', 'create', [['event', 'e1']]),
        entities('g1', 'create', [['event', 'e2'], ['event', 'e3']]),
        entities('g1', 'create', [['relationship', 'r1'], ['relationship', 'r2']]),
      ],
      names
    )
    expect(lines).toEqual(['An agent (Claude) added 3 events and 2 links to “The Tide War”'])
  })

  it('uses the singular, and says changed and removed in the right place', () => {
    expect(describeChanges([entities('g1', 'create', [['arc', 'a1']])], names)).toEqual(['An agent (Claude) added 1 arc to “The Tide War”'])
    expect(describeChanges([entities('g1', 'update', [['event', 'e1']])], names)).toEqual(['An agent (Claude) changed 1 event in “The Tide War”'])
    expect(describeChanges([entities('g1', 'delete', [['event', 'e1']])], names)).toEqual(['An agent (Claude) removed 1 event from “The Tide War”'])
  })

  it('keeps writers and graphs apart, and joins one writer\'s different operations', () => {
    const lines = describeChanges(
      [
        entities('g1', 'create', [['event', 'e1']]),
        entities('g1', 'delete', [['event', 'e2']]),
        entities('g1', 'create', [['event', 'e3']], { kind: 'cli' }),
        entities('g2', 'create', [['event', 'e4']]),
      ],
      names
    )
    expect(lines).toEqual([
      'An agent (Claude) added 1 event to “The Tide War” and removed 1 event from “The Tide War”',
      'The command line added 1 event to “The Tide War”',
      'An agent (Claude) added 1 event to another graph',
    ])
  })

  it('does not count inferred pressures', () => {
    expect(describeChanges([entities('g1', 'create', [['pressure', 'p1']])], names)).toEqual([])
  })

  it('describes a replaced graph and a graph that was made, changed or deleted', () => {
    const replaced: LiveChange = { kind: 'replaced', graphId: 'g1', seq: 1, at: 'x', actor: { kind: 'cli' }, reason: 'rollback', summary: 'x' }
    const made: LiveChange = { kind: 'graph', graphId: 'g9', seq: 2, at: 'x', actor: { kind: 'agent' }, operation: 'create', name: 'Vael', summary: 'x' }
    const calendar: LiveChange = { kind: 'graph', graphId: 'g1', seq: 3, at: 'x', actor: { kind: 'agent' }, operation: 'update', fields: ['calendar'], summary: 'x' }
    expect(describeChanges([replaced], names)).toEqual(['The command line rolled back “The Tide War”'])
    expect(describeChanges([made], names)).toEqual(['An agent created the graph “Vael”'])
    expect(describeChanges([calendar], names)).toEqual(['An agent changed the calendar of “The Tide War”'])
  })

  it('says nothing for a generation run until it ends, and then says whether it is a template', () => {
    const run = (status: 'running' | 'completed' | 'failed' | 'cancelled', source?: 'model' | 'template'): LiveChange => ({
      kind: 'generation',
      graphId: 'g1',
      seq: ++seq,
      at: 'x',
      actor: { kind: 'generation', name: 'Timeline generation by Claude' },
      jobId: 'j',
      status,
      progress: 100,
      message: status === 'completed' ? 'Wrote 8 events' : 'Boom',
      source,
      summary: 'x',
    })
    expect(describeChanges([run('running')], names)).toEqual([])
    expect(describeChanges([run('completed', 'model')], names)).toEqual(['Timeline generation by Claude: Wrote 8 events'])
    expect(describeChanges([run('completed', 'template')], names)).toEqual([
      'Timeline generation by Claude: Wrote 8 events (a template draft: rewrite it)',
    ])
    expect(describeChanges([run('failed')], names)).toEqual(['Timeline generation by Claude failed: Boom'])
    expect(describeChanges([run('cancelled')], names)).toEqual(['Timeline generation by Claude was cancelled: Boom'])
  })
})
