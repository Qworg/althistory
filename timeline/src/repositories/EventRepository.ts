import { Session, Record as Neo4jRecord, Integer } from 'neo4j-driver';
import { Event, IEvent, CreateEventRequest, UpdateEventRequest, TimeRange } from '../models/Event';
import { DatabaseManager, LocalDatabaseManager, LocalSession } from '../utils/database';

type AnySession = Session | LocalSession;

/**
 * Repository for Event operations using Neo4j or LocalGraphStore
 */
export class EventRepository {
  protected databaseManager: DatabaseManager | LocalDatabaseManager;

  constructor(databaseManager: DatabaseManager | LocalDatabaseManager, validationService?: any, cacheService?: any) {
    this.databaseManager = databaseManager;
  }

  /**
   * Get a session from the database manager
   */
  protected getSession(): AnySession {
    return this.databaseManager.getNeo4jSession();
  }

  /**
   * Create a new event
   */
  async create(eventData: CreateEventRequest): Promise<Event> {
    const event = new Event(eventData);

    const query = `
      CREATE (e:Event {
        id: $id,
        description: $description,
        actor: $actor,
        target: $target,
        timestamp: datetime($timestamp),
        metadata: $metadata
      })
      RETURN e
    `;

    const parameters = {
      id: event.id,
      description: event.description,
      actor: event.actor,
      target: event.target,
      timestamp: event.timestamp.toISOString(),
      metadata: event.metadata || {}
    };

    const session = this.getSession();
    try {
      const result = await session.run(query, parameters);

      if (result.records.length === 0) {
        throw new Error('Failed to create event');
      }

      return event;
    } catch (error) {
      throw new Error(`Failed to create event: ${error}`);
    } finally {
      await session.close();
    }
  }

  /**
   * Find event by ID
   */
  async findById(id: string): Promise<Event | null> {
    const query = `
      MATCH (e:Event {id: $id})
      RETURN e
    `;

    const session = this.getSession();
    try {
      const result = await session.run(query, { id });

      if (result.records.length === 0) {
        return null;
      }

      return this.mapRecordToEvent(result.records[0]);
    } catch (error) {
      throw new Error(`Failed to find event by ID: ${error}`);
    } finally {
      await session.close();
    }
  }

  /**
   * Find all events
   */
  async findAll(limit?: number, offset?: number): Promise<Event[]> {
    let query = `
      MATCH (e:Event)
      RETURN e
      ORDER BY e.timestamp ASC
    `;

    const parameters: Record<string, any> = {};

    if (limit !== undefined) {
      query += ` SKIP $offset LIMIT $limit`;
      parameters.limit = Integer.fromNumber(limit);
      parameters.offset = Integer.fromNumber(offset || 0);
    }

    const session = this.getSession();
    try {
      const result = await session.run(query, parameters);
      return result.records.map(record => this.mapRecordToEvent(record));
    } catch (error) {
      throw new Error(`Failed to find events: ${error}`);
    } finally {
      await session.close();
    }
  }

  /**
   * Find events by temporal range
   */
  async findByTimeRange(timeRange: TimeRange, limit?: number, offset?: number): Promise<Event[]> {
    let query = `
      MATCH (e:Event)
      WHERE e.timestamp >= datetime($startTime) AND e.timestamp <= datetime($endTime)
      RETURN e
      ORDER BY e.timestamp ASC
    `;

    const parameters: Record<string, any> = {
      startTime: timeRange.start.toISOString(),
      endTime: timeRange.end.toISOString()
    };

    if (limit !== undefined) {
      query += ` SKIP $offset LIMIT $limit`;
      parameters.limit = Integer.fromNumber(limit);
      parameters.offset = Integer.fromNumber(offset || 0);
    }

    const session = this.getSession();
    try {
      const result = await session.run(query, parameters);
      return result.records.map(record => this.mapRecordToEvent(record));
    } catch (error) {
      throw new Error(`Failed to find events by time range: ${error}`);
    } finally {
      await session.close();
    }
  }

  /**
   * Find events by actor
   */
  async findByActor(actor: string, limit?: number, offset?: number): Promise<Event[]> {
    let query = `
      MATCH (e:Event {actor: $actor})
      RETURN e
      ORDER BY e.timestamp ASC
    `;

    const parameters: Record<string, any> = { actor };

    if (limit !== undefined) {
      query += ` SKIP $offset LIMIT $limit`;
      parameters.limit = Integer.fromNumber(limit);
      parameters.offset = Integer.fromNumber(offset || 0);
    }

    const session = this.getSession();
    try {
      const result = await session.run(query, parameters);
      return result.records.map(record => this.mapRecordToEvent(record));
    } catch (error) {
      throw new Error(`Failed to find events by actor: ${error}`);
    } finally {
      await session.close();
    }
  }

