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
 * Local cache store implementation with enhanced local execution features
 * Provides Redis-compatible interface with file persistence and advanced cleanup
 */
export class LocalCacheStore implements CacheManager {
  private cache = new Map<string, { value: any; expiration: number; accessTime: number }>();
  private config = loadConfig();
  private metrics: CacheMetrics = {
    hits: 0,
    misses: 0,
    hitRate: 0,
    averageResponseTime: 0,
    totalOperations: 0
  };
  private responseTimes: number[] = [];
  private persistenceTimer?: NodeJS.Timeout;
  private cleanupTimer?: NodeJS.Timeout;
  private memoryUsage: number = 0;
  private readonly maxMemoryBytes: number;

  constructor() {
    this.maxMemoryBytes = this.config.localExecution.maxMemoryUsage * 1024 * 1024; // Convert MB to bytes
    this.startPersistenceTimer();
    this.startCleanupTimer();
  }

  /**
   * Get value from cache with performance tracking and access time update
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
      this.updateMemoryUsage();
      this.updateMetrics(startTime, false);
      return null;
    }

    // Update access time for LRU tracking
    item.accessTime = Date.now();
    this.updateMetrics(startTime, true);
    return item.value;
  }

  /**
   * Set value in cache with memory management
   */
  async set<T>(key: string, value: T, expirationMs?: number): Promise<void> {
    const expiration = Date.now() + (expirationMs || this.config.performance.cacheExpirationMs);
    const item = { value, expiration, accessTime: Date.now() };
    
    // Check memory usage before adding
    const itemSize = this.estimateItemSize(key, item);
    if (this.memoryUsage + itemSize > this.maxMemoryBytes) {
      await this.evictLeastRecentlyUsed();
    }
    
    this.cache.set(key, item);
    this.updateMemoryUsage();
  }

  /**
   * Delete value from cache
   */
  async delete(key: string): Promise<void> {
    this.cache.delete(key);
    this.updateMemoryUsage();
  }

  /**
   * Clear all cache
   */
  async clear(): Promise<void> {
    this.cache.clear();
    this.memoryUsage = 0;
  }

  /**
   * Invalidate cache keys matching patterns with enhanced pattern matching
   */
  async invalidateByPatterns(patterns: string[]): Promise<void> {
    for (const pattern of patterns) {
      const regexPattern = '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
      const regex = new RegExp(regexPattern);
      const keysToDelete: string[] = [];
      
      for (const key of this.cache.keys()) {
        if (regex.test(key)) {
          keysToDelete.push(key);
        }
      }
      
      keysToDelete.forEach(key => this.cache.delete(key));
    }
    this.updateMemoryUsage();
  }

