import { Session, Result, Record as Neo4jRecord, Integer } from 'neo4j-driver';
import { Arc, IArc, CreateArcRequest, UpdateArcRequest } from '../models/Arc';
import { TimeRange } from '../models/Event';
import { getDatabaseManager } from '../utils/database';

/**
 * Repository for Arc operations using Neo4j
 */
export class ArcRepository {
  private session: Session;

  constructor(session?: Session) {
    this.session = session || getDatabaseManager().getNeo4jSession();
  }

  /**
   * Create a new arc with temporal boundary validation
   */
  async create(arcData: CreateArcRequest): Promise<Arc> {
    const arc = new Arc(arcData);
    
    // Validate temporal boundaries at database level
    await this.validateTemporalBoundaries(arc);
    
    const query = `
      CREATE (a:Arc {
        id: $id,
        name: $name,
        description: $description,
        start_time: datetime($start_time),
        end_time: datetime($end_time),
        level: $level,
        metadata: $metadata
      })
      RETURN a
    `;

    const parameters = {
      id: arc.id,
      name: arc.name,
      description: arc.description || null,
      start_time: arc.start_time.toISOString(),
      end_time: arc.end_time.toISOString(),
      level: arc.level,
      metadata: arc.metadata || {}
    };

    try {
      const result = await this.session.run(query, parameters);
      
      if (result.records.length === 0) {
        throw new Error('Failed to create arc');
      }

      return arc;
    } catch (error) {
      throw new Error(`Failed to create arc: ${error}`);
    }
  }

  /**
   * Find arc by ID
   */
  async findById(id: string): Promise<Arc | null> {
    const query = `
      MATCH (a:Arc {id: $id})
      RETURN a
    `;

    try {
      const result = await this.session.run(query, { id });
      
      if (result.records.length === 0) {
        return null;
      }

      return this.mapRecordToArc(result.records[0]);
    } catch (error) {
      throw new Error(`Failed to find arc by ID: ${error}`);
    }
  }

  /**
   * Find all arcs
   */
  async findAll(limit?: number, offset?: number): Promise<Arc[]> {
    let query = `
      MATCH (a:Arc)
      RETURN a
      ORDER BY a.level ASC, a.start_time ASC
    `;

    const parameters: Record<string, any> = {};

    if (limit !== undefined) {
      query += ` SKIP $offset LIMIT $limit`;
      parameters.limit = Integer.fromNumber(limit);
      parameters.offset = Integer.fromNumber(offset || 0);
    }

    try {
      const result = await this.session.run(query, parameters);
      return result.records.map(record => this.mapRecordToArc(record));
    } catch (error) {
      throw new Error(`Failed to find arcs: ${error}`);
    }
  }

  /**
   * Find arcs by level
   */
  async findByLevel(level: number, limit?: number, offset?: number): Promise<Arc[]> {
    let query = `
      MATCH (a:Arc {level: $level})
      RETURN a
      ORDER BY a.start_time ASC
    `;

    const parameters: Record<string, any> = { level };

    if (limit !== undefined) {
      query += ` SKIP $offset LIMIT $limit`;
      parameters.limit = Integer.fromNumber(limit);
      parameters.offset = Integer.fromNumber(offset || 0);
    }

    try {
      const result = await this.session.run(query, parameters);
      return result.records.map(record => this.mapRecordToArc(record));
    } catch (error) {
      throw new Error(`Failed to find arcs by level: ${error}`);
    }
  }

  /**
   * Find overlapping arcs within a time range
   */
  async findOverlappingArcs(timeRange: TimeRange, limit?: number, offset?: number): Promise<Arc[]> {
    let query = `
      MATCH (a:Arc)
      WHERE a.start_time < datetime($endTime) AND a.end_time > datetime($startTime)
      RETURN a
      ORDER BY a.start_time ASC
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

    try {
      const result = await this.session.run(query, parameters);
      return result.records.map(record => this.mapRecordToArc(record));
    } catch (error) {
      throw new Error(`Failed to find overlapping arcs: ${error}`);
    }
  }

  /**
   * Find arcs that completely contain the given time range
   */
  async findContainingArcs(timeRange: TimeRange, limit?: number, offset?: number): Promise<Arc[]> {
    let query = `
      MATCH (a:Arc)
      WHERE a.start_time <= datetime($startTime) AND a.end_time >= datetime($endTime)
      RETURN a
      ORDER BY a.level ASC, a.start_time ASC
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

    try {
      const result = await this.session.run(query, parameters);
      return result.records.map(record => this.mapRecordToArc(record));
    } catch (error) {
      throw new Error(`Failed to find containing arcs: ${error}`);
    }
  }

