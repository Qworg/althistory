/**
 * Where a committed change is announced on the live change feed: the
 * versioning bridge (entity writes), the live-store sync (a replaced head) and
 * the graph service (a graph made, changed, branched, deleted).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { loadConfig, initializeDatabaseManager } from '@/utils';
import { initializeContainer, cleanupContainer, type Container } from '@/container';
import { runWithChangeContext } from '@/utils/ChangeContext';
import { GraphWriteVersioningService } from './GraphWriteVersioningService';
import type { GraphRepository } from '@/repositories/GraphRepository';
import type { ChangeRecord } from './ChangeFeedService';

describe('announcing committed changes', () => {
  let container: Container;
  let dataDir: string;
  let graph: string;
  let heard: ChangeRecord[];
  let stop: () => void;

  beforeAll(async () => {
    dataDir = path.join(os.tmpdir(), `announcements-${process.pid}-${Date.now()}`);
    process.env.LOCAL_EXECUTION_ENABLED = 'true';
    process.env.LOCAL_DATA_DIR = dataDir;
    process.env.LOCAL_GRAPH_FILE = 'announcements-graph.json';
    process.env.LOCAL_BACKUP_ENABLED = 'false';
    process.env.LOCAL_MAX_MEMORY_MB = '64';
    await fs.mkdir(path.join(dataDir, 'graphs'), { recursive: true });
    const config = loadConfig();
    container = initializeContainer(initializeDatabaseManager(config.database), config);
    await container.initialize();
  });

  afterAll(async () => {
    await cleanupContainer();
    await fs.rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
  });

  beforeEach(async () => {
    graph = (await container.graphService.createGraph({ name: 'Announced' })).id;
    heard = [];
    stop = container.changeFeedService.subscribe((record) => heard.push(record));
  });

  afterEach(() => stop());

  const forGraph = (): ChangeRecord[] => heard.filter((record) => record.graphId === graph);

  async function writeEvent(description: string): Promise<{ id: string }> {
    const { eventRepository } = await container.graphScopedRepositories(graph);
    const event = await eventRepository.create({
      description,
      actor: 'A',
      target: 'B',
      timestamp: new Date('1500-01-01T00:00:00Z'),
    });
    await container.graphWriteVersioningService.recordEvent(graph, event, 'create');
    return event;
  }

  it('announces an entity write after it is committed, with the line version history shows', async () => {
    const event = await writeEvent('The treaty is signed');
    expect(forGraph()).toEqual([
      expect.objectContaining({
        kind: 'entities',
        operation: 'create',
        entities: [{ type: 'event', id: event.id }],
        summary: 'Added event “The treaty is signed”',
        actor: { kind: 'system' },
      }),
    ]);
  });

  it('attributes it to whoever the change context names', async () => {
    const event = await runWithChangeContext(
      { actor: { kind: 'agent', name: 'a-key', keyId: 'k' }, origin: 'tab-1' },
      () => writeEvent('By an agent')
    );
    const [record] = forGraph();
    expect(record.actor).toEqual({ kind: 'agent', name: 'a-key', keyId: 'k' });
    expect(record.origin).toBe('tab-1');
    expect(record).toMatchObject({ entities: [{ id: event.id }] });
  });

  it('announces a deleted event together with the links that went with it', async () => {
    const first = await writeEvent('Cause');
    const second = await writeEvent('Effect');
    const scoped = await container.graphScopedRepositories(graph);
    const { eventRepository, causalService } = scoped;
    const link = await causalService.createCausalLink(
      (await eventRepository.findById(first.id))!,
      (await eventRepository.findById(second.id))!,
      { weight: 0.5, confidence: 0.5, evidence: 'because', relationship_type: 'direct' }
    );
    await container.graphWriteVersioningService.recordRelationship(graph, link, 'create');
    heard.length = 0;

    await eventRepository.delete(first.id);
    await container.graphWriteVersioningService.recordDeletion(graph, 'event', first.id);

    const [record] = forGraph();
    expect(record).toMatchObject({ kind: 'entities', operation: 'delete' });
    if (record.kind !== 'entities') throw new Error('expected an entities change');
    expect(record.entities).toEqual(
      expect.arrayContaining([
        { type: 'event', id: first.id },
        { type: 'relationship', id: link.id },
      ])
    );
    expect(record.summary).toContain('and its link');
  });

  it('still announces a write whose version could not be made, and says so', async () => {
    const published: Array<{ graphId: string; summary: string }> = [];
    const bridge = new GraphWriteVersioningService({
      graphRepository: {
        commitChanges: async () => {
          throw new Error('disk full');
        },
        getHeadEntities: async () => ({}),
        findById: async () => null,
      } as unknown as GraphRepository,
      changeFeed: {
        publish: (graphId, body) => {
          published.push({ graphId, summary: (body as { summary: string }).summary });
          return {} as ChangeRecord;
        },
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() } as never,
    });
    await expect(
      bridge.recordEvent('g', { id: 'e1', description: 'Lost', actor: 'A', target: 'B', timestamp: new Date(), metadata: {} } as never, 'create')
    ).rejects.toThrow('disk full');
    expect(published).toEqual([{ graphId: 'g', summary: 'Added event “Lost” (not versioned)' }]);
  });

  it('does not let a failing feed fail the write', async () => {
    const bridge = new GraphWriteVersioningService({
      graphRepository: {
        commitChanges: async () => ({ version: 1 }),
        getHeadEntities: async () => ({}),
        findById: async () => null,
      } as unknown as GraphRepository,
      changeFeed: {
        publish: () => {
          throw new Error('feed broke');
        },
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() } as never,
    });
    await expect(
      bridge.recordEvent('g', { id: 'e1', description: 'Fine', actor: 'A', target: 'B', timestamp: new Date(), metadata: {} } as never, 'create')
    ).resolves.toBeUndefined();
  });

  it('announces a graph made, changed, branched and deleted, naming the graph', async () => {
    heard.length = 0;
    const made = await container.graphService.createGraph({ name: 'Brand new' });
    await container.graphService.updateGraph(made.id, { name: 'Renamed', description: 'about' });
    await container.graphService.updateGraph(made.id, { calendar: { epochYear: 1000, eraLabel: 'AR' } });
    const branch = await container.graphService.branchGraph(made.id, { name: 'A branch' });
    await container.graphService.deleteGraph(made.id);

    const graphMessages = heard.filter((record) => record.kind === 'graph');
    expect(graphMessages.map((record) => [record.graphId === made.id ? 'made' : 'branch', (record as { operation: string }).operation])).toEqual([
      ['made', 'create'],
      ['made', 'update'],
      ['made', 'update'],
      ['branch', 'create'],
      ['made', 'delete'],
    ]);
    expect(graphMessages[1]).toMatchObject({ fields: ['name', 'description'], name: 'Renamed' });
    expect(graphMessages[2]).toMatchObject({ fields: ['calendar'], summary: 'Changed the calendar of “Renamed”' });
    expect(graphMessages[3]).toMatchObject({ graphId: branch.id, summary: 'Branched “Renamed” as “A branch”' });
    expect(graphMessages[4]).toMatchObject({ name: 'Renamed', summary: 'Deleted the graph “Renamed”' });
  });

  it('forgets the history of a deleted graph, so a client behind it refetches', async () => {
    const made = await container.graphService.createGraph({ name: 'Short lived' });
    const seen = container.changeFeedService.cursor;
    await container.graphService.deleteGraph(made.id);
    const result = container.changeFeedService.replay(graph, container.changeFeedService.epoch, seen - 1);
    expect(result).toEqual({ ok: false, reason: 'gap' });
  });

  it('announces a replaced head once the live store holds it, with what it holds', async () => {
    await writeEvent('One');
    await writeEvent('Two');
    heard.length = 0;
    const result = await container.liveStoreSyncService.materialize(graph, 'import');
    expect(result.events).toBe(2);
    expect(forGraph()).toEqual([
      expect.objectContaining({
        kind: 'replaced',
        reason: 'import',
        counts: { events: 2, arcs: 0, relationships: 0 },
        summary: 'Imported entities into the graph',
      }),
    ]);
  });
});
