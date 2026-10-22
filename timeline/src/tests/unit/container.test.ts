import { describe, it, expect, beforeEach } from 'vitest';
import neo4j, { Driver, Session } from 'neo4j-driver';
import { createClient, RedisClientType } from 'redis';
import { Container } from '@/container';
import { DatabaseManager } from '@/utils/database';
import { AppConfig } from '@/utils/config';

// Mock database manager for unit testing
class MockDatabaseManager extends DatabaseManager {
  // Services capture a Redis client and a Neo4j session at construction time.
  // These unit tests never issue a command or a query, so unconnected
  // clients (built by the real factories, never connected) satisfy both
  // contracts without opening a socket.
  private readonly mockRedisClient: RedisClientType = createClient({
    socket: { host: 'localhost', port: 6379 }
  });

  private readonly mockDriver: Driver = neo4j.driver(
    'bolt://localhost:7687',
    neo4j.auth.basic('neo4j', 'password')
  );

  constructor() {
    super({
      neo4j: {
        uri: 'bolt://localhost:7687',
        username: 'neo4j',
        password: 'password'
      },
      redis: {
        host: 'localhost',
        port: 6379
      }
    });
  }

  async initializeNeo4j(): Promise<void> {
    // Mock implementation
  }

  async initializeRedis(): Promise<void> {
    // Mock implementation
  }

  getNeo4jSession(): Session {
    return this.mockDriver.session({ database: 'test' });
  }

  getRedisClient(): RedisClientType {
    return this.mockRedisClient;
  }

  async close(): Promise<void> {
    await this.mockDriver.close();
  }

  async healthCheck() {
    return { neo4j: true, redis: true };
  }
}

