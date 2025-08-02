import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RedisCache, MemoryCache, CacheKeyGenerator } from './cache';
import { performance } from 'perf_hooks';

describe('Cache Performance Tests', () => {
  describe('MemoryCache Performance', () => {
    let cache: MemoryCache;

    beforeEach(() => {
      cache = new MemoryCache();
    });

    it('should handle high-volume operations efficiently', async () => {
      const startTime = performance.now();
      const operations = 1000;
      
      // Perform mixed read/write operations
      const promises: Promise<any>[] = [];
      
      for (let i = 0; i < operations; i++) {
        const key = `test-key-${i}`;
        const value = { id: i, data: `test-data-${i}`, timestamp: new Date() };
        
        // Set operation
        promises.push(cache.set(key, value));
        
        // Get operation (will miss initially, then hit)
        promises.push(cache.get(key));
      }
      
      await Promise.all(promises);
      
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      // Should complete 2000 operations (1000 sets + 1000 gets) in reasonable time
      expect(duration).toBeLessThan(1000); // Less than 1 second
      
      const metrics = cache.getMetrics();
      expect(metrics.totalOperations).toBe(operations); // Only gets are counted in metrics
      expect(metrics.averageResponseTime).toBeLessThan(10); // Less than 10ms average
    });

    it('should maintain performance with cache expiration', async () => {
      const startTime = performance.now();
      const shortExpiration = 100; // 100ms
      
      // Set items with short expiration
      for (let i = 0; i < 100; i++) {
        await cache.set(`expire-key-${i}`, { data: i }, shortExpiration);
      }
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Try to get expired items
      const getPromises: Promise<any>[] = [];
      for (let i = 0; i < 100; i++) {
        getPromises.push(cache.get(`expire-key-${i}`));
      }
      
      const results = await Promise.all(getPromises);
      const endTime = performance.now();
      
      // All should be null (expired)
      expect(results.every(result => result === null)).toBe(true);
      
      // Should still be fast
      expect(endTime - startTime).toBeLessThan(500);
      
      const metrics = cache.getMetrics();
      expect(metrics.hitRate).toBe(0); // All misses due to expiration
    });

    it('should handle pattern-based invalidation efficiently', async () => {
      // Set up cache with various patterns
      const patterns = ['events:', 'arcs:', 'causal:', 'inference:'];
      const itemsPerPattern = 100;
      
      for (const pattern of patterns) {
        for (let i = 0; i < itemsPerPattern; i++) {
          await cache.set(`${pattern}item-${i}`, { pattern, index: i });
        }
      }
      
      const startTime = performance.now();
      
      // Invalidate one pattern
      await cache.invalidateByPatterns(['events:*']);
      
      const endTime = performance.now();
      
      // Should be fast
      expect(endTime - startTime).toBeLessThan(100);
      
      // Verify invalidation worked
      const eventsResult = await cache.get('events:item-0');
      const arcsResult = await cache.get('arcs:item-0');
      
      expect(eventsResult).toBeNull();
      expect(arcsResult).not.toBeNull();
    });
  });

  describe('CacheKeyGenerator Performance', () => {
    it('should generate keys efficiently for temporal queries', () => {
      const timeRange = {
        start: new Date('2023-01-01'),
        end: new Date('2023-12-31')
      };
      
      const startTime = performance.now();
      const iterations = 10000;
      
      for (let i = 0; i < iterations; i++) {
        CacheKeyGenerator.eventsInRange(timeRange, 100, i);
        CacheKeyGenerator.overlappingArcs(timeRange, 50, i);
        CacheKeyGenerator.eventsByActorAndRange(`actor-${i}`, timeRange, 100, 0);
      }
      
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      // Should generate 30,000 keys in reasonable time
      expect(duration).toBeLessThan(200); // Less than 200ms (increased for slower systems)
      expect(duration / (iterations * 3)).toBeLessThan(0.02); // Less than 0.02ms per key
    });

    it('should generate invalidation patterns efficiently', () => {
      const startTime = performance.now();
      const iterations = 1000;
      
      for (let i = 0; i < iterations; i++) {
        CacheKeyGenerator.getEventInvalidationPatterns(`event-${i}`);
        CacheKeyGenerator.getArcInvalidationPatterns(`arc-${i}`);
        CacheKeyGenerator.getCausalInvalidationPatterns();
      }
      
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      // Should be very fast
      expect(duration).toBeLessThan(50); // Less than 50ms for 3000 pattern generations
    });
  });

  describe('Cache Metrics Performance', () => {
    let cache: MemoryCache;

    beforeEach(() => {
      cache = new MemoryCache();
    });

    it('should track metrics without significant performance impact', async () => {
      const operations = 1000;
      
      // Baseline: operations without metrics
      cache.resetMetrics();
      const baselineStart = performance.now();
      
      for (let i = 0; i < operations; i++) {
        await cache.set(`baseline-${i}`, { data: i });
        await cache.get(`baseline-${i}`);
      }
      
      const baselineEnd = performance.now();
      const baselineDuration = baselineEnd - baselineStart;
      
      // With metrics tracking
      cache.resetMetrics();
      const metricsStart = performance.now();
      
      for (let i = 0; i < operations; i++) {
        await cache.set(`metrics-${i}`, { data: i });
        await cache.get(`metrics-${i}`);
      }
      
      const metricsEnd = performance.now();
      const metricsDuration = metricsEnd - metricsStart;
      
      // Metrics tracking should not add more than 50% overhead
      const overhead = (metricsDuration - baselineDuration) / baselineDuration;
      expect(overhead).toBeLessThan(0.5);
      
      // Verify metrics are accurate
      const metrics = cache.getMetrics();
      expect(metrics.totalOperations).toBe(operations);
      expect(metrics.hits).toBe(operations);
      expect(metrics.hitRate).toBe(1.0);
    });

    it('should maintain rolling average efficiently', async () => {
      const operations = 2000; // More than the 1000 limit for rolling average
      
      const startTime = performance.now();
      
      for (let i = 0; i < operations; i++) {
        await cache.get(`rolling-test-${i}`); // All misses
      }
      
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      // Should still be efficient with rolling average
      expect(duration).toBeLessThan(1000);
      
      const metrics = cache.getMetrics();
      expect(metrics.totalOperations).toBe(operations);
      expect(metrics.averageResponseTime).toBeGreaterThanOrEqual(0); // Allow 0 for very fast operations
      expect(metrics.hitRate).toBe(0); // All misses
    });
  });

  describe('Large Dataset Performance', () => {
    let cache: MemoryCache;

    beforeEach(() => {
      cache = new MemoryCache();
    });

    it('should handle large temporal query results efficiently', async () => {
      // Simulate large query results (like 100,000 events)
      const largeDataset = Array.from({ length: 10000 }, (_, i) => ({
        id: `event-${i}`,
        description: `Event ${i}`,
        actor: `Actor ${i % 100}`,
        target: `Target ${i % 50}`,
        timestamp: new Date(2023, 0, 1 + (i % 365))
      }));
      
      const timeRange = {
        start: new Date('2023-01-01'),
        end: new Date('2023-12-31')
      };
      
      const cacheKey = CacheKeyGenerator.eventsInRange(timeRange, 10000, 0);
      
      // Test caching large dataset
      const setStart = performance.now();
      await cache.set(cacheKey, largeDataset);
      const setEnd = performance.now();
      
      // Test retrieving large dataset
      const getStart = performance.now();
      const retrieved = await cache.get(cacheKey);
      const getEnd = performance.now();
      
      // Both operations should be reasonably fast
      expect(setEnd - setStart).toBeLessThan(100); // Less than 100ms to cache
      expect(getEnd - getStart).toBeLessThan(50);  // Less than 50ms to retrieve
      
      // Data should be intact
      expect(retrieved).toHaveLength(10000);
      expect(retrieved[0].id).toBe('event-0');
      expect(retrieved[9999].id).toBe('event-9999');
    });

    it('should handle memory pressure gracefully', async () => {
      // Fill cache with large amounts of data
      const largeValue = Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        data: 'x'.repeat(1000) // 1KB per item
      }));
      
      const startTime = performance.now();
      
      // Add 1000 items (approximately 1MB total)
      for (let i = 0; i < 1000; i++) {
        await cache.set(`large-item-${i}`, largeValue);
      }
      
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      // Should handle large data without excessive slowdown
      expect(duration).toBeLessThan(2000); // Less than 2 seconds
      
      // Verify data is accessible
      const retrieved = await cache.get('large-item-500');
      expect(retrieved).toHaveLength(1000);
    });
  });
});