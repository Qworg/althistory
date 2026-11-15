/**
 * Batch writes, as the first review of issue 26 found them wanting.
 *
 *   1. Undoing a link a batch made deleted the user's older link between the
 *      same two events (the undo named the link by its events, and the store
 *      takes the oldest).
 *   2. A batch re-wrote entities it touched but did not change, and wrote the
 *      live model's projection over the head, so fields only the version store
 *      keeps (an arc's `parent_arc_id`, an event's or a link's `sourceRef`)
 *      were dropped.
 *   3. A versioning failure outside the commit (reading the head, reading the
 *      live store back) announced nothing, and on an atomic failure replaced
 *      the documented 400 with a 500.
 *   4. An undone create was announced as added ("(not versioned)"), for a
 *      batch and for a single create alike.
 *
 * Real local container, real routes, real version store.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
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
import { ImportService } from '@/services/ImportService';

describe('batch writes after the first review', () => {
  let app: Express;
  let container: Container;
  let testDataDir: string;
  let key: string;

  beforeAll(async () => {
    testDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'batch-review-'));
    process.env.LOCAL_EXECUTION_ENABLED = 'true';
    process.env.LOCAL_DATA_DIR = testDataDir;
    process.env.LOCAL_GRAPH_FILE = 'batch-review-graph.json';
    process.env.LOCAL_BACKUP_ENABLED = 'false';
    process.env.LOCAL_MAX_MEMORY_MB = '64';

    const config = loadConfig();
    container = initializeContainer(initializeDatabaseManager(config.database), config);
    await container.initialize();
    key = (
      await container.authService.createApiKey({
        name: 'Reviewer',
        permissions: ['read:events', 'write:events', 'read:arcs', 'write:arcs', 'read:relationships', 'write:relationships', 'read:graphs', 'write:graphs'],
        rateLimit: { requestsPerMinute: 10000, requestsPerHour: 100000, requestsPerDay: 1000000, batchSizeLimit: 1000 },
      })
    ).key;

    app = express();
    app.use(express.json());
    app.use(injectContainer);
    app.use('/api', apiRouter);
    app.use(errorHandler);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await cleanupContainer();
    await fs.rm(testDataDir, { recursive: true, force: true }).catch(() => undefined);
  });

  const newGraph = async (name: string): Promise<string> => (await container.graphService.createGraph({ name })).id;

  const batch = (graphId: string, route: string, body: Record<string, unknown>): request.Test =>
    request(app).post(`/api/batch/${route}`).set('X-API-Key', key).set('X-Graph-Id', graphId).send({ graphId, ...body });

  async function addEvent(graphId: string, description: string, timestamp: string): Promise<string> {
    const res = await request(app)
      .post('/api/events')
      .set('X-API-Key', key)
      .set('X-Graph-Id', graphId)
      .send({ description, actor: 'A', target: 'B', timestamp })
      .expect(201);
    return res.body.data.id as string;
  }

  async function addLink(graphId: string, cause: string, effect: string, evidence: string): Promise<void> {
    await request(app)
      .post('/api/causal/link')
      .set('X-API-Key', key)
      .set('X-Graph-Id', graphId)
      .send({ causeEventId: cause, effectEventId: effect, relationship: { type: 'direct', strength: 0.5, confidence: 0.5, evidence } })
      .expect(201);
  }

  /** The evidence of every link, in the live store and in the version head. */
  async function evidence(graphId: string): Promise<{ live: string[]; head: string[] }> {
    const store = await container.graphContextStore.getStore(graphId);
    const live = (await store.findRelationshipsByType('CAUSES')).map((rel) => String(rel.properties.evidence)).sort();
    const head = Object.values((await container.graphRepository.checkout(graphId)).relationships)
      .map((rel) => String(rel.evidence))
      .sort();
    return { live, head };
  }

  function listen(graphId: string): { heard: ChangeRecord[]; stop: () => void } {
    const heard: ChangeRecord[] = [];
    const stop = container.changeFeedService.subscribe((record) => {
      if (record.graphId === graphId) heard.push(record);
    });
    return { heard, stop };
  }

  const summaries = (heard: ChangeRecord[]): string[] => heard.map((record) => String((record as { summary?: unknown }).summary));

  describe('1. undoing a link keeps an older link between the same events', () => {
    it('in an atomic transaction that fails', async () => {
      const graphId = await newGraph('Undo in a transaction');
      const a = await addEvent(graphId, 'A', '1500-01-01T00:00:00.000Z');
      const b = await addEvent(graphId, 'B', '1501-01-01T00:00:00.000Z');
      await addLink(graphId, a, b, 'ORIGINAL');

      await batch(graphId, 'transaction', {
        atomic: true,
        operations: [
          { type: 'create_relationship', data: { cause_event_id: a, effect_event_id: b, evidence: 'FROM-TX' } },
          { type: 'create_relationship', data: { cause_event_id: a, effect_event_id: 'nope', evidence: 'FROM-TX' } },
        ],
      }).expect(400);

      expect(await evidence(graphId)).toEqual({ live: ['ORIGINAL'], head: ['ORIGINAL'] });
    });

    it('in a batch of links that aborts', async () => {
      const graphId = await newGraph('Undo in an aborted batch');
      const a = await addEvent(graphId, 'A', '1500-01-01T00:00:00.000Z');
      const b = await addEvent(graphId, 'B', '1501-01-01T00:00:00.000Z');
      await addLink(graphId, a, b, 'ORIGINAL');

      await batch(graphId, 'relationships', {
        relationships: [
          { cause_event_id: a, effect_event_id: b, evidence: 'FROM-BATCH' },
          { cause_event_id: a, effect_event_id: 'nope', evidence: 'FROM-BATCH' },
        ],
      }).expect(400);

      expect(await evidence(graphId)).toEqual({ live: ['ORIGINAL'], head: ['ORIGINAL'] });
    });

    it('in a batch of links whose version cannot be committed', async () => {
      const graphId = await newGraph('Undo an unversioned batch');
      const a = await addEvent(graphId, 'A', '1500-01-01T00:00:00.000Z');
      const b = await addEvent(graphId, 'B', '1501-01-01T00:00:00.000Z');
      await addLink(graphId, a, b, 'ORIGINAL');

      vi.spyOn(container.graphRepository, 'commitChanges').mockRejectedValueOnce(new Error('version store is down'));
      await batch(graphId, 'relationships', {
        relationships: [{ cause_event_id: a, effect_event_id: b, evidence: 'FROM-BATCH' }],
      }).expect(500);

      expect(await evidence(graphId)).toEqual({ live: ['ORIGINAL'], head: ['ORIGINAL'] });
    });

    it('in a single link whose version cannot be committed', async () => {
      const graphId = await newGraph('Undo an unversioned link');
      const a = await addEvent(graphId, 'A', '1500-01-01T00:00:00.000Z');
      const b = await addEvent(graphId, 'B', '1501-01-01T00:00:00.000Z');
      await addLink(graphId, a, b, 'ORIGINAL');

      vi.spyOn(container.graphRepository, 'commitChanges').mockRejectedValueOnce(new Error('version store is down'));
      await request(app)
        .post('/api/causal/link')
        .set('X-API-Key', key)
        .set('X-Graph-Id', graphId)
        .send({ causeEventId: a, effectEventId: b, relationship: { type: 'direct', strength: 0.5, confidence: 0.5, evidence: 'SECOND' } })
        .expect(500);

      expect(await evidence(graphId)).toEqual({ live: ['ORIGINAL'], head: ['ORIGINAL'] });
    });
  });

  describe('2. a batch keeps what only the version store holds, and versions only what changed', () => {
    /** A graph whose head holds fields the live model lacks, as an import leaves it, materialized. */
    async function importedGraph(name: string): Promise<{ graphId: string; versions: () => Promise<number> }> {
      const graphId = await newGraph(name);
      await container.graphRepository.commitChanges(
        graphId,
        {
          added: [
            { type: 'arc', id: 'arc-parent', data: { id: 'arc-parent', name: 'Parent', description: 'Outer', start_time: '1800-01-01T00:00:00.000Z', end_time: '1900-01-01T00:00:00.000Z', level: 0, parent_arc_id: null } },
            { type: 'arc', id: 'arc-child', data: { id: 'arc-child', name: 'Child', description: 'Inner', start_time: '1810-01-01T00:00:00.000Z', end_time: '1820-01-01T00:00:00.000Z', level: 1, parent_arc_id: 'arc-parent' } },
            { type: 'event', id: 'evt-a', data: { id: 'evt-a', description: 'Cause', actor: 'A', target: 'B', timestamp: '1811-01-01T00:00:00.000Z', sourceRef: 'doc-1#a' } },
            { type: 'event', id: 'evt-b', data: { id: 'evt-b', description: 'Effect', actor: 'A', target: 'B', timestamp: '1812-01-01T00:00:00.000Z' } },
            { type: 'relationship', id: 'rel-1', data: { id: 'rel-1', cause_event_id: 'evt-a', effect_event_id: 'evt-b', weight: 0.5, evidence: 'Imported', confidence: 0.5, relationship_type: 'direct', sourceRef: 'doc-1#rel' } },
          ],
          modified: [],
          deleted: [],
        },
        'import',
        'An import'
      );
      await container.liveStoreSyncService.materialize(graphId, 'import');
      return { graphId, versions: async () => (await container.graphRepository.getVersionHistory(graphId)).total };
    }

    it('versions nothing for a step that failed', async () => {
      const { graphId, versions } = await importedGraph('Failed step');
      const before = await versions();

      const res = await batch(graphId, 'transaction', {
        atomic: false,
        operations: [{ type: 'update_arc', data: { id: 'arc-child', start_time: 'not a date' } }],
      }).expect(207);
      expect(res.body.results[0].success).toBe(false);

      expect(await versions()).toBe(before);
      expect((await container.graphRepository.checkout(graphId)).arcs['arc-child']).toMatchObject({ parent_arc_id: 'arc-parent' });
    });

    it("keeps an arc's parent and an event's source through an edit", async () => {
      const { graphId } = await importedGraph('Edited');

      await batch(graphId, 'transaction', {
        operations: [
          { type: 'update_arc', data: { id: 'arc-child', name: 'Child, renamed' } },
          { type: 'update_event', data: { id: 'evt-a', description: 'Cause, renamed' } },
        ],
      }).expect(200);

      const head = await container.graphRepository.checkout(graphId);
      expect(head.arcs['arc-child']).toMatchObject({ name: 'Child, renamed', parent_arc_id: 'arc-parent' });
      expect(head.events['evt-a']).toMatchObject({ description: 'Cause, renamed', sourceRef: 'doc-1#a' });
      const exported = await container.exportService.exportGraph({ graphId, scope: 'full', includeProvenance: false });
      expect(exported.export.data.arcs.find((arc) => arc.id === 'arc-child')?.parent_arc_id).toBe('arc-parent');
    });

    /** Whether the graph's export is a document the importer accepts. */
    async function exportValidates(graphId: string): Promise<{ valid: boolean; codes: string[] }> {
      const exported = await container.exportService.exportGraph({ graphId, scope: 'full', includeProvenance: false });
      const result = await new ImportService({ dataDir: testDataDir }).validateFormat(exported.export);
      return { valid: result.valid, codes: result.errors.map((error) => error.code) };
    }

    // Second review: the overlay kept an arc's parent after the arc was
    // promoted, so the head said "level 0, child of arc-parent" and the export
    // failed the importer's hierarchy check (ARC_HIERARCHY_VIOLATION).
    it("drops an arc's parent when an edit promotes it to the top level, and the export still validates", async () => {
      const { graphId } = await importedGraph('Promoted by PUT');
      expect(await exportValidates(graphId)).toEqual({ valid: true, codes: [] });

      await request(app).put('/api/arcs/arc-child').set('X-API-Key', key).set('X-Graph-Id', graphId).send({ level: 0 }).expect(200);

      expect((await container.graphRepository.checkout(graphId)).arcs['arc-child']).toMatchObject({ level: 0, parent_arc_id: null });
      expect(await exportValidates(graphId)).toEqual({ valid: true, codes: [] });
    });

    it("drops an arc's parent when a batch promotes it, and the export still validates", async () => {
      const { graphId } = await importedGraph('Promoted by a batch');
      await batch(graphId, 'transaction', {
        operations: [{ type: 'update_arc', data: { id: 'arc-child', level: 0 } }],
      }).expect(200);

      expect((await container.graphRepository.checkout(graphId)).arcs['arc-child']).toMatchObject({ level: 0, parent_arc_id: null });
      expect(await exportValidates(graphId)).toEqual({ valid: true, codes: [] });
    });

    it("keeps an arc's parent while its level still fits under it, in the same batch as the parent's own edit", async () => {
      const { graphId } = await importedGraph('Parent and child edited together');
      await batch(graphId, 'transaction', {
        operations: [
          { type: 'update_arc', data: { id: 'arc-parent', name: 'Parent, renamed' } },
          { type: 'update_arc', data: { id: 'arc-child', name: 'Child, renamed' } },
        ],
      }).expect(200);
      expect((await container.graphRepository.checkout(graphId)).arcs['arc-child']).toMatchObject({ level: 1, parent_arc_id: 'arc-parent' });
      expect(await exportValidates(graphId)).toEqual({ valid: true, codes: [] });
    });

    // Second review: the head read for the overlay swallowed its errors, so
    // the edit was versioned as the bare live projection (parent and source
    // gone) and announced as a normal edit.
    it("fails an edit, rather than versioning it without what only the head holds, when the head cannot be read", async () => {
      const { graphId } = await importedGraph('Head read fails');
      const { heard, stop } = listen(graphId);
      vi.spyOn(container.graphRepository, 'getHeadEntities').mockRejectedValueOnce(new Error('object missing'));
      try {
        await request(app).put('/api/arcs/arc-child').set('X-API-Key', key).set('X-Graph-Id', graphId).send({ name: 'Renamed' }).expect(500);
      } finally {
        stop();
      }
      // The route undid the edit, so nothing is announced and the head is as it was.
      expect(summaries(heard)).toEqual([]);
      expect((await container.graphRepository.checkout(graphId)).arcs['arc-child']).toMatchObject({ name: 'Child', parent_arc_id: 'arc-parent' });
      const { arcRepository } = await container.graphScopedRepositories(graphId);
      expect((await arcRepository.findById('arc-child'))?.name).toBe('Child');
    });

    it('announces an edit it could not version for want of the head, when the caller keeps the edit', async () => {
      const { graphId } = await importedGraph('Head read fails, kept');
      const { heard, stop } = listen(graphId);
      const { eventRepository } = await container.graphScopedRepositories(graphId);
      const updated = await eventRepository.update('evt-a', { description: 'Cause, renamed' });
      vi.spyOn(container.graphRepository, 'getHeadEntities').mockRejectedValueOnce(new Error('object missing'));
      try {
        await expect(container.graphWriteVersioningService.recordEvent(graphId, updated!, 'update')).rejects.toThrow('object missing');
      } finally {
        stop();
      }
      expect(summaries(heard)).toEqual(['Edited event “Cause, renamed” (not versioned)']);
      expect((await container.graphRepository.checkout(graphId)).events['evt-a']).toMatchObject({ description: 'Cause', sourceRef: 'doc-1#a' });
    });

    /**
     * An arc as the CLI, MCP and the generator make it: its parent recorded
     * only in the live metadata (`metadata.parentArcId`), which the export
     * falls back to for `parent_arc_id`.
     */
    async function cliGraph(name: string): Promise<{ graphId: string; parentId: string; childId: string }> {
      const graphId = await newGraph(name);
      const { arcRepository } = await container.graphScopedRepositories(graphId);
      const parent = await arcRepository.create({ name: 'Age', description: 'Outer', start_time: new Date('1800-01-01T00:00:00.000Z'), end_time: new Date('1900-01-01T00:00:00.000Z'), level: 0 });
      await container.graphWriteVersioningService.recordArc(graphId, parent, 'create');
      const child = await arcRepository.create({ name: 'Reign', description: 'Inner', start_time: new Date('1810-01-01T00:00:00.000Z'), end_time: new Date('1820-01-01T00:00:00.000Z'), level: 1, metadata: { parentArcId: parent.id, note: 'kept' } });
      await container.graphWriteVersioningService.recordArc(graphId, child, 'create');
      return { graphId, parentId: parent.id, childId: child.id };
    }

    async function parentRecords(graphId: string, arcId: string): Promise<{ live: unknown; head: unknown; note: unknown }> {
      const { arcRepository } = await container.graphScopedRepositories(graphId);
      const live = (await arcRepository.findById(arcId))?.metadata ?? {};
      const head = ((await container.graphRepository.checkout(graphId)).arcs[arcId]?.metadata ?? {}) as Record<string, unknown>;
      return { live: live.parentArcId, head: head.parentArcId, note: live.note };
    }

    // Second review, the open item: the stale parent of a CLI-made arc lives
    // in its metadata, where the overlay cannot see it; the export fell back
    // to it and failed the hierarchy check.
    it("clears a CLI arc's recorded parent when a PUT promotes it, in the live store and the head, and the export validates", async () => {
      const { graphId, parentId, childId } = await cliGraph('CLI arc promoted by PUT');
      expect(await exportValidates(graphId)).toEqual({ valid: true, codes: [] });
      expect(await parentRecords(graphId, childId)).toEqual({ live: parentId, head: parentId, note: 'kept' });

      await request(app).put(`/api/arcs/${childId}`).set('X-API-Key', key).set('X-Graph-Id', graphId).send({ level: 0 }).expect(200);

      expect(await exportValidates(graphId)).toEqual({ valid: true, codes: [] });
      expect(await parentRecords(graphId, childId)).toEqual({ live: undefined, head: undefined, note: 'kept' });
    });

    it("clears a CLI arc's recorded parent when a batch moves it to a level that no longer fits, and the export validates", async () => {
      const { graphId, childId } = await cliGraph('CLI arc moved by a batch');
      await batch(graphId, 'transaction', {
        operations: [{ type: 'update_arc', data: { id: childId, level: 0 } }],
      }).expect(200);

      expect(await parentRecords(graphId, childId)).toEqual({ live: undefined, head: undefined, note: 'kept' });
      expect(await exportValidates(graphId)).toEqual({ valid: true, codes: [] });
    });

    it("keeps a CLI arc's recorded parent through an edit that leaves its level alone, or one that still fits", async () => {
      const { graphId, parentId, childId } = await cliGraph('CLI arc renamed');
      await request(app).put(`/api/arcs/${childId}`).set('X-API-Key', key).set('X-Graph-Id', graphId).send({ name: 'Reign, renamed', level: 1 }).expect(200);
      expect(await parentRecords(graphId, childId)).toEqual({ live: parentId, head: parentId, note: 'kept' });
      expect(await exportValidates(graphId)).toEqual({ valid: true, codes: [] });
    });

    it('leaves a link alone that a batch only passed by', async () => {
      const { graphId } = await importedGraph('Passed by');
      const res = await batch(graphId, 'relationships', {
        relationships: [{ cause_event_id: 'evt-a', effect_event_id: 'evt-b', evidence: 'Another' }],
      }).expect(201);
      expect(res.body.created).toHaveLength(1);

      const history = await container.graphRepository.getVersionHistory(graphId);
      const latest = history.versions[0];
      expect(latest.description).toBe('Added 1 link in a batch');
      expect(latest.changes.modified).toEqual([]);
      expect((await container.graphRepository.checkout(graphId)).relationships['rel-1']).toMatchObject({ sourceRef: 'doc-1#rel' });
    });
  });

  describe('3. a versioning failure outside the commit', () => {
    it('is announced as not versioned, and the 500 says so', async () => {
      const graphId = await newGraph('Head unreadable');
      const existing = await addEvent(graphId, 'Existing', '1600-01-01T00:00:00.000Z');
      const { heard, stop } = listen(graphId);
      vi.spyOn(container.graphRepository, 'checkout').mockRejectedValueOnce(new Error('head unreadable'));
      try {
        await batch(graphId, 'transaction', {
          operations: [{ type: 'update_event', data: { id: existing, description: 'Changed' } }],
        }).expect(500);
      } finally {
        stop();
      }
      expect(summaries(heard)).toEqual(['Edited 1 event in a batch (not versioned)']);
    });

    it('keeps the 400 and its result on an atomic failure', async () => {
      const graphId = await newGraph('Atomic failure, head unreadable');
      const existing = await addEvent(graphId, 'Existing', '1600-01-01T00:00:00.000Z');
      vi.spyOn(container.graphRepository, 'checkout').mockRejectedValueOnce(new Error('head unreadable'));

      const res = await batch(graphId, 'transaction', {
        atomic: true,
        operations: [
          { type: 'update_event', data: { id: existing, description: 'Changed, and not undone' } },
          { type: 'create_relationship', data: { cause_event_id: existing, effect_event_id: 'nope', evidence: 'x' } },
        ],
      }).expect(400);
      expect(res.body.error.code).toBe('TRANSACTION_FAILED');
      expect(res.body.result.rollbackPerformed).toBe(true);
    });

    it('keeps the 400 of an aborted batch', async () => {
      const graphId = await newGraph('Aborted, head unreadable');
      const a = await addEvent(graphId, 'A', '1500-01-01T00:00:00.000Z');
      vi.spyOn(container.graphRepository, 'checkout').mockRejectedValue(new Error('head unreadable'));
      const res = await batch(graphId, 'relationships', {
        relationships: [{ cause_event_id: a, effect_event_id: 'nope', evidence: 'x' }],
      }).expect(400);
      expect(res.body.error.code).toBe('BATCH_ABORTED');
    });
  });

  describe('4. an undone create is not announced', () => {
    it('for a batch of events', async () => {
      const graphId = await newGraph('Undone batch');
      const { heard, stop } = listen(graphId);
      vi.spyOn(container.graphRepository, 'commitChanges').mockRejectedValueOnce(new Error('version store is down'));
      try {
        await batch(graphId, 'events', {
          events: [
            { description: 'One', actor: 'A', target: 'B', timestamp: '1302-01-01T00:00:00Z' },
            { description: 'Two', actor: 'A', target: 'B', timestamp: '1303-01-01T00:00:00Z' },
          ],
        }).expect(500);
      } finally {
        stop();
      }
      expect(heard).toEqual([]);
      const { eventRepository } = await container.graphScopedRepositories(graphId);
      expect(await eventRepository.findAll()).toEqual([]);
    });

    it('for a single event, a single arc and a single edit, as for a batch', async () => {
      const graphId = await newGraph('Undone single writes');
      const existing = await addEvent(graphId, 'Existing', '1600-01-01T00:00:00.000Z');
      const { heard, stop } = listen(graphId);
      const commit = vi.spyOn(container.graphRepository, 'commitChanges');
      try {
        commit.mockRejectedValueOnce(new Error('version store is down'));
        await request(app)
          .post('/api/events')
          .set('X-API-Key', key)
          .set('X-Graph-Id', graphId)
          .send({ description: 'Undone', actor: 'A', target: 'B', timestamp: '1601-01-01T00:00:00.000Z' })
          .expect(500);
        commit.mockRejectedValueOnce(new Error('version store is down'));
        await request(app)
          .post('/api/arcs')
          .set('X-API-Key', key)
          .set('X-Graph-Id', graphId)
          .send({ name: 'Undone', description: 'Arc', start_time: '1600-01-01T00:00:00.000Z', end_time: '1700-01-01T00:00:00.000Z', level: 0 })
          .expect(500);
        commit.mockRejectedValueOnce(new Error('version store is down'));
        await request(app)
          .put(`/api/events/${existing}`)
          .set('X-API-Key', key)
          .set('X-Graph-Id', graphId)
          .send({ description: 'Edit undone' })
          .expect(500);
      } finally {
        stop();
      }
      expect(summaries(heard)).toEqual([]);
    });
  });
});
