/**
 * Cloud-mode proof of graph-scoped storage (#59).
 *
 * Before #59 a repository or service built for one graph ran Cypher with no
 * graph predicate, so in cloud mode -- one Neo4j instance holding every graph's
 * `:Event` nodes, `:Arc` nodes and `:CAUSES` relationships -- a scoped service
 * could read, count, validate and mutate another graph's data. Two concrete
 * harms were reported: a client saw events it had no access to, and the
 * causal-cycle check behind `createCausalLink` read every relationship in the
 * database on each same-moment link.
 *
 * This suite is the positive half of the fix, against a real Neo4j: it builds
 * two graphs through `Container.graphScopedRepositories` -- the production path a
 * request takes after `X-Graph-Id` has been resolved -- and asserts that neither
 * can see or touch the other.
 *
 * It runs only under `vitest.cloud.config.ts` (the default suite excludes it,
 * because it needs a live Neo4j).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Session } from 'neo4j-driver';
import { Container, initializeContainer, cleanupContainer } from '@/container';
import { AppConfig, loadConfig } from '@/utils/config';
import { getDatabaseManager, initializeDatabaseManager } from '@/utils/database';
import { initializeSchema } from '@/utils/schema';
import { GraphScopedRepositories } from '@/container';
import { CausalParadoxError } from '@/utils/errors';
import {
  adoptUnattributedCloudData,
  attributeUnattributedData,
  countUnattributedData,
} from '@/utils/graphAttribution';

/** A cause/effect pair at the same moment, which is what the cycle guard checks. */
const SAME_MOMENT = '2020-06-01T00:00:00.000Z';

function eventData(description: string, timestamp: string = SAME_MOMENT) {
  return {
    description,
    actor: 'actor',
    target: 'target',
    timestamp: new Date(timestamp),
  };
}

function arcData(name: string, start: string, end: string, level: number) {
  return {
    name,
    start_time: new Date(start),
    end_time: new Date(end),
    level,
  };
}

const relationship = {
  weight: 0.8,
  confidence: 0.9,
  evidence: 'because',
  relationship_type: 'direct' as const,
};

