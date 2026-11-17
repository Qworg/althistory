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

import { toAxisTime } from '@althistory/calendar';
import { GraphRepository } from '@/repositories/GraphRepository';
import { EntityChanges } from '@/repositories/VersionRepository';
import { EntityType } from '@/models/Graph';
import { Event } from '@/models/Event';
import { Arc } from '@/models/Arc';
import { createLogger, ILogger } from '@/utils/logger';
import { StoredCausalRelationship } from './CausalService';
import type { ChangeBody, ChangedEntity, ChangeRecord } from './ChangeFeedService';
import { type WorldCalendarSet, dateCalendarOf, datePrecisionOf, formatHistoricalDateAt } from '@althistory/calendar';

/** A write to a live entity that should be reflected in one named graph's version. */
export type EntityWriteOperation = 'create' | 'update';

export interface GraphWriteVersioningConfig {
  graphRepository: GraphRepository;
  logger?: ILogger;
  /**
   * Where a committed entity write is announced to the live change feed. The
   * live store already holds the change by the time this service is asked to
   * record it, so the announcement means "refetch and you will see it".
   */
  changeFeed?: { publish(graphId: string, body: ChangeBody): ChangeRecord };
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
  // Exactly, on the axis: two moments a second apart past ±285,000 years are two moments.
  const ta = toAxisTime(a);
  const tb = toAxisTime(b);
  return ta !== null && tb !== null ? ta === tb : a === b;
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

/** One write a batch made that took effect, as the live feed announces it. */
export interface BatchStep {
  operation: EntityWriteOperation | 'delete';
  type: 'event' | 'arc' | 'relationship';
  id: string;
}

/**
 * The entities a batch touched, as the live store holds them once it is done.
 * An entity the store no longer has is `null`. Links are keyed by their two
 * events, which is how the batch routes name them, with every link the store
 * now holds between the two.
 */
export interface BatchLiveState {
  events?: Map<string, Event | null>;
  arcs?: Map<string, Arc | null>;
  links?: Array<{ cause_event_id: string; effect_event_id: string; live: StoredCausalRelationship[] }>;
  /**
   * The batch deleted an event or a link. Its version then has to find every
   * head link that went with it, so every link object must be readable; a
   * batch that only creates or edits needs just the links it touched.
   */
  deletesLinks?: boolean;
}

/** A value as stored (JSON), with every object's keys in order, so two spellings of one value compare equal. */
function canonical(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.keys(v as Record<string, unknown>).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])]));
    }
    return v;
  };
  return JSON.stringify(sort(JSON.parse(JSON.stringify(value ?? null))));
}

/** Whether a written entity's data is the data the head already holds, whatever the key order. */
function sameData(head: Record<string, unknown>, written: Record<string, unknown>): boolean {
  return canonical(head) === canonical(written);
}

/**
 * An arc's head-only `parent_arc_id`, as the edit leaves it:
 *
 *   - a parent the edit names in `metadata.parentArcId` (how the CLI, MCP
 *     and the generator record one, and how a PUT moves an arc) wins over a
 *     different one the head still holds, which the export would prefer --
 *     but only when the edit changed it: a `parentArcId` the head's own
 *     metadata already recorded is no move (`named` is undefined then). A
 *     renaming import, before it remapped the metadata too, left a stale one
 *     beside a remapped field, and an unrelated rename moved the arc;
 *   - none (null) once the arc is top level (level 0): a promoted arc that
 *     kept its parent made the export unimportable (ARC_HIERARCHY_VIOLATION).
 *
 * Nothing else is repaired. A level that does not fit under the parent is
 * judged before the rest of a subtree's moves land (a batch or two PUTs that
 * move the child first), and clearing the parent of an arc above level 0
 * never makes it valid, so it would only lose the parent. A parent deleted
 * from under the arc stays named too: the export reports it as an orphan,
 * and nothing here can make that valid either.
 */
