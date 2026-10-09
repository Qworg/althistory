/**
 * Unit and integration tests for Graph, Entity & Causal Manipulation Commands (Phase 4).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DirectEngine } from './engine/DirectEngine';

describe('CLI Phase 4: Graph, Event, Arc & Causal CRUD Engine', () => {
  let engine: DirectEngine;
  let graphId: string;

  beforeEach(async () => {
    engine = new DirectEngine();
    const created = await engine.createGraph('CRUD Test History', 'Test graph for entity manipulation');
    graphId = created.id;
  });

  afterEach(async () => {
    try {
      await engine.deleteGraph(graphId);
    } catch {
      // Best effort cleanup
    }
    await engine.shutdown();
  });

  describe('Event CRUD', () => {
    it('creates, retrieves, updates, and deletes an event', async () => {
      // 1. Create
      const event = await engine.createEvent(graphId, {
        description: 'First Continental Congress meets',
        timestamp: '1774-09-05T00:00:00Z',
        actor: 'Colonial Delegates',
        target: 'King George III',
        importance: 0.9,
      });

      expect(event.id).toBeDefined();
      expect(event.description).toBe('First Continental Congress meets');
      expect(event.actor).toBe('Colonial Delegates');

      // 2. Get
      const fetched = await engine.getEvent(graphId, event.id);
      expect(fetched.id).toBe(event.id);
      expect(fetched.description).toBe(event.description);

      // 3. Update
      const updated = await engine.updateEvent(graphId, event.id, {
        description: 'First Continental Congress convenes in Philadelphia',
      });
      expect(updated.description).toBe('First Continental Congress convenes in Philadelphia');

      // 4. List with filter
      const list = await engine.listEvents(graphId, { actor: 'Delegates' });
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(event.id);

      // 5. Delete
      await engine.deleteEvent(graphId, event.id);
      const afterDelete = await engine.listEvents(graphId);
      expect(afterDelete).toHaveLength(0);
    });
  });

  describe('Arc CRUD', () => {
    it('creates, retrieves, and deletes narrative arcs', async () => {
      const arc = await engine.createArc(graphId, {
        name: 'American Revolutionary War',
        startTime: '1775-04-19T00:00:00Z',
        endTime: '1783-09-03T00:00:00Z',
        description: 'Military conflict between Great Britain and thirteen colonies',
      });

      expect(arc.id).toBeDefined();
      expect(arc.name).toBe('American Revolutionary War');

      const fetched = await engine.getArc(graphId, arc.id);
      expect(fetched.id).toBe(arc.id);

      const allArcs = await engine.listArcs(graphId);
      expect(allArcs).toHaveLength(1);

      await engine.deleteArc(graphId, arc.id);
      const remaining = await engine.listArcs(graphId);
      expect(remaining).toHaveLength(0);
    });
  });

  describe('Causal Relationship Links & Paths', () => {
    it('creates causal link and traces paths between events', async () => {
      const e1 = await engine.createEvent(graphId, {
        description: 'Lexington and Concord',
        timestamp: '1775-04-19T00:00:00Z',
        actor: 'Minutemen',
        target: 'British Regulars',
      });

      const e2 = await engine.createEvent(graphId, {
        description: 'Declaration of Independence',
        timestamp: '1776-07-04T00:00:00Z',
        actor: 'Continental Congress',
        target: 'Great Britain',
      });

      const e3 = await engine.createEvent(graphId, {
        description: 'Treaty of Paris',
        timestamp: '1783-09-03T00:00:00Z',
        actor: 'Great Britain',
        target: 'United States',
      });

      // Link e1 -> e2
      const link1 = await engine.createCausalLink(graphId, {
        causeId: e1.id,
        effectId: e2.id,
        weight: 0.9,
        reasoning: 'Outbreak of hostilities necessitated legal independence declaration',
      });
      expect(link1.causeId).toBe(e1.id);
      expect(link1.effectId).toBe(e2.id);

      // Link e2 -> e3
      const link2 = await engine.createCausalLink(graphId, {
        causeId: e2.id,
        effectId: e3.id,
        weight: 0.95,
        reasoning: 'Sovereign nation status enabled formal peace negotiation',
      });
      expect(link2.causeId).toBe(e2.id);

      // List links
      const links = await engine.listCausalLinks(graphId);
      expect(links).toHaveLength(2);

      // Find paths e1 -> e3
      const pathRes = await engine.findCausalPaths(graphId, e1.id, e3.id);
      expect(pathRes.count).toBeGreaterThanOrEqual(1);
      expect(pathRes.paths[0]).toEqual([e1.id, e2.id, e3.id]);

      // Unlink
      await engine.deleteCausalLink(graphId, e1.id, e2.id);
      const linksAfter = await engine.listCausalLinks(graphId);
      expect(linksAfter).toHaveLength(1);
    });

    it('rejects causal links violating temporal direction (cause >= effect)', async () => {
      const e1 = await engine.createEvent(graphId, {
        description: 'Future event',
        timestamp: '1800-01-01T00:00:00Z',
        actor: 'Actor A',
        target: 'Actor B',
      });

      const e2 = await engine.createEvent(graphId, {
        description: 'Past event',
        timestamp: '1700-01-01T00:00:00Z',
        actor: 'Actor B',
        target: 'Actor A',
      });

      await expect(
        engine.createCausalLink(graphId, {
          causeId: e1.id,
          effectId: e2.id,
        })
      ).rejects.toThrow();
    });
  });

  describe('Graph Management', () => {
    it('creates, inspects, and diffs history graphs', async () => {
      const g2 = await engine.createGraph('Branch Graph for Diff');
      try {
        await engine.createEvent(g2.id, {
          description: 'Unique event in graph 2',
          timestamp: '1900-01-01T00:00:00Z',
          actor: 'Innovator',
          target: 'Public',
        });

        const diff = await engine.diffGraph(graphId, g2.id);
        expect(diff.sourceGraphId).toBe(graphId);
        expect(diff.targetGraphId).toBe(g2.id);
        expect((diff.events as { added: number }).added).toBe(1);
      } finally {
        await engine.deleteGraph(g2.id);
      }
    });
  });
});
