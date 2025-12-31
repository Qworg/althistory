/**
 * Graph Service for business logic around multi-graph management
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  Graph,
  IGraph,
  CreateGraphRequest,
  UpdateGraphRequest,
  BranchGraphRequest,
  MergeGraphRequest,
  MergeConflict,
  MergeResult,
  VersionRef,
  EntityRef,
  ReferenceNotification,
  EntityType,
} from '../models/Graph';
import {
  GraphRepository,
  GraphListOptions,
  GraphListResult,
} from '../repositories/GraphRepository';
import { ResolvedGraphData, EntityChanges } from '../repositories/VersionRepository';
import { ValidationError, NotFoundError } from '../utils/errors';

export interface GraphServiceConfig {
  dataDir: string;
}

/**
 * Cross-graph reference tracking entry
 */
interface CrossGraphReference {
  sourceGraphId: string;
  sourceEntityId: string;
  sourceEntityType: EntityType;
  targetGraphId: string;
  targetEntityId: string;
  targetEntityType: EntityType;
  createdAt: string;
}

/**
 * Service for managing graphs with business logic
 */
export class GraphService {
  private readonly graphRepository: GraphRepository;
  private readonly dataDir: string;
  private referenceNotifications: ReferenceNotification[] = [];
  private crossGraphReferences: CrossGraphReference[] = [];
  private notificationsPath: string;
  private referencesPath: string;

  constructor(config: GraphServiceConfig) {
    this.dataDir = config.dataDir;
    this.graphRepository = new GraphRepository({ dataDir: config.dataDir });
    this.notificationsPath = path.join(config.dataDir, 'notifications.json');
    this.referencesPath = path.join(config.dataDir, 'cross-references.json');
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    await this.graphRepository.initialize();
    
    // Load persisted notifications and references
    await this.loadNotifications();
    await this.loadCrossGraphReferences();
  }

  /**
   * Load notifications from disk
   */
  private async loadNotifications(): Promise<void> {
    try {
      const content = await fs.promises.readFile(this.notificationsPath, 'utf-8');
      this.referenceNotifications = JSON.parse(content);
    } catch {
      // File doesn't exist yet, start with empty array
      this.referenceNotifications = [];
    }
  }

  /**
   * Save notifications to disk
   */
  private async saveNotifications(): Promise<void> {
    await fs.promises.writeFile(
      this.notificationsPath,
      JSON.stringify(this.referenceNotifications, null, 2),
      'utf-8'
    );
  }

  /**
   * Load cross-graph references from disk
   */
  private async loadCrossGraphReferences(): Promise<void> {
    try {
      const content = await fs.promises.readFile(this.referencesPath, 'utf-8');
      this.crossGraphReferences = JSON.parse(content);
    } catch {
      // File doesn't exist yet, start with empty array
      this.crossGraphReferences = [];
    }
  }

  /**
   * Save cross-graph references to disk
   */
  private async saveCrossGraphReferences(): Promise<void> {
    await fs.promises.writeFile(
      this.referencesPath,
      JSON.stringify(this.crossGraphReferences, null, 2),
      'utf-8'
    );
  }

  /**
   * Register a cross-graph reference
   */
  async registerCrossGraphReference(
    sourceGraphId: string,
    sourceEntityId: string,
    sourceEntityType: EntityType,
    targetGraphId: string,
    targetEntityId: string,
    targetEntityType: EntityType
  ): Promise<void> {
    // Check if reference already exists
    const existing = this.crossGraphReferences.find(
      r => r.sourceGraphId === sourceGraphId &&
           r.sourceEntityId === sourceEntityId &&
           r.targetGraphId === targetGraphId &&
           r.targetEntityId === targetEntityId
    );
    
    if (!existing) {
      this.crossGraphReferences.push({
        sourceGraphId,
        sourceEntityId,
        sourceEntityType,
        targetGraphId,
        targetEntityId,
        targetEntityType,
        createdAt: new Date().toISOString(),
      });
      await this.saveCrossGraphReferences();
    }
  }

