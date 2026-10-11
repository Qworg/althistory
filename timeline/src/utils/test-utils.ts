import { DatabaseManager, DatabaseConfig, initializeDatabaseManager } from './database';

/**
 * Human-readable message for a rejected promise of unknown shape, used to keep
 * the availability probes below reporting the real cause.
 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Test configuration with fallbacks
 */
export const getTestConfig = (): DatabaseConfig => ({
  neo4j: {
    uri: process.env.NEO4J_TEST_URI || process.env.NEO4J_URI || 'bolt://localhost:7687',
    username: process.env.NEO4J_TEST_USERNAME || process.env.NEO4J_USERNAME || 'neo4j',
    password: process.env.NEO4J_TEST_PASSWORD || process.env.NEO4J_PASSWORD || 'password',
    database: process.env.NEO4J_TEST_DATABASE || process.env.NEO4J_DATABASE || 'test'
  },
  redis: {
    host: process.env.REDIS_TEST_HOST || process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_TEST_PORT || process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_TEST_PASSWORD || process.env.REDIS_PASSWORD
  }
});

/**
 * Check if Neo4j is available for testing
 */
export async function isNeo4jAvailable(): Promise<boolean> {
  try {
    const testConfig = getTestConfig();
    const tempManager = initializeDatabaseManager(testConfig);
    await tempManager.initializeNeo4j();
    await tempManager.close();
    return true;
  } catch (error) {
    console.warn('Neo4j not available for testing:', errorMessage(error));
    return false;
  }
}

/**
 * Check if Redis is available for testing
 */
export async function isRedisAvailable(): Promise<boolean> {
  try {
    const testConfig = getTestConfig();
    const tempManager = initializeDatabaseManager(testConfig);
    await tempManager.initializeRedis();
    await tempManager.close();
    return true;
  } catch (error) {
    console.warn('Redis not available for testing:', errorMessage(error));
    return false;
  }
}

/**
 * Check if both databases are available
 */
export async function areDatabasesAvailable(): Promise<boolean> {
  const [neo4jAvailable, redisAvailable] = await Promise.all([
    isNeo4jAvailable(),
    isRedisAvailable()
  ]);
  return neo4jAvailable && redisAvailable;
}

/**
 * Skip test if databases are not available
 */
export function skipIfDatabasesUnavailable() {
  return async (testFn: () => Promise<void> | void) => {
    const available = await areDatabasesAvailable();
    if (!available) {
      console.warn('Skipping test - databases not available');
      return;
    }
    return testFn();
  };
}

/**
 * Skip test if Neo4j is not available
 */
export function skipIfNeo4jUnavailable() {
  return async (testFn: () => Promise<void> | void) => {
    const available = await isNeo4jAvailable();
    if (!available) {
      console.warn('Skipping test - Neo4j not available');
      return;
    }
    return testFn();
  };
}

/**
 * Create a test database manager with proper cleanup
 */
export async function createTestDatabaseManager(): Promise<DatabaseManager | null> {
  try {
    const testConfig = getTestConfig();
    const manager = initializeDatabaseManager(testConfig);
    
    // Try to initialize connections
    await manager.initializeNeo4j();
    
    // Try Redis if available
    try {
      await manager.initializeRedis();
    } catch (error) {
      console.warn('Redis not available, continuing without it');
    }
    
    // `initializeDatabaseManager` installs a `LocalDatabaseManager` when local
    // execution is enabled. This helper drives the Neo4j-backed manager, so
    // report the union it hands back as that manager; a local run simply keeps
    // the local implementation, which exposes the same call surface.
    return manager as DatabaseManager;
  } catch (error) {
    console.warn('Could not create test database manager:', errorMessage(error));
    return null;
  }
}

/**
 * Clean up test data from Neo4j
 */
export async function cleanupTestData(manager: DatabaseManager, prefix: string = 'test_'): Promise<void> {
  try {
    const session = manager.getNeo4jSession();
    await session.run(`
      MATCH (n) 
      WHERE n.id IS NOT NULL AND (
        n.id STARTS WITH $prefix OR 
        n.id STARTS WITH 'test_' OR 
        n.id STARTS WITH 'arc_' OR 
        n.id STARTS WITH 'event_' OR 
        n.id STARTS WITH 'advanced_'
      )
      DETACH DELETE n
    `, { prefix });
    await session.close();
  } catch (error) {
    console.warn('Could not clean up test data:', errorMessage(error));
  }
}