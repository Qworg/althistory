import { Session, Integer } from 'neo4j-driver';
import { TimeRange } from '../models/Event';
import { getDatabaseManager } from '../utils/database';

/**
 * Result of a graph copy operation
 */
export interface CopyResult {
  sourceGraphId: string;
  targetGraphId: string;
  copiedNodes: number;
  copiedRelationships: number;
  duration: number;
  success: boolean;
  errors?: string[];
}

/**
 * Entity filter for subset copying
 */
export interface EntityFilter {
  actors?: string[];
  targets?: string[];
  eventTypes?: string[];
  arcLevels?: number[];
}

/**
 * Query parameters built by `getNodesMatchingFilter`: scalars for the graph id
 * and arrays for the `IN` predicates.
 */
type EntityFilterQueryParameters = string | number | string[] | number[];

/**
 * Integrity report for copy validation
 */
export interface IntegrityReport {
  isValid: boolean;
  missingNodes: string[];
  missingRelationships: string[];
  orphanedRelationships: string[];
  violations: string[];
}

/**
 * Progress tracking for copy operations
 */
export interface CopyProgress {
  totalNodes: number;
  copiedNodes: number;
  totalRelationships: number;
  copiedRelationships: number;
  currentBatch: number;
  totalBatches: number;
  percentage: number;
}

/**
 * Copy operation configuration
 */
export interface CopyConfig {
  batchSize: number;
  progressCallback?: (progress: CopyProgress) => void;
  preserveIds: boolean;
  validateIntegrity: boolean;
}

/**
 * Service for managing graph duplication and subset operations
 */
export class GraphCopyService {
  private session: Session;
  private readonly DEFAULT_BATCH_SIZE = 1000;

  constructor(session?: Session) {
    this.session = session || getDatabaseManager().getNeo4jSession();
  }

  /**
   * Copy entire graph with all nodes and relationships
   */
  async copyFullGraph(
    sourceGraphId: string, 
    targetGraphId: string,
    config: Partial<CopyConfig> = {}
  ): Promise<CopyResult> {
    const startTime = Date.now();
    const copyConfig: CopyConfig = {
      batchSize: config.batchSize || this.DEFAULT_BATCH_SIZE,
      progressCallback: config.progressCallback,
      preserveIds: config.preserveIds ?? false,
      validateIntegrity: config.validateIntegrity ?? true
    };

    const result: CopyResult = {
      sourceGraphId,
      targetGraphId,
      copiedNodes: 0,
      copiedRelationships: 0,
      duration: 0,
      success: false,
      errors: []
    };

    try {
      // Get total counts for progress tracking
      const totalCounts = await this.getTotalCounts(sourceGraphId);
      
      // Copy nodes in batches
      const nodeResult = await this.copyAllNodes(sourceGraphId, targetGraphId, copyConfig, totalCounts);
      result.copiedNodes = nodeResult.copiedCount;
      result.errors?.push(...(nodeResult.errors || []));

      // Copy relationships in batches
      const relationshipResult = await this.copyAllRelationships(sourceGraphId, targetGraphId, copyConfig, totalCounts);
      result.copiedRelationships = relationshipResult.copiedCount;
      result.errors?.push(...(relationshipResult.errors || []));

      result.success = result.errors?.length === 0;
      result.duration = Date.now() - startTime;

      // Validate integrity if requested
      if (copyConfig.validateIntegrity && result.success) {
        const integrityReport = await this.validateCopyIntegrity(result);
        if (!integrityReport.isValid) {
          result.success = false;
          result.errors?.push(...integrityReport.violations);
        }
      }

      return result;
    } catch (error) {
      result.success = false;
      result.duration = Date.now() - startTime;
      result.errors?.push(`Copy operation failed: ${error}`);
      return result;
    }
  }

