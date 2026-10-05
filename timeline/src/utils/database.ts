import neo4j, { Driver, Session, auth } from 'neo4j-driver';
import type { Record as Neo4jRecord } from 'neo4j-driver';
import { createClient, RedisClientType } from 'redis';
import { DatabaseConnectionError } from './errors';
import { LocalGraphStore, LocalQueryResult, LocalQueryRecord, GraphParameters } from './LocalGraphStore';
import { getCacheManager, CacheManager } from './cache';
import { loadConfig } from './config';

/**
 * Database configuration interface
 */
export interface DatabaseConfig {
  neo4j: {
    uri: string;
    username: string;
    password: string;
    database?: string;
  };
  redis: {
    host: string;
    port: number;
    password?: string;
  };
}

/**
 * Connection pool statistics
 */
export interface ConnectionPoolStats {
  inUse: number;
  idle: number;
  total: number;
  created: number;
  closed: number;
  failedToCreate: number;
}

/**
 * Database connection manager with optimized pooling
 */
export class DatabaseManager {
  private neo4jDriver: Driver | null = null;
  private redisClient: RedisClientType | null = null;
  private config: DatabaseConfig;
  private connectionStats: ConnectionPoolStats = {
    inUse: 0,
    idle: 0,
    total: 0,
    created: 0,
    closed: 0,
    failedToCreate: 0
  };

  constructor(config: DatabaseConfig) {
    this.config = config;
  }

  /**
   * Initialize Neo4j connection with optimized pooling
   */
  async initializeNeo4j(): Promise<void> {
    try {
      this.neo4jDriver = neo4j.driver(
        this.config.neo4j.uri,
        auth.basic(this.config.neo4j.username, this.config.neo4j.password),
        {
          // Optimized connection pool settings
          maxConnectionLifetime: 30 * 60 * 1000, // 30 minutes (reduced from 3 hours)
          maxConnectionPoolSize: 100, // Increased from 50
          connectionAcquisitionTimeout: 30 * 1000, // 30 seconds (reduced from 2 minutes)
          connectionTimeout: 20 * 1000, // 20 seconds
          maxTransactionRetryTime: 15 * 1000, // 15 seconds
          
          // Enable connection pooling metrics
          logging: {
            level: 'info',
            logger: (level, message) => {
              if (message.includes('pool')) {
                this.updateConnectionStats(message);
              }
            }
          },
          
          // Optimize for high throughput
          fetchSize: 1000, // Fetch more records per batch
          disableLosslessIntegers: true // Use JavaScript numbers instead of Neo4j integers
        }
      );

      // Verify connectivity
      await this.neo4jDriver.verifyConnectivity();
      
      // Set up connection pool monitoring
      this.setupConnectionPoolMonitoring();
      
      console.log('Neo4j connection established successfully with optimized pooling');
    } catch (error) {
      console.error('Failed to connect to Neo4j:', error);
      throw new DatabaseConnectionError('Neo4j connection failed', error as Error);
    }
  }

  /**
   * Initialize Redis connection
   */
  async initializeRedis(): Promise<void> {
    try {
      this.redisClient = createClient({
        socket: {
          host: this.config.redis.host,
          port: this.config.redis.port,
        },
        password: this.config.redis.password,
      });

      this.redisClient.on('error', (err) => {
        console.error('Redis Client Error:', err);
      });

      await this.redisClient.connect();
      console.log('Redis connection established successfully');
    } catch (error) {
      console.error('Failed to connect to Redis:', error);
      throw new DatabaseConnectionError('Redis connection failed', error as Error);
    }
  }

  /**
   * Get Neo4j session with optimized settings
   */
  getNeo4jSession(database?: string, options?: { 
    defaultAccessMode?: 'READ' | 'WRITE';
    bookmarks?: string[];
    fetchSize?: number;
  }): Session {
    if (!this.neo4jDriver) {
      throw new DatabaseConnectionError('Neo4j driver not initialized');
    }
    
    return this.neo4jDriver.session({ 
      database: database || this.config.neo4j.database || 'neo4j',
      defaultAccessMode: options?.defaultAccessMode === 'READ' ? neo4j.session.READ : neo4j.session.WRITE,
      bookmarks: options?.bookmarks,
      fetchSize: options?.fetchSize || 1000
    });
  }

  /**
   * Get read-only Neo4j session for query optimization
   */
  getReadOnlySession(database?: string): Session {
    return this.getNeo4jSession(database, { defaultAccessMode: 'READ' });
  }

