import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { initializeContainer, cleanupContainer } from '@/container';
import { loadConfig, initializeDatabaseManager } from '@/utils';
import type { CacheManager } from '@/utils/cache';
import { initializeCache, shutdownCache } from '@/utils/cache';
import { LocalDatabaseManager } from '@/utils/database';
import type { DatabaseManager } from '@/utils/database';
import { LocalGraphStore } from '@/utils/LocalGraphStore';
import { BackupRecoveryService } from '@/services/BackupRecoveryService';

/**
 * These tests run in local-execution mode, where the database manager is a
 * LocalDatabaseManager and its getRedisClient() returns a CacheManager.
 * The production DatabaseManager instead returns a raw Redis client, so
 * initializeDatabaseManager returns a union and the result needs narrowing
 * rather than casting.
 */
const asLocalCacheManager = (
  dbManager: DatabaseManager | LocalDatabaseManager
): CacheManager => {
  if (!(dbManager instanceof LocalDatabaseManager)) {
    throw new Error('expected a LocalDatabaseManager in local execution mode');
  }
  return dbManager.getRedisClient();
};
import * as fs from 'fs/promises';
import * as path from 'path';

describe('Local Persistence Integration Tests', () => {
  const testDataDir = './test-persistence-data';
  const graphFile = 'persistence-test-graph.json';
  const cacheFile = 'cache.json';
  const backupDir = path.join(testDataDir, 'backups');

  // Config validation (src/utils/config.ts) rejects a persistence interval below
  // 1000ms and a backup interval below 60000ms, and loadConfig() reads
  // process.env every time it is called.
  const MIN_PERSISTENCE_INTERVAL = '1000';
  const MIN_BACKUP_INTERVAL = '60000';

  // Every environment variable a test in this file mutates. `process.env` is
  // shared by all tests in the worker, so a value left behind by one test (an
  // interval below the validation minimum, backups left enabled) would make
  // loadConfig() throw for every test that follows it.
  const mutatedEnvKeys = [
    'LOCAL_EXECUTION_ENABLED',
    'LOCAL_DATA_DIR',
    'LOCAL_GRAPH_FILE',
    'LOCAL_PERSISTENCE_INTERVAL',
    'LOCAL_BACKUP_ENABLED',
    'LOCAL_BACKUP_INTERVAL'
  ] as const;
  const originalEnv = new Map<string, string | undefined>();

  beforeAll(async () => {
    for (const key of mutatedEnvKeys) {
      originalEnv.set(key, process.env[key]);
    }
    await fs.mkdir(testDataDir, { recursive: true });
  });

  afterEach(async () => {
    for (const key of mutatedEnvKeys) {
      const original = originalEnv.get(key);
      if (original === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original;
      }
    }
    // A failed assertion can skip the in-test cleanup; make sure no container
    // (and its persistence timers) survives into the next test.
    await cleanupContainer();
    // The cache manager is a process-wide singleton, so drop it as well;
    // otherwise entries from this test would still be in memory when the next
    // test builds its own "first instance".
    await shutdownCache();
  });

  afterAll(async () => {
    // rmdir only removes empty directories, and the backup tests leave files
    // behind, so remove the tree recursively.
    await fs.rm(testDataDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    // Start every test from an empty store: the local database manager loads
    // whatever is on disk, so leftover files would leak into the next test.
    await fs.rm(path.join(testDataDir, graphFile), { force: true });
    await fs.rm(path.join(testDataDir, cacheFile), { force: true });
    await fs.rm(backupDir, { recursive: true, force: true });
  });

  describe('Graph Data Persistence', () => {
    it('should persist and restore graph data across application restarts', async () => {
      // Configure local execution
      process.env.LOCAL_EXECUTION_ENABLED = 'true';
      process.env.LOCAL_DATA_DIR = testDataDir;
      process.env.LOCAL_GRAPH_FILE = graphFile;
      process.env.LOCAL_BACKUP_ENABLED = 'false';

      // Phase 1: Create and populate data
      let config = loadConfig();
      let dbManager = initializeDatabaseManager(config.database);
      let container = initializeContainer(dbManager, config);
      
      await container.initialize();

      const eventRepository1 = container.eventRepository;
      const arcRepository1 = container.arcRepository;

      // Create test data
      const event1 = await eventRepository1.create({
        description: 'Persistent Event 1',
        actor: 'Persistent Actor 1',
        target: 'Persistent Target 1',
        timestamp: new Date('2023-04-01T10:00:00Z'),
        metadata: { persistenceTest: true, phase: 1 }
      });

      const event2 = await eventRepository1.create({
        description: 'Persistent Event 2',
        actor: 'Persistent Actor 2',
        target: 'Persistent Target 2',
        timestamp: new Date('2023-04-01T11:00:00Z'),
        metadata: { persistenceTest: true, phase: 1 }
      });

      const arc1 = await arcRepository1.create({
        name: 'Persistent Arc 1',
        start_time: event1.timestamp,
        end_time: event2.timestamp,
        level: 0,
        metadata: { persistenceTest: true, phase: 1, weight: 0.85, confidence: 0.92 }
      });

      // Verify data exists in first instance
      const foundEvent1_1 = await eventRepository1.findById(event1.id);
      const foundEvent2_1 = await eventRepository1.findById(event2.id);
      const foundArc1_1 = await arcRepository1.findById(arc1.id);

      expect(foundEvent1_1).not.toBeNull();
      expect(foundEvent2_1).not.toBeNull();
      expect(foundArc1_1).not.toBeNull();

      // Gracefully shut down first instance (should trigger data persistence)
      await cleanupContainer();

      // Verify files were created
      const graphFilePath = path.join(testDataDir, graphFile);
      const graphFileExists = await fs.access(graphFilePath).then(() => true).catch(() => false);
      expect(graphFileExists).toBe(true);

      // Verify file contains expected data
      const graphData = JSON.parse(await fs.readFile(graphFilePath, 'utf8'));
      expect(graphData).toHaveProperty('nodes');
      expect(graphData).toHaveProperty('relationships');
      expect(Object.keys(graphData.nodes)).toContain(event1.id);
      expect(Object.keys(graphData.nodes)).toContain(event2.id);

      // Phase 2: Create new instance and verify data is restored
      config = loadConfig();
      dbManager = initializeDatabaseManager(config.database);
      container = initializeContainer(dbManager, config);
      
      await container.initialize();

      const eventRepository2 = container.eventRepository;
      const arcRepository2 = container.arcRepository;

      // Verify all data was restored
      const foundEvent1_2 = await eventRepository2.findById(event1.id);
      const foundEvent2_2 = await eventRepository2.findById(event2.id);
      const foundArc1_2 = await arcRepository2.findById(arc1.id);

      expect(foundEvent1_2).not.toBeNull();
      expect(foundEvent1_2?.description).toBe('Persistent Event 1');
      expect(foundEvent1_2?.actor).toBe('Persistent Actor 1');
      expect(foundEvent1_2?.metadata?.persistenceTest).toBe(true);

      expect(foundEvent2_2).not.toBeNull();
      expect(foundEvent2_2?.description).toBe('Persistent Event 2');
      
      expect(foundArc1_2).not.toBeNull();
      expect(foundArc1_2?.name).toBe('Persistent Arc 1');
      expect(foundArc1_2?.start_time).toEqual(event1.timestamp);
      expect(foundArc1_2?.end_time).toEqual(event2.timestamp);
      expect(foundArc1_2?.metadata).toMatchObject({ weight: 0.85, confidence: 0.92 });

      // Phase 3: Add more data and verify it coexists with restored data
      const event3 = await eventRepository2.create({
        description: 'Persistent Event 3',
        actor: 'Persistent Actor 3',
        target: 'Persistent Target 3',
        timestamp: new Date('2023-04-01T12:00:00Z'),
        metadata: { persistenceTest: true, phase: 2 }
      });

      await arcRepository2.create({
        name: 'Persistent Arc 2',
        start_time: event2.timestamp,
        end_time: event3.timestamp,
        level: 0,
        metadata: { persistenceTest: true, phase: 2, weight: 0.75 }
      });

      // Verify all data (original + new) exists
      const allEvents = await eventRepository2.findAll();
      const allArcs = await arcRepository2.findAll();

      expect(allEvents).toHaveLength(3);
      expect(allArcs).toHaveLength(2);

      await cleanupContainer();
    });

    it('should handle corrupted graph data files gracefully', async () => {
      process.env.LOCAL_EXECUTION_ENABLED = 'true';
      process.env.LOCAL_DATA_DIR = testDataDir;
      process.env.LOCAL_GRAPH_FILE = graphFile;

      // Create a corrupted graph file
      const graphFilePath = path.join(testDataDir, graphFile);
      await fs.writeFile(graphFilePath, 'invalid json content');

      const config = loadConfig();
      const dbManager = initializeDatabaseManager(config.database);
      const container = initializeContainer(dbManager, config);

      // Should initialize without throwing error (graceful degradation)
      await expect(container.initialize()).resolves.not.toThrow();

      // Should start with empty data
      const eventRepository = container.eventRepository;
      const allEvents = await eventRepository.findAll();
      expect(allEvents).toHaveLength(0);

      await cleanupContainer();
    });

    it('should preserve data relationships across restarts', async () => {
      process.env.LOCAL_EXECUTION_ENABLED = 'true';
      process.env.LOCAL_DATA_DIR = testDataDir;
      process.env.LOCAL_GRAPH_FILE = graphFile;

      // Phase 1: Create complex relationship network
      let config = loadConfig();
      let dbManager = initializeDatabaseManager(config.database);
      let container = initializeContainer(dbManager, config);
      
      await container.initialize();

      const eventRepository1 = container.eventRepository;
      const arcRepository1 = container.arcRepository;

      // Create a chain of events: A -> B -> C -> D
      const eventA = await eventRepository1.create({
        description: 'Event A',
        actor: 'Actor A',
        target: 'Target A',
        timestamp: new Date('2023-04-02T10:00:00Z')
      });

      const eventB = await eventRepository1.create({
        description: 'Event B',
        actor: 'Actor B',
        target: 'Target B',
        timestamp: new Date('2023-04-02T11:00:00Z')
      });

      const eventC = await eventRepository1.create({
        description: 'Event C',
        actor: 'Actor C',
        target: 'Target C',
        timestamp: new Date('2023-04-02T12:00:00Z')
      });

      const eventD = await eventRepository1.create({
        description: 'Event D',
        actor: 'Actor D',
        target: 'Target D',
        timestamp: new Date('2023-04-02T13:00:00Z')
      });

      // Create relationships
      await arcRepository1.create({
        name: 'A causes B',
        start_time: eventA.timestamp,
        end_time: eventB.timestamp,
        level: 0,
        metadata: { weight: 0.9 }
      });

      await arcRepository1.create({
        name: 'B causes C',
        start_time: eventB.timestamp,
        end_time: eventC.timestamp,
        level: 0,
        metadata: { weight: 0.8 }
      });

      await arcRepository1.create({
        name: 'C causes D',
        start_time: eventC.timestamp,
        end_time: eventD.timestamp,
        level: 0,
        metadata: { weight: 0.7 }
      });

      // Also create a branch: A -> C (direct relationship)
      await arcRepository1.create({
        name: 'A influences C',
        start_time: eventA.timestamp,
        end_time: eventC.timestamp,
        level: 0,
        metadata: { weight: 0.6 }
      });

      // Causal links are relationships between events; they must persist too.
      const causalService1 = container.causalService;
      await causalService1.createCausalLink(eventA, eventB, {
        weight: 0.9, evidence: 'A causes B', confidence: 0.9, relationship_type: 'direct'
      });
      await causalService1.createCausalLink(eventB, eventC, {
        weight: 0.8, evidence: 'B causes C', confidence: 0.8, relationship_type: 'direct'
      });
      await causalService1.createCausalLink(eventC, eventD, {
        weight: 0.7, evidence: 'C causes D', confidence: 0.7, relationship_type: 'direct'
      });
      await causalService1.createCausalLink(eventA, eventC, {
        weight: 0.6, evidence: 'A influences C', confidence: 0.6, relationship_type: 'indirect'
      });

      await cleanupContainer();

      // Phase 2: Restart and verify relationship integrity
      config = loadConfig();
      dbManager = initializeDatabaseManager(config.database);
      container = initializeContainer(dbManager, config);
      
      await container.initialize();

      const eventRepository2 = container.eventRepository;
      const arcRepository2 = container.arcRepository;

      // Every event survived the restart.
      expect(await eventRepository2.findById(eventA.id)).not.toBeNull();
      expect(await eventRepository2.findById(eventD.id)).not.toBeNull();

      // Each arc still spans the events it was created for. Arcs contain a
      // time range, so the event instants are the probe points.
      const instantOf = (timestamp: Date) => ({ start: timestamp, end: timestamp });
      const namesContaining = async (timestamp: Date): Promise<string[]> => {
        const arcs = await arcRepository2.findContainingArcs(instantOf(timestamp));
        return arcs.map(arc => arc.name).sort();
      };

      // Containment is boundary inclusive on both ends (`start_time <= instant
      // AND end_time >= instant`), so an instant is also covered by the arc that
      // starts there and by the arc that ends there, not just by the arcs that
      // strictly span it.
      expect(await namesContaining(eventA.timestamp)).toEqual(['A causes B', 'A influences C']);
      expect(await namesContaining(eventB.timestamp)).toEqual(
        ['A causes B', 'A influences C', 'B causes C']
      );
      expect(await namesContaining(eventC.timestamp)).toEqual(
        ['A influences C', 'B causes C', 'C causes D']
      );
      expect(await namesContaining(eventD.timestamp)).toEqual(['C causes D']);

      expect(await arcRepository2.count()).toBe(4);

      // Test causal chain integrity
      const causalService = container.causalService;
      const relationships = await causalService.getAllRelationships();

      expect(relationships).toHaveLength(4);
      const aToB = relationships.find(rel => rel.cause_event_id === eventA.id && rel.effect_event_id === eventB.id);
      expect(aToB?.weight).toBe(0.9);
      expect(aToB?.confidence).toBe(0.9);

      await cleanupContainer();
    });
  });

  describe('Cache Data Persistence', () => {
    it('should persist and restore cache data across restarts', async () => {
      process.env.LOCAL_EXECUTION_ENABLED = 'true';
      process.env.LOCAL_DATA_DIR = testDataDir;
      process.env.LOCAL_GRAPH_FILE = graphFile;
      // Fastest persistence interval the configuration validator accepts.
      process.env.LOCAL_PERSISTENCE_INTERVAL = MIN_PERSISTENCE_INTERVAL;

      // Phase 1: Create instance and populate cache
      let config = loadConfig();
      let dbManager = initializeDatabaseManager(config.database);
      let container = initializeContainer(dbManager, config);
      
      await container.initialize();

      const cacheManager1 = asLocalCacheManager(dbManager);
      
      // Add test data to cache
      await cacheManager1.set('test:key1', { data: 'test value 1', timestamp: Date.now() });
      await cacheManager1.set('test:key2', { data: 'test value 2', timestamp: Date.now() });
      await cacheManager1.set('events:event1', { id: 'event1', cached: true });

      // Verify cache data exists
      const cachedValue1 = await cacheManager1.get('test:key1');
      expect(cachedValue1).toEqual({ data: 'test value 1', timestamp: expect.any(Number) });

      // Force cache persistence and shutdown. The cache lives in a process-wide
      // singleton that the service container does not own, so a restart is
      // simulated with the cache lifecycle functions: shutdownCache() flushes
      // it to cache.json and drops the singleton, initializeCache() rebuilds it
      // from that file.
      await shutdownCache();
      await cleanupContainer();

      // Verify cache file was created
      const cacheFilePath = path.join(testDataDir, cacheFile);
      const cacheFileExists = await fs.access(cacheFilePath).then(() => true).catch(() => false);
      expect(cacheFileExists).toBe(true);

      // Phase 2: Create new instance and verify cache is restored
      config = loadConfig();
      dbManager = initializeDatabaseManager(config.database);
      container = initializeContainer(dbManager, config);
      
      await container.initialize();
      await initializeCache();

      const cacheManager2 = asLocalCacheManager(dbManager);

      // Verify cached data was restored
      const restoredValue1 = await cacheManager2.get('test:key1');
      const restoredValue2 = await cacheManager2.get('test:key2');
      const restoredEvent = await cacheManager2.get('events:event1');

      expect(restoredValue1).toEqual({ data: 'test value 1', timestamp: expect.any(Number) });
      expect(restoredValue2).toEqual({ data: 'test value 2', timestamp: expect.any(Number) });
      expect(restoredEvent).toEqual({ id: 'event1', cached: true });

      await shutdownCache();
      await cleanupContainer();
    });

    it('should filter out expired cache entries on restore', async () => {
      process.env.LOCAL_EXECUTION_ENABLED = 'true';
      process.env.LOCAL_DATA_DIR = testDataDir;
      process.env.LOCAL_GRAPH_FILE = graphFile;

      // Phase 1: Create cache with short-lived entries
      let config = loadConfig();
      let dbManager = initializeDatabaseManager(config.database);
      let container = initializeContainer(dbManager, config);
      
      await container.initialize();

      const cacheManager1 = asLocalCacheManager(dbManager);
      
      // Add entries with different expiration times. `set` without an explicit
      // TTL falls back to CACHE_EXPIRATION_MS (5 minutes by default), which is
      // the longest-lived entry here.
      await cacheManager1.set('persistent:key', { data: 'persistent' }); // Default 5 minute TTL
      await cacheManager1.set('expires:key', { data: 'expires' }, 100); // 100ms expiration
      await cacheManager1.set('long:key', { data: 'long' }, 10000); // 10s expiration

      await shutdownCache();
      await cleanupContainer();

      // Wait for short expiration to pass
      await new Promise(resolve => setTimeout(resolve, 200));

      // Phase 2: Restore and verify expired entries are filtered
      config = loadConfig();
      dbManager = initializeDatabaseManager(config.database);
      container = initializeContainer(dbManager, config);
      
      await container.initialize();
      await initializeCache();

      const cacheManager2 = asLocalCacheManager(dbManager);

      // Verify only non-expired entries are restored
      const persistentValue = await cacheManager2.get('persistent:key');
      const expiredValue = await cacheManager2.get('expires:key');
      const longValue = await cacheManager2.get('long:key');

      expect(persistentValue).toEqual({ data: 'persistent' });
      expect(expiredValue).toBeNull(); // Should be filtered out
      expect(longValue).toEqual({ data: 'long' });

      await shutdownCache();
      await cleanupContainer();
    });
  });

  describe('Backup and Recovery', () => {
    it('should create and restore from backups when enabled', async () => {
      process.env.LOCAL_EXECUTION_ENABLED = 'true';
      process.env.LOCAL_DATA_DIR = testDataDir;
      process.env.LOCAL_GRAPH_FILE = graphFile;
      process.env.LOCAL_BACKUP_ENABLED = 'true';
      // The configuration validator rejects backup intervals below 60000ms, so
      // the automatic backup timer cannot fire within a test. Drive the backup
      // through the backup service instead of waiting on the scheduler.
      process.env.LOCAL_BACKUP_INTERVAL = MIN_BACKUP_INTERVAL;

      const config = loadConfig();
      const dbManager = initializeDatabaseManager(config.database);
      const container = initializeContainer(dbManager, config);
      
      await container.initialize();

      const eventRepository = container.eventRepository;

      // Create test data
      const event = await eventRepository.create({
        description: 'Backup Test Event',
        actor: 'Backup Actor',
        target: 'Backup Target',
        timestamp: new Date('2023-04-03T10:00:00Z')
      });

      // The data being backed up is live in the store
      expect(await eventRepository.findById(event.id)).not.toBeNull();

      // Shutting the container down persists the graph file the backup copies.
      await cleanupContainer();

      // A fresh store, as a second process would see it, takes the backup.
      const backupStore = new LocalGraphStore();
      await backupStore.load();

      const backupService = new BackupRecoveryService(backupStore);
      const backupMetadata = await backupService.createBackup('manual', 'persistence test backup');
      expect(backupMetadata.components.graph).toBe(true);

      // Check that backup files exist
      const backupFiles = await fs.readdir(backupDir);
      expect(backupFiles).toContain(`${backupMetadata.id}.backup`);
      expect((await backupService.listBackups()).map(backup => backup.id)).toContain(
        backupMetadata.id
      );

      // Lose the persisted graph and restore it from the backup.
      await fs.rm(path.join(testDataDir, graphFile), { force: true });
      await backupService.restoreFromBackup(backupMetadata.id);

      const restoredGraphData = JSON.parse(
        await fs.readFile(path.join(testDataDir, graphFile), 'utf8')
      );
      expect(Object.keys(restoredGraphData.nodes)).toContain(event.id);

      const restoredEvent = restoredGraphData.nodes[event.id];
      expect(restoredEvent.labels).toContain('Event');
      expect(restoredEvent.properties.description).toBe('Backup Test Event');

      backupService.stopAutomaticBackups();
      await backupStore.shutdown();
    });

    it('should handle graceful shutdown and emergency saves', async () => {
      process.env.LOCAL_EXECUTION_ENABLED = 'true';
      process.env.LOCAL_DATA_DIR = testDataDir;
      process.env.LOCAL_GRAPH_FILE = graphFile;

      const config = loadConfig();
      const dbManager = initializeDatabaseManager(config.database);
      const container = initializeContainer(dbManager, config);
      
      await container.initialize();

      const eventRepository = container.eventRepository;

      // Create test data
      const event = await eventRepository.create({
        description: 'Emergency Save Test',
        actor: 'Emergency Actor',
        target: 'Emergency Target',
        timestamp: new Date('2023-04-04T10:00:00Z')
      });

      // Simulate graceful shutdown
      await cleanupContainer();

      // Verify data was saved
      const graphFilePath = path.join(testDataDir, graphFile);
      const graphFileExists = await fs.access(graphFilePath).then(() => true).catch(() => false);
      expect(graphFileExists).toBe(true);

      const graphData = JSON.parse(await fs.readFile(graphFilePath, 'utf8'));
      expect(Object.keys(graphData.nodes)).toContain(event.id);
    });
  });

  describe('Data Integrity', () => {
    it('should maintain data consistency across multiple restart cycles', async () => {
      process.env.LOCAL_EXECUTION_ENABLED = 'true';
      process.env.LOCAL_DATA_DIR = testDataDir;
      process.env.LOCAL_GRAPH_FILE = graphFile;

      const eventIds: string[] = [];
      const arcIds: string[] = [];

      // Cycle through multiple restart cycles
      for (let cycle = 0; cycle < 3; cycle++) {
        const config = loadConfig();
        const dbManager = initializeDatabaseManager(config.database);
        const container = initializeContainer(dbManager, config);
        
        await container.initialize();

        const eventRepository = container.eventRepository;
        const arcRepository = container.arcRepository;

        // Verify previous data still exists
        for (const eventId of eventIds) {
          const event = await eventRepository.findById(eventId);
          expect(event).not.toBeNull();
        }

        for (const arcId of arcIds) {
          const arc = await arcRepository.findById(arcId);
          expect(arc).not.toBeNull();
        }

        // Add new data in this cycle
        const newEvent = await eventRepository.create({
          description: `Cycle ${cycle} Event`,
          actor: `Cycle ${cycle} Actor`,
          target: `Cycle ${cycle} Target`,
          timestamp: new Date(`2023-04-05T${10 + cycle}:00:00Z`)
        });
        eventIds.push(newEvent.id);

        if (eventIds.length > 1) {
          const previousEvent = await eventRepository.findById(eventIds[eventIds.length - 2]);
          if (!previousEvent) {
            throw new Error(`Event ${eventIds[eventIds.length - 2]} is missing before cycle ${cycle}`);
          }
          const newArc = await arcRepository.create({
            name: `Cycle ${cycle} Arc`,
            start_time: previousEvent.timestamp,
            end_time: newEvent.timestamp,
            level: 0,
            metadata: { weight: 0.5 + (cycle * 0.1) }
          });
          arcIds.push(newArc.id);
        }

        await cleanupContainer();
      }

      expect(eventIds).toHaveLength(3);
      expect(arcIds).toHaveLength(2);
    });

    it('should handle concurrent shutdown scenarios', async () => {
      process.env.LOCAL_EXECUTION_ENABLED = 'true';
      process.env.LOCAL_DATA_DIR = testDataDir;
      process.env.LOCAL_GRAPH_FILE = graphFile;

      const config = loadConfig();
      const dbManager = initializeDatabaseManager(config.database);
      const container = initializeContainer(dbManager, config);
      
      await container.initialize();

      const eventRepository = container.eventRepository;

      // Create test data
      const event = await eventRepository.create({
        description: 'Concurrent Shutdown Test',
        actor: 'Concurrent Actor',
        target: 'Concurrent Target',
        timestamp: new Date('2023-04-06T10:00:00Z')
      });

      // Multiple cleanup calls (simulating concurrent shutdown)
      const cleanupPromises = [
        cleanupContainer(),
        cleanupContainer(),
        cleanupContainer()
      ];

      // Should not throw errors
      await expect(Promise.all(cleanupPromises)).resolves.not.toThrow();

      // Data should still be properly saved
      const graphFilePath = path.join(testDataDir, graphFile);
      const graphFileExists = await fs.access(graphFilePath).then(() => true).catch(() => false);
      expect(graphFileExists).toBe(true);

      const graphData = JSON.parse(await fs.readFile(graphFilePath, 'utf8'));
      expect(Object.keys(graphData.nodes)).toContain(event.id);
    });
  });
});