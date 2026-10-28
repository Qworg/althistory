/**
 * Unit proof that the cloud causal queries name their graph.
 *
 * #59's concrete harm was here: `getAllRelationships`, `detectCausalCycles` and
 * `findCausalChain` read every `:CAUSES` relationship in the database, so a
 * service built for one graph reported (and validated against) another graph's
 * causality -- on every same-moment link, through `createCausalLink`'s cycle
 * guard. This suite records the Cypher and fails if a query loses its graph
 * filter or its `$graphId` parameter.
 *
 * The cross-graph behaviour is proven against a real Neo4j in
 * `src/tests/integration/graph-scoped-storage.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import { Event } from '@/models/Event';
import { CausalService } from './CausalService';
import { getDatabaseManager } from '@/utils/database';
import { LocalGraphStore } from '@/utils/LocalGraphStore';

interface RecordedQuery {
  readonly query: string;
  readonly parameters: Record<string, unknown>;
}

const GRAPH_ID = 'graph-a';

// Only `getDatabaseManager` is replaced; `LocalSession` has to stay real, because
// the local-store case below runs its Cypher through it.
vi.mock('@/utils/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/database')>();
  return { ...actual, getDatabaseManager: vi.fn() };
});

/**
 * The execution mode, which is what decides whether a graph filter is emitted.
 *
 * It is a mock with a mutable flag because the branch is configuration, not the
 * presence of a store: the HTTP routes always hand the service a store, and in
 * cloud mode that store is an empty placeholder. Keying off the store made
 * every causal route emit unfiltered Cypher -- which is what the last test here
 * now pins in the other direction.
 */
const configState = { localExecution: false };

vi.mock('@/utils/config', () => ({
  loadConfig: vi.fn(() => ({
    localExecution: {
      enabled: configState.localExecution,
      dataDirectory: './data',
    },
  })),
}));

vi.mock('@/utils/cache', () => ({
  getCacheManager: vi.fn(() => ({
    // Always a miss, so every call re-issues its query instead of returning a
    // cached set from an earlier test.
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
  })),
  CacheKeyGenerator: {
    causalChain: vi.fn((eventId: string, maxDepth: number) => `causal_chain_${eventId}_${maxDepth}`),
    causalCycles: vi.fn(() => 'causal_cycles'),
  },
}));

vi.mock('./CacheInvalidationService', () => ({
  CacheInvalidationService: vi.fn().mockImplementation(() => ({
    invalidateCausalCache: vi.fn().mockResolvedValue(undefined),
  })),
}));

function recordingSession(recorded: RecordedQuery[]) {
  return {
    run: async (query: string, parameters?: Record<string, unknown>) => {
      recorded.push({ query, parameters: parameters ?? {} });
      // The assertions are about the Cypher, not the rows. Reads answer with an
      // empty result set so no mapper has to invent data; the create answers with
      // one row because the service treats an empty result as "endpoints missing".
      if (query.includes('deletedCount')) {
        return { records: [{ get: () => 1 }] };
      }
      if (query.includes('CREATE (cause)-[r:CAUSES') || query.includes('RETURN r')) {
        return { records: [{ get: () => ({ properties: relationship }) }] };
      }
      return { records: [] };
    },
    close: async () => undefined,
  };
}

function event(id: string, timestamp: string): Event {
  return new Event({
    id,
    description: `event ${id}`,
    actor: 'actor',
    target: 'target',
    timestamp: new Date(timestamp),
  });
}

const relationship = {
  weight: 0.8,
  confidence: 0.9,
  evidence: 'because',
  relationship_type: 'direct' as const,
};

