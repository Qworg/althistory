import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Container, initializeContainer, cleanupContainer } from '@/container';
import { loadConfig, initializeDatabaseManager } from '@/utils';
import { Event, CreateEventRequest } from '@/models/Event';
import { Arc, CreateArcRequest } from '@/models/Arc';
import { EventRepository } from '@/repositories/EventRepository';
import { ArcRepository } from '@/repositories/ArcRepository';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('Local Persistence Integration Tests', () => {
  const testDataDir = './test-persistence-data';
  const graphFile = 'persistence-test-graph.json';
  const cacheFile = 'cache.json';

  beforeAll(async () => {
    // Ensure test directory exists
    try {
      await fs.mkdir(testDataDir, { recursive: true });
    } catch (error) {
      // Directory might already exist
    }
  });

  afterAll(async () => {
    // Clean up test directory
    try {
      await fs.rmdir(testDataDir, { recursive: true });
    } catch (error) {
      console.warn('Could not clean up test directory:', error);
    }
  });

  beforeEach(async () => {
    // Clean up any existing test files
    try {
      await fs.unlink(path.join(testDataDir, graphFile));
    } catch (error) {
      // File might not exist
    }
    try {
      await fs.unlink(path.join(testDataDir, cacheFile));
    } catch (error) {
      // File might not exist
    }
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
        startEventId: event1.id,
        endEventId: event2.id,
        name: 'Persistent Arc 1',
        weight: 0.85,
        confidence: 0.92,
        metadata: { persistenceTest: true, phase: 1 }
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
      expect(foundArc1_2?.weight).toBe(0.85);
      expect(foundArc1_2?.confidence).toBe(0.92);

      // Phase 3: Add more data and verify it coexists with restored data
      const event3 = await eventRepository2.create({
        description: 'Persistent Event 3',
        actor: 'Persistent Actor 3',
        target: 'Persistent Target 3',
        timestamp: new Date('2023-04-01T12:00:00Z'),
        metadata: { persistenceTest: true, phase: 2 }
      });

      const arc2 = await arcRepository2.create({
        startEventId: event2.id,
        endEventId: event3.id,
        name: 'Persistent Arc 2',
        weight: 0.75
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
      const arcAB = await arcRepository1.create({
        startEventId: eventA.id,
        endEventId: eventB.id,
        name: 'A causes B',
        weight: 0.9
      });

      const arcBC = await arcRepository1.create({
        startEventId: eventB.id,
        endEventId: eventC.id,
        name: 'B causes C',
        weight: 0.8
      });

      const arcCD = await arcRepository1.create({
        startEventId: eventC.id,
        endEventId: eventD.id,
        name: 'C causes D',
        weight: 0.7
      });

      // Also create a branch: A -> C (direct relationship)
      const arcAC = await arcRepository1.create({
        startEventId: eventA.id,
        endEventId: eventC.id,
        name: 'A influences C',
        weight: 0.6
      });

      await cleanupContainer();

      // Phase 2: Restart and verify relationship integrity
      config = loadConfig();
      dbManager = initializeDatabaseManager(config.database);
      container = initializeContainer(dbManager, config);
      
      await container.initialize();

      const eventRepository2 = container.eventRepository;
      const arcRepository2 = container.arcRepository;

      // Verify all relationships are intact
      const arcsFromA = await arcRepository2.findByEventId(eventA.id);
      const arcsToC = await arcRepository2.findByEventId(eventC.id);
      const arcsFromB = await arcRepository2.findByEventId(eventB.id);

      expect(arcsFromA).toHaveLength(2); // A -> B and A -> C
      expect(arcsToC).toHaveLength(2);   // B -> C and A -> C
      expect(arcsFromB).toHaveLength(1); // B -> C

      // Test causal chain integrity
      const causalService = container.causalService;
      const causalChain = await causalService.getCausalChain(eventA.id);
      
      expect(causalChain.events).toHaveLength(4);
      expect(causalChain.arcs).toHaveLength(4);

      await cleanupContainer();
    });
  });

  describe('Cache Data Persistence', () => {
    it('should persist and restore cache data across restarts', async () => {
      process.env.LOCAL_EXECUTION_ENABLED = 'true';
      process.env.LOCAL_DATA_DIR = testDataDir;
      process.env.LOCAL_GRAPH_FILE = graphFile;
      process.env.LOCAL_PERSISTENCE_INTERVAL = '100'; // Fast persistence for testing

      // Phase 1: Create instance and populate cache
      let config = loadConfig();
      let dbManager = initializeDatabaseManager(config.database);
      let container = initializeContainer(dbManager, config);
      
      await container.initialize();

      const cacheManager1 = dbManager.getRedisClient();
      
      // Add test data to cache
      await cacheManager1.set('test:key1', { data: 'test value 1', timestamp: Date.now() });
      await cacheManager1.set('test:key2', { data: 'test value 2', timestamp: Date.now() });
      await cacheManager1.set('events:event1', { id: 'event1', cached: true });

      // Verify cache data exists
      const cachedValue1 = await cacheManager1.get('test:key1');
      expect(cachedValue1).toEqual({ data: 'test value 1', timestamp: expect.any(Number) });

      // Force cache persistence and shutdown
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

      const cacheManager2 = dbManager.getRedisClient();

      // Wait a moment for cache to load
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify cached data was restored
      const restoredValue1 = await cacheManager2.get('test:key1');
      const restoredValue2 = await cacheManager2.get('test:key2');
      const restoredEvent = await cacheManager2.get('events:event1');

      expect(restoredValue1).toEqual({ data: 'test value 1', timestamp: expect.any(Number) });
      expect(restoredValue2).toEqual({ data: 'test value 2', timestamp: expect.any(Number) });
      expect(restoredEvent).toEqual({ id: 'event1', cached: true });

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

      const cacheManager1 = dbManager.getRedisClient();
      
      // Add entries with different expiration times
      await cacheManager1.set('persistent:key', { data: 'persistent' }); // No expiration
      await cacheManager1.set('expires:key', { data: 'expires' }, 100); // 100ms expiration
      await cacheManager1.set('long:key', { data: 'long' }, 10000); // 10s expiration

      await cleanupContainer();

      // Wait for short expiration to pass
      await new Promise(resolve => setTimeout(resolve, 200));

      // Phase 2: Restore and verify expired entries are filtered
      config = loadConfig();
      dbManager = initializeDatabaseManager(config.database);
      container = initializeContainer(dbManager, config);
      
      await container.initialize();

      const cacheManager2 = dbManager.getRedisClient();

      // Wait for cache to load
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify only non-expired entries are restored
      const persistentValue = await cacheManager2.get('persistent:key');
      const expiredValue = await cacheManager2.get('expires:key');
      const longValue = await cacheManager2.get('long:key');

      expect(persistentValue).toEqual({ data: 'persistent' });
      expect(expiredValue).toBeNull(); // Should be filtered out
      expect(longValue).toEqual({ data: 'long' });

      await cleanupContainer();
    });
  });

  describe('Backup and Recovery', () => {
    it('should create and restore from backups when enabled', async () => {
      process.env.LOCAL_EXECUTION_ENABLED = 'true';
      process.env.LOCAL_DATA_DIR = testDataDir;
      process.env.LOCAL_GRAPH_FILE = graphFile;
      process.env.LOCAL_BACKUP_ENABLED = 'true';
      process.env.LOCAL_BACKUP_INTERVAL = '1000'; // 1 second for testing

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

      // Wait for backup to be created
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Check if backup directory was created
      const backupDir = path.join(testDataDir, 'backups');
      const backupDirExists = await fs.access(backupDir).then(() => true).catch(() => false);
      
      if (process.env.LOCAL_BACKUP_ENABLED === 'true') {
        expect(backupDirExists).toBe(true);

        // Check if backup files exist
        const backupFiles = await fs.readdir(backupDir);
        expect(backupFiles.length).toBeGreaterThan(0);
      }

      await cleanupContainer();
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
          const newArc = await arcRepository.create({
            startEventId: eventIds[eventIds.length - 2],
            endEventId: eventIds[eventIds.length - 1],
            name: `Cycle ${cycle} Arc`,
            weight: 0.5 + (cycle * 0.1)
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
    });
  });
});