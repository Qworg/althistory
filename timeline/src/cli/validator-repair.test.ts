/**
 * The self-healing repair of a temporally inverted causal link.
 *
 * The repair used to add the reversed link and keep the original, which left
 * a two-node cycle in place of the single paradox it was asked to repair.
 * These tests check the link is replaced, not duplicated, and that the graph
 * validates clean afterwards.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DirectEngine } from './engine/DirectEngine';
import { GraphValidator, ScopedGraphServices } from './validation/GraphValidator';
import { Event } from '@/models';
import { CausalRelationship } from '@/models/relationships';

interface MockRelationship {
  id: string;
  cause_event_id: string;
  effect_event_id: string;
  weight: number;
  confidence: number;
  evidence: string;
  relationship_type: string;
}

/**
 * A store that behaves like the one the direct engine writes to: a link is
 * created, deleted and read by the pair it connects.
 */
function createMockStore(events: Event[], relationships: MockRelationship[]): ScopedGraphServices {
  const rels = [...relationships];

  return {
    eventRepository: {
      findAll: async () => events,
      findById: async (id) => events.find((e) => e.id === id) || null,
      update: async () => null,
      delete: async () => true,
    },
    arcRepository: {
      findAll: async () => [],
      findById: async () => null,
      update: async () => null,
      delete: async () => true,
    },
    causalService: {
      getAllRelationships: async () => rels,
      createCausalLink: async (cause: Event, effect: Event, relationship: CausalRelationship) => {
        rels.push({
          id: `rel-${rels.length + 1}`,
          cause_event_id: cause.id,
          effect_event_id: effect.id,
          weight: relationship.weight,
          confidence: relationship.confidence,
          evidence: relationship.evidence,
          relationship_type: relationship.relationship_type,
        });
        return undefined;
      },
      deleteCausalLink: async (causeId: string, effectId: string) => {
        const index = rels.findIndex(
          (r) => r.cause_event_id === causeId && r.effect_event_id === effectId
        );
        if (index >= 0) rels.splice(index, 1);
        return true;
      },
    },
  };
}

describe('GraphValidator auto-repair of an inverted causal link', () => {
  it('replaces the inverted link instead of adding a reversed one next to it', async () => {
    const events = [
      new Event({ id: 'c1', description: 'Earlier', timestamp: new Date('2000-01-01'), actor: 'A', target: 'B' }),
      new Event({ id: 'c2', description: 'Later', timestamp: new Date('2001-01-01'), actor: 'A', target: 'B' }),
    ];
    // The cause comes after the effect: a temporal paradox.
    const relationships: MockRelationship[] = [
      {
        id: 'r1',
        cause_event_id: 'c2',
        effect_event_id: 'c1',
        weight: 0.9,
        confidence: 0.9,
        evidence: 'recorded backwards',
        relationship_type: 'direct',
      },
    ];
    const store = createMockStore(events, relationships);
    const validator = new GraphValidator();

    const report = await validator.validate('mock-graph', store, { autoRepair: true });

    expect(report.repaired).toBe(true);
    expect(report.repairsApplied?.some((repair) => repair.includes('Reversed'))).toBe(true);

    const links = await store.causalService.getAllRelationships();
    expect(links).toHaveLength(1);
    expect(links[0].cause_event_id).toBe('c1');
    expect(links[0].effect_event_id).toBe('c2');

    // The repaired graph validates clean: no paradox, and no two-node cycle.
    const after = await validator.validate('mock-graph', store);
    expect(after.valid).toBe(true);
    expect(after.errorCount).toBe(0);
    expect(after.issues.filter((issue) => issue.type === 'causal_cycle')).toHaveLength(0);
    expect(after.issues.filter((issue) => issue.type === 'causal_direction')).toHaveLength(0);
  });
});

