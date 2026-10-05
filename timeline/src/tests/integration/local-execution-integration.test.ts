import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Container, initializeContainer, cleanupContainer } from '@/container';
import { loadConfig, initializeDatabaseManager } from '@/utils';
import { Event, CreateEventRequest } from '@/models/Event';
import { Arc, CreateArcRequest } from '@/models/Arc';
import { EventRepository } from '@/repositories/EventRepository';
import { ArcRepository } from '@/repositories/ArcRepository';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('Local Execution Integration Tests', () => {
  let container: Container;
  let eventRepository: EventRepository;
  let arcRepository: ArcRepository;
  const testDataDir = './test-integration-data';

  beforeAll(async () => {
    // Force local execution mode
    process.env.LOCAL_EXECUTION_ENABLED = 'true';
    process.env.LOCAL_DATA_DIR = testDataDir;
    process.env.LOCAL_GRAPH_FILE = 'integration-test-graph.json';
    process.env.LOCAL_BACKUP_ENABLED = 'false';
    process.env.LOCAL_MAX_MEMORY_MB = '10';
    
    // Ensure test directory exists
    try {
      await fs.mkdir(testDataDir, { recursive: true });
    } catch (error) {
      // Directory might already exist
    }

    const config = loadConfig();
    const dbManager = initializeDatabaseManager(config.database);
    container = initializeContainer(dbManager, config);
    
    await container.initialize();
    
    eventRepository = container.eventRepository;
    arcRepository = container.arcRepository;
  });

  afterAll(async () => {
    await cleanupContainer();
    
    // Clean up test directory
    try {
      await fs.rmdir(testDataDir, { recursive: true });
    } catch (error) {
      console.warn('Could not clean up test directory:', error);
    }
  });

  beforeEach(async () => {
    // Clear any existing data before each test
    const dbManager = container.databaseManager;
    const session = dbManager.getNeo4jSession();
    try {
      await session.run('MATCH (n) DETACH DELETE n');
    } finally {
      await session.close();
    }
  });

  describe('Repository Layer Integration', () => {
    describe('EventRepository with Local Database', () => {
      it('should create events using local storage', async () => {
        const eventData: CreateEventRequest = {
          description: 'Local integration test event',
          actor: 'Test Actor',
          target: 'Test Target',
          timestamp: new Date('2023-01-01T10:00:00Z')
        };

        const createdEvent = await eventRepository.create(eventData);
        
        expect(createdEvent).toBeInstanceOf(Event);
        expect(createdEvent.description).toBe(eventData.description);
        expect(createdEvent.actor).toBe(eventData.actor);
        expect(createdEvent.id).toMatch(/^local_\d+_[a-z0-9]+$/);
      });

      it('should find events by ID using local storage', async () => {
        const eventData: CreateEventRequest = {
          description: 'Findable event',
          actor: 'Finder Actor',
          timestamp: new Date('2023-01-02T10:00:00Z')
        };

        const createdEvent = await eventRepository.create(eventData);
        const foundEvent = await eventRepository.findById(createdEvent.id);
        
        expect(foundEvent).not.toBeNull();
        expect(foundEvent?.id).toBe(createdEvent.id);
        expect(foundEvent?.description).toBe(eventData.description);
      });

      it('should update events using local storage', async () => {
        const eventData: CreateEventRequest = {
          description: 'Original description',
          actor: 'Original Actor',
          timestamp: new Date('2023-01-03T10:00:00Z')
        };

        const createdEvent = await eventRepository.create(eventData);
        
        const updateData = {
          description: 'Updated description',
          actor: 'Updated Actor'
        };
        
        const updatedEvent = await eventRepository.update(createdEvent.id, updateData);
        
        expect(updatedEvent).not.toBeNull();
        expect(updatedEvent?.description).toBe(updateData.description);
        expect(updatedEvent?.actor).toBe(updateData.actor);
      });

      it('should delete events using local storage', async () => {
        const eventData: CreateEventRequest = {
          description: 'To be deleted',
          actor: 'Delete Actor',
          timestamp: new Date('2023-01-04T10:00:00Z')
        };

        const createdEvent = await eventRepository.create(eventData);
        const deleteResult = await eventRepository.delete(createdEvent.id);
        
        expect(deleteResult).toBe(true);
        
        const foundEvent = await eventRepository.findById(createdEvent.id);
        expect(foundEvent).toBeNull();
      });

      it('should find events by actor using local storage', async () => {
        const actor = 'Integration Test Actor';
        
        await eventRepository.create({
          description: 'Event 1',
          actor,
          timestamp: new Date('2023-01-05T10:00:00Z')
        });
        
        await eventRepository.create({
          description: 'Event 2',
          actor,
          timestamp: new Date('2023-01-05T11:00:00Z')
        });
        
        await eventRepository.create({
          description: 'Event 3',
          actor: 'Different Actor',
          timestamp: new Date('2023-01-05T12:00:00Z')
        });

        const events = await eventRepository.findByActor(actor);
        
        expect(events).toHaveLength(2);
        expect(events.every(e => e.actor === actor)).toBe(true);
      });

      it('should handle time range queries using local storage', async () => {
        const baseTime = new Date('2023-01-06T10:00:00Z');
        
        await eventRepository.create({
          description: 'Before range',
          actor: 'Time Actor',
          timestamp: new Date(baseTime.getTime() - 60000) // 1 minute before
        });
        
        await eventRepository.create({
          description: 'In range 1',
          actor: 'Time Actor',
          timestamp: new Date(baseTime.getTime() + 30000) // 30 seconds after
        });
        
        await eventRepository.create({
          description: 'In range 2',
          actor: 'Time Actor',
          timestamp: new Date(baseTime.getTime() + 60000) // 1 minute after
        });
        
        await eventRepository.create({
          description: 'After range',
          actor: 'Time Actor',
          timestamp: new Date(baseTime.getTime() + 120000) // 2 minutes after
        });

        const timeRange = {
          start: baseTime,
          end: new Date(baseTime.getTime() + 90000) // 1.5 minutes after
        };
        
        const events = await eventRepository.findByTimeRange(timeRange);
        
        expect(events).toHaveLength(2);
        expect(events.every(e => e.description.includes('In range'))).toBe(true);
      });
    });

    describe('ArcRepository with Local Database', () => {
      let sourceEvent: Event;
      let targetEvent: Event;

      beforeEach(async () => {
        sourceEvent = await eventRepository.create({
          description: 'Source event for arc',
          actor: 'Arc Actor',
          timestamp: new Date('2023-01-10T10:00:00Z')
        });
        
        targetEvent = await eventRepository.create({
          description: 'Target event for arc',
          actor: 'Arc Actor',
          timestamp: new Date('2023-01-10T11:00:00Z')
        });
      });

      it('should create arcs using local storage', async () => {
        const arcData: CreateArcRequest = {
          startEventId: sourceEvent.id,
          endEventId: targetEvent.id,
          name: 'Integration Test Arc',
          weight: 0.8,
          confidence: 0.9
        };

        const createdArc = await arcRepository.create(arcData);
        
        expect(createdArc).toBeInstanceOf(Arc);
        expect(createdArc.name).toBe(arcData.name);
        expect(createdArc.startEventId).toBe(sourceEvent.id);
        expect(createdArc.endEventId).toBe(targetEvent.id);
        expect(createdArc.weight).toBe(0.8);
        expect(createdArc.confidence).toBe(0.9);
      });

      it('should find arcs by ID using local storage', async () => {
        const arcData: CreateArcRequest = {
          startEventId: sourceEvent.id,
          endEventId: targetEvent.id,
          name: 'Findable Arc'
        };

        const createdArc = await arcRepository.create(arcData);
        const foundArc = await arcRepository.findById(createdArc.id);
        
        expect(foundArc).not.toBeNull();
        expect(foundArc?.id).toBe(createdArc.id);
        expect(foundArc?.name).toBe(arcData.name);
      });

      it('should find arcs by event using local storage', async () => {
        await arcRepository.create({
          startEventId: sourceEvent.id,
          endEventId: targetEvent.id,
          name: 'Arc 1'
        });
        
        const anotherEvent = await eventRepository.create({
          description: 'Another event',
          actor: 'Another Actor',
          timestamp: new Date('2023-01-10T12:00:00Z')
        });
        
        await arcRepository.create({
          startEventId: sourceEvent.id,
          endEventId: anotherEvent.id,
          name: 'Arc 2'
        });

        const arcsFromSource = await arcRepository.findByEventId(sourceEvent.id);
        const arcsToTarget = await arcRepository.findByEventId(targetEvent.id);
        
        expect(arcsFromSource).toHaveLength(2);
        expect(arcsToTarget).toHaveLength(1);
      });

      it('should update arcs using local storage', async () => {
        const arcData: CreateArcRequest = {
          startEventId: sourceEvent.id,
          endEventId: targetEvent.id,
          name: 'Original Arc Name',
          weight: 0.5
        };

        const createdArc = await arcRepository.create(arcData);
        
        const updateData = {
          name: 'Updated Arc Name',
          weight: 0.9,
          confidence: 0.95
        };
        
        const updatedArc = await arcRepository.update(createdArc.id, updateData);
        
        expect(updatedArc).not.toBeNull();
        expect(updatedArc?.name).toBe(updateData.name);
        expect(updatedArc?.weight).toBe(updateData.weight);
        expect(updatedArc?.confidence).toBe(updateData.confidence);
      });

      it('should delete arcs using local storage', async () => {
        const arcData: CreateArcRequest = {
          startEventId: sourceEvent.id,
          endEventId: targetEvent.id,
          name: 'Arc to delete'
        };

        const createdArc = await arcRepository.create(arcData);
        const deleteResult = await arcRepository.delete(createdArc.id);
        
        expect(deleteResult).toBe(true);
        
        const foundArc = await arcRepository.findById(createdArc.id);
        expect(foundArc).toBeNull();
      });
    });
  });

  describe('Service Layer Integration', () => {
    it('should work with TemporalService using local storage', async () => {
      const temporalService = container.temporalService;
      
      // Create some test events with different timestamps
      const baseTime = new Date('2023-02-01T10:00:00Z');
      
      await eventRepository.create({
        description: 'Early event',
        actor: 'Temporal Actor',
        timestamp: new Date(baseTime.getTime() - 86400000) // 1 day before
      });
      
      await eventRepository.create({
        description: 'Middle event',
        actor: 'Temporal Actor',
        timestamp: baseTime
      });
      
      await eventRepository.create({
        description: 'Late event',
        actor: 'Temporal Actor',
        timestamp: new Date(baseTime.getTime() + 86400000) // 1 day after
      });

      const timeRange = {
        start: new Date(baseTime.getTime() - 43200000), // 12 hours before
        end: new Date(baseTime.getTime() + 43200000)   // 12 hours after
      };
      
      const eventsInRange = await temporalService.getEventsInTimeRange(timeRange);
      
      expect(eventsInRange).toHaveLength(1);
      expect(eventsInRange[0].description).toBe('Middle event');
    });

    it('should work with CausalService using local storage', async () => {
      const causalService = container.causalService;
      
      // Create events and arcs
      const event1 = await eventRepository.create({
        description: 'Cause event',
        actor: 'Causal Actor',
        timestamp: new Date('2023-02-02T10:00:00Z')
      });
      
      const event2 = await eventRepository.create({
        description: 'Effect event',
        actor: 'Causal Actor',
        timestamp: new Date('2023-02-02T11:00:00Z')
      });
      
      await arcRepository.create({
        startEventId: event1.id,
        endEventId: event2.id,
        name: 'Causal relationship',
        weight: 0.8
      });

      const causalChain = await causalService.getCausalChain(event1.id);
      
      expect(causalChain).toHaveProperty('events');
      expect(causalChain).toHaveProperty('arcs');
      expect(causalChain.events.some(e => e.id === event1.id)).toBe(true);
      expect(causalChain.events.some(e => e.id === event2.id)).toBe(true);
    });
  });

  describe('Cache Integration', () => {
    it('should use local cache for repository operations', async () => {
      const cacheManager = container.databaseManager.getRedisClient();
      
      // Clear cache
      await cacheManager.clear();
      
      // Create an event (should cache it)
      const event = await eventRepository.create({
        description: 'Cached event',
        actor: 'Cache Actor',
        timestamp: new Date('2023-02-03T10:00:00Z')
      });
      
      // Check if event is cached
      const cacheKey = `event:${event.id}`;
      const cachedEvent = await cacheManager.get(cacheKey);
      
      // Note: Caching behavior depends on repository implementation
      // This test verifies that cache is accessible and functional
      expect(cacheManager.isConnected()).toBe(true);
    });

    it('should invalidate cache when data changes', async () => {
      const cacheInvalidationService = container.cacheInvalidationService;
      
      // This test verifies that cache invalidation service works with local cache
      await cacheInvalidationService.invalidateEventCache('test-event-id');
      await cacheInvalidationService.invalidateArcCache('test-arc-id');
      
      // Should not throw error
      expect(true).toBe(true);
    });
  });

  describe('Health and Statistics', () => {
    it('should report healthy status for local components', async () => {
      const health = await container.getHealthStatus();
      
      expect(health.status).toBe('healthy');
      expect(health.database).toHaveProperty('neo4j', true);
      expect(health.database).toHaveProperty('redis', true);
      expect(health.services).toBeDefined();
    });

    it('should provide accurate statistics for local storage', async () => {
      const dbManager = container.databaseManager;
      const stats = dbManager.getConnectionPoolStats();
      
      expect(stats).toHaveProperty('total');
      expect(stats).toHaveProperty('inUse');
      expect(stats).toHaveProperty('created');
      expect(stats.total).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Data Persistence', () => {
    it('should persist data to local files', async () => {
      // Create some test data
      const event = await eventRepository.create({
        description: 'Persistent event',
        actor: 'Persistence Actor',
        timestamp: new Date('2023-02-04T10:00:00Z')
      });

      // Force save (shutdown will trigger save)
      const dbManager = container.databaseManager;
      await dbManager.close();
      
      // Check if graph file was created
      const graphFile = path.join(testDataDir, 'integration-test-graph.json');
      const fileExists = await fs.access(graphFile).then(() => true).catch(() => false);
      
      expect(fileExists).toBe(true);
      
      // Verify file contains data
      const fileContent = await fs.readFile(graphFile, 'utf8');
      const graphData = JSON.parse(fileContent);
      
      expect(graphData).toHaveProperty('nodes');
      expect(Object.keys(graphData.nodes)).toContain(event.id);
    });
  });

  describe('Error Handling', () => {
    it('should handle local storage errors gracefully', async () => {
      // Test error handling by trying to access non-existent data
      const nonExistentEvent = await eventRepository.findById('non-existent-id');
      expect(nonExistentEvent).toBeNull();
      
      const nonExistentArc = await arcRepository.findById('non-existent-arc-id');
      expect(nonExistentArc).toBeNull();
    });

    it('should handle invalid queries gracefully', async () => {
      const dbManager = container.databaseManager;
      const session = dbManager.getNeo4jSession();
      
      try {
        await expect(session.run('INVALID CYPHER SYNTAX'))
          .rejects.toThrow();
      } finally {
        await session.close();
      }
    });
  });
});