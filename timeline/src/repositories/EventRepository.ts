import { Session, Integer } from 'neo4j-driver';
import { Event, CreateEventRequest, UpdateEventRequest, TimeRange } from '../models/Event';
import { DatabaseManager, LocalDatabaseManager, LocalSession } from '../utils/database';
import {
  graphPatternMap,
  graphPatternProperty,
  GraphScopedRepositoryOptions
} from './graphScope';

type AnySession = Session | LocalSession;

/**
 * A value read from a driver record, before the caller narrows it to the
 * shape that column is known to hold.
 */
type StoredValue = unknown;

/**
 * The read surface both record classes share.
 *
 * `Session.run` and `LocalSession.run` return different record classes, and both
 * declare `get` as an overload set. Calling `get` on the union therefore only
 * resolves the positional overload, so every read goes through this interface
 * instead: the lookup stays string-keyed and the value arrives as `unknown` and
 * is validated once, here, rather than at each use site.
 */
interface QueryRecord {
  get(key: string): StoredValue;
  has(key: string): boolean;
}

/** Result set whose records expose {@link QueryRecord}. */
interface QueryResultLike {
  records: readonly QueryRecord[];
}

/** A node as projected by `RETURN e`. */
interface GraphNode {
  properties: Record<string, unknown>;
}

/** A Cypher integer column (`count(...)`); LocalGraphStore returns plain numbers. */
interface IntegerLike {
  toNumber(): number;
}

function isIntegerLike(value: unknown): value is IntegerLike {
  return typeof value === 'object' && value !== null
    && 'toNumber' in value && typeof value.toNumber === 'function';
}

function isPropertyBag(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isGraphNode(value: unknown): value is GraphNode {
  return isPropertyBag(value) && 'properties' in value && isPropertyBag(value.properties);
}

/** Reads a named column from a record. */
function readField(record: QueryRecord, key: string): StoredValue {
  return record.has(key) ? record.get(key) : undefined;
}

/** Reads a named column from the first record of a result set. */
function readFirstField(result: QueryResultLike, key: string): StoredValue {
  const record = result.records[0];
  return record === undefined ? undefined : readField(record, key);
}

/**
 * Reads a numeric column. Cypher returns `count(...)` as an `Integer`, while
 * LocalGraphStore stores the JS number it was given, so both encodings occur.
 */
function readNumber(value: unknown, field: string): number {
  if (typeof value === 'number') {
    return value;
  }
  if (isIntegerLike(value)) {
    return value.toNumber();
  }
  throw new TypeError(`Record property "${field}" must be a number`);
}

/**
 * Reads a count column, defaulting to 0 when the result set is empty.
 */
function readCount(result: QueryResultLike, key: string): number {
  const value = readFirstField(result, key);
  if (value === undefined || value === null) {
    return 0;
  }
  return readNumber(value, key);
}

/**
 * Reads a required string column.
 */
function readString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`Record property "${field}" must be a string`);
  }
  return value;
}

/**
 * Reads an optional string column. A missing or non-string value becomes
 * `undefined`, which the model then handles exactly as a missing column.
 */
function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Reads the metadata property bag. Falsy metadata becomes an empty object; a
 * truthy non-object is rejected rather than silently coerced.
 */
function readMetadata(value: unknown, field: string): Record<string, unknown> {
  if (!value) {
    return {};
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (isPropertyBag(parsed)) {
        return parsed;
      }
    } catch {
      // Fall through to TypeError below
    }
  }
  if (!isPropertyBag(value)) {
    throw new TypeError(`Record property "${field}" must be an object`);
  }
  return value;
}

/**
 * Reads a temporal column. The driver projects `datetime(...)` as a DateTime
 * object and LocalGraphStore keeps the ISO string it was handed; `String(value)`
 * performs the same `toString()` conversion the previous implementation used for
 * both encodings.
 */
function readDate(value: unknown, field: string): Date {
  if (value === null || value === undefined) {
    throw new TypeError(`Record property "${field}" is missing`);
  }
  return new Date(String(value));
}

/**
 * Repository for Event operations using Neo4j or LocalGraphStore
 */
export class EventRepository {
  protected databaseManager: DatabaseManager | LocalDatabaseManager;

  /**
   * Graph every query of this repository is confined to in cloud mode.
   *
   * `undefined` means the process-wide, unscoped repository (the container
   * level singleton used by export, import and the CLI), which keeps the
   * whole-database behaviour it had before #59. The value is never applied on a
   * local store: there a graph *is* the store, so a `graphId` filter would look
   * for a property local nodes do not have and match nothing.
   */
  protected readonly graphId?: string;

