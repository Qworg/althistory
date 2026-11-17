import { describe, it, expect } from 'vitest';
import { derivedLinkId } from './CausalLinkIdMigration';

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
