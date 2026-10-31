/**
 * Makes a graph's live entity store match the head of its version tree.
 *
 * The two stores are written in one direction in normal use: an API write lands
 * in the live store (which every entity route and the UI read) and
 * `GraphWriteVersioningService` mirrors it into the version tree. A handful of
 * operations work the other way round and write only the version tree:
 *
 *   - branching a graph (the branch's initial tree is the source's head),
 *   - rolling a graph back to an earlier version,
 *   - merging one graph into another,
 *   - importing a document, including approving an ingestion review job.
 *
 * Before this service existed nothing carried those writes back to the live
 * store, so a new branch looked empty, a rollback changed nothing on screen,
 * and approved ingestions never appeared. Each of those operations now calls
 * `materialize(graphId)` once its version commit has landed.
 *
 * Materializing replaces the live store wholesale rather than diffing it: the
 * version head is the record of what the graph is, and every entity keeps the
 * id it has in the tree, so later live writes keep mirroring onto the same
 * version entities. Pressures are not copied: the live store does not hold
 * them; they are inferred from the events on every read.
 */

import type { ResolvedGraphData } from '@/repositories/VersionRepository';
import type { GraphScopedRepositories } from '@/container';
import type { StoredCausalRelationship } from './CausalService';
import { createLogger, ILogger } from '@/utils/logger';

export interface LiveStoreSyncConfig {
  /** The version head of a graph. */
  checkout(graphId: string): Promise<ResolvedGraphData>;
  /** Repositories bound to one graph's live store. */
  scopedRepositories(graphId: string): Promise<GraphScopedRepositories>;
  /** Remove every live entity of one graph (and nothing of any other graph). */
  clearLiveStore(graphId: string): Promise<void>;
  /** Drop cached reads that could still describe the replaced entities. */
  invalidateCaches?(): Promise<void>;
  logger?: ILogger;
}

export interface MaterializeResult {
  events: number;
  arcs: number;
  relationships: number;
  /** Entities in the tree the live store refused, with the reason. */
  skipped: Array<{ type: 'event' | 'arc' | 'relationship'; id: string; reason: string }>;
}

/** Called after an operation replaced a graph's version head. */
export type HeadReplacedHook = (graphId: string) => Promise<void>;

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asDate(value: unknown): Date | undefined {
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  return undefined;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  // The live store keeps metadata as a JSON string; a tree written from it can
  // carry the string form.
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class LiveStoreSyncService {
  private readonly config: LiveStoreSyncConfig;
  private readonly logger: ILogger;
  /** One materialization per graph at a time; a second waits for the first. */
  private readonly inFlight = new Map<string, Promise<MaterializeResult>>();

  constructor(config: LiveStoreSyncConfig) {
    this.config = config;
    this.logger = config.logger ?? createLogger('LiveStoreSyncService');
  }

  async materialize(graphId: string): Promise<MaterializeResult> {
    const previous = this.inFlight.get(graphId);
    const run = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(() =>
      this.replace(graphId)
    );
    this.inFlight.set(graphId, run);
    try {
      return await run;
    } finally {
      if (this.inFlight.get(graphId) === run) this.inFlight.delete(graphId);
    }
  }

  private async replace(graphId: string): Promise<MaterializeResult> {
    const tree = await this.config.checkout(graphId);
    const { eventRepository, arcRepository, causalService } = await this.config.scopedRepositories(graphId);
    await this.config.clearLiveStore(graphId);

    const result: MaterializeResult = { events: 0, arcs: 0, relationships: 0, skipped: [] };

    for (const [id, data] of Object.entries(tree.arcs)) {
      const start = asDate(data.start_time);
      const end = asDate(data.end_time);
      const name = asString(data.name);
      if (!start || !end || !name) {
        result.skipped.push({ type: 'arc', id, reason: 'missing name, start_time or end_time' });
        continue;
      }
      try {
        await arcRepository.create({
          id,
          name,
          description: asString(data.description),
          start_time: start,
          end_time: end,
          level: asNumber(data.level, 1),
          metadata: asRecord(data.metadata),
        });
        result.arcs += 1;
      } catch (error) {
        result.skipped.push({ type: 'arc', id, reason: reasonOf(error) });
      }
    }

    for (const [id, data] of Object.entries(tree.events)) {
      const timestamp = asDate(data.timestamp);
      const description = asString(data.description);
      const actor = asString(data.actor);
      const target = asString(data.target);
      if (!timestamp || !description || !actor || !target) {
        result.skipped.push({ type: 'event', id, reason: 'missing description, actor, target or timestamp' });
        continue;
      }
      try {
        await eventRepository.create({ id, description, actor, target, timestamp, metadata: asRecord(data.metadata) });
        result.events += 1;
      } catch (error) {
        result.skipped.push({ type: 'event', id, reason: reasonOf(error) });
      }
    }

    for (const [id, data] of Object.entries(tree.relationships)) {
      const cause = asString(data.cause_event_id);
      const effect = asString(data.effect_event_id);
      if (!cause || !effect) {
        result.skipped.push({ type: 'relationship', id, reason: 'missing cause_event_id or effect_event_id' });
        continue;
      }
      const relationship: StoredCausalRelationship = {
        id,
        cause_event_id: cause,
        effect_event_id: effect,
        weight: asNumber(data.weight, 0.5),
        confidence: asNumber(data.confidence, 0.5),
        evidence: asString(data.evidence) ?? '',
        relationship_type: (asString(data.relationship_type) ?? 'direct') as StoredCausalRelationship['relationship_type'],
      };
      try {
        await causalService.restoreCausalLink(relationship);
        result.relationships += 1;
      } catch (error) {
        result.skipped.push({ type: 'relationship', id, reason: reasonOf(error) });
      }
    }

    await this.config.invalidateCaches?.();

    if (result.skipped.length > 0) {
      this.logger.warn('Some version entities could not be written to the live store', {
        graphId,
        skipped: result.skipped,
      });
    }
    this.logger.info('Live store materialized from the version head', {
      graphId,
      events: result.events,
      arcs: result.arcs,
      relationships: result.relationships,
    });
    return result;
  }
}
