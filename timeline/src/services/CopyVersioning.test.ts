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

function deps(source: unknown = head) {
  const commitChanges = vi.fn().mockResolvedValue({ version: 1 });
  const checkout = vi.fn().mockResolvedValue(source);
  return { container: { graphRepository: { checkout, commitChanges } } as unknown as Deps, commitChanges, checkout };
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

    await versionCopyFromHead(container, 'source', 'target', 'Source', new Set(['e1', 'e2', 'a2']));

    expect(committed(commitChanges).map((e) => `${e.type}:${e.id}`).sort()).toEqual(['arc:a2', 'event:e1', 'event:e2', 'relationship:l1']);
  });

  it('makes no version when there is nothing to record', async () => {
    const { container, commitChanges } = deps({ events: {}, arcs: {}, relationships: {}, pressures: {} });
    await versionCopyFromHead(container, 'source', 'target', 'Source', null);
    expect(commitChanges).not.toHaveBeenCalled();
  });
});
