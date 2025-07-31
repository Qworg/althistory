import { createClient, RedisClientType } from 'redis';
import { loadConfig } from './config';
import { ConfigurationError } from './errors';

/**
 * Cache interface for temporal query results
 */
export interface CacheManager {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, expirationMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  isConnected(): boolean;
  invalidateByPatterns(patterns: string[]): Promise<void>;
  getMetrics(): CacheMetrics;
  resetMetrics(): void;
}

/**
 * Cache performance metrics
 */
export interface CacheMetrics {
  hits: number;
  misses: number;
  hitRate: number;
  averageResponseTime: number;
  totalOperations: number;
}

/**
 * Redis-based cache implementation with performance monitoring
 */
export class RedisCache implements CacheManager {
  private client: RedisClientType;
  private connected: boolean = false;
  private config = loadConfig();
  private metrics: CacheMetrics = {
    hits: 0,
    misses: 0,
    hitRate: 0,
    averageResponseTime: 0,
    totalOperations: 0
  };
  private responseTimes: number[] = [];

  constructor() {
    this.client = createClient({
      socket: {
        host: this.config.database.redis.host,
        port: this.config.database.redis.port,
      },
      password: this.config.database.redis.password,
    });

    this.client.on('error', (err) => {
      console.error('Redis Client Error:', err);
      this.connected = false;
    });

    this.client.on('connect', () => {
      console.log('Redis Client Connected');
      this.connected = true;
    });

    this.client.on('disconnect', () => {
      console.log('Redis Client Disconnected');
      this.connected = false;
    });
  }

  /**
   * Connect to Redis
   */
  async connect(): Promise<void> {
    try {
      await this.client.connect();
      this.connected = true;
    } catch (error) {
      throw new ConfigurationError('Failed to connect to Redis', 'redis', error as Error);
    }
  }

  /**
   * Get value from cache with performance tracking
   */
  async get<T>(key: string): Promise<T | null> {
    const startTime = Date.now();
    
    if (!this.connected) {
      this.updateMetrics(startTime, false);
      return null;
    }

    try {
      const value = await this.client.get(key);
      const result = value ? JSON.parse(value) : null;
      
      this.updateMetrics(startTime, result !== null);
      return result;
    } catch (error) {
      console.error(`Cache get error for key ${key}:`, error);
      this.updateMetrics(startTime, false);
      return null;
    }
  }

  /**
   * Set value in cache
   */
  async set<T>(key: string, value: T, expirationMs?: number): Promise<void> {
    if (!this.connected) {
      return;
    }

    try {
      const serializedValue = JSON.stringify(value);
      const expiration = expirationMs || this.config.performance.cacheExpirationMs;
      
      await this.client.setEx(key, Math.floor(expiration / 1000), serializedValue);
    } catch (error) {
      console.error(`Cache set error for key ${key}:`, error);
    }
  }

  /**
   * Delete value from cache
   */
  async delete(key: string): Promise<void> {
    if (!this.connected) {
      return;
    }

    try {
      await this.client.del(key);
    } catch (error) {
      console.error(`Cache delete error for key ${key}:`, error);
    }
  }

