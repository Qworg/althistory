/**
 * Graph Service for business logic around multi-graph management
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  IGraph,
  CreateGraphRequest,
  UpdateGraphRequest,
  BranchGraphRequest,
  MergeGraphRequest,
  MergeConflict,
  MergeAnomaly,
  MergeResult,
  VersionRef,
  VersionOperation,
  EntityRef,
  ReferenceNotification,
  EntityType,
  ManualResolution,
  findInvalidManualResolutions,
  isManualResolution,
} from '../models/Graph';
import {
  GraphRepository,
  GraphListOptions,
  GraphListResult,
} from '../repositories/GraphRepository';
import { ResolvedGraphData, EntityChanges, StaleVersionError } from '../repositories/VersionRepository';
import { ValidationError, NotFoundError } from '../utils/errors';
import { createLogger, ILogger } from '../utils/logger';

/**
 * How many times a merge is recomputed when a concurrent commit advances the
 * target between the diff and the commit. Bounded so a hot graph cannot spin
 * forever.
 */
const MAX_MERGE_ATTEMPTS = 5;

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
 * Simple in-memory rate limiter for expensive operations
 */
class OperationRateLimiter {
  private operations: Map<string, number[]> = new Map();
  private readonly maxOperations: number;
  private readonly windowMs: number;

  constructor(maxOperations: number = 10, windowMs: number = 60000) {
    this.maxOperations = maxOperations;
    this.windowMs = windowMs;
  }

  canProceed(operationType: string): boolean {
    const now = Date.now();
    const timestamps = this.operations.get(operationType) || [];
    
    // Remove old timestamps outside the window
    const validTimestamps = timestamps.filter(t => now - t < this.windowMs);
    this.operations.set(operationType, validTimestamps);

    return validTimestamps.length < this.maxOperations;
  }

  recordOperation(operationType: string): void {
    const timestamps = this.operations.get(operationType) || [];
    timestamps.push(Date.now());
    this.operations.set(operationType, timestamps);
  }

  getRemainingQuota(operationType: string): number {
    const now = Date.now();
    const timestamps = this.operations.get(operationType) || [];
    const validTimestamps = timestamps.filter(t => now - t < this.windowMs);
    return Math.max(0, this.maxOperations - validTimestamps.length);
  }
}

/**
 * Service for managing graphs with business logic
 */
export class GraphService {
  private readonly graphRepository: GraphRepository;
  private referenceNotifications: ReferenceNotification[] = [];
  private crossGraphReferences: CrossGraphReference[] = [];
  private notificationsPath: string;
  private referencesPath: string;
  private readonly rateLimiter: OperationRateLimiter;
  private readonly logger: ILogger;