function consistentParent(parent: unknown, level: unknown, named: unknown): unknown {
  const current = typeof named === 'string' && named !== '' ? named : parent;
  if (typeof current !== 'string' || current === '') return current;
  return level === 0 ? null : current;
}

/**
 * A live entity's projection laid over the data the head holds for it. The
 * live models carry fewer fields than the version store keeps (an arc has no
 * `parent_arc_id`, an event or a link no `sourceRef`, a link no cross-graph
 * ids), so writing the projection alone would drop them; a field the live
 * model has is the live model's.
 *
 * A head-only field whose meaning depends on a projected one is carried only
 * while it still agrees with it: an arc's `parent_arc_id` with its `level`
 * (`consistentParent`), a link's `causeGraphId`/`effectGraphId` with the
 * event ids they qualify. `sourceRef` says where the entity came from, which
 * no edit changes, so it is always kept.
 */
function overlay(
  type: EntityType,
  head: Record<string, unknown> | undefined,
  projection: Record<string, unknown>
): Record<string, unknown> {
  if (!head) return projection;
  const data: Record<string, unknown> = { ...head, ...projection };
  if (type === 'arc' && 'parent_arc_id' in head && !('parent_arc_id' in projection)) {
    const recordedParent = (metadata: unknown): unknown =>
      metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>).parentArcId : undefined;
    const named = recordedParent(projection.metadata);
    const moved = named !== recordedParent(head.metadata) ? named : undefined;
    data.parent_arc_id = consistentParent(head.parent_arc_id, data.level, moved);
  }
  if (type === 'relationship') {
    for (const [graphField, eventField] of [['causeGraphId', 'cause_event_id'], ['effectGraphId', 'effect_event_id']] as const) {
      if (graphField in head && head[eventField] !== data[eventField]) delete data[graphField];
    }
  }
  return data;
}