  /**
   * Clear all cache
   */
  async clear(): Promise<void> {
    if (!this.connected) {
      return;
    }

    try {
      await this.client.flushAll();
    } catch (error) {
      console.error('Cache clear error:', error);
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Invalidate cache keys matching patterns
   */
  async invalidateByPatterns(patterns: string[]): Promise<void> {
    if (!this.connected) {
      return;
    }

    try {
      for (const pattern of patterns) {
        const keys = await this.client.keys(pattern);
        if (keys.length > 0) {
          await this.client.del(keys);
        }
      }
    } catch (error) {
      console.error('Cache invalidation error:', error);
    }
  }

  /**
   * Get cache performance metrics
   */
  getMetrics(): CacheMetrics {
    return { ...this.metrics };
  }

  /**
   * Reset cache metrics
   */
  resetMetrics(): void {
    this.metrics = {
      hits: 0,
      misses: 0,
      hitRate: 0,
      averageResponseTime: 0,
      totalOperations: 0
    };
    this.responseTimes = [];
  }

  /**
   * Update performance metrics
   */
  private updateMetrics(startTime: number, isHit: boolean): void {
    const responseTime = Date.now() - startTime;
    this.responseTimes.push(responseTime);
    
    // Keep only last 1000 response times for rolling average
    if (this.responseTimes.length > 1000) {
      this.responseTimes = this.responseTimes.slice(-1000);
    }

    this.metrics.totalOperations++;
    
    if (isHit) {
      this.metrics.hits++;
    } else {
      this.metrics.misses++;
    }

    this.metrics.hitRate = this.metrics.hits / this.metrics.totalOperations;
    this.metrics.averageResponseTime = this.responseTimes.reduce((sum, time) => sum + time, 0) / this.responseTimes.length;
  }

  /**
   * Disconnect from Redis
   */
  async disconnect(): Promise<void> {
    if (this.connected) {
      await this.client.disconnect();
      this.connected = false;
    }
  }
}

/**
 * In-memory cache implementation for development/testing
 */
export class MemoryCache implements CacheManager {
  private cache = new Map<string, { value: any; expiration: number }>();
  private config = loadConfig();
  private metrics: CacheMetrics = {
    hits: 0,
    misses: 0,
    hitRate: 0,
    averageResponseTime: 0,
    totalOperations: 0
  };
  private responseTimes: number[] = [];

  /**
   * Get value from cache with performance tracking
   */
  async get<T>(key: string): Promise<T | null> {
    const startTime = Date.now();
    const item = this.cache.get(key);
    
    if (!item) {
      this.updateMetrics(startTime, false);
      return null;
    }

    if (Date.now() > item.expiration) {
      this.cache.delete(key);
      this.updateMetrics(startTime, false);
      return null;
    }

    this.updateMetrics(startTime, true);
    return item.value;
  }

  /**
   * Set value in cache
   */
  async set<T>(key: string, value: T, expirationMs?: number): Promise<void> {
    const expiration = Date.now() + (expirationMs || this.config.performance.cacheExpirationMs);
    this.cache.set(key, { value, expiration });
  }

  /**
   * Delete value from cache
   */
  async delete(key: string): Promise<void> {
    this.cache.delete(key);
  }

  /**
   * Clear all cache
   */
  async clear(): Promise<void> {
    this.cache.clear();
  }

  /**
   * Invalidate cache keys matching patterns (simple glob matching for memory cache)
   */
  async invalidateByPatterns(patterns: string[]): Promise<void> {
    for (const pattern of patterns) {
      const regex = new RegExp(pattern.replace(/\*/g, '.*'));
      const keysToDelete: string[] = [];
      
      for (const key of this.cache.keys()) {
        if (regex.test(key)) {
          keysToDelete.push(key);
        }
      }
      
      keysToDelete.forEach(key => this.cache.delete(key));
    }
  }

  /**
   * Get cache performance metrics
   */
  getMetrics(): CacheMetrics {
    return { ...this.metrics };
  }

  /**
   * Reset cache metrics
   */
  resetMetrics(): void {
    this.metrics = {
      hits: 0,
      misses: 0,
      hitRate: 0,
      averageResponseTime: 0,
      totalOperations: 0
    };
    this.responseTimes = [];
  }

  /**
   * Check if connected (always true for memory cache)
   */
  isConnected(): boolean {
    return true;
  }

  /**
   * Update performance metrics
   */
  private updateMetrics(startTime: number, isHit: boolean): void {
    const responseTime = Date.now() - startTime;
    this.responseTimes.push(responseTime);
    
    // Keep only last 1000 response times for rolling average
    if (this.responseTimes.length > 1000) {
      this.responseTimes = this.responseTimes.slice(-1000);
    }

    this.metrics.totalOperations++;
    
    if (isHit) {
      this.metrics.hits++;
    } else {
      this.metrics.misses++;
    }

    this.metrics.hitRate = this.metrics.hits / this.metrics.totalOperations;
    this.metrics.averageResponseTime = this.responseTimes.reduce((sum, time) => sum + time, 0) / this.responseTimes.length;
  }
}

/**
 * Cache key generators for temporal and causal queries
 */
export class CacheKeyGenerator {
  /**
   * Generate cache key for events in time range
   */
  static eventsInRange(timeRange: { start: Date; end: Date }, limit?: number, offset?: number): string {
    const startTime = timeRange.start.toISOString();
    const endTime = timeRange.end.toISOString();
    return `events:range:${startTime}:${endTime}:${limit || 'all'}:${offset || 0}`;
  }

  /**
   * Generate cache key for overlapping arcs
   */
  static overlappingArcs(timeRange: { start: Date; end: Date }, limit?: number, offset?: number): string {
    const startTime = timeRange.start.toISOString();
    const endTime = timeRange.end.toISOString();
    return `arcs:overlap:${startTime}:${endTime}:${limit || 'all'}:${offset || 0}`;
  }

  /**
   * Generate cache key for events by actor and time range
   */
  static eventsByActorAndRange(actor: string, timeRange: { start: Date; end: Date }, limit?: number, offset?: number): string {
    const startTime = timeRange.start.toISOString();
    const endTime = timeRange.end.toISOString();
    return `events:actor:${actor}:range:${startTime}:${endTime}:${limit || 'all'}:${offset || 0}`;
  }

  /**
   * Generate cache key for arc hierarchy
   */
  static arcHierarchy(arcId: string, maxDepth?: number): string {
    return `arcs:hierarchy:${arcId}:${maxDepth || 'all'}`;
  }

  /**
   * Generate cache key for causal chains
   */
  static causalChain(eventId: string, maxDepth: number): string {
    return `causal:chain:${eventId}:${maxDepth}`;
  }

  /**
   * Generate cache key for causal cycles detection
   */
  static causalCycles(): string {
    return `causal:cycles:all`;
  }

  /**
   * Generate cache key for inference patterns
   */
  static inferencePatterns(timeRange: { start: Date; end: Date }, pressureType?: string): string {
    const startTime = timeRange.start.toISOString();
    const endTime = timeRange.end.toISOString();
    return `inference:patterns:${startTime}:${endTime}:${pressureType || 'all'}`;
  }

  /**
   * Generate cache key for event by ID
   */
  static eventById(eventId: string): string {
    return `event:id:${eventId}`;
  }

  /**
   * Generate cache key for arc by ID
   */
  static arcById(arcId: string): string {
    return `arc:id:${arcId}`;
  }

  /**
   * Generate cache key for pressure by ID
   */
  static pressureById(pressureId: string): string {
    return `pressure:id:${pressureId}`;
  }

  /**
   * Generate pattern for cache keys that should be invalidated when an event changes
   */
  static getEventInvalidationPatterns(eventId: string): string[] {
    return [
      `events:*`,
      `causal:*`,
      `inference:*`,
      `event:id:${eventId}`
    ];
  }

  /**
   * Generate pattern for cache keys that should be invalidated when an arc changes
   */
  static getArcInvalidationPatterns(arcId: string): string[] {
    return [
      `arcs:*`,
      `events:*`, // Arc changes might affect event queries
      `inference:*`,
      `arc:id:${arcId}`
    ];
  }

  /**
   * Generate pattern for cache keys that should be invalidated when causal relationships change
   */
  static getCausalInvalidationPatterns(): string[] {
    return [
      `causal:*`,
      `inference:*`
    ];
  }
}

// Singleton cache manager
let cacheManager: CacheManager | null = null;

/**
 * Get cache manager instance
 */
export function getCacheManager(): CacheManager {
  if (!cacheManager) {
    const config = loadConfig();
    
    // Use Redis in production, memory cache in development/testing
    if (config.nodeEnv === 'production') {
      cacheManager = new RedisCache();
    } else {
      cacheManager = new MemoryCache();
    }
  }

  return cacheManager;
}

/**
 * Initialize cache manager (for Redis connection)
 */
export async function initializeCache(): Promise<void> {
  const cache = getCacheManager();
  
  if (cache instanceof RedisCache) {
    await cache.connect();
  }
}

/**
 * Shutdown cache manager
 */
export async function shutdownCache(): Promise<void> {
  if (cacheManager instanceof RedisCache) {
    await cacheManager.disconnect();
  }
  cacheManager = null;
}