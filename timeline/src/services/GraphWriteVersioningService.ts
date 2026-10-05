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
 * The data shapes deliberately mirror ImportService.commitImport so that versions
 * produced by an import and by a live write are interchangeable.
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

/** Arc -> version-store entity. Mirrors ImportService's arc data shape. */
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

  /** Record the deletion of an entity against one named graph. */
  async recordDeletion(graphId: string, type: EntityType, id: string): Promise<void> {
    await this.commitWrite(graphId, { type, id }, 'delete');
  }

  /**
   * The single shared commit path.
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
   */
  private async commitWrite(
    graphId: string,
    write: VersionEntityWrite,
    operation: EntityWriteOperation | 'delete'
  ): Promise<void> {
    const changes: EntityChanges = { added: [], modified: [], deleted: [] };
    if (operation === 'delete') {
      changes.deleted.push({ type: write.type, id: write.id });
    } else {
      // `data` is always set for create/update by the typed wrappers above.
      const entity = { type: write.type, id: write.id, data: write.data ?? {} };
      if (operation === 'create') {
        changes.added.push(entity);
      } else {
        changes.modified.push(entity);
      }
    }

    try {
      await this.graphRepository.commitChanges(
        graphId,
        changes,
        operation,
        `${operation} ${write.type} ${write.id}`
      );
    } catch (error) {
      this.logger.error(
        `Failed to commit ${operation} ${write.type} ${write.id} to graph ${graphId}`,
        error
      );
      throw error;
    }
  }
}
