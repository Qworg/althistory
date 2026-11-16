/**
 * The arc hierarchy: which arc is whose parent, and at which level each sits.
 *
 * An arc's parent is recorded in two places, by how the arc was made. An arc
 * made through the CLI, MCP or the generator names it in `metadata.parentArcId`
 * (live store and version). An imported arc has it in the version's
 * `parent_arc_id` only. The export reads the field first and the metadata
 * second (`ExportService.parentArcIdOf`), so that is the order here too.
 *
 * Three rules hold for every arc, through every door that writes one (the arc
 * routes, `/api/batch/*`, the CLI):
 *
 *   1. A parent is another arc that exists: not the arc itself, not one of its
 *      own descendants, not an id nothing holds. (A 400.)
 *   2. A child sits exactly one level below its parent, and a top-level arc
 *      (level 0) has none. Changing an arc's level or parent moves its whole
 *      subtree with it: every descendant is set to its parent's level + 1.
 *      A level that cannot fit the arc's parent is refused (a 400).
 *   3. Deleting an arc lifts its children: each moves to the deleted arc's
 *      parent (or becomes top level if it had none) and takes its subtree
 *      with it, one level up. The deleted arc's events stay, unassigned.
 *
 * A batch is judged once, against the state it ends in: a plan runs every arc
 * step in memory, in order, and only the end state is checked, so a batch that
 * promotes B and then puts its old parent A under B, or creates a child before
 * its parent, is valid. Nothing is written until the plan is valid.
 *
 * Reading cost: the live arcs (never events or links) and the head's copy of
 * each of those arcs, once per request or batch. Never the whole head, and
 * never again per step.
 */

import type { Arc, CreateArcRequest, UpdateArcRequest } from '@/models/Arc';
import type { Event } from '@/models/Event';
import type { ArcRepository } from '@/repositories/ArcRepository';
import type { EventRepository } from '@/repositories/EventRepository';
import { ValidationError } from '@/utils/errors';
import { createLogger } from '@/utils/logger';
import type { ArcEdit, GraphWriteVersioningService } from './GraphWriteVersioningService';

const logger = createLogger('ArcHierarchy');

/** An arc as the hierarchy sees it. Immutable: an edit replaces it. */
export interface ArcNode {
  readonly id: string;
  readonly name: string;
  readonly level: number;
  /** The parent the export reads. */
  readonly parent: string | null;
  /** The parent the live arc's metadata records, which an edit compares against. */
  readonly metaParent: string | null;
}

/** A request body that may name its parent by either of its two spellings. */
export type ArcParentRequest = { parent_arc_id?: string | null; metadata?: Record<string, unknown>; level?: number };

/** The parent a request names: `undefined` when it names none, `null` when it clears it. */
interface NamedParent {
  value: string | null;
  /** `parent_arc_id` is the arc's parent as the export reads it; the metadata is compared with what the metadata holds. */
  via: 'field' | 'metadata';
}

