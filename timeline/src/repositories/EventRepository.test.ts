import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { EventRepository, AdvancedEventRepository } from './EventRepository';
import { Event, CreateEventRequest, TimeRange } from '../models/Event';
import { DatabaseManager, initializeDatabaseManager, DatabaseConfig } from '../utils/database';
import { initializeSchema } from '../utils/schema';

// Test configuration
const testConfig: DatabaseConfig = {
  neo4j: {
    uri: process.env.NEO4J_TEST_URI || 'bolt://localhost:7687',
    username: process.env.NEO4J_TEST_USERNAME || 'neo4j',
    password: process.env.NEO4J_TEST_PASSWORD || 'password',
    database: process.env.NEO4J_TEST_DATABASE || 'test'
  },
  redis: {
    host: process.env.REDIS_TEST_HOST || 'localhost',
    port: parseInt(process.env.REDIS_TEST_PORT || '6379', 10),
    password: process.env.REDIS_TEST_PASSWORD
  }
};

describe('EventRepository Integration Tests', () => {
  let databaseManager: DatabaseManager;
  let eventRepository: EventRepository;

  beforeAll(async () => {
    databaseManager = initializeDatabaseManager(testConfig);
    await databaseManager.initializeNeo4j();
    await initializeSchema();
  });

  beforeEach(async () => {
    eventRepository = new EventRepository();
    
    // Clean up existing test data
    const session = databaseManager.getNeo4jSession();
    await session.run('MATCH (e:Event) WHERE e.id STARTS WITH "test_" DELETE e');
    await session.close();
  });

  afterAll(async () => {
    if (eventRepository) {
      await eventRepository.close();
    }
    await databaseManager.close();
  });

  describe('CRUD Operations', () => {
    it('should create a new event', async () => {
      const eventData: CreateEventRequest = {
        description: 'Test event creation',
        actor: 'Test Actor',
        target: 'Test Target',
        timestamp: new Date('2023-01-01T10:00:00Z')
      };

      const event = await eventRepository.create(eventData);
      
      expect(event).toBeDefined();
      expect(event.id).toBeDefined();
      expect(event.description).toBe(eventData.description);
      expect(event.actor).toBe(eventData.actor);
      expect(event.target).toBe(eventData.target);
      expect(event.timestamp).toEqual(eventData.timestamp);
    });

    it('should find event by ID', async () => {
      // Create test event
      const eventData: CreateEventRequest = {
        description: 'Test find by ID',
        actor: 'Test Actor',
        target: 'Test Target',
        timestamp: new Date('2023-01-01T10:00:00Z')
      };

      const createdEvent = await eventRepository.create(eventData);
      
      // Find the event
      const foundEvent = await eventRepository.findById(createdEvent.id);
      
      expect(foundEvent).toBeDefined();
      expect(foundEvent!.id).toBe(createdEvent.id);
      expect(foundEvent!.description).toBe(eventData.description);
    });

    it('should return null for non-existent event', async () => {
      const foundEvent = await eventRepository.findById('non-existent-id');
      expect(foundEvent).toBeNull();
    });

    it('should update an existing event', async () => {
      // Create test event
      const eventData: CreateEventRequest = {
        description: 'Original description',
        actor: 'Original Actor',
        target: 'Original Target',
        timestamp: new Date('2023-01-01T10:00:00Z')
      };

      const createdEvent = await eventRepository.create(eventData);
      
      // Update the event
      const updates = {
        description: 'Updated description',
        actor: 'Updated Actor'
      };

      const updatedEvent = await eventRepository.update(createdEvent.id, updates);
      
      expect(updatedEvent).toBeDefined();
      expect(updatedEvent!.description).toBe(updates.description);
      expect(updatedEvent!.actor).toBe(updates.actor);
      expect(updatedEvent!.target).toBe(eventData.target); // Unchanged
    });

    it('should delete an event', async () => {
      // Create test event
      const eventData: CreateEventRequest = {
        description: 'Test delete',
        actor: 'Test Actor',
        target: 'Test Target',
        timestamp: new Date('2023-01-01T10:00:00Z')
      };

      const createdEvent = await eventRepository.create(eventData);
      
      // Delete the event
      const deleted = await eventRepository.delete(createdEvent.id);
      expect(deleted).toBe(true);
      
      // Verify it's gone
      const foundEvent = await eventRepository.findById(createdEvent.id);
      expect(foundEvent).toBeNull();
    });
  });

  describe('Query Operations', () => {
    beforeEach(async () => {
      // Create test events
      const testEvents: CreateEventRequest[] = [
        {
          description: 'Event 1',
          actor: 'Actor A',
          target: 'Target X',
          timestamp: new Date('2023-01-01T10:00:00Z')
        },
        {
          description: 'Event 2',
          actor: 'Actor B',
          target: 'Target Y',
          timestamp: new Date('2023-01-02T10:00:00Z')
        },
        {
          description: 'Event 3',
          actor: 'Actor A',
          target: 'Target Z',
          timestamp: new Date('2023-01-03T10:00:00Z')
        }
      ];

      for (const eventData of testEvents) {
        await eventRepository.create(eventData);
      }
    });

    it('should find all events', async () => {
      const events = await eventRepository.findAll();
      expect(events.length).toBeGreaterThanOrEqual(3);
    });

    it('should find events by actor', async () => {
      const events = await eventRepository.findByActor('Actor A');
      expect(events.length).toBe(2);
      expect(events.every(e => e.actor === 'Actor A')).toBe(true);
    });

    it('should find events by target', async () => {
      const events = await eventRepository.findByTarget('Target X');
      expect(events.length).toBe(1);
      expect(events[0].target).toBe('Target X');
    });

    it('should find events by time range', async () => {
      const timeRange: TimeRange = {
        start: new Date('2023-01-01T00:00:00Z'),
        end: new Date('2023-01-02T23:59:59Z')
      };

      const events = await eventRepository.findByTimeRange(timeRange);
      expect(events.length).toBe(2);
      expect(events.every(e => e.timestamp >= timeRange.start && e.timestamp <= timeRange.end)).toBe(true);
    });

    it('should find events by actor and time range', async () => {
      const timeRange: TimeRange = {
        start: new Date('2023-01-01T00:00:00Z'),
        end: new Date('2023-01-03T23:59:59Z')
      };

      const events = await eventRepository.findByActorAndTimeRange('Actor A', timeRange);
      expect(events.length).toBe(2);
      expect(events.every(e => e.actor === 'Actor A')).toBe(true);
    });

    it('should support pagination', async () => {
      const page1 = await eventRepository.findAll(2, 0);
      const page2 = await eventRepository.findAll(2, 2);
      
      expect(page1.length).toBeLessThanOrEqual(2);
      expect(page2.length).toBeLessThanOrEqual(2);
      
      // Ensure no overlap
      const page1Ids = page1.map(e => e.id);
      const page2Ids = page2.map(e => e.id);
      const overlap = page1Ids.filter(id => page2Ids.includes(id));
      expect(overlap.length).toBe(0);
    });
  });

  describe('Count Operations', () => {
    beforeEach(async () => {
      // Create test events
      const testEvents: CreateEventRequest[] = [
        {
          description: 'Count Event 1',
          actor: 'Count Actor A',
          target: 'Count Target X',
          timestamp: new Date('2023-01-01T10:00:00Z')
        },
        {
          description: 'Count Event 2',
          actor: 'Count Actor A',
          target: 'Count Target Y',
          timestamp: new Date('2023-01-02T10:00:00Z')
        }
      ];

      for (const eventData of testEvents) {
        await eventRepository.create(eventData);
      }
    });

    it('should count total events', async () => {
      const count = await eventRepository.count();
      expect(count).toBeGreaterThanOrEqual(2);
    });

    it('should count events by actor', async () => {
      const count = await eventRepository.countByActor('Count Actor A');
      expect(count).toBe(2);
    });

    it('should count events by time range', async () => {
      const timeRange: TimeRange = {
        start: new Date('2023-01-01T00:00:00Z'),
        end: new Date('2023-01-01T23:59:59Z')
      };

      const count = await eventRepository.countByTimeRange(timeRange);
      expect(count).toBe(1);
    });

    it('should check if event exists', async () => {
      const eventData: CreateEventRequest = {
        description: 'Exists test',
        actor: 'Exists Actor',
        target: 'Exists Target',
        timestamp: new Date('2023-01-01T10:00:00Z')
      };

      const event = await eventRepository.create(eventData);
      
      const exists = await eventRepository.exists(event.id);
      expect(exists).toBe(true);
      
      const notExists = await eventRepository.exists('non-existent-id');
      expect(notExists).toBe(false);
    });
  });
});

