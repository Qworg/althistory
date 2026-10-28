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
 * Cloud mode for the service under test. The local-mode test below bypasses
 * `loadConfig` by handing the service a store, which is what decides the branch.
 */
vi.mock('@/utils/config', () => ({
  loadConfig: vi.fn(() => ({
    localExecution: {
      enabled: false,
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

  it('emits no graph filter when the service is bound to a local store', async () => {
    const store = new LocalGraphStore({
      dataFile: path.join(os.tmpdir(), `causal-graph-scope-${process.pid}-${Date.now()}.json`),
    });
    try {
      // A graph-bound local service carries a graph id (for cache namespacing)
      // as well as the store, so the store is what must suppress the filter:
      // local nodes have no graph property and a filter would match nothing.
      const service = new CausalService({ graphStore: store, graphId: GRAPH_ID });

      await service.getAllRelationships();
      await service.detectCausalCycles();
      await service.findCausalChain(event('event-1', '2020-01-01T00:00:00.000Z'), 2);

      expect(queries()).not.toContain('graphId');
    } finally {
      await store.shutdown();
    }
  });
});
