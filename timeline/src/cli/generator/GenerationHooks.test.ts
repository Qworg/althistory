/**
 * Progress and cancellation of a generation run (issue 23): the app runs the
 * generator as a cancellable job, so the generator reports as it writes and
 * stops at its next write when asked to.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DirectEngine } from '../engine/DirectEngine';
import { TimelineGenerator } from './TimelineGenerator';
import {
  GenerationCancelledError,
  GenerationRun,
  type GenerationProgress,
} from './GenerationHooks';

describe('GenerationRun', () => {
  it('is inert without hooks', () => {
    const run = new GenerationRun();
    expect(() => run.checkpoint()).not.toThrow();
    expect(() => run.report('planning', 'x')).not.toThrow();
  });

  it('stops at a checkpoint once aborted, saying what was written', () => {
    const controller = new AbortController();
    const run = new GenerationRun({ signal: controller.signal });
    run.written.events = 2;
    controller.abort();
    try {
      run.checkpoint();
      expect.unreachable('the checkpoint should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(GenerationCancelledError);
      expect((error as GenerationCancelledError).written.events).toBe(2);
    }
  });

  it('ignores a listener that throws', () => {
    const run = new GenerationRun({
      onProgress: () => {
        throw new Error('listener failed');
      },
    });
    expect(() => run.report('events', 'x')).not.toThrow();
  });

  it('measures the writes against the plan, a tenth in at the first write', () => {
    const seen: number[] = [];
    const run = new GenerationRun({ onProgress: (p) => seen.push(p.fraction) });
    run.plan({ events: 2, arcs: 1, relationships: 1 });
    run.report('graph', 'made');
    run.written.arcs = 1;
    run.written.events = 2;
    run.written.relationships = 1;
    run.report('links', 'all');
    expect(seen[0]).toBeCloseTo(0.1);
    expect(seen[1]).toBeCloseTo(1);
  });
});

describe('TimelineGenerator hooks', () => {
  let engine: DirectEngine;

  beforeEach(() => {
    engine = new DirectEngine();
  });

  afterEach(async () => {
    await engine.shutdown();
  });

  it('reports the graph, then arcs, then events, then links, and says who wrote the events', async () => {
    const container = await engine.getContainer();
    const progress: GenerationProgress[] = [];
    const result = await new TimelineGenerator().generateTimeline(
      {
        premise: 'What if the tide never turned?',
        divergencePoint: 'The sea wall holds in 1200',
        eventCount: 4,
        graphName: 'Hooks order',
      },
      container,
      { onProgress: (p) => progress.push(p) }
    );

    const phases = progress.map((p) => p.phase);
    const firstOf = (phase: string): number => phases.indexOf(phase as GenerationProgress['phase']);
    expect(firstOf('graph')).toBeGreaterThan(firstOf('drafting'));
    expect(firstOf('arcs')).toBeGreaterThan(firstOf('graph'));
    expect(firstOf('events')).toBeGreaterThan(firstOf('arcs'));
    expect(firstOf('links')).toBeGreaterThan(firstOf('events'));
    expect(phases[phases.length - 1]).toBe('done');

    // The graph is named as soon as it exists, and the source with it.
    const graphReport = progress[firstOf('graph')];
    expect(graphReport.graphId).toBe(result.graphId);
    expect(graphReport.source).toBe('template');

    // Monotone, and complete at the end.
    const fractions = progress.map((p) => p.fraction);
    expect([...fractions].sort((a, b) => a - b)).toEqual(fractions);
    expect(fractions[fractions.length - 1]).toBe(1);
    expect(progress[progress.length - 1].written).toEqual({
      events: result.eventCount,
      arcs: result.arcCount,
      relationships: result.relationshipCount,
    });
  });

  it('writes events one at a time, so a watcher sees the graph fill in', async () => {
    const container = await engine.getContainer();
    const eventCounts: number[] = [];
    await new TimelineGenerator().generateTimeline(
      { premise: 'What if?', divergencePoint: 'A turning point', eventCount: 5, graphName: 'Fill in' },
      container,
      { onProgress: (p) => p.phase === 'events' && eventCounts.push(p.written.events) }
    );
    expect(eventCounts).toEqual([1, 2, 3, 4, 5]);
  });

  it('stops before its next write when cancelled, and what was written stays', async () => {
    const container = await engine.getContainer();
    const controller = new AbortController();
    let graphId: string | undefined;
    const run = new TimelineGenerator().generateTimeline(
      { premise: 'What if?', divergencePoint: 'A turning point', eventCount: 6, graphName: 'Cancelled draft' },
      container,
      {
        signal: controller.signal,
        onProgress: (p) => {
          graphId = p.graphId ?? graphId;
          if (p.phase === 'events' && p.written.events === 2) controller.abort();
        },
      }
    );

    await expect(run).rejects.toMatchObject({
      name: 'GenerationCancelledError',
      written: { events: 2 },
    });
    expect(graphId).toBeDefined();
    const events = await engine.listEvents(graphId as string);
    expect(events).toHaveLength(2);
    // The links were never written.
    expect(await engine.listCausalLinks(graphId as string)).toHaveLength(0);
  });

  it('writes nothing when cancelled before the graph is made', async () => {
    const container = await engine.getContainer();
    const before = (await engine.listGraphs()).length;
    const controller = new AbortController();
    controller.abort();
    await expect(
      new TimelineGenerator().generateTimeline(
        { premise: 'What if?', divergencePoint: 'A turning point', eventCount: 3, graphName: 'Never made' },
        container,
        { signal: controller.signal }
      )
    ).rejects.toBeInstanceOf(GenerationCancelledError);
    expect((await engine.listGraphs()).length).toBe(before);
  });

  it('reports a branch and an expansion as they write, and names an expansion a template', async () => {
    const container = await engine.getContainer();
    const base = await new TimelineGenerator().generateTimeline(
      { premise: 'Base', divergencePoint: 'A', eventCount: 4, graphName: 'Hooks base' },
      container
    );

    const branchPhases: string[] = [];
    const branch = await new TimelineGenerator().generateBranch(
      {
        sourceGraphId: base.graphId,
        divergeAtEventId: base.events[1].id,
        counterfactualPrompt: 'The other way',
        branchName: 'Hooks branch',
        eventCount: 3,
      },
      container,
      { onProgress: (p) => branchPhases.push(p.phase) }
    );
    expect(branchPhases).toContain('graph');
    expect(branchPhases).toContain('events');
    expect(branchPhases[branchPhases.length - 1]).toBe('done');
    expect(branch.source).toBe('template');

    const expandPhases: string[] = [];
    const expanded = await new TimelineGenerator().generateExpand(
      { graphId: base.graphId, eventCount: 3 },
      container,
      { onProgress: (p) => expandPhases.push(p.phase) }
    );
    expect(expandPhases).toEqual(['planning', 'arcs', 'events', 'events', 'events', 'done']);
    expect(expanded.source).toBe('template');
  });
});