describe('AdvancedEventRepository Integration Tests', () => {
  let databaseManager: DatabaseManager;
  let advancedRepository: AdvancedEventRepository;

  beforeAll(async () => {
    databaseManager = initializeDatabaseManager(testConfig);
    await databaseManager.initializeNeo4j();
  });

  beforeEach(async () => {
    advancedRepository = new AdvancedEventRepository();
    
    // Clean up and create test data
    const session = databaseManager.getNeo4jSession();
    await session.run('MATCH (e:Event) WHERE e.id STARTS WITH "advanced_" DELETE e');
    await session.close();

    // Create test events for advanced search
    const testEvents: CreateEventRequest[] = [
      {
        description: 'Advanced search event about politics',
        actor: 'Politician A',
        target: 'City Council',
        timestamp: new Date('2023-01-01T10:00:00Z')
      },
      {
        description: 'Advanced search event about economics',
        actor: 'Economist B',
        target: 'Stock Market',
        timestamp: new Date('2023-01-02T10:00:00Z')
      },
      {
        description: 'Another political event',
        actor: 'Politician A',
        target: 'Parliament',
        timestamp: new Date('2023-01-03T10:00:00Z')
      }
    ];

    for (const eventData of testEvents) {
      const event = new Event({ ...eventData, id: `advanced_${Date.now()}_${Math.random()}` });
      await advancedRepository.create(eventData);
    }
  });

  afterAll(async () => {
    if (advancedRepository) {
      await advancedRepository.close();
    }
    await databaseManager.close();
  });

  describe('Advanced Search', () => {
    it('should search by multiple filters', async () => {
      const events = await advancedRepository.search({
        actor: 'Politician A',
        description: 'political'
      });

      expect(events.length).toBe(1);
      expect(events[0].actor).toBe('Politician A');
      expect(events[0].description.toLowerCase()).toContain('political');
    });

    it('should search with time range filter', async () => {
      const timeRange: TimeRange = {
        start: new Date('2023-01-01T00:00:00Z'),
        end: new Date('2023-01-02T23:59:59Z')
      };

      const events = await advancedRepository.search({
        timeRange
      });

      expect(events.length).toBe(2);
      expect(events.every(e => e.timestamp >= timeRange.start && e.timestamp <= timeRange.end)).toBe(true);
    });

    it('should support custom ordering', async () => {
      const events = await advancedRepository.search({}, {
        orderBy: 'timestamp',
        orderDirection: 'DESC'
      });

      expect(events.length).toBeGreaterThan(0);
      
      // Check descending order
      for (let i = 1; i < events.length; i++) {
        expect(events[i].timestamp.getTime()).toBeLessThanOrEqual(events[i-1].timestamp.getTime());
      }
    });

    it('should support pagination in search', async () => {
      const page1 = await advancedRepository.search({}, { limit: 2, offset: 0 });
      const page2 = await advancedRepository.search({}, { limit: 2, offset: 2 });

      expect(page1.length).toBeLessThanOrEqual(2);
      expect(page2.length).toBeLessThanOrEqual(2);
    });
  });
});