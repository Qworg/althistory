/**
 * The one-off migration that gives cloud links their ids (issue 30).
 *
 * Before links carried an `id`, cloud mode named a link `cause->effect` in the
 * version store and on the live feed, so two links between one pair of events
 * shared a name. A link now stores an id of its own. This migration names the
 * edges that predate it, once, at startup and before a request is served, so a
 * read never writes.
 *
 * For each graph, for each pair of events with edges that have no id:
 *  - the OLDEST such edge takes `cause->effect`, the id the version history and
 *    the feed already know it by, so a head that holds `A->B` stays consistent
 *    (an edit updates that entry, a delete removes it, a rollback does not bring
 *    a second one back);
 *  - every further edge of the pair takes `link_<uuid>`.
 *
 * The extra edges are the ones the head does not know. Where a pair had several
 * edges they all shared the one `A->B` entry, which holds whichever of them was
 * written last. The head is then reconciled for exactly those pairs, as one
 * version ("Added N links ..."): each live edge is written under its own id and
 * the pair's other head links, if any, are removed. So nothing the store holds
 * is missing from the head, and nothing it no longer holds is kept.
 *
 * Idempotent and safe to re-run: it touches only edges without an id, never
 * reuses a name an edge already has, and does nothing (one read) when there is
 * nothing to name. It is written for one process at startup, which is what
 * `CLOUD_SINGLE_REPLICA_STATE` asserts.
 */

import { randomUUID } from 'crypto';
import type { StoredCausalRelationship } from './CausalService';
import type { BatchLiveState, BatchStep } from './GraphWriteVersioningService';

/** The slice of a Neo4j session the migration uses. */
export interface MigrationSession {
  run(query: string, parameters?: Record<string, unknown>): Promise<{ records: ReadonlyArray<{ get(key: string): unknown }> }>;
  close(): Promise<void>;
}

export interface CausalLinkIdMigrationOptions {
  /** A write session; one is opened per call and closed. */
  openSession: () => MigrationSession;
  /** Records the reconciling version of a graph. Omit to name the edges only. */
  versioning?: { recordBatch(graphId: string, state: BatchLiveState, steps: BatchStep[], options?: { announceIfNotVersioned?: boolean }): Promise<void> };
  log?: (message: string) => void;
  warn?: (message: string) => void;
}

export interface CausalLinkIdMigrationResult {
  /** Edges that were given the `cause->effect` id. */
  named: number;
  /** Edges given a `link_<uuid>` because their pair had more than one. */
  extra: number;
  /** Graphs whose version head was reconciled. */
  reconciledGraphs: number;
}

interface Unnamed {
  element: string;
  graphId: string | null;
  cause: string;
  effect: string;
}

function toNumber(value: unknown): number {
  const counted = value as { toNumber?: () => number } | number;
  return typeof counted === 'object' && counted !== null && typeof counted.toNumber === 'function' ? counted.toNumber() : Number(counted);
}

