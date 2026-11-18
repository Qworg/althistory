/**
 * The id-constraint migration as the process runs it at startup (issue 35).
 *
 * `cloud-graph-id-constraint-migration.test.ts` runs the migration function. This boots the real
 * `Application` on a database an older release created (`event_id` / `arc_id` unique on `id`), so
 * a startup that stopped calling the migration would fail here: the composite constraints must be
 * there afterwards, the old ones gone, and a branch must hold its parent's ids.
 *
 * Runs only under `vitest.cloud.config.ts`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Application } from '@/index';
import { cleanupContainer, getContainer, type Container } from '@/container';
import { initializeSchema } from '@/utils/schema';
import { getDatabaseManager, initializeDatabaseManager } from '@/utils/database';
import { loadConfig } from '@/utils/config';

describe('the startup migration of the id constraints (#35)', () => {
  let dataDir: string;
  let container: Container;
  const graphs: string[] = [];
  const saved: Record<string, string | undefined> = {};

  const setEnv = (name: string, value: string | undefined): void => {
    if (!(name in saved)) saved[name] = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };

  const neo = async <T = Record<string, unknown>>(query: string, parameters: Record<string, unknown> = {}): Promise<T[]> => {
    const session = getDatabaseManager().getNeo4jSession();
    try {
      return (await session.run(query, parameters)).records.map((record) => record.toObject() as T);
    } finally {
      await session.close();
    }
  };

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

  beforeAll(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cloud-startup-migration-'));
    setEnv('LOCAL_EXECUTION_ENABLED', 'false');
    setEnv('CLOUD_SINGLE_REPLICA_STATE', 'true');
    setEnv('LOCAL_DATA_DIR', dataDir);

    // The database as an older release left it.
    initializeDatabaseManager(loadConfig().database);
    await getDatabaseManager().initializeNeo4j();
    await initializeSchema();
    for (const row of await neo<{ name: string }>(
      `SHOW CONSTRAINTS YIELD name, type, labelsOrTypes WHERE type = 'UNIQUENESS' AND labelsOrTypes IN [['Event'], ['Arc']] RETURN name`
    )) {
      await neo(`DROP CONSTRAINT \`${row.name}\` IF EXISTS`);
    }
    await neo('CREATE CONSTRAINT event_id IF NOT EXISTS FOR (e:Event) REQUIRE e.id IS UNIQUE');
    await neo('CREATE CONSTRAINT arc_id IF NOT EXISTS FOR (a:Arc) REQUIRE a.id IS UNIQUE');
    expect(await idConstraints()).toEqual(['Arc(id)', 'Event(id)']);

    await new Application({ exit: () => undefined }).initialize();
    container = getContainer();
  });

  afterAll(async () => {
    await neo('MATCH (n) WHERE n.graphId IN $ids DETACH DELETE n', { ids: graphs });
    await cleanupContainer();
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await fs.rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it('leaves the composite constraints and no old ones', async () => {
    expect(await idConstraints()).toEqual(['Arc(graphId,id)', 'Event(graphId,id)']);
  });

  it('lets a branch hold its parent’s ids', async () => {
    const parent = (await container.graphService.createGraph({ name: 'Startup parent' })).id;
    graphs.push(parent);
    const parentRepos = await container.graphScopedRepositories(parent);
    const arc = await parentRepos.arcRepository.create({ name: 'Era', start_time: new Date(Date.UTC(1900, 0, 1)), end_time: new Date(Date.UTC(1999, 0, 1)), level: 1 });
    await container.graphWriteVersioningService.recordArc(parent, arc, 'create');
    const event = await parentRepos.eventRepository.create({ description: 'Something', actor: 'A', target: 'B', timestamp: new Date(Date.UTC(1950, 0, 1)) });
    await container.graphWriteVersioningService.recordEvent(parent, event, 'create');

    const branch = (await container.graphService.branchGraph(parent, { name: 'Startup branch' } as never)).id;
    graphs.push(branch);

    const branchRepos = await container.graphScopedRepositories(branch);
    expect((await branchRepos.eventRepository.findAll()).map((e) => e.id)).toEqual([event.id]);
    expect((await branchRepos.arcRepository.findAll()).map((a) => a.id)).toEqual([arc.id]);
  });
});
