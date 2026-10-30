import { Session, Integer } from 'neo4j-driver';
import { Arc, CreateArcRequest, UpdateArcRequest } from '../models/Arc';
import { TimeRange } from '../models/Event';
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

/** A node as projected by `RETURN a` / `RETURN child` / `RETURN parent`. */
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
 * Repository for Arc operations using Neo4j or LocalGraphStore
 */
export class ArcRepository {
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
    _temporalService?: unknown,
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
   * Create a new arc with temporal boundary validation
   */
  async create(arcData: CreateArcRequest): Promise<Arc> {
    const arc = new Arc(arcData);

    // Validate temporal boundaries at database level
    await this.validateTemporalBoundaries(arc);

    const parameters: Record<string, unknown> = {
      id: arc.id,
      name: arc.name,
      description: arc.description || null,
      start_time: arc.start_time.toISOString(),
      end_time: arc.end_time.toISOString(),
      level: arc.level,
      metadata: JSON.stringify(arc.metadata || {})
    };
    // A scoped repository stamps its graph on the row it writes: an unstamped
    // row would be invisible to the graph that created it.
    const graphProperty = graphPatternProperty(parameters, this.graphId);

    const query = `
      CREATE (a:Arc {
        id: $id,
        name: $name,
        description: $description,
        start_time: datetime($start_time),
        end_time: datetime($end_time),
        level: $level,
        metadata: $metadata${graphProperty}
      })
      RETURN a
    `;

    const session = this.getSession();
    try {
      const result = await session.run(query, parameters);

      if (result.records.length === 0) {
        throw new Error('Failed to create arc');
      }

      return arc;
    } catch (error) {
      throw new Error(`Failed to create arc: ${error}`);
    } finally {
      await session.close();
    }
  }

  /**
   * Find arc by ID
   */
  async findById(id: string): Promise<Arc | null> {
    const parameters: Record<string, unknown> = { id };
    const graphProperty = graphPatternProperty(parameters, this.graphId);

    const query = `
      MATCH (a:Arc {id: $id${graphProperty}})
      RETURN a
    `;

    const session = this.getSession();
    try {
      const result = await session.run(query, parameters);

      if (result.records.length === 0) {
        return null;
      }

      return this.mapRecordToArc(result.records[0]);
    } catch (error) {
      throw new Error(`Failed to find arc by ID: ${error}`);
    } finally {
      await session.close();
    }
  }

  /**
   * Find all arcs
   */
  async findAll(limit?: number, offset?: number): Promise<Arc[]> {
    const parameters: Record<string, unknown> = {};
    const graphMap = graphPatternMap(parameters, this.graphId);

    let query = `
      MATCH (a:Arc${graphMap})
      RETURN a
      ORDER BY a.level ASC, a.start_time ASC
    `;

    if (limit !== undefined) {
      query += ` SKIP $offset LIMIT $limit`;
      parameters.limit = Integer.fromNumber(limit);
      parameters.offset = Integer.fromNumber(offset || 0);
    }

    const session = this.getSession();
    try {
      const result = await session.run(query, parameters);
      return result.records.map(record => this.mapRecordToArc(record));
    } catch (error) {
      throw new Error(`Failed to find arcs: ${error}`);
    } finally {
      await session.close();
    }
  }

  /**
   * Find arcs by level
   */
  async findByLevel(level: number, limit?: number, offset?: number): Promise<Arc[]> {
    const parameters: Record<string, unknown> = { level };
    const graphProperty = graphPatternProperty(parameters, this.graphId);

    let query = `
      MATCH (a:Arc {level: $level${graphProperty}})
      RETURN a
      ORDER BY a.start_time ASC
    `;

    if (limit !== undefined) {
      query += ` SKIP $offset LIMIT $limit`;
      parameters.limit = Integer.fromNumber(limit);
      parameters.offset = Integer.fromNumber(offset || 0);
    }

    const session = this.getSession();
    try {
      const result = await session.run(query, parameters);
      return result.records.map(record => this.mapRecordToArc(record));
    } catch (error) {
      throw new Error(`Failed to find arcs by level: ${error}`);
    } finally {
      await session.close();
    }
  }