describe('graph-scoped cloud storage (#59)', () => {
  let container: Container;
  let session: Session;
  let testDataDir: string;
  let graphCounter = 0;

  /**
   * A fresh graph id per test: the causal service caches cycles and chains under
   * a key namespaced by graph id, and the cache lives in Redis, which this suite
   * does not flush. Unique ids keep one test's cached result out of the next.
   */
  function nextGraphId(label: string): string {
    graphCounter += 1;
    return `${label}-${process.pid}-${graphCounter}`;
  }

  async function scoped(graphId: string): Promise<GraphScopedRepositories> {
    return container.graphScopedRepositories(graphId);
  }

  beforeAll(async () => {
    testDataDir = path.join(
      os.tmpdir(),
      `graph-scoped-storage-${process.pid}-${Date.now()}`
    );
    await fs.mkdir(testDataDir, { recursive: true });

    const base = loadConfig();
    const config: AppConfig = {
      ...base,
      localExecution: { ...base.localExecution, dataDirectory: testDataDir, backupEnabled: false },
    };

    const databaseManager = initializeDatabaseManager(config.database);
    await databaseManager.initializeNeo4j();
    await initializeSchema();

    container = initializeContainer(databaseManager, config);
    await container.initialize();

    session = getDatabaseManager().getNeo4jSession();
  });

  afterAll(async () => {
    if (session) {
      await session.close();
    }
    await cleanupContainer();
    await fs.rm(testDataDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    // Every suite here owns the whole instance for its duration
    // (`fileParallelism: false`).
    await session.run('MATCH (n) WHERE n:Event OR n:Arc DETACH DELETE n');
  });

  describe('events', () => {
    it('reads, counts and writes only its own graph', async () => {
      const graphA = nextGraphId('events-a');
      const graphB = nextGraphId('events-b');

      const repositoryA = (await scoped(graphA)).eventRepository;
      const repositoryB = (await scoped(graphB)).eventRepository;

      const eventA = await repositoryA.create(eventData('only in A'));
      const eventB = await repositoryB.create(eventData('only in B'));

      expect((await repositoryA.findAll()).map((event) => event.id)).toEqual([eventA.id]);
      expect((await repositoryB.findAll()).map((event) => event.id)).toEqual([eventB.id]);

      expect(await repositoryA.count()).toBe(1);
      expect(await repositoryB.count()).toBe(1);

      // Reads across the boundary report absence, not the other graph's row.
      expect(await repositoryA.findById(eventB.id)).toBeNull();
      expect(await repositoryB.findById(eventA.id)).toBeNull();
      expect(await repositoryA.exists(eventB.id)).toBe(false);
      expect((await repositoryA.findByActor('actor')).map((event) => event.id)).toEqual([
        eventA.id,
      ]);
      expect(
        (
          await repositoryA.findByTimeRange({
            start: new Date('2020-01-01T00:00:00.000Z'),
            end: new Date('2021-01-01T00:00:00.000Z'),
          })
        ).map((event) => event.id)
      ).toEqual([eventA.id]);

      // Writes cannot reach across either: the update and the delete match
      // nothing, and the other graph's row survives.
      expect(await repositoryA.update(eventB.id, { description: 'hijacked' })).toBeNull();
      expect(await repositoryA.delete(eventB.id)).toBe(false);
      const survivor = await repositoryB.findById(eventB.id);
      expect(survivor?.description).toBe('only in B');
      expect(await repositoryB.count()).toBe(1);
    });

    it('stamps the graph on the rows it writes', async () => {
      const graphA = nextGraphId('events-stamp');
      const repository = (await scoped(graphA)).eventRepository;

      const event = await repository.create(eventData('stamped'));

      const result = await session.run(
        'MATCH (e:Event {id: $id}) RETURN e.graphId AS graphId',
        { id: event.id }
      );
      expect(result.records[0]?.get('graphId')).toBe(graphA);
    });
  });

  describe('arcs', () => {
    it('reads, counts and writes only its own graph', async () => {
      const graphA = nextGraphId('arcs-a');
      const graphB = nextGraphId('arcs-b');

      const repositoryA = (await scoped(graphA)).arcRepository;
      const repositoryB = (await scoped(graphB)).arcRepository;

      const arcA = await repositoryA.create(
        arcData('A arc', '2019-01-01T00:00:00.000Z', '2021-01-01T00:00:00.000Z', 1)
      );
      const arcB = await repositoryB.create(
        arcData('B arc', '2019-01-01T00:00:00.000Z', '2021-01-01T00:00:00.000Z', 1)
      );

      expect((await repositoryA.findAll()).map((arc) => arc.id)).toEqual([arcA.id]);
      expect((await repositoryB.findAll()).map((arc) => arc.id)).toEqual([arcB.id]);
      expect(await repositoryA.count()).toBe(1);
      expect(await repositoryB.count()).toBe(1);
      expect(await repositoryA.countByLevel(1)).toBe(1);

      expect(await repositoryA.findById(arcB.id)).toBeNull();
      expect(await repositoryA.exists(arcB.id)).toBe(false);
      expect(await repositoryA.update(arcB.id, { name: 'hijacked' })).toBeNull();
      expect(await repositoryA.delete(arcB.id)).toBe(false);
      expect((await repositoryB.findById(arcB.id))?.name).toBe('B arc');
    });

    it('does not read another graph’s arcs in a hierarchy query', async () => {
      const graphA = nextGraphId('arcs-hierarchy-a');
      const graphB = nextGraphId('arcs-hierarchy-b');

      const repositoryA = (await scoped(graphA)).arcRepository;
      const repositoryB = (await scoped(graphB)).arcRepository;

      // Both graphs get the same shape: a level-1 parent and a level-2 child
      // inside it. Only A's child belongs to A.
      const parentA = await repositoryA.create(
        arcData('A parent', '2019-01-01T00:00:00.000Z', '2021-01-01T00:00:00.000Z', 1)
      );
      const childA = await repositoryA.create(
        arcData('A child', '2020-01-01T00:00:00.000Z', '2020-06-01T00:00:00.000Z', 2)
      );
      const parentB = await repositoryB.create(
        arcData('B parent', '2019-01-01T00:00:00.000Z', '2021-01-01T00:00:00.000Z', 1)
      );
      await repositoryB.create(
        arcData('B child', '2020-01-01T00:00:00.000Z', '2020-06-01T00:00:00.000Z', 2)
      );

      expect((await repositoryA.findDirectChildren(parentA.id)).map((arc) => arc.id)).toEqual([
        childA.id,
      ]);
      expect(await repositoryA.findDirectChildren(parentB.id)).toEqual([]);
      expect(await repositoryB.findDirectChildren(parentA.id)).toEqual([]);
      expect((await repositoryA.findNestedArcs(parentA.id)).map((arc) => arc.name)).toEqual([
        'A child',
      ]);
      expect((await repositoryB.findParentArcs(childA.id)).map((arc) => arc.name)).toEqual([]);
    });

    it('stamps the graph on the arc it writes', async () => {
      const graphA = nextGraphId('arcs-stamp');
      const repository = (await scoped(graphA)).arcRepository;

      const arc = await repository.create(
        arcData('stamped', '2019-01-01T00:00:00.000Z', '2021-01-01T00:00:00.000Z', 1)
      );

      const result = await session.run('MATCH (a:Arc {id: $id}) RETURN a.graphId AS graphId', {
        id: arc.id,
      });
      expect(result.records[0]?.get('graphId')).toBe(graphA);
    });
  });

  describe('causal relationships', () => {
    it('lists only its own graph’s relationships', async () => {
      const graphA = nextGraphId('causal-list-a');
      const graphB = nextGraphId('causal-list-b');

      const scopedA = await scoped(graphA);
      const scopedB = await scoped(graphB);

      const a1 = await scopedA.eventRepository.create(eventData('a1'));
      const a2 = await scopedA.eventRepository.create(eventData('a2'));
      const b1 = await scopedB.eventRepository.create(eventData('b1'));
      const b2 = await scopedB.eventRepository.create(eventData('b2'));

      await scopedA.causalService.createCausalLink(
        (await scopedA.eventRepository.findById(a1.id))!,
        (await scopedA.eventRepository.findById(a2.id))!,
        relationship
      );
      await scopedB.causalService.createCausalLink(
        (await scopedB.eventRepository.findById(b1.id))!,
        (await scopedB.eventRepository.findById(b2.id))!,
        relationship
      );

      const relationshipsA = await scopedA.causalService.getAllRelationships();
      const relationshipsB = await scopedB.causalService.getAllRelationships();

      expect(relationshipsA.map((rel) => rel.cause_event_id)).toEqual([a1.id]);
      expect(relationshipsA.map((rel) => rel.effect_event_id)).toEqual([a2.id]);
      expect(relationshipsB.map((rel) => rel.cause_event_id)).toEqual([b1.id]);
      expect(relationshipsB.map((rel) => rel.effect_event_id)).toEqual([b2.id]);
    });

    it('stamps the graph on the relationship it creates', async () => {
      const graphA = nextGraphId('causal-stamp');
      const scopedA = await scoped(graphA);

      const cause = await scopedA.eventRepository.create(eventData('cause'));
      const effect = await scopedA.eventRepository.create(
        eventData('effect', '2020-06-01T01:00:00.000Z')
      );

      await scopedA.causalService.createCausalLink(
        (await scopedA.eventRepository.findById(cause.id))!,
        (await scopedA.eventRepository.findById(effect.id))!,
        relationship
      );

      const result = await session.run(
        'MATCH (c:Event {id: $causeId})-[r:CAUSES]->(:Event {id: $effectId}) RETURN r.graphId AS graphId',
        { causeId: cause.id, effectId: effect.id }
      );
      expect(result.records[0]?.get('graphId')).toBe(graphA);
    });

    it('does not see another graph’s cycle, and still refuses its own', async () => {
      const graphA = nextGraphId('causal-cycle-a');
      const graphB = nextGraphId('causal-cycle-b');

      const scopedA = await scoped(graphA);
      const scopedB = await scoped(graphB);

      const a1 = await scopedA.eventRepository.create(eventData('a1'));
      const a2 = await scopedA.eventRepository.create(eventData('a2'));
      const b1 = await scopedB.eventRepository.create(eventData('b1'));
      const b2 = await scopedB.eventRepository.create(eventData('b2'));

      // B gets a genuine same-moment cycle, written directly because
      // `createCausalLink` refuses to create one: this is the shape imported
      // data has, and the shape the cycle query has to report -- for B only.
      await session.run(
        `MATCH (b1:Event {id: $b1}), (b2:Event {id: $b2})
         CREATE (b2)-[:CAUSES {
           graphId: $graphId,
           weight: 0.5,
           confidence: 0.5,
           evidence: 'imported',
           relationship_type: 'direct'
         }]->(b1)`,
        { b1: b1.id, b2: b2.id, graphId: graphB }
      );
      await session.run(
        `MATCH (b1:Event {id: $b1}), (b2:Event {id: $b2})
         CREATE (b1)-[:CAUSES {
           graphId: $graphId,
           weight: 0.5,
           confidence: 0.5,
           evidence: 'imported',
           relationship_type: 'direct'
         }]->(b2)`,
        { b1: b1.id, b2: b2.id, graphId: graphB }
      );

      // A has no cycle of its own, so the cycle check must report none -- even
      // though a cycle exists in B next to it.
      expect(await scopedA.causalService.detectCausalCycles()).toEqual([]);
      expect((await scopedB.causalService.detectCausalCycles()).length).toBeGreaterThan(0);

      // A's own same-moment link is still guarded: a1 -> a2 then a2 -> a1 would
      // close a cycle inside A.
      await scopedA.causalService.createCausalLink(
        (await scopedA.eventRepository.findById(a1.id))!,
        (await scopedA.eventRepository.findById(a2.id))!,
        relationship
      );
      await expect(
        scopedA.causalService.createCausalLink(
          (await scopedA.eventRepository.findById(a2.id))!,
          (await scopedA.eventRepository.findById(a1.id))!,
          relationship
        )
      ).rejects.toBeInstanceOf(CausalParadoxError);
    });

    it('refuses a link across graphs and leaves the other graph’s link alone', async () => {
      const graphA = nextGraphId('causal-write-a');
      const graphB = nextGraphId('causal-write-b');

      const scopedA = await scoped(graphA);
      const scopedB = await scoped(graphB);

      const a1 = await scopedA.eventRepository.create(eventData('a1'));
      const b1 = await scopedB.eventRepository.create(eventData('b1'));
      const b2 = await scopedB.eventRepository.create(eventData('b2'));

      // A cannot link its event to B's: the endpoint match is graph-scoped, so
      // the operation reports the endpoint as missing instead of writing an edge
      // that spans two graphs.
      await expect(
        scopedA.causalService.createCausalLink(
          (await scopedA.eventRepository.findById(a1.id))!,
          (await scopedB.eventRepository.findById(b1.id))!,
          relationship
        )
      ).rejects.toThrow(/may not exist/);

      await scopedB.causalService.createCausalLink(
        (await scopedB.eventRepository.findById(b1.id))!,
        (await scopedB.eventRepository.findById(b2.id))!,
        relationship
      );

      // A cannot update or delete B's link, and B's link survives both attempts.
      await expect(
        scopedA.causalService.updateCausalLink(b1.id, b2.id, { weight: 0.1 })
      ).rejects.toThrow(/not found/);
      await expect(scopedA.causalService.deleteCausalLink(b1.id, b2.id)).rejects.toThrow(
        /not found/
      );
      expect((await scopedB.causalService.getAllRelationships()).length).toBe(1);
      expect((await scopedA.causalService.getAllRelationships()).length).toBe(0);
    });
  });

  describe('pre-#59 rows without a graph identity', () => {
    /** Write a row the way the code did before #59: no `graphId`. */
    async function createLegacyEvent(id: string, description: string): Promise<void> {
      await session.run(
        `CREATE (e:Event {
           id: $id,
           description: $description,
           actor: 'actor',
           target: 'target',
           timestamp: datetime($timestamp),
           metadata: '{}'
         })`,
        { id, description, timestamp: SAME_MOMENT }
      );
    }

    it('reports them instead of hiding them, and attributes them on request', async () => {
      const graphA = nextGraphId('legacy-a');
      const graphB = nextGraphId('legacy-b');
      const legacyId = `legacy-${process.pid}-${Date.now()}`;

      await createLegacyEvent(legacyId, 'written before graph identity');

      // Invisible to a scoped read: that is the harm, so the fix has to say so.
      const repositoryA = (await scoped(graphA)).eventRepository;
      expect(await repositoryA.findById(legacyId)).toBeNull();

      const counts = await countUnattributedData(session);
      expect(counts.events).toBe(1);
      expect(counts.arcs).toBe(0);

      // With more than one graph registered the attribution is ambiguous, so the
      // startup path reports the counts and the command instead of guessing.
      const warnings: string[] = [];
      const adopted = await adoptUnattributedCloudData({
        session,
        knownGraphIds: [graphA, graphB],
        warn: (message) => warnings.push(message),
        log: () => undefined,
      });
      expect(adopted.remaining.events).toBe(1);
      expect(warnings.join('\n')).toMatch(/migrate:attribute-graph/);
      expect(warnings.join('\n')).toMatch(/1 event/);

      // The explicit command attributes them, and then the scoped read finds them.
      const outcome = await attributeUnattributedData(session, graphA);
      expect(outcome.attributed.events).toBe(1);
      expect(outcome.remaining.events).toBe(0);
      expect((await repositoryA.findById(legacyId))?.description).toBe(
        'written before graph identity'
      );
      expect(await repositoryA.count()).toBe(1);
    });

    it('attributes them automatically when the deployment knows one graph', async () => {
      const graphA = nextGraphId('legacy-single');
      const legacyId = `legacy-single-${process.pid}-${Date.now()}`;

      await createLegacyEvent(legacyId, 'single graph deployment');

      const adopted = await adoptUnattributedCloudData({
        session,
        knownGraphIds: [graphA],
        warn: () => undefined,
        log: () => undefined,
      });

      expect(adopted.graphId).toBe(graphA);
      expect(adopted.attributed.events).toBe(1);
      expect(adopted.remaining.events).toBe(0);
      expect(await (await scoped(graphA)).eventRepository.findById(legacyId)).not.toBeNull();
    });
  });
});