  /**
   * Find nested arcs (child arcs within a parent arc)
   */
  async findNestedArcs(parentArcId: string, limit?: number, offset?: number): Promise<Arc[]> {
    const query = `
      MATCH (parent:Arc {id: $parentId})
      MATCH (child:Arc)
      WHERE child.start_time >= parent.start_time 
        AND child.end_time <= parent.end_time
        AND child.id <> parent.id
        AND child.level > parent.level
      RETURN child
      ORDER BY child.level ASC, child.start_time ASC
      ${limit !== undefined ? 'SKIP $offset LIMIT $limit' : ''}
    `;

    const parameters: Record<string, any> = { parentId: parentArcId };

    if (limit !== undefined) {
      parameters.limit = Integer.fromNumber(limit);
      parameters.offset = Integer.fromNumber(offset || 0);
    }

    try {
      const result = await this.session.run(query, parameters);
      return result.records.map(record => this.mapRecordToArc(record));
    } catch (error) {
      throw new Error(`Failed to find nested arcs: ${error}`);
    }
  }

  /**
   * Find direct child arcs (immediate children only)
   */
  async findDirectChildren(parentArcId: string): Promise<Arc[]> {
    const query = `
      MATCH (parent:Arc {id: $parentId})
      MATCH (child:Arc)
      WHERE child.start_time >= parent.start_time 
        AND child.end_time <= parent.end_time
        AND child.id <> parent.id
        AND child.level = parent.level + 1
      RETURN child
      ORDER BY child.start_time ASC
    `;

    try {
      const result = await this.session.run(query, { parentId: parentArcId });
      return result.records.map(record => this.mapRecordToArc(record));
    } catch (error) {
      throw new Error(`Failed to find direct children: ${error}`);
    }
  }