  /**
   * Copy subset of graph by time range
   */
  async copyByTimeRange(
    sourceGraphId: string, 
    timeRange: TimeRange, 
    targetGraphId: string,
    config: Partial<CopyConfig> = {}
  ): Promise<CopyResult> {
    const startTime = Date.now();
    const copyConfig: CopyConfig = {
      batchSize: config.batchSize || this.DEFAULT_BATCH_SIZE,
      progressCallback: config.progressCallback,
      preserveIds: config.preserveIds ?? false,
      validateIntegrity: config.validateIntegrity ?? true
    };

    const result: CopyResult = {
      sourceGraphId,
      targetGraphId,
      copiedNodes: 0,
      copiedRelationships: 0,
      duration: 0,
      success: false,
      errors: []
    };

    try {
      // Get nodes that intersect with the time range
      const nodeIds = await this.getNodesInTimeRange(sourceGraphId, timeRange);
      
      // Copy filtered nodes in batches
      const nodeResult = await this.copyFilteredNodes(sourceGraphId, targetGraphId, nodeIds, copyConfig);
      result.copiedNodes = nodeResult.copiedCount;
      result.errors?.push(...(nodeResult.errors || []));

      // Copy relationships that connect the copied nodes
      const relationshipResult = await this.copyFilteredRelationships(sourceGraphId, targetGraphId, nodeIds, copyConfig);
      result.copiedRelationships = relationshipResult.copiedCount;
      result.errors?.push(...(relationshipResult.errors || []));

      result.success = result.errors?.length === 0;
      result.duration = Date.now() - startTime;

      // Validate integrity if requested
      if (copyConfig.validateIntegrity && result.success) {
        const integrityReport = await this.validateCopyIntegrity(result);
        if (!integrityReport.isValid) {
          result.success = false;
          result.errors?.push(...integrityReport.violations);
        }
      }

      return result;
    } catch (error) {
      result.success = false;
      result.duration = Date.now() - startTime;
      result.errors?.push(`Time range copy operation failed: ${error}`);
      return result;
    }
  }

  /**
   * Copy subset of graph by entity filter
   */
  async copyByEntityFilter(
    sourceGraphId: string, 
    filter: EntityFilter, 
    targetGraphId: string,
    config: Partial<CopyConfig> = {}
  ): Promise<CopyResult> {
    const startTime = Date.now();
    const copyConfig: CopyConfig = {
      batchSize: config.batchSize || this.DEFAULT_BATCH_SIZE,
      progressCallback: config.progressCallback,
      preserveIds: config.preserveIds ?? false,
      validateIntegrity: config.validateIntegrity ?? true
    };

    const result: CopyResult = {
      sourceGraphId,
      targetGraphId,
      copiedNodes: 0,
      copiedRelationships: 0,
      duration: 0,
      success: false,
      errors: []
    };

    try {
      // Get nodes that match the entity filter
      const nodeIds = await this.getNodesMatchingFilter(sourceGraphId, filter);
      
      // Copy filtered nodes in batches
      const nodeResult = await this.copyFilteredNodes(sourceGraphId, targetGraphId, nodeIds, copyConfig);
      result.copiedNodes = nodeResult.copiedCount;
      result.errors?.push(...(nodeResult.errors || []));

      // Copy relationships that connect the copied nodes
      const relationshipResult = await this.copyFilteredRelationships(sourceGraphId, targetGraphId, nodeIds, copyConfig);
      result.copiedRelationships = relationshipResult.copiedCount;
      result.errors?.push(...(relationshipResult.errors || []));

      result.success = result.errors?.length === 0;
      result.duration = Date.now() - startTime;

      // Validate integrity if requested
      if (copyConfig.validateIntegrity && result.success) {
        const integrityReport = await this.validateCopyIntegrity(result);
        if (!integrityReport.isValid) {
          result.success = false;
          result.errors?.push(...integrityReport.violations);
        }
      }

      return result;
    } catch (error) {
      result.success = false;
      result.duration = Date.now() - startTime;
      result.errors?.push(`Entity filter copy operation failed: ${error}`);
      return result;
    }
  }

