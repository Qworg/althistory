import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Container } from '@/container';
import { LocalDatabaseManager } from '@/utils/database';
import { LocalGraphStore } from '@/utils/LocalGraphStore';
import { AppConfig } from '@/utils/config';

/**
 * Branch, rollback, merge and import write only a graph's version tree, while
 * every entity route and the UI read its live store. These tests drive the
 * real container in local mode, write the way the routes do (live store, then
 * the version record), and check that after each version-only operation the
 * live store holds exactly the version head -- with the same ids.
 */

function createConfig(dataDirectory: string): AppConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    nodeEnv: 'test',
    database: {
      neo4j: { uri: 'bolt://localhost:7687', username: 'neo4j', password: 'password' },
      redis: { host: 'localhost', port: 6379 },
    },
    performance: { queryTimeoutMs: 2000, maxQueryResults: 10000, cacheExpirationMs: 300000 },
    cloudState: { singleReplicaAcknowledged: true },
    apiAuth: { required: false },
    localExecution: {
      enabled: true,
      dataDirectory,
      graphFile: 'unscoped-graph.json',
      cacheSize: 1000,
      persistenceInterval: 30000,
      backupEnabled: false,
      backupInterval: 300000,
      maxMemoryUsage: 512,
    },
  };
}

describe('LiveStoreSyncService (via the container)', () => {
  let testDir: string;
  let container: Container;
  const originalBackupSetting = process.env.LOCAL_BACKUP_ENABLED;
  const originalLocal = process.env.LOCAL_EXECUTION_ENABLED;
  const originalDataDir = process.env.LOCAL_DATA_DIR;

  beforeEach(async () => {
    process.env.LOCAL_BACKUP_ENABLED = 'false';
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'live-store-sync-'));
    // CausalService reads the execution mode from the environment config.
    process.env.LOCAL_EXECUTION_ENABLED = 'true';
    process.env.LOCAL_DATA_DIR = testDir;
    const unscoped = new LocalGraphStore({ dataFile: path.join(testDir, 'unscoped.json') });
    container = new Container(new LocalDatabaseManager(unscoped), createConfig(testDir));
  });

  afterEach(async () => {
    await container.cleanup();
    await fs.rm(testDir, { recursive: true, force: true });
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore('LOCAL_BACKUP_ENABLED', originalBackupSetting);
    restore('LOCAL_EXECUTION_ENABLED', originalLocal);
    restore('LOCAL_DATA_DIR', originalDataDir);
  });

  /** Write a small history the way the entity routes do. */
  async function seedGraph(name: string) {
    const graph = await container.graphService.createGraph({ name });
    const repos = await container.graphScopedRepositories(graph.id);
    const versioning = container.graphWriteVersioningService;

    const first = await repos.eventRepository.create({
      description: 'The engine is finished',
      actor: 'Babbage',
      target: 'Engine',
      timestamp: new Date('1843-11-20T00:00:00Z'),
    });
    await versioning.recordEvent(graph.id, first, 'create');
    const second = await repos.eventRepository.create({
      description: 'The Admiralty orders engines',
      actor: 'Admiralty',
      target: 'Engine',
      timestamp: new Date('1845-04-14T00:00:00Z'),
    });
    await versioning.recordEvent(graph.id, second, 'create');
    const arc = await repos.arcRepository.create({
      name: 'Building the Engine',
      start_time: new Date('1840-01-01T00:00:00Z'),
      end_time: new Date('1846-01-01T00:00:00Z'),
      level: 1,
    });
    await versioning.recordArc(graph.id, arc, 'create');
    const link = await repos.causalService.createCausalLink(first, second, {
      relationship_type: 'direct',
      weight: 0.8,
      confidence: 0.9,
      evidence: 'The demonstration convinced the navy.',
    });
    await versioning.recordRelationship(graph.id, link, 'create');

    return { graph, first, second, arc, link };
  }

  async function liveIds(graphId: string) {
    const repos = await container.graphScopedRepositories(graphId);
    const events = await repos.eventRepository.findAll();
    const arcs = await repos.arcRepository.findAll();
    const relationships = await repos.causalService.getAllRelationships();
    return {
      events: events.map((e) => e.id).sort(),
      arcs: arcs.map((a) => a.id).sort(),
      relationships: relationships.map((r) => r.id).sort(),
    };
  }

  async function headIds(graphId: string) {
    const head = await container.graphRepository.checkout(graphId);
    return {
      events: Object.keys(head.events).sort(),
      arcs: Object.keys(head.arcs).sort(),
      relationships: Object.keys(head.relationships).sort(),
    };
  }

  it('gives a new branch the copied history in its live store, with the same ids', async () => {
    const { graph, first, second, arc, link } = await seedGraph('Main');

    const branch = await container.graphService.branchGraph(graph.id, { name: 'Branch' });

    const live = await liveIds(branch.id);
    expect(live.events).toEqual([first.id, second.id].sort());
    expect(live.arcs).toEqual([arc.id]);
    expect(live.relationships).toEqual([link.id]);
    expect(live).toEqual(await headIds(branch.id));

    // The copied entities keep their content, not only their ids.
    const repos = await container.graphScopedRepositories(branch.id);
    const copied = await repos.eventRepository.findById(first.id);
    expect(copied?.description).toBe('The engine is finished');
    expect(copied?.timestamp.toISOString()).toBe('1843-11-20T00:00:00.000Z');
    const [copiedLink] = await repos.causalService.getAllRelationships();
    expect(copiedLink).toMatchObject({
      cause_event_id: first.id,
      effect_event_id: second.id,
      weight: 0.8,
      relationship_type: 'direct',
    });
  });

  it('leaves the source graph untouched when branching', async () => {
    const { graph } = await seedGraph('Main');
    const before = await liveIds(graph.id);
    await container.graphService.branchGraph(graph.id, { name: 'Branch' });
    expect(await liveIds(graph.id)).toEqual(before);
  });

  it('rolls the live store back with the version tree', async () => {
    const { graph, first } = await seedGraph('Main');
    const { versions } = await container.graphService.getVersionHistory(graph.id);
    // The version whose tree holds only the first event (found by content,
    // not assumed from numbering).
    let afterFirst: number | undefined;
    for (const { version } of [...versions].sort((a, b) => a.version - b.version)) {
      const tree = await container.graphRepository.checkout(graph.id, version);
      if (Object.keys(tree.events).length === 1) {
        afterFirst = version;
        break;
      }
    }
    expect(afterFirst).toBeDefined();

    await container.graphService.rollbackGraph(graph.id, afterFirst!);

    const live = await liveIds(graph.id);
    expect(live).toEqual(await headIds(graph.id));
    expect(live.events).toEqual([first.id]);
    expect(live.relationships).toEqual([]);
  });

  it('brings merged entities into the target graph live store', async () => {
    const { graph } = await seedGraph('Main');
    const branch = await container.graphService.branchGraph(graph.id, { name: 'Branch' });

    // A new event on the branch, written the way the routes write.
    const branchRepos = await container.graphScopedRepositories(branch.id);
    const added = await branchRepos.eventRepository.create({
      description: 'Parliament bans the engines',
      actor: 'Parliament',
      target: 'Engine',
      timestamp: new Date('1860-07-12T00:00:00Z'),
    });
    await container.graphWriteVersioningService.recordEvent(branch.id, added, 'create');

    const result = await container.graphService.mergeGraph(graph.id, {
      sourceGraphId: branch.id,
      conflictResolution: 'keep-source',
    });
    expect(result.success).toBe(true);

    const live = await liveIds(graph.id);
    expect(live.events).toContain(added.id);
    expect(live).toEqual(await headIds(graph.id));
  });

  it('keeps later live writes mirroring onto the same version entities', async () => {
    const { graph, first } = await seedGraph('Main');
    const branch = await container.graphService.branchGraph(graph.id, { name: 'Branch' });

    const repos = await container.graphScopedRepositories(branch.id);
    const updated = await repos.eventRepository.update(first.id, { description: 'The engine is finished, at last' });
    expect(updated).not.toBeNull();
    await container.graphWriteVersioningService.recordEvent(branch.id, updated!, 'update');

    const head = await container.graphRepository.checkout(branch.id);
    expect(Object.keys(head.events)).toHaveLength(2);
    expect(head.events[first.id]?.description).toBe('The engine is finished, at last');
  });
});
