/**
 * The arc hierarchy: which arc is whose parent, and at which level each sits.
 *
 * An arc's parent is recorded in two places, by how the arc was made. An arc
 * made through the CLI, MCP or the generator names it in `metadata.parentArcId`
 * (live store and version). An imported arc has it in the version's
 * `parent_arc_id` only. The export reads the field first and the metadata
 * second (`ExportService.parentArcIdOf`), so that is the order here too.
 *
 * Rules that hold for every arc, through every door that writes one (the arc
 * routes, `/api/batch/*`, the CLI):
 *
 *   1. A parent is another arc that exists: not the arc itself, not one of its
 *      own descendants, not an id nothing holds. (A 400.)
 *   2. A child sits exactly one level below its parent, and a top-level arc
 *      (level 0) has none: an arc with no parent is level 0. Changing an arc's
 *      level or parent moves its whole subtree with it. A level that cannot
 *      fit the arc's parent is refused (a 400).
 *   3. An arc lies within its own parent's time span. Arcs of different
 *      branches overlap freely at any level, and a root is constrained by no
 *      other arc. (A 400.)
 *   4. Deleting an arc lifts its children: each moves to the deleted arc's
 *      parent (or becomes top level if it had none) and takes its subtree with
 *      it, one level up. A child that would not lie within its new parent
 *      refuses the delete (a 400). The deleted arc's events stay, unassigned,
 *      and the pressures it was named in let go of it.
 *
 * A batch is judged once, against the state it ends in: a plan runs every arc
 * step in memory, in order, and only the end state is checked, so a batch that
 * promotes B and then puts its old parent A under B, or creates a child before
 * its parent, is valid, and so is the same batch in the other order (an arc
 * moved without a level follows its parent's level, settled at the end).
 * Nothing is written until the plan is valid. The arc steps of a batch land or
 * fail together: if any of them fails, everything the session wrote is put back
 * (`undo`), whether the batch is atomic or not.
 *
 * Reading cost: for a plain edit, the one arc and its head copy. For a real
 * move or a delete, the live arcs (never events or links) and the head's copy
 * of each, once per request or batch. Never the whole head.
 */

import { compareInstants, toInstant } from '@althistory/calendar';
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
  /** The parent the live arc's metadata records. */
  readonly metaParent: string | null;
  readonly start?: Date;
  readonly end?: Date;
  /** Moved to a parent without a level: it takes its parent's level + 1, settled at the end. */
  readonly follows?: boolean;
}

/** A request body that may name its parent by either of its two spellings. */
export type ArcParentRequest = {
  parent_arc_id?: string | null;
  metadata?: Record<string, unknown>;
  level?: number;
  start_time?: Date | string;
  end_time?: Date | string;
};