  /**
   * Find overlapping arcs within a time range
   */
  async findOverlappingArcs(timeRange: TimeRange, limit?: number, offset?: number): Promise<Arc[]> {
    const parameters: Record<string, unknown> = {
      startTime: timeRange.start.toISOString(),
      endTime: timeRange.end.toISOString()
    };
    const graphMap = graphPatternMap(parameters, this.graphId);

    let query = `
      MATCH (a:Arc${graphMap})
      WHERE a.start_time < datetime($endTime) AND a.end_time > datetime($startTime)
      RETURN a
      ORDER BY a.start_time ASC
    `;

    if (limit !== undefined) {
      query += ` SKIP $offset LIMIT $limit`;
      parameters.limit = Integer.fromNumber(limit);
      parameters.offset = Integer.fromNumber(offset || 0);
    }

    const session = this.getSession();
    try {
      const result = await session.run(query, parameters);
      return result.records.map(record => this.mapRecordToArc(record));
    } catch (error) {
      throw new Error(`Failed to find overlapping arcs: ${error}`);
    } finally {
      await session.close();
    }
  }

  /**
   * Find arcs that completely contain the given time range
   */
  async findContainingArcs(timeRange: TimeRange, limit?: number, offset?: number): Promise<Arc[]> {
    const parameters: Record<string, unknown> = {
      startTime: timeRange.start.toISOString(),
      endTime: timeRange.end.toISOString()
    };
    const graphMap = graphPatternMap(parameters, this.graphId);

    let query = `
      MATCH (a:Arc${graphMap})
      WHERE a.start_time <= datetime($startTime) AND a.end_time >= datetime($endTime)
      RETURN a
      ORDER BY a.level ASC, a.start_time ASC
    `;

    if (limit !== undefined) {
      query += ` SKIP $offset LIMIT $limit`;
      parameters.limit = Integer.fromNumber(limit);
      parameters.offset = Integer.fromNumber(offset || 0);
    }

    const session = this.getSession();
    try {
      const result = await session.run(query, parameters);
      return result.records.map(record => this.mapRecordToArc(record));
    } catch (error) {
      throw new Error(`Failed to find containing arcs: ${error}`);
    } finally {
      await session.close();
    }
  }

  /**
   * Find nested arcs (child arcs within a parent arc)
   */
  async findNestedArcs(parentArcId: string, limit?: number, offset?: number): Promise<Arc[]> {
    const parameters: Record<string, unknown> = { parentId: parentArcId };
    // Both ends are pinned: a parent in this graph must not pull in a child from
    // another one.
    const graphProperty = graphPatternProperty(parameters, this.graphId);
    const graphMap = graphPatternMap(parameters, this.graphId);

    const query = `
      MATCH (parent:Arc {id: $parentId${graphProperty}})
      MATCH (child:Arc${graphMap})
      WHERE child.start_time >= parent.start_time
        AND child.end_time <= parent.end_time
        AND child.id <> parent.id
        AND child.level > parent.level
      RETURN child
      ORDER BY child.level ASC, child.start_time ASC
      ${limit !== undefined ? 'SKIP $offset LIMIT $limit' : ''}
    `;

    if (limit !== undefined) {
      parameters.limit = Integer.fromNumber(limit);
      parameters.offset = Integer.fromNumber(offset || 0);
    }

    const session = this.getSession();
    try {
      const result = await session.run(query, parameters);
      return result.records.map(record => this.mapRecordToArc(record));
    } catch (error) {
      throw new Error(`Failed to find nested arcs: ${error}`);
    } finally {
      await session.close();
    }
  }

  /**
   * Find direct child arcs (immediate children only)
   */
  async findDirectChildren(parentArcId: string): Promise<Arc[]> {
    const parameters: Record<string, unknown> = { parentId: parentArcId };
    const graphProperty = graphPatternProperty(parameters, this.graphId);
    const graphMap = graphPatternMap(parameters, this.graphId);

    const query = `
      MATCH (parent:Arc {id: $parentId${graphProperty}})
      MATCH (child:Arc${graphMap})
      WHERE child.start_time >= parent.start_time
        AND child.end_time <= parent.end_time
        AND child.id <> parent.id
        AND child.level = parent.level + 1
      RETURN child
      ORDER BY child.start_time ASC
    `;

    const session = this.getSession();
    try {
      const result = await session.run(query, parameters);
      return result.records.map(record => this.mapRecordToArc(record));
    } catch (error) {
      throw new Error(`Failed to find direct children: ${error}`);
    } finally {
      await session.close();
    }
  }

