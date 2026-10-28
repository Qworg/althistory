import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Container } from '@/container';
import { LocalDatabaseManager } from '@/utils/database';
import { LocalGraphStore } from '@/utils/LocalGraphStore';
import { AppConfig } from '@/utils/config';
import { GRAPHS_LIVE_DIRECTORY } from '@/utils/GraphContextStore';
import { CreateEventRequest } from '@/models/Event';

/**
 * Container-level acceptance for graph-scoped isolation (design §5.2).
 *
 * The container builds a fresh container per test rather than using the global
 * one, so this suite owns every store and timer it creates and cannot leak into
 * the shared container used by the route suites.
 */
function createConfig(dataDirectory: string): AppConfig {
  return {
    port: 0,
    nodeEnv: 'test',
    database: {
      neo4j: {
        uri: 'bolt://localhost:7687',
        username: 'neo4j',
        password: 'password',
      },
      redis: {
        host: 'localhost',
        port: 6379,
      },
    },
    performance: {
      queryTimeoutMs: 2000,
      maxQueryResults: 10000,
      cacheExpirationMs: 300000,
    },
    cloudState: {
      singleReplicaAcknowledged: true,
    },
    // Required by `AppConfig`; the entity guard reads the environment (`api/entityAuth.ts`).
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

function eventData(description: string, actor: string): CreateEventRequest {
  return {
    description,
    actor,
    target: 'target',
    timestamp: new Date('2020-01-01T00:00:00.000Z'),
  };
}

describe('graph-scoped repositories', () => {
  let testDir: string;
  let container: Container;
  const originalBackupSetting = process.env.LOCAL_BACKUP_ENABLED;

  beforeEach(async () => {
    // Backups install a per-store interval timer; disable them so the suite is
    // deterministic and leaves no lingering handles.
    process.env.LOCAL_BACKUP_ENABLED = 'false';
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'graph-scoped-repos-'));

    // The unscoped manager is required by the container constructor but never
    // used by `graphScopedRepositories`; bind it to a throwaway file so it
    // cannot touch the repo's real data directory.
    const unscopedStore = new LocalGraphStore({
      dataFile: path.join(testDir, 'unscoped.json'),
    });
    container = new Container(new LocalDatabaseManager(unscopedStore), createConfig(testDir));
  });

  afterEach(async () => {
    await container.cleanup();
    await fs.rm(testDir, { recursive: true, force: true });
    if (originalBackupSetting === undefined) {
      delete process.env.LOCAL_BACKUP_ENABLED;
    } else {
      process.env.LOCAL_BACKUP_ENABLED = originalBackupSetting;
    }
  });

  describe('store binding', () => {
    it('binds each graph id to its own store and file under graphs-live', async () => {
      const graphA = await container.graphScopedRepositories('graph-a');
      const graphB = await container.graphScopedRepositories('graph-b');

      expect(graphA.eventRepository).not.toBe(graphB.eventRepository);
      expect(graphA.arcRepository).not.toBe(graphB.arcRepository);

      expect(container.graphContextStore.getFilePath('graph-a')).toBe(
        path.join(testDir, GRAPHS_LIVE_DIRECTORY, 'graph-a.json')
      );
      expect(container.graphContextStore.getFilePath('graph-b')).toBe(
        path.join(testDir, GRAPHS_LIVE_DIRECTORY, 'graph-b.json')
      );
    });

    it('reuses the repository wrapper while the store is resident', async () => {
      const first = await container.graphScopedRepositories('graph-a');
      const second = await container.graphScopedRepositories('graph-a');

      expect(second.eventRepository).toBe(first.eventRepository);
      expect(second.arcRepository).toBe(first.arcRepository);
    });
  });

  describe('isolation', () => {
    it('never returns graph A events from graph B and vice versa', async () => {
      const graphA = await container.graphScopedRepositories('graph-a');
      const graphB = await container.graphScopedRepositories('graph-b');

      const eventA = await graphA.eventRepository.create(eventData('Only in A', 'actor-a'));
      const eventB = await graphB.eventRepository.create(eventData('Only in B', 'actor-b'));

      const eventsA = await graphA.eventRepository.findAll();
      const eventsB = await graphB.eventRepository.findAll();

      expect(eventsA.map((event) => event.id)).toEqual([eventA.id]);
      expect(eventsB.map((event) => event.id)).toEqual([eventB.id]);

      // A direct id lookup cannot cross the graph boundary either, even though
      // both events live in the same process and share a repository class.
      expect(await graphB.eventRepository.findById(eventA.id)).toBeNull();
      expect(await graphA.eventRepository.findById(eventB.id)).toBeNull();
    });

    it('persists each graph to its own file and reloads the isolation', async () => {
      const graphA = await container.graphScopedRepositories('graph-a');
      const graphB = await container.graphScopedRepositories('graph-b');

      const eventA = await graphA.eventRepository.create(eventData('Persisted A', 'actor-a'));
      const eventB = await graphB.eventRepository.create(eventData('Persisted B', 'actor-b'));

      // Shutting down every scoped store saves the pending writes.
      await container.graphContextStore.evictAll();

      const rawA = await fs.readFile(
        container.graphContextStore.getFilePath('graph-a'),
        'utf8'
      );
      const rawB = await fs.readFile(
        container.graphContextStore.getFilePath('graph-b'),
        'utf8'
      );
      expect(rawA).toContain(eventA.id);
      expect(rawA).not.toContain(eventB.id);
      expect(rawB).toContain(eventB.id);
      expect(rawB).not.toContain(eventA.id);

      // A fresh wrapper over the reloaded store (the container replaces the
      // cached one when the store identity changes) still sees only its graph.
      const reloadedA = await container.graphScopedRepositories('graph-a');
      const reloadedB = await container.graphScopedRepositories('graph-b');

      expect(reloadedA.eventRepository).not.toBe(graphA.eventRepository);
      expect((await reloadedA.eventRepository.findAll()).map((event) => event.id)).toEqual([
        eventA.id,
      ]);
      expect((await reloadedB.eventRepository.findAll()).map((event) => event.id)).toEqual([
        eventB.id,
      ]);
    });
  });

  describe('manager injection', () => {
    it('uses an injected store instead of constructing the legacy one', () => {
      const injected = new LocalGraphStore({ dataFile: path.join(testDir, 'injected.json') });
      const manager = new LocalDatabaseManager(injected);

      expect(manager.getGraphStore()).toBe(injected);
    });

    it('keeps the no-arg constructor bound to a store of its own', () => {
      const injected = new LocalGraphStore({ dataFile: path.join(testDir, 'injected.json') });
      const manager = new LocalDatabaseManager();

      expect(manager.getGraphStore()).not.toBe(injected);
    });
  });
});
