/**
 * Unit tests for Whole-Cloth Alternate History Timeline Generator (Phase 3).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DirectEngine } from './engine/DirectEngine';
import { TimelineGenerator } from './generator/TimelineGenerator';
import { LLMClient } from '../services/llm/LLMClient';
import { ExtractedEvent } from '../services/ingestion/types';

function createMockLLM(events: ExtractedEvent[]): LLMClient {
  return {
    provider: 'mock-llm',
    extractEvents: vi.fn().mockResolvedValue(events),
    suggestRelationships: vi.fn().mockResolvedValue([]),
    enrichDescription: vi.fn().mockResolvedValue('enriched'),
  };
}

describe('TimelineGenerator Multi-Pass Engine', () => {
  let engine: DirectEngine;

  beforeEach(() => {
    engine = new DirectEngine();
  });

  afterEach(async () => {
    await engine.shutdown();
  });

  it('generates a complete alternate history timeline in dry-run mode', async () => {
    const result = await engine.generateTimeline({
      premise: 'What if Napoleon won Waterloo?',
      divergencePoint: 'Napoleon cavalry charge succeeds on 18 June 1815',
      eventCount: 5,
      dryRun: true,
    });

    expect(result.eventCount).toBe(5);
    expect(result.events).toHaveLength(5);
    expect(result.arcs.length).toBeGreaterThanOrEqual(1);
    expect(result.relationships.length).toBeGreaterThanOrEqual(4);
    expect(result.validation.valid).toBe(true);
    expect(result.validation.errorCount).toBe(0);

    // Verify chronological progression
    for (let i = 1; i < result.events.length; i++) {
      const prev = new Date(result.events[i - 1].timestamp).getTime();
      const curr = new Date(result.events[i].timestamp).getTime();
      expect(curr).toBeGreaterThan(prev);
    }

    // Verify causal links strictly satisfy cause < effect
    const eventTimeMap = new Map(result.events.map((e) => [e.id, new Date(e.timestamp).getTime()]));
    for (const rel of result.relationships) {
      const causeTime = eventTimeMap.get(rel.causeId);
      const effectTime = eventTimeMap.get(rel.effectId);
      expect(causeTime).toBeDefined();
      expect(effectTime).toBeDefined();
      expect(causeTime!).toBeLessThan(effectTime!);
    }
  });

  it('persists generated timeline entities to graph and database', async () => {
    const result = await engine.generateTimeline({
      premise: 'What if the Library of Alexandria was never destroyed?',
      divergencePoint: 'Roman legionnaires extinguish library fire in 48 BC',
      startDate: '0048-01-01T00:00:00Z',
      eventCount: 4,
      dryRun: false,
      graphName: 'Alexandria Preservation Timeline',
    });

    expect(result.graphId).toBeDefined();
    expect(result.eventCount).toBe(4);

    // Verify persisted events in engine
    const persistedEvents = await engine.listEvents(result.graphId);
    expect(persistedEvents).toHaveLength(4);

    // Verify persisted arcs
    const persistedArcs = await engine.listArcs(result.graphId);
    expect(persistedArcs.length).toBeGreaterThanOrEqual(1);

    // Verify persisted causal relationships
    const persistedRels = await engine.listCausalLinks(result.graphId);
    expect(persistedRels.length).toBeGreaterThanOrEqual(3);
  });

  it('branches an existing graph at a pivot event', async () => {
    // First generate a base timeline
    const base = await engine.generateTimeline({
      premise: 'American Revolution',
      divergencePoint: 'Declaration of Independence in 1776',
      eventCount: 4,
      dryRun: false,
    });

    const pivotEvent = base.events[1];
    expect(pivotEvent).toBeDefined();

    // Branch from pivot event
    const branched = await engine.generateBranch({
      sourceGraphId: base.graphId,
      divergeAtEventId: pivotEvent.id,
      counterfactualPrompt: 'Continental Army surrenders at Valley Forge',
      branchName: 'British Victory Branch',
      eventCount: 4,
      dryRun: false,
    });

    expect(branched.graphId).not.toBe(base.graphId);
    expect(branched.graphName).toBe('British Victory Branch');
    expect(branched.eventCount).toBeGreaterThanOrEqual(4);

    // Verify branch link links pivot event to new divergent events
    const branchRels = await engine.listCausalLinks(branched.graphId);
    const pivotLink = branchRels.find((r) => r.causeId === pivotEvent.id);
    expect(pivotLink).toBeDefined();
  });

  it('interpolates sub-events using generateExpand', async () => {
    const base = await engine.generateTimeline({
      premise: 'Space Race',
      divergencePoint: 'Soviets land on the moon first in 1968',
      eventCount: 3,
      dryRun: false,
    });

    const expanded = await engine.generateExpand({
      graphId: base.graphId,
      eventCount: 2,
      dryRun: false,
    });

    expect(expanded.eventCount).toBe(2);
    const allEvents = await engine.listEvents(base.graphId);
    expect(allEvents.length).toBe(5); // 3 base + 2 expanded
  });

  it('simulates forward progression into the future', async () => {
    const base = await engine.generateTimeline({
      premise: 'Pax Romana',
      divergencePoint: 'Augustus centralizes empire',
      eventCount: 3,
      dryRun: false,
    });

    const simulated = await engine.generateSimulate({
      graphId: base.graphId,
      steps: 3,
      timeAdvanceMonths: 24,
      dryRun: false,
    });

    expect(simulated.eventCount).toBe(3);
    const allEvents = await engine.listEvents(base.graphId);
    expect(allEvents.length).toBe(6); // 3 base + 3 simulated
  });

  it('integrates mocked LLMClient when provided', async () => {
    const mockEvents: ExtractedEvent[] = [
      {
        tempId: 'llm-e1',
        description: 'First LLM counterfactual milestone',
        actor: 'Ottoman Empire',
        target: 'Holy Roman Empire',
        timestamp: '1683-09-12T00:00:00Z',
        confidence: 0.95,
        source: { type: 'llm', extractedAt: '2026-01-01T00:00:00Z' },
        selected: true,
        edited: false,
      },
      {
        tempId: 'llm-e2',
        description: 'Second LLM counterfactual milestone',
        actor: 'Ottoman Empire',
        target: 'Vienna',
        timestamp: '1685-05-01T00:00:00Z',
        confidence: 0.95,
        source: { type: 'llm', extractedAt: '2026-01-01T00:00:00Z' },
        selected: true,
        edited: false,
      },
      {
        tempId: 'llm-e3',
        description: 'Third LLM counterfactual milestone',
        actor: 'Treaty of Buda',
        target: 'Central Europe',
        timestamp: '1690-01-01T00:00:00Z',
        confidence: 0.95,
        source: { type: 'llm', extractedAt: '2026-01-01T00:00:00Z' },
        selected: true,
        edited: false,
      },
    ];

    const mockLLM = createMockLLM(mockEvents);
    const generator = new TimelineGenerator({ llmClient: mockLLM });

    // Use a direct container to run generator with mockLLM
    const container = await engine.getContainer();
    const result = await generator.generateTimeline(
      {
        premise: 'What if Vienna fell in 1683?',
        divergencePoint: 'Ottomans breach Vienna walls on 12 September 1683',
        eventCount: 3,
        dryRun: true,
      },
      container
    );

    expect(mockLLM.extractEvents).toHaveBeenCalled();
    expect(result.eventCount).toBe(3);
    expect(result.events[0].description).toBe('First LLM counterfactual milestone');
    expect(result.events[0].actor).toBe('Ottoman Empire');
  });
});
