import { describe, it, expect } from 'vitest';
import { arcPlacementsOfCopy, placedArcData } from './copyHierarchy';

const arc = (id: string, parent: string | null, level: number) => ({ id, parent, level });

describe('arcPlacementsOfCopy (#35)', () => {
  it('changes nothing when every parent was copied', () => {
    expect(arcPlacementsOfCopy([arc('a', null, 0), arc('b', 'a', 1), arc('c', 'b', 2)]).size).toBe(0);
  });

  it('leaves a top-level arc at its level, whatever it is', () => {
    expect(arcPlacementsOfCopy([arc('a', null, 2)]).size).toBe(0);
  });

  it('makes an arc whose parent was not copied a top-level arc, and brings its copied descendants down with it', () => {
    const placements = arcPlacementsOfCopy([arc('b', 'a', 1), arc('c', 'b', 2), arc('d', 'c', 3), arc('x', null, 0), arc('y', 'x', 1)]);
    expect([...placements]).toEqual([
      ['b', { parent: null, level: 0 }],
      ['c', { parent: 'b', level: 1 }],
      ['d', { parent: 'c', level: 2 }],
    ]);
  });

  it('is not led astray by a hierarchy that loops', () => {
    const placements = arcPlacementsOfCopy([arc('a', 'b', 1), arc('b', 'a', 1), arc('c', 'gone', 1)]);
    expect([...placements.keys()]).toEqual(['c']);
  });
});

describe('placedArcData (#35)', () => {
  it('removes the parent key when the arc has no parent, and sets it when it has one', () => {
    const arc = { level: 2, parent_arc_id: 'gone', metadata: { parentArcId: 'gone', keep: 1 } };
    const top = placedArcData(arc, { parent: null, level: 0 });
    expect(top).toEqual({ level: 0, parent_arc_id: null, metadata: { keep: 1 } });
    expect(top.metadata).not.toHaveProperty('parentArcId');
    expect(placedArcData(arc, { parent: 'mid', level: 1 })).toEqual({ level: 1, parent_arc_id: 'mid', metadata: { parentArcId: 'mid', keep: 1 } });
    // The arc is not changed, and an arc without metadata still gets some.
    expect(arc.metadata.parentArcId).toBe('gone');
    expect((placedArcData({ level: 1 } as { level: number; metadata?: unknown }, { parent: null, level: 0 })).metadata).toEqual({});
  });
});
