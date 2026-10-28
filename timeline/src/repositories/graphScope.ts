/**
 * Storage-level graph identity for the cloud (Neo4j) repositories and services.
 *
 * Local mode does not need any of this: a graph *is* a store there. Every
 * `LocalGraphStore` holds exactly one graph's data, and
 * `Container.graphScopedRepositories` hands each graph its own store instance,
 * so a query cannot reach another graph even if it wanted to.
 *
 * Cloud mode is the opposite: one database, one set of `:Event` / `:Arc` nodes
 * and one set of `:CAUSES` relationships for every graph. The graph therefore
 * has to be written on the row and named on every query, which is what this
 * module provides. Before #59 the rows carried no graph at all, so a repository
 * built for one graph read, counted, validated and mutated another graph's
 * data.
 */

/** Property that carries a stored row's graph identity. */
export const GRAPH_ID_PROPERTY = 'graphId';

/** Query parameter that carries the graph an operation is confined to. */
export const GRAPH_ID_PARAMETER = 'graphId';

/**
 * Construction options for a graph-scoped cloud repository.
 *
 * `graphId` is supplied only by the cloud branch of
 * `Container.graphScopedRepositories`. Leaving it out means "the process-wide,
 * unscoped repository" (the container-level singletons used by export, import
 * and the CLI), which deliberately keeps the whole-database behaviour it had
 * before #59.
 */
export interface GraphScopedRepositoryOptions {
  readonly graphId?: string;
}

/**
 * Add the condition that confines `alias` to `graphId`, registering the
 * `$graphId` parameter it needs.
 *
 * This is expressed as a WHERE condition rather than as a pattern element on
 * purpose. `MATCH (e:Event {graphId: $graphId})` with a `null` parameter is not
 * "no filter": in Cypher `{graphId: null}` matches the rows where the property
 * is *absent*, i.e. exactly the unattributed legacy rows. An unpinned query
 * would then silently read legacy data as though it belonged to a graph.
 *
 * Callers pass conditions in and join them with {@link whereClause}, so an
 * existing WHERE clause and the graph filter live in the same predicate.
 */
export function addGraphCondition(
  conditions: string[],
  alias: string,
  graphId: string | undefined,
  parameters: Record<string, unknown>
): void {
  if (graphId === undefined) {
    return;
  }
  parameters[GRAPH_ID_PARAMETER] = graphId;
  conditions.push(`${alias}.${GRAPH_ID_PROPERTY} = $${GRAPH_ID_PARAMETER}`);
}

/** `WHERE a AND b` for the given conditions, or an empty string for none. */
export function whereClause(conditions: readonly string[]): string {
  return conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
}

/**
 * The `graphId` fragment for a node pattern, e.g. `, graphId: $graphId`.
 *
 * Empty for an unscoped repository, which is what keeps local-mode Cypher
 * *identical* to the pre-#59 query. That is not cosmetic: local mode runs every
 * query through `LocalGraphStore`, a hand-written interpreter for the Cypher
 * this code has always produced. A rewritten-but-equivalent query (moving
 * `{id: $id}` into a `WHERE`, say) is not equivalent there, and quietly breaks
 * local mode. So the fragment is appended inside the existing property map and
 * nothing else moves.
 *
 * Registering the parameter happens here too, so the fragment and the value it
 * reads cannot drift apart.
 */
export function graphPatternProperty(
  parameters: Record<string, unknown>,
  graphId: string | undefined
): string {
  if (graphId === undefined) {
    return '';
  }
  parameters[GRAPH_ID_PARAMETER] = graphId;
  return `, ${GRAPH_ID_PROPERTY}: $${GRAPH_ID_PARAMETER}`;
}

/**
 * The whole property map for a node pattern that has no other properties:
 * an empty string when unscoped, ` {graphId: $graphId}` when scoped.
 *
 * Separate from {@link graphPatternProperty} because Cypher puts a property map
 * in braces: appending `, graphId: $graphId` after a label (`(e:Event, graphId:
 * ...)`) is a syntax error, not a wider pattern.
 */
export function graphPatternMap(
  parameters: Record<string, unknown>,
  graphId: string | undefined
): string {
  if (graphId === undefined) {
    return '';
  }
  parameters[GRAPH_ID_PARAMETER] = graphId;
  return ` {${GRAPH_ID_PROPERTY}: $${GRAPH_ID_PARAMETER}}`;
}

/**
 * The `graphId` entry to add to a `CREATE` property map, or an empty string for
 * the unscoped repository.
 *
 * Registering the parameter is part of the same call so the value written and
 * the clause that writes it cannot drift apart. An unscoped create keeps the
 * exact Cypher it had before #59 -- the row simply has no graph, which is what
 * the attribution report in `@/utils/graphAttribution` looks for.
 */
export function graphPropertyEntry(
  parameters: Record<string, unknown>,
  graphId: string | undefined
): string {
  if (graphId === undefined) {
    return '';
  }
  parameters[GRAPH_ID_PARAMETER] = graphId;
  return `,\n        ${GRAPH_ID_PROPERTY}: $${GRAPH_ID_PARAMETER}`;
}

/**
 * The relationship filter used inside a variable-length `[:CAUSES*]` pattern.
 *
 * A pattern element filter is the only place a hop can be constrained without
 * expanding the path first, so a traversal cannot step along another graph's
 * relationship on its way to a node this graph owns.
 */
export function causalRelationshipPattern(graphId: string | undefined, length: string): string {
  if (graphId === undefined) {
    return `[:CAUSES*${length}]`;
  }
  return `[:CAUSES*${length} {${GRAPH_ID_PROPERTY}: $${GRAPH_ID_PARAMETER}}]`;
}
