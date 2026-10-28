/**
 * Unit proof that the cloud repositories name their graph on every query.
 *
 * The cross-graph behaviour itself is proven against a real Neo4j in
 * `src/tests/integration/graph-scoped-storage.test.ts`; this suite is the cheap
 * half. It records the Cypher a scoped repository emits and fails if a query
 * loses its graph predicate, which is the exact regression #59 was: the
 * repositories were built for one graph and their Cypher named none.
 *
 * The two invariants pinned here:
 *
 * - a repository constructed with a `graphId` filters every read, count, update
 *   and delete by `graphId`, and stamps it on every create;
 * - a repository constructed without one (the process-wide singleton, and every
 *   local-mode repository) emits no graph filter at all, because local nodes have
 *   no such property and a filter would match nothing.
 */

import { describe, it, expect } from 'vitest';
import { Session } from 'neo4j-driver';
import { EventRepository, AdvancedEventRepository } from './EventRepository';
import { ArcRepository, AdvancedArcRepository } from './ArcRepository';
import { DatabaseManager, LocalDatabaseManager, LocalSession } from '../utils/database';

interface RecordedQuery {
  readonly query: string;
  readonly parameters: Record<string, unknown>;
}

const GRAPH_ID = 'graph-a';

/**
 * Properties returned for a node projection (`RETURN e` and friends).
 *
 * Field names cover both `:Event` and `:Arc`, so one fake session can stand in
 * for either repository; the map is read only by the mapper under test.
 */
const NODE_PROPERTIES: Record<string, unknown> = {
  id: 'node-1',
  description: 'description',
  actor: 'actor',
  target: 'target',
  timestamp: '2020-01-01T00:00:00.000Z',
  metadata: '{}',
  name: 'arc name',
  start_time: '2019-01-01T00:00:00.000Z',
  end_time: '2021-01-01T00:00:00.000Z',
  level: 1,
};

const NODE_KEYS = new Set(['e', 'a', 'child', 'parent']);

/**
 * A session that records what it was asked and answers just enough for the
 * repositories' mappers to run.
 */
function recordingSession(recorded: RecordedQuery[]): Session {
  const session = {
    run: async (query: string, parameters?: Record<string, unknown>) => {
      recorded.push({ query, parameters: parameters ?? {} });
      // The arc boundary check reads a conflict projection; answering it with a
      // row would make it throw, so it gets an empty result set.
      if (query.includes('conflictId')) {
        return { records: [] };
      }
      return {
        records: [
          {
            get: (key: string) => (NODE_KEYS.has(key) ? { properties: NODE_PROPERTIES } : 1),
            has: (key: string) => NODE_KEYS.has(key) || key === 'total',
          },
        ],
      };
    },
    close: async () => undefined,
  };
  return session as unknown as Session;
}

/** A manager that is not a `LocalDatabaseManager`, so `graphId` applies. */
function cloudManager(recorded: RecordedQuery[]): DatabaseManager {
  const manager = {
    getNeo4jSession: () => recordingSession(recorded),
  };
  return manager as unknown as DatabaseManager;
}

/**
 * A real `LocalDatabaseManager` (the `instanceof` guard is what is under test)
 * with no store behind it: the repositories only ever ask it for a session.
 */
function localManager(recorded: RecordedQuery[]): LocalDatabaseManager {
  const manager = Object.create(LocalDatabaseManager.prototype) as LocalDatabaseManager;
  // The repositories only call `run` and `close` on the session, which the
  // recording double provides; `LocalSession` additionally exposes its store.
  manager.getNeo4jSession = () => recordingSession(recorded) as unknown as LocalSession;
  return manager;
}

/** Every recorded query, for the "no graph filter anywhere" assertions. */
function allQueries(recorded: readonly RecordedQuery[]): string {
  return recorded.map((entry) => entry.query).join('\n---\n');
}

