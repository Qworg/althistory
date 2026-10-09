/**
 * Unit tests for CLI Ingestion (Phase 2).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DirectEngine } from './engine/DirectEngine';
import { clusterEventsIntoArcs } from './generator/arcClustering';
import { ExtractedEvent } from '../services/ingestion/types';

const mockSource = {
  type: 'text' as const,
  extractedAt: '2026-01-01T00:00:00Z',
};

describe('CLI Arc Clustering (clusterEventsIntoArcs)', () => {
  it('returns empty array when events list is empty', () => {
    const arcs = clusterEventsIntoArcs([], mockSource);
    expect(arcs).toEqual([]);
  });

  it('clusters events within proximity threshold into a single arc', () => {
    const events: ExtractedEvent[] = [
      {
        tempId: 'e-1',
        description: 'First event in 1775',
        actor: 'American Patriots',
        target: 'British Army',
        timestamp: '1775-04-19T00:00:00Z',
        confidence: 0.9,
        source: mockSource,
        selected: true,
        edited: false,
      },
      {
        tempId: 'e-2',
        description: 'Second event in 1776',
        actor: 'Continental Congress',
        target: 'King George III',
        timestamp: '1776-07-04T00:00:00Z',
        confidence: 0.9,
        source: mockSource,
        selected: true,
        edited: false,
      },
    ];

    const arcs = clusterEventsIntoArcs(events, mockSource);
    expect(arcs).toHaveLength(1);
    expect(arcs[0].start_time).toBe('1775-04-19T00:00:00Z');
    expect(arcs[0].end_time).toBe('1776-07-04T00:00:00Z');
    expect(arcs[0].name).toContain('American Patriots');
  });

  it('clusters distant events into separate arcs', () => {
    const events: ExtractedEvent[] = [
      {
        tempId: 'e-1',
        description: 'Battle of Hastings',
        actor: 'Normans',
        target: 'Anglo-Saxons',
        timestamp: '1066-10-14T00:00:00Z',
        confidence: 0.9,
        source: mockSource,
        selected: true,
        edited: false,
      },
      {
        tempId: 'e-2',
        description: 'Moon landing',
        actor: 'NASA',
        target: 'Moon',
        timestamp: '1969-07-20T00:00:00Z',
        confidence: 0.9,
        source: mockSource,
        selected: true,
        edited: false,
      },
    ];

    const arcs = clusterEventsIntoArcs(events, mockSource);
    expect(arcs).toHaveLength(2);
    expect(arcs[0].start_time).toBe('1066-10-14T00:00:00Z');
    expect(arcs[1].start_time).toBe('1969-07-20T00:00:00Z');
  });
});

describe('DirectEngine Ingestion', () => {
  let engine: DirectEngine;

  beforeEach(() => {
    engine = new DirectEngine();
  });

  afterEach(async () => {
    await engine.shutdown();
  });

  it('ingests pattern-based text with dry-run without writing to graph', async () => {
    const text = 'The Treaty of Paris was signed on 10 February 1763 by representatives of Great Britain and France.';
    const result = await engine.ingestText(undefined, text, {
      mode: 'pattern',
      dryRun: true,
      graphName: 'Dry Run Graph',
    });

    expect(result.dryRun).toBe(true);
    expect(result.eventsCreated).toBe(1);
    expect(result.entities.events).toHaveLength(1);
    expect(result.entities.events[0].actor).toBe('Treaty of Paris');
    expect(result.entities.events[0].target).toBe('Great Britain');

    // Because dryRun is true, the created graph should have 0 persisted events
    const graphEvents = await engine.listEvents(result.graphId);
    expect(graphEvents).toHaveLength(0);
  });

  it('ingests and persists events with arc grouping', async () => {
    const text =
      'The Treaty of Paris was signed on 10 February 1763 by representatives of Great Britain and France. The Treaty of Versailles was signed on 3 September 1783 by representatives of the United States.';
    const result = await engine.ingestText(undefined, text, {
      mode: 'pattern',
      dryRun: false,
      groupArcs: true,
      graphName: 'Persisted Ingestion',
    });

    expect(result.dryRun).toBe(false);
    expect(result.eventsCreated).toBe(2);
    expect(result.arcsCreated).toBe(2);

    const persistedEvents = await engine.listEvents(result.graphId);
    expect(persistedEvents.length).toBeGreaterThanOrEqual(2);

    const persistedArcs = await engine.listArcs(result.graphId);
    expect(persistedArcs.length).toBeGreaterThanOrEqual(1);
  });
});
