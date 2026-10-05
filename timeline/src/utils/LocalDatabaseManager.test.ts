import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LocalDatabaseManager, LocalSession } from './database';
import { LocalGraphStore } from './LocalGraphStore';
import { DatabaseConnectionError } from './errors';
import * as fs from 'fs/promises';

describe('LocalDatabaseManager', () => {
  let dbManager: LocalDatabaseManager;
  const testDataDir = './test-db-data';

  beforeEach(async () => {
    // Mock config to use test directory
    process.env.LOCAL_EXECUTION_ENABLED = 'true';
    process.env.LOCAL_DATA_DIR = testDataDir;
    process.env.LOCAL_GRAPH_FILE = 'test-graph.json';
    process.env.LOCAL_BACKUP_ENABLED = 'false';
    
    dbManager = new LocalDatabaseManager();
    
    // Ensure test directory exists
    try {
      await fs.mkdir(testDataDir, { recursive: true });
    } catch (error) {
      // Directory might already exist
    }
  });

  afterEach(async () => {
    await dbManager.close();
    
    // Clean up test directory
    try {
      await fs.rmdir(testDataDir, { recursive: true });
    } catch (error) {
      // Directory might not exist or be empty
    }
  });

  describe('Initialization', () => {
    it('should initialize Neo4j (local graph store) successfully', async () => {
      await expect(dbManager.initializeNeo4j()).resolves.not.toThrow();
    });

    it('should initialize Redis (local cache) successfully', async () => {
      await expect(dbManager.initializeRedis()).resolves.not.toThrow();
    });

    it('should handle graph store initialization errors', async () => {
      // Mock graph store to throw error
      const graphStore = new LocalGraphStore();
      vi.spyOn(graphStore, 'load').mockRejectedValue(new Error('Initialization failed'));
      
      // Replace the graph store instance
      (dbManager as any).graphStore = graphStore;
      
      await expect(dbManager.initializeNeo4j()).rejects.toThrow(DatabaseConnectionError);
    });
  });

  describe('Session Management', () => {
    beforeEach(async () => {
      await dbManager.initializeNeo4j();
    });

    it('should create Neo4j sessions', () => {
      const session = dbManager.getNeo4jSession();
      expect(session).toBeInstanceOf(LocalSession);
      expect(session.isConnected()).toBe(true);
    });

    it('should create sessions with options', () => {
      const session = dbManager.getNeo4jSession('test-db', { 
        defaultAccessMode: 'READ',
        fetchSize: 100 
      });
      expect(session).toBeInstanceOf(LocalSession);
    });

    it('should create read-only sessions', () => {
      const session = dbManager.getReadOnlySession();
      expect(session).toBeInstanceOf(LocalSession);
    });

    it('should track connection statistics', () => {
      const initialStats = dbManager.getConnectionPoolStats();
      expect(initialStats.inUse).toBe(0);
      expect(initialStats.total).toBe(1);

      // Opening sessions is the side effect under test; the handles themselves
      // are not needed here.
      const _session1 = dbManager.getNeo4jSession();
      const _session2 = dbManager.getNeo4jSession();

      const statsAfterSessions = dbManager.getConnectionPoolStats();
      expect(statsAfterSessions.inUse).toBe(2);
    });
  });

  describe('Query Execution', () => {
    beforeEach(async () => {
      await dbManager.initializeNeo4j();
    });

    it('should execute queries successfully', async () => {
      const query = 'CREATE (e:Event { id: $id, description: $description }) RETURN e';
      const parameters = { id: 'test-event', description: 'Test event' };

      const results = await dbManager.executeQuery(query, parameters);
      expect(results).toHaveLength(1);
    });

    it('should execute queries with mapper function', async () => {
      // First create a node
      await dbManager.executeQuery('CREATE (e:Event { id: $id, description: $description })', {
        id: 'mapped-event',
        description: 'Event for mapping'
      });

      const query = 'MATCH (e:Event { id: $id }) RETURN e';
      const parameters = { id: 'mapped-event' };
      const mapper = (record: any) => ({
        nodeId: record.get('e').properties.id,
        nodeDescription: record.get('e').properties.description
      });

      const results = await dbManager.executeQuery(query, parameters, { mapper });
      expect(results).toHaveLength(1);
      expect(results[0]).toHaveProperty('nodeId', 'mapped-event');
      expect(results[0]).toHaveProperty('nodeDescription', 'Event for mapping');
    });

    it('should execute read-only queries', async () => {
      // First create some test data
      await dbManager.executeQuery('CREATE (e:Event { id: $id, description: $description })', {
        id: 'readonly-test',
        description: 'Read-only test event'
      });

      const query = 'MATCH (e:Event { id: $id }) RETURN e';
      const parameters = { id: 'readonly-test' };

      const results = await dbManager.executeQuery(query, parameters, { readOnly: true });
      expect(results).toHaveLength(1);
    });

    it('should handle query execution errors', async () => {
      const invalidQuery = 'INVALID QUERY SYNTAX';

      await expect(dbManager.executeQuery(invalidQuery))
        .rejects.toThrow();
    });

    it('should properly close sessions after query execution', async () => {
      const initialStats = dbManager.getConnectionPoolStats();
      const initialInUse = initialStats.inUse;

      await dbManager.executeQuery('CREATE (e:Event { id: $id })', { id: 'session-test' });

      const finalStats = dbManager.getConnectionPoolStats();
      expect(finalStats.inUse).toBe(initialInUse); // Should be back to original
    });
  });

  describe('Cache Management', () => {
    it('should provide Redis client interface', () => {
      const cacheManager = dbManager.getRedisClient();
      expect(cacheManager).toBeDefined();
      expect(typeof cacheManager.get).toBe('function');
      expect(typeof cacheManager.set).toBe('function');
    });
  });

  describe('Health Checks', () => {
    beforeEach(async () => {
      await dbManager.initializeNeo4j();
    });

    it('should perform health checks successfully', async () => {
      const health = await dbManager.healthCheck();
      
      expect(health).toHaveProperty('neo4j', true);
      expect(health).toHaveProperty('redis');
      expect(health).toHaveProperty('connectionPool');
      expect(health.connectionPool).toHaveProperty('total', 1);
    });

    it('should detect graph store health issues', async () => {
      // Mock graph store to throw error on getStats
      const graphStore = (dbManager as any).graphStore;
      vi.spyOn(graphStore, 'getStats').mockImplementation(() => {
        throw new Error('Stats error');
      });

      const health = await dbManager.healthCheck();
      expect(health.neo4j).toBe(false);
    });
  });

  describe('Connection Pool Statistics', () => {
    it('should provide accurate connection pool statistics', () => {
      const stats = dbManager.getConnectionPoolStats();
      
      expect(stats).toHaveProperty('inUse');
      expect(stats).toHaveProperty('idle');
      expect(stats).toHaveProperty('total', 1);
      expect(stats).toHaveProperty('created', 1);
      expect(stats).toHaveProperty('closed', 0);
      expect(stats).toHaveProperty('failedToCreate', 0);
    });

    it('should update statistics when creating sessions', () => {
      const initialStats = dbManager.getConnectionPoolStats();
      
      // Opening sessions is the side effect under test; the handles themselves
      // are not needed here.
      const _session1 = dbManager.getNeo4jSession();
      const _session2 = dbManager.getNeo4jSession();
      
      const updatedStats = dbManager.getConnectionPoolStats();
      expect(updatedStats.inUse).toBe(initialStats.inUse + 2);
    });
  });

  describe('Cleanup and Shutdown', () => {
    beforeEach(async () => {
      await dbManager.initializeNeo4j();
    });

    it('should close gracefully', async () => {
      await expect(dbManager.close()).resolves.not.toThrow();
      
      const stats = dbManager.getConnectionPoolStats();
      expect(stats.closed).toBe(stats.created);
    });

    it('should handle errors during shutdown', async () => {
      // Mock graph store to throw error on shutdown
      const graphStore = (dbManager as any).graphStore;
      vi.spyOn(graphStore, 'shutdown').mockRejectedValue(new Error('Shutdown error'));

      // Should not throw, but log error
      await expect(dbManager.close()).resolves.not.toThrow();
    });
  });

  describe('Interface Compatibility', () => {
    beforeEach(async () => {
      await dbManager.initializeNeo4j();
    });

    it('should maintain Neo4j DatabaseManager interface compatibility', () => {
      // Check that all required methods exist
      expect(typeof dbManager.initializeNeo4j).toBe('function');
      expect(typeof dbManager.initializeRedis).toBe('function');
      expect(typeof dbManager.getNeo4jSession).toBe('function');
      expect(typeof dbManager.getReadOnlySession).toBe('function');
      expect(typeof dbManager.executeQuery).toBe('function');
      expect(typeof dbManager.getRedisClient).toBe('function');
      expect(typeof dbManager.close).toBe('function');
      expect(typeof dbManager.healthCheck).toBe('function');
      expect(typeof dbManager.getConnectionPoolStats).toBe('function');
    });

    it('should handle database parameter in session creation', () => {
      const session = dbManager.getNeo4jSession('test-database');
      expect(session).toBeInstanceOf(LocalSession);
    });

    it('should handle options in executeQuery method', async () => {
      const query = 'CREATE (e:Event { id: $id }) RETURN e';
      const parameters = { id: 'options-test' };
      const options = {
        timeout: 5000,
        database: 'test-db',
        readOnly: false
      };

      const results = await dbManager.executeQuery(query, parameters, options);
      expect(results).toHaveLength(1);
    });
  });
});

