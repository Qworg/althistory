import { describe, it, expect, vi } from 'vitest';
import { derivedLinkId, migrateCausalLinkIds, LINK_ID_UPGRADE_USER } from './CausalLinkIdMigration';

describe('derivedLinkId', () => {
  const edge = { graphId: 'g1', cause: 'a', effect: 'b', createdAt: '2020-01-01T00:00:00Z', element: '5:abc:7' };

  it('is the same on every call, and looks like a link id', () => {
    expect(derivedLinkId(edge)).toBe(derivedLinkId({ ...edge }));
    expect(derivedLinkId(edge)).toMatch(/^link_[0-9a-f]{24}$/);
  });

  it('is not the same for a different edge that was handed the same elementId (Neo4j reuses them after a restore)', () => {
    const reused = derivedLinkId(edge);
    expect(derivedLinkId({ ...edge, createdAt: '2021-06-01T00:00:00Z' })).not.toBe(reused);
    expect(derivedLinkId({ ...edge, cause: 'c' })).not.toBe(reused);
    expect(derivedLinkId({ ...edge, effect: 'c' })).not.toBe(reused);
    expect(derivedLinkId({ ...edge, graphId: 'g2' })).not.toBe(reused);
    expect(derivedLinkId({ ...edge, createdAt: null })).not.toBe(reused);
  });
});

describe('the migration versions its reconciliation', () => {
  it('asks recordBatch to reconcile the pairs it reports, so a head link the graph no longer holds is dropped', async () => {
    const record = (values: Record<string, unknown>) => ({ get: (key: string) => values[key] });
    const run = vi.fn(async (query: string) => {
      if (query.includes('r.id IS NULL')) {
        return { records: [record({ element: 'el1', graphId: 'g1', cause: 'a', effect: 'b', createdAt: null, evidence: 'because', type: 'direct', weight: 0.5, confidence: 0.7 })] };
      }
      return { records: [] };
    });
    const recordBatch = vi.fn(async () => undefined);
    await migrateCausalLinkIds({
      openSession: () => ({ run, close: async () => undefined }),
      // The head holds a link on a pair (x, y) that the graph has no edge for.
      headLinks: async () => ({ stale: { cause_event_id: 'x', effect_event_id: 'y' } }),
      versioning: { recordBatch },
      log: () => undefined,
      warn: () => undefined,
    });
    expect(recordBatch).toHaveBeenCalledTimes(1);
    const [graphId, state, , options] = recordBatch.mock.calls[0] as unknown as [string, { links: Array<{ cause_event_id: string; live: unknown[] }> }, unknown, Record<string, unknown>];
    expect(graphId).toBe('g1');
    expect(state.links.find((pair) => pair.cause_event_id === 'x')?.live).toEqual([]);
    expect(options).toMatchObject({ reconcilePairs: true, userId: LINK_ID_UPGRADE_USER });
  });
});