  constructor(
    databaseManager: DatabaseManager | LocalDatabaseManager,
    // Kept for the DI container in src/container.ts, which still passes these.
    // The repository never reads them, so they are typed as `unknown`.
    _validationService?: unknown,
    _cacheService?: unknown,
    options: GraphScopedRepositoryOptions = {}
  ) {
    this.databaseManager = databaseManager;
    this.graphId = databaseManager instanceof LocalDatabaseManager ? undefined : options.graphId;
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

    const parameters: Record<string, unknown> = {
      id: event.id,
      description: event.description,
      actor: event.actor,
      target: event.target,
      timestamp: event.timestamp.toISOString(),
      metadata: JSON.stringify(event.metadata || {})
    };
    // A scoped repository stamps its graph on the row it writes: an unstamped
    // row would be invisible to the graph that created it.
    const graphProperty = graphPatternProperty(parameters, this.graphId);

    const query = `
      CREATE (e:Event {
        id: $id,
        description: $description,
        actor: $actor,
        target: $target,
        timestamp: datetime($timestamp),
        metadata: $metadata${graphProperty}
      })
      RETURN e
    `;

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
    const parameters: Record<string, unknown> = { id };
    const graphProperty = graphPatternProperty(parameters, this.graphId);

    const query = `
      MATCH (e:Event {id: $id${graphProperty}})
      RETURN e
    `;

    const session = this.getSession();
    try {
      const result = await session.run(query, parameters);

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
    const parameters: Record<string, unknown> = {};
    const graphMap = graphPatternMap(parameters, this.graphId);

    let query = `
      MATCH (e:Event${graphMap})
      RETURN e
      ORDER BY e.timestamp ASC
    `;

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
    const parameters: Record<string, unknown> = {
      startTime: timeRange.start.toISOString(),
      endTime: timeRange.end.toISOString()
    };
    const graphMap = graphPatternMap(parameters, this.graphId);

    let query = `
      MATCH (e:Event${graphMap})
      WHERE e.timestamp >= datetime($startTime) AND e.timestamp <= datetime($endTime)
      RETURN e
      ORDER BY e.timestamp ASC
    `;

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
    const parameters: Record<string, unknown> = { actor };
    const graphProperty = graphPatternProperty(parameters, this.graphId);

    let query = `
      MATCH (e:Event {actor: $actor${graphProperty}})
      RETURN e
      ORDER BY e.timestamp ASC
    `;

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
    const parameters: Record<string, unknown> = { target };
    const graphProperty = graphPatternProperty(parameters, this.graphId);

    let query = `
      MATCH (e:Event {target: $target${graphProperty}})
      RETURN e
      ORDER BY e.timestamp ASC
    `;

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
    const parameters: Record<string, unknown> = {
      actor,
      startTime: timeRange.start.toISOString(),
      endTime: timeRange.end.toISOString()
    };
    const graphMap = graphPatternMap(parameters, this.graphId);

    let query = `
      MATCH (e:Event${graphMap})
      WHERE e.actor = $actor
        AND e.timestamp >= datetime($startTime)
        AND e.timestamp <= datetime($endTime)
      RETURN e
      ORDER BY e.timestamp ASC
    `;

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

    const parameters: Record<string, unknown> = {
      id,
      description: updatedEvent.description,
      actor: updatedEvent.actor,
      target: updatedEvent.target,
      timestamp: updatedEvent.timestamp.toISOString(),
      metadata: JSON.stringify(updatedEvent.metadata || {})
    };
    // The graph filter is what stops this update from reaching an id that only
    // exists in another graph.
    const graphProperty = graphPatternProperty(parameters, this.graphId);

    const query = `
      MATCH (e:Event {id: $id${graphProperty}})
      SET e.description = $description,
          e.actor = $actor,
          e.target = $target,
          e.timestamp = datetime($timestamp),
          e.metadata = $metadata
      RETURN e
    `;

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
    const parameters: Record<string, unknown> = { id };
    const graphProperty = graphPatternProperty(parameters, this.graphId);

    const query = `
      MATCH (e:Event {id: $id${graphProperty}})
      DELETE e
      RETURN count(e) as deletedCount
    `;

    const session = this.getSession();
    try {
      const result = await session.run(query, parameters);
      return readCount(result, 'deletedCount') > 0;
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
    const parameters: Record<string, unknown> = {};
    const graphMap = graphPatternMap(parameters, this.graphId);

    const query = `
      MATCH (e:Event${graphMap})
      RETURN count(e) as total
    `;

    const session = this.getSession();
    try {
      const result = await session.run(query, parameters);
      return readCount(result, 'total');
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
    const parameters: Record<string, unknown> = { actor };
    const graphProperty = graphPatternProperty(parameters, this.graphId);

    const query = `
      MATCH (e:Event {actor: $actor${graphProperty}})
      RETURN count(e) as total
    `;

    const session = this.getSession();
    try {
      const result = await session.run(query, parameters);
      return readCount(result, 'total');
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
    const parameters: Record<string, unknown> = {
      startTime: timeRange.start.toISOString(),
      endTime: timeRange.end.toISOString()
    };
    const graphMap = graphPatternMap(parameters, this.graphId);

    const query = `
      MATCH (e:Event${graphMap})
      WHERE e.timestamp >= datetime($startTime) AND e.timestamp <= datetime($endTime)
      RETURN count(e) as total
    `;

    const session = this.getSession();
    try {
      const result = await session.run(query, parameters);
      return readCount(result, 'total');
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
    const parameters: Record<string, unknown> = { id };
    const graphProperty = graphPatternProperty(parameters, this.graphId);

    const query = `
      MATCH (e:Event {id: $id${graphProperty}})
      RETURN count(e) > 0 as exists
    `;

    const session = this.getSession();
    try {
      const result = await session.run(query, parameters);
      return Boolean(readFirstField(result, 'exists'));
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
  protected mapRecordToEvent(record: QueryRecord): Event {
    const node = readField(record, 'e');
    if (!isGraphNode(node)) {
      throw new TypeError('Query record does not contain a node');
    }
    const properties = node.properties;

    return new Event({
      id: readOptionalString(properties.id),
      description: readString(properties.description, 'description'),
      actor: readString(properties.actor, 'actor'),
      target: readString(properties.target, 'target'),
      // Convert Neo4j DateTime to JavaScript Date
      timestamp: readDate(properties.timestamp, 'timestamp'),
      metadata: readMetadata(properties.metadata, 'metadata')
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
    const parameters: Record<string, unknown> = {};

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

    // Build query. The graph filter goes inside the pattern, so a search scoped
    // to one graph cannot return another graph's events.
    let query = `MATCH (e:Event${graphPatternMap(parameters, this.graphId)})`;

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