  /**
   * Find parent arcs that contain the given arc
   */
  async findParentArcs(childArcId: string): Promise<Arc[]> {
    const parameters: Record<string, unknown> = { childId: childArcId };
    const graphProperty = graphPatternProperty(parameters, this.graphId);
    const graphMap = graphPatternMap(parameters, this.graphId);

    const query = `
      MATCH (child:Arc {id: $childId${graphProperty}})
      MATCH (parent:Arc${graphMap})
      WHERE parent.start_time <= child.start_time
        AND parent.end_time >= child.end_time
        AND parent.id <> child.id
        AND parent.level < child.level
      RETURN parent
      ORDER BY parent.level DESC
    `;

    const session = this.getSession();
    try {
      const result = await session.run(query, parameters);
      return result.records.map(record => this.mapRecordToArc(record));
    } catch (error) {
      throw new Error(`Failed to find parent arcs: ${error}`);
    } finally {
      await session.close();
    }
  }

  /**
   * Update an existing arc with temporal boundary validation
   */
  async update(id: string, updates: UpdateArcRequest): Promise<Arc | null> {
    // First, get the existing arc
    const existingArc = await this.findById(id);
    if (!existingArc) {
      return null;
    }

    // Create updated arc to validate
    const updatedArc = existingArc.update(updates);

    // Validate temporal boundaries
    await this.validateTemporalBoundaries(updatedArc, id);

    const parameters: Record<string, unknown> = {
      id,
      name: updatedArc.name,
      description: updatedArc.description || null,
      start_time: updatedArc.start_time.toISOString(),
      end_time: updatedArc.end_time.toISOString(),
      level: updatedArc.level,
      metadata: JSON.stringify(updatedArc.metadata || {})
    };
    // The graph filter is what stops this update from reaching an id that only
    // exists in another graph.
    const graphProperty = graphPatternProperty(parameters, this.graphId);

    const query = `
      MATCH (a:Arc {id: $id${graphProperty}})
      SET a.name = $name,
          a.description = $description,
          a.start_time = datetime($start_time),
          a.end_time = datetime($end_time),
          a.level = $level,
          a.metadata = $metadata
      RETURN a
    `;

    const session = this.getSession();
    try {
      const result = await session.run(query, parameters);

      if (result.records.length === 0) {
        return null;
      }

      return updatedArc;
    } catch (error) {
      throw new Error(`Failed to update arc: ${error}`);
    } finally {
      await session.close();
    }
  }

  /**
   * Delete an arc by ID
   */
  async delete(id: string): Promise<boolean> {
    const parameters: Record<string, unknown> = { id };
    const graphProperty = graphPatternProperty(parameters, this.graphId);

    const query = `
      MATCH (a:Arc {id: $id${graphProperty}})
      DELETE a
      RETURN count(a) as deletedCount
    `;

    const session = this.getSession();
    try {
      const result = await session.run(query, parameters);
      return readCount(result, 'deletedCount') > 0;
    } catch (error) {
      throw new Error(`Failed to delete arc: ${error}`);
    } finally {
      await session.close();
    }
  }

  /**
   * Count total arcs
   */
  async count(): Promise<number> {
    const parameters: Record<string, unknown> = {};
    const graphMap = graphPatternMap(parameters, this.graphId);

    const query = `
      MATCH (a:Arc${graphMap})
      RETURN count(a) as total
    `;

    const session = this.getSession();
    try {
      const result = await session.run(query, parameters);
      return readCount(result, 'total');
    } catch (error) {
      throw new Error(`Failed to count arcs: ${error}`);
    } finally {
      await session.close();
    }
  }

  /**
   * Count arcs by level
   */
  async countByLevel(level: number): Promise<number> {
    const parameters: Record<string, unknown> = { level };
    const graphProperty = graphPatternProperty(parameters, this.graphId);

    const query = `
      MATCH (a:Arc {level: $level${graphProperty}})
      RETURN count(a) as total
    `;

    const session = this.getSession();
    try {
      const result = await session.run(query, parameters);
      return readCount(result, 'total');
    } catch (error) {
      throw new Error(`Failed to count arcs by level: ${error}`);
    } finally {
      await session.close();
    }
  }

