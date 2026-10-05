import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryCache, CacheKeyGenerator } from './cache';
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
      // 1000 operations measured only ~0.5ms of CPU, which is small enough that
      // the ratio of baseline to tracked is dominated by timer noise. Size the
      // workload so both sides are measured well clear of that floor.
      const operations = 20000;
      const rounds = 3;

      // MemoryCache is an in-memory Map, so this workload is CPU-bound and the
      // meaningful cost is CPU time, not wall-clock. Wall-clock additionally
      // counts time the process spends descheduled, so a busy machine (or
      // running the backend and frontend suites concurrently) inflates the
      // ratio without any real slowdown. process.cpuUsage() counts only work
      // actually performed.
      const runLoop = async (target: MemoryCache): Promise<number> => {
        const cpuStart = process.cpuUsage();
        for (let i = 0; i < operations; i++) {
          await target.set(`key-${i}`, { data: i });
          await target.get(`key-${i}`);
        }
        const cpuEnd = process.cpuUsage(cpuStart);
        return (cpuEnd.user + cpuEnd.system) / 1e6; // seconds
      };

      // Two independent caches: identical in every way except whether reads
      // record a response time.
      const withoutMetrics = new MemoryCache({ trackMetrics: false });
      const withMetrics = new MemoryCache({ trackMetrics: true });

      // Warm up both paths so V8 has optimised them before we measure.
      await runLoop(withoutMetrics);
      await runLoop(withMetrics);

      // Discard the warm-up so the counters below reflect the measured rounds.
      withoutMetrics.resetMetrics();
      withMetrics.resetMetrics();

      // Interleave the two variants and take the minimum of each. Interleaving
      // keeps heap growth comparable between them, and a fresh cache per round
      // stops the Map and the responseTimes array from growing across rounds.
      // Noise can only ever make a measurement slower, so the minimum is the
      // least-contaminated estimate of the true cost.
      let baselineDuration = Infinity;
      let metricsDuration = Infinity;

      for (let round = 0; round < rounds; round++) {
        await withoutMetrics.clear();
        await withMetrics.clear();

        const baseline = await runLoop(withoutMetrics);
        await withoutMetrics.clear();
        await withMetrics.clear();
        const tracked = await runLoop(withMetrics);

        baselineDuration = Math.min(baselineDuration, baseline);
        metricsDuration = Math.min(metricsDuration, tracked);
      }

      // Regression guard, not a precise benchmark.
      //
      // Measured overhead on an idle machine is ~0.13 (median), and ~0.25 at
      // worst; under heavy CPU contention the ratio scatters up to ~1.1 in
      // either direction. The previous bound of 1.0 therefore failed roughly
      // 1 run in 10 on a loaded CI box, purely from scheduling noise.
      //
      // 3.0 is still ~20x the measured median, and it still catches the
      // regression this guard exists for: the previous implementation copied a
      // 1000-element array on every read and measured 22.4, so reintroducing
      // any O(n)-per-read behaviour still fails loudly.
      const overhead = (metricsDuration - baselineDuration) / baselineDuration;
      expect(overhead).toBeLessThan(3.0);

      // Verify metrics are accurate on the tracking cache
      const metrics = withMetrics.getMetrics();
      expect(metrics.totalOperations).toBe(operations * rounds);
      expect(metrics.hits).toBe(operations * rounds);
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
      const retrieved = await cache.get<typeof largeDataset>(cacheKey);
      const getEnd = performance.now();
      
      // Both operations should be reasonably fast
      expect(setEnd - setStart).toBeLessThan(100); // Less than 100ms to cache
      expect(getEnd - getStart).toBeLessThan(50);  // Less than 50ms to retrieve
      
      // Data should be intact
      expect(retrieved).not.toBeNull();
      if (!retrieved) {
        throw new Error(`Expected the cached dataset for ${cacheKey} to be retrievable`);
      }
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