describe('graph-scoped cloud repositories (#59)', () => {
  describe('EventRepository', () => {
    it('filters every read, count, update and delete by graph', async () => {
      const recorded: RecordedQuery[] = [];
      const repository = new EventRepository(cloudManager(recorded), undefined, undefined, {
        graphId: GRAPH_ID,
      });

      await repository.findById('event-1');
      await repository.findAll();
      await repository.findAll(10, 5);
      await repository.findByTimeRange({
        start: new Date('2020-01-01T00:00:00.000Z'),
        end: new Date('2020-01-02T00:00:00.000Z'),
      });
      await repository.findByActor('actor');
      await repository.findByTarget('target');
      await repository.findByActorAndTimeRange('actor', {
        start: new Date('2020-01-01T00:00:00.000Z'),
        end: new Date('2020-01-02T00:00:00.000Z'),
      });
      await repository.update('event-1', { description: 'changed' });
      await repository.count();
      await repository.countByActor('actor');
      await repository.countByTimeRange({
        start: new Date('2020-01-01T00:00:00.000Z'),
        end: new Date('2020-01-02T00:00:00.000Z'),
      });
      await repository.exists('event-1');
      await repository.delete('event-1');

      expect(recorded.length).toBeGreaterThanOrEqual(13);
      for (const entry of recorded) {
        expect(entry.query).toContain('graphId: $graphId');
        expect(entry.parameters.graphId).toBe(GRAPH_ID);
      }
    });

    it('stamps the graph on a created event', async () => {
      const recorded: RecordedQuery[] = [];
      const repository = new EventRepository(cloudManager(recorded), undefined, undefined, {
        graphId: GRAPH_ID,
      });

      await repository.create({
        description: 'created',
        actor: 'actor',
        target: 'target',
        timestamp: new Date('2020-01-01T00:00:00.000Z'),
      });

      expect(recorded).toHaveLength(1);
      expect(recorded[0]!.query).toContain('graphId: $graphId');
      expect(recorded[0]!.parameters.graphId).toBe(GRAPH_ID);
    });

    it('filters the advanced search by graph too', async () => {
      const recorded: RecordedQuery[] = [];
      const repository = new AdvancedEventRepository(
        cloudManager(recorded),
        undefined,
        undefined,
        { graphId: GRAPH_ID }
      );

      await repository.search({ actor: 'actor', target: 'target' });

      expect(recorded).toHaveLength(1);
      expect(recorded[0]!.query).toContain('MATCH (e:Event {graphId: $graphId})');
      expect(recorded[0]!.parameters.graphId).toBe(GRAPH_ID);
    });

    it('emits no graph filter for the unscoped repository', async () => {
      const recorded: RecordedQuery[] = [];
      const repository = new EventRepository(cloudManager(recorded));

      await repository.create({
        description: 'created',
        actor: 'actor',
        target: 'target',
        timestamp: new Date('2020-01-01T00:00:00.000Z'),
      });
      await repository.findAll();
      await repository.findById('event-1');
      await repository.count();
      await repository.update('event-1', { description: 'changed' });
      await repository.delete('event-1');

      expect(allQueries(recorded)).not.toContain('graphId');
    });

    it('emits no graph filter when the store, not the id, is the scope', async () => {
      const recorded: RecordedQuery[] = [];
      const repository = new EventRepository(localManager(recorded), undefined, undefined, {
        graphId: GRAPH_ID,
      });

      await repository.findAll();
      await repository.count();

      expect(recorded).toHaveLength(2);
      expect(allQueries(recorded)).not.toContain('graphId');
    });
  });

  describe('ArcRepository', () => {
    it('filters every read, count, update, delete and boundary check by graph', async () => {
      const recorded: RecordedQuery[] = [];
      const repository = new ArcRepository(
        cloudManager(recorded),
        undefined,
        undefined,
        undefined,
        { graphId: GRAPH_ID }
      );

      await repository.findById('arc-1');
      await repository.findAll();
      await repository.findByLevel(1);
      await repository.findOverlappingArcs({
        start: new Date('2020-01-01T00:00:00.000Z'),
        end: new Date('2020-01-02T00:00:00.000Z'),
      });
      await repository.findContainingArcs({
        start: new Date('2020-01-01T00:00:00.000Z'),
        end: new Date('2020-01-02T00:00:00.000Z'),
      });
      await repository.findNestedArcs('arc-1');
      await repository.findDirectChildren('arc-1');
      await repository.findParentArcs('arc-1');
      await repository.count();
      await repository.countByLevel(1);
      await repository.exists('arc-1');
      await repository.update('arc-1', { name: 'changed' });
      await repository.delete('arc-1');

      const predicateQueries = recorded.filter((entry) => !entry.query.includes('conflictId'));
      expect(predicateQueries.length).toBeGreaterThanOrEqual(13);
      for (const entry of predicateQueries) {
        expect(entry.query).toContain('graphId: $graphId');
        expect(entry.parameters.graphId).toBe(GRAPH_ID);
      }

      // The boundary check reads arcs of this graph only; otherwise a violation
      // in another graph would block a legitimate write.
      const boundaryChecks = recorded.filter((entry) => entry.query.includes('conflictId'));
      expect(boundaryChecks.length).toBeGreaterThan(0);
      for (const entry of boundaryChecks) {
        expect(entry.query).toContain('MATCH (existing:Arc {graphId: $graphId})');
        expect(entry.parameters.graphId).toBe(GRAPH_ID);
      }
    });

    it('stamps the graph on a created arc', async () => {
      const recorded: RecordedQuery[] = [];
      const repository = new ArcRepository(
        cloudManager(recorded),
        undefined,
        undefined,
        undefined,
        { graphId: GRAPH_ID }
      );

      await repository.create({
        name: 'created',
        start_time: new Date('2020-01-01T00:00:00.000Z'),
        end_time: new Date('2020-01-02T00:00:00.000Z'),
        level: 1,
      });

      const createQuery = recorded.find((entry) => entry.query.includes('CREATE (a:Arc'));
      expect(createQuery).toBeDefined();
      expect(createQuery!.query).toContain('graphId: $graphId');
      expect(createQuery!.parameters.graphId).toBe(GRAPH_ID);
    });

    it('filters the advanced search by graph too', async () => {
      const recorded: RecordedQuery[] = [];
      const repository = new AdvancedArcRepository(
        cloudManager(recorded),
        undefined,
        undefined,
        undefined,
        { graphId: GRAPH_ID }
      );

      await repository.search({ name: 'arc' });

      expect(recorded).toHaveLength(1);
      expect(recorded[0]!.query).toContain('MATCH (a:Arc {graphId: $graphId})');
      expect(recorded[0]!.parameters.graphId).toBe(GRAPH_ID);
    });

    it('emits no graph filter for the unscoped repository', async () => {
      const recorded: RecordedQuery[] = [];
      const repository = new ArcRepository(cloudManager(recorded));

      await repository.findAll();
      await repository.count();
      await repository.findNestedArcs('arc-1');
      await repository.findById('arc-1');

      expect(allQueries(recorded)).not.toContain('graphId');
    });
  });
});