  /**
   * Get all references to a specific graph
   */
  getReferencesToGraph(graphId: string): CrossGraphReference[] {
    return this.crossGraphReferences.filter(r => r.targetGraphId === graphId);
  }

  /**
   * Get all references from a specific graph
   */
  getReferencesFromGraph(graphId: string): CrossGraphReference[] {
    return this.crossGraphReferences.filter(r => r.sourceGraphId === graphId);
  }

  /**
   * Create a new graph
   */
  async createGraph(request: CreateGraphRequest): Promise<IGraph> {
    // Validate request
    if (!request.name || request.name.trim().length === 0) {
      throw new ValidationError('Graph name is required', 'name');
    }

    const graph = await this.graphRepository.create({
      name: request.name.trim(),
      description: request.description?.trim(),
    });

    return graph.toJSON();
  }

  /**
   * Get a graph by ID
   */
  async getGraph(id: string): Promise<IGraph> {
    const graph = await this.graphRepository.findById(id);
    if (!graph) {
      throw new NotFoundError('Graph not found', 'Graph', id);
    }
    return graph.toJSON();
  }

  /**
   * List all graphs
   */
  async listGraphs(options?: GraphListOptions): Promise<GraphListResult> {
    return this.graphRepository.findAll(options);
  }

  /**
   * Update a graph
   */
  async updateGraph(id: string, request: UpdateGraphRequest): Promise<IGraph> {
    const graph = await this.graphRepository.update(id, {
      name: request.name?.trim(),
      description: request.description?.trim(),
      status: request.status,
    });

    if (!graph) {
      throw new NotFoundError('Graph not found', 'Graph', id);
    }

    return graph.toJSON();
  }

  /**
   * Delete a graph (soft delete)
   */
  async deleteGraph(id: string): Promise<void> {
    const success = await this.graphRepository.delete(id);
    if (!success) {
      throw new NotFoundError('Graph not found', 'Graph', id);
    }

    // Create notifications for any graphs that reference this one
    await this.notifyGraphDeleted(id);
  }

  /**
   * Get the active graph
   */
  async getActiveGraph(): Promise<IGraph | null> {
    const graph = await this.graphRepository.getActiveGraph();
    return graph?.toJSON() || null;
  }

  /**
   * Set the active graph
   */
  async setActiveGraph(id: string): Promise<void> {
    const success = await this.graphRepository.setActiveGraph(id);
    if (!success) {
      throw new ValidationError('Cannot activate graph - not found or not active status', 'id');
    }
  }

  /**
   * Get version history for a graph
   */
  async getVersionHistory(
    graphId: string,
    limit = 50,
    offset = 0
  ): Promise<{ versions: VersionRef[]; total: number }> {
    const graph = await this.graphRepository.findById(graphId);
    if (!graph) {
      throw new NotFoundError('Graph not found', 'Graph', graphId);
    }

    return this.graphRepository.getVersionHistory(graphId, limit, offset);
  }

  /**
   * Rollback a graph to a specific version
   */
  async rollbackGraph(
    graphId: string,
    version: number,
    userId?: string
  ): Promise<VersionRef> {
    const graph = await this.graphRepository.findById(graphId);
    if (!graph) {
      throw new NotFoundError('Graph not found', 'Graph', graphId);
    }

    // Verify the target version exists
    const targetVersion = await this.graphRepository.getVersion(graphId, version);
    if (!targetVersion) {
      throw new NotFoundError('Version not found', 'Version', version.toString());
    }

    return this.graphRepository.rollback(graphId, version, userId);
  }

  /**
   * Branch a graph
   */
  async branchGraph(
    sourceGraphId: string,
    request: BranchGraphRequest
  ): Promise<IGraph> {
    // Validate request
    if (!request.name || request.name.trim().length === 0) {
      throw new ValidationError('Branch name is required', 'name');
    }

    const sourceGraph = await this.graphRepository.findById(sourceGraphId);
    if (!sourceGraph) {
      throw new NotFoundError('Source graph not found', 'Graph', sourceGraphId);
    }

    const branchGraph = await this.graphRepository.branch(
      sourceGraphId,
      request.name.trim(),
      request.description?.trim()
    );

    return branchGraph.toJSON();
  }