  /**
   * Validate integrity of copied graph
   */
  async validateCopyIntegrity(copyResult: CopyResult): Promise<IntegrityReport> {
    const report: IntegrityReport = {
      isValid: true,
      missingNodes: [],
      missingRelationships: [],
      orphanedRelationships: [],
      violations: []
    };

    try {
      // Check for missing nodes by comparing counts
      const sourceNodeCounts = await this.getNodeCounts(copyResult.sourceGraphId);
      const targetNodeCounts = await this.getNodeCounts(copyResult.targetGraphId);

      for (const [nodeType, sourceCount] of Object.entries(sourceNodeCounts)) {
        const targetCount = targetNodeCounts[nodeType] || 0;
        if (sourceCount !== targetCount) {
          report.missingNodes.push(`${nodeType}: expected ${sourceCount}, found ${targetCount}`);
          report.isValid = false;
        }
      }

      // Check for missing relationships by comparing counts
      const sourceRelCounts = await this.getRelationshipCounts(copyResult.sourceGraphId);
      const targetRelCounts = await this.getRelationshipCounts(copyResult.targetGraphId);

      for (const [relType, sourceCount] of Object.entries(sourceRelCounts)) {
        const targetCount = targetRelCounts[relType] || 0;
        if (sourceCount !== targetCount) {
          report.missingRelationships.push(`${relType}: expected ${sourceCount}, found ${targetCount}`);
          report.isValid = false;
        }
      }

      // Check for orphaned relationships (relationships without valid endpoints)
      const orphanedRels = await this.findOrphanedRelationships(copyResult.targetGraphId);
      if (orphanedRels.length > 0) {
        report.orphanedRelationships = orphanedRels;
        report.isValid = false;
      }

      // Compile violations summary
      if (!report.isValid) {
        report.violations = [
          ...report.missingNodes.map(msg => `Missing nodes: ${msg}`),
          ...report.missingRelationships.map(msg => `Missing relationships: ${msg}`),
          ...report.orphanedRelationships.map(msg => `Orphaned relationship: ${msg}`)
        ];
      }

      return report;
    } catch (error) {
      report.isValid = false;
      report.violations.push(`Integrity validation failed: ${error}`);
      return report;
    }
  }

  /**
   * Get total counts for progress tracking
   */
  private async getTotalCounts(graphId: string): Promise<{ nodes: number; relationships: number }> {
    const nodeQuery = `
      MATCH (n)
      WHERE n.graphId = $graphId OR $graphId = 'default'
      RETURN count(n) as totalNodes
    `;

    const relQuery = `
      MATCH ()-[r]->()
      WHERE (startNode(r).graphId = $graphId OR $graphId = 'default')
        AND (endNode(r).graphId = $graphId OR $graphId = 'default')
      RETURN count(r) as totalRelationships
    `;

    try {
      const [nodeResult, relResult] = await Promise.all([
        this.session.run(nodeQuery, { graphId }),
        this.session.run(relQuery, { graphId })
      ]);

      return {
        nodes: nodeResult.records[0]?.get('totalNodes')?.toNumber() || 0,
        relationships: relResult.records[0]?.get('totalRelationships')?.toNumber() || 0
      };
    } catch (error) {
      throw new Error(`Failed to get total counts: ${error}`);
    }
  }

  /**
   * Copy all nodes in batches
   */
  private async copyAllNodes(
    sourceGraphId: string,
    targetGraphId: string,
    config: CopyConfig,
    totalCounts: { nodes: number; relationships: number }
  ): Promise<{ copiedCount: number; errors: string[] }> {
    const errors: string[] = [];
    let copiedCount = 0;
    let offset = 0;
    const totalBatches = Math.ceil(totalCounts.nodes / config.batchSize);

    while (offset < totalCounts.nodes) {
      try {
        const batchResult = await this.copyNodeBatch(sourceGraphId, targetGraphId, config.batchSize, offset, config.preserveIds);
        copiedCount += batchResult.copiedCount;
        
        if (batchResult.errors.length > 0) {
          errors.push(...batchResult.errors);
        }

        // Report progress
        if (config.progressCallback) {
          const currentBatch = Math.floor(offset / config.batchSize) + 1;
          config.progressCallback({
            totalNodes: totalCounts.nodes,
            copiedNodes: copiedCount,
            totalRelationships: totalCounts.relationships,
            copiedRelationships: 0,
            currentBatch,
            totalBatches,
            percentage: Math.round((copiedCount / totalCounts.nodes) * 50) // 50% for nodes
          });
        }

        offset += config.batchSize;
      } catch (error) {
        errors.push(`Node batch copy failed at offset ${offset}: ${error}`);
        break;
      }
    }

    return { copiedCount, errors };
  }

