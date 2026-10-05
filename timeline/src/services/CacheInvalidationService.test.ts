import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CacheInvalidationService } from './CacheInvalidationService';
import { Event, Arc } from '@/models';
import { InferredPressure } from '@/models/InferredPressure';

// Create mock functions
const mockInvalidateByPatterns = vi.fn();
const mockGetMetrics = vi.fn(() => ({
  hits: 10,
  misses: 5,
  hitRate: 0.67,
  averageResponseTime: 15,
  totalOperations: 15
}));
const mockResetMetrics = vi.fn();
const mockIsConnected = vi.fn(() => true);

// Mock the cache manager
vi.mock('@/utils/cache', () => ({
  getCacheManager: vi.fn(() => ({
    invalidateByPatterns: mockInvalidateByPatterns,
    getMetrics: mockGetMetrics,
    resetMetrics: mockResetMetrics,
    isConnected: mockIsConnected
  })),
  CacheKeyGenerator: {
    getEventInvalidationPatterns: vi.fn(() => ['events:*', 'causal:*', 'inference:*', 'event:id:test-event']),
    getArcInvalidationPatterns: vi.fn(() => ['arcs:*', 'events:*', 'inference:*', 'arc:id:test-arc']),
    getCausalInvalidationPatterns: vi.fn(() => ['causal:*', 'inference:*'])
  }
}));

describe('CacheInvalidationService', () => {
  let service: CacheInvalidationService;

  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();
    service = new CacheInvalidationService();
  });

  describe('invalidateEventCache', () => {
    it('should invalidate event-related cache patterns', async () => {
      const event = new Event({
        id: 'test-event',
        description: 'Test event',
        actor: 'Test Actor',
        target: 'Test Target',
        timestamp: new Date()
      });

      await service.invalidateEventCache(event);

      expect(mockInvalidateByPatterns).toHaveBeenCalledWith([
        'events:*',
        'causal:*',
        'inference:*',
        'event:id:test-event'
      ]);
    });
  });

  describe('invalidateArcCache', () => {
    it('should invalidate arc-related cache patterns', async () => {
      const arc = new Arc({
        id: 'test-arc',
        name: 'Test Arc',
        start_time: new Date('2023-01-01'),
        end_time: new Date('2023-12-31'),
        level: 1
      });

      await service.invalidateArcCache(arc);

      expect(mockInvalidateByPatterns).toHaveBeenCalledWith([
        'arcs:*',
        'events:*',
        'inference:*',
        'arc:id:test-arc'
      ]);
    });
  });

  describe('invalidateCausalCache', () => {
    it('should invalidate causal-related cache patterns', async () => {
      await service.invalidateCausalCache();

      expect(mockInvalidateByPatterns).toHaveBeenCalledWith([
        'causal:*',
        'inference:*'
      ]);
    });
  });

  describe('invalidateInferenceCache', () => {
    it('should invalidate inference cache patterns', async () => {
      await service.invalidateInferenceCache();

      expect(mockInvalidateByPatterns).toHaveBeenCalledWith([
        'inference:*'
      ]);
    });

    it('should invalidate specific pressure cache when pressure provided', async () => {
      const pressure = new InferredPressure({
        id: 'test-pressure',
        description: 'Test pressure',
        confidence_score: 0.8,
        pressure_type: 'economic',
        evidence: ['evidence1']
      });

      await service.invalidateInferenceCache(pressure);

      expect(mockInvalidateByPatterns).toHaveBeenCalledWith([
        'inference:*',
        'pressure:id:test-pressure'
      ]);
    });
  });

  describe('invalidateTemporalCache', () => {
    it('should invalidate all temporal cache patterns', async () => {
      await service.invalidateTemporalCache();

      expect(mockInvalidateByPatterns).toHaveBeenCalledWith([
        'events:*',
        'arcs:*',
        'causal:*',
        'inference:*'
      ]);
    });
  });

  describe('invalidateTimeRangeCache', () => {
    it('should invalidate time range specific cache patterns', async () => {
      const timeRange = {
        start: new Date('2023-01-01'),
        end: new Date('2023-12-31')
      };

      await service.invalidateTimeRangeCache(timeRange);

      const expectedPatterns = [
        'events:range:2023-01-01T00:00:00.000Z:2023-12-31T00:00:00.000Z:*',
        'arcs:overlap:2023-01-01T00:00:00.000Z:2023-12-31T00:00:00.000Z:*',
        'events:actor:*:range:2023-01-01T00:00:00.000Z:2023-12-31T00:00:00.000Z:*',
        'inference:patterns:2023-01-01T00:00:00.000Z:2023-12-31T00:00:00.000Z:*'
      ];

      expect(mockInvalidateByPatterns).toHaveBeenCalledWith(expectedPatterns);
    });
  });

  describe('getCacheMetrics', () => {
    it('should return cache performance metrics', () => {
      const metrics = service.getCacheMetrics();

      expect(metrics).toEqual({
        hits: 10,
        misses: 5,
        hitRate: 0.67,
        averageResponseTime: 15,
        totalOperations: 15
      });
    });
  });

  describe('resetCacheMetrics', () => {
    it('should reset cache performance metrics', () => {
      service.resetCacheMetrics();

      expect(mockResetMetrics).toHaveBeenCalled();
    });
  });

  describe('isCacheHealthy', () => {
    it('should return cache connection status', () => {
      const isHealthy = service.isCacheHealthy();

      expect(isHealthy).toBe(true);
      expect(mockIsConnected).toHaveBeenCalled();
    });
  });
});