  /**
   * Find events by target
   */
  async findByTarget(target: string, limit?: number, offset?: number): Promise<Event[]> {
    let query = `
      MATCH (e:Event {target: $target})
      RETURN e
      ORDER BY e.timestamp ASC
    `;

    const parameters: Record<string, any> = { target };

    if (limit !== undefined) {
      query += ` SKIP $offset LIMIT $limit`;
      parameters.limit = Integer.fromNumber(limit);
      parameters.offset = Integer.fromNumber(offset || 0);
    }

    const session = this.getSession();
    try {
      const result = await session.run(query, parameters);
      return result.records.map(record => this.mapRecordToEvent(record));
    } catch (error) {
      throw new Error(`Failed to find events by target: ${error}`);
    } finally {
      await session.close();
    }
  }

  /**
   * Find events by actor and time range (optimized query)
   */
  async findByActorAndTimeRange(actor: string, timeRange: TimeRange, limit?: number, offset?: number): Promise<Event[]> {
    let query = `
      MATCH (e:Event)
      WHERE e.actor = $actor
        AND e.timestamp >= datetime($startTime)
        AND e.timestamp <= datetime($endTime)
      RETURN e
      ORDER BY e.timestamp ASC
    `;

    const parameters: Record<string, any> = {
      actor,
      startTime: timeRange.start.toISOString(),
      endTime: timeRange.end.toISOString()
    };

    if (limit !== undefined) {
      query += ` SKIP $offset LIMIT $limit`;
      parameters.limit = Integer.fromNumber(limit);
      parameters.offset = Integer.fromNumber(offset || 0);
    }

    const session = this.getSession();
    try {
      const result = await session.run(query, parameters);
      return result.records.map(record => this.mapRecordToEvent(record));
    } catch (error) {
      throw new Error(`Failed to find events by actor and time range: ${error}`);
    } finally {
      await session.close();
    }
  }

  /**
   * Update an existing event
   */
  async update(id: string, updates: UpdateEventRequest): Promise<Event | null> {
    // First, get the existing event
    const existingEvent = await this.findById(id);
    if (!existingEvent) {
      return null;
    }

    // Create updated event to validate
    const updatedEvent = existingEvent.update(updates);

    const query = `
      MATCH (e:Event {id: $id})
      SET e.description = $description,
          e.actor = $actor,
          e.target = $target,
          e.timestamp = datetime($timestamp),
          e.metadata = $metadata
      RETURN e
    `;

    const parameters = {
      id,
      description: updatedEvent.description,
      actor: updatedEvent.actor,
      target: updatedEvent.target,
      timestamp: updatedEvent.timestamp.toISOString(),
      metadata: updatedEvent.metadata || {}
    };

    const session = this.getSession();
    try {
      const result = await session.run(query, parameters);

      if (result.records.length === 0) {
        return null;
      }

      return updatedEvent;
    } catch (error) {
      throw new Error(`Failed to update event: ${error}`);
    } finally {
      await session.close();
    }
  }

  /**
   * Delete an event by ID
   */
  async delete(id: string): Promise<boolean> {
    const query = `
      MATCH (e:Event {id: $id})
      DELETE e
      RETURN count(e) as deletedCount
    `;

    const session = this.getSession();
    try {
      const result = await session.run(query, { id });
      const deletedCount = result.records[0]?.get('deletedCount')?.toNumber?.() || result.records[0]?.get('deletedCount') || 0;
      return deletedCount > 0;
    } catch (error) {
      throw new Error(`Failed to delete event: ${error}`);
    } finally {
      await session.close();
    }
  }

  /**
   * Count total events
   */
  async count(): Promise<number> {
    const query = `
      MATCH (e:Event)
      RETURN count(e) as total
    `;

    const session = this.getSession();
    try {
      const result = await session.run(query);
      return result.records[0]?.get('total')?.toNumber?.() || result.records[0]?.get('total') || 0;
    } catch (error) {
      throw new Error(`Failed to count events: ${error}`);
    } finally {
      await session.close();
    }
  }