  /**
   * Merge a branch back into its parent
   */
  async mergeGraph(
    targetGraphId: string,
    request: MergeGraphRequest
  ): Promise<MergeResult> {
    const targetGraph = await this.graphRepository.findById(targetGraphId);
    if (!targetGraph) {
      throw new NotFoundError('Target graph not found', 'Graph', targetGraphId);
    }

    const sourceGraph = await this.graphRepository.findById(request.sourceGraphId);
    if (!sourceGraph) {
      throw new NotFoundError('Source graph not found', 'Graph', request.sourceGraphId);
    }

    // Get current data from both graphs
    const targetData = await this.graphRepository.checkout(targetGraphId);
    const sourceData = await this.graphRepository.checkout(request.sourceGraphId);

    // Detect conflicts
    const conflicts = this.detectMergeConflicts(targetData, sourceData);

    // If there are conflicts and resolution is not 'manual', check if we can auto-resolve
    if (conflicts.length > 0 && request.conflictResolution !== 'manual') {
      // Auto-resolve based on strategy
      // For now, just return the conflicts
      if (!request.manualResolutions || Object.keys(request.manualResolutions).length !== conflicts.length) {
        return {
          success: false,
          conflicts,
        };
      }
    }

    // Apply merge
    const changes = this.calculateMergeChanges(
      targetData,
      sourceData,
      conflicts,
      request.conflictResolution,
      request.manualResolutions
    );

    // Commit the merge
    const versionRef = await this.graphRepository.commitChanges(
      targetGraphId,
      changes,
      'import', // Using 'import' as the closest operation type
      `Merged from ${sourceGraph.name}`,
      undefined
    );

    const updatedGraph = await this.graphRepository.findById(targetGraphId);

    return {
      success: true,
      mergedGraph: updatedGraph?.toJSON(),
      newVersion: versionRef.version,
    };
  }

  /**
   * Get the full data for a graph
   */
  async getGraphData(graphId: string, version?: number): Promise<ResolvedGraphData> {
    const graph = await this.graphRepository.findById(graphId);
    if (!graph) {
      throw new NotFoundError('Graph not found', 'Graph', graphId);
    }

    return this.graphRepository.checkout(graphId, version);
  }

  /**
   * Commit changes to a graph
   */
  async commitChanges(
    graphId: string,
    changes: EntityChanges,
    operation: 'create' | 'update' | 'delete' | 'import',
    description?: string,
    userId?: string
  ): Promise<VersionRef> {
    const graph = await this.graphRepository.findById(graphId);
    if (!graph) {
      throw new NotFoundError('Graph not found', 'Graph', graphId);
    }

    // Notify about cross-graph reference changes
    await this.checkCrossGraphReferences(graphId, changes);

    return this.graphRepository.commitChanges(
      graphId,
      changes,
      operation,
      description,
      userId
    );
  }

  /**
   * Validate a cross-graph reference
   */
  async validateCrossGraphReference(ref: EntityRef): Promise<boolean> {
    const graph = await this.graphRepository.findById(ref.graphId);
    if (!graph || graph.status !== 'active') {
      return false;
    }

    const data = await this.graphRepository.checkout(ref.graphId);
    
    switch (ref.entityType) {
      case 'event':
        return ref.entityId in data.events;
      case 'arc':
        return ref.entityId in data.arcs;
      default:
        return false;
    }
  }

  /**
   * Get reference notifications for a graph
   */
  async getReferenceNotifications(
    graphId: string,
    unacknowledgedOnly = true
  ): Promise<ReferenceNotification[]> {
    return this.referenceNotifications.filter(n => {
      if (n.targetGraphId !== graphId) return false;
      if (unacknowledgedOnly && n.acknowledged) return false;
      return true;
    });
  }