/** The parent a request names: `undefined` when it names none, `null` when it clears it. */
interface NamedParent {
  value: string | null;
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

function instantOf(value: unknown): Date | undefined {
  if (value === undefined || value === null) return undefined;
  const date = toInstant(value as Date | string);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

const iso = (date: Date | undefined): string => (date ? date.toISOString() : '?');

/** One arc step of a batch, as the plan runs it. */
export type PlanStep =
  | { kind: 'create'; data: ArcParentRequest & { id?: string; name?: string } }
  | { kind: 'update'; id: string; data: ArcParentRequest }
  | { kind: 'delete'; id: string };

/** What a problem is about, for `validate-hierarchy` and the reconcile pass. */
export interface HierarchyProblem {
  id: string;
  kind: 'parent' | 'level' | 'time-parent' | 'time-child';
  message: string;
  /** The arc the message names beside the one it is about (the parent, or the child). */
  other?: string;
}

/**
 * The hierarchy in memory: what each arc's level, parent and span become as
 * steps run. It judges nothing until `problems` or `validate`.
 */
export class ArcHierarchyPlan {
  private state: Map<string, ArcNode | null>;
  /** Arcs whose level, parent or span an edit decided (or that were created): the ones `problems` checks. */
  private touched = new Set<string>();
  /** The arcs whose span an edit changed: their children are checked against it. */
  private timeTouched = new Set<string>();
  /** The ids the last operation put, in order. */
  log: string[] = [];
  private tempIds = 0;

  constructor(nodes: ReadonlyMap<string, ArcNode>) {
    this.state = new Map(nodes);
  }

  get(id: string): ArcNode | null {
    return this.state.get(id) ?? null;
  }

  /** The ids of live arcs an edit decided, created or moved. */
  touchedIds(): string[] {
    return [...this.touched].filter((id) => this.get(id) !== null);
  }

  /** Have `problems` check an arc (and its children against it) as if an edit had decided it. */
  touch(id: string): void {
    if (this.get(id)) {
      this.touched.add(id);
      this.timeTouched.add(id);
    }
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

  /** Every arc below `rootId`, by walking its children with a seen-set (stored data may hold a cycle). */
  private descendants(rootId: string, children = this.index()): Set<string> {
    const seen = new Set<string>([rootId]);
    const queue = [rootId];
    while (queue.length > 0) {
      for (const childId of children.get(queue.shift()!) ?? []) {
        if (seen.has(childId)) continue;
        seen.add(childId);
        queue.push(childId);
      }
    }
    seen.delete(rootId);
    return seen;
  }

  /** Set every descendant of `rootId` to its parent's level + 1. */
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
  create(data: ArcParentRequest & { id?: string; name?: string }): string {
    this.log = [];
    const id = data.id ?? `\u0000new-${this.tempIds++}`;
    const parent = namedParent(data)?.value ?? null;
    this.put(
      { id, name: data.name ?? id, level: typeof data.level === 'number' ? data.level : 0, parent, metaParent: parent, start: instantOf(data.start_time), end: instantOf(data.end_time) },
      true
    );
    this.timeTouched.add(id);
    return id;
  }

  /** An edit of an existing arc. False when the plan holds no such arc. */
  update(id: string, request: ArcParentRequest): boolean {
    this.log = [];
    const before = this.get(id);
    if (!before) return false;

    const named = namedParent(request);
    // A parent named that is not the one the arc has is a move, however the
    // arc's metadata happens to read: what the edit says wins.
    const moved = named !== undefined && named.value !== before.parent;
    const requested = typeof request.level === 'number' ? request.level : undefined;

    let parent = moved ? named!.value : before.parent;
    let level = before.level;
    let follows = before.follows ?? false;
    if (requested === 0) {
      // A top-level arc has no parent: promoting one clears it, unless the same
      // edit names a new parent, which is a contradiction `problems` reports.
      level = 0;
      follows = false;
      if (!(moved && named!.value)) parent = null;
    } else if (requested !== undefined) {
      level = requested;
      follows = false;
    } else if (moved) {
      if (parent === null) {
        level = 0;
        follows = false;
      } else {
        // Moved without a level: it follows its new parent, wherever that is by the end.
        follows = true;
        const target = this.get(parent);
        level = target ? target.level + 1 : before.level;
      }
    }

    const start = instantOf(request.start_time) ?? before.start;
    const end = instantOf(request.end_time) ?? before.end;
    const timeChanged =
      (start !== undefined && before.start !== undefined && compareInstants(start, before.start) !== 0) ||
      (end !== undefined && before.end !== undefined && compareInstants(end, before.end) !== 0);
    const changed = parent !== before.parent || level !== before.level || timeChanged;
    const metaParent = parent !== before.parent ? parent : before.metaParent;
    this.put({ ...before, level, parent, metaParent, start, end, follows }, changed || moved);
    if (timeChanged) this.timeTouched.add(id);
    if (parent !== before.parent || level !== before.level) this.cascade(id);
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
    const children = this.index();
    const lifted = children.get(id)?.filter((child) => child !== id) ?? [];
    // A parent that is gone, the arc itself, or one of the arc's own
    // descendants (a stored cycle) leaves the children top level.
    const below = this.descendants(id, children);
    const parent = node.parent !== null && node.parent !== id && !below.has(node.parent) && this.get(node.parent) ? node.parent : null;
    this.state.set(id, null);
    this.touched.add(id);
    this.log.push(id);
    for (const childId of lifted) {
      const child = this.get(childId);
      if (!child) continue;
      const level = parent ? this.get(parent)!.level + 1 : 0;
      this.put({ ...child, parent, metaParent: parent, level, follows: false }, true);
      this.cascade(childId);
    }
    return lifted;
  }

  /** Give every arc moved without a level the level its parent ends with. */
  private settle(): void {
    for (let pass = 0; pass <= this.state.size; pass += 1) {
      let changed = false;
      for (const node of [...this.state.values()]) {
        if (!node?.follows || node.parent === null) continue;
        const current = this.get(node.id)!;
        const parent = this.get(node.parent);
        if (!parent || current.level === parent.level + 1) continue;
        this.put({ ...current, level: parent.level + 1 }, true);
        this.cascade(current.id);
        changed = true;
      }
      if (!changed) break;
    }
  }

  private within(inner: ArcNode, outer: ArcNode): boolean {
    if (!inner.start || !inner.end || !outer.start || !outer.end) return true;
    return compareInstants(inner.start, outer.start) >= 0 && compareInstants(inner.end, outer.end) <= 0;
  }

  /** Everything about the touched arcs that does not fit the hierarchy as it now stands. */
  problemList(): HierarchyProblem[] {
    this.settle();
    const problems: HierarchyProblem[] = [];
    const children = this.index();
    for (const id of this.touched) {
      const node = this.get(id);
      if (!node) continue;
      const label = `Arc "${node.name}"`;
      if (node.parent === null) {
        if (node.level > 0) {
          problems.push({ id, kind: 'level', message: `${label} has no parent but is at level ${node.level}; an arc with no parent is a top-level arc (level 0). Name its parent, or set its level to 0.` });
        }
      } else if (node.parent === node.id) {
        problems.push({ id, kind: 'parent', message: `${label} cannot be its own parent. Name a different parent, or set its level to 0.` });
      } else {
        const parent = this.get(node.parent);
        if (!parent) {
          problems.push({ id, kind: 'parent', other: node.parent, message: `${label} names parent ${node.parent}, which is not an arc in this graph. Name an existing arc, or set its level to 0.` });
        } else {
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
            problems.push({ id, kind: 'parent', other: parent.id, message: `${label} cannot be placed under "${parent.name}", which is one of its own descendants. Move "${parent.name}" out from under it first, or name another parent.` });
          } else if (node.level === 0) {
            problems.push({ id, kind: 'level', other: parent.id, message: `${label} is at level 0 (the top) but names parent "${parent.name}". Set its level to ${parent.level + 1}, or clear its parent.` });
          } else if (node.level !== parent.level + 1) {
            problems.push({
              id,
              kind: 'level',
              other: parent.id,
              message:
                `${label} is at level ${node.level}, but its parent "${parent.name}" is at level ${parent.level}, so a child must be level ${parent.level + 1}. ` +
                'Name a new parent that fits, or set its level to 0 to make it a top-level arc.',
            });
          }
          if (!this.within(node, parent)) {
            problems.push({
              id,
              kind: 'time-parent',
              other: parent.id,
              message:
                `${label} (${iso(node.start)} to ${iso(node.end)}) must lie within its parent "${parent.name}" (${iso(parent.start)} to ${iso(parent.end)}). ` +
                'Change its dates, or name a parent whose span contains it.',
            });
          }
        }
      }
      if (this.timeTouched.has(id)) {
        for (const childId of children.get(id) ?? []) {
          const child = this.get(childId);
          if (!child || child.id === id || this.within(child, node)) continue;
          problems.push({
            id: childId,
            kind: 'time-child',
            other: id,
            message: `Arc "${child.name}" (${iso(child.start)} to ${iso(child.end)}) must lie within its parent "${node.name}" (${iso(node.start)} to ${iso(node.end)}).`,
          });
        }
      }
    }
    return problems;
  }

  /** The messages for every touched arc that does not fit; empty when the hierarchy is valid. */
  problems(): string[] {
    return [...new Set(this.problemList().map((problem) => problem.message))];
  }

  /** Throws a 400 naming what is wrong, if anything is. */
  validate(): void {
    const list = this.problemList();
    const problems = [...new Set(list.map((problem) => problem.message))];
    // The field the first problem is about: dates for a span, otherwise the level.
    const field = list[0]?.kind === 'time-parent' || list[0]?.kind === 'time-child' ? 'start_time' : 'level';
    if (problems.length > 0) {
      const shown = problems.slice(0, 5).join(' ');
      throw new ValidationError(
        `The arc hierarchy would not be valid: ${shown}${problems.length > 5 ? ` (and ${problems.length - 5} more)` : ''}`,
        field,
        undefined,
        problems
      );
    }
  }
}

/** What a session wrote, to undo. */
interface LiveWrite {
  /** The arc as it was before the session first wrote it; null when the session created it. */
  before: Arc | null;
}

/** What `preflight` decided about one step. */
type Planned = { lifted?: string[] } | null;

/** An arc of the request graph, with the repositories a hierarchy edit writes through. */
export interface ArcHierarchyRepositories {
  arcRepository: Pick<ArcRepository, 'findAll' | 'findById' | 'create' | 'update' | 'delete' | 'setHierarchy'>;
  eventRepository?: Pick<EventRepository, 'findAll' | 'findById' | 'update'>;
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
 * `preflight` judges a list of steps without writing, against the state they
 * end in. `create`, `update` and `delete` then carry them out one at a time
 * (each arc written as that end state has it), and `finish` writes the arcs
 * the steps moved with them. The session remembers everything it wrote, so a
 * caller can version it (`edit`) or undo it (`undo`).
 */
export class ArcHierarchySession {
  private base?: Map<string, ArcNode>;
  /** The preflight's plan, as it ended: what the live writes aim at. */
  private target?: ArcHierarchyPlan;
  private targetHasBase = false;
  private readonly planned = new Map<string, Planned[]>();
  /** The live arcs as the session last wrote or read them. */
  private readonly current = new Map<string, Arc>();
  private readonly arcWrites = new Map<string, LiveWrite>();
  private readonly deletedIds = new Set<string>();
  private readonly namedIds = new Set<string>();
  private readonly liftedIds = new Set<string>();
  private readonly eventWrites = new Map<string, { before: Event; after: Event }>();

  constructor(
    private readonly graphId: string,
    private readonly repositories: ArcHierarchyRepositories,
    private readonly versioning: { headArcs?: (graphId: string, ids: string[], options?: { strict?: boolean }) => Promise<Record<string, Record<string, unknown>>> }
  ) {}

  /** Read the graph's arcs and their recorded parents, fresh. */
  private async loadNodes(): Promise<Map<string, ArcNode>> {
    const arcs = await this.repositories.arcRepository.findAll();
    const head = (await this.versioning.headArcs?.(this.graphId, arcs.map((arc) => arc.id))) ?? {};
    const nodes = new Map<string, ArcNode>();
    for (const arc of arcs) {
      this.current.set(arc.id, arc);
      const metaParent = recordedParent(arc.metadata);
      const parent = asParent(head[arc.id]?.parent_arc_id) ?? metaParent;
      nodes.set(arc.id, { id: arc.id, name: arc.name, level: arc.level, parent, metaParent, start: arc.start_time, end: arc.end_time });
    }
    return nodes;
  }

  private async load(): Promise<Map<string, ArcNode>> {
    this.base ??= await this.loadNodes();
    return this.base;
  }

  private async arcOf(id: string): Promise<Arc | null> {
    const known = this.current.get(id);
    if (known) return known;
    const found = await this.repositories.arcRepository.findById(id);
    if (found) this.current.set(id, found);
    return found;
  }

  /** An arc as the store holds it now. */
  async peek(id: string): Promise<Arc | null> {
    return this.arcOf(id);
  }

  /** Whether an edit changes the hierarchy (a parent, a level, a span), judged against the one arc. */
  private async updateNeedsPlan(id: string, data: ArcParentRequest): Promise<boolean> {
    const existing = await this.arcOf(id);
    // Not in the store: a step of this batch may create it.
    if (!existing) return true;
    // Strict, as the edit's own version is: an arc whose head copy cannot be read is not edited.
    const head = ((await this.versioning.headArcs?.(this.graphId, [id], { strict: true })) ?? {})[id];
    const effective = asParent(head?.parent_arc_id) ?? recordedParent(existing.metadata);
    const named = namedParent(data);
    if (named !== undefined && named.value !== effective) return true;
    if (typeof data.level === 'number' && (data.level !== existing.level || (data.level === 0 && effective !== null))) return true;
    const start = instantOf(data.start_time);
    const end = instantOf(data.end_time);
    return (start !== undefined && compareInstants(start, existing.start_time) !== 0) || (end !== undefined && compareInstants(end, existing.end_time) !== 0);
  }

  private async needsBase(steps: PlanStep[]): Promise<boolean> {
    for (const step of steps) {
      if (step.kind === 'delete') return true;
      if (step.kind === 'create' && namedParent(step.data)?.value) return true;
      if (step.kind === 'update' && (await this.updateNeedsPlan(step.id, step.data))) return true;
    }
    return false;
  }

  /**
   * Judge steps against the state they end in, writing nothing. Throws a 400
   * if that state is not a valid hierarchy. Call before the first write.
   */
  async preflight(steps: PlanStep[]): Promise<void> {
    const needsBase = await this.needsBase(steps);
    const dry = new ArcHierarchyPlan(needsBase ? await this.load() : new Map());
    this.planned.clear();
    const queue = (kind: string, id: string, planned: Planned): void => {
      const key = `${kind}:${id}`;
      this.planned.set(key, [...(this.planned.get(key) ?? []), planned]);
    };
    // A store takes a create for an upsert, so a create may not name an id an arc holds, or that
    // an earlier step of this batch touched (a delete and a create of one id would leave the
    // undo nothing to put back). Checked by id, without reading the graph's arcs.
    const touchedIds = new Set<string>();
    for (const step of steps) {
      const id = step.kind === 'create' ? (typeof step.data.id === 'string' ? step.data.id : undefined) : step.id;
      if (step.kind === 'create' && id !== undefined) {
        if (touchedIds.has(id) || (await this.arcOf(id)) !== null) {
          throw new ValidationError(`An arc with the id "${id}" already exists in this graph, or an earlier step of this batch uses it; a create cannot take its place (use an update, or another id)`, 'id', id);
        }
      }
      if (id !== undefined) touchedIds.add(id);
      if (step.kind === 'create') dry.create(step.data);
      else if (step.kind === 'update') queue('update', step.id, needsBase && dry.update(step.id, step.data) ? {} : null);
      else {
        const lifted = dry.delete(step.id);
        queue('delete', step.id, lifted ? { lifted } : null);
      }
    }
    dry.validate();
    this.target = dry;
    this.targetHasBase = needsBase;
  }

  private take(kind: string, id: string): Planned | undefined {
    return this.planned.get(`${kind}:${id}`)?.shift();
  }

  /** The metadata of an arc as the plan decided its parent. */
  private metadataFor(base: Record<string, unknown> | undefined, node: ArcNode): Record<string, unknown> {
    return withParent(base, node.metaParent);
  }

  async create(data: CreateArcRequest & ArcParentRequest): Promise<Arc> {
    const named = namedParent(data);
    const request = withoutParentField(data) as CreateArcRequest;
    if (named && named.value) request.metadata = withParent(request.metadata, named.value);
    // Judged by the preflight (against the end state) when there was one.
    const created = await this.repositories.arcRepository.create(request, { validated: this.target !== undefined });
    this.current.set(created.id, created);
    // An id the session already wrote (deleted, say) keeps its before-image: the create is
    // refused for such an id by the preflight, and must never overwrite what undo restores.
    if (!this.arcWrites.has(created.id)) this.arcWrites.set(created.id, { before: null });
    return created;
  }

  /**
   * Carry out an edit. Null when there is no such arc. An arc the hierarchy
   * decided is written as the end state has it; the arcs it moves with it are
   * written by `finish`.
   */
  async update(id: string, updates: UpdateArcRequest & ArcParentRequest): Promise<Arc | null> {
    const existing = await this.arcOf(id);
    if (!existing) return null;
    if (!this.planned.has(`update:${id}`)) await this.preflight([{ kind: 'update', id, data: updates }]);
    const planned = this.take('update', id);
    const request = withoutParentField(updates) as UpdateArcRequest;
    this.namedIds.add(id);

    const node = planned ? this.target?.get(id) : null;
    if (!planned || !node) {
      // Nothing about its place changes: its parent stays recorded as it was.
      const recorded = recordedParent(existing.metadata);
      if (request.metadata !== undefined && recorded) request.metadata = withParent(request.metadata, recorded);
      return this.write(id, request, false);
    }
    return this.write(id, { ...request, level: node.level, metadata: this.metadataFor(request.metadata ?? existing.metadata, node) }, true);
  }

  private async write(id: string, request: UpdateArcRequest, validated: boolean): Promise<Arc | null> {
    const before = await this.arcOf(id);
    const updated = await this.repositories.arcRepository.update(id, request, { validated });
    if (!updated) return null;
    if (before && !this.arcWrites.has(id)) this.arcWrites.set(id, { before });
    this.current.set(id, updated);
    return updated;
  }

  /**
   * Write the arcs the steps moved with the ones they named: a subtree that
   * followed its root, children lifted by a delete, arcs that follow a parent.
   * Call once, after the last step.
   */
  async finish(): Promise<void> {
    const target = this.target;
    if (!target || !this.targetHasBase) return;
    for (const id of target.touchedIds()) {
      const node = target.get(id);
      const arc = node ? await this.arcOf(id) : null;
      if (!node || !arc || this.deletedIds.has(id)) continue;
      if (arc.level === node.level && recordedParent(arc.metadata) === node.metaParent) continue;
      const moved = await this.repositories.arcRepository.setHierarchy(id, { level: node.level, metadata: this.metadataFor(arc.metadata, node) }, { validated: true });
      if (!moved) continue;
      if (!this.arcWrites.has(id)) this.arcWrites.set(id, { before: arc });
      this.current.set(id, moved);
    }
  }

  /**
   * Delete an arc, unassigning its events; its children move up when `finish`
   * runs. False when there is no such arc.
   */
  async delete(id: string): Promise<boolean> {
    const arc = await this.arcOf(id);
    if (!arc) return this.repositories.arcRepository.delete(id);
    if (!this.planned.has(`delete:${id}`)) await this.preflight([{ kind: 'delete', id }]);
    const planned = this.take('delete', id);
    if (!(await this.repositories.arcRepository.delete(id))) return false;
    if (!this.arcWrites.has(id)) this.arcWrites.set(id, { before: arc });
    this.deletedIds.add(id);
    this.current.delete(id);
    for (const childId of planned?.lifted ?? []) this.liftedIds.add(childId);
    await this.unassignEvents(id);
    return true;
  }

  /** Let go of every event assigned to a deleted arc. */
  private async unassignEvents(arcId: string): Promise<void> {
    const { eventRepository } = this.repositories;
    if (!eventRepository) return;
    for (const event of await eventRepository.findAll()) {
      const metadata = event.metadata;
      if (!metadata || (metadata.arcId !== arcId && metadata.arc_id !== arcId)) continue;
      const { arcId: _a, arc_id: _b, ...rest } = metadata;
      const after = await eventRepository.update(event.id, { metadata: rest });
      if (!after) continue;
      const first = this.eventWrites.get(event.id);
      this.eventWrites.set(event.id, { before: first?.before ?? event, after });
    }
  }

  private async restoreOne(id: string): Promise<void> {
    const write = this.arcWrites.get(id);
    if (!write) return;
    const { arcRepository } = this.repositories;
    if (write.before === null) {
      await arcRepository.delete(id);
      this.current.delete(id);
    } else if (this.deletedIds.has(id)) {
      await arcRepository.create(toCreateRequest(write.before), { validated: true });
      this.deletedIds.delete(id);
      this.current.set(id, write.before);
    } else {
      const before = write.before;
      await arcRepository.update(id, { name: before.name, description: before.description, start_time: before.start_time, end_time: before.end_time, level: before.level, metadata: before.metadata ?? {} }, { validated: true });
      this.current.set(id, before);
    }
  }

  /**
   * Give back the arc reference a delete took from an event: only those keys, and
   * only while the event has neither (a later step may have assigned it elsewhere,
   * or changed anything else about it, and that stays).
   */
  private async restoreEvents(): Promise<void> {
    const { eventRepository } = this.repositories;
    if (!eventRepository) return;
    for (const [id, write] of this.eventWrites) {
      try {
        const current = await eventRepository.findById(id);
        const before = write.before.metadata ?? {};
        if (!current || current.metadata?.arcId !== undefined || current.metadata?.arc_id !== undefined) continue;
        const removed: Record<string, unknown> = {};
        if (before.arcId !== undefined) removed.arcId = before.arcId;
        if (before.arc_id !== undefined) removed.arc_id = before.arc_id;
        await eventRepository.update(id, { metadata: { ...(current.metadata ?? {}), ...removed } });
      } catch (error) {
        logger.error('Could not give an event back its arc', error, { id });
      }
    }
  }

  /** Events that name an arc this session made and then took back, now naming nothing. */
  private readonly clearedEvents = new Set<string>();

  /** The arcs this session created (and so would remove), for `clearReferences` after an undo. */
  createdArcIds(): string[] {
    return [...this.arcWrites].filter(([, write]) => write.before === null).map(([id]) => id);
  }

  /**
   * Arcs this session made are gone: the events that a step of the batch (`stepEvents`) put
   * in them no longer name them. An event the batch did not write, which names an arc id
   * that simply does not exist yet, is left as it is.
   */
  async clearReferences(arcIds: string[], stepEvents: ReadonlySet<string>): Promise<void> {
    const { eventRepository } = this.repositories;
    if (!eventRepository || arcIds.length === 0 || stepEvents.size === 0) return;
    const gone = new Set(arcIds);
    for (const event of await eventRepository.findAll()) {
      const metadata = event.metadata;
      if (!stepEvents.has(event.id) || !metadata || !(gone.has(String(metadata.arcId)) || gone.has(String(metadata.arc_id)))) continue;
      const { arcId: _a, arc_id: _b, ...rest } = metadata;
      try {
        await eventRepository.update(event.id, { metadata: rest });
        this.clearedEvents.add(event.id);
      } catch (error) {
        logger.error('Could not clear an event\'s reference to an arc that was not made', error, { id: event.id });
      }
    }
  }

  /** The events whose reference to an arc that was not made was cleared. */
  clearedEventIds(): string[] {
    return [...this.clearedEvents];
  }

  /** Put back everything the session wrote: arcs, deleted arcs, events. */
  async undo(): Promise<void> {
    const ids = [...this.arcWrites.keys()];
    // Arcs that were there first (deleted ones back), then the arcs the session created.
    for (const id of ids.filter((key) => this.arcWrites.get(key)!.before !== null)) {
      try {
        await this.restoreOne(id);
      } catch (error) {
        logger.error('Could not restore an arc', error, { id });
      }
    }
    for (const id of ids.filter((key) => this.arcWrites.get(key)!.before === null).reverse()) {
      try {
        await this.restoreOne(id);
      } catch (error) {
        logger.error('Could not remove a created arc', error, { id });
      }
    }
    await this.restoreEvents();
    this.arcWrites.clear();
    this.deletedIds.clear();
    this.eventWrites.clear();
  }

  /** Containment problems of one arc against its parent and its children, for `validate-hierarchy`. */
  async containment(id: string): Promise<HierarchyProblem[]> {
    const plan = new ArcHierarchyPlan(await this.loadNodes());
    plan.touch(id);
    return plan.problemList().filter((problem) => problem.kind === 'time-parent' || problem.kind === 'time-child');
  }

  /** Every arc id this session wrote, created, moved or deleted. */
  arcIds(): string[] {
    return [...this.arcWrites.keys()];
  }

  /** Arcs written beyond the ones the caller named (a subtree that moved, children lifted). */
  moved(): string[] {
    return [...this.arcWrites.keys()].filter((id) => !this.namedIds.has(id) && !this.deletedIds.has(id) && this.arcWrites.get(id)!.before !== null);
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
    return this.moved().length > 0 || this.eventWrites.size > 0;
  }

  /** Whether the hierarchy decided what was written (a real move, or a delete). */
  get decided(): boolean {
    return this.targetHasBase;
  }

  /** The parent each written arc ends with, as the plan decided it. */
  parents(): Map<string, string | null> {
    const parents = new Map<string, string | null>();
    if (!this.targetHasBase) return parents;
    for (const id of this.arcWrites.keys()) {
      const node = this.deletedIds.has(id) ? null : this.target?.get(id);
      if (node) parents.set(id, node.parent);
    }
    return parents;
  }

  /** What to version: the arcs as they now stand, the arcs gone, the events changed. */
  edit(summary: string): ArcEdit {
    const updated: Arc[] = [];
    for (const id of this.arcWrites.keys()) {
      const arc = this.deletedIds.has(id) ? undefined : this.current.get(id);
      if (arc) updated.push(arc);
    }
    return { updated, deleted: [...this.deletedIds], events: [...this.eventWrites.values()].map((write) => write.after), summary, parents: this.parents() };
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
  if (moved === 0) return `Edited arc “${name}”`;
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
    let updated: Arc | null;
    try {
      updated = await session.update(id, updates);
      if (!updated) return null;
      await session.finish();
    } catch (error) {
      await session.undo().catch((rollbackError) => logger.error('Compensating rollback failed for an arc edit', rollbackError, { id }));
      throw error;
    }
    const arc = updated;
    await this.version(graphId, session, async () => {
      if (!session.decided) await this.versioning.recordArc(graphId, arc, 'update', { undoneOnFailure: true });
      else await this.versioning.recordArcEdit(graphId, session.edit(describeMoves(arc.name, 'update', session.moved().length, 0)), { undoneOnFailure: true });
    }, id, arc.name);
    return arc;
  }

  /**
   * Delete an arc, lifting its children, and version it. False when there is
   * no such arc. A child that would not lie within its new parent refuses the
   * delete (a 400).
   */
  async deleteArc(graphId: string, repositories: ArcHierarchyRepositories, id: string): Promise<{ deleted: boolean; moved: string[]; unassigned: string[] }> {
    const session = this.open(graphId, repositories);
    const name = (await session.peek(id))?.name ?? '';
    await session.preflight([{ kind: 'delete', id }]);
    try {
      if (!(await session.delete(id))) return { deleted: false, moved: [], unassigned: [] };
      await session.finish();
    } catch (error) {
      await session.undo().catch((rollbackError) => logger.error('Compensating rollback failed for an arc delete', rollbackError, { id }));
      throw error;
    }
    const summary = describeMoves(name, 'delete', session.lifted().length, session.eventIds().length);
    await this.versioning.recordArcEdit(graphId, session.edit(summary));
    return { deleted: true, moved: session.lifted(), unassigned: session.eventIds() };
  }

  private async version(graphId: string, session: ArcHierarchySession, record: () => Promise<void>, id: string, name: string): Promise<void> {
    try {
      await record();
    } catch (versionError) {
      try {
        await session.undo();
      } catch (rollbackError) {
        logger.error('Compensating rollback failed for an arc edit', rollbackError, { id });
        this.versioning.announceNotVersioned(graphId, 'update', 'arc', id, { name });
      }
      throw versionError;
    }
  }
}