describe('Cross-graph referential integrity', () => {
  let engine: DirectEngine;
  let graphId: string;
  let otherGraphId: string;

  beforeEach(async () => {
    engine = new DirectEngine();
    graphId = (await engine.createGraph('The Graph Under Test')).id;
    otherGraphId = (await engine.createGraph('The Neighbouring Graph')).id;
  });

  afterEach(async () => {
    for (const id of [graphId, otherGraphId]) {
      try {
        await engine.deleteGraph(id);
      } catch {
        // Best effort cleanup
      }
    }
    await engine.shutdown();
  });

  it('names the graph a broken reference points into', async () => {
    const arcInTheOtherGraph = await engine.createArc(otherGraphId, {
      name: 'An arc that lives elsewhere',
      startTime: '1900-01-01T00:00:00Z',
      endTime: '1950-01-01T00:00:00Z',
    });

    // The event names an arc that is not in its own graph.
    await engine.createEvent(graphId, {
      description: 'An event that points across graphs',
      timestamp: '1910-01-01T00:00:00Z',
      actor: 'A',
      target: 'B',
      metadata: { arcId: arcInTheOtherGraph.id },
    });

    const report = await engine.validateGraph(graphId);

    expect(report.valid).toBe(false);
    const issue = report.issues.find((entry) => entry.type === 'cross_graph_reference');
    expect(issue).toBeDefined();
    expect(issue?.message).toContain(otherGraphId);
  });
});

describe('DirectEngine auto-repair of an inverted causal link', () => {
  let engine: DirectEngine;
  let graphId: string;

  beforeEach(async () => {
    engine = new DirectEngine();
    const graph = await engine.createGraph('Auto Repair Test');
    graphId = graph.id;
  });

  afterEach(async () => {
    try {
      await engine.deleteGraph(graphId);
    } catch {
      // Best effort cleanup
    }
    await engine.shutdown();
  });

  it('leaves a graph that validates clean after repairing a paradox', async () => {
    const earlier = await engine.createEvent(graphId, {
      description: 'The earlier milestone',
      timestamp: '1900-01-01T00:00:00Z',
      actor: 'A',
      target: 'B',
    });
    const later = await engine.createEvent(graphId, {
      description: 'The later milestone',
      timestamp: '1950-01-01T00:00:00Z',
      actor: 'A',
      target: 'B',
    });

    // The link is written the right way round and the earlier event is then
    // moved after the later one, which is how a paradox reaches the store.
    await engine.createCausalLink(graphId, { causeId: earlier.id, effectId: later.id });
    await engine.updateEvent(graphId, earlier.id, { timestamp: '1980-01-01T00:00:00Z' });

    const before = await engine.validateGraph(graphId);
    expect(before.valid).toBe(false);
    expect(before.issues.some((issue) => issue.type === 'causal_direction')).toBe(true);

    const repaired = await engine.validateGraph(graphId, false, true);
    expect(repaired.repaired).toBe(true);
    expect(repaired.valid).toBe(true);
    expect(repaired.errorCount).toBe(0);

    const links = await engine.listCausalLinks(graphId);
    expect(links).toHaveLength(1);
    expect(links[0].causeId).toBe(later.id);
    expect(links[0].effectId).toBe(earlier.id);

    const after = await engine.validateGraph(graphId);
    expect(after.valid).toBe(true);
    expect(after.issues.filter((issue) => issue.type === 'causal_cycle')).toHaveLength(0);
  });
});

/**
 * A store that behaves like the Neo4j one: a delete removes every link
 * between the two events at once, and a delete of a link that is not there
 * answers that it is not there.
 */
function createCloudLikeStore(
  events: Event[],
  relationships: MockRelationship[]
): { store: ScopedGraphServices; links: () => MockRelationship[] } {
  let rels = [...relationships];

  const store: ScopedGraphServices = {
    eventRepository: {
      findAll: async () => events,
      findById: async (id) => events.find((e) => e.id === id) || null,
      update: async () => null,
      delete: async () => true,
    },
    arcRepository: {
      findAll: async () => [],
      findById: async () => null,
      update: async () => null,
      delete: async () => true,
    },
    causalService: {
      getAllRelationships: async () => rels,
      createCausalLink: async (cause: Event, effect: Event, relationship: CausalRelationship) => {
        rels.push({
          id: `rel-${rels.length + 1}`,
          cause_event_id: cause.id,
          effect_event_id: effect.id,
          weight: relationship.weight,
          confidence: relationship.confidence,
          evidence: relationship.evidence,
          relationship_type: relationship.relationship_type,
        });
        return undefined;
      },
      deleteCausalLink: async (causeId: string, effectId: string) => {
        const matches = rels.filter(
          (r) => r.cause_event_id === causeId && r.effect_event_id === effectId
        );
        if (matches.length === 0) {
          const error = new Error(
            `Causal relationship from ${causeId} to ${effectId} not found`
          );
          error.name = 'NotFoundError';
          throw error;
        }
        rels = rels.filter(
          (r) => !(r.cause_event_id === causeId && r.effect_event_id === effectId)
        );
        return true;
      },
    },
  };

  return { store, links: () => rels };
}

