/**
 * Deleting an arc from the CLI lifts its child arcs (issue 28), as the API does.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DirectEngine } from './engine/DirectEngine';

describe('CLI: deleting an arc that has child arcs', () => {
  let engine: DirectEngine;
  let graphId: string;

  beforeEach(async () => {
    engine = new DirectEngine();
    graphId = (await engine.createGraph('Arc hierarchy', 'Deleting a parent')).id;
  });

  afterEach(async () => {
    await engine.deleteGraph(graphId).catch(() => undefined);
    await engine.shutdown();
  });

  it('moves the children to the deleted arc\'s parent and keeps its events, unassigned', async () => {
    const world = await engine.createArc(graphId, { name: 'World', startTime: '1700-01-01T00:00:00Z', endTime: '1950-01-01T00:00:00Z' });
    const age = await engine.createArc(graphId, { name: 'Age', startTime: '1800-01-01T00:00:00Z', endTime: '1900-01-01T00:00:00Z', parentArcId: world.id });
    const reign = await engine.createArc(graphId, { name: 'Reign', startTime: '1810-01-01T00:00:00Z', endTime: '1850-01-01T00:00:00Z', parentArcId: age.id });
    const year = await engine.createArc(graphId, { name: 'Year', startTime: '1812-01-01T00:00:00Z', endTime: '1813-01-01T00:00:00Z', parentArcId: reign.id });
    const event = await engine.createEvent(graphId, { description: 'A coronation', timestamp: '1820-01-01T00:00:00Z', actor: 'A', target: 'B' });
    await engine.assignEventToArc(graphId, event.id, age.id);

    await engine.deleteArc(graphId, age.id);

    const arcs = Object.fromEntries((await engine.listArcs(graphId)).map((a) => [a.name, [a.level, a.parentArcId]]));
    expect(arcs).toEqual({ World: [0, undefined], Reign: [1, world.id], Year: [2, reign.id] });
    expect(year.id).toBeDefined();
    const kept = await engine.getEvent(graphId, event.id);
    expect(kept.metadata?.arcId).toBeUndefined();
    await expect(engine.getArc(graphId, age.id)).rejects.toThrow(/Arc not found/);
  });

  it('makes the children of a top-level arc top level', async () => {
    const world = await engine.createArc(graphId, { name: 'World', startTime: '1700-01-01T00:00:00Z', endTime: '1950-01-01T00:00:00Z' });
    await engine.createArc(graphId, { name: 'Age', startTime: '1800-01-01T00:00:00Z', endTime: '1900-01-01T00:00:00Z', parentArcId: world.id });

    await engine.deleteArc(graphId, world.id);

    expect((await engine.listArcs(graphId)).map((a) => [a.name, a.level, a.parentArcId])).toEqual([['Age', 0, undefined]]);
  });
});