  constructor(config: GraphServiceConfig) {
    this.graphRepository = new GraphRepository({ dataDir: config.dataDir });
    this.notificationsPath = path.join(config.dataDir, 'notifications.json');
    this.referencesPath = path.join(config.dataDir, 'cross-references.json');
    // Allow 10 expensive operations per minute
    this.rateLimiter = new OperationRateLimiter(10, 60000);
    this.logger = createLogger('GraphService');
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
   * Merge a source graph into a target graph.
   *
   * SCOPE, stated plainly: this is a TWO-WAY diff of the source tree against the
   * target tree, not a three-way merge. There is no common-ancestor base in the
   * diff. `branchGraph` records the fork point (`IGraph.branchPoint`, the source
   * version a branch started from, recoverable with
   * `checkout(parentGraphId, branchPoint)`), which is the precondition for a
   * three-way merge, but this method does not consult it yet. The consequences,
   * left visible in the result rather than hidden:
   *
   *   * an entity changed on only ONE side differs between the two trees, so it
   *     is reported as a conflict;
   *   * a target-side deletion of an entity the source still has is re-added by
   *     the merge;
   *   * a source-side deletion does not apply, because the deleted entity is
   *     simply absent from the source tree.
   *
   * Both parents are still recorded exactly: the first parent is the target head
   * the diff was computed against (compare-and-swap guarded), and the second
   * parent is the source head the diff was computed against. If the target
   * advances between the read and the commit the commit is refused and the merge
   * is recomputed, so the recorded parents always name the trees that were
   * actually merged.
   */
  async mergeGraph(
    targetGraphId: string,
    request: MergeGraphRequest
  ): Promise<MergeResult> {
    // Rate limit merge operations (expensive)
    if (!this.rateLimiter.canProceed('merge')) {
      throw new ValidationError(
        'Too many merge operations. Please wait before trying again.',
        'rateLimit',
        `Remaining quota: ${this.rateLimiter.getRemainingQuota('merge')}`
      );
    }
    this.rateLimiter.recordOperation('merge');

    const targetGraph = await this.graphRepository.findById(targetGraphId);
    if (!targetGraph) {
      throw new NotFoundError('Target graph not found', 'Graph', targetGraphId);
    }

    const sourceGraph = await this.graphRepository.findById(request.sourceGraphId);
    if (!sourceGraph) {
      throw new NotFoundError('Source graph not found', 'Graph', request.sourceGraphId);
    }

    // Reject malformed manual resolutions before doing any merge work. The
    // merge's fallback resolves anything that is not 'keep-source' as
    // 'keep-target', so accepting an invalid value here would silently discard
    // the source edit -- the same failure the presence check was meant to stop.
    const invalidManualResolutions = findInvalidManualResolutions(request.manualResolutions);
    if (invalidManualResolutions.length > 0) {
      throw new ValidationError(
        'manualResolutions values must be "keep-source" or "keep-target"; ' +
          `invalid entries: ${invalidManualResolutions.join(', ')}`,
        'manualResolutions',
        request.manualResolutions
      );
    }

    const resolution = request.conflictResolution;

    for (let attempt = 0; attempt < MAX_MERGE_ATTEMPTS; attempt++) {
      // Read both heads first, then check out exactly those versions. The
      // versions the merge records as parents are the versions it diffed, not
      // whatever the graphs happen to be at when the commit lands.
      const targetHead = await this.graphRepository.getLatestVersion(targetGraphId);
      const sourceHead = await this.graphRepository.getLatestVersion(request.sourceGraphId);

      const targetData = targetHead
        ? await this.graphRepository.checkout(targetGraphId, targetHead.version)
        : await this.graphRepository.checkout(targetGraphId);
      const sourceData = sourceHead
        ? await this.graphRepository.checkout(request.sourceGraphId, sourceHead.version)
        : await this.graphRepository.checkout(request.sourceGraphId);

      // Detect conflicts
      const conflicts = this.detectMergeConflicts(targetData, sourceData);

      // Compute changes for candidate merged graph
      const candidateChanges = this.calculateMergeChanges(
        targetData,
        sourceData,
        conflicts,
        resolution,
        request.manualResolutions
      );

      // Detect causal cycle and temporal inversion anomalies on candidate graph
      const anomalies = this.detectMergeAnomalies(targetData, sourceData, candidateChanges);

      if (request.dryRun) {
        // Report what a real merge would find without committing anything. This
        // is checked before the manual-resolution requirement because a preview
        // resolves nothing: requiring a resolution map here would force the
        // caller to decide before it has seen the conflicts.
        return {
          success: conflicts.length === 0 && anomalies.length === 0,
          conflicts,
          anomalies,
          mergedGraph: (conflicts.length === 0 && anomalies.length === 0) ? targetGraph.toJSON() : undefined,
          dryRun: true,
        };
      }

      if (anomalies.length > 0) {
        return {
          success: false,
          conflicts,
          anomalies,
        };
      }

      if (conflicts.length > 0) {
        if (resolution === 'manual') {
          // A manual merge resolves nothing on its own, so it is only
          // well-defined when every conflict has a caller-supplied resolution.
          // The VALUE of each entry was validated above; here only its presence
          // per conflict key matters, so a map with the right count of wrong
          // keys is rejected too.
          const manualResolutions = request.manualResolutions ?? {};
          const unresolved = conflicts.filter(
            conflict => !isManualResolution(manualResolutions[`${conflict.entityType}:${conflict.entityId}`])
          );
          if (unresolved.length > 0) {
            return {
              success: false,
              conflicts,
              anomalies,
            };
          }
        } else if (resolution !== 'keep-source' && resolution !== 'keep-target') {
          // No strategy was named. Refusing is deliberate: defaulting to either
          // side would silently discard the other side's edits. `keep-source`
          // and `keep-target` below resolve every conflict uniformly and need no
          // map; a merge with no conflicts needs no strategy at all and is not
          // refused.
          return {
            success: false,
            conflicts,
            anomalies,
          };
        }
      }

      // Apply merge
      const changes = candidateChanges;

      try {
        // The expected parent makes the merge commit's first parent exactly the
        // target version diffed above. Version numbers are allocated per graph,
        // so the second parent carries the graph id; without it the recorded
        // version number would not identify anything. If the target moved, the
        // repository refuses and we recompute from its new head.
        const versionRef = await this.graphRepository.commitChanges(
          targetGraphId,
          changes,
          'merge',
          `Merged from ${sourceGraph.name}`,
          undefined,
          { graphId: request.sourceGraphId, version: sourceHead?.version ?? null },
          targetHead?.version ?? null
        );

        const updatedGraph = await this.graphRepository.findById(targetGraphId);

        return {
          success: true,
          conflicts,
          anomalies: [],
          mergedGraph: updatedGraph?.toJSON(),
          newVersion: versionRef.version,
        };
      } catch (error) {
        if (error instanceof StaleVersionError) {
          // The target advanced after we read it. Recompute against the new
          // head rather than recording a parent we did not diff.
          continue;
        }
        throw error;
      }
    }

    throw new ValidationError(
      `Merge aborted: the target graph changed on every attempt (${MAX_MERGE_ATTEMPTS}); retry the merge`,
      'sourceGraphId'
    );
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
    operation: VersionOperation,
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
      return n.timestamp > cutoffStr;
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
    resolution: 'keep-target' | 'keep-source' | 'manual' | undefined,
    manualResolutions?: Record<string, ManualResolution>
  ): EntityChanges {
    const changes: EntityChanges = {
      added: [],
      modified: [],
      deleted: [],
    };

    // Build conflict resolution map. Values that reach here were validated by
    // mergeGraph; the manual branch sets an entry only for a value that is
    // actually a resolution, so an invalid value can never be coerced into
    // keep-target by this function.
    const resolutionMap = new Map<string, ManualResolution>();
    for (const conflict of conflicts) {
      const key = `${conflict.entityType}:${conflict.entityId}`;
      if (resolution === 'manual') {
        const manual = manualResolutions?.[key];
        if (isManualResolution(manual)) {
          resolutionMap.set(key, manual);
        }
      } else if (resolution === 'keep-source') {
        resolutionMap.set(key, 'keep-source');
      }
      // `keep-target` (and an unset strategy when there are no conflicts) leaves
      // the target value in place, so no map entry is needed.
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
    resolutionMap: Map<string, ManualResolution>,
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
        } else if (typeof resolution === 'object' && resolution !== null && resolution.strategy === 'merged') {
          // Harmonized compromise: blend fields, ensuring entity id remains intact
          const mergedData = { ...targetData, ...resolution.value, id };
          changes.modified.push({ type: entityType, id, data: mergedData });
        }
        // 'keep-target' means no change needed
      }
      // If identical, no change needed
    }
  }

  private detectMergeAnomalies(
    targetData: ResolvedGraphData,
    sourceData: ResolvedGraphData,
    changes: EntityChanges
  ): MergeAnomaly[] {
    const anomalies: MergeAnomaly[] = [];

    // Construct candidate state for events and relationships
    const candidateEvents: Record<string, Record<string, unknown>> = { ...targetData.events };
    const candidateRels: Record<string, Record<string, unknown>> = { ...targetData.relationships };

    for (const add of changes.added) {
      if (add.type === 'event') {
        candidateEvents[add.id] = add.data;
      } else if (add.type === 'relationship') {
        candidateRels[add.id] = add.data;
      }
    }

    for (const mod of changes.modified) {
      if (mod.type === 'event') {
        candidateEvents[mod.id] = mod.data;
      } else if (mod.type === 'relationship') {
        candidateRels[mod.id] = mod.data;
      }
    }

    // 1. Causal cycle detection on candidate relationships
    const adj = new Map<string, string[]>();
    for (const [relId, rel] of Object.entries(candidateRels)) {
      const causeId = (rel.cause_event_id || rel.causeEventId || rel.causeId) as string | undefined;
      const effectId = (rel.effect_event_id || rel.effectEventId || rel.effectId) as string | undefined;
      if (causeId && effectId) {
        if (causeId === effectId) {
          anomalies.push({
            type: 'causal_cycle',
            message: `Self-causation detected: event ${causeId} cannot cause itself`,
            details: { relationshipId: relId, cycle: [causeId, effectId] },
          });
        }
        const list = adj.get(causeId) || [];
        list.push(effectId);
        adj.set(causeId, list);
      }
    }

    // DFS for unique directed cycle detection
    const cycles: string[][] = [];
    const foundCycles = new Set<string>();
    const globalVisited = new Set<string>();

    for (const startNode of adj.keys()) {
      if (globalVisited.has(startNode)) continue;

      const visited = new Set<string>();
      const recursionStack = new Set<string>();
      const path: string[] = [];

      const dfs = (node: string): void => {
        visited.add(node);
        recursionStack.add(node);
        path.push(node);

        const neighbors = adj.get(node) || [];
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            dfs(neighbor);
          } else if (recursionStack.has(neighbor)) {
            const cycleStart = path.indexOf(neighbor);
            const cycle = [...path.slice(cycleStart), neighbor];
            const nodesWithoutEnd = cycle.slice(0, -1);
            if (nodesWithoutEnd.length > 0) {
              const minNode = nodesWithoutEnd.reduce((m, n) => (n < m ? n : m), nodesWithoutEnd[0]);
              const minIdx = nodesWithoutEnd.indexOf(minNode);
              const normalized = [...nodesWithoutEnd.slice(minIdx), ...nodesWithoutEnd.slice(0, minIdx), minNode];
              const cycleKey = normalized.join('->');
              if (!foundCycles.has(cycleKey)) {
                foundCycles.add(cycleKey);
                cycles.push(cycle);
              }
            }
          }
        }

        path.pop();
        recursionStack.delete(node);
      };

      dfs(startNode);
      for (const v of visited) {
        globalVisited.add(v);
      }
    }

    for (const cycle of cycles) {
      anomalies.push({
        type: 'causal_cycle',
        message: `Causal cycle detected: ${cycle.join(' -> ')}`,
        details: { cycle },
      });
    }

    // 2. Temporal inversions & orphan checks
    for (const [relId, rel] of Object.entries(candidateRels)) {
      const causeId = (rel.cause_event_id || rel.causeEventId || rel.causeId) as string | undefined;
      const effectId = (rel.effect_event_id || rel.effectEventId || rel.effectId) as string | undefined;
      if (!causeId || !effectId) continue;

      const cause = candidateEvents[causeId];
      const effect = candidateEvents[effectId];

      if (!cause) {
        anomalies.push({
          type: 'orphan_relationship',
          message: `Causal relationship ${relId} references non-existent cause event ${causeId}`,
          details: { relationshipId: relId, missingEventId: causeId },
        });
      }
      if (!effect) {
        anomalies.push({
          type: 'orphan_relationship',
          message: `Causal relationship ${relId} references non-existent effect event ${effectId}`,
          details: { relationshipId: relId, missingEventId: effectId },
        });
      }

      if (cause && effect) {
        const causeTime = new Date((cause.timestamp || cause.time) as string | number | Date).getTime();
        const effectTime = new Date((effect.timestamp || effect.time) as string | number | Date).getTime();
        if (!isNaN(causeTime) && !isNaN(effectTime) && causeTime >= effectTime) {
          const causeDesc = (cause.description || cause.id || causeId) as string;
          const effectDesc = (effect.description || effect.id || effectId) as string;
          anomalies.push({
            type: 'temporal_inversion',
            message: `Temporal paradox: cause "${causeDesc}" occurs at or after effect "${effectDesc}"`,
            details: {
              relationshipId: relId,
              causeId,
              effectId,
              causeTimestamp: cause.timestamp,
              effectTimestamp: effect.timestamp,
            },
          });
        }
      }
    }

    return anomalies;
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
        id: `notif-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
        type: 'graph_deleted',
        sourceGraphId: graphId,
        targetGraphId: sourceGraphId,
        entityId: affectedRefs.map(r => r.sourceEntityId).join(','),
        entityType: 'event', // Use first type
        message: `Graph "${graphId}" has been deleted. ${affectedRefs.length} cross-graph reference(s) in this graph may be broken.`,
        timestamp: new Date().toISOString(),
        acknowledged: false,
      };
      
      this.referenceNotifications.push(notification);
    }

    // Persist notifications
    if (affectedGraphs.size > 0) {
      await this.saveNotifications();
    }

    // Mark cross-graph references as broken (keep them for reference but note the deletion)
    this.logger.warn('Graph deleted with cross-graph references affected', {
      graphId,
      affectedReferences: referencingGraphs.length,
    });
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
          id: `notif-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
          type: isDeleted ? 'entity_deleted' : 'entity_modified',
          sourceGraphId: graphId,
          targetGraphId: ref.sourceGraphId,
          entityId: ref.targetEntityId,
          entityType: change?.type || ref.targetEntityType,
          message: isDeleted
            ? `Referenced ${ref.targetEntityType} "${ref.targetEntityId}" has been deleted in graph "${graphId}".`
            : `Referenced ${ref.targetEntityType} "${ref.targetEntityId}" has been modified in graph "${graphId}".`,
          timestamp: new Date().toISOString(),
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
