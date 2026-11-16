/**
 * Deleting an arc from the CLI lifts its child arcs (issue 28), as the API does.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DirectEngine } from './engine/DirectEngine';
import { ImportService } from '@/services/ImportService';

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

    // The delete is versioned: the head and the export agree with the live store.
    const container = await (engine as unknown as { getInitializedContainer(): Promise<import('@/container').Container> }).getInitializedContainer();
    const head = await container.graphRepository.checkout(graphId);
    expect(Object.keys(head.arcs).sort()).toEqual([world.id, reign.id, year.id].sort());
    expect(head.arcs[reign.id]).toMatchObject({ level: 1 });
    expect(head.arcs[year.id]).toMatchObject({ level: 2 });
    expect((head.events[event.id].metadata as Record<string, unknown>).arcId).toBeUndefined();
    const document = await container.exportService.exportGraph({ graphId, scope: 'full', includeProvenance: false });
    const checked = await new ImportService({ dataDir: container.config.localExecution.dataDirectory }).validateFormat(document.export);
    expect(checked.errors).toEqual([]);
    expect(Object.fromEntries(document.export.data.arcs.map((a) => [a.name, [a.level, a.parent_arc_id]]))).toEqual({
      World: [0, null],
      Reign: [1, world.id],
      Year: [2, reign.id],
    });
  });

  it('makes the children of a top-level arc top level', async () => {
    const world = await engine.createArc(graphId, { name: 'World', startTime: '1700-01-01T00:00:00Z', endTime: '1950-01-01T00:00:00Z' });
    await engine.createArc(graphId, { name: 'Age', startTime: '1800-01-01T00:00:00Z', endTime: '1900-01-01T00:00:00Z', parentArcId: world.id });

    await engine.deleteArc(graphId, world.id);

    expect((await engine.listArcs(graphId)).map((a) => [a.name, a.level, a.parentArcId])).toEqual([['Age', 0, undefined]]);
  });

  it('validate --fix expands an arc to hold its event, but never outside the parent the head names', async () => {
    const container = await (engine as unknown as { getInitializedContainer(): Promise<import('@/container').Container> }).getInitializedContainer();
    const iso = (year: number): string => `${year}-01-01T00:00:00.000Z`;
    const arc = (id: string, level: number, from: number, to: number, parent: string | null) => ({
      type: 'arc' as const,
      id,
      data: { id, name: id, description: id, start_time: iso(from), end_time: iso(to), level, parent_arc_id: parent },
    });
    const event = (id: string, year: number, arcId: string) => ({
      type: 'event' as const,
      id,
      data: { id, description: id, actor: 'A', target: 'B', timestamp: iso(year), metadata: { arcId } },
    });
    // Imported arcs: their parents are in the head only.
    await container.graphRepository.commitChanges(
      graphId,
      { added: [arc('G', 0, 1700, 1950, null), arc('P', 1, 1800, 1900, 'G'), arc('C1', 2, 1810, 1850, 'P'), arc('C2', 2, 1810, 1850, 'P'), event('e1', 1860, 'C1'), event('e2', 1920, 'C2')], modified: [], deleted: [] },
      'import',
      'An import'
    );
    await container.liveStoreSyncService.materialize(graphId, 'import');

    const report = await engine.validateGraph(graphId, false, true);

    expect(report.repairsApplied?.join('\n')).toMatch(/Expanded arc "C1"/);
    expect(report.repairFailures?.join('\n')).toMatch(/Did not expand arc "C2".*must lie within its parent "P"/);
    const head = await container.graphRepository.checkout(graphId);
    // The repair is versioned, and the arc that could not grow is as it was.
    expect(head.arcs.C1.end_time).toBe(iso(1860));
    expect(head.arcs.C2.end_time).toBe(iso(1850));
    const { arcRepository } = await container.graphScopedRepositories(graphId);
    expect((await arcRepository.findById('C2'))?.end_time.toISOString()).toBe(iso(1850));
  });
});
