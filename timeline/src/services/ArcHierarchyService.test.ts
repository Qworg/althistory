import { describe, it, expect } from 'vitest';
import { ArcHierarchyPlan, namedParent, type ArcNode } from './ArcHierarchyService';

const node = (id: string, level: number, parent: string | null = null): ArcNode => ({ id, name: id, level, parent, metaParent: parent });
const plan = (...nodes: ArcNode[]) => new ArcHierarchyPlan(new Map(nodes.map((n) => [n.id, n])));
const levels = (p: ArcHierarchyPlan, ...ids: string[]) => ids.map((id) => [p.get(id)?.level, p.get(id)?.parent]);

describe('namedParent', () => {
  it('reads either spelling, and null for a cleared parent', () => {
    expect(namedParent({})).toBeUndefined();
    expect(namedParent({ metadata: { other: 1 } })).toBeUndefined();
    expect(namedParent({ metadata: { parentArcId: 'A' } })).toEqual({ value: 'A', via: 'metadata' });
    expect(namedParent({ parent_arc_id: 'A' })).toEqual({ value: 'A', via: 'field' });
    expect(namedParent({ parent_arc_id: null })).toEqual({ value: null, via: 'field' });
    expect(namedParent({ metadata: { parentArcId: '' } })).toEqual({ value: null, via: 'metadata' });
  });
});

describe('ArcHierarchyPlan', () => {
  it('moves a subtree with its root and judges only the end state', () => {
    const p = plan(node('A', 0), node('B', 1, 'A'), node('C', 2, 'B'));
    // Child first: transiently invalid, valid once the parent moves.
    p.update('C', { level: 3 });
    expect(p.problems()).not.toEqual([]);
    p.update('B', { level: 2, metadata: { parentArcId: 'A' }, parent_arc_id: undefined });
    expect(levels(p, 'B', 'C')).toEqual([[2, 'A'], [3, 'B']]);
    // B (2) under A (0) does not fit; the end state is judged.
    expect(p.problems()).toHaveLength(1);
  });

  it('sets a descendant to its parent\'s level + 1, three deep', () => {
    const p = plan(node('A', 0), node('B', 1, 'A'), node('C', 2, 'B'), node('D', 3, 'C'));
    p.update('B', { level: 0 });
    expect(levels(p, 'B', 'C', 'D')).toEqual([[0, null], [1, 'B'], [2, 'C']]);
    expect(p.problems()).toEqual([]);
  });

  it('refuses itself, a descendant and an unknown parent, at any level', () => {
    for (const [id, parent] of [['A', 'A'], ['A', 'C'], ['B', 'nowhere']] as const) {
      const p = plan(node('A', 0), node('B', 1, 'A'), node('C', 2, 'B'));
      p.update(id, { metadata: { parentArcId: parent } });
      expect(p.problems().length).toBeGreaterThan(0);
      expect(() => p.validate()).toThrow(/hierarchy would not be valid/);
    }
  });

  it('lifts the children of a deleted arc, and their subtree', () => {
    const p = plan(node('G', 0), node('P', 1, 'G'), node('C', 2, 'P'), node('D', 3, 'C'));
    expect(p.delete('P')).toEqual(['C']);
    expect(levels(p, 'C', 'D')).toEqual([[1, 'G'], [2, 'C']]);
    expect(p.get('P')).toBeNull();
    expect(p.problems()).toEqual([]);
    expect(p.delete('G')).toEqual(['C']);
    expect(levels(p, 'C', 'D')).toEqual([[0, null], [1, 'C']]);
  });

  it('terminates on a stored cycle', () => {
    const p = plan(node('X', 1, 'Y'), node('Y', 1, 'X'), node('Z', 0));
    expect(() => p.update('X', { level: 4 })).not.toThrow();
    expect(() => p.delete('X')).not.toThrow();
    expect(() => p.update('Z', { level: 0 })).not.toThrow();
  });

  it('treats a stale metadata parent as no move, and a field parent as the export reads it', () => {
    const stale: ArcNode = { id: 'C', name: 'C', level: 1, parent: 'B', metaParent: 'A' };
    const p = plan(node('A', 0), node('B', 0), stale);
    p.update('C', { metadata: { parentArcId: 'A' } });
    expect(p.get('C')?.parent).toBe('B');
    p.update('C', { metadata: { parentArcId: 'A' }, parent_arc_id: 'A' });
    expect(p.get('C')?.parent).toBe('A');
  });
});