  /**
   * Execute query with automatic session management and timeout
   */
  async executeQuery<T>(
    query: string,
    parameters: GraphParameters = {},
    options?: {
      timeout?: number;
      database?: string;
      readOnly?: boolean;
      mapper?: (record: Neo4jRecord) => T;
    }
  ): Promise<T[]> {
    const session = options?.readOnly ? 
      this.getReadOnlySession(options?.database) : 
      this.getNeo4jSession(options?.database);
    
    try {
      const timeout = options?.timeout || 30000; // 30 second default timeout
      
      const queryPromise = session.run(query, parameters);
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Query timeout after ${timeout}ms`));
        }, timeout);
      });

      const result = await Promise.race([queryPromise, timeoutPromise]);
      
      return options?.mapper ? 
        result.records.map(options.mapper) : 
        result.records as T[];
    } finally {
      await session.close();
    }
  }

  /**
   * Get Redis client
   */
  getRedisClient(): RedisClientType {
    if (!this.redisClient) {
      throw new DatabaseConnectionError('Redis client not initialized');
    }
    return this.redisClient;
  }

  /**
   * Close all database connections
   */
  async close(): Promise<void> {
    const promises: Promise<unknown>[] = [];

    if (this.neo4jDriver) {
      promises.push(this.neo4jDriver.close());
    }

    if (this.redisClient) {
      promises.push(this.redisClient.quit());
    }

    await Promise.all(promises);
    console.log('All database connections closed');
  }

  /**
   * Check if connections are healthy
   */
  async healthCheck(): Promise<{ neo4j: boolean; redis: boolean; connectionPool?: ConnectionPoolStats }> {
    const health = { neo4j: false, redis: false, connectionPool: this.connectionStats };

    // Check Neo4j
    try {
      if (this.neo4jDriver) {
        await this.neo4jDriver.verifyConnectivity();
        health.neo4j = true;
      }
    } catch (error) {
      console.error('Neo4j health check failed:', error);
    }

    // Check Redis
    try {
      if (this.redisClient) {
        await this.redisClient.ping();
        health.redis = true;
      }
    } catch (error) {
      console.error('Redis health check failed:', error);
    }

    return health;
  }

  /**
   * Get connection pool statistics
   */
  getConnectionPoolStats(): ConnectionPoolStats {
    return { ...this.connectionStats };
  }

  /**
   * Setup connection pool monitoring
   */
  private setupConnectionPoolMonitoring(): void {
    if (!this.neo4jDriver) return;

    // Monitor connection pool events
    setInterval(() => {
      // This would ideally use Neo4j driver metrics if available
      // For now, we'll track basic stats
      this.updateConnectionPoolStats();
    }, 30000); // Update every 30 seconds
  }

  /**
   * Update connection pool statistics
   */
  private updateConnectionPoolStats(): void {
    // This is a simplified implementation
    // In a real scenario, you'd get these metrics from the Neo4j driver
    if (this.neo4jDriver) {
      // Placeholder for actual pool metrics
      this.connectionStats.total = this.connectionStats.created - this.connectionStats.closed;
    }
  }

  /**
   * Update connection stats from log messages
   */
  private updateConnectionStats(message: string): void {
    if (message.includes('created')) {
      this.connectionStats.created++;
    } else if (message.includes('closed')) {
      this.connectionStats.closed++;
    } else if (message.includes('failed')) {
      this.connectionStats.failedToCreate++;
    }
  }
}


/**
 * Singleton database manager instance.
 *
 * Local execution installs a `LocalDatabaseManager` (see
 * `initializeDatabaseManager`), so the singleton really holds either
 * implementation.
 */
let databaseManager: DatabaseManager | LocalDatabaseManager | null = null;

/**
 * Initialize database manager with configuration
 */
export function initializeDatabaseManager(config: DatabaseConfig): DatabaseManager | LocalDatabaseManager {
  const appConfig = loadConfig();
  
  if (appConfig.localExecution.enabled) {
    databaseManager = new LocalDatabaseManager();
  } else {
    databaseManager = new DatabaseManager(config);
  }
  
  return databaseManager;
}

/**
 * Get the database manager instance
 */
export function getDatabaseManager(): DatabaseManager {
  if (!databaseManager) {
    throw new Error('Database manager not initialized. Call initializeDatabaseManager first.');
  }
  // The singleton is a union because local execution installs a
  // `LocalDatabaseManager`, which does not implement the Neo4j-backed
  // `DatabaseManager` surface. Callers that run in local mode narrow with
  // `instanceof LocalDatabaseManager` before using the local-only API.
  return databaseManager as DatabaseManager;
}

/**
 * Local session implementation that wraps LocalGraphStore operations
 * Provides Neo4j Session-compatible interface
 */
export class LocalSession {
  private graphStore: LocalGraphStore;
  private isOpen: boolean = true;

  constructor(graphStore: LocalGraphStore) {
    this.graphStore = graphStore;
  }

  /**
   * Run a query against the local graph store
   */
  async run(query: string, parameters: GraphParameters = {}): Promise<LocalQueryResult> {
    if (!this.isOpen) {
      throw new Error('Session is closed');
    }
    
    try {
      return await this.graphStore.executeQuery(query, parameters);
    } catch (error) {
      throw new DatabaseConnectionError(`Local query execution failed: ${error}`, error as Error);
    }
  }

  /**
   * Close the session
   */
  async close(): Promise<void> {
    this.isOpen = false;
  }

  /**
   * Check if session is open
   */
  isConnected(): boolean {
    return this.isOpen;
  }
}

/**
 * Local database manager implementation for local execution mode
 * Provides DatabaseManager-compatible interface using LocalGraphStore
 */
export class LocalDatabaseManager {
  private graphStore: LocalGraphStore;
  private cacheManager = getCacheManager();
  private connectionStats: ConnectionPoolStats = {
    inUse: 0,
    idle: 0,
    total: 1, // Single local connection
    created: 1,
    closed: 0,
    failedToCreate: 0
  };

  constructor() {
    this.graphStore = new LocalGraphStore();
  }

  /**
   * Initialize the local graph store (load data from file)
   */
  async initializeNeo4j(): Promise<void> {
    try {
      await this.graphStore.load();
      console.log('Local graph store initialized successfully');
    } catch (error) {
      console.error('Failed to initialize local graph store:', error);
      throw new DatabaseConnectionError('Local graph store initialization failed', error as Error);
    }
  }

  /**
   * Initialize cache (already handled by getCacheManager)
   */
  async initializeRedis(): Promise<void> {
    // Cache manager handles local cache initialization
    console.log('Local cache initialized via cache manager');
  }

  /**
   * Get a local session (Neo4j Session-compatible).
   *
   * `database` and `options` are accepted for signature compatibility with
   * `DatabaseManager.getNeo4jSession`, but the local store has a single
   * implicit database and no session-level read/write mode, so they are unused.
   */
  getNeo4jSession(_database?: string, _options?: { 
    defaultAccessMode?: 'READ' | 'WRITE';
    bookmarks?: string[];
    fetchSize?: number;
  }): LocalSession {
    this.connectionStats.inUse++;
    return new LocalSession(this.graphStore);
  }

  /**
   * Get read-only session (same as regular session for local store)
   */
  getReadOnlySession(database?: string): LocalSession {
    return this.getNeo4jSession(database, { defaultAccessMode: 'READ' });
  }

  /**
   * Execute query with automatic session management
   */
  async executeQuery<T>(
    query: string,
    parameters: GraphParameters = {},
    options?: {
      timeout?: number;
      database?: string;
      readOnly?: boolean;
      mapper?: (record: LocalQueryRecord) => T;
    }
  ): Promise<T[]> {
    const session = this.getNeo4jSession(options?.database);
    
    try {
      const result = await session.run(query, parameters);
      
      return options?.mapper ? 
        result.records.map(options.mapper) : 
        result.records as T[];
    } finally {
      await session.close();
      this.connectionStats.inUse = Math.max(0, this.connectionStats.inUse - 1);
    }
  }

  /**
   * Get cache manager (Redis client replacement)
   */
  getRedisClient(): CacheManager {
    return this.cacheManager;
  }

  /**
   * Close all connections and save data
   */
  async close(): Promise<void> {
    try {
      await this.graphStore.shutdown();
      this.connectionStats.closed = this.connectionStats.created;
      console.log('Local database manager closed successfully');
    } catch (error) {
      console.error('Error closing local database manager:', error);
    }
  }

  /**
   * Health check for local components
   */
  async healthCheck(): Promise<{ neo4j: boolean; redis: boolean; connectionPool?: ConnectionPoolStats }> {
    const health = { 
      neo4j: true, // Local graph store is always available
      redis: this.cacheManager.isConnected(),
      connectionPool: this.connectionStats 
    };

    // Basic functionality test
    try {
      const stats = this.graphStore.getStats();
      console.log(`Local graph store stats: ${JSON.stringify(stats)}`);
    } catch (error) {
      console.error('Local graph store health check failed:', error);
      health.neo4j = false;
    }

    return health;
  }

  /**
   * Get connection pool statistics (simulated for local execution)
   */
  getConnectionPoolStats(): ConnectionPoolStats {
    return { ...this.connectionStats };
  }

  /**
   * Get the underlying graph store (for direct access if needed)
   */
  getGraphStore(): LocalGraphStore {
    return this.graphStore;
  }
}