  /**
   * Copy all relationships in batches
   */
  private async copyAllRelationships(
    sourceGraphId: string,
    targetGraphId: string,
    config: CopyConfig,
    totalCounts: { nodes: number; relationships: number }
  ): Promise<{ copiedCount: number; errors: string[] }> {
    const errors: string[] = [];
    let copiedCount = 0;
    let offset = 0;
    const totalBatches = Math.ceil(totalCounts.relationships / config.batchSize);

    while (offset < totalCounts.relationships) {
      try {
        const batchResult = await this.copyRelationshipBatch(sourceGraphId, targetGraphId, config.batchSize, offset);
        copiedCount += batchResult.copiedCount;
        
        if (batchResult.errors.length > 0) {
          errors.push(...batchResult.errors);
        }

        // Report progress
        if (config.progressCallback) {
          const currentBatch = Math.floor(offset / config.batchSize) + 1;
          config.progressCallback({
            totalNodes: totalCounts.nodes,
            copiedNodes: totalCounts.nodes, // Nodes already copied
            totalRelationships: totalCounts.relationships,
            copiedRelationships: copiedCount,
            currentBatch,
            totalBatches,
            percentage: 50 + Math.round((copiedCount / totalCounts.relationships) * 50) // 50% + relationships
          });
        }

        offset += config.batchSize;
      } catch (error) {
        errors.push(`Relationship batch copy failed at offset ${offset}: ${error}`);
        break;
      }
    }

    return { copiedCount, errors };
  }

  /**
   * Copy a batch of nodes
   */
  private async copyNodeBatch(
    sourceGraphId: string,
    targetGraphId: string,
    batchSize: number,
    offset: number,
    preserveIds: boolean
  ): Promise<{ copiedCount: number; errors: string[] }> {
    const query = `
      MATCH (n)
      WHERE n.graphId = $sourceGraphId OR $sourceGraphId = 'default'
      WITH n
      ORDER BY id(n)
      SKIP $offset LIMIT $batchSize
      
      CALL {
        WITH n
        WITH n, labels(n) as nodeLabels, properties(n) as props
        WITH n, nodeLabels, 
             CASE WHEN $preserveIds 
                  THEN props 
                  ELSE apoc.map.removeKey(props, 'id') 
             END as finalProps
        
        CALL apoc.create.node(nodeLabels, 
          apoc.map.setKey(finalProps, 'graphId', $targetGraphId)) 
        YIELD node as newNode
        RETURN count(newNode) as created
      }
      RETURN sum(created) as totalCreated
    `;

    const parameters = {
      sourceGraphId,
      targetGraphId,
      batchSize: Integer.fromNumber(batchSize),
      offset: Integer.fromNumber(offset),
      preserveIds
    };

    try {
      const result = await this.session.run(query, parameters);
      const copiedCount = result.records[0]?.get('totalCreated')?.toNumber() || 0;
      return { copiedCount, errors: [] };
    } catch (error) {
      return { copiedCount: 0, errors: [`Node batch copy failed: ${error}`] };
    }
  }

  /**
   * Copy a batch of relationships
   */
  private async copyRelationshipBatch(
    sourceGraphId: string,
    targetGraphId: string,
    batchSize: number,
    offset: number
  ): Promise<{ copiedCount: number; errors: string[] }> {
    const query = `
      MATCH (source)-[r]->(target)
      WHERE (source.graphId = $sourceGraphId OR $sourceGraphId = 'default')
        AND (target.graphId = $sourceGraphId OR $sourceGraphId = 'default')
      WITH r, source, target
      ORDER BY id(r)
      SKIP $offset LIMIT $batchSize
      
      MATCH (newSource), (newTarget)
      WHERE newSource.graphId = $targetGraphId 
        AND newTarget.graphId = $targetGraphId
        AND (
          (newSource.id = source.id AND newTarget.id = target.id) OR
          (newSource.description = source.description AND newSource.actor = source.actor AND
           newTarget.description = target.description AND newTarget.actor = target.actor)
        )
      
      CALL apoc.create.relationship(newSource, type(r), properties(r), newTarget)
      YIELD rel
      RETURN count(rel) as totalCreated
    `;

    const parameters = {
      sourceGraphId,
      targetGraphId,
      batchSize: Integer.fromNumber(batchSize),
      offset: Integer.fromNumber(offset)
    };

    try {
      const result = await this.session.run(query, parameters);
      const copiedCount = result.records[0]?.get('totalCreated')?.toNumber() || 0;
      return { copiedCount, errors: [] };
    } catch (error) {
      return { copiedCount: 0, errors: [`Relationship batch copy failed: ${error}`] };
    }
  }

