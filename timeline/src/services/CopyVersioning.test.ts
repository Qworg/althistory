import { describe, it, expect, vi } from 'vitest';
import { versionCopiedGraph } from './CopyVersioning';

type Deps = Parameters<typeof versionCopiedGraph>[0];

function deps(events: unknown[], arcs: unknown[], links: unknown[]) {
  const recordBatch = vi.fn().mockResolvedValue(undefined);
  const container = {
    graphScopedRepositories: async () => ({
      eventRepository: { findAll: async () => events },
      arcRepository: { findAll: async () => arcs },
      causalService: { getAllRelationships: async () => links },
    }),
    graphWriteVersioningService: { recordBatch },
  } as unknown as Deps;
  return { container, recordBatch };
}

describe('versionCopiedGraph (#35)', () => {
  it('commits what the copy wrote as one batch, under the ids it kept, with the arcs’ parents', async () => {
    const { container, recordBatch } = deps(
      [{ id: 'e1' }, { id: 'e2' }],
      [{ id: 'a1', metadata: {} }, { id: 'a2', metadata: { parentArcId: 'a1' } }],
      [{ id: 'l1', cause_event_id: 'e1', effect_event_id: 'e2' }, { id: 'l2', cause_event_id: 'e1', effect_event_id: 'e2' }]
    );

    await versionCopiedGraph(container, 'target', 'Source');

    expect(recordBatch).toHaveBeenCalledTimes(1);
    const [graphId, state, steps, options] = recordBatch.mock.calls[0] as [string, any, unknown[], any];
    expect(graphId).toBe('target');
    expect([...state.events.keys()]).toEqual(['e1', 'e2']);
    expect([...state.arcs.keys()]).toEqual(['a1', 'a2']);
    expect(state.links).toHaveLength(1);
    expect(state.links[0].live.map((l: { id: string }) => l.id)).toEqual(['l1', 'l2']);
    expect(state.parents.get('a1')).toBeNull();
    expect(state.parents.get('a2')).toBe('a1');
    expect(steps).toEqual([]);
    expect(options).toMatchObject({ summary: 'Copied from Source', announceIfNotVersioned: false });
  });

  it('makes no version for a copy that wrote nothing', async () => {
    const { container, recordBatch } = deps([], [], []);
    await versionCopiedGraph(container, 'target', 'Source');
    expect(recordBatch).not.toHaveBeenCalled();
  });
});