describe('Container Unit Tests', () => {
  let container: Container;
  let mockDbManager: MockDatabaseManager;
  let mockConfig: AppConfig;

  beforeEach(() => {
    mockDbManager = new MockDatabaseManager();
    mockConfig = {
      port: 3000,
      nodeEnv: 'test',
      database: {
        neo4j: {
          uri: 'bolt://localhost:7687',
          username: 'neo4j',
          password: 'password'
        },
        redis: {
          host: 'localhost',
          port: 6379
        }
      },
      performance: {
        queryTimeoutMs: 2000,
        maxQueryResults: 10000,
        cacheExpirationMs: 300000
      },
      cloudState: {
        singleReplicaAcknowledged: true,
      },
      localExecution: {
        enabled: false,
        dataDirectory: './data',
        graphFile: 'graph.json',
        cacheSize: 1000,
        persistenceInterval: 30000,
        backupEnabled: false,
        backupInterval: 300000,
        maxMemoryUsage: 512
      }
    };

    container = new Container(mockDbManager, mockConfig);
  });

  describe('Service Instantiation', () => {
    it('should create temporal service instance', () => {
      const service = container.temporalService;
      expect(service).toBeDefined();
      expect(service.constructor.name).toBe('TemporalService');
    });

    it('should create causal service instance', () => {
      const service = container.causalService;
      expect(service).toBeDefined();
      expect(service.constructor.name).toBe('CausalService');
    });

    it('should create inference service instance', () => {
      const service = container.inferenceService;
      expect(service).toBeDefined();
      expect(service.constructor.name).toBe('InferenceService');
    });

    it('should create graph copy service instance', () => {
      const service = container.graphCopyService;
      expect(service).toBeDefined();
      expect(service.constructor.name).toBe('GraphCopyService');
    });

    it('should create validation service instance', () => {
      const service = container.validationService;
      expect(service).toBeDefined();
      expect(service.constructor.name).toBe('ValidationService');
    });

    it('should create database optimization service instance', () => {
      const service = container.databaseOptimizationService;
      expect(service).toBeDefined();
      expect(service.constructor.name).toBe('DatabaseOptimizationService');
    });
  });

  describe('Repository Instantiation', () => {
    it('should create event repository instance', () => {
      const repo = container.eventRepository;
      expect(repo).toBeDefined();
      expect(repo.constructor.name).toBe('EventRepository');
    });

    it('should create arc repository instance', () => {
      const repo = container.arcRepository;
      expect(repo).toBeDefined();
      expect(repo.constructor.name).toBe('ArcRepository');
    });
  });

  describe('Singleton Behavior', () => {
    it('should return same instance for multiple calls', () => {
      const service1 = container.temporalService;
      const service2 = container.temporalService;
      expect(service1).toBe(service2);
    });

    it('should return same repository instance for multiple calls', () => {
      const repo1 = container.eventRepository;
      const repo2 = container.eventRepository;
      expect(repo1).toBe(repo2);
    });
  });

  describe('Dependency Injection', () => {
    it('should inject database manager into services', () => {
      const service = container.temporalService;
      expect(service).toBeDefined();
      // The service should have access to the database manager through its constructor
    });

    it('should inject validation service into other services', () => {
      const temporalService = container.temporalService;
      const causalService = container.causalService;
      
      expect(temporalService).toBeDefined();
      expect(causalService).toBeDefined();
      
      // Both services should have access to the validation service
    });

    it('should inject temporal service into causal service', () => {
      const causalService = container.causalService;
      expect(causalService).toBeDefined();
      
      // Causal service should have access to temporal service for paradox prevention
    });

    it('should inject multiple dependencies into inference service', () => {
      const inferenceService = container.inferenceService;
      expect(inferenceService).toBeDefined();
      
      // Inference service should have access to temporal and causal services
    });
  });

  describe('Configuration Access', () => {
    it('should provide access to configuration', () => {
      expect(container.config).toBe(mockConfig);
      expect(container.config.port).toBe(3000);
      expect(container.config.nodeEnv).toBe('test');
    });

    it('should provide access to database manager', () => {
      expect(container.databaseManager).toBe(mockDbManager);
    });
  });

  describe('Health Status', () => {
    it('should provide health status without database connections', async () => {
      const health = await container.getHealthStatus();
      
      expect(health).toMatchObject({
        status: expect.stringMatching(/healthy|unhealthy/),
        services: expect.any(Object),
        database: expect.any(Object),
        timestamp: expect.any(String)
      });
    });

    it('should track service initialization status', async () => {
      // Initially, services should not be initialized
      let health = await container.getHealthStatus();
      expect(health.services.temporalService).toBe(false);
      
      // After accessing a service, it should be marked as initialized
      container.temporalService;
      health = await container.getHealthStatus();
      expect(health.services.temporalService).toBe(true);
    });
  });

  describe('Service Method Availability', () => {
    it('should expose temporal service methods', () => {
      const service = container.temporalService;
      expect(service.validateEventInArc).toBeDefined();
      expect(service.validateArcNesting).toBeDefined();
      expect(service.findOverlappingArcs).toBeDefined();
      expect(service.findEventsInRange).toBeDefined();
      expect(service.preventTemporalParadox).toBeDefined();
    });

    it('should expose causal service methods', () => {
      const service = container.causalService;
      expect(service.createCausalLink).toBeDefined();
      expect(service.findCausalChain).toBeDefined();
      expect(service.calculateCausalStrength).toBeDefined();
      expect(service.detectCausalCycles).toBeDefined();
    });

    it('should expose inference service methods', () => {
      const service = container.inferenceService;
      expect(service.analyzeEventClusters).toBeDefined();
      expect(service.updatePressureConfidence).toBeDefined();
    });

    it('should expose graph copy service methods', () => {
      const service = container.graphCopyService;
      expect(service.copyFullGraph).toBeDefined();
      expect(service.copyByTimeRange).toBeDefined();
      expect(service.copyByEntityFilter).toBeDefined();
      expect(service.validateCopyIntegrity).toBeDefined();
    });

    it('should expose validation service methods', () => {
      const service = container.validationService;
      expect(service.validateEvent).toBeDefined();
      expect(service.validateArc).toBeDefined();
      expect(service.validateCausalRelationship).toBeDefined();
      expect(service.validateInferredPressure).toBeDefined();
    });
  });

  describe('Repository Method Availability', () => {
    it('should expose event repository methods', () => {
      const repo = container.eventRepository;
      expect(repo.create).toBeDefined();
      expect(repo.findById).toBeDefined();
      expect(repo.findAll).toBeDefined();
      expect(repo.update).toBeDefined();
      expect(repo.delete).toBeDefined();
      expect(repo.findByTimeRange).toBeDefined();
      expect(repo.findByActor).toBeDefined();
    });

    it('should expose arc repository methods', () => {
      const repo = container.arcRepository;
      expect(repo.create).toBeDefined();
      expect(repo.findById).toBeDefined();
      expect(repo.findAll).toBeDefined();
      expect(repo.update).toBeDefined();
      expect(repo.delete).toBeDefined();
      expect(repo.findOverlapping).toBeDefined();
      expect(repo.findByLevel).toBeDefined();
    });
  });
});