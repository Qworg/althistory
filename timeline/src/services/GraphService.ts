/**
 * Graph Service for business logic around multi-graph management
 */

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
 * Service for managing graphs with business logic
 */
export class GraphService {
  private readonly graphRepository: GraphRepository;
  private referenceNotifications: ReferenceNotification[] = [];

  constructor(config: GraphServiceConfig) {
    this.graphRepository = new GraphRepository({ dataDir: config.dataDir });
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    await this.graphRepository.initialize();
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
    }
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
    // In a real implementation, we'd scan all graphs for references to this one
    // For now, we just log a warning
    console.warn(`Graph ${graphId} deleted - cross-graph references may be broken`);
  }

  private async checkCrossGraphReferences(
    graphId: string,
    changes: EntityChanges
  ): Promise<void> {
    // Check modified and deleted entities for cross-graph references
    // In a real implementation, we'd maintain an index of cross-graph references
    // and create notifications for affected graphs

    for (const change of [...changes.modified, ...changes.deleted]) {
      // Create notification if this entity is referenced by other graphs
      // This is a placeholder - real implementation would need a reference index
    }
  }
}