  /**
   * Check if an arc exists
   */
  async exists(id: string): Promise<boolean> {
    const parameters: Record<string, unknown> = { id };
    const graphProperty = graphPatternProperty(parameters, this.graphId);

    const query = `
      MATCH (a:Arc {id: $id${graphProperty}})
      RETURN count(a) > 0 as exists
    `;

    const session = this.getSession();
    try {
      const result = await session.run(query, parameters);
      return Boolean(readFirstField(result, 'exists'));
    } catch (error) {
      throw new Error(`Failed to check if arc exists: ${error}`);
    } finally {
      await session.close();
    }
  }

  /**
   * Validate temporal boundaries and hierarchy constraints
   */
  private async validateTemporalBoundaries(arc: Arc, excludeId?: string): Promise<void> {
    const parameters: Record<string, unknown> = {
      excludeId: excludeId || '',
      level: arc.level,
      start_time: arc.start_time.toISOString(),
      end_time: arc.end_time.toISOString()
    };
    // Only this graph's arcs can conflict with this graph's arc: a boundary
    // violation in another graph is that graph's problem, and reporting it here
    // would block a legitimate write. Without the filter the check also reads
    // every arc in the database.
    const graphMap = graphPatternMap(parameters, this.graphId);

    // Check for hierarchy violations:
    // 1. Invalid nesting - child arc ($level) overlaps a parent arc (existing.level < $level)
    //    but is not fully contained within that parent's [start_time, end_time].
    // 2. Invalid parent - parent arc ($level) overlaps a child arc (existing.level > $level)
    //    but does not fully contain that child's [start_time, end_time].
    const query = `
      MATCH (existing:Arc${graphMap})
      WHERE existing.id <> $excludeId
        AND (
          (existing.level < $level
           AND existing.start_time < datetime($end_time)
           AND existing.end_time > datetime($start_time)
           AND NOT (datetime($start_time) >= existing.start_time AND datetime($end_time) <= existing.end_time))
          OR
          (existing.level > $level
           AND existing.start_time < datetime($end_time)
           AND existing.end_time > datetime($start_time)
           AND NOT (existing.start_time >= datetime($start_time) AND existing.end_time <= datetime($end_time)))
        )
      RETURN existing.id as conflictId, existing.name as conflictName, existing.level as conflictLevel
      LIMIT 1
    `;

    const session = this.getSession();
    try {
      const result = await session.run(query, parameters);

      if (result.records.length > 0) {
        const conflict: QueryRecord = result.records[0];
        throw new Error(
          `Temporal boundary violation: Arc conflicts with existing arc "${readField(conflict, 'conflictName')}" ` +
          `(ID: ${readField(conflict, 'conflictId')}, Level: ${readField(conflict, 'conflictLevel')})`
        );
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('Temporal boundary violation')) {
        throw error;
      }
      throw new Error(`Failed to validate temporal boundaries: ${error}`);
    } finally {
      await session.close();
    }
  }

  /**
   * Alias for findOverlappingArcs for backward compatibility
   */
  async findOverlapping(timeRange: TimeRange, limit?: number, offset?: number): Promise<Arc[]> {
    return this.findOverlappingArcs(timeRange, limit, offset);
  }

  /**
   * Close the repository (no-op, sessions are managed per-operation)
   */
  async close(): Promise<void> {
    // Sessions are now closed after each operation
  }

  /**
   * Map Neo4j record to Arc instance
   */
  protected mapRecordToArc(record: QueryRecord): Arc {
    const node = readField(record, 'a') || readField(record, 'child') || readField(record, 'parent');
    if (!isGraphNode(node)) {
      throw new TypeError('Query record does not contain a node');
    }
    const properties = node.properties;

    return new Arc({
      id: readOptionalString(properties.id),
      name: readString(properties.name, 'name'),
      description: properties.description
        ? readString(properties.description, 'description')
        : undefined,
      // Convert Neo4j DateTime to JavaScript Date
      start_time: readDate(properties.start_time, 'start_time'),
      end_time: readDate(properties.end_time, 'end_time'),
      level: readNumber(properties.level, 'level'),
      metadata: readMetadata(properties.metadata, 'metadata')
    });
  }
}

