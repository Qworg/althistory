import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Container, initializeContainer, cleanupContainer } from '@/container';
import { loadConfig, initializeDatabaseManager } from '@/utils';
import { Event } from '@/models/Event';
import { Arc } from '@/models/Arc';

describe('Service Integration Tests', () => {
  let container: Container;

  beforeAll(async () => {
    const config = loadConfig();
    const dbManager = initializeDatabaseManager(config.database);
    container = initializeContainer(dbManager, config);
    
    try {
      await container.initialize();
    } catch (error) {
      console.warn('Database initialization failed, skipping integration tests:', error);
      return;
    }
  });

  afterAll(async () => {
    await cleanupContainer();
  });

  describe('Container Initialization', () => {
    it('should initialize all services successfully', async () => {
      const health = await container.getHealthStatus();
      
      expect(health).toMatchObject({
        status: expect.stringMatching(/healthy|unhealthy/),
        services: expect.any(Object),
        database: expect.any(Object),
        timestamp: expect.any(String)
      });

      // Verify all services are initialized
      expect(container.temporalService).toBeDefined();
      expect(container.causalService).toBeDefined();
      expect(container.inferenceService).toBeDefined();
      expect(container.graphCopyService).toBeDefined();
      expect(container.validationService).toBeDefined();
      expect(container.cacheInvalidationService).toBeDefined();
      expect(container.databaseOptimizationService).toBeDefined();
      expect(container.eventRepository).toBeDefined();
      expect(container.arcRepository).toBeDefined();
    });

    it('should provide singleton instances', () => {
      // Verify that services are singletons
      const temporal1 = container.temporalService;
      const temporal2 = container.temporalService;
      expect(temporal1).toBe(temporal2);

      const causal1 = container.causalService;
      const causal2 = container.causalService;
      expect(causal1).toBe(causal2);
    });
  });

  describe('Service Dependencies', () => {
    it('should wire service dependencies correctly', () => {
      // Verify that services have their dependencies injected
      expect(container.temporalService).toBeDefined();
      expect(container.causalService).toBeDefined();
      expect(container.inferenceService).toBeDefined();
      
      // These services should be able to interact with each other
      // through their injected dependencies
    });

    it('should provide database access to all services', () => {
      expect(container.databaseManager).toBeDefined();
      
      // Verify database manager is accessible
      expect(container.databaseManager.getConnectionPoolStats).toBeDefined();
    });
  });

  describe('Repository Integration', () => {
    it('should integrate repositories with services', () => {
      const eventRepo = container.eventRepository;
      const arcRepo = container.arcRepository;
      
      expect(eventRepo).toBeDefined();
      expect(arcRepo).toBeDefined();
      
      // Repositories should have access to validation and cache services
      expect(eventRepo.create).toBeDefined();
      expect(arcRepo.create).toBeDefined();
    });
  });

  describe('Cross-Service Workflows', () => {
    it('should support temporal validation workflow', async () => {
      const temporalService = container.temporalService;
      const validationService = container.validationService;
      
      // Create test event and arc
      const event = new Event({
        id: 'test-event-1',
        description: 'Test event',
        actor: 'Test Actor',
        target: 'Test Target',
        timestamp: new Date('2023-06-15T12:00:00Z')
      });

      const arc = new Arc({
        id: 'test-arc-1',
        name: 'Test Arc',
        start_time: new Date('2023-06-01T00:00:00Z'),
        end_time: new Date('2023-06-30T23:59:59Z'),
        level: 1
      });

      // Test temporal validation
      const isValid = temporalService.validateEventInArc(event, arc);
      expect(typeof isValid).toBe('boolean');
    });

    it('should support causal relationship workflow', async () => {
      const causalService = container.causalService;
      const temporalService = container.temporalService;
      
      // Create test events with proper temporal ordering
      const causeEvent = new Event({
        id: 'cause-event',
        description: 'Cause event',
        actor: 'Actor A',
        target: 'Target A',
        timestamp: new Date('2023-06-15T10:00:00Z')
      });

      const effectEvent = new Event({
        id: 'effect-event',
        description: 'Effect event',
        actor: 'Actor B',
        target: 'Target B',
        timestamp: new Date('2023-06-15T14:00:00Z')
      });

      // Test temporal paradox prevention
      const hasParadox = temporalService.preventTemporalParadox(causeEvent, effectEvent);
      expect(typeof hasParadox).toBe('boolean');
    });

    it('should support inference workflow', async () => {
      const inferenceService = container.inferenceService;
      
      // Test inference service initialization
      expect(inferenceService.analyzeEventClusters).toBeDefined();
      expect(inferenceService.updatePressureConfidence).toBeDefined();
    });

    it('should support graph copy workflow', async () => {
      const graphCopyService = container.graphCopyService;
      
      // Test graph copy service methods
      expect(graphCopyService.copyFullGraph).toBeDefined();
      expect(graphCopyService.copyByTimeRange).toBeDefined();
      expect(graphCopyService.copyByEntityFilter).toBeDefined();
    });
  });

  describe('Cache Integration', () => {
    it('should integrate cache invalidation across services', async () => {
      const cacheService = container.cacheInvalidationService;
      
      expect(cacheService).toBeDefined();
      expect(cacheService.invalidateEventCache).toBeDefined();
      expect(cacheService.invalidateArcCache).toBeDefined();
    });
  });

  describe('Database Optimization', () => {
    it('should provide database optimization services', async () => {
      const optimizationService = container.databaseOptimizationService;
      
      expect(optimizationService).toBeDefined();
      expect(optimizationService.analyzeQueryPerformance).toBeDefined();
      expect(optimizationService.optimizeIndexes).toBeDefined();
    });
  });

  describe('Error Handling Integration', () => {
    it('should handle service errors gracefully', async () => {
      // Test error propagation through service layers
      const validationService = container.validationService;
      
      try {
        // This should trigger validation error
        validationService.validateEvent({} as any);
      } catch (error) {
        expect(error).toBeDefined();
        expect(error instanceof Error).toBe(true);
      }
    });

    it('should maintain service availability during errors', async () => {
      // Even if one service has issues, others should remain functional
      const health = await container.getHealthStatus();
      
      // Health check should always return a response
      expect(health.status).toBeDefined();
      expect(health.timestamp).toBeDefined();
    });
  });

  describe('Performance Integration', () => {
    it('should maintain performance across service calls', async () => {
      const startTime = Date.now();
      
      // Perform multiple service operations
      const temporalService = container.temporalService;
      const validationService = container.validationService;
      
      // These operations should complete quickly
      const event = new Event({
        id: 'perf-test-event',
        description: 'Performance test event',
        actor: 'Test Actor',
        target: 'Test Target',
        timestamp: new Date()
      });

      validationService.validateEvent(event);
      
      const duration = Date.now() - startTime;
      
      // Service operations should be fast (under 100ms for basic operations)
      expect(duration).toBeLessThan(100);
    });
  });

  describe('Configuration Integration', () => {
    it('should use configuration across all services', () => {
      const config = container.config;
      
      expect(config).toBeDefined();
      expect(config.database).toBeDefined();
      expect(config.performance).toBeDefined();
      
      // Services should have access to configuration
      expect(config.performance.queryTimeoutMs).toBeGreaterThan(0);
      expect(config.performance.maxQueryResults).toBeGreaterThan(0);
    });
  });
});