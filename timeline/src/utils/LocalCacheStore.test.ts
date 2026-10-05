import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LocalCacheStore } from './cache';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('LocalCacheStore', () => {
  let cache: LocalCacheStore;
  const testDataDir = './test-cache-data';

  beforeEach(async () => {
    // Mock config to use test directory
    process.env.LOCAL_EXECUTION_ENABLED = 'true';
    process.env.LOCAL_DATA_DIR = testDataDir;
    process.env.LOCAL_MAX_MEMORY_MB = '64'; // 64MB minimum for testing
    process.env.LOCAL_PERSISTENCE_INTERVAL = '1000'; // 1 second for testing
    
    cache = new LocalCacheStore();
    
    // Ensure test directory exists
    try {
      await fs.mkdir(testDataDir, { recursive: true });
    } catch (error) {
      // Directory might already exist
    }
  });

  afterEach(async () => {
    await cache.shutdown();
    
    // Clean up test directory
    try {
      await fs.rmdir(testDataDir, { recursive: true });
    } catch (error) {
      // Directory might not exist or be empty
    }
  });

  describe('Basic Cache Operations', () => {
    it('should set and get values correctly', async () => {
      const key = 'test-key';
      const value = { id: 1, data: 'test-data' };

      await cache.set(key, value);
      const retrieved = await cache.get(key);

      expect(retrieved).toEqual(value);
    });

    it('should return null for non-existent keys', async () => {
      const result = await cache.get('non-existent-key');
      expect(result).toBeNull();
    });

    it('should handle expiration correctly', async () => {
      const key = 'expire-test';
      const value = { data: 'expires-soon' };
      const shortExpiration = 100; // 100ms

      await cache.set(key, value, shortExpiration);
      
      // Should be available immediately
      let retrieved = await cache.get(key);
      expect(retrieved).toEqual(value);

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 150));

      // Should be expired
      retrieved = await cache.get(key);
      expect(retrieved).toBeNull();
    });

    it('should delete values correctly', async () => {
      const key = 'delete-test';
      const value = { data: 'to-be-deleted' };

      await cache.set(key, value);
      expect(await cache.get(key)).toEqual(value);

      await cache.delete(key);
      expect(await cache.get(key)).toBeNull();
    });

    it('should clear all cache', async () => {
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');

      expect(await cache.get('key1')).toBe('value1');
      expect(await cache.get('key2')).toBe('value2');

      await cache.clear();

      expect(await cache.get('key1')).toBeNull();
      expect(await cache.get('key2')).toBeNull();
    });
  });

  describe('Pattern-based Invalidation', () => {
    it('should invalidate keys matching patterns', async () => {
      await cache.set('events:test1', 'value1');
      await cache.set('events:test2', 'value2');
      await cache.set('arcs:test1', 'value3');
      await cache.set('other:test', 'value4');

      await cache.invalidateByPatterns(['events:*']);

      expect(await cache.get('events:test1')).toBeNull();
      expect(await cache.get('events:test2')).toBeNull();
      expect(await cache.get('arcs:test1')).toBe('value3');
      expect(await cache.get('other:test')).toBe('value4');
    });

    it('should handle multiple patterns', async () => {
      await cache.set('events:test', 'value1');
      await cache.set('arcs:test', 'value2');
      await cache.set('causal:test', 'value3');
      await cache.set('other:test', 'value4');

      await cache.invalidateByPatterns(['events:*', 'arcs:*']);

      expect(await cache.get('events:test')).toBeNull();
      expect(await cache.get('arcs:test')).toBeNull();
      expect(await cache.get('causal:test')).toBe('value3');
      expect(await cache.get('other:test')).toBe('value4');
    });

    it('should handle question mark patterns', async () => {
      await cache.set('test1', 'value1');
      await cache.set('test2', 'value2');
      await cache.set('testAB', 'value3');

      await cache.invalidateByPatterns(['test?']);

      expect(await cache.get('test1')).toBeNull();
      expect(await cache.get('test2')).toBeNull();
      expect(await cache.get('testAB')).toBe('value3');
    });
  });

  describe('Memory Management', () => {
    it('should track memory usage', async () => {
      const initialMetrics = cache.getMetrics();
      expect(initialMetrics.memoryUsage).toBe(0);
      expect(initialMetrics.cacheSize).toBe(0);

      await cache.set('test-key', { data: 'test-data' });

      const afterSetMetrics = cache.getMetrics();
      expect(afterSetMetrics.memoryUsage).toBeGreaterThan(0);
      expect(afterSetMetrics.cacheSize).toBe(1);
    });

    it('should evict least recently used items when memory limit is reached', async () => {
      // Create large data to exceed 64MB memory limit
      // Each item is ~1MB (1024 * 1024 bytes)
      const largeData = 'x'.repeat(1024 * 1024);
      const itemCount = 70; // 70 MB of data to exceed 64MB limit

      // Fill cache - this should trigger eviction after exceeding memory limit
      for (let i = 0; i < itemCount; i++) {
        await cache.set(`item-${i}`, { id: i, data: largeData });
      }

      // Access some items to make them more recently used
      for (let i = itemCount - 10; i < itemCount; i++) {
        await cache.get(`item-${i}`);
      }

      // Get metrics to check memory usage
      const metrics = cache.getMetrics();

      // Memory should be around or below limit due to eviction
      // Allow some tolerance as eviction happens when adding new items
      expect(metrics.cacheSize).toBeLessThan(itemCount);
    });

    it('should update access times on get operations', async () => {
      await cache.set('access-test', { data: 'test' });
      
      // Access the item multiple times
      await cache.get('access-test');
      await new Promise(resolve => setTimeout(resolve, 10));
      await cache.get('access-test');
      
      // Item should still be accessible (access time updated)
      expect(await cache.get('access-test')).not.toBeNull();
    });
  });

  describe('Persistence', () => {
    it('should persist cache data to file', async () => {
      await cache.set('persist-key1', { data: 'persist-value1' });
      await cache.set('persist-key2', { data: 'persist-value2' });

      // Manually trigger persistence (normally done by timer)
      await cache.shutdown();

      // Check that cache file was created
      const cacheFile = path.join(testDataDir, 'cache.json');
      const fileExists = await fs.access(cacheFile).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);

      // Verify file contents
      const fileContent = await fs.readFile(cacheFile, 'utf8');
      const data = JSON.parse(fileContent);
      expect(data).toHaveLength(2);
      expect(data.some((item: any) => item.key === 'persist-key1')).toBe(true);
      expect(data.some((item: any) => item.key === 'persist-key2')).toBe(true);
    });

    it('should load cache data from file', async () => {
      // First, create and persist some data
      await cache.set('load-key1', { data: 'load-value1' });
      await cache.set('load-key2', { data: 'load-value2' });
      await cache.shutdown();

      // Create new cache instance and load data
      const newCache = new LocalCacheStore();
      await newCache.loadCache();

      // Data should be restored
      expect(await newCache.get('load-key1')).toEqual({ data: 'load-value1' });
      expect(await newCache.get('load-key2')).toEqual({ data: 'load-value2' });

      await newCache.shutdown();
    });

    it('should filter out expired entries when loading', async () => {
      const shortExpiration = 100; // 100ms
      
      await cache.set('expired-key', { data: 'will-expire' }, shortExpiration);
      await cache.set('valid-key', { data: 'will-persist' });

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 150));
      
      await cache.shutdown();

      // Create new cache and load
      const newCache = new LocalCacheStore();
      await newCache.loadCache();

      // Expired entry should not be loaded
      expect(await newCache.get('expired-key')).toBeNull();
      expect(await newCache.get('valid-key')).toEqual({ data: 'will-persist' });

      await newCache.shutdown();
    });

    it('should handle missing cache file gracefully', async () => {
      const newCache = new LocalCacheStore();
      
      // Should not throw error when cache file doesn't exist
      await expect(newCache.loadCache()).resolves.not.toThrow();
      
      // Cache should be empty
      expect(await newCache.get('any-key')).toBeNull();

      await newCache.shutdown();
    });
  });

  describe('Cleanup and Timers', () => {
    it('should clean up expired entries automatically', async () => {
      const shortExpiration = 50; // 50ms
      
      await cache.set('cleanup-test', { data: 'expires' }, shortExpiration);
      
      // Should be available initially
      expect(await cache.get('cleanup-test')).not.toBeNull();

      // Wait for expiration and cleanup
      await new Promise(resolve => setTimeout(resolve, 200));

      // Item should be cleaned up (accessing should return null)
      expect(await cache.get('cleanup-test')).toBeNull();
    });

    it('should stop timers when shutdown', async () => {
      // Add some data
      await cache.set('timer-test', { data: 'test' });
      
      // Shutdown should stop timers and persist data
      await expect(cache.shutdown()).resolves.not.toThrow();
      
      // Verify data was persisted
      const cacheFile = path.join(testDataDir, 'cache.json');
      const fileExists = await fs.access(cacheFile).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);
    });
  });

  describe('Performance Metrics', () => {
    it('should track cache hits and misses', async () => {
      cache.resetMetrics();

      // Miss
      await cache.get('non-existent');
      
      // Set and hit
      await cache.set('hit-test', { data: 'test' });
      await cache.get('hit-test');

      // Another miss
      await cache.get('another-non-existent');

      const metrics = cache.getMetrics();
      expect(metrics.hits).toBe(1);
      expect(metrics.misses).toBe(2);
      expect(metrics.totalOperations).toBe(3);
      expect(metrics.hitRate).toBeCloseTo(1/3, 2);
    });

    it('should track average response time', async () => {
      cache.resetMetrics();

      await cache.set('response-time-test', { data: 'test' });
      await cache.get('response-time-test');

      const metrics = cache.getMetrics();
      expect(metrics.averageResponseTime).toBeGreaterThanOrEqual(0);
      expect(metrics.totalOperations).toBe(1);
    });

    it('should maintain rolling average for response times', async () => {
      cache.resetMetrics();

      // Perform many operations to test rolling average
      for (let i = 0; i < 50; i++) {
        await cache.set(`rolling-${i}`, { data: i });
        await cache.get(`rolling-${i}`);
      }

      const metrics = cache.getMetrics();
      expect(metrics.totalOperations).toBe(50);
      expect(metrics.averageResponseTime).toBeGreaterThanOrEqual(0);
    });

    it('should reset metrics correctly', async () => {
      await cache.set('reset-test', { data: 'test' });
      await cache.get('reset-test');

      let metrics = cache.getMetrics();
      expect(metrics.totalOperations).toBeGreaterThan(0);

      cache.resetMetrics();
      metrics = cache.getMetrics();
      
      expect(metrics.hits).toBe(0);
      expect(metrics.misses).toBe(0);
      expect(metrics.totalOperations).toBe(0);
      expect(metrics.hitRate).toBe(0);
      expect(metrics.averageResponseTime).toBe(0);
    });
  });

  describe('Connection Status', () => {
    it('should always report as connected', async () => {
      expect(cache.isConnected()).toBe(true);
      
      await cache.set('connection-test', { data: 'test' });
      expect(cache.isConnected()).toBe(true);
      
      await cache.shutdown();
      expect(cache.isConnected()).toBe(true); // Local cache is always "connected"
    });
  });
});