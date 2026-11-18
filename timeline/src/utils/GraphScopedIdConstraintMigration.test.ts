import { describe, it, expect } from 'vitest';
import {
  graphScopedIdConstraintStatement,
  migrateGraphScopedIdConstraints,
  type ConstraintMigrationSession,
} from './GraphScopedIdConstraintMigration';

interface Existing {
  name: string;
  type?: string;
  labelsOrTypes: string[];
  properties: string[];
}

/** A session that answers the migration's reads from a script and records its writes. */
function fakeSession(existing: Existing[], opts: { unattributed?: Record<string, number>; duplicates?: Record<string, Array<[string, string]>> } = {}) {
  const writes: string[] = [];
  const session: ConstraintMigrationSession = {
    async run(query: string) {
      const get = (values: Record<string, unknown>) => ({ get: (key: string) => values[key] });
      if (query.startsWith('SHOW CONSTRAINTS')) {
        return { records: existing.map((c) => get({ type: 'UNIQUENESS', ...c })) };
      }
      const label = /MATCH \(n:(\w+)\)/.exec(query)?.[1] ?? '';
      if (query.includes('RETURN count(n)')) return { records: [get({ total: opts.unattributed?.[label] ?? 0 })] };
      if (query.includes('WHERE held > 1')) return { records: (opts.duplicates?.[label] ?? []).map(([graphId, id]) => get({ graphId, id })) };
      writes.push(query);
      return { records: [] };
    },
    async close() {
      writes.push('close');
    },
  };
  return { session, writes };
}

const run = (session: ConstraintMigrationSession) =>
  migrateGraphScopedIdConstraints({ openSession: () => session, log: () => undefined, warn: () => undefined });

describe('graphScopedIdConstraintStatement', () => {
  it('constrains the pair, graph first', () => {
    expect(graphScopedIdConstraintStatement('Event', 'event_graph_id')).toBe(
      'CREATE CONSTRAINT event_graph_id IF NOT EXISTS FOR (e:Event) REQUIRE (e.graphId, e.id) IS UNIQUE'
    );
    expect(graphScopedIdConstraintStatement('Arc', 'arc_graph_id')).toContain('REQUIRE (a.graphId, a.id) IS UNIQUE');
  });
});

describe('migrateGraphScopedIdConstraints (#35)', () => {
  const oldOnes: Existing[] = [
    { name: 'event_id', labelsOrTypes: ['Event'], properties: ['id'] },
    { name: 'arc_id', labelsOrTypes: ['Arc'], properties: ['id'] },
    { name: 'pressure_id', labelsOrTypes: ['InferredPressure'], properties: ['id'] },
  ];

  it('on a database created by main: creates the composite constraints before dropping the old ones, and leaves the others', async () => {
    const { session, writes } = fakeSession(oldOnes);
    const result = await run(session);
    expect(result.created).toEqual(['event_graph_id', 'arc_graph_id']);
    expect(result.dropped).toEqual(['event_id', 'arc_id']);
    const statements = writes.filter((w) => w !== 'close');
    expect(statements).toHaveLength(4);
    expect(statements.findIndex((w) => w.includes('event_graph_id'))).toBeLessThan(statements.findIndex((w) => w.startsWith('DROP CONSTRAINT `event_id`')));
    expect(statements.some((w) => w.includes('pressure_id'))).toBe(false);
    expect(writes.at(-1)).toBe('close');
  });

  it('on a fresh database: creates, drops nothing', async () => {
    const { session } = fakeSession([]);
    const result = await run(session);
    expect(result.created).toEqual(['event_graph_id', 'arc_graph_id']);
    expect(result.dropped).toEqual([]);
  });

  it('on a migrated database: writes nothing', async () => {
    const { session, writes } = fakeSession([
      { name: 'whatever', labelsOrTypes: ['Event'], properties: ['graphId', 'id'] },
      { name: 'else', labelsOrTypes: ['Arc'], properties: ['graphId', 'id'] },
    ]);
    const result = await run(session);
    expect(result).toEqual({ created: [], dropped: [], unattributed: { events: 0, arcs: 0 } });
    expect(writes).toEqual(['close']);
  });

  it('finishes a half-done migration: the composite exists, the old one is dropped', async () => {
    const { session } = fakeSession([
      { name: 'event_graph_id', labelsOrTypes: ['Event'], properties: ['graphId', 'id'] },
      { name: 'event_id', labelsOrTypes: ['Event'], properties: ['id'] },
      { name: 'arc_graph_id', labelsOrTypes: ['Arc'], properties: ['graphId', 'id'] },
    ]);
    const result = await run(session);
    expect(result.created).toEqual([]);
    expect(result.dropped).toEqual(['event_id']);
  });

  it('finds the old constraint by what it constrains, not its name, and ignores the property-existence kind', async () => {
    const { session, writes } = fakeSession([
      { name: 'custom', labelsOrTypes: ['Event'], properties: ['id'] },
      { name: 'exists', type: 'NODE_PROPERTY_EXISTENCE', labelsOrTypes: ['Arc'], properties: ['id'] },
    ]);
    const result = await run(session);
    expect(result.dropped).toEqual(['custom']);
    expect(writes.some((w) => w.includes('`exists`'))).toBe(false);
  });

  it('reports nodes with no graph and still migrates', async () => {
    const warnings: string[] = [];
    const { session } = fakeSession(oldOnes, { unattributed: { Event: 3, Arc: 1 } });
    const result = await migrateGraphScopedIdConstraints({ openSession: () => session, log: () => undefined, warn: (m) => warnings.push(m) });
    expect(result.unattributed).toEqual({ events: 3, arcs: 1 });
    expect(result.created).toHaveLength(2);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('3 Event node(s) carry no graphId');
  });

  it('refuses, naming the pair, when a graph holds an id twice, and drops nothing', async () => {
    const { session, writes } = fakeSession(oldOnes, { duplicates: { Event: [['g1', 'e1']] } });
    await expect(run(session)).rejects.toThrow('g1/e1');
    expect(writes).toEqual(['close']);
  });
});