/**
 * Query options for arc searches
 */
export interface ArcQueryOptions {
  limit?: number;
  offset?: number;
  orderBy?: 'start_time' | 'end_time' | 'level' | 'name';
  orderDirection?: 'ASC' | 'DESC';
}

/**
 * Arc search filters
 */
export interface ArcSearchFilters {
  name?: string;
  level?: number;
  timeRange?: TimeRange;
  description?: string;
  minLevel?: number;
  maxLevel?: number;
}

/**
 * Extended ArcRepository with advanced search and hierarchy operations
 */
export class AdvancedArcRepository extends ArcRepository {
  /**
   * Search arcs with multiple filters
   */
  async search(filters: ArcSearchFilters, options: ArcQueryOptions = {}): Promise<Arc[]> {
    const conditions: string[] = [];
    const parameters: Record<string, unknown> = {};

    // Build WHERE conditions
    if (filters.name) {
      conditions.push('toLower(a.name) CONTAINS toLower($name)');
      parameters.name = filters.name;
    }

    if (filters.level !== undefined) {
      conditions.push('a.level = $level');
      parameters.level = filters.level;
    }

    if (filters.minLevel !== undefined) {
      conditions.push('a.level >= $minLevel');
      parameters.minLevel = filters.minLevel;
    }

    if (filters.maxLevel !== undefined) {
      conditions.push('a.level <= $maxLevel');
      parameters.maxLevel = filters.maxLevel;
    }

    if (filters.timeRange) {
      conditions.push('a.start_time < datetime($endTime) AND a.end_time > datetime($startTime)');
      parameters.startTime = filters.timeRange.start.toISOString();
      parameters.endTime = filters.timeRange.end.toISOString();
    }

    if (filters.description) {
      conditions.push('toLower(a.description) CONTAINS toLower($description)');
      parameters.description = filters.description;
    }

    // Build query. The graph filter goes inside the pattern, so a search scoped
    // to one graph cannot return another graph's arcs.
    let query = `MATCH (a:Arc${graphPatternMap(parameters, this.graphId)})`;

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ' RETURN a';

    // Add ordering
    const orderBy = options.orderBy || 'start_time';
    const orderDirection = options.orderDirection || 'ASC';
    query += ` ORDER BY a.${orderBy} ${orderDirection}`;

    // Add pagination
    if (options.limit !== undefined) {
      query += ` SKIP $offset LIMIT $limit`;
      parameters.limit = Integer.fromNumber(options.limit);
      parameters.offset = Integer.fromNumber(options.offset || 0);
    }

    const session = this.getSession();
    try {
      const result = await session.run(query, parameters);
      return result.records.map(record => this.mapRecordToArc(record));
    } catch (error) {
      throw new Error(`Failed to search arcs: ${error}`);
    } finally {
      await session.close();
    }
  }

  /**
   * Get arc hierarchy tree starting from a root arc
   */
  async getHierarchyTree(rootArcId: string, maxDepth?: number): Promise<ArcHierarchyNode> {
    const rootArc = await this.findById(rootArcId);
    if (!rootArc) {
      throw new Error(`Root arc not found: ${rootArcId}`);
    }

    const hierarchyNode: ArcHierarchyNode = {
      arc: rootArc,
      children: []
    };

    await this.buildHierarchyTree(hierarchyNode, maxDepth);
    return hierarchyNode;
  }

  /**
   * Recursively build hierarchy tree
   */
  private async buildHierarchyTree(node: ArcHierarchyNode, maxDepth?: number): Promise<void> {
    if (maxDepth !== undefined && node.arc.level >= maxDepth) {
      return;
    }

    const children = await this.findDirectChildren(node.arc.id);

    for (const child of children) {
      const childNode: ArcHierarchyNode = {
        arc: child,
        children: []
      };

      node.children.push(childNode);
      await this.buildHierarchyTree(childNode, maxDepth);
    }
  }
}

/**
 * Arc hierarchy node for tree representation
 */
export interface ArcHierarchyNode {
  arc: Arc;
  children: ArcHierarchyNode[];
}
