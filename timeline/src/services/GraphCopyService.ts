import { AsyncLocalStorage } from 'node:async_hooks';
import { Session, Integer } from 'neo4j-driver';
import { TimeRange } from '../models/Event';
import { getDatabaseManager } from '../utils/database';
import { runTemporal } from '../utils/temporal';

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
 * What the `beforeCopy` hook can ask of the live copy. A partial copy can leave an arc without its
 * parent; the version it recorded gives that arc no parent and a level of its own, and the live copy
 * is made to say the same.
 */
export interface CopyPlan {
  arcs?: ReadonlyMap<string, { parent: string | null; level: number }>;
  /** How many events and arcs the copy's first version holds (pressures are not versioned). */
  versionedNodes?: number;
}

/**
 * Copy operation configuration
 */
export interface CopyConfig {
  batchSize: number;
  progressCallback?: (progress: CopyProgress) => void;
  preserveIds: boolean;
  validateIntegrity: boolean;
  /**
   * Called once the nodes to copy are known and before the live store is written: with the keys
   * (`Label:id`, because an event and an arc may share an id) they carry (null: every node of the source). The route records the copy's first version here,
   * so a copy that fails to be versioned writes nothing, as a branch records its version first.
   */
  beforeCopy?: (selected: ReadonlySet<string> | null) => Promise<CopyPlan | void>;
}