/** How a write treats a commit that fails. */
export interface WriteOptions {
  /**
   * The caller undoes the live write when it cannot be versioned, so nothing
   * is announced for it: a watcher would be told of an entity that is gone.
   * The caller announces what its undo could not remove
   * (`announceNotVersioned`).
   */
  undoneOnFailure?: boolean;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** "Edited 1 event, deleted 1 event, deleted 1 link, added 1 event": a version's changes, edits first, then deletes, then additions. */
function describeChanges(changes: EntityChanges): string {
  const parts: string[] = [];
  const groups: Array<[EntityWriteOperation | 'delete', Array<{ type: EntityType }>]> = [
    ['update', changes.modified],
    ['delete', changes.deleted],
    ['create', changes.added],
  ];
  for (const [operation, entities] of groups) {
    const byType = new Map<EntityType, number>();
    for (const entity of entities) byType.set(entity.type, (byType.get(entity.type) ?? 0) + 1);
    for (const [type, n] of byType) parts.push(`${VERB[operation].toLowerCase()} ${count(n, NOUN[type])}`);
  }
  if (parts.length === 0) return 'Changed nothing';
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export class GraphWriteVersioningService {
  private readonly graphRepository: GraphRepository;
  private readonly logger: ILogger;
  private readonly changeFeed?: GraphWriteVersioningConfig['changeFeed'];

  constructor(config: GraphWriteVersioningConfig) {
    this.graphRepository = config.graphRepository;
    this.changeFeed = config.changeFeed;
    this.logger = config.logger ?? createLogger('GraphWriteVersioningService');
  }

  /** Record a created or updated event against one named graph. */
  async recordEvent(
    graphId: string,
    event: Event,
    operation: EntityWriteOperation,
    options: WriteOptions = {}
  ): Promise<void> {
    await this.commitWrite(graphId, {
      type: 'event',
      id: event.id,
      data: eventToVersionData(event),
    }, operation, options);
  }

  /** Record a created or updated arc against one named graph. */
  async recordArc(
    graphId: string,
    arc: Arc,
    operation: EntityWriteOperation,
    options: WriteOptions = {}
  ): Promise<void> {
    await this.commitWrite(graphId, {
      type: 'arc',
      id: arc.id,
      data: arcToVersionData(arc),
    }, operation, options);
  }

  /** Record a created or updated causal relationship against one named graph. */
  async recordRelationship(
    graphId: string,
    relationship: StoredCausalRelationship,
    operation: EntityWriteOperation,
    options: WriteOptions = {}
  ): Promise<void> {
    await this.commitWrite(graphId, {
      type: 'relationship',
      id: relationship.id,
      data: relationshipToVersionData(relationship),
    }, operation, options);
  }

  /**
   * Announce a write whose version could not be made and whose undo failed:
   * it is in the live store, unversioned. ("Added event “X” (not versioned)".)
   */
  announceNotVersioned(
    graphId: string,
    operation: EntityWriteOperation,
    type: EntityType,
    id: string,
    data?: Record<string, unknown>
  ): void {
    const changes: EntityChanges = { added: [], modified: [], deleted: [] };
    (operation === 'create' ? changes.added : changes.modified).push({ type, id, data: data ?? {} });
    this.announce(graphId, changes, operation, `${describeEntityWrite(operation, type, { data })} (not versioned)`);
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
   * Record what a batch left in the live store as one version, and announce it.
   *
   * A batch (`/api/batch/*`) runs many writes, some of which a failure or an
   * atomic rollback may undo again, so the version is taken from what the
   * live store holds once the batch is done rather than from the steps it
   * tried: `state` is each touched entity as the store now holds it (`null`
   * when it is gone), and each touched link pair with the links now between
   * it. Against the head that becomes added, modified and deleted entities;
   * a deleted event also deletes the head's links to it, as the live store's
   * DETACH DELETE did. Nothing is committed when nothing differs.
   *
   * `steps` are the writes that took effect, for the live feed: one
   * announcement per kind of change ("Added 2 events in a batch"), the same
   * the batch routes made before they were versioned, and never a second one.
   *
   * Each entity is written as the live model's projection laid over the
   * head's data (`overlay`), so fields only the version store keeps survive,
   * and only when that differs from the head, in any key order: an entity the
   * batch touched and did not change is not rewritten.
   *
   * Failure policy as for a single write (see `commit`): any failure, reading
   * the head as much as committing, is announced as not versioned
   * (`announceIfNotVersioned`, unless the caller undoes the batch) and
   * propagated.
   */
  async recordBatch(
    graphId: string,
    state: BatchLiveState,
    steps: BatchStep[],
    { announceIfNotVersioned = true }: { announceIfNotVersioned?: boolean } = {}
  ): Promise<void> {
    try {
      await this.commitBatch(graphId, state);
    } catch (error) {
      this.logger.error(`Failed to version a batch in graph ${graphId}`, error);
      // The live store holds the batch, and it is what the app reads.
      if (announceIfNotVersioned) this.announceBatch(graphId, steps, { notVersioned: true });
      throw error;
    }
    this.announceBatch(graphId, steps);
  }

  /** The difference a batch made from the head, committed as one version (nothing when it made none). */
  private async commitBatch(graphId: string, state: BatchLiveState): Promise<void> {
    // Strict only where leaving an unreadable object out would lose data:
    //   - an event or arc the batch edited (it would read as one the head never
    //     had, and be versioned as the bare projection);
    //   - a link the store now holds between a pair the batch touched, for the
    //     same reason;
    //   - every link, when the batch deleted an event or a link: the scans
    //     below must find each head link that went with it, or leave an orphan.
    // A delete needs only the tree entry (`lost` below), and anything else stays
    // lenient: one lost object elsewhere must not fail every batch on the graph.
    const liveLinks = new Set((state.links ?? []).flatMap((pair) => pair.live.map((link) => link.id)));
    const mustResolve = (type: EntityType, id: string): boolean =>
      type === 'event' ? state.events?.get(id) != null
        : type === 'arc' ? state.arcs?.get(id) != null
          : type === 'relationship' ? state.deletesLinks === true || liveLinks.has(id)
            : false;
    const missing: Array<{ type: EntityType; id: string }> = [];
    const head = await this.graphRepository.checkout(graphId, undefined, { strict: mustResolve, missing });
    // In the tree, though its object could not be read.
    const lost = new Set(missing.map((entry) => `${entry.type}:${entry.id}`));
    const inHead = (type: EntityType, entities: Record<string, unknown>, id: string): boolean =>
      entities[id] !== undefined || lost.has(`${type}:${id}`);
    const changes: EntityChanges = { added: [], modified: [], deleted: [] };
    const deleted = new Set<string>();
    const remove = (type: EntityType, id: string): void => {
      if (deleted.has(`${type}:${id}`)) return;
      deleted.add(`${type}:${id}`);
      changes.deleted.push({ type, id });
    };
    const write = (type: EntityType, id: string, projection: Record<string, unknown>, current: Record<string, unknown> | undefined): void => {
      const data = overlay(type, current, projection);
      if (!current) changes.added.push({ type, id, data });
      else if (!sameData(current, data)) changes.modified.push({ type, id, data });
    };
    const liveLinkIds = new Set<string>();

    for (const [id, event] of state.events ?? []) {
      if (event) write('event', id, eventToVersionData(event), head.events[id]);
      else if (inHead('event', head.events, id)) remove('event', id);
    }
    for (const [id, arc] of state.arcs ?? []) {
      if (arc) write('arc', id, arcToVersionData(arc), head.arcs[id]);
      else if (inHead('arc', head.arcs, id)) remove('arc', id);
    }
    // The head's links by their two events, read once: a scan of every head link
    // per pair made a batch of N pairs cost N times the size of the graph.
    const headLinksByPair = new Map<string, string[]>();
    if ((state.links ?? []).length > 0) {
      for (const [id, link] of Object.entries(head.relationships)) {
        const key = `${link.cause_event_id}\u0000${link.effect_event_id}`;
        const ids = headLinksByPair.get(key);
        if (ids) ids.push(id);
        else headLinksByPair.set(key, [id]);
      }
    }
    for (const pair of state.links ?? []) {
      for (const link of pair.live) {
        liveLinkIds.add(link.id);
        write('relationship', link.id, relationshipToVersionData(link), head.relationships[link.id]);
      }
      for (const id of headLinksByPair.get(`${pair.cause_event_id}\u0000${pair.effect_event_id}`) ?? []) {
        if (!liveLinkIds.has(id)) remove('relationship', id);
      }
    }
    // The live store detached every link of a deleted event.
    const goneEvents = new Set(changes.deleted.filter((entity) => entity.type === 'event').map((entity) => entity.id));
    if (goneEvents.size > 0 && missing.some((entry) => entry.type === 'relationship')) {
      // `deletesLinks` makes every link strict; a caller that deleted an event
      // without saying so cannot be versioned without knowing its links.
      throw new Error(`Cannot version a deleted event in graph ${graphId}: a link object in its head cannot be read`);
    }
    for (const [id, link] of Object.entries(head.relationships)) {
      if (liveLinkIds.has(id)) continue;
      if (goneEvents.has(String(link.cause_event_id)) || goneEvents.has(String(link.effect_event_id))) remove('relationship', id);
    }

    const summary = `${describeChanges(changes)} in a batch`;
    const operation: EntityWriteOperation | 'delete' =
      changes.modified.length === 0 && changes.deleted.length === 0
        ? 'create'
        : changes.added.length === 0 && changes.modified.length === 0
          ? 'delete'
          : 'update';

    const empty = changes.added.length + changes.modified.length + changes.deleted.length === 0;
    if (!empty) await this.graphRepository.commitChanges(graphId, changes, operation, summary);
  }

  /**
   * A batch's writes on the live feed, once per kind of change ("Added 2
   * events in a batch", with " (not versioned)" when `notVersioned`). Never
   * fails the batch.
   */
  announceBatch(graphId: string, steps: BatchStep[], { notVersioned = false }: { notVersioned?: boolean } = {}): void {
    if (!this.changeFeed) return;
    const suffix = notVersioned ? ' (not versioned)' : '';
    const groups = new Map<string, ChangedEntity[]>();
    for (const step of steps) {
      const key = `${step.operation}:${step.type}`;
      groups.set(key, [...(groups.get(key) ?? []), { type: step.type, id: step.id }]);
    }
    for (const [key, entities] of groups) {
      const operation = key.split(':')[0] as EntityWriteOperation | 'delete';
      try {
        this.changeFeed.publish(graphId, {
          kind: 'entities',
          operation,
          entities,
          summary: `${VERB[operation]} ${count(entities.length, NOUN[entities[0].type])} in a batch${suffix}`,
        });
      } catch (error) {
        this.logger.warn('Could not announce a batch to the live feed', {
          graphId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
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
    operation: EntityWriteOperation,
    options: WriteOptions = {}
  ): Promise<void> {
    // `data` is always set for create/update by the typed wrappers above.
    const projection = write.data ?? {};
    // An edit keeps what only the version store holds of the entity (its arc
    // parent, its source), so the head is read for it, and a read that fails
    // fails the version: versioning the bare projection would drop those
    // fields and look like an ordinary edit.
    let previous: Record<string, unknown> | undefined;
    if (operation === 'update') {
      try {
        previous = (await this.requireHeadEntities(graphId, write.type, [write.id]))[write.id];
      } catch (error) {
        this.logger.error(`Could not read the head to version an edit in graph ${graphId}`, error);
        if (!options.undoneOnFailure) {
          this.announceNotVersioned(graphId, operation, write.type, write.id, projection);
        }
        throw error;
      }
    }
    const entity = { type: write.type, id: write.id, data: overlay(write.type, previous, projection) };
    const changes: EntityChanges = {
      added: operation === 'create' ? [entity] : [],
      modified: operation === 'update' ? [entity] : [],
      deleted: [],
    };

    const context: EntityWriteContext = { data: entity.data };
    if (operation === 'update') {
      context.previous = previous;
      if (write.type === 'event') context.calendar = (await this.graphRepository.findById(graphId).catch(() => null))?.calendar;
    }
    if (write.type === 'relationship') {
      Object.assign(context, await this.linkEnds(graphId, entity.data));
    }

    await this.commit(graphId, changes, operation, describeEntityWrite(operation, write.type, context), options);
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
   * Entities at the graph's head, for data that is written: a read that fails,
   * or an entity the tree names whose object is missing, throws.
   */
  private async requireHeadEntities(
    graphId: string,
    type: EntityType,
    ids: string[]
  ): Promise<Record<string, Record<string, unknown>>> {
    return (await this.graphRepository.getHeadEntities?.(graphId, type, ids, { strict: true })) ?? {};
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
    description: string,
    options: WriteOptions = {}
  ): Promise<void> {
    try {
      await this.graphRepository.commitChanges(graphId, changes, operation, description);
    } catch (error) {
      this.logger.error(`Failed to commit ${description} to graph ${graphId}`, error);
      // The live store changed before this was asked, and it is what the app
      // reads, so a watcher is told even though the version was not made --
      // unless the caller undoes the write, when there is nothing to see.
      if (!options.undoneOnFailure) this.announce(graphId, changes, operation, `${description} (not versioned)`);
      throw error;
    }
    this.announce(graphId, changes, operation, description);
  }

  /** Tell the live change feed which entities a write touched. */
  private announce(
    graphId: string,
    changes: EntityChanges,
    operation: EntityWriteOperation | 'delete',
    summary: string
  ): void {
    if (!this.changeFeed) return;
    const touched = operation === 'create' ? changes.added : operation === 'update' ? changes.modified : changes.deleted;
    const entities: ChangedEntity[] = touched.map((entity) => ({ type: entity.type, id: entity.id }));
    if (entities.length === 0) return;
    try {
      this.changeFeed.publish(graphId, { kind: 'entities', operation, entities, summary });
    } catch (error) {
      this.logger.warn('Could not announce a change to the live feed', {
        graphId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