export async function migrateCausalLinkIds(options: CausalLinkIdMigrationOptions): Promise<CausalLinkIdMigrationResult> {
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const log = options.log ?? ((message: string) => console.log(message));
  const result: CausalLinkIdMigrationResult = { named: 0, extra: 0, reconciledGraphs: 0 };

  const session = options.openSession();
  const reconcile = new Map<string, Array<{ cause: string; effect: string; extras: string[] }>>();
  try {
    // Oldest first within a pair; the element id breaks a tie on the same instant.
    const found = await session.run(
      `MATCH (cause:Event)-[r:CAUSES]->(effect:Event)
       WHERE r.id IS NULL
       RETURN elementId(r) AS element, r.graphId AS graphId, cause.id AS cause, effect.id AS effect
       ORDER BY cause.id, effect.id, r.created_at, elementId(r)`
    );
    if (found.records.length === 0) return result;

    const unnamed: Unnamed[] = found.records.map((record) => ({
      element: String(record.get('element')),
      graphId: typeof record.get('graphId') === 'string' ? (record.get('graphId') as string) : null,
      cause: String(record.get('cause')),
      effect: String(record.get('effect')),
    }));

    // Names an edge already carries (a re-run after a partial run, or an edge
    // made by this version): a pair's `cause->effect` is never given twice in a graph.
    const takenResult = await session.run(`MATCH ()-[r:CAUSES]->() WHERE r.id IS NOT NULL RETURN r.graphId AS graphId, r.id AS id`);
    const taken = new Set(takenResult.records.map((record) => `${String(record.get('graphId'))}|${String(record.get('id'))}`));

    const groups = new Map<string, Unnamed[]>();
    for (const edge of unnamed) {
      const key = `${edge.graphId}|${edge.cause}|${edge.effect}`;
      const group = groups.get(key);
      if (group) group.push(edge);
      else groups.set(key, [edge]);
    }

    const rows: Array<{ element: string; id: string }> = [];
    for (const group of groups.values()) {
      const first = group[0] as Unnamed;
      const pairName = `${first.cause}->${first.effect}`;
      const extras: string[] = [];
      group.forEach((edge, index) => {
        const nameIt = index === 0 && !taken.has(`${edge.graphId}|${pairName}`);
        const id = nameIt ? pairName : `link_${randomUUID()}`;
        if (nameIt) {
          result.named += 1;
          taken.add(`${edge.graphId}|${pairName}`);
        } else {
          result.extra += 1;
          extras.push(id);
        }
        rows.push({ element: edge.element, id });
      });
      if (extras.length > 0 && first.graphId !== null) {
        const pairs = reconcile.get(first.graphId) ?? [];
        pairs.push({ cause: first.cause, effect: first.effect, extras });
        reconcile.set(first.graphId, pairs);
      }
    }

    // One statement, so it is all or nothing; the guard keeps a re-run harmless.
    await session.run(
      `UNWIND $rows AS row
       MATCH ()-[r:CAUSES]->()
       WHERE elementId(r) = row.element AND r.id IS NULL
       SET r.id = row.id`,
      { rows }
    );

    if (options.versioning) {
      for (const [graphId, pairs] of reconcile) {
        try {
          await reconcileHead(session, options.versioning, graphId, pairs);
          result.reconciledGraphs += 1;
        } catch (error) {
          // The edges are named and the live store is right; only the version
          // head lacks the extra links. Report it, and do not stop the server.
          warn(
            `Causal link ids: graph ${graphId} was migrated but its version history could not be reconciled ` +
              `(${error instanceof Error ? error.message : String(error)}); the extra links are in the live store and not in a version`
          );
        }
      }
    }
    log(
      `Causal link ids: named ${result.named} link(s) as cause->effect and ${result.extra} further link(s) of the same pair with an id of their own` +
        (result.reconciledGraphs > 0 ? `; reconciled the version history of ${result.reconciledGraphs} graph(s)` : '')
    );
    return result;
  } finally {
    await session.close();
  }
}

/** Write the live links of each affected pair into the head, under their own ids. */
async function reconcileHead(
  session: MigrationSession,
  versioning: NonNullable<CausalLinkIdMigrationOptions['versioning']>,
  graphId: string,
  pairs: Array<{ cause: string; effect: string; extras: string[] }>
): Promise<void> {
  const state: BatchLiveState = { links: [] };
  const steps: BatchStep[] = [];
  for (const pair of pairs) {
    const live = await session.run(
      `MATCH (cause:Event {id: $cause})-[r:CAUSES]->(effect:Event {id: $effect})
       WHERE r.graphId = $graphId
       RETURN r.id AS id, r.weight AS weight, r.confidence AS confidence, r.evidence AS evidence, r.relationship_type AS type
       ORDER BY r.created_at, r.id`,
      { cause: pair.cause, effect: pair.effect, graphId }
    );
    const links: StoredCausalRelationship[] = live.records.map((record) => ({
      id: String(record.get('id')),
      cause_event_id: pair.cause,
      effect_event_id: pair.effect,
      weight: typeof record.get('weight') === 'number' ? (record.get('weight') as number) : toNumber(record.get('weight')),
      confidence: typeof record.get('confidence') === 'number' ? (record.get('confidence') as number) : toNumber(record.get('confidence')),
      evidence: typeof record.get('evidence') === 'string' ? (record.get('evidence') as string) : '',
      relationship_type: (typeof record.get('type') === 'string' ? record.get('type') : 'direct') as StoredCausalRelationship['relationship_type'],
    }));
    state.links!.push({ cause_event_id: pair.cause, effect_event_id: pair.effect, live: links });
    for (const id of pair.extras) steps.push({ operation: 'create', type: 'relationship', id });
  }
  await versioning.recordBatch(graphId, state, steps, { announceIfNotVersioned: false });
}