function toNumericCount(val: unknown): number {
  if (val === null || val === undefined) {
    return 0;
  }
  if (typeof val === 'number') {
    return val;
  }
  if (typeof val === 'bigint') {
    return Number(val);
  }
  if (typeof val === 'object' && 'toNumber' in val && typeof (val as { toNumber: () => number }).toNumber === 'function') {
    return (val as { toNumber: () => number }).toNumber();
  }
  const parsed = Number(val);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Service for managing graph duplication and subset operations
 */
export class GraphCopyService {
  /** A session handed in by the caller (tests); the caller closes it. */
  private readonly injected?: Session;
  /**
   * The session of the operation running now. A service that lives as long as
   * the process must not keep one session for life: a request that times out
   * has its session abandoned, and every later copy would fail on it.
   */
  private readonly operation = new AsyncLocalStorage<Session>();
  private readonly DEFAULT_BATCH_SIZE = 1000;

  constructor(session?: Session) {
    this.injected = session;
  }

  private get session(): Session {
    const session = this.operation.getStore() ?? this.injected;
    if (!session) throw new Error('GraphCopyService: no session for this operation');
    return session;
  }

  /** Run one public operation on its own session, closed when it ends. */
  private async withSession<T>(work: () => Promise<T>): Promise<T> {
    if (this.injected || this.operation.getStore()) return work();
    const session = getDatabaseManager().getNeo4jSession() as unknown as Session;
    try {
      return await this.operation.run(session, work);
    } finally {
      await session.close().catch(() => undefined);
    }
  }

  /**
   * Copy entire graph with all nodes and relationships
   */
  copyFullGraph(sourceGraphId: string, targetGraphId: string, config: Partial<CopyConfig> = {}): Promise<CopyResult> {
    return this.withSession(() => this.runCopyFullGraph(sourceGraphId, targetGraphId, config));
  }

  private async runCopyFullGraph(
    sourceGraphId: string, 
    targetGraphId: string,
    config: Partial<CopyConfig> = {}
  ): Promise<CopyResult> {
    const startTime = Date.now();
    const copyConfig: CopyConfig = {
      batchSize: config.batchSize || this.DEFAULT_BATCH_SIZE,
      progressCallback: config.progressCallback,
      preserveIds: config.preserveIds ?? true,
      validateIntegrity: config.validateIntegrity ?? true,
      beforeCopy: config.beforeCopy
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
      await copyConfig.beforeCopy?.(null);
      
      // Copy nodes in batches
      const nodeResult = await this.copyAllNodes(sourceGraphId, targetGraphId, copyConfig, totalCounts);
      result.copiedNodes = nodeResult.copiedCount;
      result.errors?.push(...(nodeResult.errors || []));

      // Copy relationships in batches
      const relationshipResult = await this.copyAllRelationships(sourceGraphId, targetGraphId, copyConfig, totalCounts);
      result.copiedRelationships = relationshipResult.copiedCount;
      result.errors?.push(...(relationshipResult.errors || []));
      await this.dropSourceMarkers(targetGraphId, result);

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
  copyByTimeRange(sourceGraphId: string, timeRange: TimeRange, targetGraphId: string, config: Partial<CopyConfig> = {}): Promise<CopyResult> {
    return this.withSession(() => this.runCopyByTimeRange(sourceGraphId, timeRange, targetGraphId, config));
  }

  private async runCopyByTimeRange(
    sourceGraphId: string, 
    timeRange: TimeRange, 
    targetGraphId: string,
    config: Partial<CopyConfig> = {}
  ): Promise<CopyResult> {
    const startTime = Date.now();
    const copyConfig: CopyConfig = {
      batchSize: config.batchSize || this.DEFAULT_BATCH_SIZE,
      progressCallback: config.progressCallback,
      preserveIds: config.preserveIds ?? true,
      validateIntegrity: config.validateIntegrity ?? true,
      beforeCopy: config.beforeCopy
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
      const selected = new Set(nodeIds.filter((id): id is string => typeof id === 'string'));
      const plan = await copyConfig.beforeCopy?.(selected);
      
      // Copy filtered nodes in batches
      const nodeResult = await this.copyFilteredNodes(sourceGraphId, targetGraphId, nodeIds, copyConfig);
      result.copiedNodes = nodeResult.copiedCount;
      result.errors?.push(...(nodeResult.errors || []));
      await this.applyArcPlan(targetGraphId, plan, copyConfig, result);

      // Copy relationships that connect the copied nodes
      const relationshipResult = await this.copyFilteredRelationships(sourceGraphId, targetGraphId, nodeIds, copyConfig);
      result.copiedRelationships = relationshipResult.copiedCount;
      result.errors?.push(...(relationshipResult.errors || []));
      await this.dropSourceMarkers(targetGraphId, result);

      result.success = result.errors?.length === 0;
      result.duration = Date.now() - startTime;

      // Validate integrity if requested: against what was selected, not against the whole source
      if (copyConfig.validateIntegrity && result.success) {
        const integrityReport = await this.validatePartialCopy(result, selected.size, relationshipResult.expectedCount);
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
  copyByEntityFilter(sourceGraphId: string, filter: EntityFilter, targetGraphId: string, config: Partial<CopyConfig> = {}): Promise<CopyResult> {
    return this.withSession(() => this.runCopyByEntityFilter(sourceGraphId, filter, targetGraphId, config));
  }

  private async runCopyByEntityFilter(
    sourceGraphId: string, 
    filter: EntityFilter, 
    targetGraphId: string,
    config: Partial<CopyConfig> = {}
  ): Promise<CopyResult> {
    const startTime = Date.now();
    const copyConfig: CopyConfig = {
      batchSize: config.batchSize || this.DEFAULT_BATCH_SIZE,
      progressCallback: config.progressCallback,
      preserveIds: config.preserveIds ?? true,
      validateIntegrity: config.validateIntegrity ?? true,
      beforeCopy: config.beforeCopy
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
      const selected = new Set(nodeIds.filter((id): id is string => typeof id === 'string'));
      const plan = await copyConfig.beforeCopy?.(selected);
      
      // Copy filtered nodes in batches
      const nodeResult = await this.copyFilteredNodes(sourceGraphId, targetGraphId, nodeIds, copyConfig);
      result.copiedNodes = nodeResult.copiedCount;
      result.errors?.push(...(nodeResult.errors || []));
      await this.applyArcPlan(targetGraphId, plan, copyConfig, result);

      // Copy relationships that connect the copied nodes
      const relationshipResult = await this.copyFilteredRelationships(sourceGraphId, targetGraphId, nodeIds, copyConfig);
      result.copiedRelationships = relationshipResult.copiedCount;
      result.errors?.push(...(relationshipResult.errors || []));
      await this.dropSourceMarkers(targetGraphId, result);

      result.success = result.errors?.length === 0;
      result.duration = Date.now() - startTime;

      // Validate integrity if requested: against what was selected, not against the whole source
      if (copyConfig.validateIntegrity && result.success) {
        const integrityReport = await this.validatePartialCopy(result, selected.size, relationshipResult.expectedCount);
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
  validateCopyIntegrity(copyResult: CopyResult): Promise<IntegrityReport> {
    return this.withSession(() => this.runValidateCopyIntegrity(copyResult));
  }

  private async runValidateCopyIntegrity(copyResult: CopyResult): Promise<IntegrityReport> {
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

      // A source with no nodes is copied as a graph with no nodes: nothing is missing.
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
      const nodeResult = await this.session.run(nodeQuery, { graphId });
      const relResult = await this.session.run(relQuery, { graphId });

      return {
        nodes: toNumericCount(nodeResult.records[0]?.get('totalNodes')),
        relationships: toNumericCount(relResult.records[0]?.get('totalRelationships'))
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
   * Make the live arcs of a partial copy say what the version recorded for them: an arc whose parent
   * was not copied has no parent (`metadata.parentArcId` removed) and the level the plan gives it.
   */
  private async applyArcPlan(
    targetGraphId: string,
    plan: CopyPlan | void,
    config: CopyConfig,
    result: CopyResult
  ): Promise<void> {
    if (!plan?.arcs || plan.arcs.size === 0 || !config.preserveIds) return;
    const rows = [...plan.arcs].map(([id, placement]) => ({
      id,
      parent: placement.parent,
      level: Integer.fromNumber(placement.level)
    }));
    try {
      await this.session.run(
        `UNWIND $rows AS row
         MATCH (a:Arc {graphId: $targetGraphId, id: row.id})
         WITH a, row, coalesce(apoc.convert.fromJsonMap(CASE WHEN a.metadata IS NULL OR a.metadata = '' THEN '{}' ELSE a.metadata END), {}) AS meta
         SET a.level = row.level,
             a.metadata = apoc.convert.toJson(
               CASE WHEN row.parent IS NULL
                    THEN apoc.map.removeKey(meta, 'parentArcId')
                    ELSE apoc.map.setKey(meta, 'parentArcId', row.parent) END)`,
        { rows, targetGraphId }
      );
    } catch (error) {
      result.errors?.push(`Placing the copied arcs failed: ${error}`);
    }
  }

  /**
   * Integrity of a partial copy: the target holds as many nodes and relationships as the selection named
   * (counted by label, so the graph index answers), and no relationship lacks an endpoint.
   */
  private async validatePartialCopy(
    copyResult: CopyResult,
    expectedNodes: number,
    expectedRelationships: number
  ): Promise<IntegrityReport> {
    const report: IntegrityReport = { isValid: true, missingNodes: [], missingRelationships: [], orphanedRelationships: [], violations: [] };
    try {
      const labels = ['Event', 'Arc', 'InferredPressure'];
      const nodeQuery = labels.map((label) => `MATCH (n:${label} {graphId: $graphId}) RETURN count(n) AS total`).join(' UNION ALL ');
      const relationshipQuery = labels.map((label) => `MATCH (n:${label} {graphId: $graphId})-[r]->() RETURN count(r) AS total`).join(' UNION ALL ');
      const sum = async (query: string): Promise<number> => {
        const answer = await this.session.run(query, { graphId: copyResult.targetGraphId });
        return answer.records.reduce((total, record) => total + toNumericCount(record.get('total')), 0);
      };
      const nodes = await sum(nodeQuery);
      if (nodes !== expectedNodes) report.missingNodes.push(`selected ${expectedNodes}, found ${nodes}`);
      const relationships = await sum(relationshipQuery);
      if (relationships !== expectedRelationships) report.missingRelationships.push(`selected ${expectedRelationships}, found ${relationships}`);
      const orphans = await this.findOrphanedRelationships(copyResult.targetGraphId);
      if (orphans.length > 0) report.orphanedRelationships = orphans;
      report.isValid = report.missingNodes.length === 0 && report.missingRelationships.length === 0 && orphans.length === 0;
      if (!report.isValid) {
        report.violations = [
          ...report.missingNodes.map((msg) => `Missing nodes: ${msg}`),
          ...report.missingRelationships.map((msg) => `Missing relationships: ${msg}`),
          ...report.orphanedRelationships.map((msg) => `Orphaned relationship: ${msg}`)
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
   * Remove the `_sourceNodeId` the node pass leaves on every copied node. It only exists to join the
   * relationship pass to the nodes it copied; left in place it would be a property of the copy's entities.
   */
  private async dropSourceMarkers(targetGraphId: string, result: CopyResult): Promise<void> {
    try {
      await this.session.run(
        'MATCH (n) WHERE n.graphId = $targetGraphId AND n._sourceNodeId IS NOT NULL REMOVE n._sourceNodeId',
        { targetGraphId }
      );
    } catch (error) {
      result.errors?.push(`Removing the copy markers failed: ${error}`);
    }
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

    if (totalCounts.relationships === 0 && config.progressCallback) {
      config.progressCallback({
        totalNodes: totalCounts.nodes,
        copiedNodes: totalCounts.nodes,
        totalRelationships: 0,
        copiedRelationships: 0,
        currentBatch: 1,
        totalBatches: 1,
        percentage: 100
      });
    }

    while (offset < totalCounts.relationships) {
      try {
        const batchResult = await this.copyRelationshipBatch(sourceGraphId, targetGraphId, config.batchSize, offset, config.preserveIds);
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
   * Copy a batch of nodes. Events and arcs keep their ids (they are unique per graph, #35); an
   * InferredPressure is given a new one, because its id constraint is still database-wide.
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
             CASE WHEN 'InferredPressure' IN nodeLabels AND $preserveIds
                  THEN apoc.map.setKey(props, 'id', randomUUID())
                  WHEN $preserveIds 
                  THEN props 
                  ELSE apoc.map.removeKey(props, 'id') 
             END as finalProps
        
        CALL apoc.create.node(nodeLabels, 
          apoc.map.setKey(
            apoc.map.setKey(finalProps, 'graphId', $targetGraphId),
            '_sourceNodeId', id(n)
          )) 
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
      const result = await runTemporal(this.session, query, parameters);
      const copiedCount = toNumericCount(result.records[0]?.get('totalCreated'));
      return { copiedCount, errors: [] };
    } catch (error) {
      return { copiedCount: 0, errors: [`Node batch copy failed: ${error}`] };
    }
  }

  /**
   * Cypher that finds, in the target graph, the node a source node was copied to (`newSource` or `newTarget`).
   *
   * By the node's label and its kept `(graphId, id)`, so the composite constraint's index answers
   * it: a join of two unlabelled `MATCH`es on `_sourceNodeId` was a cartesian product of two
   * all-node scans per relationship, and a copy of a hundred linked events ran out of its time.
   * Only an InferredPressure (it gets a new id) and a copy that drops ids are found by the marker,
   * and then within one label of the target graph.
   */
  private targetNodeJoin(variable: 'source' | 'target', preserveIds: boolean): string {
    const byId = (label: string): string => `
        WITH ${variable}
        WITH ${variable} WHERE '${label}' IN labels(${variable})
        MATCH (n:${label} {graphId: $targetGraphId, id: ${variable}.id})
        RETURN n`;
    const byMarker = (label: string): string => `
        WITH ${variable}
        WITH ${variable} WHERE '${label}' IN labels(${variable})
        MATCH (n:${label} {graphId: $targetGraphId})
        WHERE n._sourceNodeId = id(${variable})
        RETURN n`;
    const branches = preserveIds
      ? [byId('Event'), byId('Arc'), byMarker('InferredPressure')]
      : [byMarker('Event'), byMarker('Arc'), byMarker('InferredPressure')];
    return `CALL {${branches.join('\n        UNION')}
      }
      WITH r, ${variable === 'source' ? 'source, target, n AS newSource' : 'source, target, newSource, n AS newTarget'}`;
  }

  /**
   * Copy a batch of relationships
   */
  private async copyRelationshipBatch(
    sourceGraphId: string,
    targetGraphId: string,
    batchSize: number,
    offset: number,
    preserveIds = true
  ): Promise<{ copiedCount: number; errors: string[] }> {
    // The edge is stamped with the target graph, not the source's: copying the
    // source properties verbatim would carry the source graph id onto an edge in
    // the target graph, where a scoped read would then never find it (#59).
    const query = `
      MATCH (source)-[r]->(target)
      WHERE (source.graphId = $sourceGraphId OR $sourceGraphId = 'default')
        AND (target.graphId = $sourceGraphId OR $sourceGraphId = 'default')
      WITH r, source, target
      ORDER BY id(r)
      SKIP $offset LIMIT $batchSize
      
      ${this.targetNodeJoin('source', preserveIds)}
      ${this.targetNodeJoin('target', preserveIds)}

      CALL apoc.create.relationship(
        newSource,
        type(r),
        apoc.map.setKey(properties(r), 'graphId', $targetGraphId),
        newTarget
      )
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
      const result = await runTemporal(this.session, query, parameters);
      const copiedCount = toNumericCount(result.records[0]?.get('totalCreated'));
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
        counts[label] = toNumericCount(count);
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
        counts[relType] = toNumericCount(count);
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
   * Get the keys (`Label:id`) of the nodes that intersect with the given time range. An event and an arc may
   * hold the same id, so a node is named by its label and its id together.
   */
  private async getNodesInTimeRange(graphId: string, timeRange: TimeRange): Promise<string[]> {
    const query = `
      MATCH (n)
      WHERE (n.graphId = $graphId OR $graphId = 'default')
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
      RETURN head([l IN labels(n) WHERE l IN ['Event', 'Arc', 'InferredPressure']]) + ':' + n.id AS nodeKey
    `;

    const parameters = {
      graphId,
      startTime: timeRange.start.toISOString(),
      endTime: timeRange.end.toISOString()
    };

    try {
      const result = await runTemporal(this.session, query, parameters);
      return result.records.map(record => record.get('nodeKey'));
    } catch (error) {
      throw new Error(`Failed to get nodes in time range: ${error}`);
    }
  }

  /**
   * Get the keys (`Label:id`) of the nodes that match the entity filter
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
      RETURN head([l IN labels(n) WHERE l IN ['Event', 'Arc', 'InferredPressure']]) + ':' + n.id AS nodeKey
    `;

    try {
      const result = await runTemporal(this.session, query, parameters);
      return result.records.map(record => record.get('nodeKey'));
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
  ): Promise<{ copiedCount: number; errors: string[]; expectedCount: number }> {
    const errors: string[] = [];
    let copiedCount = 0;
    let offset = 0;
    
    // Get relationships between the filtered nodes
    const relationshipIds = await this.getRelationshipsBetweenNodes(sourceGraphId, nodeIds);
    const totalBatches = Math.ceil(relationshipIds.length / config.batchSize);

    if (relationshipIds.length === 0 && config.progressCallback) {
      config.progressCallback({
        totalNodes: nodeIds.length,
        copiedNodes: nodeIds.length,
        totalRelationships: 0,
        copiedRelationships: 0,
        currentBatch: 1,
        totalBatches: 1,
        percentage: 100
      });
    }

    while (offset < relationshipIds.length) {
      try {
        const batchRelIds = relationshipIds.slice(offset, offset + config.batchSize);
        const batchResult = await this.copyRelationshipBatchByIds(sourceGraphId, targetGraphId, batchRelIds, config.preserveIds);
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

    return { copiedCount, errors, expectedCount: relationshipIds.length };
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
        AND any(l IN labels(n) WHERE (l + ':' + n.id) IN $nodeIds)
      
      CALL {
        WITH n
        WITH n, labels(n) as nodeLabels, properties(n) as props
        WITH n, nodeLabels, 
             CASE WHEN 'InferredPressure' IN nodeLabels AND $preserveIds
                  THEN apoc.map.setKey(props, 'id', randomUUID())
                  WHEN $preserveIds 
                  THEN props 
                  ELSE apoc.map.removeKey(props, 'id') 
             END as finalProps
        
        CALL apoc.create.node(nodeLabels, 
          apoc.map.setKey(
            apoc.map.setKey(finalProps, 'graphId', $targetGraphId),
            '_sourceNodeId', id(n)
          )) 
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
      const result = await runTemporal(this.session, query, parameters);
      const copiedCount = toNumericCount(result.records[0]?.get('totalCreated'));
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
        AND any(l IN labels(source) WHERE (l + ':' + source.id) IN $nodeIds)
        AND any(l IN labels(target) WHERE (l + ':' + target.id) IN $nodeIds)
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
    relationshipIds: string[],
    preserveIds = true
  ): Promise<{ copiedCount: number; errors: string[] }> {
    const query = `
      MATCH (source)-[r]->(target)
      WHERE (source.graphId = $sourceGraphId OR $sourceGraphId = 'default')
        AND (target.graphId = $sourceGraphId OR $sourceGraphId = 'default')
        AND id(r) IN $relationshipIds
      
      ${this.targetNodeJoin('source', preserveIds)}
      ${this.targetNodeJoin('target', preserveIds)}

      CALL apoc.create.relationship(
        newSource,
        type(r),
        apoc.map.setKey(properties(r), 'graphId', $targetGraphId),
        newTarget
      )
      YIELD rel
      RETURN count(rel) as totalCreated
    `;

    const parameters = {
      sourceGraphId,
      targetGraphId,
      relationshipIds: relationshipIds.map(id => parseInt(id))
    };

    try {
      const result = await runTemporal(this.session, query, parameters);
      const copiedCount = toNumericCount(result.records[0]?.get('totalCreated'));
      return { copiedCount, errors: [] };
    } catch (error) {
      return { copiedCount: 0, errors: [`Relationship batch copy by IDs failed: ${error}`] };
    }
  }

  /**
   * Close the session handed to the constructor (operations close their own)
   */
  async close(): Promise<void> {
    await this.injected?.close();
  }
}