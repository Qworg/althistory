/**
 * The third review of the arc hierarchy (issue 28), one test per finding. Every
 * test asserts the end state, not only a status: the export validates, the live
 * store equals the head, and a rebuild of the live store from the head (a
 * rollback, branch or merge) loses and skips nothing.
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
import { ImportService } from '@/services/ImportService';
import { GraphImporter } from '@/cli/export/GraphImporter';
import { EventRepository } from '@/repositories/EventRepository';
import { createImportRouter } from '@/api/routes/import';

type Kind = 'cli' | 'imported';
type ArcSpec = [id: string, level: number, start: string, end: string, parent?: string];
type Shape = Record<string, [number, string | null]>;

const iso = (year: number): string => `${year}-01-01T00:00:00.000Z`;
const arcSpec = (id: string, level: number, from: number, to: number, parent?: string): ArcSpec => [id, level, iso(from), iso(to), ...(parent ? [parent] : [])] as ArcSpec;

describe('the arc hierarchy, third review', () => {
  let app: Express;
  let container: Container;
  let testDataDir: string;
  let key: string;
  let graphCount = 0;

  beforeAll(async () => {
    testDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arc-hierarchy-review3-'));
    process.env.LOCAL_EXECUTION_ENABLED = 'true';
    process.env.LOCAL_DATA_DIR = testDataDir;
    process.env.LOCAL_GRAPH_FILE = 'arc-hierarchy-review3-graph.json';
    process.env.LOCAL_BACKUP_ENABLED = 'false';
    process.env.LOCAL_MAX_MEMORY_MB = '64';
    const config = loadConfig();
    container = initializeContainer(initializeDatabaseManager(config.database), config);
    await container.initialize();
    key = (
      await container.authService.createApiKey({
        name: 'Review',
        permissions: ['read:events', 'write:events', 'read:arcs', 'write:arcs', 'read:relationships', 'write:relationships', 'read:graphs', 'write:graphs'],
        rateLimit: { requestsPerMinute: 100000, requestsPerHour: 1000000, requestsPerDay: 10000000, batchSizeLimit: 1000 },
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

  const asKey = (req: request.Test, graphId: string): request.Test => req.set('X-API-Key', key).set('X-Graph-Id', graphId);
  const transaction = (graphId: string, operations: unknown[], atomic = true): request.Test =>
    asKey(request(app).post('/api/batch/transaction'), graphId).send({ graphId, operations, atomic });
  const post = (graphId: string, body: Record<string, unknown>): request.Test => asKey(request(app).post('/api/arcs'), graphId).send(body);

  async function graphOf(kind: Kind, arcs: ArcSpec[]): Promise<string> {
    graphCount += 1;
    const graphId = (await container.graphService.createGraph({ name: `Review ${kind} ${graphCount}` })).id;
    if (kind === 'cli') {
      const { arcRepository } = await container.graphScopedRepositories(graphId);
      for (const [id, level, start, end, parent] of arcs) {
        const arc = await arcRepository.create({ id, name: id, description: id, start_time: new Date(start), end_time: new Date(end), level, metadata: parent ? { parentArcId: parent } : {} } as never);
        await container.graphWriteVersioningService.recordArc(graphId, arc, 'create');
      }
      return graphId;
    }
    await commitArcs(graphId, arcs);
    return graphId;
  }

  /** Arcs as an import wrote them: the parent in the head's `parent_arc_id` only. */
  async function commitArcs(graphId: string, arcs: ArcSpec[], extra: Record<string, Record<string, unknown>> = {}): Promise<void> {
    await container.graphRepository.commitChanges(
      graphId,
      {
        added: arcs.map(([id, level, start, end, parent]) => ({
          type: 'arc' as const,
          id,
          data: { id, name: id, description: id, start_time: start, end_time: end, level, parent_arc_id: parent ?? null, ...(extra[id] ?? {}) },
        })),
        modified: [],
        deleted: [],
      },
      'import',
      'An import'
    );
    await container.liveStoreSyncService.materialize(graphId, 'import');
  }

  async function exported(graphId: string): Promise<{ valid: boolean; errors: string[]; arcs: Shape }> {
    const document = await container.exportService.exportGraph({ graphId, scope: 'full', includeProvenance: false });
    const result = await new ImportService({ dataDir: testDataDir }).validateFormat(document.export);
    const temporal = new ImportService({ dataDir: testDataDir }).validateTemporalConstraints(document.export);
    const arcs = Object.fromEntries(document.export.data.arcs.map((arc) => [arc.id, [arc.level, arc.parent_arc_id ?? null] as [number, string | null]]));
    return { valid: result.valid && temporal.length === 0, errors: [...result.errors, ...temporal].map((error) => `${error.code}: ${error.message}`), arcs };
  }

  /** The live store's arcs: level, and the parent the export would read from them (the live metadata). */
  async function live(graphId: string): Promise<Record<string, [number, string | null]>> {
    const { arcRepository } = await container.graphScopedRepositories(graphId);
    return Object.fromEntries((await arcRepository.findAll()).map((arc) => [arc.id, [arc.level, (arc.metadata?.parentArcId as string | undefined) ?? null] as [number, string | null]]));
  }

  /**
   * The graph is whole: the export validates, the live store has every arc the
   * head has at the level the head records, and a rebuild from the head skips
   * and loses nothing.
   */
  async function expectConsistent(graphId: string): Promise<Shape> {
    const after = await exported(graphId);
    expect(after.errors).toEqual([]);
    expect(after.valid).toBe(true);
    const head = await container.graphRepository.checkout(graphId);
    const liveArcs = await live(graphId);
    expect(Object.keys(liveArcs).sort()).toEqual(Object.keys(head.arcs).sort());
    for (const [id, [level]] of Object.entries(liveArcs)) expect(head.arcs[id].level).toBe(level);
    const rebuilt = await container.liveStoreSyncService.materialize(graphId, 'rollback');
    expect(rebuilt.skipped).toEqual([]);
    expect(rebuilt.warnings).toEqual([]);
    expect(Object.keys(await live(graphId)).sort()).toEqual(Object.keys(head.arcs).sort());
    expect((await exported(graphId)).arcs).toEqual(after.arcs);
    return after.arcs;
  }

  // G (0) > P (1) > C (2) > D (3), and a sibling S (1) under G.
  const tree: ArcSpec[] = [arcSpec('G', 0, 1700, 1950), arcSpec('P', 1, 1800, 1900, 'G'), arcSpec('C', 2, 1810, 1850, 'P'), arcSpec('D', 3, 1812, 1820, 'C'), arcSpec('S', 1, 1790, 1940, 'G')];

  const results = (response: request.Response): Array<{ index: number; type: string; id?: string; success: boolean; error?: string; warning?: string }> => response.body.results ?? response.body.result?.results;
  const failing = { type: 'create_arc', data: { id: 'X', start_time: iso(1700), end_time: iso(1950), level: 0 } }; // no name: the store refuses it
  const eventIn = (id: string, arcId: string, extra: Record<string, unknown> = {}) => ({ type: 'create_event', data: { id, description: `in ${arcId}`, actor: 'A', target: 'B', timestamp: iso(1850), metadata: { arcId, ...extra } } });
  const liveEvents = async (graphId: string) => {
    const { eventRepository } = await container.graphScopedRepositories(graphId);
    return Object.fromEntries((await eventRepository.findAll()).map((event) => [event.id, event.metadata ?? {}]));
  };
  const headEvents = async (graphId: string) => Object.fromEntries(Object.entries((await container.graphRepository.checkout(graphId)).events).map(([id, event]) => [id, (event.metadata ?? {}) as Record<string, unknown>]));

  for (const kind of ['cli', 'imported'] as const) {
    describe(`${kind} arcs`, () => {
      describe('HIGH 1: a create never takes the place of an existing arc', () => {
        const create = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: `${id} clobbered`, start_time: iso(1801), end_time: iso(1802), level: 0, ...extra });
        const doors: Array<[string, (graphId: string, id: string) => request.Test]> = [
          ['POST /api/arcs', (graphId, id) => post(graphId, create(id))],
          ['POST /api/batch/arcs', (graphId, id) => asKey(request(app).post('/api/batch/arcs'), graphId).send({ graphId, arcs: [create(id)] })],
          ['a transaction create_arc', (graphId, id) => transaction(graphId, [{ type: 'create_arc', data: create(id) }])],
        ];
        for (const [door, send] of doors) {
          for (const id of ['G', 'P']) {
            it(`${door} naming the id of ${id} is refused and ${id} is untouched`, async () => {
              const graphId = await graphOf(kind, tree);
              const before = await expectConsistent(graphId);
              const arcsBefore = (await container.graphRepository.checkout(graphId)).arcs;
              const response = await send(graphId, id);
              expect(response.status).toBeGreaterThanOrEqual(400);
              expect(response.status).toBeLessThan(500);
              expect(JSON.stringify(response.body)).toContain(id);
              expect(await expectConsistent(graphId)).toEqual(before);
              expect((await container.graphRepository.checkout(graphId)).arcs).toEqual(arcsBefore);
              const { arcRepository } = await container.graphScopedRepositories(graphId);
              expect((await arcRepository.findById(id))?.name).toBe(id);
            });
          }
        }

        it('refuses two creates of one id in a batch', async () => {
          const graphId = await graphOf(kind, tree);
          const before = await expectConsistent(graphId);
          await transaction(graphId, [{ type: 'create_arc', data: create('N') }, { type: 'create_arc', data: create('N') }]).expect(400);
          await asKey(request(app).post('/api/batch/arcs'), graphId).send({ graphId, arcs: [create('N'), create('N')] }).expect(400);
          expect(await expectConsistent(graphId)).toEqual(before);
        });
      });

      describe('MEDIUM 2: undoing the arc steps gives an event back only what the delete took', () => {
        it('keeps what a later event step wrote, and gives the arc back only when nothing replaced it', async () => {
          const graphId = await graphOf(kind, tree);
          await transaction(graphId, [eventIn('E3', 'P'), eventIn('E5', 'P')]).expect(200);
          const response = await transaction(
            graphId,
            [
              { type: 'delete_arc', data: { id: 'P' } },
              { type: 'update_event', data: { id: 'E3', description: 'edited by the batch', metadata: { arcId: 'S', note: 'kept' } } },
              { type: 'update_event', data: { id: 'E5', metadata: { note: 'five' } } },
              failing,
            ],
            false
          );
          expect(response.status).toBe(207);
          const steps = results(response);
          expect(steps.filter((step) => /_event$/.test(step.type)).map((step) => step.success)).toEqual([true, true]);
          // E3 was moved to S by a later step: that stays. E5 had its metadata replaced without an arc: it gets P back, keeping its note.
          expect(await liveEvents(graphId)).toMatchObject({ E3: { arcId: 'S', note: 'kept' }, E5: { arcId: 'P', note: 'five' } });
          expect(await headEvents(graphId)).toMatchObject({ E3: { arcId: 'S', note: 'kept' }, E5: { arcId: 'P', note: 'five' } });
          await expectConsistent(graphId);
        });

        it('gives every event its arc back when the whole transaction is undone', async () => {
          const graphId = await graphOf(kind, tree);
          await transaction(graphId, [eventIn('E3', 'P', { mood: 'calm' })]).expect(200);
          await transaction(graphId, [{ type: 'delete_arc', data: { id: 'P' } }, failing]).expect(400);
          expect(await liveEvents(graphId)).toEqual({ E3: { arcId: 'P', mood: 'calm' } });
          expect(await headEvents(graphId)).toEqual({ E3: { arcId: 'P', mood: 'calm' } });
          await expectConsistent(graphId);
        });

        it('versions what it could not give back (an event whose restore fails is not left unrecorded)', async () => {
          const graphId = await graphOf(kind, tree);
          await transaction(graphId, [eventIn('E3', 'P')]).expect(200);
          const real = EventRepository.prototype.update;
          let calls = 0;
          vi.spyOn(EventRepository.prototype, 'update').mockImplementation(function (this: EventRepository, ...args: Parameters<typeof real>) {
            calls += 1;
            // The delete's unassigning (call 1) is real; giving the arc back (call 2) fails.
            return calls === 2 ? Promise.reject(new Error('store down')) : real.apply(this, args);
          });
          await transaction(graphId, [{ type: 'delete_arc', data: { id: 'P' } }, failing], false);
          vi.restoreAllMocks();
          // Whatever the live store ended with, the head says the same.
          expect(await headEvents(graphId)).toEqual(await liveEvents(graphId));
        });
      });

      describe('MEDIUM 3: an atomic transaction rolls back for a step that does not apply', () => {
        for (const missing of [{ type: 'update_arc', data: { id: 'nosuch', name: 'x' } }, { type: 'delete_arc', data: { id: 'nosuch' } }]) {
          it(`${missing.type} of an arc that is not there undoes the whole transaction`, async () => {
            const graphId = await graphOf(kind, tree);
            const before = await expectConsistent(graphId);
            const response = await transaction(graphId, [eventIn('E1', 'S'), { type: 'update_arc', data: { id: 'S', name: 'S renamed' } }, missing], true);
            expect(response.status).toBe(400);
            expect(response.body.result.rollbackPerformed).toBe(true);
            expect(await liveEvents(graphId)).toEqual({});
            expect(await expectConsistent(graphId)).toEqual(before);
            const { arcRepository } = await container.graphScopedRepositories(graphId);
            expect((await arcRepository.findById('S'))?.name).toBe('S');
          });

          it(`${missing.type} of an arc that is not there fails with a reason in a non-atomic transaction, and the arc steps fail together`, async () => {
            const graphId = await graphOf(kind, tree);
            const before = await expectConsistent(graphId);
            const response = await transaction(graphId, [eventIn('E1', 'S'), { type: 'update_arc', data: { id: 'S', name: 'S renamed' } }, missing], false);
            expect(response.status).toBe(207);
            expect(response.body.success).toBe(false);
            const steps = results(response);
            expect(steps.map((step) => step.success)).toEqual([true, false, false]);
            expect(steps[2].error).toMatch(/nosuch/);
            expect(await expectConsistent(graphId)).toEqual(before);
          });
        }
      });

      describe('MEDIUM 4: an arc batch that skips an item names it', () => {
        const arcsOf = (extra: Array<Record<string, unknown>>) => [{ name: 'Good1', start_time: iso(1801), end_time: iso(1802), level: 0 }, ...extra];

        it('onError skip: the skipped arc is in failed with its own error, the others are not applied', async () => {
          const graphId = await graphOf(kind, tree);
          const before = await expectConsistent(graphId);
          const response = await asKey(request(app).post('/api/batch/arcs'), graphId).send({ graphId, onError: 'skip', validation: 'skip', arcs: arcsOf([{ start_time: iso(1801), end_time: iso(1802), level: 0 }]) });
          expect(response.status).toBe(207);
          expect(response.body.created).toEqual([]);
          const failed = response.body.failed as Array<{ index: number; error: string }>;
          expect(failed.find((entry) => entry.index === 1)?.error).toMatch(/name|required|Arc validation/i);
          expect(failed.find((entry) => entry.index === 0)?.error).toMatch(/not applied: another arc step in this batch failed/);
          expect(await expectConsistent(graphId)).toEqual(before);
        });

        it('names it even when it was the only arc', async () => {
          const graphId = await graphOf(kind, tree);
          const response = await asKey(request(app).post('/api/batch/arcs'), graphId).send({ graphId, onError: 'skip', validation: 'skip', arcs: [{ start_time: iso(1801), end_time: iso(1802), level: 0 }] });
          expect(response.status).toBe(207);
          expect(response.body.failed).toHaveLength(1);
          expect(response.body.failed[0].index).toBe(0);
          expect(response.body.success).toBe(false);
        });

        it('names an arc that lenient validation left out', async () => {
          const graphId = await graphOf(kind, tree);
          const response = await asKey(request(app).post('/api/batch/arcs'), graphId).send({ graphId, validation: 'lenient', arcs: arcsOf([{ name: 'Bad', start_time: iso(1805), end_time: iso(1802), level: 0 }]) });
          expect(response.status).toBe(207);
          expect(response.body.failed.map((entry: { index: number }) => entry.index).sort()).toEqual([0, 1]);
          expect(response.body.created).toEqual([]);
        });
      });

      describe('LOW: an event put into an arc that is then not applied', () => {
        it('no longer names the arc, and the step says so; the head agrees', async () => {
          const graphId = await graphOf(kind, tree);
          const response = await transaction(graphId, [{ type: 'create_arc', data: { id: 'N', name: 'N', start_time: iso(1801), end_time: iso(1802), level: 0 } }, eventIn('E4', 'N'), failing], false);
          expect(response.status).toBe(207);
          const event = results(response).find((step) => step.type === 'create_event')!;
          expect(event.success).toBe(true);
          expect(event.warning).toMatch(/its arc was not applied/);
          expect(await liveEvents(graphId)).toEqual({ E4: {} });
          expect(await headEvents(graphId)).toEqual({ E4: {} });
          await expectConsistent(graphId);
        });
      });

      describe('MUTANTS: what the first two rounds left unchecked', () => {
        it('M12: what the undo could not give back is versioned, so the head and the live store agree', async () => {
          const graphId = await graphOf(kind, tree);
          await transaction(graphId, [eventIn('E3', 'P')]).expect(200);
          const real = EventRepository.prototype.update;
          let calls = 0;
          vi.spyOn(EventRepository.prototype, 'update').mockImplementation(function (this: EventRepository, ...args: Parameters<typeof real>) {
            calls += 1;
            return calls === 2 ? Promise.reject(new Error('store down')) : real.apply(this, args);
          });
          await transaction(graphId, [{ type: 'delete_arc', data: { id: 'P' } }, failing], false);
          vi.restoreAllMocks();
          const live = await liveEvents(graphId);
          expect(live.E3.arcId).toBeUndefined();
          expect((await headEvents(graphId)).E3.arcId).toBeUndefined();
        });

        it('M16: the CLI importer writes the subtree a partial document moves with an arc', async () => {
          const graphId = await graphOf(kind, tree);
          const document = { metadata: {}, data: { events: [], causalRelationships: [], arcs: [{ id: 'P', name: 'P', description: 'P', start_time: iso(1800), end_time: iso(1900), level: 0, parent_arc_id: null, metadata: {} }] } };
          await new GraphImporter().import(JSON.stringify(document), container as never, { strategy: 'overwrite', graphId });
          expect(await expectConsistent(graphId)).toMatchObject({ P: [0, null], C: [1, 'P'], D: [2, 'C'] });
        });

        it('M19: a non-atomic transaction whose arc step failed reports success false', async () => {
          const graphId = await graphOf(kind, tree);
          const response = await transaction(graphId, [{ type: 'update_arc', data: { id: 'S', name: 'S renamed' } }, failing], false);
          expect(response.status).toBe(207);
          expect(response.body.success).toBe(false);
        });

        it('M13: importing an arc that no longer holds its existing children is flagged', async () => {
          const target = await graphOf(kind, tree);
          const service = new ImportService({ dataDir: testDataDir });
          const shrunk = { id: 'P', name: 'P', description: 'P', start_time: iso(1860), end_time: iso(1900), level: 1, parent_arc_id: 'G', metadata: {} };
          const conflicts = await service.detectConflicts({ metadata: {}, data: { arcs: [shrunk], events: [], causalRelationships: [] } } as never, target, 'merge');
          expect(conflicts.filter((conflict) => conflict.type === 'temporal-violation').map((conflict) => conflict.entityId)).toEqual(['P']);
          expect(conflicts.find((conflict) => conflict.type === 'temporal-violation')?.message).toMatch(/no longer contains its existing child arc "C"/);
        });
      });

      describe('LOW: rebuild reports reach the merge and import responses, and never a stale one', () => {
        async function legacyGraph(): Promise<string> {
          graphCount += 1;
          const graphId = (await container.graphService.createGraph({ name: `Report3 ${kind} ${graphCount}` })).id;
          await commitArcs(graphId, [arcSpec('G', 0, 1700, 1950), arcSpec('C', 1, 1960, 1970, 'G')]);
          return graphId;
        }

        it('M21: the merge response carries the report', async () => {
          const target = await legacyGraph();
          const source = await graphOf(kind, [arcSpec('Z', 0, 1000, 1100)]);
          const response = await asKey(request(app).post(`/api/graphs/${target}/merge`), target).send({ sourceGraphId: source, conflictResolution: 'keep-source' });
          expect(response.status).toBe(200);
          expect(response.body.rebuild.warnings).toHaveLength(1);
        });

        it('M22 and the stale report: the import response carries its own report, a refused import carries none', async () => {
          const target = await legacyGraph(); // its setup rebuild left a report nobody collected
          // The import router on this test's data directory, as the app mounts it.
          const importApp = express();
          importApp.use(express.json({ limit: '50mb' }));
          importApp.use(injectContainer);
          importApp.use('/api/import', createImportRouter({ dataDir: testDataDir, disableRateLimit: true, disableAuth: true, disableCsrf: true, onHeadReplaced: async (graphId, reason) => void (await container.liveStoreSyncService.materialize(graphId, reason)) }));
          importApp.use(errorHandler);
          const send = (data: unknown, conflictResolution: string) => request(importApp).post('/api/import').set('X-Graph-Id', target).send({ data, targetGraphId: target, mode: 'merge', conflictResolution });
          const exportOf = async (graphId: string) => (await container.exportService.exportGraph({ graphId, scope: 'full', includeProvenance: false })).export;
          // A document that fails its checksum is refused, and no stale report rides on the refusal.
          const tampered = JSON.parse(JSON.stringify(await exportOf(target))) as { data: { arcs: Array<Record<string, unknown>> } };
          tampered.data.arcs[0].name = 'Renamed in the document';
          const refused = await send(tampered, 'skip');
          expect(refused.status).toBe(400);
          expect(refused.body.rebuild).toBeUndefined();
          // An import that goes through reports what its own rebuild kept.
          const source = await graphOf(kind, [arcSpec('Z', 0, 1000, 1100)]);
          const accepted = await send(await exportOf(source), 'skip');
          expect(accepted.status).toBe(201);
          expect(accepted.body.rebuild.warnings).toHaveLength(1);
        });
      });
    });
  }
});