function asParent(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function recordedParent(metadata: unknown): string | null {
  return metadata && typeof metadata === 'object' ? asParent((metadata as Record<string, unknown>).parentArcId) : null;
}

export function namedParent(request: ArcParentRequest | undefined): NamedParent | undefined {
  if (!request) return undefined;
  if (request.parent_arc_id !== undefined) return { value: asParent(request.parent_arc_id), via: 'field' };
  const metadata = request.metadata;
  if (metadata && typeof metadata === 'object' && 'parentArcId' in metadata) {
    return { value: asParent(metadata.parentArcId), via: 'metadata' };
  }
  return undefined;
}

/** The metadata recording a parent: set, or absent when there is none. */
function withParent(metadata: Record<string, unknown> | undefined, parent: string | null): Record<string, unknown> {
  const { parentArcId: _old, ...rest } = metadata ?? {};
  return parent ? { ...rest, parentArcId: parent } : rest;
}

/** A request without `parent_arc_id`, which the arc model has no field for. */
function withoutParentField<T extends ArcParentRequest>(request: T): Omit<T, 'parent_arc_id'> {
  const { parent_arc_id: _field, ...rest } = request;
  return rest;
}

/** One arc step of a batch, as the plan runs it. */
export type PlanStep =
  | { kind: 'create'; data: ArcParentRequest & { id?: string; name?: string; level?: number } }
  | { kind: 'update'; id: string; data: ArcParentRequest }
  | { kind: 'delete'; id: string };

/**
 * The hierarchy in memory: what each arc's level and parent become as steps
 * run, and which arcs a step moved. It judges nothing until `validate`.
 */
export class ArcHierarchyPlan {
  private state: Map<string, ArcNode | null>;
  /** Arcs whose level or parent an edit decided (or that were created): the ones `validate` checks. */
  private touched = new Set<string>();
  /** The ids the last operation put, in order. */
  log: string[] = [];
  private tempIds = 0;

  constructor(nodes: ReadonlyMap<string, ArcNode>) {
    this.state = new Map(nodes);
  }

  get(id: string): ArcNode | null {
    return this.state.get(id) ?? null;
  }

  checkpoint(): { state: Map<string, ArcNode | null>; touched: Set<string> } {
    return { state: new Map(this.state), touched: new Set(this.touched) };
  }

  restore(point: { state: Map<string, ArcNode | null>; touched: Set<string> }): void {
    this.state = new Map(point.state);
    this.touched = new Set(point.touched);
  }

  private put(node: ArcNode, validate: boolean): void {
    this.state.set(node.id, node);
    this.log.push(node.id);
    if (validate) this.touched.add(node.id);
  }

  /** Each arc's children, from the state as it is now. */
  private index(): Map<string, string[]> {
    const children = new Map<string, string[]>();
    for (const node of this.state.values()) {
      if (!node || node.parent === null) continue;
      const list = children.get(node.parent);
      if (list) list.push(node.id);
      else children.set(node.parent, [node.id]);
    }
    return children;
  }

  /**
   * Set every descendant of `rootId` to its parent's level + 1. A seen-set
   * keeps the walk finite on a cycle (stored data may hold one).
   */
  private cascade(rootId: string): void {
    const children = this.index();
    const seen = new Set<string>([rootId]);
    const queue = [rootId];
    while (queue.length > 0) {
      const current = this.get(queue.shift()!);
      if (!current) continue;
      for (const childId of children.get(current.id) ?? []) {
        if (seen.has(childId)) continue;
        seen.add(childId);
        const child = this.get(childId);
        if (!child) continue;
        if (child.level !== current.level + 1) this.put({ ...child, level: current.level + 1 }, true);
        queue.push(childId);
      }
    }
  }

  /** A new arc. `id` is its own, or a stand-in when the store will make one. */
  create(data: ArcParentRequest & { id?: string; name?: string; level?: number }): string {
    this.log = [];
    const id = data.id ?? `\u0000new-${this.tempIds++}`;
    const parent = namedParent(data)?.value ?? null;
    this.put({ id, name: data.name ?? id, level: typeof data.level === 'number' ? data.level : 0, parent, metaParent: parent }, true);
    return id;
  }

  /** An edit of an existing arc. False when the plan holds no such arc. */
  update(id: string, request: ArcParentRequest): boolean {
    this.log = [];
    const before = this.get(id);
    if (!before) return false;

    const named = namedParent(request);
    const moved = named !== undefined && named.value !== (named.via === 'field' ? before.parent : before.metaParent);
    const requested = typeof request.level === 'number' ? request.level : undefined;

    let parent = moved ? named!.value : before.parent;
    let level = before.level;
    if (requested === 0) {
      // A top-level arc has no parent: promoting one clears it, unless the same
      // edit names a new parent, which is a contradiction `validate` reports.
      level = 0;
      if (!(moved && named!.value)) parent = null;
    } else if (requested !== undefined) {
      level = requested;
    } else if (moved) {
      // Moved without a level: it follows its new parent (or the top).
      const target = parent ? this.get(parent) : null;
      level = parent === null ? 0 : target ? target.level + 1 : before.level;
    }

    const changed = parent !== before.parent || level !== before.level;
    const metaParent = parent !== before.parent ? parent : before.metaParent;
    this.put({ ...before, level, parent, metaParent }, changed || moved);
    if (changed) this.cascade(id);
    return true;
  }

  /**
   * Remove an arc, lifting its children to its parent. Returns the children's
   * ids (empty for a leaf), or null when the plan holds no such arc.
   */
  delete(id: string): string[] | null {
    this.log = [];
    const node = this.get(id);
    if (!node) return null;
    const lifted = this.index().get(id)?.filter((child) => child !== id) ?? [];
    // A parent that is gone (or is the arc itself) leaves the children top level.
    const parent = node.parent !== null && node.parent !== id && this.get(node.parent) ? node.parent : null;
    this.state.set(id, null);
    this.touched.add(id);
    this.log.push(id);
    for (const childId of lifted) {
      const child = this.get(childId);
      if (!child) continue;
      const level = parent ? this.get(parent)!.level + 1 : 0;
      this.put({ ...child, parent, metaParent: parent, level }, true);
      this.cascade(childId);
    }
    return lifted;
  }

  /** The ids of live arcs the plan changed since the last `log` reset, apart from `except`. */
  changedBesides(except: string): string[] {
    return [...new Set(this.log)].filter((id) => id !== except && this.get(id) !== null);
  }

  /**
   * The messages for every touched arc that does not fit the hierarchy as it
   * now stands; empty when it is valid.
   */
  problems(): string[] {
    const problems: string[] = [];
    for (const id of this.touched) {
      const node = this.get(id);
      if (!node || node.parent === null) continue;
      const label = `Arc "${node.name}"`;
      if (node.parent === node.id) {
        problems.push(`${label} cannot be its own parent. Name a different parent, or set its level to 0.`);
        continue;
      }
      const parent = this.get(node.parent);
      if (!parent) {
        problems.push(`${label} names parent ${node.parent}, which is not an arc in this graph. Name an existing arc, or set its level to 0.`);
        continue;
      }
      const seen = new Set<string>();
      let cursor: ArcNode | null = parent;
      let descendant = false;
      while (cursor && !seen.has(cursor.id)) {
        if (cursor.id === node.id) {
          descendant = true;
          break;
        }
        seen.add(cursor.id);
        cursor = cursor.parent === null ? null : this.get(cursor.parent);
      }
      if (descendant) {
        problems.push(`${label} cannot be placed under "${parent.name}", which is one of its own descendants. Move "${parent.name}" out from under it first, or name another parent.`);
      } else if (node.level === 0) {
        problems.push(`${label} is at level 0 (the top) but names parent "${parent.name}". Set its level to ${parent.level + 1}, or clear its parent.`);
      } else if (node.level !== parent.level + 1) {
        problems.push(
          `${label} is at level ${node.level}, but its parent "${parent.name}" is at level ${parent.level}, so a child must be level ${parent.level + 1}. ` +
          'Name a new parent that fits, or set its level to 0 to make it a top-level arc.'
        );
      }
    }
    return problems;
  }

  /** Throws a 400 naming what is wrong, if anything is. */
  validate(): void {
    const problems = this.problems();
    if (problems.length > 0) {
      const shown = problems.slice(0, 5).join(' ');
      throw new ValidationError(
        `The arc hierarchy would not be valid: ${shown}${problems.length > 5 ? ` (and ${problems.length - 5} more)` : ''}`,
        'level',
        undefined,
        problems
      );
    }
  }
}

/** What a session wrote, to version or to undo. */
interface LiveWrite {
  /** The arc as it was before the session first wrote it; null when the session created it. */
  before: Arc | null;
}

/** An arc of the request graph, with the repositories a hierarchy edit writes through. */
export interface ArcHierarchyRepositories {
  arcRepository: Pick<ArcRepository, 'findAll' | 'findById' | 'create' | 'update' | 'delete' | 'setHierarchy'>;
  eventRepository?: Pick<EventRepository, 'findAll' | 'update'>;
}

function toCreateRequest(arc: Arc): CreateArcRequest & { id: string } {
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

/**
 * One request's (or one batch's) writes to the arc hierarchy of one graph.
 *
 * `preflight` judges a list of steps without writing; `create`, `update` and
 * `delete` then carry them out one at a time, each moving what its step
 * moves. The session remembers everything it wrote, so a caller can version
 * it (`edit`) or undo it (`undo`).
 */
export class ArcHierarchySession {
  private base?: Map<string, ArcNode>;
  private plan?: ArcHierarchyPlan;
  /** The live arcs as the session last wrote or read them. */
  private readonly current = new Map<string, Arc>();
  private readonly arcWrites = new Map<string, LiveWrite>();
  private readonly deletedIds = new Set<string>();
  private readonly eventWrites = new Map<string, { before: Event; after: Event }>();
  /** Arcs this session wrote besides the ones a caller named: descendants moved, children lifted. */
  private readonly movedIds = new Set<string>();
  /** The children a delete lifted (a subset of `movedIds`). */
  private readonly liftedIds = new Set<string>();

  constructor(
    private readonly graphId: string,
    private readonly repositories: ArcHierarchyRepositories,
    private readonly versioning: Pick<GraphWriteVersioningService, 'headArcs'>
  ) {}

  /** Read the graph's arcs and their recorded parents, once. */
  private async load(): Promise<ArcHierarchyPlan> {
    if (this.plan) return this.plan;
    const arcs = await this.repositories.arcRepository.findAll();
    const head = await this.versioning.headArcs(this.graphId, arcs.map((arc) => arc.id));
    const nodes = new Map<string, ArcNode>();
    for (const arc of arcs) {
      this.current.set(arc.id, arc);
      const metaParent = recordedParent(arc.metadata);
      const parent = asParent(head[arc.id]?.parent_arc_id) ?? metaParent;
      nodes.set(arc.id, { id: arc.id, name: arc.name, level: arc.level, parent, metaParent });
    }
    this.base = nodes;
    this.plan = new ArcHierarchyPlan(nodes);
    return this.plan;
  }

  private async arcOf(id: string): Promise<Arc | null> {
    return this.current.get(id) ?? (await this.repositories.arcRepository.findById(id));
  }

  /** Whether a step can change the hierarchy, and so needs the arcs read. */
  private static needsPlan(step: PlanStep): boolean {
    if (step.kind === 'delete') return true;
    if (step.kind === 'create') return namedParent(step.data) !== undefined && namedParent(step.data)!.value !== null;
    return step.data.level !== undefined || step.data.metadata !== undefined || step.data.parent_arc_id !== undefined;
  }

  /**
   * Judge steps against the state they end in, writing nothing. Throws a 400
   * if that state is not a valid hierarchy. Call before the first write.
   */
  async preflight(steps: PlanStep[]): Promise<void> {
    if (!steps.some((step) => ArcHierarchySession.needsPlan(step))) return;
    await this.load();
    const dry = new ArcHierarchyPlan(this.base!);
    for (const step of steps) {
      if (step.kind === 'create') dry.create(step.data);
      else if (step.kind === 'update') dry.update(step.id, step.data);
      else dry.delete(step.id);
    }
    dry.validate();
  }

  /** An arc's metadata with its parent as the plan decided it. */
  private metadataFor(base: Record<string, unknown> | undefined, node: ArcNode): Record<string, unknown> {
    return withParent(base, node.metaParent);
  }

  async create(data: CreateArcRequest & ArcParentRequest): Promise<Arc> {
    const named = namedParent(data);
    const request = withoutParentField(data) as CreateArcRequest;
    if (named && named.value) request.metadata = withParent(request.metadata, named.value);
    const created = await this.repositories.arcRepository.create(request);
    this.current.set(created.id, created);
    this.arcWrites.set(created.id, { before: null });
    this.plan?.create({ ...data, id: created.id, name: created.name, level: created.level });
    return created;
  }

  /**
   * Carry out an edit and everything it moves. Null when there is no such arc.
   * Undoes its own writes if one fails.
   */
  async update(id: string, updates: UpdateArcRequest & ArcParentRequest): Promise<Arc | null> {
    const request = withoutParentField(updates) as UpdateArcRequest;
    const hierarchical = updates.level !== undefined || updates.metadata !== undefined || updates.parent_arc_id !== undefined;
    if (!hierarchical) return this.write(id, request, null);

    const plan = await this.load();
    const point = plan.checkpoint();
    if (!plan.update(id, updates)) return null;
    const node = plan.get(id)!;
    const others = plan.changedBesides(id);
    const existing = await this.arcOf(id);
    if (!existing) {
      plan.restore(point);
      return null;
    }
    const resolved: UpdateArcRequest = { ...request, level: node.level, metadata: this.metadataFor(request.metadata ?? existing.metadata, node) };
    try {
      const updated = await this.write(id, resolved, others);
      if (!updated) plan.restore(point);
      else for (const other of others) this.movedIds.add(other);
      return updated;
    } catch (error) {
      plan.restore(point);
      throw error;
    }
  }

  /**
   * Write one arc through the repository, and the arcs the plan moved with it.
   *
   * The repository judges an arc's time span against the levels of the arcs it
   * overlaps, so the order matters while the subtree is in between: an arc that
   * goes deeper is written after its descendants have (they are already below
   * it), one that comes up before them (they are still below it).
   */
  private async write(id: string, request: UpdateArcRequest, others: string[] | null): Promise<Arc | null> {
    const { arcRepository } = this.repositories;
    const before = await this.arcOf(id);
    const written: string[] = [];
    const deeper = before !== null && request.level !== undefined && request.level > before.level;
    const moveOthers = async (): Promise<void> => {
      for (const otherId of others ?? []) {
        const arc = await this.arcOf(otherId);
        const node = this.plan!.get(otherId);
        if (!arc || !node) continue;
        const moved = await arcRepository.setHierarchy(otherId, { level: node.level, metadata: this.metadataFor(arc.metadata, node) });
        if (!moved) continue;
        if (!this.arcWrites.has(otherId)) this.arcWrites.set(otherId, { before: arc });
        this.current.set(otherId, moved);
        written.push(otherId);
      }
    };
    let updated: Arc | null = null;
    try {
      if (deeper) await moveOthers();
      updated = await arcRepository.update(id, request);
      if (!updated) {
        await this.restoreArcs(written);
        return null;
      }
      if (before && !this.arcWrites.has(id)) this.arcWrites.set(id, { before });
      this.current.set(id, updated);
      if (!deeper) await moveOthers();
      return updated;
    } catch (error) {
      await this.restoreArcs([...(updated ? [id] : []), ...written]);
      throw error;
    }
  }

  /**
   * Delete an arc, lifting its children and unassigning its events. False when
   * there is no such arc. Undoes its own writes if one fails.
   */
  async delete(id: string): Promise<boolean> {
    const { arcRepository } = this.repositories;
    const plan = await this.load();
    const point = plan.checkpoint();
    const lifted = plan.delete(id);
    const arc = lifted === null ? null : await this.arcOf(id);
    if (lifted === null || !arc) {
      plan.restore(point);
      return arcRepository.delete(id);
    }
    const written: string[] = [];
    const unassigned: string[] = [];
    try {
      if (!(await arcRepository.delete(id))) {
        plan.restore(point);
        return false;
      }
      if (!this.arcWrites.has(id)) this.arcWrites.set(id, { before: arc });
      this.deletedIds.add(id);
      for (const childId of plan.changedBesides(id)) {
        const child = await this.arcOf(childId);
        const node = plan.get(childId);
        if (!child || !node) continue;
        const moved = await arcRepository.setHierarchy(childId, { level: node.level, metadata: this.metadataFor(child.metadata, node) });
        if (!moved) continue;
        if (!this.arcWrites.has(childId)) this.arcWrites.set(childId, { before: child });
        this.current.set(childId, moved);
        this.movedIds.add(childId);
        written.push(childId);
      }
      for (const childId of lifted) this.liftedIds.add(childId);
      unassigned.push(...(await this.unassignEvents(id)));
      return true;
    } catch (error) {
      plan.restore(point);
      await this.undoDelete(arc, written, unassigned);
      throw error;
    }
  }

  /** Let go of every event assigned to a deleted arc. Returns the events' ids. */
  private async unassignEvents(arcId: string): Promise<string[]> {
    const { eventRepository } = this.repositories;
    if (!eventRepository) return [];
    const ids: string[] = [];
    for (const event of await eventRepository.findAll()) {
      const metadata = event.metadata;
      if (!metadata || (metadata.arcId !== arcId && metadata.arc_id !== arcId)) continue;
      const { arcId: _a, arc_id: _b, ...rest } = metadata;
      const after = await eventRepository.update(event.id, { metadata: rest });
      if (!after) continue;
      const first = this.eventWrites.get(event.id);
      this.eventWrites.set(event.id, { before: first?.before ?? event, after });
      ids.push(event.id);
    }
    return ids;
  }

  private async restoreArcs(ids: string[]): Promise<void> {
    for (const id of ids) {
      const write = this.arcWrites.get(id);
      const before = write?.before ?? (await this.arcOf(id));
      if (!before) continue;
      try {
        await this.repositories.arcRepository.update(id, {
          name: before.name,
          description: before.description,
          start_time: before.start_time,
          end_time: before.end_time,
          level: before.level,
          metadata: before.metadata ?? {},
        });
        this.current.set(id, before);
      } catch (error) {
        logger.error('Could not restore an arc after a failed hierarchy write', error, { id });
      }
    }
  }

  private async undoDelete(arc: Arc, lifted: string[], unassigned: string[]): Promise<void> {
    try {
      if (!(await this.repositories.arcRepository.findById(arc.id))) {
        await this.repositories.arcRepository.create(toCreateRequest(arc));
      }
      this.deletedIds.delete(arc.id);
      this.current.set(arc.id, arc);
    } catch (error) {
      logger.error('Could not put back a deleted arc after a failed hierarchy write', error, { id: arc.id });
    }
    for (const id of lifted) {
      const before = this.arcWrites.get(id)?.before;
      if (!before) continue;
      await this.repositories.arcRepository
        .setHierarchy(id, { level: before.level, metadata: before.metadata ?? {} })
        .then(() => this.current.set(id, before))
        .catch((error) => logger.error('Could not restore a lifted arc', error, { id }));
    }
    for (const id of unassigned) {
      const write = this.eventWrites.get(id);
      if (write) await this.repositories.eventRepository?.update(id, { metadata: write.before.metadata ?? {} }).catch(() => undefined);
    }
  }

  /** Every arc id this session wrote, created, moved or deleted. */
  arcIds(): string[] {
    return [...this.arcWrites.keys()];
  }

  /** Arcs written beyond the ones the caller named (a subtree that moved, children lifted). */
  moved(): string[] {
    return [...this.movedIds].filter((id) => !this.deletedIds.has(id));
  }

  /** The children deleted arcs let go of to their parents. */
  lifted(): string[] {
    return [...this.liftedIds].filter((id) => !this.deletedIds.has(id));
  }

  /** The events a deleted arc let go of. */
  eventIds(): string[] {
    return [...this.eventWrites.keys()];
  }

  /** Whether the session did more than the one write its caller asked for. */
  get cascaded(): boolean {
    return this.movedIds.size > 0 || this.eventWrites.size > 0;
  }

  /** What to version: the arcs as they now stand, the arcs gone, the events changed. */
  edit(summary: string): ArcEdit {
    const parents = new Map<string, string | null>();
    const updated: Arc[] = [];
    for (const id of this.arcWrites.keys()) {
      if (this.deletedIds.has(id)) continue;
      const arc = this.current.get(id);
      if (!arc) continue;
      updated.push(arc);
      const node = this.plan?.get(id);
      if (node && this.movedIds.has(id)) parents.set(id, node.parent);
    }
    return { updated, deleted: [...this.deletedIds], events: [...this.eventWrites.values()].map((write) => write.after), summary, parents };
  }

  /** Put back everything the session wrote (a version that could not be made). */
  async undo(): Promise<void> {
    const created = [...this.arcWrites].filter(([, write]) => write.before === null).map(([id]) => id);
    for (const [id, write] of this.arcWrites) {
      if (this.deletedIds.has(id) && write.before) {
        await this.repositories.arcRepository.create(toCreateRequest(write.before));
        this.deletedIds.delete(id);
      }
    }
    await this.restoreArcs([...this.arcWrites].filter(([id, write]) => write.before !== null && !created.includes(id)).map(([id]) => id));
    for (const id of created.reverse()) await this.repositories.arcRepository.delete(id);
    for (const [id, write] of this.eventWrites) {
      await this.repositories.eventRepository?.update(id, { metadata: write.before.metadata ?? {} });
    }
  }
}

/** A sentence for the live feed and Version history: what a delete or an edit moved. */
export function describeMoves(name: string, kind: 'delete' | 'update', moved: number, events: number): string {
  const children = moved === 1 ? '1 child arc' : `${moved} child arcs`;
  const parts: string[] = [];
  if (kind === 'delete') {
    if (moved > 0) parts.push(`moved ${children} up a level`);
    if (events > 0) parts.push(`unassigned ${events === 1 ? '1 event' : `${events} events`}`);
    return `Deleted arc “${name}”${parts.length > 0 ? `, ${parts.join(' and ')}` : ''}`;
  }
  return `Edited arc “${name}” and moved ${moved === 1 ? '1 descendant arc' : `${moved} descendant arcs`} with it`;
}

export class ArcHierarchyService {
  constructor(private readonly versioning: GraphWriteVersioningService) {}

  /** A session for one request or one batch against one graph. */
  open(graphId: string, repositories: ArcHierarchyRepositories): ArcHierarchySession {
    return new ArcHierarchySession(graphId, repositories, this.versioning);
  }

  /**
   * Edit an arc and version it: the arc alone as before, or with the subtree
   * it moved as one version. Null when there is no such arc. Refuses an
   * impossible hierarchy (a 400) before writing anything.
   */
  async updateArc(graphId: string, repositories: ArcHierarchyRepositories, id: string, updates: UpdateArcRequest & ArcParentRequest): Promise<Arc | null> {
    const session = this.open(graphId, repositories);
    await session.preflight([{ kind: 'update', id, data: updates }]);
    const updated = await session.update(id, updates);
    if (!updated) return null;
    await this.version(graphId, session, async () => {
      if (!session.cascaded) await this.versioning.recordArc(graphId, updated, 'update', { undoneOnFailure: true });
      else await this.versioning.recordArcEdit(graphId, session.edit(describeMoves(updated.name, 'update', session.moved().length, 0)), { undoneOnFailure: true });
    }, 'update', updated.id, updated.name);
    return updated;
  }

  /**
   * Delete an arc, lifting its children, and version it. False when there is
   * no such arc.
   */
  async deleteArc(graphId: string, repositories: ArcHierarchyRepositories, id: string): Promise<{ deleted: boolean; moved: string[]; unassigned: string[] }> {
    const session = this.open(graphId, repositories);
    const name = (await repositories.arcRepository.findById(id))?.name ?? '';
    if (!(await session.delete(id))) return { deleted: false, moved: [], unassigned: [] };
    if (!session.cascaded) {
      await this.versioning.recordDeletion(graphId, 'arc', id);
    } else {
      const summary = describeMoves(name, 'delete', session.lifted().length, session.eventIds().length);
      await this.versioning.recordArcEdit(graphId, session.edit(summary));
    }
    return { deleted: true, moved: session.lifted(), unassigned: session.eventIds() };
  }

  private async version(
    graphId: string,
    session: ArcHierarchySession,
    record: () => Promise<void>,
    operation: 'update',
    id: string,
    name: string
  ): Promise<void> {
    try {
      await record();
    } catch (versionError) {
      try {
        await session.undo();
      } catch (rollbackError) {
        logger.error('Compensating rollback failed for an arc edit', rollbackError, { id });
        this.versioning.announceNotVersioned(graphId, operation, 'arc', id, { name });
      }
      throw versionError;
    }
  }
}