  /**
   * Get node counts by type for integrity validation
   */
  private async getNodeCounts(graphId: string): Promise<Record<string, number>> {
    const query = `
      MATCH (n)
      WHERE n.graphId = $graphId OR $graphId = 'default'
      WITH labels(n) as nodeLabels
      UNWIND nodeLabels as label
      RETURN label, count(*) as count
    `;

    try {
      const result = await this.session.run(query, { graphId });
      const counts: Record<string, number> = {};
      
      for (const record of result.records) {
        const label = record.get('label');
        const count = record.get('count');
        const countValue = typeof count === 'object' && count.toNumber ? count.toNumber() : count;
        counts[label] = countValue;
      }
      
      return counts;
    } catch (error) {
      throw new Error(`Failed to get node counts: ${error}`);
    }
  }

  /**
   * Get relationship counts by type for integrity validation
   */
  private async getRelationshipCounts(graphId: string): Promise<Record<string, number>> {
    const query = `
      MATCH ()-[r]->()
      WHERE (startNode(r).graphId = $graphId OR $graphId = 'default')
        AND (endNode(r).graphId = $graphId OR $graphId = 'default')
      RETURN type(r) as relType, count(r) as count
    `;

    try {
      const result = await this.session.run(query, { graphId });
      const counts: Record<string, number> = {};
      
      for (const record of result.records) {
        const relType = record.get('relType');
        const count = record.get('count');
        const countValue = typeof count === 'object' && count.toNumber ? count.toNumber() : count;
        counts[relType] = countValue;
      }
      
      return counts;
    } catch (error) {
      throw new Error(`Failed to get relationship counts: ${error}`);
    }
  }

  /**
   * Find orphaned relationships (relationships without valid endpoints)
   */
  private async findOrphanedRelationships(graphId: string): Promise<string[]> {
    const query = `
      MATCH (start)-[r]->(end)
      WHERE start.graphId = $graphId AND end.graphId = $graphId
      WITH r, start, end
      WHERE start IS NULL OR end IS NULL
      RETURN type(r) + ' relationship with missing endpoint' as orphan
      LIMIT 100
    `;

    try {
      const result = await this.session.run(query, { graphId });
      return result.records.map(record => record.get('orphan'));
    } catch (error) {
      throw new Error(`Failed to find orphaned relationships: ${error}`);
    }
  }

  /**
   * Get node IDs that intersect with the given time range
   */
  private async getNodesInTimeRange(graphId: string, timeRange: TimeRange): Promise<string[]> {
    const query = `
      MATCH (n)
      WHERE n.graphId = $graphId OR $graphId = 'default'
      AND (
        // Events within time range
        (n:Event AND n.timestamp >= datetime($startTime) AND n.timestamp <= datetime($endTime))
        OR
        // Arcs that overlap with time range
        (n:Arc AND n.start_time < datetime($endTime) AND n.end_time > datetime($startTime))
        OR
        // InferredPressures (include all for now, could be filtered by related arcs)
        (n:InferredPressure)
      )
      RETURN n.id as nodeId
    `;

    const parameters = {
      graphId,
      startTime: timeRange.start.toISOString(),
      endTime: timeRange.end.toISOString()
    };

    try {
      const result = await this.session.run(query, parameters);
      return result.records.map(record => record.get('nodeId'));
    } catch (error) {
      throw new Error(`Failed to get nodes in time range: ${error}`);
    }
  }

