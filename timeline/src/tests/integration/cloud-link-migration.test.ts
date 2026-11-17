/**
 * The startup migration that names cloud links (issue 30), against a real Neo4j,
 * on data shaped the way `main` left it: id-less `CAUSES` edges, and a version
 * head that holds each of them under the id `main` gave it (`cause->effect` for
 * a link made through the API, `rel_...` for a graph that was imported).
 *
 * The cases: a graph imported on `main`; identical and missing `created_at`;
 * three links on a pair; a reconcile that throws; a process stopped between the
 * head write and the naming; and, at scale, 300,000 id-less edges and 10,000
 * two-link pairs (sizes can be lowered with LINK_MIGRATION_SINGLES and
 * LINK_MIGRATION_PAIRS, the numbers measured are logged).
 *
 * Runs only under `vitest.cloud.config.ts`.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { Session } from 'neo4j-driver';
import { Container, initializeContainer, cleanupContainer } from '@/container';
import { AppConfig, loadConfig } from '@/utils/config';
import { getDatabaseManager, initializeDatabaseManager } from '@/utils/database';
import { initializeSchema } from '@/utils/schema';
import {
  runCausalLinkIdMigration,
  type CausalLinkIdMigrationOptions,
  type CausalLinkIdMigrationResult,
  type MigrationSession,
} from '@/services/CausalLinkIdMigration';

const SINGLES = Number(process.env.LINK_MIGRATION_SINGLES ?? 300000);
const PAIRS = Number(process.env.LINK_MIGRATION_PAIRS ?? 10000);

describe('the cloud link id migration (#30)', () => {
  let container: Container;
  let testDataDir: string;
  const graphs: string[] = [];

  const neo = async <T = Record<string, unknown>>(query: string, parameters: Record<string, unknown> = {}): Promise<T[]> => {
    const session: Session = getDatabaseManager().getNeo4jSession();
    try {
      const result = await session.run(query, parameters);
      return result.records.map((record) => record.toObject() as T);
    } finally {
      await session.close();
    }
  };

  beforeAll(async () => {
    testDataDir = path.join(os.tmpdir(), `cloud-link-migration-${process.pid}-${Date.now()}`);
    await fs.mkdir(testDataDir, { recursive: true });
    const base = loadConfig();
    const config: AppConfig = { ...base, localExecution: { ...base.localExecution, dataDirectory: testDataDir, backupEnabled: false } };
    const databaseManager = initializeDatabaseManager(config.database);
    await databaseManager.initializeNeo4j();
    await initializeSchema();
    container = initializeContainer(databaseManager, config);
    await container.initialize();
  });

  afterEach(async () => {
    // Every suite owns the instance while it runs: leave no id-less edge for the next test's migration.
    // In batches: a graph of 300,000 links does not fit one transaction on a 1 GB heap.
    await neo('MATCH (n) WHERE n.graphId IN $ids CALL { WITH n DETACH DELETE n } IN TRANSACTIONS OF 5000 ROWS', { ids: graphs.splice(0) });
  });

  afterAll(async () => {
    await cleanupContainer();
    await fs.rm(testDataDir, { recursive: true, force: true });
  });

  const newGraph = async (name: string): Promise<string> => {
    const id = (await container.graphService.createGraph({ name })).id;
    graphs.push(id);
    return id;
  };

  /** An event in the live store and in the head. */
  const addEvent = async (graphId: string, label: string, year: number): Promise<string> => {
    const { eventRepository } = await container.graphScopedRepositories(graphId);
    const event = await eventRepository.create({ description: label, actor: 'A', target: 'B', timestamp: new Date(Date.UTC(year, 0, 1)) });
    await container.graphWriteVersioningService.recordEvent(graphId, event, 'create');
    return event.id;
  };

  /** An edge as `main` wrote it: no id. `createdAt: null` leaves the property off. */
  const idlessEdge = (graphId: string, cause: string, effect: string, evidence: string | null, createdAt: string | null): Promise<unknown> =>
    neo(
      `MATCH (c:Event {id: $cause, graphId: $graphId}), (e:Event {id: $effect, graphId: $graphId})
       CREATE (c)-[r:CAUSES {weight: 0.4, confidence: 0.6, relationship_type: 'direct', graphId: $graphId}]->(e)
       FOREACH (_ IN CASE WHEN $evidence IS NULL THEN [] ELSE [1] END | SET r.evidence = $evidence)
       FOREACH (_ IN CASE WHEN $createdAt IS NULL THEN [] ELSE [1] END | SET r.created_at = datetime($createdAt))`,
      { cause, effect, evidence, createdAt, graphId }
    );

  /** What `main` versioned: the link under `id`, with its data. */
  const headEntry = (graphId: string, id: string, cause: string, effect: string, evidence: string): Promise<void> =>
    container.graphWriteVersioningService.recordRelationship(
      graphId,
      { id, cause_event_id: cause, effect_event_id: effect, weight: 0.4, confidence: 0.6, evidence, relationship_type: 'direct' },
      'create'
    );

  const edges = (cause: string): Promise<Array<{ id: string | null; evidence: string | null }>> =>
    neo(`MATCH (:Event {id: $cause})-[r:CAUSES]->() RETURN r.id AS id, r.evidence AS evidence ORDER BY r.evidence`, { cause });

  const headOf = async (graphId: string, cause: string): Promise<Record<string, string>> =>
    Object.fromEntries(
      Object.entries((await container.graphRepository.checkout(graphId)).relationships)
        .filter(([, link]) => link.cause_event_id === cause)
        .map(([id, link]) => [id, String(link.evidence)])
    );

  const versionOf = async (graphId: string): Promise<number> => (await container.graphRepository.getLatestVersion(graphId))!.version;

  const migrate = (overrides: Partial<CausalLinkIdMigrationOptions> = {}): Promise<CausalLinkIdMigrationResult> =>
    runCausalLinkIdMigration(container, { log: () => undefined, warn: () => undefined, ...overrides });

  const liveLinks = async (graphId: string): Promise<Array<{ id: string; evidence: string }>> =>
    (await (await container.graphScopedRepositories(graphId)).causalService.getAllRelationships()).map((l) => ({ id: l.id, evidence: l.evidence }));

  /** A session whose naming statement throws: the process was stopped after the head was written. */
  const stoppedBeforeNaming = (): (() => MigrationSession) => () => {
    const session = getDatabaseManager().getNeo4jSession();
    return {
      run: (query, parameters) => {
        if (query.includes('SET r.id = row.id')) throw new Error('the process was stopped before naming');
        return session.run(query, parameters);
      },
      close: () => session.close(),
    };
  };

  it('gives a graph imported on main (head rel_...) its head id, so a delete and a rollback bring nothing back', async () => {
    const g = await newGraph('Imported on main');
    const c = await addEvent(g, 'cause', 1100);
    const e = await addEvent(g, 'effect', 1101);
    await idlessEdge(g, c, e, 'IMPORTED', '2020-01-01T00:00:00Z');
    await headEntry(g, 'rel_imported_0', c, e, 'IMPORTED');

    const result = await migrate();

    expect(result.adopted).toBeGreaterThanOrEqual(1);
    expect(await edges(c)).toEqual([{ id: 'rel_imported_0', evidence: 'IMPORTED' }]);
    expect(await headOf(g, c)).toEqual({ rel_imported_0: 'IMPORTED' });

    // Deleted by pair: the id that goes to the version store is the head's own.
    const { causalService } = await container.graphScopedRepositories(g);
    const deleted = await causalService.deleteCausalLink(c, e);
    expect(deleted).toBe('rel_imported_0');
    await container.graphWriteVersioningService.recordDeletion(g, 'relationship', deleted);
    expect(await headOf(g, c)).toEqual({});

    await container.graphService.rollbackGraph(g, await versionOf(g));
    expect(await liveLinks(g)).toEqual([]);
    expect(await edges(c)).toEqual([]);
  });

  it('keeps `cause->effect` for a single link main made through the API', async () => {
    const g = await newGraph('Made on main');
    const c = await addEvent(g, 'cause', 1200);
    const e = await addEvent(g, 'effect', 1201);
    await idlessEdge(g, c, e, 'API', '2020-01-01T00:00:00Z');
    await headEntry(g, `${c}->${e}`, c, e, 'API');
    const before = await versionOf(g);

    await migrate();

    expect((await edges(c))[0]!.id).toBe(`${c}->${e}`);
    expect(await versionOf(g)).toBe(before); // the head already agreed: no version
  });

  it('names three links on a pair, identical created_at and missing created_at included, each in the head', async () => {
    const g = await newGraph('Three on a pair');
    const c = await addEvent(g, 'cause', 1300);
    const e = await addEvent(g, 'effect', 1301);
    await idlessEdge(g, c, e, 'T1', '2020-01-01T00:00:00Z');
    await idlessEdge(g, c, e, 'T2', '2020-01-01T00:00:00Z'); // identical created_at
    await idlessEdge(g, c, e, 'T3', null); // no created_at
    await headEntry(g, `${c}->${e}`, c, e, 'T3'); // main's one entry: the last written

    await migrate();

    const named = await edges(c);
    expect(new Set(named.map((l) => l.id)).size).toBe(3);
    expect(named.find((l) => l.evidence === 'T3')!.id).toBe(`${c}->${e}`); // the head's data match
    for (const link of named.filter((l) => l.evidence !== 'T3')) expect(link.id).toMatch(/^link_[0-9a-f]{24}$/);
    expect(Object.values(await headOf(g, c)).sort()).toEqual(['T1', 'T2', 'T3']);
    expect(new Set(Object.keys(await headOf(g, c)))).toEqual(new Set(named.map((l) => l.id)));

    // Rollback to the head loses nothing.
    await container.graphService.rollbackGraph(g, await versionOf(g));
    expect((await liveLinks(g)).map((l) => l.evidence).sort()).toEqual(['T1', 'T2', 'T3']);
  });

  it('gives the oldest edge cause->effect when the head holds nothing for the pair, and the rest derived ids', async () => {
    const g = await newGraph('Unversioned pair');
    const c = await addEvent(g, 'cause', 1310);
    const e = await addEvent(g, 'effect', 1311);
    await idlessEdge(g, c, e, 'LATER', '2021-01-01T00:00:00Z');
    await idlessEdge(g, c, e, 'EARLIER', '2020-01-01T00:00:00Z');

    await migrate();

    const named = await edges(c);
    expect(named.find((l) => l.evidence === 'EARLIER')!.id).toBe(`${c}->${e}`);
    expect(named.find((l) => l.evidence === 'LATER')!.id).toMatch(/^link_[0-9a-f]{24}$/);
    expect(await headOf(g, c)).toEqual({ [`${c}->${e}`]: 'EARLIER', [named.find((l) => l.evidence === 'LATER')!.id!]: 'LATER' });
  });

  it('stores a legacy edge with no evidence as the placeholder, in the head and on the edge', async () => {
    const g = await newGraph('No evidence');
    const c = await addEvent(g, 'cause', 1320);
    const e = await addEvent(g, 'effect', 1321);
    await idlessEdge(g, c, e, null, '2020-01-01T00:00:00Z');
    await idlessEdge(g, c, e, 'WITH', '2021-01-01T00:00:00Z');

    await migrate();

    const named = await edges(c);
    expect(named.map((l) => l.evidence).sort()).toEqual(['(no evidence recorded)', 'WITH']);
    expect(Object.values(await headOf(g, c)).sort()).toEqual(['(no evidence recorded)', 'WITH']);
  });

  it('retries a head that could not be written at the next start, losing nothing on rollback', async () => {
    const g = await newGraph('Reconcile fails');
    const c = await addEvent(g, 'cause', 1330);
    const e = await addEvent(g, 'effect', 1331);
    await idlessEdge(g, c, e, 'A', '2020-01-01T00:00:00Z');
    await idlessEdge(g, c, e, 'B', '2021-01-01T00:00:00Z');
    await headEntry(g, `${c}->${e}`, c, e, 'B');

    const failed = await migrate({ versioning: { recordBatch: async () => { throw new Error('ENOSPC: simulated version store failure'); } } });

    // Not named: a naming that outran its head is what lost a link on rollback.
    expect(failed.failedGraphs).toBeGreaterThanOrEqual(1);
    expect((await edges(c)).map((l) => l.id)).toEqual([null, null]);
    expect(await headOf(g, c)).toEqual({ [`${c}->${e}`]: 'B' });

    const second = await migrate();
    expect(second.failedGraphs).toBe(0);
    expect(second.reconciledGraphs).toBeGreaterThanOrEqual(1);
    expect(Object.values(await headOf(g, c)).sort()).toEqual(['A', 'B']);
    await container.graphService.rollbackGraph(g, await versionOf(g));
    expect((await liveLinks(g)).map((l) => l.evidence).sort()).toEqual(['A', 'B']);
  });

  it('plans the same ids after a stop between the head write and the naming, and makes no second version', async () => {
    const g = await newGraph('Stopped between');
    const c = await addEvent(g, 'cause', 1340);
    const e = await addEvent(g, 'effect', 1341);
    // Identical data on every edge: the case where a re-plan could swap ids.
    await idlessEdge(g, c, e, 'SAME', '2020-01-01T00:00:00Z');
    await idlessEdge(g, c, e, 'SAME', '2020-01-02T00:00:00Z');
    await idlessEdge(g, c, e, 'SAME', null);
    await headEntry(g, `${c}->${e}`, c, e, 'SAME');

    const stopped = await migrate({ openSession: stoppedBeforeNaming() });
    expect(stopped.failedGraphs).toBeGreaterThanOrEqual(1);
    expect((await edges(c)).map((l) => l.id)).toEqual([null, null, null]); // not named
    const headAfterStop = await headOf(g, c);
    expect(Object.keys(headAfterStop)).toHaveLength(3); // but the head was written
    const versionAfterStop = await versionOf(g);

    await migrate(); // the restart

    const named = (await edges(c)).map((l) => l.id!);
    expect(named).toContain(`${c}->${e}`); // the head's id stays with identical twins
    expect(new Set(named)).toEqual(new Set(Object.keys(headAfterStop))); // the head's ids, none new, none left over
    expect(await versionOf(g)).toBe(versionAfterStop); // the head was already right
    await container.graphService.rollbackGraph(g, await versionOf(g));
    expect(await liveLinks(g)).toHaveLength(3);
  });

  it('adopts the id of a lone head link for a lone edge, whatever the data (rule 2), and writes the live data under it', async () => {
    const g = await newGraph('Lone and lone');
    const c = await addEvent(g, 'cause', 1360);
    const e = await addEvent(g, 'effect', 1361);
    await idlessEdge(g, c, e, 'LIVE DATA', '2020-01-01T00:00:00Z');
    await headEntry(g, 'rel_x', c, e, 'STALE HEAD DATA');

    await migrate();

    expect(await edges(c)).toEqual([{ id: 'rel_x', evidence: 'LIVE DATA' }]);
    expect(await headOf(g, c)).toEqual({ rel_x: 'LIVE DATA' }); // one entry, not two
  });

  it('keeps the oldest of identical twins on cause->effect, pairing them with the head in a fixed order', async () => {
    const g = await newGraph('Identical twins');
    const c = await addEvent(g, 'cause', 1362);
    const e = await addEvent(g, 'effect', 1363);
    await idlessEdge(g, c, e, 'SAME', '2020-01-02T00:00:00Z');
    await idlessEdge(g, c, e, 'SAME', '2020-01-01T00:00:00Z');
    await headEntry(g, `${c}->${e}`, c, e, 'SAME');

    await migrate();

    const byAge = await neo<{ id: string; at: string }>(
      `MATCH (:Event {id: $c})-[r:CAUSES]->() RETURN r.id AS id, toString(r.created_at) AS at ORDER BY r.created_at`,
      { c }
    );
    expect(byAge[0]!.id).toBe(`${c}->${e}`);
    expect(byAge[1]!.id).toMatch(/^link_[0-9a-f]{24}$/);
  });

  it('writes the upgrade as a system version with its own description, not a user batch', async () => {
    const g = await newGraph('Upgrade version');
    const c = await addEvent(g, 'cause', 1364);
    const e = await addEvent(g, 'effect', 1365);
    await idlessEdge(g, c, e, 'A', '2020-01-01T00:00:00Z');
    await idlessEdge(g, c, e, 'B', '2021-01-01T00:00:00Z');
    await headEntry(g, `${c}->${e}`, c, e, 'B');

    await migrate();

    const latest = (await container.graphRepository.getLatestVersion(g))!;
    expect(latest.description).toBe('Upgrade: named 2 causal links (link ids)');
    expect(latest.userId).toBe('system:link-id-upgrade');
    expect(latest.description).not.toMatch(/in a batch/);
  });

  it('drops head links on a pair the graph holds no edge for, in the same version, but keeps a link to another graph', async () => {
    const g = await newGraph('Stale head');
    const c = await addEvent(g, 'cause', 1366);
    const e = await addEvent(g, 'effect', 1367);
    const ghost = await addEvent(g, 'ghost', 1368);
    await idlessEdge(g, c, e, 'LIVE', '2020-01-01T00:00:00Z');
    await headEntry(g, `${c}->${e}`, c, e, 'LIVE');
    // main left this one in the head: its edge was deleted without a version.
    await headEntry(g, `${ghost}->${e}`, ghost, e, 'GONE');
    // A link whose cause lives in another graph has no edge here, and is not stale.
    await container.graphRepository.commitChanges(
      g,
      {
        added: [
          {
            type: 'relationship',
            id: 'rel_cross',
            data: { id: 'rel_cross', cause_event_id: 'remote-event', effect_event_id: e, weight: 0.5, confidence: 0.5, evidence: 'ABROAD', relationship_type: 'direct', causeGraphId: 'another-graph' },
          },
        ],
        modified: [],
        deleted: [],
      },
      'create',
      'cross-graph link'
    );
    const before = await versionOf(g);

    await migrate();

    const head = (await container.graphRepository.checkout(g)).relationships;
    expect(Object.keys(head).sort()).toEqual([`${c}->${e}`, 'rel_cross'].sort());
    expect(await versionOf(g)).toBe(before + 1);
    expect((await container.graphRepository.getLatestVersion(g))!.description).toMatch(/removed 1 link the graph no longer holds/);
  });

  it('never overwrites an id that was set after the plan (the r.id IS NULL guard)', async () => {
    const g = await newGraph('Guard');
    const c = await addEvent(g, 'cause', 1369);
    const e = await addEvent(g, 'effect', 1370);
    await idlessEdge(g, c, e, 'RACED', '2020-01-01T00:00:00Z');
    const racing: () => MigrationSession = () => {
      const session = getDatabaseManager().getNeo4jSession();
      return {
        run: async (query, parameters) => {
          if (query.includes('SET r.id = row.id')) {
            // Somebody names the edge between the plan and the write.
            await session.run('MATCH (:Event {id: $c})-[r:CAUSES]->() SET r.id = $preset', { c, preset: 'preset-by-another' });
          }
          return session.run(query, parameters);
        },
        close: () => session.close(),
      };
    };

    await migrate({ openSession: racing });

    expect((await edges(c)).map((l) => l.id)).toEqual(['preset-by-another']);
  });

  it('keeps every pair whole within a chunk', async () => {
    const g = await newGraph('Chunks');
    const causes: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const c = await addEvent(g, `cause ${i}`, 1400 + i * 2);
      const e = await addEvent(g, `effect ${i}`, 1401 + i * 2);
      await idlessEdge(g, c, e, `first ${i}`, '2020-01-01T00:00:00Z');
      await idlessEdge(g, c, e, `second ${i}`, '2021-01-01T00:00:00Z');
      causes.push(c);
    }
    const statements: string[][] = [];
    const recording: () => MigrationSession = () => {
      const session = getDatabaseManager().getNeo4jSession();
      return {
        run: (query, parameters) => {
          if (query.includes('SET r.id = row.id')) statements.push((parameters!.rows as Array<{ element: string }>).map((row) => row.element));
          return session.run(query, parameters);
        },
        close: () => session.close(),
      };
    };

    // Chunks of 3 edges: pairs of 2 never fit three to a statement, so each statement holds one or two whole pairs.
    await migrate({ openSession: recording, chunkSize: 3 });

    expect(statements.length).toBeGreaterThan(1);
    const pairOf = new Map<string, string>();
    for (const row of await neo<{ element: string; cause: string }>(`MATCH (c:Event)-[r:CAUSES]->() WHERE c.id IN $causes RETURN elementId(r) AS element, c.id AS cause`, { causes })) {
      pairOf.set(row.element, row.cause);
    }
    for (const statement of statements) {
      const counts = new Map<string, number>();
      for (const element of statement) counts.set(pairOf.get(element)!, (counts.get(pairOf.get(element)!) ?? 0) + 1);
      for (const n of counts.values()) expect(n).toBe(2); // a pair is never split across statements
    }
    expect((await Promise.all(causes.map((c) => edges(c)))).flat().every((l) => l.id !== null)).toBe(true);
  });

  it('is a no-op once every edge is named', async () => {
    const g = await newGraph('Done');
    const c = await addEvent(g, 'cause', 1350);
    const e = await addEvent(g, 'effect', 1351);
    await idlessEdge(g, c, e, 'X', '2020-01-01T00:00:00Z');
    await migrate();
    const ids = await edges(c);
    expect(await migrate()).toEqual({ named: 0, adopted: 0, reconciledGraphs: 0, failedGraphs: 0 });
    expect(await edges(c)).toEqual(ids);
  });

  describe('at scale (Neo4j on a 1 GB heap, as docker-compose runs it)', () => {
    const seed = async (graphId: string, tag: string, pairs: number, twins: number): Promise<void> => {
      // Event ids are unique across the whole database, so each test names its own.
      // ... and starts from none of its own left by an interrupted run.
      await neo("MATCH (n:Event) WHERE n.id STARTS WITH $t CALL { WITH n DETACH DELETE n } IN TRANSACTIONS OF 5000 ROWS", { t: tag });
      await neo(
        `UNWIND range(0, $n - 1) AS i CALL { WITH i
           CREATE (:Event {id: $t + 'c' + i, graphId: $g, description: 'c', actor: 'A', target: 'B', timestamp: datetime('1900-01-01T00:00:00Z')})
           CREATE (:Event {id: $t + 'e' + i, graphId: $g, description: 'e', actor: 'A', target: 'B', timestamp: datetime('1901-01-01T00:00:00Z')})
         } IN TRANSACTIONS OF 10000 ROWS`,
        { n: pairs, g: graphId, t: tag }
      );
      await neo(
        `UNWIND range(0, $n - 1) AS i CALL { WITH i
           MATCH (c:Event {id: $t + 'c' + i, graphId: $g}), (e:Event {id: $t + 'e' + i, graphId: $g})
           CREATE (c)-[:CAUSES {weight: 0.5, confidence: 0.5, evidence: 'first ' + i, relationship_type: 'direct', created_at: datetime() - duration('PT1H'), graphId: $g}]->(e)
         } IN TRANSACTIONS OF 10000 ROWS`,
        { n: pairs, g: graphId, t: tag }
      );
      if (twins > 0) {
        await neo(
          `UNWIND range($s, $n - 1) AS i CALL { WITH i
             MATCH (c:Event {id: $t + 'c' + i, graphId: $g}), (e:Event {id: $t + 'e' + i, graphId: $g})
             CREATE (c)-[:CAUSES {weight: 0.5, confidence: 0.5, evidence: 'second ' + i, relationship_type: 'direct', created_at: datetime(), graphId: $g}]->(e)
           } IN TRANSACTIONS OF 10000 ROWS`,
          { s: pairs - twins, n: pairs, g: graphId, t: tag }
        );
      }
      // The head as main left it: one `cause->effect` entry per pair (the last written).
      const added = Array.from({ length: pairs }, (_, i) => ({
        type: 'relationship' as const,
        id: `${tag}c${i}->${tag}e${i}`,
        data: {
          id: `${tag}c${i}->${tag}e${i}`,
          cause_event_id: `${tag}c${i}`,
          effect_event_id: `${tag}e${i}`,
          weight: 0.5,
          confidence: 0.5,
          evidence: i >= pairs - twins ? `second ${i}` : `first ${i}`,
          relationship_type: 'direct',
        },
      }));
      await container.graphRepository.commitChanges(graphId, { added, modified: [], deleted: [] }, 'create', 'seed head as main left it');
    };

    it(`names ${SINGLES} id-less edges (one per pair) at startup`, async () => {
      const g = await newGraph('Scale singles');
      let t = Date.now();
      await seed(g, 'sa', SINGLES, 0);
      console.log(`[scale] seeded ${SINGLES} edges and their head in ${Date.now() - t} ms`);
      t = Date.now();
      const messages: string[] = [];
      const result = await migrate({ log: (m) => messages.push(m) });
      const ms = Date.now() - t;
      console.log(`[scale] named ${result.named} single-link pairs in ${ms} ms (${messages.length} progress lines)\n${messages.filter((m) => !/named \d+ of/.test(m)).join('\n')}`);
      expect(result.named).toBe(SINGLES);
      expect(result.failedGraphs).toBe(0);
      expect(result.reconciledGraphs).toBe(0); // the head already agreed: no version for 300k pairs
      const [count] = await neo<{ n: unknown; named: unknown }>(
        `MATCH ()-[r:CAUSES {graphId: $g}]->() RETURN count(r) AS n, count(r.id) AS named`,
        { g }
      );
      expect(Number(count!.n)).toBe(SINGLES);
      expect(Number(count!.named)).toBe(SINGLES);
      expect(messages.some((m) => /named \d+ of \d+/.test(m))).toBe(true);
      // A second start is one cheap read.
      t = Date.now();
      expect((await migrate()).named).toBe(0);
      console.log(`[scale] a start with nothing to name: ${Date.now() - t} ms`);
    }, 1_800_000);

    it(`names ${PAIRS} pairs of two links each, and writes their head as one version`, async () => {
      const g = await newGraph('Scale pairs');
      let t = Date.now();
      await seed(g, 'sb', PAIRS, PAIRS);
      console.log(`[scale] seeded ${PAIRS * 2} edges in ${PAIRS} pairs in ${Date.now() - t} ms`);
      const before = await versionOf(g);
      t = Date.now();
      const result = await migrate();
      const ms = Date.now() - t;
      console.log(`[scale] named ${result.named} links in ${PAIRS} two-link pairs in ${ms} ms`);
      expect(result.named).toBe(PAIRS * 2);
      expect(result.reconciledGraphs).toBe(1);
      expect(await versionOf(g)).toBe(before + 1);
      const head = (await container.graphRepository.checkout(g)).relationships;
      expect(Object.keys(head)).toHaveLength(PAIRS * 2);
      const [count] = await neo<{ n: unknown }>(`MATCH ()-[r:CAUSES {graphId: $g}]->() WHERE r.id IS NOT NULL RETURN count(r) AS n`, { g });
      expect(Number(count!.n)).toBe(PAIRS * 2);
    }, 1_800_000);
  });
});
