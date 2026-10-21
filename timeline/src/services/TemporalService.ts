import { Event, Arc, TimeRange } from '@/models';
import { TemporalConstraintError, PerformanceError } from '@/utils/errors';
import { EventRepository } from '@/repositories/EventRepository';
import { ArcRepository } from '@/repositories/ArcRepository';
import { getCacheManager, CacheKeyGenerator } from '@/utils/cache';
import { getDatabaseManager } from '@/utils/database';
import { loadConfig } from '@/utils/config';
import { isTemporalInversion } from '@/utils/causalOrder';

/**
 * Service for handling temporal operations and constraint enforcement
 */
export class TemporalService {
  private eventRepository: EventRepository;
  private arcRepository: ArcRepository;
  private cacheManager = getCacheManager();
  private config = loadConfig();

  constructor(eventRepository?: EventRepository, arcRepository?: ArcRepository) {
    // Repositories require a database manager. Only reach for the singleton when
    // the caller did not inject a repository, so constructing the service with
    // both repositories never touches the database.
    this.eventRepository =
      eventRepository || new EventRepository(getDatabaseManager());
    this.arcRepository =
      arcRepository || new ArcRepository(getDatabaseManager());
  }
  /**
   * Validate that an event falls within an arc's temporal boundaries
   */
  validateEventInArc(event: Event, arc: Arc): boolean {
    const eventTime = event.timestamp.getTime();
    const arcStart = arc.start_time.getTime();
    const arcEnd = arc.end_time.getTime();

    if (eventTime < arcStart || eventTime > arcEnd) {
      throw new TemporalConstraintError(
        `Event ${event.id} at ${event.timestamp} falls outside arc ${arc.id} bounds`,
        event.id,
        arc.id,
        event.timestamp,
        { start: arc.start_time, end: arc.end_time }
      );
    }

    return true;
  }

  /**
   * Validate that a child arc is completely contained within a parent arc
   */
  validateArcNesting(parentArc: Arc, childArc: Arc): boolean {
    const parentStart = parentArc.start_time.getTime();
    const parentEnd = parentArc.end_time.getTime();
    const childStart = childArc.start_time.getTime();
    const childEnd = childArc.end_time.getTime();

    if (childStart < parentStart || childEnd > parentEnd) {
      throw new TemporalConstraintError(
        `Child arc ${childArc.id} extends beyond parent arc ${parentArc.id} boundaries`,
        undefined,
        childArc.id,
        undefined,
        { start: parentArc.start_time, end: parentArc.end_time }
      );
    }

    return true;
  }

  /**
   * Find arcs that overlap with a given time range with caching and performance monitoring
   */
  async findOverlappingArcs(timeRange: TimeRange, limit?: number, offset?: number): Promise<Arc[]> {
    const startTime = Date.now();
    const cacheKey = CacheKeyGenerator.overlappingArcs(timeRange, limit, offset);

    try {
      // Try to get from cache first
      const cachedResult = await this.cacheManager.get<Arc[]>(cacheKey);
      if (cachedResult) {
        return cachedResult.map(arcData => new Arc(arcData));
      }

      // Query database with performance monitoring
      const arcs = await this.arcRepository.findOverlappingArcs(timeRange, limit, offset);
      
      // Check performance constraint
      const duration = Date.now() - startTime;
      if (duration > this.config.performance.queryTimeoutMs) {
        throw new PerformanceError(
          `Query exceeded timeout threshold: ${duration}ms > ${this.config.performance.queryTimeoutMs}ms`,
          'findOverlappingArcs',
          duration,
          this.config.performance.queryTimeoutMs
        );
      }

      // Cache the result
      await this.cacheManager.set(cacheKey, arcs.map(arc => arc.toJSON()));

      return arcs;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      if (error instanceof PerformanceError) {
        throw error;
      }
      
      throw new Error(`Failed to find overlapping arcs (${duration}ms): ${error}`);
    }
  }

