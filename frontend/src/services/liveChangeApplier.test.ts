import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import type { ChangeActor, LiveChange } from '@/types'
import { LiveChangeApplier } from './liveChangeApplier'

let seq = 0
function added(graphId: string, type: 'event' | 'arc' | 'relationship', id: string, extra: Partial<LiveChange> = {}): LiveChange {
  return {
    kind: 'entities',
    graphId,
    seq: ++seq,
    at: 'x',
    actor: { kind: 'agent', name: 'Claude' } as ChangeActor,
    operation: 'create',
    entities: [{ type, id }],
    summary: 'x',
    ...extra,
  } as LiveChange
}

describe('LiveChangeApplier', () => {
  let queryClient: QueryClient
  let invalidated: string[]
  let sink: { markFresh: ReturnType<typeof vi.fn>; addNotices: ReturnType<typeof vi.fn> }
  let applier: LiveChangeApplier
  let active: string | null

  beforeEach(() => {
    vi.useFakeTimers()
    queryClient = new QueryClient()
    invalidated = []
    vi.spyOn(queryClient, 'invalidateQueries').mockImplementation(((filters: { queryKey?: readonly unknown[] }) => {
      invalidated.push(String(filters?.queryKey?.[0]))
      return Promise.resolve()
    }) as unknown as QueryClient['invalidateQueries'])
    sink = { markFresh: vi.fn(), addNotices: vi.fn() }
    active = 'g1'
    applier = new LiveChangeApplier({ queryClient, sink, activeGraphId: () => active, clientId: 'tab-1', windowMs: 150 })
  })

  afterEach(() => {
    applier.dispose()
    vi.useRealTimers()
  })

  it('invalidates what a change made stale, so the active queries refetch', () => {
    applier.push(added('g1', 'event', 'e1'))
    expect(invalidated).toEqual([])
    vi.advanceTimersByTime(150)
    expect(invalidated.sort()).toEqual(['causal', 'events', 'graphs', 'inference'])
  })

  it('applies a burst once, rather than once per change', () => {
    for (let i = 0; i < 30; i += 1) {
      applier.push(added('g1', 'event', `e${i}`))
      vi.advanceTimersByTime(5)
    }
    vi.advanceTimersByTime(150)
    expect(invalidated.filter((root) => root === 'events')).toHaveLength(1)
    // And says it once, as a count.
    expect(sink.addNotices).toHaveBeenCalledTimes(1)
    expect(sink.addNotices).toHaveBeenCalledWith(['An agent (Claude) added 30 events to this graph'])
  })

  it('applies a steady stream within the window, not only when it stops', () => {
    for (let i = 0; i < 100; i += 1) {
      applier.push(added('g1', 'event', `e${i}`))
      vi.advanceTimersByTime(20)
    }
    // 2 seconds of messages arriving every 20ms: applied about every 150ms.
    expect(invalidated.filter((root) => root === 'events').length).toBeGreaterThanOrEqual(10)
  })

  it('highlights what arrived on the open graph, and says who changed what', () => {
    applier.push(added('g1', 'event', 'e1'))
    applier.push(added('g1', 'arc', 'a1'))
    vi.advanceTimersByTime(150)
    expect(sink.markFresh).toHaveBeenCalledWith([
      { type: 'event', id: 'e1' },
      { type: 'arc', id: 'a1' },
    ])
    expect(sink.addNotices).toHaveBeenCalledWith(['An agent (Claude) added 1 event and 1 arc to this graph'])
  })

  it('names the graph when the cache knows it', () => {
    queryClient.setQueryData(['graphs', 'detail', 'g1'], { name: 'The Tide War' })
    applier.push(added('g1', 'event', 'e1'))
    vi.advanceTimersByTime(150)
    expect(sink.addNotices).toHaveBeenCalledWith(['An agent (Claude) added 1 event to “The Tide War”'])
  })

  it('does not highlight, or refetch the data of, another graph', () => {
    applier.push(added('g2', 'event', 'e1'))
    vi.advanceTimersByTime(150)
    expect(sink.markFresh).not.toHaveBeenCalled()
    expect(invalidated).toEqual(['graphs'])
  })

  it('does not announce, highlight or refetch for the tab\'s own edits', () => {
    applier.push(added('g1', 'event', 'e1', { origin: 'tab-1' }))
    vi.advanceTimersByTime(500)
    expect(invalidated).toEqual([])
    expect(sink.markFresh).not.toHaveBeenCalled()
    expect(sink.addNotices).not.toHaveBeenCalled()
    // Another tab's edits are another writer's.
    applier.push(added('g1', 'event', 'e2', { origin: 'tab-2' }))
    vi.advanceTimersByTime(150)
    expect(sink.markFresh).toHaveBeenCalled()
  })

  it('does not highlight a deletion', () => {
    applier.push(added('g1', 'event', 'e1', { operation: 'delete' }))
    vi.advanceTimersByTime(150)
    expect(sink.markFresh).not.toHaveBeenCalled()
    expect(invalidated).toContain('events')
    expect(sink.addNotices).toHaveBeenCalledWith(['An agent (Claude) removed 1 event from this graph'])
  })

  it('refetches the graph list for a graph made elsewhere', () => {
    applier.push({ kind: 'graph', graphId: 'g9', seq: ++seq, at: 'x', actor: { kind: 'cli' }, operation: 'create', name: 'Vael', summary: 'x' })
    vi.advanceTimersByTime(150)
    expect(invalidated).toEqual(['graphs'])
    expect(sink.addNotices).toHaveBeenCalledWith(['The command line created the graph “Vael”'])
  })

  describe('resync', () => {
    it('refetches everything for the open graph', () => {
      applier.resync('g1')
      expect(invalidated.sort()).toEqual(['arcs', 'causal', 'events', 'graphs', 'inference'])
    })

    it('refetches only the list for the graph list or another graph', () => {
      applier.resync('*')
      applier.resync('g2')
      expect(invalidated).toEqual(['graphs', 'graphs'])
    })
  })

  it('drops what is gathered when disposed', () => {
    applier.push(added('g1', 'event', 'e1'))
    applier.dispose()
    vi.advanceTimersByTime(500)
    expect(invalidated).toEqual([])
  })
})