  /**
   * Get node IDs that match the entity filter
   */
  private async getNodesMatchingFilter(graphId: string, filter: EntityFilter): Promise<string[]> {
    const conditions: string[] = [];
    const parameters: Record<string, EntityFilterQueryParameters> = { graphId };

    // Build filter conditions
    if (filter.actors && filter.actors.length > 0) {
      conditions.push('(n:Event AND n.actor IN $actors)');
      parameters.actors = filter.actors;
    }

    if (filter.targets && filter.targets.length > 0) {
      conditions.push('(n:Event AND n.target IN $targets)');
      parameters.targets = filter.targets;
    }

    if (filter.arcLevels && filter.arcLevels.length > 0) {
      conditions.push('(n:Arc AND n.level IN $arcLevels)');
      parameters.arcLevels = filter.arcLevels;
    }

    // If no specific filters, include all nodes
    if (conditions.length === 0) {
      conditions.push('true');
    }

    const query = `
      MATCH (n)
      WHERE (n.graphId = $graphId OR $graphId = 'default')
      AND (${conditions.join(' OR ')})
      RETURN n.id as nodeId
    `;

    try {
      const result = await this.session.run(query, parameters);
      return result.records.map(record => record.get('nodeId'));
    } catch (error) {
      throw new Error(`Failed to get nodes matching filter: ${error}`);
    }
  }

  /**
   * Copy filtered nodes in batches
   */
  private async copyFilteredNodes(
    sourceGraphId: string,
    targetGraphId: string,
    nodeIds: string[],
    config: CopyConfig
  ): Promise<{ copiedCount: number; errors: string[] }> {
    const errors: string[] = [];
    let copiedCount = 0;
    let offset = 0;
    const totalBatches = Math.ceil(nodeIds.length / config.batchSize);

    while (offset < nodeIds.length) {
      try {
        const batchNodeIds = nodeIds.slice(offset, offset + config.batchSize);
        const batchResult = await this.copyNodeBatchByIds(sourceGraphId, targetGraphId, batchNodeIds, config.preserveIds);
        copiedCount += batchResult.copiedCount;
        
        if (batchResult.errors.length > 0) {
          errors.push(...batchResult.errors);
        }

        // Report progress
        if (config.progressCallback) {
          const currentBatch = Math.floor(offset / config.batchSize) + 1;
          config.progressCallback({
            totalNodes: nodeIds.length,
            copiedNodes: copiedCount,
            totalRelationships: 0, // Will be updated in relationship phase
            copiedRelationships: 0,
            currentBatch,
            totalBatches,
            percentage: Math.round((copiedCount / nodeIds.length) * 50) // 50% for nodes
          });
        }

        offset += config.batchSize;
      } catch (error) {
        errors.push(`Filtered node batch copy failed at offset ${offset}: ${error}`);
        break;
      }
    }

    return { copiedCount, errors };
  }

  /**
   * Copy relationships that connect the filtered nodes
   */
  private async copyFilteredRelationships(
    sourceGraphId: string,
    targetGraphId: string,
    nodeIds: string[],
    config: CopyConfig
  ): Promise<{ copiedCount: number; errors: string[] }> {
    const errors: string[] = [];
    let copiedCount = 0;
    let offset = 0;
    
    // Get relationships between the filtered nodes
    const relationshipIds = await this.getRelationshipsBetweenNodes(sourceGraphId, nodeIds);
    const totalBatches = Math.ceil(relationshipIds.length / config.batchSize);

    while (offset < relationshipIds.length) {
      try {
        const batchRelIds = relationshipIds.slice(offset, offset + config.batchSize);
        const batchResult = await this.copyRelationshipBatchByIds(sourceGraphId, targetGraphId, batchRelIds);
        copiedCount += batchResult.copiedCount;
        
        if (batchResult.errors.length > 0) {
          errors.push(...batchResult.errors);
        }

        // Report progress
        if (config.progressCallback) {
          const currentBatch = Math.floor(offset / config.batchSize) + 1;
          config.progressCallback({
            totalNodes: nodeIds.length,
            copiedNodes: nodeIds.length, // Nodes already copied
            totalRelationships: relationshipIds.length,
            copiedRelationships: copiedCount,
            currentBatch,
            totalBatches,
            percentage: 50 + Math.round((copiedCount / relationshipIds.length) * 50) // 50% + relationships
          });
        }

        offset += config.batchSize;
      } catch (error) {
        errors.push(`Filtered relationship batch copy failed at offset ${offset}: ${error}`);
        break;
      }
    }

    return { copiedCount, errors };
  }

