/**
 * The one-off migration that gives cloud links their ids (issue 30).
 *
 * Before links carried an `id`, cloud mode named a link `cause->effect` in the
 * version store and on the live feed, and a graph imported or branched there
 * versioned its links under other ids (`rel_...`). A link now stores an id of
 * its own. This migration names the edges that predate it, once, at startup and
 * before a request is served, so a read never writes.
 *
 * It is built so that every step can be repeated, in this order, per graph:
 *
 *  1. PLAN. Each id-less edge is matched to the head's links of its pair, and
 *     gets an id that is a pure function of the data (no random ids):
 *       - an edge whose own derived id (`link_` + a hash of its `elementId`) is
 *         already in the head keeps it (this is what makes a re-plan after a
 *         crash agree with the first plan);
 *       - head links and edges that match on their data (evidence, type,
 *         strength, confidence), one to one, are paired: the edge adopts the
 *         head's id;
 *       - a lone edge left with a lone head link adopts that id, whatever the
 *         data (the common case: a graph imported on `main`, whose head holds
 *         `rel_...`, or a cloud link held under `cause->effect`);
 *       - the edges still without an id: the oldest takes `cause->effect` if
 *         nothing in the graph uses that name, the rest `link_` + hash(elementId).
 *  2. RECONCILE THE HEAD first, only where it differs from the plan: the head
 *     is written so that each pair holds every live edge under its planned id
 *     with its live data, and holds no link that no live edge maps to, as one
 *     version. Nothing is lost, and what the store no longer holds is not kept.
 *  3. NAME THE EDGES, in chunks of about 5,000 edges (a pair's edges never
 *     split across chunks). `r.id IS NULL` guards every write.
 *
 * So a process that stops between 2 and 3 plans the same ids on the next start,
 * finds the head already right (no new version) and names the edges; a run that
 * stops part-way through 3 resumes. A graph whose head cannot be reconciled is
 * not named (its edges are read as `cause->effect` until the next start) and
 * the failure is reported.
 *
 * A legacy edge with no evidence is stored, in the head and on the edge, as
 * `(no evidence recorded)`, as the importers store it.
 *
 * Cost: one read of the id-less edges, then per graph a read of its head and
 * its named edges. It is a one-off: once every edge is named a start costs one
 * cheap read. Measured on 1 GB of Neo4j heap: see the cloud suite.
 */

import { createHash } from 'crypto';
import type { StoredCausalRelationship } from './CausalService';
import type { BatchLiveState, BatchStep } from './GraphWriteVersioningService';
import { NO_EVIDENCE_PLACEHOLDER } from '@/utils/linkEvidence';
import { getDatabaseManager } from '@/utils/database';
import type { Container } from '@/container';

/** The slice of a Neo4j session the migration uses. */
export interface MigrationSession {
  run(query: string, parameters?: Record<string, unknown>): Promise<{ records: ReadonlyArray<{ get(key: string): unknown }> }>;
  close(): Promise<void>;
}

/** A link as the version head holds it. */
export interface HeadLink {
  cause_event_id: string;
  effect_event_id: string;
  evidence?: unknown;
  relationship_type?: unknown;
  weight?: unknown;
  confidence?: unknown;
  /** A link that ends in another graph: its edge is not in this graph's store, so it is never "stale". */
  causeGraphId?: unknown;
  effectGraphId?: unknown;
}

/** Who the upgrade's version is by: the version history shows it as a system change, not a person's. */
export const LINK_ID_UPGRADE_USER = 'system:link-id-upgrade';

export interface CausalLinkIdMigrationOptions {
  /** A write session; one is opened per call and closed. */
  openSession: () => MigrationSession;
  /** Reads the links of a graph's version head; null when the graph has no versions. Without it (and `versioning`) edges are only named. */
  headLinks?: (graphId: string) => Promise<Record<string, HeadLink> | null>;
  /** Records the reconciling version of a graph. */
  versioning?: { recordBatch(graphId: string, state: BatchLiveState, steps: BatchStep[], options?: { announceIfNotVersioned?: boolean; summary?: string; userId?: string; reconcilePairs?: boolean }): Promise<void> };
  /** Edges per naming statement (a pair is never split). Default 5,000. */
  chunkSize?: number;
  log?: (message: string) => void;
  warn?: (message: string) => void;
}

