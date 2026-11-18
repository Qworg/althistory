import { describe, it, expect, vi } from 'vitest';
import { versionCopyFromHead } from './CopyVersioning';

type Deps = Parameters<typeof versionCopyFromHead>[0];

const head = {
  events: {
    e1: { id: 'e1', sourceRef: 'wiki:One' },
    e2: { id: 'e2' },
    e3: { id: 'e3' },
  },
  arcs: { a1: { id: 'a1', parent_arc_id: null }, a2: { id: 'a2', parent_arc_id: 'a1' } },
  relationships: {
    l1: { id: 'l1', cause_event_id: 'e1', effect_event_id: 'e2', weight: 0, confidence: 0, sourceRef: 'wiki:Link' },
    l2: { id: 'l2', cause_event_id: 'e2', effect_event_id: 'e3', weight: 0.5, confidence: 0.5 },
    l3: { id: 'l3', cause_event_id: 'x1', effect_event_id: 'e1', causeGraphId: 'other', weight: 0.5, confidence: 0.5 },
  },
  pressures: { p1: { id: 'p1' } },
};

interface Live {
  events?: unknown[];
  arcs?: unknown[];
  links?: unknown[];
}

function deps(source: unknown = head, live: Live = {}) {
  const commitChanges = vi.fn().mockResolvedValue({ version: 1 });
  const checkout = vi.fn().mockResolvedValue(source);
  const recordBatch = vi.fn().mockResolvedValue(undefined);
  return {
    container: {
      graphRepository: { checkout, commitChanges },
      graphScopedRepositories: async () => ({
        eventRepository: { findAll: async () => live.events ?? [] },
        arcRepository: { findAll: async () => live.arcs ?? [] },
        causalService: { getAllRelationships: async () => live.links ?? [] },
      }),
      graphWriteVersioningService: { recordBatch },
    } as unknown as Deps,
    commitChanges,
    checkout,
    recordBatch,
  };
}

const committed = (commitChanges: ReturnType<typeof vi.fn>) =>
  (commitChanges.mock.calls[0]?.[1] as { added: Array<{ type: string; id: string; data: Record<string, unknown> }> }).added;

describe('versionCopyFromHead (#35)', () => {
  it('records the source’s whole head as the copy’s first version, field for field', async () => {
    const { container, commitChanges, checkout } = deps();

    await versionCopyFromHead(container, 'source', 'target', 'Source', null);

    expect(checkout).toHaveBeenCalledWith('source');
    expect(commitChanges).toHaveBeenCalledTimes(1);
    expect(commitChanges.mock.calls[0]?.[0]).toBe('target');
    expect(commitChanges.mock.calls[0]?.[2]).toBe('branch');
    expect(commitChanges.mock.calls[0]?.[3]).toBe('Copied from Source');
    const added = committed(commitChanges);
    expect(added.map((e) => `${e.type}:${e.id}`).sort()).toEqual(['arc:a1', 'arc:a2', 'event:e1', 'event:e2', 'event:e3', 'relationship:l1', 'relationship:l2', 'relationship:l3']);
    // Untouched: not rebuilt from the live store.
    expect(added.find((e) => e.id === 'e1')?.data).toBe(head.events.e1);
    expect(added.find((e) => e.id === 'a2')?.data.parent_arc_id).toBe('a1');
    expect(added.find((e) => e.id === 'l1')?.data).toMatchObject({ weight: 0, confidence: 0, sourceRef: 'wiki:Link' });
    expect(added.find((e) => e.id === 'l3')?.data.causeGraphId).toBe('other');
  });

  it('takes only the ids a partial copy copied, and a link only when both its events were', async () => {
    const { container, commitChanges } = deps();

    await versionCopyFromHead(container, 'source', 'target', 'Source', new Set(['Event:e1', 'Event:e2', 'Arc:a2']));

    expect(committed(commitChanges).map((e) => `${e.type}:${e.id}`).sort()).toEqual(['arc:a2', 'event:e1', 'event:e2', 'relationship:l1']);
  });

  it('makes no version for a source with nothing in its head or its live store', async () => {
    const { container, commitChanges, recordBatch } = deps({ events: {}, arcs: {}, relationships: {}, pressures: {} });
    await versionCopyFromHead(container, 'source', 'target', 'Source', null);
    expect(commitChanges).not.toHaveBeenCalled();
    expect(recordBatch).not.toHaveBeenCalled();
  });

  it('makes an arc whose parent was not copied a top-level arc, in the version and in the plan', async () => {
    const source = {
      ...head,
      arcs: {
        top: { id: 'top', level: 0, parent_arc_id: null, metadata: {} },
        mid: { id: 'mid', level: 1, parent_arc_id: 'top', metadata: { parentArcId: 'top' } },
        low: { id: 'low', level: 2, parent_arc_id: 'mid', metadata: { parentArcId: 'mid' } },
        keep: { id: 'keep', level: 0, parent_arc_id: null, metadata: {} },
      },
    };
    const { container, commitChanges } = deps(source);

    const plan = await versionCopyFromHead(container, 'source', 'target', 'Source', new Set(['Arc:mid', 'Arc:low', 'Arc:keep']));

    const arcs = Object.fromEntries(committed(commitChanges).filter((e) => e.type === 'arc').map((e) => [e.id, e.data]));
    expect(arcs.mid).toMatchObject({ parent_arc_id: null, level: 0 });
    // The key is removed, not set to null, so the live copy and the version agree.
    expect(arcs.mid.metadata).not.toHaveProperty('parentArcId');
    expect(arcs.low).toMatchObject({ parent_arc_id: 'mid', level: 1 });
    expect(arcs.keep).toBe(source.arcs.keep);
    expect([...plan.arcs!]).toEqual([
      ['mid', { parent: null, level: 0 }],
      ['low', { parent: 'mid', level: 1 }],
    ]);
  });

  it('versions a source that has live nodes and no head from the selected live nodes', async () => {
    const live = {
      events: [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }],
      arcs: [{ id: 'a1', level: 1, metadata: {} }],
      links: [{ id: 'l1', cause_event_id: 'e1', effect_event_id: 'e2' }, { id: 'l2', cause_event_id: 'e2', effect_event_id: 'e3' }],
    };
    const { container, commitChanges, recordBatch } = deps({ events: {}, arcs: {}, relationships: {}, pressures: {} }, live);

    await versionCopyFromHead(container, 'source', 'target', 'Source', new Set(['Event:e1', 'Event:e2', 'Arc:a1']));

    expect(commitChanges).not.toHaveBeenCalled();
    const [graphId, state] = recordBatch.mock.calls[0] as [string, { events: Map<string, unknown>; arcs: Map<string, unknown>; links: Array<{ live: Array<{ id: string }> }> }];
    expect(graphId).toBe('target');
    expect([...state.events.keys()]).toEqual(['e1', 'e2']);
    expect([...state.arcs.keys()]).toEqual(['a1']);
    expect(state.links.flatMap((pair) => pair.live.map((l) => l.id))).toEqual(['l1']);
  });
});