  /**
   * Acknowledge a reference notification
   */
  async acknowledgeNotification(notificationId: string): Promise<void> {
    const notification = this.referenceNotifications.find(n => n.id === notificationId);
    if (notification) {
      notification.acknowledged = true;
      await this.saveNotifications();
    }
  }

  /**
   * Delete old acknowledged notifications (cleanup)
   */
  async cleanupNotifications(olderThanDays: number = 30): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);
    const cutoffStr = cutoff.toISOString();

    const originalLength = this.referenceNotifications.length;
    this.referenceNotifications = this.referenceNotifications.filter(n => {
      // Keep unacknowledged notifications
      if (!n.acknowledged) return true;
      // Keep recent acknowledged notifications
      return n.createdAt > cutoffStr;
    });

    const removed = originalLength - this.referenceNotifications.length;
    if (removed > 0) {
      await this.saveNotifications();
    }
    return removed;
  }

  /**
   * Run garbage collection on a graph
   */
  async gcGraph(graphId: string): Promise<{ removedObjects: number; freedBytes: number }> {
    const graph = await this.graphRepository.findById(graphId);
    if (!graph) {
      throw new NotFoundError('Graph not found', 'Graph', graphId);
    }

    return this.graphRepository.gc(graphId);
  }

  // Private helper methods

  private detectMergeConflicts(
    target: ResolvedGraphData,
    source: ResolvedGraphData
  ): MergeConflict[] {
    const conflicts: MergeConflict[] = [];

    // Check for conflicts in each entity type
    this.detectTypeConflicts('event', target.events, source.events, conflicts);
    this.detectTypeConflicts('arc', target.arcs, source.arcs, conflicts);
    this.detectTypeConflicts('relationship', target.relationships, source.relationships, conflicts);
    this.detectTypeConflicts('pressure', target.pressures, source.pressures, conflicts);

    return conflicts;
  }

  private detectTypeConflicts(
    entityType: EntityType,
    targetEntities: Record<string, Record<string, unknown>>,
    sourceEntities: Record<string, Record<string, unknown>>,
    conflicts: MergeConflict[]
  ): void {
    for (const [id, sourceData] of Object.entries(sourceEntities)) {
      const targetData = targetEntities[id];
      
      if (targetData && JSON.stringify(targetData) !== JSON.stringify(sourceData)) {
        // Both have the same entity but with different data
        conflicts.push({
          entityType,
          entityId: id,
          sourceVersion: sourceData,
          targetVersion: targetData,
          suggestedResolution: 'keep-target',
        });
      }
    }
  }

  private calculateMergeChanges(
    target: ResolvedGraphData,
    source: ResolvedGraphData,
    conflicts: MergeConflict[],
    resolution: 'keep-target' | 'keep-source' | 'manual',
    manualResolutions?: Record<string, 'keep-target' | 'keep-source'>
  ): EntityChanges {
    const changes: EntityChanges = {
      added: [],
      modified: [],
      deleted: [],
    };

    // Build conflict resolution map
    const resolutionMap = new Map<string, 'keep-target' | 'keep-source'>();
    for (const conflict of conflicts) {
      const key = `${conflict.entityType}:${conflict.entityId}`;
      if (resolution === 'manual' && manualResolutions?.[key]) {
        resolutionMap.set(key, manualResolutions[key]);
      } else {
        resolutionMap.set(key, resolution === 'keep-source' ? 'keep-source' : 'keep-target');
      }
    }

    // Process each entity type
    this.processMergeType('event', target.events, source.events, resolutionMap, changes);
    this.processMergeType('arc', target.arcs, source.arcs, resolutionMap, changes);
    this.processMergeType('relationship', target.relationships, source.relationships, resolutionMap, changes);
    this.processMergeType('pressure', target.pressures, source.pressures, resolutionMap, changes);

    return changes;
  }

  private processMergeType(
    entityType: EntityType,
    targetEntities: Record<string, Record<string, unknown>>,
    sourceEntities: Record<string, Record<string, unknown>>,
    resolutionMap: Map<string, 'keep-target' | 'keep-source'>,
    changes: EntityChanges
  ): void {
    for (const [id, sourceData] of Object.entries(sourceEntities)) {
      const key = `${entityType}:${id}`;
      const targetData = targetEntities[id];

      if (!targetData) {
        // New entity from source
        changes.added.push({ type: entityType, id, data: sourceData });
      } else if (JSON.stringify(targetData) !== JSON.stringify(sourceData)) {
        // Conflict - use resolution
        const resolution = resolutionMap.get(key);
        if (resolution === 'keep-source') {
          changes.modified.push({ type: entityType, id, data: sourceData });
        }
        // 'keep-target' means no change needed
      }
      // If identical, no change needed
    }
  }

  private async notifyGraphDeleted(graphId: string): Promise<void> {
    // Find all graphs that reference this deleted graph
    const referencingGraphs = this.getReferencesToGraph(graphId);
    
    // Group by source graph to create one notification per affected graph
    const affectedGraphs = new Set<string>();
    for (const ref of referencingGraphs) {
      affectedGraphs.add(ref.sourceGraphId);
    }

    // Create notifications for each affected graph
    for (const sourceGraphId of affectedGraphs) {
      const affectedRefs = referencingGraphs.filter(r => r.sourceGraphId === sourceGraphId);
      
      const notification: ReferenceNotification = {
        id: `notif-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: 'graph_deleted',
        sourceGraphId: graphId,
        targetGraphId: sourceGraphId,
        entityId: affectedRefs.map(r => r.sourceEntityId).join(','),
        entityType: 'event', // Use first type
        message: `Graph "${graphId}" has been deleted. ${affectedRefs.length} cross-graph reference(s) in this graph may be broken.`,
        createdAt: new Date().toISOString(),
        acknowledged: false,
      };
      
      this.referenceNotifications.push(notification);
    }

    // Persist notifications
    if (affectedGraphs.size > 0) {
      await this.saveNotifications();
    }

    // Mark cross-graph references as broken (keep them for reference but note the deletion)
    console.warn(`Graph ${graphId} deleted - ${referencingGraphs.length} cross-graph references affected`);
  }

  private async checkCrossGraphReferences(
    graphId: string,
    changes: EntityChanges
  ): Promise<void> {
    // Check modified and deleted entities for cross-graph references
    const modifiedOrDeletedIds = new Set([
      ...changes.modified.map(c => c.id),
      ...changes.deleted.map(c => c.id),
    ]);

    if (modifiedOrDeletedIds.size === 0) return;

    // Find references to this graph's entities
    const referencesToThisGraph = this.getReferencesToGraph(graphId);
    
    // Check if any referenced entities are being modified or deleted
    for (const ref of referencesToThisGraph) {
      if (modifiedOrDeletedIds.has(ref.targetEntityId)) {
        const isDeleted = changes.deleted.some(c => c.id === ref.targetEntityId);
        const change = changes.modified.find(c => c.id === ref.targetEntityId) ||
                       changes.deleted.find(c => c.id === ref.targetEntityId);
        
        // Create notification for the referencing graph
        const notification: ReferenceNotification = {
          id: `notif-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          type: isDeleted ? 'entity_deleted' : 'entity_modified',
          sourceGraphId: graphId,
          targetGraphId: ref.sourceGraphId,
          entityId: ref.targetEntityId,
          entityType: change?.type || ref.targetEntityType,
          message: isDeleted
            ? `Referenced ${ref.targetEntityType} "${ref.targetEntityId}" has been deleted in graph "${graphId}".`
            : `Referenced ${ref.targetEntityType} "${ref.targetEntityId}" has been modified in graph "${graphId}".`,
          createdAt: new Date().toISOString(),
          acknowledged: false,
        };
        
        this.referenceNotifications.push(notification);
      }
    }

    // Persist notifications if any were created
    if (this.referenceNotifications.length > 0) {
      await this.saveNotifications();
    }
  }
}
