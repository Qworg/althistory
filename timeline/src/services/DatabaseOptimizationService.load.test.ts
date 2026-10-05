import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DatabaseOptimizationService } from './DatabaseOptimizationService';
import { EventRepository } from '@/repositories/EventRepository';
import { ArcRepository } from '@/repositories/ArcRepository';
import { Event } from '@/models/Event';
import { Arc } from '@/models/Arc';
import { getDatabaseManager } from '@/utils/database';
import { performance } from 'perf_hooks';

describe('Database Optimization Load Tests', () => {
  let optimizationService: DatabaseOptimizationService;
  let eventRepository: EventRepository;
  let arcRepository: ArcRepository;
  const testEvents: Event[] = [];
  const testArcs: Arc[] = [];

  beforeAll(async () => {
    // Initialize services
    optimizationService = new DatabaseOptimizationService();
    eventRepository = new EventRepository(getDatabaseManager());
    arcRepository = new ArcRepository(getDatabaseManager());

    // Create optimized indexes before load testing
    await optimizationService.createOptimizedIndexes();
    
    console.log('Starting load test data generation...');
    await generateLargeDataset();
    console.log(`Generated ${testEvents.length} events and ${testArcs.length} arcs`);
  });

  afterAll(async () => {
    // Clean up test data
    await cleanupTestData();
    await getDatabaseManager().close();
  });

  beforeEach(() => {
    optimizationService.clearPerformanceMetrics();
  });

  describe('Large Dataset Performance', () => {
    it('should handle 100,000+ events with sub-2-second query response times', async () => {
      const timeRange = {
        start: new Date('2020-01-01'),
        end: new Date('2023-12-31')
      };

      const startTime = performance.now();
      const events = await eventRepository.findByTimeRange(timeRange, 1000, 0);
      const endTime = performance.now();

      const queryTime = endTime - startTime;
      
      expect(queryTime).toBeLessThan(2000); // Less than 2 seconds
      expect(events.length).toBeGreaterThan(0);
      expect(events.length).toBeLessThanOrEqual(1000);
      
      console.log(`Query time for 1000 events from large dataset: ${queryTime.toFixed(2)}ms`);
    });

    it('should efficiently query overlapping arcs with large temporal dataset', async () => {
      const timeRange = {
        start: new Date('2021-01-01'),
        end: new Date('2022-12-31')
      };

      const startTime = performance.now();
      const arcs = await arcRepository.findOverlappingArcs(timeRange, 500, 0);
      const endTime = performance.now();

      const queryTime = endTime - startTime;
      
      expect(queryTime).toBeLessThan(2000); // Less than 2 seconds
      expect(arcs.length).toBeGreaterThan(0);
      
      console.log(`Query time for overlapping arcs: ${queryTime.toFixed(2)}ms`);
    });

    it('should handle paginated queries efficiently', async () => {
      const pageSize = 100;
      const totalPages = 10;
      const queryTimes: number[] = [];

      for (let page = 0; page < totalPages; page++) {
        const startTime = performance.now();
        const events = await eventRepository.findAll(pageSize, page * pageSize);
        const endTime = performance.now();

        const queryTime = endTime - startTime;
        queryTimes.push(queryTime);
        
        expect(queryTime).toBeLessThan(1000); // Less than 1 second per page
        expect(events.length).toBeLessThanOrEqual(pageSize);
      }

      const averageQueryTime = queryTimes.reduce((sum, time) => sum + time, 0) / queryTimes.length;
      expect(averageQueryTime).toBeLessThan(500); // Average less than 500ms
      
      console.log(`Average paginated query time: ${averageQueryTime.toFixed(2)}ms`);
    });

    it('should perform actor-based filtering efficiently on large dataset', async () => {
      const testActor = 'Actor_50000'; // Middle of our test data
      const timeRange = {
        start: new Date('2020-01-01'),
        end: new Date('2023-12-31')
      };

      const startTime = performance.now();
      const events = await eventRepository.findByActorAndTimeRange(testActor, timeRange, 100, 0);
      const endTime = performance.now();

      const queryTime = endTime - startTime;
      
      expect(queryTime).toBeLessThan(1000); // Less than 1 second
      expect(events.length).toBeGreaterThan(0);
      
      // Verify all events belong to the correct actor
      events.forEach(event => {
        expect(event.actor).toBe(testActor);
      });
      
      console.log(`Actor-based query time: ${queryTime.toFixed(2)}ms for ${events.length} events`);
    });

    it('should handle concurrent queries without performance degradation', async () => {
      const concurrentQueries = 10;
      const queryPromises: Promise<any>[] = [];

      const startTime = performance.now();

      // Create concurrent queries
      for (let i = 0; i < concurrentQueries; i++) {
        const timeRange = {
          start: new Date(2020 + (i % 4), 0, 1),
          end: new Date(2020 + (i % 4), 11, 31)
        };
        
        queryPromises.push(
          eventRepository.findByTimeRange(timeRange, 100, i * 10)
        );
      }

      const results = await Promise.all(queryPromises);
      const endTime = performance.now();

      const totalTime = endTime - startTime;
      const averageTimePerQuery = totalTime / concurrentQueries;
      
      expect(totalTime).toBeLessThan(5000); // All queries complete in 5 seconds
      expect(averageTimePerQuery).toBeLessThan(1000); // Average less than 1 second
      
      // Verify all queries returned results
      results.forEach((events) => {
        expect(Array.isArray(events)).toBe(true);
        expect(events.length).toBeLessThanOrEqual(100);
      });
      
      console.log(`Concurrent queries total time: ${totalTime.toFixed(2)}ms, average: ${averageTimePerQuery.toFixed(2)}ms`);
    });

    it('should maintain performance with complex hierarchical arc queries', async () => {
      // Find a parent arc to test hierarchy
      const parentArcs = await arcRepository.findByLevel(1, 5, 0);
      expect(parentArcs.length).toBeGreaterThan(0);

      const parentArc = parentArcs[0];
      
      const startTime = performance.now();
      const nestedArcs = await arcRepository.findNestedArcs(parentArc.id, 100, 0);
      const endTime = performance.now();

      const queryTime = endTime - startTime;
      
      expect(queryTime).toBeLessThan(2000); // Less than 2 seconds
      
      // Verify hierarchy constraints
      nestedArcs.forEach(arc => {
        expect(arc.start_time.getTime()).toBeGreaterThanOrEqual(parentArc.start_time.getTime());
        expect(arc.end_time.getTime()).toBeLessThanOrEqual(parentArc.end_time.getTime());
        expect(arc.level).toBeGreaterThan(parentArc.level);
      });
      
      console.log(`Hierarchical query time: ${queryTime.toFixed(2)}ms for ${nestedArcs.length} nested arcs`);
    });
  });

  describe('Query Optimization Analysis', () => {
    it('should provide meaningful performance statistics', async () => {
      // Execute several different types of queries
      await eventRepository.findAll(100, 0);
      await eventRepository.findByActor('Actor_1000', 50, 0);
      await arcRepository.findByLevel(2, 50, 0);

      const stats = optimizationService.getPerformanceStatistics();
      
      expect(stats.averageExecutionTime).toBeGreaterThan(0);
      expect(stats.queryTypeBreakdown).toBeDefined();
      expect(Object.keys(stats.queryTypeBreakdown).length).toBeGreaterThan(0);
      
      console.log('Performance Statistics:', {
        averageExecutionTime: `${stats.averageExecutionTime.toFixed(2)}ms`,
        queryTypes: Object.keys(stats.queryTypeBreakdown),
        slowestQuery: stats.slowestQueries[0]?.executionTime || 0
      });
    });

    it('should suggest relevant optimizations', async () => {
      // Execute some queries to generate metrics
      for (let i = 0; i < 10; i++) {
        await eventRepository.findByActor(`Actor_${i * 1000}`, 10, 0);
      }

      const suggestions = optimizationService.suggestOptimizations();
      
      expect(Array.isArray(suggestions)).toBe(true);
      
      if (suggestions.length > 0) {
        console.log('Optimization Suggestions:', suggestions);
      }
    });
  });

  describe('Memory and Resource Usage', () => {
    it('should handle large result sets without memory issues', async () => {
      const initialMemory = process.memoryUsage();
      
      // Query large dataset
      const events = await eventRepository.findAll(5000, 0);
      
      const afterQueryMemory = process.memoryUsage();
      const memoryIncrease = afterQueryMemory.heapUsed - initialMemory.heapUsed;
      
      expect(events.length).toBe(5000);
      
      // Memory increase should be reasonable (less than 100MB for 5000 events)
      expect(memoryIncrease).toBeLessThan(100 * 1024 * 1024);
      
      console.log(`Memory increase for 5000 events: ${(memoryIncrease / 1024 / 1024).toFixed(2)}MB`);
    });

    it('should properly release database connections', async () => {
      const dbManager = getDatabaseManager();
      const initialStats = dbManager.getConnectionPoolStats();
      
      // Execute multiple queries
      const promises = [];
      for (let i = 0; i < 20; i++) {
        promises.push(eventRepository.findAll(10, i * 10));
      }
      
      await Promise.all(promises);
      
      // Allow some time for connections to be released
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const finalStats = dbManager.getConnectionPoolStats();
      
      // Connection pool should not grow indefinitely
      expect(finalStats.total).toBeLessThan(initialStats.total + 50);
      
      console.log('Connection Pool Stats:', {
        initial: initialStats.total,
        final: finalStats.total,
        created: finalStats.created,
        closed: finalStats.closed
      });
    });
  });

  // Helper function to generate large test dataset
  async function generateLargeDataset(): Promise<void> {
    const eventCount = 100000;
    const arcCount = 1000;
    const batchSize = 1000;

    // Generate events in batches
    for (let batch = 0; batch < eventCount / batchSize; batch++) {
      const batchEvents: Event[] = [];
      
      for (let i = 0; i < batchSize; i++) {
        const eventIndex = batch * batchSize + i;
        const event = new Event({
          id: `test-event-${eventIndex}`,
          description: `Test event ${eventIndex} for load testing`,
          actor: `Actor_${eventIndex}`,
          target: `Target_${eventIndex % 100}`,
          timestamp: new Date(2020, 0, 1 + (eventIndex % 1460)) // Spread over 4 years
        });
        
        batchEvents.push(event);
      }
      
      // Batch insert events
      await insertEventsBatch(batchEvents);
      testEvents.push(...batchEvents);
      
      if (batch % 10 === 0) {
        console.log(`Generated ${(batch + 1) * batchSize} events...`);
      }
    }

    // Generate arcs
    for (let i = 0; i < arcCount; i++) {
      const startYear = 2020 + (i % 4);
      const duration = Math.floor(Math.random() * 365) + 30; // 30-395 days
      
      const arc = new Arc({
        id: `test-arc-${i}`,
        name: `Test Arc ${i}`,
        description: `Test arc ${i} for load testing`,
        start_time: new Date(startYear, 0, 1 + (i % 30)),
        end_time: new Date(startYear, 0, 1 + (i % 30) + duration),
        level: Math.floor(i / 200) + 1 // Create hierarchy levels
      });
      
      testArcs.push(arc);
    }

    // Batch insert arcs
    await insertArcsBatch(testArcs);
  }

  // Helper function to batch insert events
  async function insertEventsBatch(events: Event[]): Promise<void> {
    const session = getDatabaseManager().getNeo4jSession();
    
    try {
      const query = `
        UNWIND $events as eventData
        CREATE (e:Event {
          id: eventData.id,
          description: eventData.description,
          actor: eventData.actor,
          target: eventData.target,
          timestamp: datetime(eventData.timestamp),
          metadata: eventData.metadata
        })
      `;

      const parameters = {
        events: events.map(event => ({
          id: event.id,
          description: event.description,
          actor: event.actor,
          target: event.target,
          timestamp: event.timestamp.toISOString(),
          metadata: event.metadata || {}
        }))
      };

      await session.run(query, parameters);
    } finally {
      await session.close();
    }
  }

  // Helper function to batch insert arcs
  async function insertArcsBatch(arcs: Arc[]): Promise<void> {
    const session = getDatabaseManager().getNeo4jSession();
    
    try {
      const query = `
        UNWIND $arcs as arcData
        CREATE (a:Arc {
          id: arcData.id,
          name: arcData.name,
          description: arcData.description,
          start_time: datetime(arcData.start_time),
          end_time: datetime(arcData.end_time),
          level: arcData.level,
          metadata: arcData.metadata
        })
      `;

      const parameters = {
        arcs: arcs.map(arc => ({
          id: arc.id,
          name: arc.name,
          description: arc.description || null,
          start_time: arc.start_time.toISOString(),
          end_time: arc.end_time.toISOString(),
          level: arc.level,
          metadata: arc.metadata || {}
        }))
      };

      await session.run(query, parameters);
    } finally {
      await session.close();
    }
  }

  // Helper function to clean up test data
  async function cleanupTestData(): Promise<void> {
    const session = getDatabaseManager().getNeo4jSession();
    
    try {
      // Delete test events
      await session.run('MATCH (e:Event) WHERE e.id STARTS WITH "test-event-" DELETE e');
      
      // Delete test arcs
      await session.run('MATCH (a:Arc) WHERE a.id STARTS WITH "test-arc-" DELETE a');
      
      console.log('Test data cleanup completed');
    } finally {
      await session.close();
    }
  }
});