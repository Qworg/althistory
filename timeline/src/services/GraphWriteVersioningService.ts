/**
 * Bridges the live entity stores (EventRepository / ArcRepository / CausalService)
 * to the content-addressed version store (GraphRepository -> VersionRepository).
 *
 * Before this service existed the two stores were disconnected: every normal API
 * write landed in the live store, while ExportService and the version history read
 * exclusively from the version store, which only ImportService and GraphService
 * ever wrote to. A graph built through the UI therefore exported as empty.
 *
 * This is the single place where a live entity is mapped onto the version-store
 * `{ type, id, data }` shape and committed to the graph the caller names. The
 * graph id is an explicit parameter of every public method: the service does not
 * consult the active-graph pointer, because a service that chooses its own target
 * is exactly how a request scoped to graph B ended up versioning into graph A.
 *
 * The event and relationship data shapes deliberately mirror
 * ImportService.commitImport so that versions produced by an import and by a
 * live write are interchangeable. The arc shape mirrors it too, with one
 * unavoidable exception: the live `Arc` model carries no `parent_arc_id`
 * (hierarchy is derived temporally), so a live arc cannot supply one. See
 * `arcToVersionData`.
 *
 * The shared `commit` path is a caller of `GraphRepository.commitChanges`, but
 * it is not the only caller outside import and merge: the public
 * `GraphService.commitChanges` wrapper calls the same repository method too
 * (only tests exercise it today). The "single caller" phrasing in the original
 * commit message for this service was inaccurate.
 */

import { GraphRepository } from '@/repositories/GraphRepository';
import { EntityChanges } from '@/repositories/VersionRepository';
import { EntityType } from '@/models/Graph';
import { Event } from '@/models/Event';
import { Arc } from '@/models/Arc';
import { createLogger, ILogger } from '@/utils/logger';
import { StoredCausalRelationship } from './CausalService';

/** A write to a live entity that should be reflected in one named graph's version. */
export type EntityWriteOperation = 'create' | 'update';

export interface GraphWriteVersioningConfig {
  graphRepository: GraphRepository;
  logger?: ILogger;
}

/**
 * The version-store representation of a single entity write.
 *
 * `data` is omitted for deletes because a delete only needs the identity.
 */
interface VersionEntityWrite {
  type: EntityType;
  id: string;
  data?: Record<string, unknown>;
}

/** Event -> version-store entity. Mirrors ImportService's event data shape. */
function eventToVersionData(event: Event): Record<string, unknown> {
  return {
    id: event.id,
    description: event.description,
    actor: event.actor,
    target: event.target,
    timestamp: event.timestamp,
    metadata: event.metadata,
  };
}

/**
 * Arc -> version-store entity.
 *
 * Mirrors ImportService's arc data shape on every field the live `Arc` model
 * actually has. `parent_arc_id` is intentionally absent: neither `Arc` nor
 * `CreateArcRequest` declares it, and the live store derives arc hierarchy from
 * `level` plus temporal containment, so there is no parent id to persist.
 * ImportService writes `parent_arc_id` because imported data carries it; a live
 * arc persists without the field rather than fabricating a null. This is why the
 * two arc shapes are interchangeable in every field except an absent optional
 * one, not literally identical.
 */
function arcToVersionData(arc: Arc): Record<string, unknown> {
  return {
    id: arc.id,
    name: arc.name,
    description: arc.description,
    start_time: arc.start_time,
    end_time: arc.end_time,
    level: arc.level,
    metadata: arc.metadata,
  };
}

/** Causal relationship -> version-store entity. Mirrors ImportService's relationship shape. */
function relationshipToVersionData(
  relationship: StoredCausalRelationship
): Record<string, unknown> {
  return {
    id: relationship.id,
    cause_event_id: relationship.cause_event_id,
    effect_event_id: relationship.effect_event_id,
    weight: relationship.weight,
    evidence: relationship.evidence,
    confidence: relationship.confidence,
    relationship_type: relationship.relationship_type,
  };
}

export class GraphWriteVersioningService {
  private readonly graphRepository: GraphRepository;
  private readonly logger: ILogger;

  constructor(config: GraphWriteVersioningConfig) {
    this.graphRepository = config.graphRepository;
    this.logger = config.logger ?? createLogger('GraphWriteVersioningService');
  }

  /** Record a created or updated event against one named graph. */
  async recordEvent(
    graphId: string,
    event: Event,
    operation: EntityWriteOperation
  ): Promise<void> {
    await this.commitWrite(graphId, {
      type: 'event',
      id: event.id,
      data: eventToVersionData(event),
    }, operation);
  }