  /**
   * Find parent arcs that contain the given arc
   */
  async findParentArcs(childArcId: string): Promise<Arc[]> {
    const query = `
      MATCH (child:Arc {id: $childId})
      MATCH (parent:Arc)
      WHERE parent.start_time <= child.start_time 
        AND parent.end_time >= child.end_time
        AND parent.id <> child.id
        AND parent.level < child.level
      RETURN parent
      ORDER BY parent.level DESC
    `;

    try {
      const result = await this.session.run(query, { childId: childArcId });
      return result.records.map(record => this.mapRecordToArc(record));
    } catch (error) {
      throw new Error(`Failed to find parent arcs: ${error}`);
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

    const query = `
      MATCH (a:Arc {id: $id})
      SET a.name = $name,
          a.description = $description,
          a.start_time = datetime($start_time),
          a.end_time = datetime($end_time),
          a.level = $level,
          a.metadata = $metadata
      RETURN a
    `;

    const parameters = {
      id,
      name: updatedArc.name,
      description: updatedArc.description || null,
      start_time: updatedArc.start_time.toISOString(),
      end_time: updatedArc.end_time.toISOString(),
      level: updatedArc.level,
      metadata: updatedArc.metadata || {}
    };

    try {
      const result = await this.session.run(query, parameters);
      
      if (result.records.length === 0) {
        return null;
      }

      return updatedArc;
    } catch (error) {
      throw new Error(`Failed to update arc: ${error}`);
    }
  }

  /**
   * Delete an arc by ID
   */
  async delete(id: string): Promise<boolean> {
    const query = `
      MATCH (a:Arc {id: $id})
      DELETE a
      RETURN count(a) as deletedCount
    `;

    try {
      const result = await this.session.run(query, { id });
      const deletedCount = result.records[0]?.get('deletedCount')?.toNumber() || 0;
      return deletedCount > 0;
    } catch (error) {
      throw new Error(`Failed to delete arc: ${error}`);
    }
  }

  /**
   * Count total arcs
   */
  async count(): Promise<number> {
    const query = `
      MATCH (a:Arc)
      RETURN count(a) as total
    `;

    try {
      const result = await this.session.run(query);
      return result.records[0]?.get('total')?.toNumber() || 0;
    } catch (error) {
      throw new Error(`Failed to count arcs: ${error}`);
    }
  }

  /**
   * Count arcs by level
   */
  async countByLevel(level: number): Promise<number> {
    const query = `
      MATCH (a:Arc {level: $level})
      RETURN count(a) as total
    `;

    try {
      const result = await this.session.run(query, { level });
      return result.records[0]?.get('total')?.toNumber() || 0;
    } catch (error) {
      throw new Error(`Failed to count arcs by level: ${error}`);
    }
  }

  /**
   * Check if an arc exists
   */
  async exists(id: string): Promise<boolean> {
    const query = `
      MATCH (a:Arc {id: $id})
      RETURN count(a) > 0 as exists
    `;

    try {
      const result = await this.session.run(query, { id });
      return result.records[0]?.get('exists') || false;
    } catch (error) {
      throw new Error(`Failed to check if arc exists: ${error}`);
    }
  }

  /**
   * Validate temporal boundaries and hierarchy constraints
   */
  private async validateTemporalBoundaries(arc: Arc, excludeId?: string): Promise<void> {
    // Check for hierarchy violations
    const query = `
      MATCH (existing:Arc)
      WHERE existing.id <> $excludeId
        AND (
          // Check for invalid nesting - child arc extends beyond parent
          (existing.level < $level 
           AND existing.start_time <= datetime($start_time) 
           AND existing.end_time >= datetime($end_time)
           AND NOT (datetime($start_time) >= existing.start_time AND datetime($end_time) <= existing.end_time))
          OR
          // Check for invalid parent - parent doesn't fully contain child
          (existing.level > $level 
           AND datetime($start_time) <= existing.start_time 
           AND datetime($end_time) >= existing.end_time
           AND NOT (existing.start_time >= datetime($start_time) AND existing.end_time <= datetime($end_time)))
        )
      RETURN existing.id as conflictId, existing.name as conflictName, existing.level as conflictLevel
      LIMIT 1
    `;

    const parameters = {
      excludeId: excludeId || '',
      level: arc.level,
      start_time: arc.start_time.toISOString(),
      end_time: arc.end_time.toISOString()
    };

    try {
      const result = await this.session.run(query, parameters);
      
      if (result.records.length > 0) {
        const conflict = result.records[0];
        throw new Error(
          `Temporal boundary violation: Arc conflicts with existing arc "${conflict.get('conflictName')}" ` +
          `(ID: ${conflict.get('conflictId')}, Level: ${conflict.get('conflictLevel')})`
        );
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('Temporal boundary violation')) {
        throw error;
      }
      throw new Error(`Failed to validate temporal boundaries: ${error}`);
    }
  }

  /**
   * Alias for findOverlappingArcs for backward compatibility
   */
  async findOverlapping(timeRange: TimeRange, limit?: number, offset?: number): Promise<Arc[]> {
    return this.findOverlappingArcs(timeRange, limit, offset);
  }

  /**
   * Close the session
   */
  async close(): Promise<void> {
    await this.session.close();
  }

  /**
   * Map Neo4j record to Arc instance
   */
  private mapRecordToArc(record: Neo4jRecord): Arc {
    const node = record.get('a') || record.get('child') || record.get('parent');
    const properties = node.properties;

    // Convert Neo4j DateTime to JavaScript Date
    const start_time = properties.start_time.toString ? 
      new Date(properties.start_time.toString()) : 
      new Date(properties.start_time);
    
    const end_time = properties.end_time.toString ? 
      new Date(properties.end_time.toString()) : 
      new Date(properties.end_time);

    return new Arc({
      id: properties.id,
      name: properties.name,
      description: properties.description || undefined,
      start_time,
      end_time,
      level: properties.level.toNumber ? properties.level.toNumber() : properties.level,
      metadata: properties.metadata || {}
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
    const parameters: Record<string, any> = {};

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

    // Build query
    let query = 'MATCH (a:Arc)';
    
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

    try {
      const result = await this.session.run(query, parameters);
      return result.records.map(record => this.mapRecordToArc(record));
    } catch (error) {
      throw new Error(`Failed to search arcs: ${error}`);
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