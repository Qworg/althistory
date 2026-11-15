/**
 * Batch writes are versions (issue 26).
 *
 * The four `/api/batch` routes used to write the live store and nothing else.
 * Every operation that rebuilds the live store from the version head --
 * rollback, merge, branch, an approved import -- then deleted what a batch had
 * written, and an export (which reads the version tree) never contained it.
 *
 * These tests boot the real local container and drive the real routes, then
 * read the version head, an export and a rollback. Each fails on the old
 * routes: the head holds none of the batch's entities, the export is missing
 * them, and the rollback wipes them from the live store.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express, { Express } from 'express';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { loadConfig, initializeDatabaseManager } from '@/utils';
import { initializeContainer, cleanupContainer, Container } from '@/container';
import { apiRouter } from '@/api/routes';
import { errorHandler, injectContainer } from '@/api/middleware';
import type { ChangeRecord } from '@/services/ChangeFeedService';

describe('Batch writes are recorded as versions', () => {
  let app: Express;
  let container: Container;
  let testDataDir: string;
  let key: string;

  beforeAll(async () => {
    testDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'batch-versioning-'));
    process.env.LOCAL_EXECUTION_ENABLED = 'true';
    process.env.LOCAL_DATA_DIR = testDataDir;
    process.env.LOCAL_GRAPH_FILE = 'batch-versioning-graph.json';
    process.env.LOCAL_BACKUP_ENABLED = 'false';
    process.env.LOCAL_MAX_MEMORY_MB = '64';

    const config = loadConfig();
    container = initializeContainer(initializeDatabaseManager(config.database), config);
    await container.initialize();

    key = (
      await container.authService.createApiKey({
        name: 'Batch writer',
        permissions: ['read:events', 'write:events', 'read:arcs', 'write:arcs', 'read:relationships', 'write:relationships', 'read:graphs', 'write:graphs'],
        rateLimit: { batchSizeLimit: 1000 },
      })
    ).key;

    app = express();
    app.use(express.json());
    app.use(injectContainer);
    app.use('/api', apiRouter);
    app.use(errorHandler);
  });

  afterAll(async () => {
    await cleanupContainer();
    await fs.rm(testDataDir, { recursive: true, force: true }).catch(() => undefined);
  });

  async function newGraph(name: string): Promise<string> {
    return (await container.graphService.createGraph({ name })).id;
  }

  function batch(graphId: string, route: string, body: Record<string, unknown>): request.Test {
    return request(app).post(`/api/batch/${route}`).set('X-API-Key', key).set('X-Graph-Id', graphId).send({ graphId, ...body });
  }

  async function addEvent(graphId: string, description: string, timestamp: string): Promise<string> {
    const res = await request(app)
      .post('/api/events')
      .set('X-API-Key', key)
      .set('X-Graph-Id', graphId)
      .send({ description, actor: 'A', target: 'B', timestamp })
      .expect(201);
    return res.body.data.id as string;
  }

  /** The ids the live store and the version head hold, by kind. */
  async function bothStores(graphId: string): Promise<{
    live: { events: string[]; arcs: string[]; links: string[] };
    head: { events: string[]; arcs: string[]; links: string[] };
  }> {
    const scoped = await container.graphScopedRepositories(graphId);
    const store = await container.graphContextStore.getStore(graphId);
    const links = (await store.findRelationshipsByType('CAUSES')).map((rel) => rel.id);
    const head = await container.graphRepository.checkout(graphId);
    return {
      live: {
        events: (await scoped.eventRepository.findAll()).map((event) => event.id).sort(),
        arcs: (await scoped.arcRepository.findAll()).map((arc) => arc.id).sort(),
        links: links.sort(),
      },
      head: {
        events: Object.keys(head.events).sort(),
        arcs: Object.keys(head.arcs).sort(),
        links: Object.keys(head.relationships).sort(),
      },
    };
  }

  it('versions a batch of events once, so an export holds them and a rollback keeps them', async () => {
    const graphId = await newGraph('Batch events');
    const first = await addEvent(graphId, 'Before the batch', '1800-01-01T00:00:00.000Z');

    const res = await batch(graphId, 'events', {
      events: [
        { description: 'Batch one', actor: 'A', target: 'B', timestamp: '1801-01-01T00:00:00.000Z' },
        { description: 'Batch two', actor: 'A', target: 'B', timestamp: '1802-01-01T00:00:00.000Z' },
      ],
    }).expect(201);
    const created = res.body.created as string[];
    expect(created).toHaveLength(2);

    // One version for the whole batch, after the single write's.
    const history = await container.graphRepository.getVersionHistory(graphId);
    expect(history.total).toBe(2);
    const batchVersion = history.versions.find((version) => version.version === 1);
    expect(batchVersion).toMatchObject({ operation: 'create', description: 'Added 2 events in a batch' });
    expect(batchVersion?.changes.added.map((change) => change.id).sort()).toEqual([...created].sort());

    // The export reads the version tree.
    const exported = await container.exportService.exportGraph({ graphId, scope: 'full', includeProvenance: false });
    expect(exported.export.data.events.map((event) => event.id).sort()).toEqual([first, ...created].sort());

    // A later write, then a rollback to the batch's version: the batch survives the rebuild.
    const later = await addEvent(graphId, 'After the batch', '1803-01-01T00:00:00.000Z');
    await container.graphService.rollbackGraph(graphId, 1);
    const { live } = await bothStores(graphId);
    expect(live.events).toEqual([first, ...created].sort());
    expect(live.events).not.toContain(later);
  });

  it('versions a batch of arcs and of links, and a branch carries them', async () => {
    const graphId = await newGraph('Batch arcs and links');
    const cause = await addEvent(graphId, 'Cause', '1900-01-01T00:00:00.000Z');
    const effect = await addEvent(graphId, 'Effect', '1901-01-01T00:00:00.000Z');

    const dbg = await batch(graphId, 'arcs', {
      arcs: [{ name: 'An age', description: 'Long', start_time: '1899-01-01T00:00:00.000Z', end_time: '1950-01-01T00:00:00.000Z', level: 0 }],
    });
    expect(dbg.status).toBe(201);
    await batch(graphId, 'relationships', {
      relationships: [{ cause_event_id: cause, effect_event_id: effect, weight: 0.7, evidence: 'Seen' }],
    }).expect(201);

    const stores = await bothStores(graphId);
    expect(stores.live.arcs).toHaveLength(1);
    expect(stores.live.links).toHaveLength(1);
    expect(stores.head).toEqual(stores.live);

    const head = await container.graphRepository.checkout(graphId);
    expect(Object.values(head.relationships)[0]).toMatchObject({ cause_event_id: cause, effect_event_id: effect, weight: 0.7 });

    // A branch's live store is materialized from the source's head.
    const branch = await container.graphService.branchGraph(graphId, { name: 'Branch of the batch' });
    const branched = await bothStores(branch.id);
    expect(branched.live.arcs).toEqual(stores.live.arcs);
    expect(branched.live.links).toEqual(stores.live.links);
  });

  it('versions what a transaction left in the store: its updates, its deletes and their cascades', async () => {
    const graphId = await newGraph('Batch transaction');
    const kept = await addEvent(graphId, 'Kept', '1700-01-01T00:00:00.000Z');
    const doomed = await addEvent(graphId, 'Doomed', '1701-01-01T00:00:00.000Z');
    await request(app)
      .post('/api/causal/link')
      .set('X-API-Key', key)
      .set('X-Graph-Id', graphId)
      .send({ causeEventId: kept, effectEventId: doomed, relationship: { type: 'direct', strength: 0.5, confidence: 0.5, evidence: 'Seen' } })
      .expect(201);

    const res = await batch(graphId, 'transaction', {
      operations: [
        { type: 'update_event', data: { id: kept, description: 'Kept, renamed' } },
        { type: 'delete_event', data: { id: doomed } },
        { type: 'create_event', data: { description: 'New', actor: 'A', target: 'B', timestamp: '1702-01-01T00:00:00.000Z' } },
      ],
    }).expect(200);
    const createdId = res.body.results[2].id as string;

    const stores = await bothStores(graphId);
    expect(stores.live.events).toEqual([kept, createdId].sort());
    expect(stores.live.links).toEqual([]);
    expect(stores.head).toEqual(stores.live);

    const head = await container.graphRepository.checkout(graphId);
    expect(head.events[kept]).toMatchObject({ description: 'Kept, renamed' });

    const history = await container.graphRepository.getVersionHistory(graphId);
    const latest = history.versions[0];
    expect(latest.operation).toBe('update');
    expect(latest.description).toBe('Edited 1 event, deleted 1 event, deleted 1 link, added 1 event in a batch');
  });

  it('versions only what an atomic transaction that failed left behind', async () => {
    const graphId = await newGraph('Failed transaction');
    const existing = await addEvent(graphId, 'Existing', '1600-01-01T00:00:00.000Z');

    const res = await batch(graphId, 'transaction', {
      atomic: true,
      operations: [
        { type: 'update_event', data: { id: existing, description: 'Changed, and not undone' } },
        { type: 'create_event', data: { description: 'Undone', actor: 'A', target: 'B', timestamp: '1601-01-01T00:00:00.000Z' } },
        { type: 'create_event', data: { description: 'Undone too', actor: 'A', target: 'B', timestamp: '1602-01-01T00:00:00.000Z' } },
        { type: 'create_relationship', data: { cause_event_id: existing, effect_event_id: 'no-such-event', evidence: 'Seen' } },
      ],
    }).expect(400);
    expect(res.body.result.rollbackPerformed).toBe(true);

    const stores = await bothStores(graphId);
    expect(stores.live.events).toEqual([existing]);
    expect(stores.head).toEqual(stores.live);
    const head = await container.graphRepository.checkout(graphId);
    expect(head.events[existing]).toMatchObject({ description: 'Changed, and not undone' });
  });

  it('versions every step that landed in a transaction that is not atomic', async () => {
    const graphId = await newGraph('Non-atomic transaction');
    const existing = await addEvent(graphId, 'Existing', '1650-01-01T00:00:00.000Z');

    const res = await batch(graphId, 'transaction', {
      atomic: false,
      operations: [
        { type: 'create_event', data: { description: 'Lands', actor: 'A', target: 'B', timestamp: '1651-01-01T00:00:00.000Z' } },
        { type: 'create_relationship', data: { cause_event_id: existing, effect_event_id: 'no-such-event', evidence: 'Seen' } },
        { type: 'create_arc', data: { name: 'Lands too', description: 'An arc', start_time: '1650-01-01T00:00:00.000Z', end_time: '1660-01-01T00:00:00.000Z', level: 0 } },
      ],
    }).expect(207);
    expect(res.body.results.map((step: { success: boolean }) => step.success)).toEqual([true, false, true]);

    const stores = await bothStores(graphId);
    expect(stores.live.events).toHaveLength(2);
    expect(stores.live.arcs).toHaveLength(1);
    expect(stores.head).toEqual(stores.live);
  });

  it('undoes the links an aborted batch made, although event ids contain underscores', async () => {
    const graphId = await newGraph('Aborted links');
    const a = await addEvent(graphId, 'A', '1500-01-01T00:00:00.000Z');
    const b = await addEvent(graphId, 'B', '1501-01-01T00:00:00.000Z');
    expect(a).toContain('_');

    await batch(graphId, 'relationships', {
      relationships: [
        { cause_event_id: a, effect_event_id: b, evidence: 'Seen' },
        { cause_event_id: a, effect_event_id: 'no-such-event', evidence: 'Seen' },
      ],
    }).expect(400);

    const stores = await bothStores(graphId);
    expect(stores.live.links).toEqual([]);
    expect(stores.head).toEqual(stores.live);
  });

  it('records nothing for an aborted batch of events, and keeps a failed item out of the version', async () => {
    const graphId = await newGraph('Aborted events');
    await batch(graphId, 'events', {
      events: [
        { description: 'Fine', actor: 'A', target: 'B', timestamp: '1400-01-01T00:00:00.000Z' },
        { description: '', actor: 'A', target: 'B', timestamp: '1401-01-01T00:00:00.000Z' },
      ],
    }).expect(400);
    expect((await container.graphRepository.getVersionHistory(graphId)).total).toBe(0);
    expect((await bothStores(graphId)).live.events).toEqual([]);

    await batch(graphId, 'events', {
      onError: 'collect',
      events: [
        { description: 'Fine', actor: 'A', target: 'B', timestamp: '1400-01-01T00:00:00.000Z' },
        { description: 'Bad date', actor: 'A', target: 'B', timestamp: 'not a date' },
      ],
    }).expect(207);
    const stores = await bothStores(graphId);
    expect(stores.live.events).toHaveLength(1);
    expect(stores.head).toEqual(stores.live);
  });

  it('announces a batch once per kind of change, with no second announcement from the version', async () => {
    const graphId = await newGraph('Batch feed');
    const heard: ChangeRecord[] = [];
    const stop = container.changeFeedService.subscribe((record) => {
      if (record.graphId === graphId) heard.push(record);
    });
    try {
      await batch(graphId, 'events', {
        events: [
          { description: 'One', actor: 'A', target: 'B', timestamp: '1302-01-01T00:00:00Z' },
          { description: 'Two', actor: 'A', target: 'B', timestamp: '1303-01-01T00:00:00Z' },
        ],
      }).expect(201);
    } finally {
      stop();
    }
    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({ kind: 'entities', operation: 'create', summary: 'Added 2 events in a batch' });
  });

  it('compares an arc\'s ends exactly, past the range a double holds', async () => {
    const graphId = await newGraph('Deep batch');
    // One millisecond apart, 300,000 years out: the same double.
    const start = '+300000-01-01T00:00:00.000Z';
    const end = '+300000-01-01T00:00:00.001Z';
    await batch(graphId, 'arcs', {
      arcs: [{ name: 'A moment', description: 'Short', start_time: start, end_time: end, level: 0 }],
    }).expect(201);
    const reversed = await batch(graphId, 'arcs', {
      validation: 'strict',
      onError: 'collect',
      arcs: [{ name: 'Backwards', description: 'Short', start_time: end, end_time: start, level: 0 }],
    });
    expect(reversed.status).toBe(207);
    expect(reversed.body.failed[0].error).toContain('start_time must be before end_time');
  });
});
