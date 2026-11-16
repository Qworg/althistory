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

  it('moves an arc to the parent an edit names, whatever its stale metadata says', () => {
    const stale: ArcNode = { id: 'C', name: 'C', level: 1, parent: 'B', metaParent: 'A' };
    const p = plan(node('A', 0), node('B', 0), stale);
    // The head says B, the metadata A: naming A (either way) is a move to A.
    p.update('C', { metadata: { parentArcId: 'A' } });
    expect(p.get('C')?.parent).toBe('A');
    const q = plan(node('A', 0), node('B', 0), stale);
    q.update('C', { parent_arc_id: 'A' });
    expect(q.get('C')?.parent).toBe('A');
    // Naming the parent it has is no move.
    const r = plan(node('A', 0), node('B', 0), stale);
    r.update('C', { metadata: { parentArcId: 'B' } });
    expect(r.get('C')?.parent).toBe('B');
  });

  it('clears the parent and sets level 0 whichever spelling clears it', () => {
    for (const request of [{ metadata: { parentArcId: null } }, { parent_arc_id: null }] as const) {
      const p = plan(node('A', 0), node('B', 1, 'A'), node('C', 2, 'B'));
      p.update('B', request);
      expect(levels(p, 'B', 'C')).toEqual([[0, null], [1, 'B']]);
      expect(p.problems()).toEqual([]);
    }
  });

  it('refuses an arc with no parent above level 0, and a child outside its parent\'s span', () => {
    const p = plan(node('A', 0));
    p.update('A', { level: 2 });
    expect(p.problems()[0]).toMatch(/no parent but is at level 2/);
    const dated = (id: string, level: number, from: number, to: number, parent: string | null = null): ArcNode => ({ ...node(id, level, parent), start: new Date(Date.UTC(from, 0, 1)), end: new Date(Date.UTC(to, 0, 1)) });
    const q = plan(dated('G', 0, 1700, 1950), dated('P', 1, 1800, 1900, 'G'), dated('S', 1, 1910, 1940, 'G'));
    q.update('P', { metadata: { parentArcId: 'S' } });
    expect(q.problems().join(' ')).toMatch(/must lie within its parent "S"/);
  });

  it('settles an arc moved without a level the same in either step order', () => {
    for (const childFirst of [true, false]) {
      const p = plan(node('G', 0), node('S', 1, 'G'), node('C', 1, 'G'), node('D', 2, 'C'));
      const move = () => p.update('C', { metadata: { parentArcId: 'NEW' } });
      const create = () => p.create({ id: 'NEW', name: 'NEW', level: 2, metadata: { parentArcId: 'S' } });
      if (childFirst) { move(); create(); } else { create(); move(); }
      expect(p.problems()).toEqual([]);
      expect(levels(p, 'C', 'D')).toEqual([[3, 'NEW'], [4, 'C']]);
    }
  });

  it('does not make a child its own parent when a deleted arc sat in a stored cycle', () => {
    const p = plan(node('X', 1, 'Y'), node('Y', 1, 'X'));
    expect(p.delete('X')).toEqual(['Y']);
    expect(levels(p, 'Y')).toEqual([[0, null]]);
    expect(p.problems()).toEqual([]);
  });

  it('names the dates, not the level, when a span is what is wrong', () => {
    const dated = (id: string, level: number, from: number, to: number, parent: string | null = null): ArcNode => ({ ...node(id, level, parent), start: new Date(Date.UTC(from, 0, 1)), end: new Date(Date.UTC(to, 0, 1)) });
    const p = plan(dated('G', 0, 1700, 1950), dated('P', 1, 1800, 1900, 'G'));
    p.update('P', { end_time: new Date(Date.UTC(1960, 0, 1)) });
    expect(() => p.validate()).toThrow(expect.objectContaining({ field: 'start_time' }));
    const q = plan(node('A', 0));
    q.update('A', { level: 3 });
    expect(() => q.validate()).toThrow(expect.objectContaining({ field: 'level' }));
  });
});