export interface CausalLinkIdMigrationResult {
  /** Edges that were given an id. */
  named: number;
  /** Of those, edges that adopted an id the head already held. */
  adopted: number;
  /** Graphs whose version head was written (a graph whose head already agreed is not counted). */
  reconciledGraphs: number;
  /** Graphs left unnamed because their head could not be read or written. */
  failedGraphs: number;
}

interface Edge {
  element: string;
  graphId: string | null;
  cause: string;
  effect: string;
  createdAt: string | null;
  evidence: string;
  /** The evidence was missing or blank. */
  noEvidence: boolean;
  type: string;
  weight: number;
  confidence: number;
}

const DEFAULT_CHUNK = 5000;

function num(value: unknown, fallback: number): number {
  const counted = value as { toNumber?: () => number } | number | null | undefined;
  if (typeof counted === 'number') return counted;
  if (counted && typeof counted === 'object' && typeof counted.toNumber === 'function') return counted.toNumber();
  return fallback;
}

/**
 * `link_` + a hash of what names the edge: its graph, its two events, its creation
 * time and its `elementId`. Never random, and the same on every re-plan. Neo4j can
 * give an `elementId` again after a restore or a downgrade, so it is not trusted
 * alone: an edge that took an old one's id would also have to be the same link.
 */
export function derivedLinkId(edge: Pick<Edge, 'graphId' | 'cause' | 'effect' | 'createdAt' | 'element'>): string {
  const name = [edge.graphId ?? '', edge.cause, edge.effect, edge.createdAt ?? '', edge.element].join('\u0000');
  return `link_${createHash('sha1').update(name).digest('hex').slice(0, 24)}`;
}

const pairKey = (cause: string, effect: string): string => `${cause}\u0000${effect}`;

function sameData(edge: Edge, head: HeadLink): boolean {
  const evidence = typeof head.evidence === 'string' ? head.evidence : '';
  const headEvidence = evidence.trim() === '' ? NO_EVIDENCE_PLACEHOLDER : evidence;
  return (
    headEvidence === edge.evidence &&
    (typeof head.relationship_type === 'string' ? head.relationship_type : 'direct') === edge.type &&
    num(head.weight, 0.5) === edge.weight &&
    num(head.confidence, 0.7) === edge.confidence
  );
}

function sameDataEdges(a: Edge, b: Edge): boolean {
  return a.evidence === b.evidence && a.type === b.type && a.weight === b.weight && a.confidence === b.confidence;
}

/** Oldest first; an edge with no `created_at` after those with one; the element id breaks every tie. */
function byAge(a: Edge, b: Edge): number {
  if (a.createdAt !== b.createdAt) {
    if (a.createdAt === null) return 1;
    if (b.createdAt === null) return -1;
    return a.createdAt < b.createdAt ? -1 : 1;
  }
  return a.element < b.element ? -1 : a.element > b.element ? 1 : 0;
}

interface PairPlan {
  /** element -> planned id, for the edges to name. */
  ids: Map<string, string>;
  /** The edges that adopted a head id. */
  adopted: number;
}

/**
 * The ids one pair's id-less edges are given. `heads`: the head's links of the pair that no
 * named edge holds. `taken`: ids the graph's named edges hold.
 */
