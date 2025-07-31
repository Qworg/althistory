import { getCacheManager, CacheKeyGenerator } from '@/utils/cache';
import { Event, Arc } from '@/models';
import { InferredPressure } from '@/models/InferredPressure';

/**
 * Service for managing cache invalidation when data changes
 */
export class CacheInvalidationService {
  private cacheManager = getCacheManager();

  /**
   * Invalidate cache when an event is created, updated, or deleted
   */
  async invalidateEventCache(event: Event): Promise<void> {
    const patterns = CacheKeyGenerator.getEventInvalidationPatterns(event.id);
    await this.cacheManager.invalidateByPatterns(patterns);
  }

  /**
   * Invalidate cache when an arc is created, updated, or deleted
   */
  async invalidateArcCache(arc: Arc): Promise<void> {
    const patterns = CacheKeyGenerator.getArcInvalidationPatterns(arc.id);
    await this.cacheManager.invalidateByPatterns(patterns);
  }

  /**
   * Invalidate cache when causal relationships change
   */
  async invalidateCausalCache(): Promise<void> {
    const patterns = CacheKeyGenerator.getCausalInvalidationPatterns();
    await this.cacheManager.invalidateByPatterns(patterns);
  }

  /**
   * Invalidate cache when inferred pressures change
   */
  async invalidateInferenceCache(pressure?: InferredPressure): Promise<void> {
    const patterns = ['inference:*'];
    if (pressure) {
      patterns.push(`pressure:id:${pressure.id}`);
    }
    await this.cacheManager.invalidateByPatterns(patterns);
  }

  /**
   * Invalidate all temporal-related cache entries
   */
  async invalidateTemporalCache(): Promise<void> {
    const patterns = [
      'events:*',
      'arcs:*',
      'causal:*',
      'inference:*'
    ];
    await this.cacheManager.invalidateByPatterns(patterns);
  }

  /**
   * Invalidate cache for specific time range (useful for bulk operations)
   */
  async invalidateTimeRangeCache(timeRange: { start: Date; end: Date }): Promise<void> {
    const startTime = timeRange.start.toISOString();
    const endTime = timeRange.end.toISOString();
    
    const patterns = [
      `events:range:${startTime}:${endTime}:*`,
      `arcs:overlap:${startTime}:${endTime}:*`,
      `events:actor:*:range:${startTime}:${endTime}:*`,
      `inference:patterns:${startTime}:${endTime}:*`
    ];
    
    await this.cacheManager.invalidateByPatterns(patterns);
  }

  /**
   * Get cache performance metrics
   */
  getCacheMetrics() {
    return this.cacheManager.getMetrics();
  }

  /**
   * Reset cache performance metrics
   */
  resetCacheMetrics(): void {
    this.cacheManager.resetMetrics();
  }

  /**
   * Check if cache is connected and healthy
   */
  isCacheHealthy(): boolean {
    return this.cacheManager.isConnected();
  }
}