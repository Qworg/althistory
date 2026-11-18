/**
 * Issue 40: recording a batch as a version costs what the batch changed, not
 * what the graph holds. The tests count the version objects read and the
 * objects written, so they pin the property and not a duration; the last ones
 * check that a batch recorded this way is still in the head for a rollback,
 * a branch and a merge, and that the graph's metadata still describes the head.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { loadConfig, initializeDatabaseManager } from '@/utils';
import { initializeContainer, cleanupContainer, Container } from '@/container';
import { GraphImporter } from '@/cli/export/GraphImporter';

describe('recording a batch', () => {
  let container: Container;
  let testDataDir: string;
  let graphCount = 0;

  beforeAll(async () => {
    testDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'batch-cost-'));
    process.env.LOCAL_EXECUTION_ENABLED = 'true';
    process.env.LOCAL_DATA_DIR = testDataDir;
    process.env.LOCAL_GRAPH_FILE = 'batch-cost-graph.json';
    process.env.LOCAL_BACKUP_ENABLED = 'false';
    process.env.LOCAL_MAX_MEMORY_MB = '64';
    const config = loadConfig();
    container = initializeContainer(initializeDatabaseManager(config.database), config);
    await container.initialize();
  });

  afterAll(async () => {
    await cleanupContainer();
    await fs.rm(testDataDir, { recursive: true, force: true }).catch(() => undefined);
  });

  const arc = (id: string) => ({ id, name: id, description: id, start_time: '1800-01-01T00:00:00.000Z', end_time: '1900-01-01T00:00:00.000Z', level: 0, metadata: {} });
  const event = (id: string, actor = 'A', timestamp = '1850-01-01T00:00:00.000Z') => ({ id, description: id, actor, target: 'B', timestamp, metadata: {} });
  const document = (arcs: unknown[], events: unknown[] = []) => ({ metadata: {}, data: { arcs, events, causalRelationships: [] } });
  const run = (doc: unknown, graphId: string, strategy: 'skip' | 'overwrite' | 'rename' = 'skip') =>
    new GraphImporter().import(JSON.stringify(doc), container as never, { strategy, graphId });

  async function graphOf(arcs: number, events: number): Promise<string> {
    graphCount += 1;
    const id = (await container.graphService.createGraph({ name: `Batch cost ${graphCount}` })).id;
    await run(document(Array.from({ length: arcs }, (_, i) => arc(`a${i}`)), Array.from({ length: events }, (_, i) => event(`e${i}`))), id);
    return id;
  }

  // The version store's object reads and writes while `work` runs.
  async function counted<T>(work: () => Promise<T>): Promise<{ reads: number; writes: number }> {
    const versions = (container.graphRepository as unknown as { versionRepository: Record<string, (...args: unknown[]) => Promise<unknown>> }).versionRepository;
    const counts = { reads: 0, writes: 0 };
    const originals = { getObject: versions.getObject, storeObject: versions.storeObject };
    versions.getObject = function (this: unknown, ...args: unknown[]) {
      counts.reads++;
      return originals.getObject.apply(this, args);
    };
    versions.storeObject = function (this: unknown, ...args: unknown[]) {
      counts.writes++;
      return originals.storeObject.apply(this, args);
    };
    try {
      await work();
    } finally {
      versions.getObject = originals.getObject;
      versions.storeObject = originals.storeObject;
    }
    return counts;
  }

  it('reads and writes no more objects for a small batch in a large graph than in a small one', async () => {
    const small = await graphOf(5, 10);
    const large = await graphOf(300, 600);
    const batch = (prefix: string) => document(Array.from({ length: 5 }, (_, i) => arc(`${prefix}${i}`)));

    const inSmall = await counted(() => run(batch('s'), small));
    const inLarge = await counted(() => run(batch('l'), large));

    expect(inLarge.writes).toBe(5);
    expect(inLarge).toEqual(inSmall);
    // Five new arcs are in no head, so nothing at all is read for them.
    expect(inLarge.reads).toBeLessThanOrEqual(5);
  });

  it('reads only the entities an overwrite touches', async () => {
    const graphId = await graphOf(300, 600);
    const edited = [arc('a1'), arc('a2')].map((a) => ({ ...a, name: `${a.name} (edited)` }));
    const cost = await counted(() => run(document(edited), graphId, 'overwrite'));
    expect(cost.reads).toBeLessThanOrEqual(2 * edited.length);
    expect(cost.writes).toBe(2);
  });

  it('keeps the graph metadata as a full recount of the head gives it', async () => {
    const graphId = await graphOf(3, 4);
    await run(document([arc('x1')], [event('x-early', 'Zed', '1700-01-01T00:00:00.000Z'), event('x-late', 'A', '1990-06-01T00:00:00.000Z')]), graphId);
    const kept = (await container.graphRepository.findById(graphId))!.metadata;
    const recount = await container.graphRepository.calculateMetadata(graphId);
    expect(kept).toEqual(recount);
    expect(kept).toMatchObject({ eventCount: 6, arcCount: 4, temporalRange: { start: '1700-01-01T00:00:00.000Z', end: '1990-06-01T00:00:00.000Z' } });
    expect(kept?.actors).toContain('Zed');
  });

  it('recounts the metadata when the one kept does not describe the head', async () => {
    const graphId = await graphOf(2, 2);
    await container.graphRepository.update(graphId, { metadata: { eventCount: 99, arcCount: 0, relationshipCount: 0, pressureCount: 0, actors: ['Ghost'] } });
    await run(document([arc('y1')], [event('y-e', 'Real')]), graphId);
    const kept = (await container.graphRepository.findById(graphId))!.metadata;
    expect(kept).toEqual(await container.graphRepository.calculateMetadata(graphId));
    expect(kept?.actors).not.toContain('Ghost');
  });

  it('keeps the batch for a rollback, a branch and a merge', async () => {
    const graphId = await graphOf(20, 40);
    await run(document([arc('batch1'), arc('batch2')], [event('batch-e', 'Batcher')]), graphId);
    const batchVersion = (await container.graphRepository.getLatestVersion(graphId))!.version;
    await run(document([arc('later')]), graphId);

    const idsOf = async (id: string) => {
      const { arcRepository, eventRepository } = await container.graphScopedRepositories(id);
      return { arcs: (await arcRepository.findAll()).map((a) => a.id), events: (await eventRepository.findAll()).map((e) => e.id) };
    };

    const branch = await container.graphService.branchGraph(graphId, { name: 'Branch of the batch' });
    const branched = await idsOf(branch.id);
    expect(branched.arcs).toEqual(expect.arrayContaining(['batch1', 'batch2', 'later']));
    expect(branched.events).toContain('batch-e');

    const target = await container.graphService.createGraph({ name: 'Merge target' });
    const merged = await container.graphService.mergeGraph(target.id, { sourceGraphId: graphId, conflictResolution: 'keep-source' });
    expect(merged.success).toBe(true);
    expect((await idsOf(target.id)).arcs).toEqual(expect.arrayContaining(['batch1', 'batch2', 'later']));

    await container.graphService.rollbackGraph(graphId, batchVersion);
    const rolled = await idsOf(graphId);
    expect(rolled.arcs).toEqual(expect.arrayContaining(['batch1', 'batch2']));
    expect(rolled.arcs).not.toContain('later');
    expect(rolled.events).toContain('batch-e');
  });

  describe('links', () => {
    const link = (cause: string, effect: string) => ({ cause_event_id: cause, effect_event_id: effect, weight: 0.5, confidence: 0.5, evidence: 'because', relationship_type: 'direct' });
    async function graphWithLinks(events: number): Promise<string> {
      graphCount += 1;
      const id = (await container.graphService.createGraph({ name: `Batch links ${graphCount}` })).id;
      const doc = {
        metadata: {},
        data: {
          arcs: [],
          events: Array.from({ length: events }, (_, i) => event(`e${i}`)),
          causalRelationships: Array.from({ length: events - 1 }, (_, i) => link(`e${i}`, `e${i + 1}`)),
        },
      };
      await run(doc, id);
      return id;
    }
    const batchWithLink = (prefix: string) => ({
      metadata: {},
      data: { arcs: [arc(`${prefix}arc`)], events: [event(`${prefix}1`), event(`${prefix}2`)], causalRelationships: [link(`${prefix}1`, `${prefix}2`)] },
    });

    it('reads no more objects for a batch that carries a link in a graph of many links than in a graph of few', async () => {
      const few = await graphWithLinks(4);
      const many = await graphWithLinks(200);
      const inFew = await counted(() => run(batchWithLink('f'), few));
      const inMany = await counted(() => run(batchWithLink('m'), many));
      expect(inMany).toEqual(inFew);
      expect(inMany.reads).toBeLessThanOrEqual(3);
      expect(inMany.writes).toBe(4);
    });

    it('still reads every link when a batch deletes an event, and records the links that went with it', async () => {
      const graphId = await graphWithLinks(6);
      const scoped = await container.graphScopedRepositories(graphId);
      await scoped.eventRepository.delete('e3');
      const before = await container.graphRepository.checkout(graphId);
      expect(Object.keys(before.relationships)).toHaveLength(5);
      const live = (await scoped.causalService.getAllRelationships()).map((l) => l.id);
      // A direct recordBatch with a deleted event and no `deletesLinks`.
      await container.graphWriteVersioningService.recordBatch(graphId, { events: new Map([['e3', null]]) }, [{ operation: 'delete', type: 'event', id: 'e3' }]);
      const head = await container.graphRepository.checkout(graphId);
      expect(Object.keys(head.events)).not.toContain('e3');
      expect(Object.keys(head.relationships).sort()).toEqual([...live].sort());
      expect(Object.keys(head.relationships)).toHaveLength(3);
    });
  });

  describe('the graph metadata', () => {
    it('is recounted, not extended, when it describes another head though its counts match', async () => {
      const graphId = await graphOf(1, 2);
      // Counts that add up, but computed from some other head: an actor that is not there.
      const kept = (await container.graphRepository.findById(graphId))!.metadata!;
      await container.graphRepository.update(graphId, { metadata: { ...kept, actors: ['Ghost'], headTree: 'not-the-head' } });
      await run(document([], [event('later', 'Real')]), graphId);
      const after = (await container.graphRepository.findById(graphId))!.metadata!;
      expect(after.actors).toEqual(['A', 'Real']);
      expect(after).toEqual(await container.graphRepository.calculateMetadata(graphId));
    });

    it('lists the actors in the same order whichever way it was reached', async () => {
      const graphId = await graphOf(0, 0);
      await run(document([], [event('z1', 'Zed')]), graphId);
      await run(document([], [event('a1', 'Abe')]), graphId);
      const kept = (await container.graphRepository.findById(graphId))!.metadata!;
      expect(kept.actors).toEqual(['Abe', 'Zed']);
      expect(kept).toEqual(await container.graphRepository.calculateMetadata(graphId));
    });

    it('equals a full recount after any mix of batches, deletes, rollbacks, branches and merges', async () => {
      let seed = 12345;
      const random = (n: number): number => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed % n;
      };
      const actors = ['Ada', 'Bo', 'Cy', 'Di'];
      const times = ['1700-01-01T00:00:00.000Z', '1850-06-01T00:00:00.000Z', '1999-12-31T00:00:00.000Z', '0044-03-15T00:00:00.000Z', '-100000-01-01T00:00:00.000Z', '+100000-01-01T00:00:00.000Z'];
      const graphId = await graphOf(2, 3);
      let next = 0;
      for (let step = 0; step < 40; step++) {
        const scoped = await container.graphScopedRepositories(graphId);
        const events = (await scoped.eventRepository.findAll()).map((e) => e.id);
        const roll = random(10);
        if (roll < 4) {
          const doc = document([arc(`fa${next}`)], [event(`fe${next}`, actors[random(4)], times[random(times.length)])]);
          next++;
          await run(doc, graphId);
        } else if (roll < 6 && events.length > 0) {
          const id = events[random(events.length)];
          await run(document([], [event(id, actors[random(4)], times[random(times.length)])]), graphId, 'overwrite');
        } else if (roll < 8 && events.length > 0) {
          const id = events[random(events.length)];
          await scoped.eventRepository.delete(id);
          await container.graphWriteVersioningService.recordDeletion(graphId, 'event', id);
        } else if (roll === 8) {
          const history = await container.graphRepository.getVersionHistory(graphId);
          const target = history.versions[random(history.versions.length)].version;
          await container.graphService.rollbackGraph(graphId, target);
        } else {
          const side = await container.graphService.branchGraph(graphId, { name: `fuzz ${step}` });
          await run(document([], [event(`side${step}`, actors[random(4)], times[random(times.length)])]), side.id);
          await container.graphService.mergeGraph(graphId, { sourceGraphId: side.id, conflictResolution: 'keep-source' });
        }
        const kept = (await container.graphRepository.findById(graphId))!.metadata;
        expect(kept, `after step ${step} (roll ${roll})`).toEqual(await container.graphRepository.calculateMetadata(graphId));
      }
    }, 120000);
  });

  describe('the kept trees', () => {
    it('are bounded, and a soft-deleted graph is let go', async () => {
      const versions = (container.graphRepository as unknown as { versionRepository: { keptTreeCount(): number } }).versionRepository;
      const ids: string[] = [];
      for (let i = 0; i < 12; i++) ids.push(await graphOf(1, 1));
      expect(versions.keptTreeCount()).toBeLessThanOrEqual(8);
      const last = ids[ids.length - 1];
      expect(versions.keptTreeCount()).toBeGreaterThan(0);
      const before = versions.keptTreeCount();
      await container.graphRepository.delete(last);
      expect(versions.keptTreeCount()).toBe(before - 1);
    });
  });
});