  /**
   * Get cache performance metrics with additional local execution metrics
   */
  getMetrics(): CacheMetrics & { memoryUsage: number; maxMemory: number; cacheSize: number } {
    return { 
      ...this.metrics,
      memoryUsage: this.memoryUsage,
      maxMemory: this.maxMemoryBytes,
      cacheSize: this.cache.size
    };
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
   * Check if connected (always true for local cache)
   */
  isConnected(): boolean {
    return true;
  }

  /**
   * Estimate memory size of cache item
   */
  private estimateItemSize(key: string, item: any): number {
    try {
      const serialized = JSON.stringify({ key, ...item });
      return Buffer.byteLength(serialized, 'utf8');
    } catch {
      // Fallback estimation
      return key.length * 2 + 1000; // Rough estimate
    }
  }

  /**
   * Update memory usage tracking
   */
  private updateMemoryUsage(): void {
    let totalSize = 0;
    for (const [key, item] of this.cache.entries()) {
      totalSize += this.estimateItemSize(key, item);
    }
    this.memoryUsage = totalSize;
  }

  /**
   * Evict least recently used items when memory limit is reached
   */
  private async evictLeastRecentlyUsed(): Promise<void> {
    const entries = Array.from(this.cache.entries());
    entries.sort((a, b) => a[1].accessTime - b[1].accessTime);
    
    // Remove oldest 25% of entries
    const toRemove = Math.ceil(entries.length * 0.25);
    for (let i = 0; i < toRemove && i < entries.length; i++) {
      this.cache.delete(entries[i][0]);
    }
    
    this.updateMemoryUsage();
  }

  /**
   * Start periodic persistence timer
   */
  private startPersistenceTimer(): void {
    if (this.persistenceTimer) {
      clearInterval(this.persistenceTimer);
    }
    
    this.persistenceTimer = setInterval(() => {
      this.persistCache().catch(console.error);
    }, this.config.localExecution.persistenceInterval);
  }

  /**
   * Start cleanup timer for expired entries
   */
  private startCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    
    // Run cleanup every minute
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredEntries();
    }, 60000);
  }

  /**
   * Clean up expired cache entries
   */
  private cleanupExpiredEntries(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];
    
    for (const [key, item] of this.cache.entries()) {
      if (now > item.expiration) {
        keysToDelete.push(key);
      }
    }
    
    keysToDelete.forEach(key => this.cache.delete(key));
    if (keysToDelete.length > 0) {
      this.updateMemoryUsage();
    }
  }

  /**
   * Persist cache data to file system
   */
  private async persistCache(): Promise<void> {
    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      
      const dataDir = this.config.localExecution.dataDirectory;
      const cacheFile = path.join(dataDir, 'cache.json');
      
      // Ensure data directory exists
      await fs.mkdir(dataDir, { recursive: true });
      
      // Convert cache to serializable format
      const cacheData = Array.from(this.cache.entries()).map(([key, item]) => ({
        key,
        value: item.value,
        expiration: item.expiration,
        accessTime: item.accessTime
      }));
      
      await fs.writeFile(cacheFile, JSON.stringify(cacheData, null, 2));
    } catch (error) {
      console.error('Failed to persist cache:', error);
    }
  }

  /**
   * Load cache data from file system
   */
  async loadCache(): Promise<void> {
    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      
      const dataDir = this.config.localExecution.dataDirectory;
      const cacheFile = path.join(dataDir, 'cache.json');
      
      const data = await fs.readFile(cacheFile, 'utf8');
      const cacheData = JSON.parse(data);
      
      // Restore cache entries, filtering out expired ones
      const now = Date.now();
      for (const item of cacheData) {
        if (now <= item.expiration) {
          this.cache.set(item.key, {
            value: item.value,
            expiration: item.expiration,
            accessTime: item.accessTime
          });
        }
      }
      
      this.updateMemoryUsage();
    } catch (error) {
      // File might not exist on first run, which is fine
      if ((error as any).code !== 'ENOENT') {
        console.error('Failed to load cache:', error);
      }
    }
  }

  /**
   * Shutdown cache and persist final state
   */
  async shutdown(): Promise<void> {
    if (this.persistenceTimer) {
      clearInterval(this.persistenceTimer);
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    
    await this.persistCache();
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
   * Write position for the responseTimes ring buffer. Once the buffer is full
   * we overwrite the oldest entry in place; slicing a 1000-element array on
   * every read (the previous approach) made each cached read O(n).
   */
  private responseTimesIndex = 0;

  /**
   * Whether every read records a response time. Defaults to true, which is the
   * production behaviour. Passing false skips the timing work entirely, which
   * is what makes the cost of metrics tracking measurable in
   * cache.performance.test.ts — without it, a "metrics disabled" run and a
   * "metrics enabled" run do identical work and any measured difference is
   * pure scheduler noise.
   */
  private readonly trackMetrics: boolean;

  constructor(options: { trackMetrics?: boolean } = {}) {
    this.trackMetrics = options.trackMetrics !== false;
  }

  /**
   * Get value from cache with performance tracking
   */
  async get<T>(key: string): Promise<T | null> {
    const track = this.trackMetrics;
    const startTime = track ? Date.now() : 0;
    const item = this.cache.get(key);

    if (!item) {
      if (track) this.updateMetrics(startTime, false);
      return null;
    }

    if (Date.now() > item.expiration) {
      this.cache.delete(key);
      if (track) this.updateMetrics(startTime, false);
      return null;
    }

    if (track) this.updateMetrics(startTime, true);
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
    // Average is computed on demand rather than maintained on every read: it
    // used to reduce over the whole buffer per read, which cost O(n) per
    // cached lookup.
    return {
      ...this.metrics,
      averageResponseTime: this.responseTimes.length === 0
        ? 0
        : this.responseTimes.reduce((sum, time) => sum + time, 0) / this.responseTimes.length
    };
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
    this.responseTimesIndex = 0;
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

    // Keep only the last 1000 response times for the rolling average, using a
    // ring buffer so a full buffer costs O(1) per write instead of allocating
    // and copying a fresh 1000-element array on every single read.
    if (this.responseTimes.length < 1000) {
      this.responseTimes.push(responseTime);
    } else {
      this.responseTimes[this.responseTimesIndex] = responseTime;
    }
    this.responseTimesIndex = (this.responseTimesIndex + 1) % 1000;

    this.metrics.totalOperations++;
    
    if (isHit) {
      this.metrics.hits++;
    } else {
      this.metrics.misses++;
    }

    this.metrics.hitRate = this.metrics.hits / this.metrics.totalOperations;
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
    
    // Use LocalCacheStore for local execution, Redis in production, memory cache in development/testing
    if (config.localExecution.enabled) {
      cacheManager = new LocalCacheStore();
    } else if (config.nodeEnv === 'production') {
      cacheManager = new RedisCache();
    } else {
      cacheManager = new MemoryCache();
    }
  }

  return cacheManager;
}

/**
 * Initialize cache manager (for Redis connection or local cache loading)
 */
export async function initializeCache(): Promise<void> {
  const cache = getCacheManager();
  
  if (cache instanceof RedisCache) {
    await cache.connect();
  } else if (cache instanceof LocalCacheStore) {
    await cache.loadCache();
  }
}

/**
 * Shutdown cache manager
 */
export async function shutdownCache(): Promise<void> {
  if (cacheManager instanceof RedisCache) {
    await cacheManager.disconnect();
  } else if (cacheManager instanceof LocalCacheStore) {
    await cacheManager.shutdown();
  }
  cacheManager = null;
}