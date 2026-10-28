/**
 * Attribution of pre-#59 cloud rows to a graph.
 *
 * #59 gave stored cloud data a graph identity: `:Event` nodes, `:Arc` nodes and
 * `:CAUSES` relationships written by a graph-scoped repository now carry
 * `graphId`, and every query such a repository issues filters on it. Rows
 * written before that change carry no graph at all, so a scoped query cannot see
 * them. They are not wrong, they are unattributed, and silently hiding them
 * would look exactly like data loss.
 *
 * This module is the explicit answer:
 *
 * - {@link countUnattributedData} says how many rows have no graph.
 * - {@link attributeUnattributedData} hands them to one named graph.
 * - {@link adoptUnattributedCloudData} is what a cloud process runs at startup:
 *   it attributes them when the deployment knows exactly one graph (the only
 *   answer that cannot be wrong) and otherwise *reports* the counts and the
 *   command that attributes them, rather than guessing a graph.
 *
 * Nothing here runs in local mode. There the graph is the file, every row a
 * store holds belongs to it, and the property does not exist.
 */

import { GRAPH_ID_PROPERTY } from '@/repositories/graphScope';

/**
 * Value of a count column, in the encodings the driver may use for integers.
 *
 * The driver returns an `Integer` object (with `toNumber`), a JS number or a
 * bigint depending on configuration and server version, so a count has to be
 * narrowed at the boundary instead of assumed.
 */
export type StoredCount = number | bigint | string | IntegerLike | null | undefined;

/** The driver's integer objects. */
export interface IntegerLike {
  toNumber(): number;
}

/** The slice of a driver session this module uses. */
export interface AttributionRecord {
  get(key: string): StoredCount;
}

export interface AttributionQueryResult {
  records: readonly AttributionRecord[];
}

/**
 * Session surface used by the attribution queries.
 *
 * Structural on purpose: the real `neo4j-driver` session satisfies it, and a
 * test can hand in a recording double without a cast.
 */
export interface AttributionSession {
  run(query: string, parameters?: Record<string, unknown>): Promise<AttributionQueryResult>;
  close(): Promise<void>;
}

/** How many stored rows carry no graph identity. */
export interface UnattributedDataCounts {
  readonly events: number;
  readonly arcs: number;
  readonly causalRelationships: number;
}

/** What an attribution attempt did, and what it could not do. */
export interface AttributionOutcome {
  /** Graph the rows were attributed to, when one was chosen. */
  readonly graphId?: string;
  /** Rows this call attributed. */
  readonly attributed: UnattributedDataCounts;
  /** Rows still carrying no graph identity afterwards. */
  readonly remaining: UnattributedDataCounts;
}

const NO_ROWS: UnattributedDataCounts = {
  events: 0,
  arcs: 0,
  causalRelationships: 0,
};

/** Read a count column without trusting the driver's integer encoding. */
function readCount(result: AttributionQueryResult, key: string): number {
  const value = result.records[0]?.get(key);
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'string') {
    return value.trim() === '' ? 0 : Number(value);
  }
  if (value !== null && value !== undefined) {
    return value.toNumber();
  }
  return 0;
}

/** Any rows at all without a graph identity? */
export function hasUnattributedData(counts: UnattributedDataCounts): boolean {
  return counts.events + counts.arcs + counts.causalRelationships > 0;
}

/** Total number of rows without a graph identity. */
export function totalUnattributed(counts: UnattributedDataCounts): number {
  return counts.events + counts.arcs + counts.causalRelationships;
}

/**
 * Count the rows that carry no graph identity.
 *
 * Nodes and relationships are counted separately: a relationship can lose its
 * graph (or be written by an unscoped path) while both of its endpoints have
 * one, and that case is attributable from the endpoints.
 */
export async function countUnattributedData(
  session: AttributionSession
): Promise<UnattributedDataCounts> {
  const eventsResult = await session.run(
    `MATCH (e:Event) WHERE e.${GRAPH_ID_PROPERTY} IS NULL RETURN count(e) AS total`
  );
  const arcsResult = await session.run(
    `MATCH (a:Arc) WHERE a.${GRAPH_ID_PROPERTY} IS NULL RETURN count(a) AS total`
  );
  const relationshipsResult = await session.run(
    `MATCH ()-[r:CAUSES]->() WHERE r.${GRAPH_ID_PROPERTY} IS NULL RETURN count(r) AS total`
  );

  return {
    events: readCount(eventsResult, 'total'),
    arcs: readCount(arcsResult, 'total'),
    causalRelationships: readCount(relationshipsResult, 'total'),
  };
}

/**
 * Attribute every unattributed row to `graphId` and report what remains.
 *
 * A `CAUSES` relationship whose endpoints disagree about their graph is left
 * alone on purpose: picking one of the two would silently move a
 * cross-graph link into one of the graphs. It shows up in
 * {@link AttributionOutcome.remaining} instead.
 */
