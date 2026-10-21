/**
 * Tests for RateLimitService
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { RateLimitService, RateLimitServiceConfig } from './RateLimitService';
import { RateLimitConfig } from '../models/ApiKey';

describe('RateLimitService', () => {
  let rateLimitService: RateLimitService;
  let testDir: string;
  let config: RateLimitServiceConfig;
  const defaultRateLimit: RateLimitConfig = {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
    requestsPerDay: 10000,
    batchSizeLimit: 100,
    concurrentStreams: 5,
  };

  beforeEach(async () => {
    // Create a unique temp directory for each test
    testDir = path.join(os.tmpdir(), `rate-limit-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
    await fs.promises.mkdir(testDir, { recursive: true });

    config = {
      dataDir: testDir,
      persistenceIntervalMs: 60000, // Long interval to avoid interference
    };

    // Suppress console output during tests
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    rateLimitService = new RateLimitService(config);
    await rateLimitService.initialize();
  });

  afterEach(async () => {
    rateLimitService.stop();
    vi.restoreAllMocks();
    
    // Cleanup test directory
    try {
      await fs.promises.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('initialize', () => {
    it('should initialize and create rate-limits directory', async () => {
      const limitsDir = path.join(testDir, 'rate-limits');
      const stat = await fs.promises.stat(limitsDir);
      expect(stat.isDirectory()).toBe(true);
    });

    it('should not re-initialize if already initialized', async () => {
      await rateLimitService.initialize();
      // Should not throw
      await expect(rateLimitService.initialize()).resolves.not.toThrow();
    });
  });

  describe('checkLimit', () => {
    it('should allow request within limits', () => {
      const result = rateLimitService.checkLimit('key-1', defaultRateLimit);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(60); // requestsPerMinute
    });

    it('should deny request when minute limit exceeded', () => {
      const lowLimit: RateLimitConfig = {
        requestsPerMinute: 2,
        requestsPerHour: 100,
        requestsPerDay: 1000,
        batchSizeLimit: 100,
        concurrentStreams: 5,
      };

      // Record 2 requests
      rateLimitService.recordRequest('key-limit', lowLimit);
      rateLimitService.recordRequest('key-limit', lowLimit);

      // Third request should be denied
      const result = rateLimitService.checkLimit('key-limit', lowLimit);
      expect(result.allowed).toBe(false);
      expect(result.limit).toBe('2/minute');
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    it('should deny request when hour limit exceeded', () => {
      const lowLimit: RateLimitConfig = {
        requestsPerMinute: 100, // High minute limit
        requestsPerHour: 2,      // Low hour limit
        requestsPerDay: 1000,
        batchSizeLimit: 100,
        concurrentStreams: 5,
      };

      // Record 2 requests
      rateLimitService.recordRequest('key-hour', lowLimit);
      rateLimitService.recordRequest('key-hour', lowLimit);

      // Third request should be denied
      const result = rateLimitService.checkLimit('key-hour', lowLimit);
      expect(result.allowed).toBe(false);
      expect(result.limit).toBe('2/hour');
    });

    it('should deny request when day limit exceeded', () => {
      const lowLimit: RateLimitConfig = {
        requestsPerMinute: 100,
        requestsPerHour: 100,
        requestsPerDay: 2,
        batchSizeLimit: 100,
        concurrentStreams: 5,
      };

      // Record 2 requests
      rateLimitService.recordRequest('key-day', lowLimit);
      rateLimitService.recordRequest('key-day', lowLimit);

      // Third request should be denied
      const result = rateLimitService.checkLimit('key-day', lowLimit);
      expect(result.allowed).toBe(false);
      expect(result.limit).toBe('2/day');
    });
  });

  describe('recordRequest', () => {
    it('should record a request and return updated remaining', () => {
      const result1 = rateLimitService.recordRequest('key-record', defaultRateLimit);
      expect(result1.allowed).toBe(true);
      expect(result1.remaining).toBe(59); // 60 - 1

      const result2 = rateLimitService.recordRequest('key-record', defaultRateLimit);
      expect(result2.allowed).toBe(true);
      expect(result2.remaining).toBe(58); // 60 - 2
    });

    it('should not record when limit exceeded', () => {
      const lowLimit: RateLimitConfig = {
        requestsPerMinute: 1,
        requestsPerHour: 100,
        requestsPerDay: 1000,
        batchSizeLimit: 100,
        concurrentStreams: 5,
      };

      // First request succeeds
      const result1 = rateLimitService.recordRequest('key-norecord', lowLimit);
      expect(result1.allowed).toBe(true);

      // Second request fails
      const result2 = rateLimitService.recordRequest('key-norecord', lowLimit);
      expect(result2.allowed).toBe(false);
    });

    it('should track separate keys independently', () => {
      const lowLimit: RateLimitConfig = {
        requestsPerMinute: 2,
        requestsPerHour: 100,
        requestsPerDay: 1000,
        batchSizeLimit: 100,
        concurrentStreams: 5,
      };

      // Record 2 requests for key-a
      rateLimitService.recordRequest('key-a', lowLimit);
      rateLimitService.recordRequest('key-a', lowLimit);

      // key-a should be limited
      const resultA = rateLimitService.checkLimit('key-a', lowLimit);
      expect(resultA.allowed).toBe(false);

      // key-b should still be allowed
      const resultB = rateLimitService.checkLimit('key-b', lowLimit);
      expect(resultB.allowed).toBe(true);
    });
  });

  describe('getHeaders', () => {
    it('should return correct headers for allowed request', () => {
      const result = rateLimitService.recordRequest('key-headers', defaultRateLimit);
      const headers = rateLimitService.getHeaders(result);

      expect(headers['X-RateLimit-Limit']).toBe('60/minute');
      expect(headers['X-RateLimit-Remaining']).toBe('59');
      expect(headers['X-RateLimit-Reset']).toBeDefined();
      expect(headers['Retry-After']).toBeUndefined();
    });

    it('should include Retry-After for denied request', () => {
      const lowLimit: RateLimitConfig = {
        requestsPerMinute: 1,
        requestsPerHour: 100,
        requestsPerDay: 1000,
        batchSizeLimit: 100,
        concurrentStreams: 5,
      };

      rateLimitService.recordRequest('key-retry', lowLimit);
      const result = rateLimitService.recordRequest('key-retry', lowLimit);
      const headers = rateLimitService.getHeaders(result);

      expect(headers['Retry-After']).toBeDefined();
      expect(parseInt(headers['Retry-After']!)).toBeGreaterThan(0);
    });
  });

  describe('getState', () => {
    it('should return null for unknown key', () => {
      const state = rateLimitService.getState('unknown-key');
      expect(state).toBeNull();
    });

    it('should return current state for tracked key', () => {
      rateLimitService.recordRequest('key-state', defaultRateLimit);
      const state = rateLimitService.getState('key-state');

      expect(state).not.toBeNull();
      expect(state?.keyId).toBe('key-state');
      expect(state?.minute.count).toBe(1);
      expect(state?.hour.count).toBe(1);
      expect(state?.day.count).toBe(1);
    });

    it('should report zero for a window that has already reset', () => {
      rateLimitService.recordRequest('key-expired-window', defaultRateLimit);

      const state = rateLimitService.getState('key-expired-window');
      expect(state?.minute.count).toBe(1);

      // The minute window is over. The limiter clears it when the key makes
      // its next request, which may never come -- but the state must not keep
      // reporting the usage of a window that is long gone.
      const internalState = (rateLimitService as any).limits.get('key-expired-window');
      internalState.minute.resetAt = Date.now() - 1000;

      const afterExpiry = rateLimitService.getState('key-expired-window');
      expect(afterExpiry?.minute.count).toBe(0);
      // A window that is not running has no reset time.
      expect(afterExpiry?.minute.resetAt).toBeNull();
      expect(afterExpiry?.hour.count).toBe(1);
      expect(afterExpiry?.hour.resetAt).not.toBeNull();
    });
  });

  describe('resetLimits', () => {
    it('should reset limits for a key', () => {
      // Record some requests
      rateLimitService.recordRequest('key-reset', defaultRateLimit);
      rateLimitService.recordRequest('key-reset', defaultRateLimit);

      // Verify state exists
      expect(rateLimitService.getState('key-reset')).not.toBeNull();

      // Reset
      rateLimitService.resetLimits('key-reset');

      // State should be gone
      expect(rateLimitService.getState('key-reset')).toBeNull();
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      rateLimitService.recordRequest('key-stats-1', defaultRateLimit);
      rateLimitService.recordRequest('key-stats-1', defaultRateLimit);
      rateLimitService.recordRequest('key-stats-2', defaultRateLimit);

      const stats = rateLimitService.getStats();

      expect(stats.trackedKeys).toBe(2);
      expect(stats.activeKeys).toBe(2);
      expect(stats.totalRequestsMinute).toBe(3);
      expect(stats.totalRequestsHour).toBe(3);
      expect(stats.totalRequestsDay).toBe(3);
    });
  });

  describe('cleanup', () => {
    it('should remove expired entries', async () => {
      // Record a request
      rateLimitService.recordRequest('key-cleanup', defaultRateLimit);

      // Manually expire the state by modifying internal state
      const state = rateLimitService.getState('key-cleanup');
      expect(state).not.toBeNull();

      // Force expire all windows
      const now = Date.now();
      const internalState = (rateLimitService as any).limits.get('key-cleanup');
      internalState.minute.resetAt = now - 1000;
      internalState.hour.resetAt = now - 1000;
      internalState.day.resetAt = now - 1000;

      // Cleanup should remove it
      const cleaned = rateLimitService.cleanup();
      expect(cleaned).toBe(1);

      // State should be gone
      expect(rateLimitService.getState('key-cleanup')).toBeNull();
    });
  });

  describe('persistence', () => {
    it('should persist state to disk on stop', async () => {
      rateLimitService.recordRequest('key-persist', defaultRateLimit);

      // Stop service (triggers sync persist)
      rateLimitService.stop();

      // Check file exists
      const limitsFile = path.join(testDir, 'rate-limits', 'limits.json');
      const stat = await fs.promises.stat(limitsFile);
      expect(stat.isFile()).toBe(true);

      // Verify content
      const content = await fs.promises.readFile(limitsFile, 'utf8');
      const data = JSON.parse(content);
      expect(data.some((s: any) => s.keyId === 'key-persist')).toBe(true);
    });

    it('should load persisted state on init', async () => {
      // Record request and stop
      rateLimitService.recordRequest('key-load', defaultRateLimit);
      rateLimitService.stop();

      // Create new service instance
      const newService = new RateLimitService(config);
      await newService.initialize();

      // State should be loaded
      const state = newService.getState('key-load');
      expect(state).not.toBeNull();
      expect(state?.minute.count).toBe(1);

      newService.stop();
    });

    it('should not load fully expired state', async () => {
      // Record request and manually expire
      rateLimitService.recordRequest('key-expired', defaultRateLimit);
      
      const now = Date.now();
      const internalState = (rateLimitService as any).limits.get('key-expired');
      internalState.minute.resetAt = now - 1000;
      internalState.hour.resetAt = now - 1000;
      internalState.day.resetAt = now - 1000;
      
      rateLimitService.stop();

      // Create new service instance
      const newService = new RateLimitService(config);
      await newService.initialize();

      // Expired state should not be loaded
      const state = newService.getState('key-expired');
      expect(state).toBeNull();

      newService.stop();
    });
  });

  describe('window reset', () => {
    it('should reset window when expired', async () => {
      const lowLimit: RateLimitConfig = {
        requestsPerMinute: 2,
        requestsPerHour: 100,
        requestsPerDay: 1000,
        batchSizeLimit: 100,
        concurrentStreams: 5,
      };

      // Exhaust minute limit
      rateLimitService.recordRequest('key-window', lowLimit);
      rateLimitService.recordRequest('key-window', lowLimit);

      // Should be limited
      let result = rateLimitService.checkLimit('key-window', lowLimit);
      expect(result.allowed).toBe(false);

      // Manually expire the minute window
      const now = Date.now();
      const internalState = (rateLimitService as any).limits.get('key-window');
      internalState.minute.resetAt = now - 1000;

      // Should now be allowed (minute window reset)
      result = rateLimitService.recordRequest('key-window', lowLimit);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(1); // 2 - 1
    });
  });

  describe('limit warnings', () => {
    it('should log warning when approaching limit', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const lowLimit: RateLimitConfig = {
        requestsPerMinute: 5,
        requestsPerHour: 100,
        requestsPerDay: 1000,
        batchSizeLimit: 100,
        concurrentStreams: 5,
      };

      // Record 4 requests (80% of 5)
      for (let i = 0; i < 4; i++) {
        rateLimitService.recordRequest('key-warn', lowLimit);
      }

      // Should have logged warning
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('approaching minute limit')
      );
    });
  });
});