  /**
   * Count events by actor
   */
  async countByActor(actor: string): Promise<number> {
    const query = `
      MATCH (e:Event {actor: $actor})
      RETURN count(e) as total
    `;

    const session = this.getSession();
    try {
      const result = await session.run(query, { actor });
      return result.records[0]?.get('total')?.toNumber?.() || result.records[0]?.get('total') || 0;
    } catch (error) {
      throw new Error(`Failed to count events by actor: ${error}`);
    } finally {
      await session.close();
    }
  }

  /**
   * Count events in time range
   */
  async countByTimeRange(timeRange: TimeRange): Promise<number> {
    const query = `
      MATCH (e:Event)
      WHERE e.timestamp >= datetime($startTime) AND e.timestamp <= datetime($endTime)
      RETURN count(e) as total
    `;

    const parameters = {
      startTime: timeRange.start.toISOString(),
      endTime: timeRange.end.toISOString()
    };

    const session = this.getSession();
    try {
      const result = await session.run(query, parameters);
      return result.records[0]?.get('total')?.toNumber?.() || result.records[0]?.get('total') || 0;
    } catch (error) {
      throw new Error(`Failed to count events by time range: ${error}`);
    } finally {
      await session.close();
    }
  }

  /**
   * Check if an event exists
   */
  async exists(id: string): Promise<boolean> {
    const query = `
      MATCH (e:Event {id: $id})
      RETURN count(e) > 0 as exists
    `;

    const session = this.getSession();
    try {
      const result = await session.run(query, { id });
      return result.records[0]?.get('exists') || false;
    } catch (error) {
      throw new Error(`Failed to check if event exists: ${error}`);
    } finally {
      await session.close();
    }
  }

  /**
   * Close the repository (no-op, sessions are managed per-operation)
   */
  async close(): Promise<void> {
    // Sessions are now closed after each operation
  }

  /**
   * Map Neo4j record to Event instance
   */
  protected mapRecordToEvent(record: any): Event {
    const node = record.get('e');
    const properties = node.properties;

    // Convert Neo4j DateTime to JavaScript Date
    const timestamp = properties.timestamp.toString ? 
      new Date(properties.timestamp.toString()) : 
      new Date(properties.timestamp);

    return new Event({
      id: properties.id,
      description: properties.description,
      actor: properties.actor,
      target: properties.target,
      timestamp,
      metadata: properties.metadata || {}
    });
  }
}

/**
 * Query options for event searches
 */
export interface EventQueryOptions {
  limit?: number;
  offset?: number;
  orderBy?: 'timestamp' | 'actor' | 'target';
  orderDirection?: 'ASC' | 'DESC';
}

/**
 * Event search filters
 */
export interface EventSearchFilters {
  actor?: string;
  target?: string;
  timeRange?: TimeRange;
  description?: string; // For text search
}

/**
 * Extended EventRepository with advanced search capabilities
 */
export class AdvancedEventRepository extends EventRepository {
  /**
   * Search events with multiple filters
   */
  async search(filters: EventSearchFilters, options: EventQueryOptions = {}): Promise<Event[]> {
    const conditions: string[] = [];
    const parameters: Record<string, any> = {};

    // Build WHERE conditions
    if (filters.actor) {
      conditions.push('e.actor = $actor');
      parameters.actor = filters.actor;
    }

    if (filters.target) {
      conditions.push('e.target = $target');
      parameters.target = filters.target;
    }

    if (filters.timeRange) {
      conditions.push('e.timestamp >= datetime($startTime) AND e.timestamp <= datetime($endTime)');
      parameters.startTime = filters.timeRange.start.toISOString();
      parameters.endTime = filters.timeRange.end.toISOString();
    }

    if (filters.description) {
      conditions.push('toLower(e.description) CONTAINS toLower($description)');
      parameters.description = filters.description;
    }

    // Build query
    let query = 'MATCH (e:Event)';

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ' RETURN e';

    // Add ordering
    const orderBy = options.orderBy || 'timestamp';
    const orderDirection = options.orderDirection || 'ASC';
    query += ` ORDER BY e.${orderBy} ${orderDirection}`;

    // Add pagination
    if (options.limit !== undefined) {
      query += ` SKIP $offset LIMIT $limit`;
      parameters.limit = Integer.fromNumber(options.limit);
      parameters.offset = Integer.fromNumber(options.offset || 0);
    }

    const session = this.getSession();
    try {
      const result = await session.run(query, parameters);
      return result.records.map(record => this.mapRecordToEvent(record));
    } catch (error) {
      throw new Error(`Failed to search events: ${error}`);
    } finally {
      await session.close();
    }
  }
}