  /**
   * Find events within a specific time range with pagination and performance monitoring
   */
  async findEventsInRange(timeRange: TimeRange, limit?: number, offset?: number): Promise<Event[]> {
    const startTime = Date.now();
    const cacheKey = CacheKeyGenerator.eventsInRange(timeRange, limit, offset);

    try {
      // Try to get from cache first
      const cachedResult = await this.cacheManager.get<Event[]>(cacheKey);
      if (cachedResult) {
        return cachedResult.map(eventData => new Event(eventData));
      }

      // Apply default pagination to prevent excessive results
      const effectiveLimit = limit || Math.min(this.config.performance.maxQueryResults, 1000);
      const effectiveOffset = offset || 0;

      // Query database with performance monitoring
      const events = await this.eventRepository.findByTimeRange(timeRange, effectiveLimit, effectiveOffset);
      
      // Check performance constraint
      const duration = Date.now() - startTime;
      if (duration > this.config.performance.queryTimeoutMs) {
        throw new PerformanceError(
          `Query exceeded timeout threshold: ${duration}ms > ${this.config.performance.queryTimeoutMs}ms`,
          'findEventsInRange',
          duration,
          this.config.performance.queryTimeoutMs
        );
      }

      // Cache the result
      await this.cacheManager.set(cacheKey, events.map(event => event.toJSON()));

      return events;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      if (error instanceof PerformanceError) {
        throw error;
      }
      
      throw new Error(`Failed to find events in range (${duration}ms): ${error}`);
    }
  }

  /**
   * Find events by actor within a time range with caching
   */
  async findEventsByActorAndRange(actor: string, timeRange: TimeRange, limit?: number, offset?: number): Promise<Event[]> {
    const startTime = Date.now();
    const cacheKey = CacheKeyGenerator.eventsByActorAndRange(actor, timeRange, limit, offset);

    try {
      // Try to get from cache first
      const cachedResult = await this.cacheManager.get<Event[]>(cacheKey);
      if (cachedResult) {
        return cachedResult.map(eventData => new Event(eventData));
      }

      // Apply default pagination
      const effectiveLimit = limit || Math.min(this.config.performance.maxQueryResults, 1000);
      const effectiveOffset = offset || 0;

      // Query database
      const events = await this.eventRepository.findByActorAndTimeRange(actor, timeRange, effectiveLimit, effectiveOffset);
      
      // Check performance constraint
      const duration = Date.now() - startTime;
      if (duration > this.config.performance.queryTimeoutMs) {
        throw new PerformanceError(
          `Query exceeded timeout threshold: ${duration}ms > ${this.config.performance.queryTimeoutMs}ms`,
          'findEventsByActorAndRange',
          duration,
          this.config.performance.queryTimeoutMs
        );
      }

      // Cache the result
      await this.cacheManager.set(cacheKey, events.map(event => event.toJSON()));

      return events;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      if (error instanceof PerformanceError) {
        throw error;
      }
      
      throw new Error(`Failed to find events by actor and range (${duration}ms): ${error}`);
    }
  }

  /**
   * Clear cache for temporal queries (useful after data modifications)
   */
  async clearTemporalCache(): Promise<void> {
    try {
      await this.cacheManager.clear();
    } catch (error) {
      console.error('Failed to clear temporal cache:', error);
    }
  }

  /**
   * Get performance metrics for the last query
   */
  getPerformanceThreshold(): number {
    return this.config.performance.queryTimeoutMs;
  }

  /**
   * Prevent temporal paradoxes in causal relationships.
   *
   * A cause at the same moment as its effect is allowed; only a cause that
   * follows its effect is a paradox. The rule lives in
   * `@/utils/causalOrder`, which every other path uses too.
   */
  preventTemporalParadox(cause: Event, effect: Event): boolean {
    if (isTemporalInversion(cause.timestamp, effect.timestamp)) {
      throw new TemporalConstraintError(
        `Temporal paradox: cause event ${cause.id} occurs after effect event ${effect.id}`,
        cause.id,
        effect.id,
        cause.timestamp,
        { start: effect.timestamp, end: effect.timestamp }
      );
    }

    return true;
  }
}