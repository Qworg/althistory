/**
 * Graph Service for business logic around multi-graph management
 */

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
import {
  validateMergedEntity,
  describeMergedEntityProblems,
} from './mergedEntityValidation';
import { createLogger, ILogger } from '../utils/logger';
import { isTemporalInversion } from '@/utils/causalOrder';

/**
 * How many times a merge is recomputed when a concurrent commit advances the
 * target between the diff and the commit. Bounded so a hot graph cannot spin
 * forever.
 */
const MAX_MERGE_ATTEMPTS = 5;

/**
 * Whether a record really has a key of its own.
 *
 * A plain truthiness lookup would find `Object.prototype` members, so an id of
 * "constructor" or "toString" would look like an entity that exists.
 */
function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export interface GraphServiceConfig {
  dataDir: string;
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
 * Service for managing graphs with business logic.
 *
 * ## Cross-graph references
 *
 * An event or an arc that points into another graph records it in its own
 * `metadata.crossGraphRefs` array -- that is the one representation for those
 * entities. `ImportService` writes it when it reads `data.crossGraphRefs`,
 * and `ExportService` hoists it back into `data.crossGraphRefs` on the way out
 * (round-trip covered by `ImportService.test.ts` and `ExportService.test.ts`).
 *
 * A causal relationship that reaches into another graph is recorded
 * differently: the relationship itself carries `causeGraphId`/
 * `effectGraphId`. That is a property of the link, not a reference hanging off
 * an entity, and it is validated separately (graph existence).
 *
 * A second, parallel registry used to live here -- `cross-references.json`,
 * `registerCrossGraphReference`, `getReferencesFromGraph`/`ToGraph`, a
 * per-commit scan and a `ReferenceNotification` queue. Nothing wrote it, so it
 * was always empty, and the scans and notifications it drove could never fire.
 * It was removed rather than wired up: the entity metadata is what import and
 * export actually use, and a notification system is a feature, not a cleanup.
 * See `impl/gap-remediation/04-export-contract-conformance.md`.
 */
export class GraphService {
  private readonly graphRepository: GraphRepository;
  private readonly rateLimiter: OperationRateLimiter;
  private readonly logger: ILogger;

  constructor(config: GraphServiceConfig) {
    this.graphRepository = new GraphRepository({ dataDir: config.dataDir });
    // Allow 10 expensive operations per minute
    this.rateLimiter = new OperationRateLimiter(10, 60000);
    this.logger = createLogger('GraphService');
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

      // A blended payload can change any field of the entity it resolves, so
      // it is checked before it is applied: a payload that changes a field's
      // type, drops a field, or renames the entity would otherwise be
      // committed as a graph the rest of the system cannot read.
      //
      // Only a manual merge reads the map at all, so only a manual merge is
      // checked: a leftover entry in a `keep-source` request is ignored, and
      // refusing it would make the request fail for a reason the caller did
      // not ask about.
      if (resolution === 'manual') {
        this.assertMergedPayloadsAreUsable(conflicts, request.manualResolutions);
      }

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

    return this.graphRepository.commitChanges(
      graphId,
      changes,
      operation,
      description,
      userId
    );
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

  /**
   * Refuse a merge whose blended payloads would corrupt an entity.
   *
   * Only conflicts that are being resolved with a blended payload are
   * checked; `keep-target` and `keep-source` cannot corrupt anything, because
   * they copy an entity that already exists.
   */
  private assertMergedPayloadsAreUsable(
    conflicts: MergeConflict[],
    manualResolutions?: Record<string, ManualResolution>
  ): void {
    const problems: string[] = [];

    for (const conflict of conflicts) {
      const key = `${conflict.entityType}:${conflict.entityId}`;
      const resolution = manualResolutions?.[key];
      if (typeof resolution !== 'object' || resolution === null) continue;
      if (resolution.strategy !== 'merged') continue;

      const found = validateMergedEntity(
        conflict.entityType,
        conflict.targetVersion,
        resolution.value,
        conflict.sourceVersion
      );
      if (found.length > 0) {
        problems.push(describeMergedEntityProblems(conflict.entityType, conflict.entityId, found));
      }
    }

    if (problems.length > 0) {
      throw new ValidationError(
        `The merge was refused: ${problems.join('. ')}`,
        'manualResolutions',
        manualResolutions,
        problems
      );
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

    // Construct candidate state for every entity type. Arcs and pressures are
    // included because they carry references too: an arc names its parent, a
    // pressure names the events and arcs it rests on. A blended payload can
    // move those references, so the candidate -- not the target -- is what has
    // to stay consistent.
    const candidateEvents: Record<string, Record<string, unknown>> = { ...targetData.events };
    const candidateRels: Record<string, Record<string, unknown>> = { ...targetData.relationships };
    const candidateArcs: Record<string, Record<string, unknown>> = { ...targetData.arcs };
    const candidatePressures: Record<string, Record<string, unknown>> = { ...targetData.pressures };

    const applyToCandidate = (
      type: string,
      id: string,
      data: Record<string, unknown>
    ): void => {
      if (type === 'event') candidateEvents[id] = data;
      else if (type === 'relationship') candidateRels[id] = data;
      else if (type === 'arc') candidateArcs[id] = data;
      else if (type === 'pressure') candidatePressures[id] = data;
    };

    for (const add of changes.added) {
      applyToCandidate(add.type, add.id, add.data);
    }

    for (const mod of changes.modified) {
      applyToCandidate(mod.type, mod.id, mod.data);
    }

    // Which entities the merge changed. A relationship's checks below are
    // scoped to these: a causal problem that was already in the target is not
    // this merge's doing, and refusing every merge because of it would make
    // the graph unmergeable rather than repairing it. (Editing an event's
    // timestamp can leave an inversion behind, because the paradox check only
    // runs when a link is created.)
    const changedRelIds = new Set([
      ...changes.added.filter((c) => c.type === 'relationship').map((c) => c.id),
      ...changes.modified.filter((c) => c.type === 'relationship').map((c) => c.id),
    ]);
    const changedEventIds = new Set([
      ...changes.added.filter((c) => c.type === 'event').map((c) => c.id),
      ...changes.modified.filter((c) => c.type === 'event').map((c) => c.id),
    ]);

    // 1. Causal cycle detection on candidate relationships
    const adj = new Map<string, string[]>();
    // The relationship each edge came from, so a cycle can be traced back to
    // the relationships involved.
    const edgeSource = new Map<string, string[]>();
    for (const [relId, rel] of Object.entries(candidateRels)) {
      const causeId = (rel.cause_event_id || rel.causeEventId || rel.causeId) as string | undefined;
      const effectId = (rel.effect_event_id || rel.effectEventId || rel.effectId) as string | undefined;
      if (causeId && effectId) {
        if (causeId === effectId && changedRelIds.has(relId)) {
          anomalies.push({
            type: 'causal_cycle',
            message: `Self-causation detected: event ${causeId} cannot cause itself`,
            details: { relationshipId: relId, cycle: [causeId, effectId] },
          });
        }
        const list = adj.get(causeId) || [];
        list.push(effectId);
        adj.set(causeId, list);
        const sources = edgeSource.get(causeId) || [];
        sources.push(relId);
        edgeSource.set(causeId, sources);
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
      // A cycle that the merge did not touch is not this merge's doing.
      const involvesChange = cycle.some(
        (eventId) =>
          changedEventIds.has(eventId) ||
          (edgeSource.get(eventId) ?? []).some((relId) => changedRelIds.has(relId))
      );
      if (!involvesChange) continue;

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

      // The relationship itself changed, or one of its endpoints did: a
      // merged event's new timestamp can invert a relationship nobody touched.
      const affectedByMerge =
        changedRelIds.has(relId) ||
        changedEventIds.has(causeId) ||
        changedEventIds.has(effectId);
      if (!affectedByMerge) continue;

      const cause = candidateEvents[causeId];
      const effect = candidateEvents[effectId];

      if (!cause || !hasOwn(candidateEvents, causeId)) {
        anomalies.push({
          type: 'orphan_relationship',
          message: `Causal relationship ${relId} references non-existent cause event ${causeId}`,
          details: { relationshipId: relId, missingEventId: causeId },
        });
      }
      if (!effect || !hasOwn(candidateEvents, effectId)) {
        anomalies.push({
          type: 'orphan_relationship',
          message: `Causal relationship ${relId} references non-existent effect event ${effectId}`,
          details: { relationshipId: relId, missingEventId: effectId },
        });
      }

      if (cause && effect) {
        const causeTime = new Date((cause.timestamp || cause.time) as string | number | Date).getTime();
        const effectTime = new Date((effect.timestamp || effect.time) as string | number | Date).getTime();
        // The rule lives in `@/utils/causalOrder`, which every other path
        // uses too, so a graph the importer accepts cannot be refused here.
        if (!isNaN(causeTime) && !isNaN(effectTime) && isTemporalInversion(causeTime, effectTime)) {
          const causeDesc = (cause.description || cause.id || causeId) as string;
          const effectDesc = (effect.description || effect.id || effectId) as string;
          anomalies.push({
            type: 'temporal_inversion',
            message: `Temporal paradox: cause "${causeDesc}" occurs after effect "${effectDesc}"`,
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

    // 3. References from arcs and pressures must survive the merge.
    //
    // A relationship's references are checked above, but an arc names its
    // parent arc and a pressure names the events and arcs it rests on. A
    // blended payload can point any of those at an entity that does not
    // exist, which would leave the merged graph referring to nothing.
    //
    // Only entities the merge CHANGED are checked. A reference that was
    // already dangling in the target is not this merge's doing -- deleting an
    // event cascades to relationships but not to pressures, so a graph can
    // carry one -- and refusing every merge because of it would make the
    // graph unmergeable rather than repairing it.
    const changedArcIds = new Set([
      ...changes.added.filter((c) => c.type === 'arc').map((c) => c.id),
      ...changes.modified.filter((c) => c.type === 'arc').map((c) => c.id),
    ]);
    const changedPressureIds = new Set([
      ...changes.added.filter((c) => c.type === 'pressure').map((c) => c.id),
      ...changes.modified.filter((c) => c.type === 'pressure').map((c) => c.id),
    ]);

    for (const arcId of changedArcIds) {
      const arc = candidateArcs[arcId];
      if (!arc) continue;
      const parentId = arc.parent_arc_id;

      // A missing parent is fine (a root arc); a parent that is not an id at
      // all is not.
      if (parentId === undefined || parentId === null) continue;
      if (typeof parentId !== 'string') {
        anomalies.push({
          type: 'orphan_reference',
          message: `Arc ${arcId} has a parent that is not an arc id: ${String(parentId)}`,
          details: { entityType: 'arc', entityId: arcId, missingEntityId: String(parentId) },
        });
        continue;
      }
      if (parentId.length === 0 || !hasOwn(candidateArcs, parentId)) {
        anomalies.push({
          type: 'orphan_reference',
          message: `Arc ${arcId} references non-existent parent arc ${parentId}`,
          details: { entityType: 'arc', entityId: arcId, missingEntityId: parentId },
        });
      }
    }

    for (const pressureId of changedPressureIds) {
      const pressure = candidatePressures[pressureId];
      if (!pressure) continue;

      const evidenceEventIds = pressure.evidence_event_ids;
      if (Array.isArray(evidenceEventIds)) {
        for (const eventId of evidenceEventIds) {
          if (typeof eventId === 'string' && eventId.length > 0 && hasOwn(candidateEvents, eventId)) {
            continue;
          }
          anomalies.push({
            type: 'orphan_reference',
            message: `Pressure ${pressureId} references non-existent event ${String(eventId)}`,
            details: { entityType: 'pressure', entityId: pressureId, missingEntityId: String(eventId) },
          });
        }
      }

      const affectedArcIds = pressure.affected_arc_ids;
      if (Array.isArray(affectedArcIds)) {
        for (const arcId of affectedArcIds) {
          if (typeof arcId === 'string' && arcId.length > 0 && hasOwn(candidateArcs, arcId)) {
            continue;
          }
          anomalies.push({
            type: 'orphan_reference',
            message: `Pressure ${pressureId} references non-existent arc ${String(arcId)}`,
            details: { entityType: 'pressure', entityId: pressureId, missingEntityId: String(arcId) },
          });
        }
      }
    }

    // 4. The arc hierarchy must stay acyclic.
    //
    // `ImportService` refuses a circular arc hierarchy, so a merge that
    // creates one would produce a graph that can no longer be exported and
    // re-imported.
    const arcCycle = this.detectArcHierarchyCycle(candidateArcs, changedArcIds);
    if (arcCycle) {
      anomalies.push({
        type: 'arc_cycle',
        message: `Circular arc reference detected: ${arcCycle.join(' → ')}`,
        details: { cycle: arcCycle },
      });
    }

    return anomalies;
  }

  /**
   * Find a cycle in the arc hierarchy, if the merge created one.
   *
   * Only arcs the merge changed can start a cycle, so the walk starts there.
   */
  private detectArcHierarchyCycle(
    candidateArcs: Record<string, Record<string, unknown>>,
    changedArcIds: Set<string>
  ): string[] | null {
    for (const startId of changedArcIds) {
      const path: string[] = [];
      const seen = new Set<string>();
      let currentId: string | undefined = startId;

      while (currentId !== undefined) {
        if (seen.has(currentId)) {
          const cycleStart = path.indexOf(currentId);
          return [...path.slice(cycleStart), currentId];
        }
        seen.add(currentId);
        path.push(currentId);

        // The annotations matter: `currentId` is assigned from the arc below,
        // so without them TypeScript cannot narrow the types and reports a
        // circular inference.
        const arc: Record<string, unknown> | undefined = candidateArcs[currentId];
        if (!arc) break;
        const parentId: unknown = arc.parent_arc_id;
        if (typeof parentId !== 'string' || parentId.length === 0) break;
        currentId = parentId;
      }
    }

    return null;
  }
}