  /**
   * Copy a batch of nodes by their IDs
   */
  private async copyNodeBatchByIds(
    sourceGraphId: string,
    targetGraphId: string,
    nodeIds: string[],
    preserveIds: boolean
  ): Promise<{ copiedCount: number; errors: string[] }> {
    const query = `
      MATCH (n)
      WHERE (n.graphId = $sourceGraphId OR $sourceGraphId = 'default')
        AND n.id IN $nodeIds
      
      CALL {
        WITH n
        WITH n, labels(n) as nodeLabels, properties(n) as props
        WITH n, nodeLabels, 
             CASE WHEN $preserveIds 
                  THEN props 
                  ELSE apoc.map.removeKey(props, 'id') 
             END as finalProps
        
        CALL apoc.create.node(nodeLabels, 
          apoc.map.setKey(finalProps, 'graphId', $targetGraphId)) 
        YIELD node as newNode
        RETURN count(newNode) as created
      }
      RETURN sum(created) as totalCreated
    `;

    const parameters = {
      sourceGraphId,
      targetGraphId,
      nodeIds,
      preserveIds
    };

    try {
      const result = await this.session.run(query, parameters);
      const copiedCount = result.records[0]?.get('totalCreated')?.toNumber() || 0;
      return { copiedCount, errors: [] };
    } catch (error) {
      return { copiedCount: 0, errors: [`Node batch copy by IDs failed: ${error}`] };
    }
  }

  /**
   * Get relationship IDs between the specified nodes
   */
  private async getRelationshipsBetweenNodes(graphId: string, nodeIds: string[]): Promise<string[]> {
    const query = `
      MATCH (source)-[r]->(target)
      WHERE (source.graphId = $graphId OR $graphId = 'default')
        AND (target.graphId = $graphId OR $graphId = 'default')
        AND source.id IN $nodeIds
        AND target.id IN $nodeIds
      RETURN id(r) as relId
    `;

    try {
      const result = await this.session.run(query, { graphId, nodeIds });
      return result.records.map(record => record.get('relId').toString());
    } catch (error) {
      throw new Error(`Failed to get relationships between nodes: ${error}`);
    }
  }

  /**
   * Copy a batch of relationships by their IDs
   */
  private async copyRelationshipBatchByIds(
    sourceGraphId: string,
    targetGraphId: string,
    relationshipIds: string[]
  ): Promise<{ copiedCount: number; errors: string[] }> {
    const query = `
      MATCH (source)-[r]->(target)
      WHERE (source.graphId = $sourceGraphId OR $sourceGraphId = 'default')
        AND (target.graphId = $sourceGraphId OR $sourceGraphId = 'default')
        AND id(r) IN $relationshipIds
      
      MATCH (newSource), (newTarget)
      WHERE newSource.graphId = $targetGraphId 
        AND newTarget.graphId = $targetGraphId
        AND newSource.id = source.id 
        AND newTarget.id = target.id
      
      CALL apoc.create.relationship(newSource, type(r), properties(r), newTarget)
      YIELD rel
      RETURN count(rel) as totalCreated
    `;

    const parameters = {
      sourceGraphId,
      targetGraphId,
      relationshipIds: relationshipIds.map(id => parseInt(id))
    };

    try {
      const result = await this.session.run(query, parameters);
      const copiedCount = result.records[0]?.get('totalCreated')?.toNumber() || 0;
      return { copiedCount, errors: [] };
    } catch (error) {
      return { copiedCount: 0, errors: [`Relationship batch copy by IDs failed: ${error}`] };
    }
  }

  /**
   * Close the session
   */
  async close(): Promise<void> {
    await this.session.close();
  }
}