describe('LocalSession', () => {
  let session: LocalSession;
  let graphStore: LocalGraphStore;
  const testDataDir = './test-session-data';

  beforeEach(async () => {
    // Mock config to use test directory
    process.env.LOCAL_EXECUTION_ENABLED = 'true';
    process.env.LOCAL_DATA_DIR = testDataDir;
    process.env.LOCAL_GRAPH_FILE = 'test-session-graph.json';
    process.env.LOCAL_BACKUP_ENABLED = 'false';
    
    graphStore = new LocalGraphStore();
    session = new LocalSession(graphStore);
    
    // Ensure test directory exists
    try {
      await fs.mkdir(testDataDir, { recursive: true });
    } catch (error) {
      // Directory might already exist
    }
  });

  afterEach(async () => {
    await session.close();
    await graphStore.shutdown();
    
    // Clean up test directory
    try {
      await fs.rmdir(testDataDir, { recursive: true });
    } catch (error) {
      // Directory might not exist or be empty
    }
  });

  describe('Query Execution', () => {
    it('should run queries successfully', async () => {
      const query = 'CREATE (e:Event { id: $id, description: $description }) RETURN e';
      const parameters = { id: 'session-test', description: 'Session test event' };

      const result = await session.run(query, parameters);
      expect(result.records).toHaveLength(1);
      expect(result.summary.counters.nodesCreated).toBe(1);
    });

    it('should run queries without parameters', async () => {
      const query = 'CREATE (e:Event { id: "no-params" }) RETURN e';
      
      const result = await session.run(query);
      expect(result.records).toHaveLength(1);
    });

    it('should handle query errors', async () => {
      const invalidQuery = 'INVALID CYPHER SYNTAX';
      
      await expect(session.run(invalidQuery))
        .rejects.toThrow(DatabaseConnectionError);
    });

    it('should throw error when session is closed', async () => {
      await session.close();
      
      await expect(session.run('CREATE (n) RETURN n'))
        .rejects.toThrow('Session is closed');
    });
  });

  describe('Session Management', () => {
    it('should start as connected', () => {
      expect(session.isConnected()).toBe(true);
    });

    it('should close successfully', async () => {
      expect(session.isConnected()).toBe(true);
      
      await session.close();
      
      expect(session.isConnected()).toBe(false);
    });

    it('should handle multiple close calls gracefully', async () => {
      await session.close();
      await expect(session.close()).resolves.not.toThrow();
      
      expect(session.isConnected()).toBe(false);
    });
  });

  describe('Neo4j Session Interface Compatibility', () => {
    it('should implement required Neo4j Session methods', () => {
      expect(typeof session.run).toBe('function');
      expect(typeof session.close).toBe('function');
      expect(typeof session.isConnected).toBe('function');
    });

    it('should return results in Neo4j-compatible format', async () => {
      const query = 'CREATE (e:Event { id: $id }) RETURN e';
      const parameters = { id: 'compatibility-test' };

      const result = await session.run(query, parameters);
      
      expect(result).toHaveProperty('records');
      expect(result).toHaveProperty('summary');
      expect(result.summary).toHaveProperty('counters');
    });

    it.skip('should handle complex queries like Neo4j', async () => {
      // TODO: Skipped - requires relationship pattern matching in MATCH queries
      // which is not yet implemented in LocalGraphStore's CypherQueryParser
      // Create test data
      await session.run('CREATE (e1:Event { id: "event1", actor: "Actor1" })');
      await session.run('CREATE (e2:Event { id: "event2", actor: "Actor2" })');
      await session.run('MATCH (e1:Event { id: "event1" }), (e2:Event { id: "event2" }) CREATE (e1)-[:CAUSES]->(e2)');

      // Query with relationships
      const query = `
        MATCH (e1:Event)-[r:CAUSES]->(e2:Event)
        WHERE e1.actor = $actor
        RETURN e1, r, e2
      `;

      const result = await session.run(query, { actor: 'Actor1' });
      expect(result.records).toHaveLength(1);
    });
  });
});