describe('graph-scoped causal queries (#59)', () => {
  let recorded: RecordedQuery[];

  beforeEach(() => {
    recorded = [];
    vi.mocked(getDatabaseManager).mockReturnValue({
      getNeo4jSession: () => recordingSession(recorded),
    } as unknown as ReturnType<typeof getDatabaseManager>);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function queries(): string {
    return recorded.map((entry) => entry.query).join('\n---\n');
  }

  it('reads only its own graph relationships', async () => {
    const service = new CausalService({ graphId: GRAPH_ID });

    await service.getAllRelationships();

    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.query).toContain('r.graphId = $graphId');
    expect(recorded[0]!.parameters.graphId).toBe(GRAPH_ID);
  });

  it('finds cycles only in its own graph', async () => {
    const service = new CausalService({ graphId: GRAPH_ID });

    await service.detectCausalCycles();

    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.query).toContain('(start:Event {graphId: $graphId})');
    expect(recorded[0]!.query).toContain('[:CAUSES*2.. {graphId: $graphId}]');
    expect(recorded[0]!.parameters.graphId).toBe(GRAPH_ID);
  });

  it('walks chains inside its own graph', async () => {
    const service = new CausalService({ graphId: GRAPH_ID });

    await service.findCausalChain(event('event-1', '2020-01-01T00:00:00.000Z'), 2);

    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.query).toContain('(start:Event {id: $startEventId, graphId: $graphId})');
    expect(recorded[0]!.query).toContain('[:CAUSES*1..2 {graphId: $graphId}]');
    expect(recorded[0]!.parameters.graphId).toBe(GRAPH_ID);
  });

  it('creates a link whose endpoints and edge are its own graph', async () => {
    const service = new CausalService({ graphId: GRAPH_ID });

    await service.createCausalLink(
      event('cause-1', '2020-01-01T00:00:00.000Z'),
      event('effect-1', '2020-01-01T01:00:00.000Z'),
      relationship
    );

    // One CREATE; the cycle guard only runs for same-moment links.
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.query).toContain('cause.graphId = $graphId');
    expect(recorded[0]!.query).toContain('effect.graphId = $graphId');
    expect(recorded[0]!.query).toContain('graphId: $graphId');
    expect(recorded[0]!.parameters.graphId).toBe(GRAPH_ID);
  });

  it('updates and deletes only its own graph links', async () => {
    const service = new CausalService({ graphId: GRAPH_ID });

    await service.updateCausalLink('cause-1', 'effect-1', { weight: 0.5 });
    await service.deleteCausalLink('cause-1', 'effect-1');

    expect(recorded).toHaveLength(2);
    for (const entry of recorded) {
      expect(entry.query).toContain('cause.graphId = $graphId');
      expect(entry.query).toContain('effect.graphId = $graphId');
      expect(entry.query).toContain('r.graphId = $graphId');
      expect(entry.parameters.graphId).toBe(GRAPH_ID);
    }
  });

  it('emits no graph filter when the service is unscoped', async () => {
    const service = new CausalService();

    await service.getAllRelationships();
    await service.detectCausalCycles();
    await service.findCausalChain(event('event-1', '2020-01-01T00:00:00.000Z'), 2);
    await service.createCausalLink(
      event('cause-1', '2020-01-01T00:00:00.000Z'),
      event('effect-1', '2020-01-01T01:00:00.000Z'),
      relationship
    );

    expect(queries()).not.toContain('graphId');
  });

  it('emits no graph filter in local execution, even with a store and a graph id', async () => {
    const store = new LocalGraphStore({
      dataFile: path.join(os.tmpdir(), `causal-graph-scope-${process.pid}-${Date.now()}.json`),
    });
    configState.localExecution = true;
    try {
      // Local nodes carry no graph property, so a filter would match nothing.
      // A graph-bound local service still carries a graph id for cache
      // namespacing; the *mode* is what must suppress the filter.
      const service = new CausalService({ graphStore: store, graphId: GRAPH_ID });

      await service.getAllRelationships();
      await service.detectCausalCycles();
      await service.findCausalChain(event('event-1', '2020-01-01T00:00:00.000Z'), 2);

      expect(queries()).not.toContain('graphId');
    } finally {
      configState.localExecution = false;
      await store.shutdown();
    }
  });

  it('filters in cloud mode even when a store was handed in', async () => {
    // `graphScopedCausalService` (causal.ts and batch.ts) always passes the
    // container's graph-context store. In cloud mode that store is an empty
    // placeholder, so "has a store" must not be read as "local": doing that
    // emitted unfiltered Cypher on every causal route and wrote :CAUSES edges
    // with no graph id, which the scoped read then could not find again.
    const store = new LocalGraphStore({
      dataFile: path.join(os.tmpdir(), `causal-graph-scope-cloud-${process.pid}-${Date.now()}.json`),
    });
    configState.localExecution = false;
    try {
      const service = new CausalService({ graphStore: store, graphId: GRAPH_ID });

      await service.getAllRelationships();
      await service.detectCausalCycles();
      await service.findCausalChain(event('event-1', '2020-01-01T00:00:00.000Z'), 2);

      // Only the causal queries are the subject here; the store handed in also
      // writes through its own session, and those statements have no graph
      // property to name.
      const causal = recorded
        .map((entry) => entry.query)
        .filter((query) => query.includes('CAUSES'));
      expect(causal.length).toBeGreaterThan(0);
      for (const query of causal) {
        expect(query).toContain('graphId');
      }
    } finally {
      await store.shutdown();
    }
  });
});