export async function attributeUnattributedData(
  session: AttributionSession,
  graphId: string
): Promise<AttributionOutcome> {
  const before = await countUnattributedData(session);

  if (!hasUnattributedData(before)) {
    return { graphId, attributed: NO_ROWS, remaining: NO_ROWS };
  }

  const eventResult = await session.run(
    `MATCH (e:Event) WHERE e.${GRAPH_ID_PROPERTY} IS NULL
     SET e.${GRAPH_ID_PROPERTY} = $graphId
     RETURN count(e) AS total`,
    { graphId }
  );
  const arcResult = await session.run(
    `MATCH (a:Arc) WHERE a.${GRAPH_ID_PROPERTY} IS NULL
     SET a.${GRAPH_ID_PROPERTY} = $graphId
     RETURN count(a) AS total`,
    { graphId }
  );

  // The endpoints are attributed now, so a relationship can take its graph from
  // them. Only when both agree: an endpoint pair that spans two graphs is not
  // attributable and is reported below.
  const relationshipResult = await session.run(
    `MATCH (cause:Event)-[r:CAUSES]->(effect:Event)
     WHERE r.${GRAPH_ID_PROPERTY} IS NULL
       AND cause.${GRAPH_ID_PROPERTY} IS NOT NULL
       AND cause.${GRAPH_ID_PROPERTY} = effect.${GRAPH_ID_PROPERTY}
     SET r.${GRAPH_ID_PROPERTY} = cause.${GRAPH_ID_PROPERTY}
     RETURN count(r) AS total`
  );

  const remaining = await countUnattributedData(session);

  return {
    graphId,
    attributed: {
      events: readCount(eventResult, 'total'),
      arcs: readCount(arcResult, 'total'),
      causalRelationships: readCount(relationshipResult, 'total'),
    },
    remaining,
  };
}

/** Message for a deployment where rows could not be attributed. */
export function describeUnattributedData(
  counts: UnattributedDataCounts,
  knownGraphIds: readonly string[]
): string {
  const known =
    knownGraphIds.length === 0
      ? 'no graph is registered yet'
      : `${knownGraphIds.length} graphs are registered (${knownGraphIds.join(', ')}), so the target cannot be inferred`;
  return (
    `Cloud data written before graph identity existed cannot be seen by a graph-scoped query: ` +
    `${counts.events} event(s), ${counts.arcs} arc(s) and ${counts.causalRelationships} causal relationship(s) ` +
    `carry no ${GRAPH_ID_PROPERTY}. ${known}. Attribute them explicitly with ` +
    `"npm run migrate:attribute-graph -- --graph <graphId>" (add --dry-run first to see the counts).`
  );
}

export interface AdoptUnattributedCloudDataOptions {
  readonly session: AttributionSession;
  /** Graphs the deployment knows about, from the graph metadata index. */
  readonly knownGraphIds: readonly string[];
  /** How to report; the defaults print to the console. */
  readonly warn?: (message: string) => void;
  readonly log?: (message: string) => void;
}

/**
 * Startup attribution for a cloud process.
 *
 * Attributes unattributed rows only when exactly one graph is registered -- the
 * one case where the attribution cannot be wrong -- and otherwise reports the
 * counts. Reporting is a warning, not a failure: refusing to start would turn
 * an old database into an outage, and the rows are not corrupt, only unlabelled.
 */
export async function adoptUnattributedCloudData(
  options: AdoptUnattributedCloudDataOptions
): Promise<AttributionOutcome> {
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const log = options.log ?? ((message: string) => console.log(message));

  const counts = await countUnattributedData(options.session);
  if (!hasUnattributedData(counts)) {
    return { attributed: NO_ROWS, remaining: NO_ROWS };
  }

  if (options.knownGraphIds.length !== 1) {
    warn(describeUnattributedData(counts, options.knownGraphIds));
    return { attributed: NO_ROWS, remaining: counts };
  }

  const graphId = options.knownGraphIds[0];
  if (graphId === undefined) {
    warn(describeUnattributedData(counts, options.knownGraphIds));
    return { attributed: NO_ROWS, remaining: counts };
  }
  // Adoption is automatic because the alternative -- leaving the rows
  // invisible until an operator runs a command -- turns an upgrade into a graph
  // that looks empty. It is only unambiguous when exactly one graph is
  // registered, which the branch above requires. It is still a change nobody
  // explicitly asked for, so it is reported loudly, with both counts and the
  // way to undo the assumption.
  warn(
    `Attributing pre-graph-identity cloud data to graph "${graphId}" (the only registered graph): ` +
      `before, ${counts.events} event(s), ${counts.arcs} arc(s), ` +
      `${counts.causalRelationships} causal relationship(s) carried no graph id. ` +
      'If this data belongs to another graph, stop the process and use ' +
      '`npm run migrate:attribute-graph` with the right --graph before serving requests.'
  );

  const outcome = await attributeUnattributedData(options.session, graphId);
  log(
    `Attributed pre-graph-identity cloud data to graph "${graphId}": ` +
      `${outcome.attributed.events} event(s), ${outcome.attributed.arcs} arc(s), ` +
      `${outcome.attributed.causalRelationships} causal relationship(s). ` +
      `Still unattributed afterwards: ${outcome.remaining.events} event(s), ` +
      `${outcome.remaining.arcs} arc(s), ${outcome.remaining.causalRelationships} relationship(s).`
  );

  if (hasUnattributedData(outcome.remaining)) {
    warn(
      `Unattributed rows remain after attribution (${totalUnattributed(outcome.remaining)}): ` +
        `they do not agree on a graph -- a causal relationship whose endpoints belong to different graphs, ` +
        `or rows added after the graph was chosen. See "npm run migrate:attribute-graph".`
    );
  }

  return outcome;
}