  /** Record a created or updated arc against one named graph. */
  async recordArc(
    graphId: string,
    arc: Arc,
    operation: EntityWriteOperation
  ): Promise<void> {
    await this.commitWrite(graphId, {
      type: 'arc',
      id: arc.id,
      data: arcToVersionData(arc),
    }, operation);
  }

  /** Record a created or updated causal relationship against one named graph. */
  async recordRelationship(
    graphId: string,
    relationship: StoredCausalRelationship,
    operation: EntityWriteOperation
  ): Promise<void> {
    await this.commitWrite(graphId, {
      type: 'relationship',
      id: relationship.id,
      data: relationshipToVersionData(relationship),
    }, operation);
  }

  /**
   * Record the deletion of an entity against one named graph.
   *
   * A live-store delete cascades: `LocalGraphStore.executeDelete` implements
   * every node delete as a DETACH DELETE, removing each relationship incident to
   * the deleted node. The version store has no such cascade, so deleting an event
   * must also record the deletion of every relationship that references it.
   * Without that, checkout() and ExportService keep a relationship pointing at a
   * deleted event — exactly the ORPHAN_REFERENCE state ImportService rejects.
   * The incident ids are read from the version store itself, because that is the
   * state being repaired, and the whole set is committed atomically.
   *
   * No analogue is needed for arcs or relationships through the API: no route
   * creates a relationship incident to an arc, the live `Arc` model has no
   * `parent_arc_id` to cascade, and a relationship delete is a leaf.
   */
  async recordDeletion(graphId: string, type: EntityType, id: string): Promise<void> {
    const deleted: EntityChanges['deleted'] = [{ type, id }];

    if (type === 'event') {
      for (const relationshipId of await this.incidentRelationshipIds(graphId, id)) {
        deleted.push({ type: 'relationship', id: relationshipId });
      }
    }

    await this.commit(
      graphId,
      { added: [], modified: [], deleted },
      'delete',
      `delete ${type} ${id}`
    );
  }

  /**
   * Ids of the version-store relationships referencing `eventId` as either cause
   * or effect. This is the version-store mirror of the live store's relationship
   * cascade on node deletion.
   */
  private async incidentRelationshipIds(graphId: string, eventId: string): Promise<string[]> {
    const data = await this.graphRepository.checkout(graphId);
    return Object.entries(data.relationships)
      .filter(([, rel]) => rel.cause_event_id === eventId || rel.effect_event_id === eventId)
      .map(([id]) => id);
  }

  /** Build the EntityChanges for a create/update and commit via the shared path. */
  private async commitWrite(
    graphId: string,
    write: VersionEntityWrite,
    operation: EntityWriteOperation
  ): Promise<void> {
    // `data` is always set for create/update by the typed wrappers above.
    const entity = { type: write.type, id: write.id, data: write.data ?? {} };
    const changes: EntityChanges = {
      added: operation === 'create' ? [entity] : [],
      modified: operation === 'update' ? [entity] : [],
      deleted: [],
    };

    await this.commit(graphId, changes, operation, `${operation} ${write.type} ${write.id}`);
  }

  /**
   * The single shared commit path for this service.
   *
   * Graph resolution policy: the target graph is a required argument. The service
   * deliberately does not resolve the active graph itself — the caller's graph
   * context (resolved by `resolveGraphContext` middleware and carried on
   * `req.graphId`) is the only correct target for a write, and the active-graph
   * pointer can name a different graph entirely. There is no fallback: a write
   * for graph B versions into graph B even while graph A is active.
   *
   * Failure policy: a version-commit failure is propagated, never swallowed. The
   * live store has already been mutated by the caller, so propagating leaves the
   * API returning an error for a write that did land; that partial failure is
   * deliberate and visible. Silently continuing would recreate the exact defect
   * this service exists to fix (live data that the version store and export never
   * see) and would hide it behind a 2xx response. Callers must treat the surfaced
   * error as "the write is not versioned" and reconcile, e.g. by retrying through
   * the import path.
   *
   * This is the bridge's only call into `GraphRepository.commitChanges`, but it is
   * not the only caller in the codebase: `ImportService.commitImport`,
   * `GraphService.mergeGraph` and the public `GraphService.commitChanges` wrapper
   * also call it. The original commit message's claim that this was "the only
   * caller of commitChanges outside the import and merge paths" was wrong — the
   * wrapper is a fourth caller.
   */
  private async commit(
    graphId: string,
    changes: EntityChanges,
    operation: EntityWriteOperation | 'delete',
    description: string
  ): Promise<void> {
    try {
      await this.graphRepository.commitChanges(graphId, changes, operation, description);
    } catch (error) {
      this.logger.error(`Failed to commit ${description} to graph ${graphId}`, error);
      throw error;
    }
  }
}
