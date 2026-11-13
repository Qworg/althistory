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

import { toInstant } from '@althistory/calendar';
import { GraphRepository } from '@/repositories/GraphRepository';
import { EntityChanges } from '@/repositories/VersionRepository';
import { EntityType } from '@/models/Graph';
import { Event } from '@/models/Event';
import { Arc } from '@/models/Arc';
import { createLogger, ILogger } from '@/utils/logger';
import { StoredCausalRelationship } from './CausalService';
import { type WorldCalendarSet, dateCalendarOf, datePrecisionOf, formatHistoricalDateAt } from '@althistory/calendar';

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

/**
 * What Version history shows for a write. These used to be
 * `${operation} ${type} ${id}` ("create relationship local_179366…"), which
 * put internal ids in front of people. A summary names the entity by what a
 * person calls it; when the name cannot be read, it says what kind of thing
 * changed and still leaves the id out.
 */
const NAME_LIMIT = 80;

function quote(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  const clipped = trimmed.length > NAME_LIMIT ? `${trimmed.slice(0, NAME_LIMIT - 1).trimEnd()}…` : trimmed;
  return `“${clipped}”`;
}

function entityName(type: EntityType, data: Record<string, unknown> | undefined): string | null {
  if (!data) return null;
  return type === 'arc' ? quote(data.name) : quote(data.description);
}

function sameInstant(a: unknown, b: unknown): boolean {
  const ta = toInstant(a as string).getTime();
  const tb = toInstant(b as string).getTime();
  return Number.isFinite(ta) && Number.isFinite(tb) ? ta === tb : a === b;
}

const NOUN: Record<EntityType, string> = {
  event: 'event',
  arc: 'arc',
  relationship: 'link',
  pressure: 'pressure',
};

const ARTICLE: Record<EntityType, string> = {
  event: 'an event',
  arc: 'an arc',
  relationship: 'a link',
  pressure: 'a pressure',
};

const VERB: Record<EntityWriteOperation | 'delete', string> = {
  create: 'Added',
  update: 'Edited',
  delete: 'Deleted',
};

/** The data a summary is written from; every field is optional. */
export interface EntityWriteContext {
  /** The entity as written (absent for a delete). */
  data?: Record<string, unknown>;
  /** The entity as the head held it before the write (update and delete). */
  previous?: Record<string, unknown>;
  /** For a link: its cause and effect events, as the head holds them. */
  cause?: Record<string, unknown>;
  effect?: Record<string, unknown>;
  /** For an event delete: how many links went with it. */
  cascadedLinks?: number;
  /** The graph's world calendars, so a moved date is named as the world names it. */
  calendar?: WorldCalendarSet;
}

/**
 * One line for Version history, e.g. "Added event “Census of 1851”",
 * "Moved “Battle of Hastings” to Oct 14, 1066", "Added link: “Census of 1851”
 * → “Clerks' protest”", "Deleted event “X” and its 2 links".
 */
export function describeEntityWrite(
  operation: EntityWriteOperation | 'delete',
  type: EntityType,
  context: EntityWriteContext = {}
): string {
  const verb = VERB[operation];

  if (type === 'relationship') {
    const cause = entityName('event', context.cause);
    const effect = entityName('event', context.effect);
    return cause && effect ? `${verb} link: ${cause} → ${effect}` : `${verb} a link`;
  }

  const current = context.data ?? context.previous;
  const name = entityName(type, current);
  if (!name) return `${verb} ${ARTICLE[type]}`;

  if (operation === 'update' && context.data && context.previous) {
    const before = context.previous;
    const after = context.data;
    if (type === 'event') {
      const moved = !sameInstant(before.timestamp, after.timestamp);
      const renamed = entityName(type, before) !== name;
      const otherChange = before.actor !== after.actor || before.target !== after.target;
      if (moved && !renamed && !otherChange) {
        // At the precision it is known to, in the calendar it was given in.
        const metadata = (after.metadata ?? undefined) as Record<string, unknown> | undefined;
        return `Moved ${name} to ${formatHistoricalDateAt(after.timestamp as string, datePrecisionOf(metadata), 'en-US', context.calendar ?? null, dateCalendarOf(metadata))}`;
      }
      if (renamed && !moved && !otherChange) {
        return `Renamed event ${entityName(type, before)} to ${name}`;
      }
    }
    if (type === 'arc' && entityName(type, before) !== name) {
      return `Renamed arc ${entityName(type, before)} to ${name}`;
    }
  }

  if (operation === 'delete' && type === 'event' && context.cascadedLinks) {
    const links = context.cascadedLinks === 1 ? 'its link' : `its ${context.cascadedLinks} links`;
    return `Deleted event ${name} and ${links}`;
  }

  return `${verb} ${NOUN[type]} ${name}`;
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

    const previous = (await this.headEntities(graphId, type, [id]))[id];
    const context: EntityWriteContext = { previous, cascadedLinks: deleted.length - 1 };
    if (type === 'relationship' && previous) {
      Object.assign(context, await this.linkEnds(graphId, previous));
    }

    await this.commit(
      graphId,
      { added: [], modified: [], deleted },
      'delete',
      describeEntityWrite('delete', type, context)
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

    const context: EntityWriteContext = { data: entity.data };
    if (operation === 'update') {
      context.previous = (await this.headEntities(graphId, write.type, [write.id]))[write.id];
      if (write.type === 'event') context.calendar = (await this.graphRepository.findById(graphId).catch(() => null))?.calendar;
    }
    if (write.type === 'relationship') {
      Object.assign(context, await this.linkEnds(graphId, entity.data));
    }

    await this.commit(graphId, changes, operation, describeEntityWrite(operation, write.type, context));
  }

  /** A link's cause and effect events, as the head holds them. */
  private async linkEnds(
    graphId: string,
    relationship: Record<string, unknown>
  ): Promise<Pick<EntityWriteContext, 'cause' | 'effect'>> {
    const causeId = relationship.cause_event_id;
    const effectId = relationship.effect_event_id;
    if (typeof causeId !== 'string' || typeof effectId !== 'string') return {};
    const events = await this.headEntities(graphId, 'event', [causeId, effectId]);
    return { cause: events[causeId], effect: events[effectId] };
  }

  /**
   * Entities at the graph's head, for the summary only. A failed read must not
   * fail the write it describes, so it yields nothing and the summary falls
   * back to naming the kind of entity.
   */
  private async headEntities(
    graphId: string,
    type: EntityType,
    ids: string[]
  ): Promise<Record<string, Record<string, unknown>>> {
    try {
      return (await this.graphRepository.getHeadEntities?.(graphId, type, ids)) ?? {};
    } catch (error) {
      this.logger.warn(`Could not read ${type} names for a version summary in graph ${graphId}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return {};
    }
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
