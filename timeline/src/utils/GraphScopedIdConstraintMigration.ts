/**
 * The startup migration that scopes cloud id constraints to a graph (issue 35).
 *
 * `main` made `Event.id` and `Arc.id` unique across the whole database. A branch
 * holds its parent's ids, so the branch's first event failed on the parent's node
 * and every event and link of a branch was skipped. An id is now unique within a
 * graph: the constraints are `(graphId, id)`.
 *
 * What it does, in this order, so that no step leaves a label unprotected:
 *
 *  1. Reads the constraints that exist (whatever their names).
 *  2. Counts the nodes that carry no `graphId`. A uniqueness constraint ignores a
 *     node with a null property, so those legacy rows are not covered by the
 *     composite one; they are also invisible to every graph-scoped read. They are
 *     reported, not touched (`adoptUnattributedCloudData` runs before this and
 *     attributes them when the deployment holds exactly one graph).
 *  3. Creates the composite constraint where none exists. Before it does, it looks
 *     for a `(graphId, id)` pair held twice, which the old constraint made
 *     impossible, and refuses with a message that names the pairs rather than the
 *     driver's.
 *  4. Drops the old single-property constraint, found by what it constrains, not
 *     by its name.
 *
 * Every step checks first, so a fresh database (nothing to drop), a database
 * `main` created (both steps), one stopped between the steps (the drop only) and
 * one already migrated (nothing) all end in the same state, and a repeat is free.
 */

export interface ConstraintMigrationSession {
  run(query: string, parameters?: Record<string, unknown>): Promise<{ records: ReadonlyArray<{ get(key: string): unknown }> }>;
  close(): Promise<void>;
}

export interface GraphScopedIdConstraintMigrationOptions {
  /** A session; one is opened per call and closed. */
  openSession: () => ConstraintMigrationSession;
  log?: (message: string) => void;
  warn?: (message: string) => void;
}

export interface GraphScopedIdConstraintMigrationResult {
  /** Names of the composite constraints this run created. */
  created: string[];
  /** Names of the single-property constraints this run dropped. */
  dropped: string[];
  /** Nodes that carry no graph and so are not covered by the composite constraint. */
  unattributed: { events: number; arcs: number };
}

/** The labels whose id is scoped to a graph, with the composite constraint each gets. */
export const GRAPH_SCOPED_ID_CONSTRAINTS = [
  { label: 'Event', name: 'event_graph_id' },
  { label: 'Arc', name: 'arc_graph_id' },
] as const;

/** `CREATE CONSTRAINT` for one label: also what `SchemaManager` runs on a fresh database. */
export function graphScopedIdConstraintStatement(label: string, name: string): string {
  const alias = label.charAt(0).toLowerCase();
  return `CREATE CONSTRAINT ${name} IF NOT EXISTS FOR (${alias}:${label}) REQUIRE (${alias}.graphId, ${alias}.id) IS UNIQUE`;
}

interface ExistingConstraint {
  name: string;
  type: string;
  labels: string[];
  properties: string[];
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  const counted = value as { toNumber?: () => number } | null | undefined;
  return counted && typeof counted.toNumber === 'function' ? counted.toNumber() : 0;
}

const isUniqueOn = (constraint: ExistingConstraint, label: string, properties: string[]): boolean =>
  constraint.type === 'UNIQUENESS' &&
  constraint.labels.length === 1 &&
  constraint.labels[0] === label &&
  constraint.properties.length === properties.length &&
  constraint.properties.every((property, index) => property === properties[index]);

const quote = (name: string): string => `\`${name.replace(/`/g, '``')}\``;

export async function migrateGraphScopedIdConstraints(
  options: GraphScopedIdConstraintMigrationOptions
): Promise<GraphScopedIdConstraintMigrationResult> {
  const session = options.openSession();
  try {
    return await scopeGraphIdConstraints(session, options);
  } finally {
    await session.close();
  }
}

/**
 * The migration on a session the caller owns (and closes). `SchemaManager` runs it this way, so the
 * composite constraints are only ever created by this code, after the duplicate check, and never by
 * a bare `CREATE CONSTRAINT` whose failure would not name the pair.
 */
export async function scopeGraphIdConstraints(
  session: ConstraintMigrationSession,
  options: Pick<GraphScopedIdConstraintMigrationOptions, 'log' | 'warn'> = {}
): Promise<GraphScopedIdConstraintMigrationResult> {
  const log = options.log ?? ((message: string) => console.log(message));
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const result: GraphScopedIdConstraintMigrationResult = { created: [], dropped: [], unattributed: { events: 0, arcs: 0 } };

  {
    const shown = await session.run('SHOW CONSTRAINTS YIELD name, type, labelsOrTypes, properties');
    const constraints: ExistingConstraint[] = shown.records.map((record) => ({
      name: String(record.get('name')),
      type: String(record.get('type')),
      labels: ((record.get('labelsOrTypes') as string[] | null) ?? []).map(String),
      properties: ((record.get('properties') as string[] | null) ?? []).map(String),
    }));

    for (const { label, name } of GRAPH_SCOPED_ID_CONSTRAINTS) {
      const counted = await session.run(`MATCH (n:${label}) WHERE n.graphId IS NULL RETURN count(n) AS total`);
      const unattributed = toNumber(counted.records[0]?.get('total'));
      if (label === 'Event') result.unattributed.events = unattributed;
      else result.unattributed.arcs = unattributed;
      if (unattributed > 0) {
        warn(
          `Graph-scoped ids: ${unattributed} ${label} node(s) carry no graphId. They are not covered by the (graphId, id) constraint ` +
            `and are not read by any graph; attribute them with "npm run migrate:attribute-graph -- --graph <graphId>".`
        );
      }

      // 3. The composite constraint first, so the label is never without one.
      if (!constraints.some((constraint) => isUniqueOn(constraint, label, ['graphId', 'id']))) {
        const duplicates = await session.run(
          `MATCH (n:${label}) WHERE n.graphId IS NOT NULL
           WITH n.graphId AS graphId, n.id AS id, count(*) AS held WHERE held > 1
           RETURN graphId, id ORDER BY graphId, id LIMIT 5`
        );
        if (duplicates.records.length > 0) {
          const named = duplicates.records.map((record) => `${String(record.get('graphId'))}/${String(record.get('id'))}`).join(', ');
          throw new Error(
            `Cannot scope the ${label} id constraint to a graph: a graph holds the same id twice (${named}). ` +
              `Remove the duplicates, then restart; the old constraint is left in place.`
          );
        }
        await session.run(graphScopedIdConstraintStatement(label, name));
        result.created.push(name);
        log(`Graph-scoped ids: created constraint ${name} on (${label}.graphId, ${label}.id)`);
      }

      // 4. The old one, wherever it is and whatever it is called.
      for (const old of constraints.filter((constraint) => isUniqueOn(constraint, label, ['id']))) {
        await session.run(`DROP CONSTRAINT ${quote(old.name)} IF EXISTS`);
        result.dropped.push(old.name);
        log(`Graph-scoped ids: dropped constraint ${old.name} (${label}.id was unique across every graph)`);
      }
    }
    return result;
  }
}
