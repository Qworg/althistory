/**
 * The demo seed (`media/src/seed`) posts its arcs to a real API, so each must
 * obey the arc hierarchy: an arc with no parent is level 0, a child is one level
 * below a parent that holds it. A seed that breaks it fails `npm run media`.
 */

import { describe, it, expect } from 'vitest';
import { deep, scenario, world, type ArcSeed } from '../../../media/src/seed/scenario';
import { ArcHierarchyPlan, type ArcNode } from '@/services/ArcHierarchyService';

/** The seed's arcs, created as `createArcs` does: parents first, each naming its parent's id. */
function judge(arcs: ArcSeed[], dated: boolean): string[] {
  const plan = new ArcHierarchyPlan(new Map<string, ArcNode>());
  for (const arc of [...arcs].sort((a, b) => a.level - b.level)) {
    plan.create({
      id: arc.key,
      name: arc.key,
      level: arc.level,
      parent_arc_id: arc.parent ?? null,
      ...(dated ? { start_time: arc.start, end_time: arc.end } : {}),
    });
  }
  return plan.problems();
}

describe('the demo seed', () => {
  it('The Engine Age: a root is level 0, the telegraph arc sits one level under the offices and within their span', () => {
    expect(judge(scenario.arcs, true)).toEqual([]);
    expect(Object.fromEntries(scenario.arcs.map((arc) => [arc.key, arc.level]))).toEqual({ build: 0, offices: 0, telegraph: 1, reaction: 0 });
  });

  it('Vael and the deep-time graph have a valid hierarchy', () => {
    expect(judge(world.arcs, false)).toEqual([]);
    expect(judge(deep.arcs, false)).toEqual([]);
  });
});