describe('GraphValidator auto-repair of many paradoxes', () => {
  it('repairs every paradox without breaking a cycle to do it', async () => {
    // Twelve paradoxes: the repair used to leave a two-node cycle behind each
    // one, and the cycle breaker that cleaned them up was allowed ten passes,
    // so two of the cycles used to survive. The repair has to remove the
    // paradox on its own, without the cycle breaker.
    const events: Event[] = [];
    const relationships: MockRelationship[] = [];

    for (let index = 0; index < 12; index++) {
      const earlier = new Event({
        id: `early-${index}`,
        description: `The earlier milestone ${index}`,
        timestamp: new Date(`190${index % 10}-01-01T00:00:00Z`),
        actor: 'A',
        target: 'B',
      });
      const later = new Event({
        id: `late-${index}`,
        description: `The later milestone ${index}`,
        timestamp: new Date(`195${index % 10}-01-01T00:00:00Z`),
        actor: 'A',
        target: 'B',
      });
      events.push(earlier, later);
      relationships.push({
        id: `r${index}`,
        cause_event_id: later.id,
        effect_event_id: earlier.id,
        weight: 0.9,
        confidence: 0.9,
        evidence: 'recorded backwards',
        relationship_type: 'direct',
      });
    }

    const store = createMockStore(events, relationships);
    const validator = new GraphValidator();

    const report = await validator.validate('mock-graph', store, { autoRepair: true });

    const links = await store.causalService.getAllRelationships();
    expect(links).toHaveLength(12);
    for (const link of links) {
      const cause = events.find((event) => event.id === link.cause_event_id);
      const effect = events.find((event) => event.id === link.effect_event_id);
      expect(cause?.timestamp.getTime()).toBeLessThan(effect?.timestamp.getTime() ?? 0);
    }

    // The cycle breaker did not have to run: the paradoxes were repaired
    // where they were.
    const cycleRepairs = report.repairsApplied?.filter((repair) => repair.includes('break cycle')) ?? [];
    expect(cycleRepairs).toHaveLength(0);

    const after = await validator.validate('mock-graph', store);
    expect(after.valid).toBe(true);
    expect(after.errorCount).toBe(0);
    expect(after.issues.filter((issue) => issue.type === 'causal_cycle')).toHaveLength(0);
  });

  it('does not add the reversed link twice when the store removes every link at once', async () => {
    const events = [
      new Event({ id: 'c1', description: 'Earlier', timestamp: new Date('2000-01-01'), actor: 'A', target: 'B' }),
      new Event({ id: 'c2', description: 'Later', timestamp: new Date('2001-01-01'), actor: 'A', target: 'B' }),
    ];
    // Two paradoxical links between the same pair of events.
    const relationships: MockRelationship[] = [
      {
        id: 'r1',
        cause_event_id: 'c2',
        effect_event_id: 'c1',
        weight: 0.9,
        confidence: 0.9,
        evidence: 'recorded backwards',
        relationship_type: 'direct',
      },
      {
        id: 'r2',
        cause_event_id: 'c2',
        effect_event_id: 'c1',
        weight: 0.8,
        confidence: 0.8,
        evidence: 'recorded backwards again',
        relationship_type: 'direct',
      },
    ];

    const { store, links } = createCloudLikeStore(events, relationships);
    const validator = new GraphValidator();

    const report = await validator.validate('mock-graph', store, { autoRepair: true });

    // One link, pointing the right way, and the repair did not stop halfway.
    expect(report.repaired).toBe(true);
    expect(links()).toHaveLength(1);
    expect(links()[0].cause_event_id).toBe('c1');
    expect(links()[0].effect_event_id).toBe('c2');

    const after = await validator.validate('mock-graph', store);
    expect(after.valid).toBe(true);
  });

  it('carries on when the link it wants to delete cannot be deleted', async () => {
    // The daemon answers 404 when one of the ends of a link is missing, which
    // is what an orphaned link looks like from the other side -- and it
    // refuses the delete, because it looks the ends up first. The link is
    // still there afterwards.
    const events = [
      new Event({ id: 'c1', description: 'Earlier', timestamp: new Date('2000-01-01'), actor: 'A', target: 'B' }),
      new Event({ id: 'c2', description: 'Later', timestamp: new Date('2001-01-01'), actor: 'A', target: 'B' }),
    ];
    const relationships: MockRelationship[] = [
      {
        id: 'r1',
        cause_event_id: 'missing',
        effect_event_id: 'c1',
        weight: 0.9,
        confidence: 0.9,
        evidence: 'an endpoint that is gone',
        relationship_type: 'direct',
      },
      {
        id: 'r2',
        cause_event_id: 'c2',
        effect_event_id: 'c1',
        weight: 0.9,
        confidence: 0.9,
        evidence: 'recorded backwards',
        relationship_type: 'direct',
      },
    ];

    const base = createMockStore(events, relationships);
    const store: ScopedGraphServices = {
      ...base,
      causalService: {
        ...base.causalService,
        deleteCausalLink: async (causeId: string, effectId: string) => {
          if (causeId === 'missing') {
            const error = new Error('Request failed with status code 404');
            (error as Error & { response?: { status: number } }).response = { status: 404 };
            throw error;
          }
          return base.causalService.deleteCausalLink(causeId, effectId);
        },
      },
    };

    const validator = new GraphValidator();
    const report = await validator.validate('mock-graph', store, { autoRepair: true });

    // The repair did not stop at the orphan: the paradox was repaired too.
    const links = await store.causalService.getAllRelationships();
    expect(links).toHaveLength(2);
    expect(links.some((link) => link.cause_event_id === 'c1' && link.effect_event_id === 'c2')).toBe(true);
    expect(report.repairsApplied?.some((repair) => repair.includes('Reversed'))).toBe(true);

    // The orphan was not removed -- the store refused the delete -- and the
    // report says so instead of claiming that it was.
    expect(report.repairsApplied?.some((repair) => repair.includes('r1'))).toBe(false);
    const failure = report.repairFailures?.find((entry) => entry.includes('r1'));
    expect(failure).toBeDefined();
    expect(failure).toContain('still there');

    // The orphan is still reported, because it is still there.
    const after = await validator.validate('mock-graph', store);
    expect(after.issues.some((issue) => issue.type === 'orphan_reference')).toBe(true);
  });
});