function planPair(
  cause: string,
  effect: string,
  edges: Edge[],
  heads: Array<[string, HeadLink]>,
  taken: ReadonlySet<string>,
  headIdsOfPair: ReadonlySet<string>
): PairPlan {
  const sorted = [...edges].sort(byAge);
  const ids = new Map<string, string>();
  let adopted = 0;
  let freeEdges = sorted;
  let freeHeads = heads;
  const claim = (edge: Edge, id: string, fromHead: boolean): void => {
    ids.set(edge.element, id);
    if (fromHead) adopted += 1;
    freeEdges = freeEdges.filter((e) => e !== edge);
    freeHeads = freeHeads.filter(([headId]) => headId !== id);
  };

  // 0. An edge that already holds its own derived id in the head (a re-plan).
  for (const edge of sorted) {
    const own = derivedLinkId(edge);
    if (freeHeads.some(([headId]) => headId === own)) claim(edge, own, true);
  }
  // 1. One to one on the data.
  for (const edge of [...freeEdges]) {
    const matches = freeHeads.filter(([, head]) => sameData(edge, head));
    if (matches.length !== 1) continue;
    const [headId, head] = matches[0] as [string, HeadLink];
    if (freeEdges.filter((other) => sameData(other, head)).length === 1) claim(edge, headId, true);
  }
  // 1b. Edges and head links with identical data cannot be told apart, so pair them
  // in a fixed order: the oldest edge with the lowest head id, and so on. This is
  // what keeps `cause->effect` for the oldest of identical twins.
  for (const edge of [...freeEdges]) {
    if (!freeEdges.includes(edge)) continue;
    const twins = freeEdges.filter((other) => sameDataEdges(other, edge));
    const matching = freeHeads.filter(([, head]) => sameData(edge, head)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    for (let i = 0; i < Math.min(twins.length, matching.length); i += 1) claim(twins[i] as Edge, (matching[i] as [string, HeadLink])[0], true);
  }
  // 2. A lone edge and a lone head link.
  if (freeEdges.length === 1 && freeHeads.length === 1) claim(freeEdges[0] as Edge, (freeHeads[0] as [string, HeadLink])[0], true);
  // 3. The rest: the oldest takes cause->effect if nothing uses it, the others a derived id.
  const pairId = `${cause}->${effect}`;
  // (Looked up, never copied: `taken` holds every id of the graph, and a copy per pair is quadratic.)
  const planned = new Set<string>(ids.values());
  const isUsed = (id: string): boolean => taken.has(id) || headIdsOfPair.has(id) || planned.has(id);
  for (const edge of freeEdges) {
    const id = isUsed(pairId) ? derivedLinkId(edge) : pairId;
    planned.add(id);
    ids.set(edge.element, id);
  }
  return { ids, adopted };
}

export async function migrateCausalLinkIds(options: CausalLinkIdMigrationOptions): Promise<CausalLinkIdMigrationResult> {
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const log = options.log ?? ((message: string) => console.log(message));
  const chunkSize = Math.max(1, options.chunkSize ?? DEFAULT_CHUNK);
  const result: CausalLinkIdMigrationResult = { named: 0, adopted: 0, reconciledGraphs: 0, failedGraphs: 0 };

  const session = options.openSession();
  try {
    const found = await session.run(
      `MATCH (cause:Event)-[r:CAUSES]->(effect:Event)
       WHERE r.id IS NULL
       RETURN elementId(r) AS element, r.graphId AS graphId, cause.id AS cause, effect.id AS effect,
              toString(r.created_at) AS createdAt, r.evidence AS evidence, r.relationship_type AS type,
              r.weight AS weight, r.confidence AS confidence`
    );
    if (found.records.length === 0) return result;

    const byGraph = new Map<string, Edge[]>();
    for (const record of found.records) {
      const evidenceValue = record.get('evidence');
      const noEvidence = typeof evidenceValue !== 'string' || evidenceValue.trim() === '';
      const graphId = typeof record.get('graphId') === 'string' ? (record.get('graphId') as string) : null;
      const edge: Edge = {
        element: String(record.get('element')),
        graphId,
        cause: String(record.get('cause')),
        effect: String(record.get('effect')),
        createdAt: typeof record.get('createdAt') === 'string' ? (record.get('createdAt') as string) : null,
        evidence: noEvidence ? NO_EVIDENCE_PLACEHOLDER : (evidenceValue as string),
        noEvidence,
        type: typeof record.get('type') === 'string' ? (record.get('type') as string) : 'direct',
        weight: num(record.get('weight'), 0.5),
        confidence: num(record.get('confidence'), 0.7),
      };
      const key = graphId ?? '';
      const list = byGraph.get(key);
      if (list) list.push(edge);
      else byGraph.set(key, [edge]);
    }
    log(`Causal link ids: ${found.records.length} link(s) in ${byGraph.size} graph group(s) have no id yet; naming them (a one-off)`);

    for (const [key, edges] of byGraph) {
      const graphId = key === '' ? null : key;
      try {
        await migrateGraph(session, options, graphId, edges, chunkSize, result, log);
      } catch (error) {
        result.failedGraphs += 1;
        warn(
          `Causal link ids: graph ${graphId ?? '(unattributed)'} was not migrated, and will be tried again at the next start ` +
            `(${error instanceof Error ? error.message : String(error)}); its ${edges.length} link(s) are read as cause->effect until then`
        );
      }
    }
    log(
      `Causal link ids: named ${result.named} link(s) (${result.adopted} under the id the version history held), ` +
        `${result.reconciledGraphs} graph head(s) written` +
        (result.failedGraphs > 0 ? `, ${result.failedGraphs} graph(s) to retry` : '')
    );
    return result;
  } finally {
    await session.close();
  }
}

async function migrateGraph(
  session: MigrationSession,
  options: CausalLinkIdMigrationOptions,
  graphId: string | null,
  edges: Edge[],
  chunkSize: number,
  result: CausalLinkIdMigrationResult,
  log: (message: string) => void
): Promise<void> {
  const label = graphId ?? '(unattributed)';
  const began = Date.now();
  const since = (): string => `${Math.round((Date.now() - began) / 100) / 10}s`;
  let reconcile = graphId !== null && options.headLinks !== undefined && options.versioning !== undefined;

  // Named edges of the graph: their ids are taken, and their data is the live data of a mixed pair.
  const namedResult = await session.run(
    `MATCH (cause:Event)-[r:CAUSES]->(effect:Event)
     WHERE r.id IS NOT NULL AND ${graphId === null ? 'r.graphId IS NULL' : 'r.graphId = $graphId'}
     RETURN r.id AS id, cause.id AS cause, effect.id AS effect, r.evidence AS evidence,
            r.relationship_type AS type, r.weight AS weight, r.confidence AS confidence`,
    { graphId }
  );
  const taken = new Set<string>();
  const namedByPair = new Map<string, StoredCausalRelationship[]>();
  for (const record of namedResult.records) {
    const id = String(record.get('id'));
    taken.add(id);
    const cause = String(record.get('cause'));
    const effect = String(record.get('effect'));
    const key = pairKey(cause, effect);
    const list = namedByPair.get(key) ?? [];
    list.push({
      id,
      cause_event_id: cause,
      effect_event_id: effect,
      weight: num(record.get('weight'), 0.5),
      confidence: num(record.get('confidence'), 0.7),
      evidence: typeof record.get('evidence') === 'string' ? (record.get('evidence') as string) : '',
      relationship_type: (typeof record.get('type') === 'string' ? record.get('type') : 'direct') as StoredCausalRelationship['relationship_type'],
    });
    namedByPair.set(key, list);
  }

  log(`Causal link ids: graph ${label}: read ${namedResult.records.length} named link(s) (${since()}); reading the version history`);
  let head: Record<string, HeadLink> = {};
  if (reconcile) {
    const read = await (options.headLinks as NonNullable<typeof options.headLinks>)(graphId as string);
    // No version has ever been made of this graph: there is no head to agree with.
    if (read === null) reconcile = false;
    else head = read;
  }
  const headByPair = new Map<string, Array<[string, HeadLink]>>();
  for (const [id, link] of Object.entries(head)) {
    const key = pairKey(link.cause_event_id, link.effect_event_id);
    const list = headByPair.get(key) ?? [];
    list.push([id, link]);
    headByPair.set(key, list);
  }

  log(`Causal link ids: graph ${label}: read ${Object.keys(head).length} link(s) of the version history (${since()}); planning ids`);
  // 1. Plan, pair by pair.
  const pairs = new Map<string, Edge[]>();
  for (const edge of edges) {
    const key = pairKey(edge.cause, edge.effect);
    const list = pairs.get(key) ?? [];
    list.push(edge);
    pairs.set(key, list);
  }
  const rows: Array<{ element: string; id: string; evidence: string | null }> = [];
  const rowsByPair: Array<number> = []; // number of rows per pair, in order, so chunks never split a pair
  const changed: BatchLiveState['links'] = [];
  for (const [key, pairEdges] of pairs) {
    const first = pairEdges[0] as Edge;
    const named = namedByPair.get(key) ?? [];
    const namedIds = new Set(named.map((link) => link.id));
    const pairHeads = headByPair.get(key) ?? [];
    const free = pairHeads.filter(([id]) => !namedIds.has(id));
    const plan = planPair(first.cause, first.effect, pairEdges, free, taken, new Set(pairHeads.map(([id]) => id)));
    result.adopted += plan.adopted;
    for (const id of plan.ids.values()) taken.add(id);
    for (const edge of pairEdges) rows.push({ element: edge.element, id: plan.ids.get(edge.element) as string, evidence: edge.noEvidence ? NO_EVIDENCE_PLACEHOLDER : null });
    rowsByPair.push(pairEdges.length);

    if (!reconcile) continue;
    // What the head must hold for this pair: every live edge under its id with its data.
    const desired: StoredCausalRelationship[] = [
      ...named,
      ...pairEdges.map((edge) => ({
        id: plan.ids.get(edge.element) as string,
        cause_event_id: edge.cause,
        effect_event_id: edge.effect,
        weight: edge.weight,
        confidence: edge.confidence,
        evidence: edge.evidence,
        relationship_type: edge.type as StoredCausalRelationship['relationship_type'],
      })),
    ];
    const agrees =
      desired.length === pairHeads.length &&
      desired.every((link) => {
        const held = head[link.id];
        return (
          held !== undefined &&
          held.cause_event_id === link.cause_event_id &&
          held.effect_event_id === link.effect_event_id &&
          (typeof held.evidence === 'string' ? held.evidence : '') === link.evidence &&
          (typeof held.relationship_type === 'string' ? held.relationship_type : 'direct') === link.relationship_type &&
          num(held.weight, 0.5) === link.weight &&
          num(held.confidence, 0.7) === link.confidence
        );
      });
    if (!agrees) (changed as NonNullable<typeof changed>).push({ cause_event_id: first.cause, effect_event_id: first.effect, live: desired });
  }

  // Head links on pairs this graph has no live edge for (what `main` left behind, e.g.
  // after a delete it never versioned): dropped in the same version. A link to another
  // graph is never dropped, and a pair with a live edge was reconciled above.
  let stale = 0;
  if (reconcile) {
    const live = new Set<string>([...pairs.keys(), ...namedByPair.keys()]);
    const reported = new Set<string>();
    for (const link of Object.values(head)) {
      const key = pairKey(link.cause_event_id, link.effect_event_id);
      if (live.has(key) || reported.has(key) || link.causeGraphId || link.effectGraphId) continue;
      reported.add(key);
      (changed as NonNullable<typeof changed>).push({ cause_event_id: link.cause_event_id, effect_event_id: link.effect_event_id, live: [] });
    }
    for (const key of reported) stale += (headByPair.get(key) ?? []).length;
  }
  log(`Causal link ids: graph ${label}: planned ${rows.length} id(s) (${since()})`);
  // 2. Reconcile the head first, where it differs.
  if (reconcile && (changed as NonNullable<typeof changed>).length > 0) {
    log(`Causal link ids: graph ${label}: writing the version history for ${(changed as NonNullable<typeof changed>).length} pair(s) of ${pairs.size}`);
    const summary =
      `Upgrade: named ${rows.length} causal ${rows.length === 1 ? 'link' : 'links'} (link ids)` +
      (stale > 0 ? `, removed ${stale} ${stale === 1 ? 'link' : 'links'} the graph no longer holds` : '');
    await (options.versioning as NonNullable<typeof options.versioning>).recordBatch(graphId as string, { links: changed }, [], {
      announceIfNotVersioned: false,
      reconcilePairs: true,
      summary,
      userId: LINK_ID_UPGRADE_USER,
    });
    result.reconciledGraphs += 1;
  }

  // 3. Name the edges, in chunks that keep a pair together.
  const total = rows.length;
  let done = 0;
  let start = 0;
  let pairIndex = 0;
  while (start < total) {
    let end = start;
    while (pairIndex < rowsByPair.length && (end === start || end + (rowsByPair[pairIndex] as number) - start <= chunkSize)) {
      end += rowsByPair[pairIndex] as number;
      pairIndex += 1;
    }
    const chunk = rows.slice(start, end);
    await session.run(
      `UNWIND $rows AS row
       MATCH ()-[r:CAUSES]->()
       WHERE elementId(r) = row.element AND r.id IS NULL
       SET r.id = row.id
       FOREACH (_ IN CASE WHEN row.evidence IS NULL THEN [] ELSE [1] END | SET r.evidence = row.evidence)`,
      { rows: chunk }
    );
    done += chunk.length;
    result.named += chunk.length;
    start = end;
    log(`Causal link ids: graph ${label}: named ${done} of ${total} link(s)`);
  }
}

/**
 * The migration as the process runs it at startup: over the live Neo4j, with
 * the container's version store for the head. (Tests run it the same way.)
 */
export async function runCausalLinkIdMigration(
  container: Pick<Container, 'graphWriteVersioningService' | 'graphRepository'>,
  overrides: Partial<CausalLinkIdMigrationOptions> = {}
): Promise<CausalLinkIdMigrationResult> {
  return migrateCausalLinkIds({
    openSession: () => getDatabaseManager().getNeo4jSession(),
    versioning: container.graphWriteVersioningService,
    headLinks: async (graphId) =>
      (await container.graphRepository.getLatestVersion(graphId)) === null
        ? null
        : ((await container.graphRepository.checkout(graphId)).relationships as unknown as Record<string, HeadLink>),
    ...overrides,
  });
}
