/**
 * The startup migration that scopes Event and Arc id constraints to a graph
 * (issue 35), against a real Neo4j, on a database shaped the way `main` left it:
 * `event_id` / `arc_id` unique on `id` alone, holding nodes of two graphs.
 *
 * Runs only under `vitest.cloud.config.ts`.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Session } from 'neo4j-driver';
import { getDatabaseManager, initializeDatabaseManager } from '@/utils/database';
import { loadConfig } from '@/utils/config';
import { initializeSchema } from '@/utils/schema';
import { migrateGraphScopedIdConstraints } from '@/utils/GraphScopedIdConstraintMigration';

const TAG = `mig35_${process.pid}`;
const GRAPH_A = `${TAG}_a`;
const GRAPH_B = `${TAG}_b`;

describe('the graph-scoped id constraint migration (#35)', () => {
  const neo = async <T = Record<string, unknown>>(query: string, parameters: Record<string, unknown> = {}): Promise<T[]> => {
    const session: Session = getDatabaseManager().getNeo4jSession();
    try {
      const result = await session.run(query, parameters);
      return result.records.map((record) => record.toObject() as T);
    } finally {
      await session.close();
    }
  };

  const migrate = () =>
    migrateGraphScopedIdConstraints({ openSession: () => getDatabaseManager().getNeo4jSession(), log: () => undefined, warn: () => undefined });

  /** The id constraints, by what they constrain. */
  const idConstraints = async (): Promise<string[]> =>
    (
      await neo<{ label: string; properties: string[] }>(
        `SHOW CONSTRAINTS YIELD type, labelsOrTypes, properties
         WHERE type = 'UNIQUENESS' AND labelsOrTypes IN [['Event'], ['Arc']]
         RETURN labelsOrTypes[0] AS label, properties`
      )
    )
      .map((row) => `${row.label}(${row.properties.join(',')})`)
      .sort();

  const dropIdConstraints = async (): Promise<void> => {
    const rows = await neo<{ name: string }>(
      `SHOW CONSTRAINTS YIELD name, type, labelsOrTypes WHERE type = 'UNIQUENESS' AND labelsOrTypes IN [['Event'], ['Arc']] RETURN name`
    );
    for (const row of rows) await neo(`DROP CONSTRAINT \`${row.name}\` IF EXISTS`);
  };

  /** The constraints `main` created, under the names it gave them. */
  const mainConstraints = async (): Promise<void> => {
    await dropIdConstraints();
    await neo('CREATE CONSTRAINT event_id IF NOT EXISTS FOR (e:Event) REQUIRE e.id IS UNIQUE');
    await neo('CREATE CONSTRAINT arc_id IF NOT EXISTS FOR (a:Arc) REQUIRE a.id IS UNIQUE');
  };

  const clean = async (): Promise<void> => {
    await neo('MATCH (n) WHERE n.graphId IN $ids OR n.id STARTS WITH $tag DETACH DELETE n', { ids: [GRAPH_A, GRAPH_B], tag: TAG });
  };

  beforeAll(async () => {
    const databaseManager = initializeDatabaseManager(loadConfig().database);
    await databaseManager.initializeNeo4j();
    await initializeSchema();
  });

  beforeEach(async () => {
    await clean();
  });

  afterAll(async () => {
    await clean();
    await dropIdConstraints();
    await initializeSchema();
    await migrate();
  });

  const both = ['Arc(graphId,id)', 'Event(graphId,id)'];

  it('moves a database `main` created to (graphId, id), keeping the nodes of both graphs', async () => {
    await mainConstraints();
    await neo(
      `CREATE (:Event {id: $e1, graphId: $a}), (:Event {id: $e2, graphId: $b}), (:Arc {id: $r1, graphId: $a}), (:Arc {id: $r2, graphId: $b})`,
      { e1: `${TAG}_e1`, e2: `${TAG}_e2`, r1: `${TAG}_r1`, r2: `${TAG}_r2`, a: GRAPH_A, b: GRAPH_B }
    );
    expect(await idConstraints()).toEqual(['Arc(id)', 'Event(id)']);
    // The old constraint is what refuses the same id in a second graph.
    await expect(neo('CREATE (:Event {id: $id, graphId: $b})', { id: `${TAG}_e1`, b: GRAPH_B })).rejects.toThrow(/already exists/);

    const result = await migrate();

    expect(result.created.sort()).toEqual(['arc_graph_id', 'event_graph_id']);
    expect(result.dropped.sort()).toEqual(['arc_id', 'event_id']);
    expect(await idConstraints()).toEqual(both);
    const kept = await neo<{ n: number }>('MATCH (n) WHERE n.graphId IN $ids RETURN count(n) AS n', { ids: [GRAPH_A, GRAPH_B] });
    expect(Number(kept[0]?.n)).toBe(4);
    // Same id in the other graph now; the same id twice in one graph is still refused.
    await neo('CREATE (:Event {id: $id, graphId: $b}), (:Arc {id: $arc, graphId: $b})', { id: `${TAG}_e1`, arc: `${TAG}_r1`, b: GRAPH_B });
    await expect(neo('CREATE (:Event {id: $id, graphId: $a})', { id: `${TAG}_e1`, a: GRAPH_A })).rejects.toThrow(/already exists/);
    await expect(neo('CREATE (:Arc {id: $id, graphId: $a})', { id: `${TAG}_r1`, a: GRAPH_A })).rejects.toThrow(/already exists/);
  });

  it('is a no-op on a database that is already migrated, and on a fresh one', async () => {
    await dropIdConstraints();
    // Fresh: nothing to drop.
    const fresh = await migrate();
    expect(fresh.dropped).toEqual([]);
    expect(fresh.created.sort()).toEqual(['arc_graph_id', 'event_graph_id']);
    expect(await idConstraints()).toEqual(both);

    const again = await migrate();
    expect(again.created).toEqual([]);
    expect(again.dropped).toEqual([]);
    expect(await idConstraints()).toEqual(both);
  });

  it('finishes a migration that stopped after creating the composite constraints, and one that stopped after the drop', async () => {
    await mainConstraints();
    await neo('CREATE CONSTRAINT event_graph_id IF NOT EXISTS FOR (e:Event) REQUIRE (e.graphId, e.id) IS UNIQUE');
    expect(await idConstraints()).toEqual(['Arc(id)', 'Event(graphId,id)', 'Event(id)']);
    const afterCreate = await migrate();
    expect(afterCreate.created).toEqual(['arc_graph_id']);
    expect(afterCreate.dropped.sort()).toEqual(['arc_id', 'event_id']);
    expect(await idConstraints()).toEqual(both);

    await neo('DROP CONSTRAINT arc_graph_id IF EXISTS');
    expect(await idConstraints()).toEqual(['Event(graphId,id)']);
    expect((await migrate()).created).toEqual(['arc_graph_id']);
    expect(await idConstraints()).toEqual(both);
  });

  it('drops an old constraint whatever it is called', async () => {
    await dropIdConstraints();
    await neo('CREATE CONSTRAINT my_own_name FOR (e:Event) REQUIRE e.id IS UNIQUE');
    const result = await migrate();
    expect(result.dropped).toEqual(['my_own_name']);
    expect(await idConstraints()).toEqual(both);
  });

  it('reports nodes that carry no graph, leaves them alone, and still migrates', async () => {
    await mainConstraints();
    await neo('CREATE (:Event {id: $e}), (:Arc {id: $a})', { e: `${TAG}_legacy_e`, a: `${TAG}_legacy_a` });
    const result = await migrate();
    expect(result.unattributed.events).toBeGreaterThanOrEqual(1);
    expect(result.unattributed.arcs).toBeGreaterThanOrEqual(1);
    expect(await idConstraints()).toEqual(both);
    expect(await neo('MATCH (n {id: $e}) RETURN n.graphId AS graphId', { e: `${TAG}_legacy_e` })).toEqual([{ graphId: null }]);
  });

  it('refuses, and creates nothing, when a graph already holds an id twice', async () => {
    await dropIdConstraints();
    await neo('CREATE (:Event {id: $id, graphId: $a}), (:Event {id: $id, graphId: $a})', { id: `${TAG}_dup`, a: GRAPH_A });
    await expect(migrate()).rejects.toThrow(new RegExp(`${GRAPH_A}/${TAG}_dup`));
    expect((await idConstraints()).includes('Event(graphId,id)')).toBe(false);
  });
});