describe('GraphValidator and the references that point into another graph', () => {
  it('counts a broken reference once and names the graph it points into', async () => {
    const events = [
      new Event({
        id: 'e1',
        description: 'An event that points across graphs',
        timestamp: new Date('1910-01-01'),
        actor: 'A',
        target: 'B',
        metadata: { arcId: 'arc-elsewhere' },
      }),
    ];
    const store = createMockStore(events, []);

    const validator = new GraphValidator();
    const report = await validator.validate('mock-graph', store, {
      crossGraphLookup: async (entityId) => (entityId === 'arc-elsewhere' ? 'other-graph' : undefined),
    });

    // The reference is reported once, not twice.
    expect(report.errorCount).toBe(1);
    const crossGraph = report.issues.filter((issue) => issue.type === 'cross_graph_reference');
    expect(crossGraph).toHaveLength(1);
    expect(crossGraph[0].entityType).toBe('arc');
    expect(crossGraph[0].message).toContain('other-graph');
    expect(report.issues.filter((issue) => issue.type === 'orphan_reference')).toHaveLength(0);
  });

  it('keeps a reference that points into another graph when it repairs', async () => {
    const events = [
      new Event({
        id: 'e1',
        description: 'An event that points across graphs',
        timestamp: new Date('1910-01-01'),
        actor: 'A',
        target: 'B',
        metadata: { arcId: 'arc-elsewhere' },
      }),
    ];
    const store = createMockStore(events, []);

    const validator = new GraphValidator();
    const report = await validator.validate('mock-graph', store, {
      autoRepair: true,
      crossGraphLookup: async (entityId) => (entityId === 'arc-elsewhere' ? 'other-graph' : undefined),
    });

    // The fix for a reference into another graph is to copy the arc, not to
    // delete the link, so the repair leaves the reference alone -- and says
    // that it left it alone.
    expect(report.repairsApplied?.some((repair) => repair.includes('Removed orphan arc reference'))).toBe(false);
    const failure = report.repairFailures?.find((entry) => entry.includes('arc-elsewhere'));
    expect(failure).toBeDefined();
    expect(failure).toContain('other-graph');
  });

  it('leaves a reference alone when the cross-graph lookup fails during the repair', async () => {
    // A lookup that fails is not an answer. The reference may well point at
    // an arc of another graph, so it is left alone and the failure is
    // reported -- deleting it would throw the reference away.
    const events = [
      new Event({
        id: 'e1',
        description: 'An event that points across graphs',
        timestamp: new Date('1910-01-01'),
        actor: 'A',
        target: 'B',
        metadata: { arcId: 'arc-elsewhere' },
      }),
    ];
    const base = createMockStore(events, []);
    const updates: Array<Record<string, unknown>> = [];
    const store: ScopedGraphServices = {
      ...base,
      eventRepository: {
        ...base.eventRepository,
        update: async (_id, changes) => {
          updates.push(changes as Record<string, unknown>);
          return null;
        },
      },
    };

    const validator = new GraphValidator();
    const report = await validator.validate('mock-graph', store, {
      autoRepair: true,
      crossGraphLookup: async () => {
        throw new Error('Request failed with status code 429');
      },
    });

    // The reference was not touched.
    expect(updates).toHaveLength(0);
    expect(report.repairsApplied?.some((repair) => repair.includes('Removed orphan arc reference'))).toBe(false);
    const failure = report.repairFailures?.find((entry) => entry.includes('arc-elsewhere'));
    expect(failure).toBeDefined();
    expect(failure).toContain('429');
  });

  it('keeps a causal link whose end lives in another graph', async () => {
    // The end of the link is not in this graph, but it is in a sibling one:
    // the link is not an orphan, and deleting it would throw away the only
    // thing that says where the event is.
    const events = [
      new Event({
        id: 'e1',
        description: 'An event of this graph',
        timestamp: new Date('1910-01-01'),
        actor: 'A',
        target: 'B',
      }),
    ];
    const relationships: MockRelationship[] = [
      {
        id: 'r1',
        cause_event_id: 'event-elsewhere',
        effect_event_id: 'e1',
        weight: 0.9,
        confidence: 0.9,
        evidence: 'a cause that lives elsewhere',
        relationship_type: 'direct',
      },
    ];
    const store = createMockStore(events, relationships);

    const validator = new GraphValidator();
    const report = await validator.validate('mock-graph', store, {
      autoRepair: true,
      crossGraphLookup: async (entityId) => (entityId === 'event-elsewhere' ? 'other-graph' : undefined),
    });

    const links = await store.causalService.getAllRelationships();
    expect(links).toHaveLength(1);
    expect(links[0].cause_event_id).toBe('event-elsewhere');
    expect(report.repairsApplied?.some((repair) => repair.includes('r1'))).toBe(false);
    const failure = report.repairFailures?.find((entry) => entry.includes('r1'));
    expect(failure).toBeDefined();
    expect(failure).toContain('other-graph');
  });

  it('leaves a causal link alone when the cross-graph lookup fails', async () => {
    const events = [
      new Event({
        id: 'e1',
        description: 'An event of this graph',
        timestamp: new Date('1910-01-01'),
        actor: 'A',
        target: 'B',
      }),
    ];
    const relationships: MockRelationship[] = [
      {
        id: 'r1',
        cause_event_id: 'event-elsewhere',
        effect_event_id: 'e1',
        weight: 0.9,
        confidence: 0.9,
        evidence: 'a cause that lives elsewhere',
        relationship_type: 'direct',
      },
    ];
    const store = createMockStore(events, relationships);

    const validator = new GraphValidator();
    const report = await validator.validate('mock-graph', store, {
      autoRepair: true,
      crossGraphLookup: async () => {
        throw new Error('Request failed with status code 429');
      },
    });

    const links = await store.causalService.getAllRelationships();
    expect(links).toHaveLength(1);
    expect(report.repairsApplied?.some((repair) => repair.includes('Deleted orphaned causal relationship'))).toBe(false);
    const failure = report.repairFailures?.find((entry) => entry.includes('r1'));
    expect(failure).toBeDefined();
    expect(failure).toContain('429');
  });

  it('says so when the cross-graph lookup fails, rather than dropping the check', async () => {
    const events = [
      new Event({
        id: 'e1',
        description: 'An event that points across graphs',
        timestamp: new Date('1910-01-01'),
        actor: 'A',
        target: 'B',
        metadata: { arcId: 'arc-elsewhere' },
      }),
    ];
    const store = createMockStore(events, []);

    const validator = new GraphValidator();
    const report = await validator.validate('mock-graph', store, {
      crossGraphLookup: async () => {
        throw new Error('Request failed with status code 429');
      },
    });

    const warning = report.issues.find(
      (issue) => issue.severity === 'warning' && issue.message.includes('429')
    );
    expect(warning).toBeDefined();
  });
});
