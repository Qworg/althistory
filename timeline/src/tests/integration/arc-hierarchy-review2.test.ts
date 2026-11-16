/**
 * The second review of the arc hierarchy (issue 28), one test per finding. Every
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

type Kind = 'cli' | 'imported';
type ArcSpec = [id: string, level: number, start: string, end: string, parent?: string];
type Shape = Record<string, [number, string | null]>;

const iso = (year: number): string => `${year}-01-01T00:00:00.000Z`;
const arcSpec = (id: string, level: number, from: number, to: number, parent?: string): ArcSpec => [id, level, iso(from), iso(to), ...(parent ? [parent] : [])] as ArcSpec;

describe('the arc hierarchy, second review', () => {
  let app: Express;
  let container: Container;
  let testDataDir: string;
  let key: string;
  let graphCount = 0;

  beforeAll(async () => {
    testDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arc-hierarchy-review2-'));
    process.env.LOCAL_EXECUTION_ENABLED = 'true';
    process.env.LOCAL_DATA_DIR = testDataDir;
    process.env.LOCAL_GRAPH_FILE = 'arc-hierarchy-review2-graph.json';
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
  const put = (graphId: string, id: string, body: Record<string, unknown>): request.Test => asKey(request(app).put(`/api/arcs/${id}`), graphId).send(body);
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

  const results = (response: request.Response): Array<{ index: number; type: string; id?: string; success: boolean; error?: string }> => response.body.results ?? response.body.result?.results;
  const arcStepsOf = (response: request.Response) => results(response).filter((step) => /_arc$/.test(step.type));
  const NOT_APPLIED = /not applied: another arc step in this batch failed/;

  for (const kind of ['cli', 'imported'] as const) {
    describe(`${kind} arcs`, () => {
      describe('HIGH 2 and 3: the arc steps of a batch land or fail together', () => {
        // X has no name, so its creation fails at the store; the preflight cannot see that.
        const failingCreate = (level = 0, extra: Record<string, unknown> = {}) => ({ type: 'create_arc', data: { id: 'X', start_time: iso(1700), end_time: iso(1950), level, ...extra } });

        it('(a) a delete that lifted a child under a parent whose creation failed puts everything back', async () => {
          const graphId = await graphOf(kind, tree);
          const before = await expectConsistent(graphId);
          const event = { type: 'create_event', data: { description: 'Stands alone', actor: 'A', target: 'B', timestamp: iso(1850) } };
          const response = await transaction(graphId, [failingCreate(), { type: 'update_arc', data: { id: 'P', metadata: { parentArcId: 'X' } } }, { type: 'delete_arc', data: { id: 'P' } }, event], false);
          expect(response.status).toBe(207);
          const arcs = arcStepsOf(response);
          expect(arcs.map((step) => step.success)).toEqual([false, false, false]);
          expect(arcs[1].error).toMatch(NOT_APPLIED);
          expect(arcs[2].error).toMatch(NOT_APPLIED);
          // The step that is not an arc step keeps its own result.
          expect(results(response).find((step) => step.type === 'create_event')?.success).toBe(true);
          expect(await expectConsistent(graphId)).toEqual(before);
        });

        it('(c) a restored child never conflicts with a parent that shrank in a later step', async () => {
          const graphId = await graphOf(kind, tree.filter(([id]) => id !== 'D'));
          const before = await expectConsistent(graphId);
          const response = await transaction(
            graphId,
            [
              { type: 'create_arc', data: { id: 'X', start_time: iso(1825), end_time: iso(1890), level: 2, metadata: { parentArcId: 'P' } } },
              { type: 'update_arc', data: { id: 'C', start_time: iso(1830), metadata: { parentArcId: 'X' } } },
              { type: 'update_arc', data: { id: 'P', start_time: iso(1820) } },
            ],
            false
          );
          expect(response.status).toBe(207);
          expect(arcStepsOf(response).every((step) => !step.success)).toBe(true);
          expect(await expectConsistent(graphId)).toEqual(before);
        });

        it('(b) a chain of 30 creates whose first fails leaves none of them, however long the chain', async () => {
          const graphId = await graphOf(kind, tree);
          const before = await expectConsistent(graphId);
          const ops: unknown[] = [];
          for (let i = 0; i < 31; i += 1) {
            ops.push({ type: 'create_arc', data: { id: `A${i}`, name: i === 0 ? '' : `A${i}`, start_time: iso(1700), end_time: iso(1900), level: i + 1, metadata: { parentArcId: i === 0 ? 'G' : `A${i - 1}` } } });
          }
          const response = await transaction(graphId, ops, false);
          expect(response.status).toBe(207);
          expect(arcStepsOf(response).filter((step) => step.success)).toEqual([]);
          expect(await expectConsistent(graphId)).toEqual(before);
        });

        for (const onError of ['collect', 'skip'] as const) {
          it(`(b2) POST /api/batch/arcs with onError ${onError}: a chain whose first arc fails creates none`, async () => {
            const graphId = await graphOf(kind, tree);
            const before = await expectConsistent(graphId);
            const arcs: unknown[] = [];
            for (let i = 0; i < 31; i += 1) {
              arcs.push({ id: `A${i}`, name: i === 0 ? '' : `A${i}`, start_time: iso(1700), end_time: iso(1900), level: i + 1, metadata: { parentArcId: i === 0 ? 'G' : `A${i - 1}` } });
            }
            const response = await asKey(request(app).post('/api/batch/arcs'), graphId).send({ graphId, arcs, onError });
            expect(response.status).toBe(207);
            expect(response.body.created).toEqual([]);
            expect(response.body.success).toBe(false);
            expect(await expectConsistent(graphId)).toEqual(before);
          });
        }

        it('keeps a batch of arcs that all succeed', async () => {
          const graphId = await graphOf(kind, tree);
          const response = await transaction(
            graphId,
            [
              { type: 'create_arc', data: { id: 'N1', name: 'N1', start_time: iso(1805), end_time: iso(1860), level: 2, metadata: { parentArcId: 'P' } } },
              { type: 'update_arc', data: { id: 'S', name: 'S renamed' } },
            ],
            false
          );
          expect(response.status).toBe(200);
          expect((await expectConsistent(graphId)).N1).toEqual([2, 'P']);
        });
      });

      describe('MEDIUM 4: a create is judged against the parent as the batch ends', () => {
        it('passes whichever order a child is made and its parent widened', async () => {
          for (const childFirst of [true, false]) {
            const graphId = await graphOf(kind, tree);
            const create = { type: 'create_arc', data: { id: 'K', name: 'K', start_time: iso(1890), end_time: iso(1920), level: 2, metadata: { parentArcId: 'P' } } };
            const widen = { type: 'update_arc', data: { id: 'P', end_time: iso(1930) } };
            await transaction(graphId, childFirst ? [create, widen] : [widen, create]).expect(200);
            expect((await expectConsistent(graphId)).K).toEqual([2, 'P']);
          }
        });

        it('refuses it when the parent does not end up wide enough, whatever the order', async () => {
          for (const childFirst of [true, false]) {
            const graphId = await graphOf(kind, tree);
            const before = await expectConsistent(graphId);
            const create = { type: 'create_arc', data: { id: 'K', name: 'K', start_time: iso(1890), end_time: iso(1920), level: 2, metadata: { parentArcId: 'P' } } };
            const narrow = { type: 'update_arc', data: { id: 'P', end_time: iso(1895) } };
            await transaction(graphId, childFirst ? [create, narrow] : [narrow, create]).expect(400);
            expect(await expectConsistent(graphId)).toEqual(before);
          }
        });
      });

      describe('MEDIUM 5: a plain edit of an arc stored before the rule is not refused', () => {
        it('renames and re-describes an arc outside its parent, and one with a stale metadata parent', async () => {
          graphCount += 1;
          const graphId = (await container.graphService.createGraph({ name: `Old ${kind} ${graphCount}` })).id;
          // C lies outside P; R's metadata names X (which it lies outside) while its head parent is P.
          await commitArcs(graphId, [arcSpec('G', 0, 1700, 1950), arcSpec('P', 1, 1800, 1900, 'G'), arcSpec('X', 1, 1920, 1940, 'G'), arcSpec('C', 2, 1960, 1970, 'P'), arcSpec('R', 2, 1810, 1820, 'P')], {
            C: { metadata: { parentArcId: 'P' } },
            R: { metadata: { parentArcId: 'X' } },
          });
          await put(graphId, 'C', { name: 'C renamed' }).expect(200);
          await put(graphId, 'C', { description: 'described' }).expect(200);
          await put(graphId, 'R', { name: 'R renamed' }).expect(200);
          await transaction(graphId, [{ type: 'update_arc', data: { id: 'C', name: 'C again' } }, { type: 'update_arc', data: { id: 'R', description: 'again' } }]).expect(200);
          const { arcRepository } = await container.graphScopedRepositories(graphId);
          expect((await arcRepository.findById('C'))?.name).toBe('C again');
          expect((await arcRepository.findById('R'))?.description).toBe('again');
          // Moving its dates is still judged.
          await put(graphId, 'C', { end_time: iso(1980) }).expect(400);
        });
      });

      describe('MEDIUM 7: importing into an existing graph judges an arc against its own parent', () => {
        it('flags an incoming arc outside its parent, and none for an overlap across branches', async () => {
          const target = await graphOf(kind, [arcSpec('G', 0, 1700, 1950), arcSpec('P', 1, 1800, 1900, 'G')]);
          const service = new ImportService({ dataDir: testDataDir });
          const incoming = (arcs: unknown[]) => ({ metadata: {}, data: { arcs, events: [], causalRelationships: [] } }) as never;
          const arc = (id: string, level: number, from: number, to: number, parent: string | null) => ({ id, name: id, description: id, start_time: iso(from), end_time: iso(to), level, parent_arc_id: parent, metadata: {} });
          // A root that overlaps P without containing it: an API write allows it.
          await post(target, { name: 'R0', start_time: iso(1850), end_time: iso(1960), level: 0 }).expect(201);
          expect(await service.detectConflicts(incoming([arc('R', 0, 1850, 1960, null)]), target, 'merge')).toEqual([]);
          // A child at the level of P that overlaps it is fine too.
          expect(await service.detectConflicts(incoming([arc('K', 1, 1850, 1920, 'G')]), target, 'merge')).toEqual([]);
          // A child outside its (existing) parent is a conflict.
          const outside = await service.detectConflicts(incoming([arc('O', 2, 1890, 1920, 'P')]), target, 'merge');
          expect(outside.map((conflict) => `${conflict.type}:${conflict.entityId}`)).toEqual(['temporal-violation:O']);
          // A child inside an incoming parent is judged against it, not against the arcs it overlaps.
          expect(await service.detectConflicts(incoming([arc('N', 1, 1750, 1790, 'G'), arc('Nc', 2, 1760, 1770, 'N')]), target, 'merge')).toEqual([]);
        });
      });

      describe('MEDIUM 6: the doors that bypass the routes obey the hierarchy', () => {
        it('the CLI importer refuses an overwrite that moves an arc outside its parent, and writes nothing', async () => {
          const graphId = await graphOf(kind, tree);
          const before = await expectConsistent(graphId);
          const document = await container.exportService.exportGraph({ graphId, scope: 'full', includeProvenance: false });
          const edited = JSON.parse(JSON.stringify(document.export)) as { data: { arcs: Array<Record<string, unknown>> } };
          for (const arc of edited.data.arcs) if (arc.id === 'C') Object.assign(arc, { start_time: iso(1960), end_time: iso(1970), name: 'C moved' });
          await expect(new GraphImporter().import(JSON.stringify(edited), container as never, { strategy: 'overwrite', graphId })).rejects.toThrow(/Import refused.*must lie within its parent "P"/);
          expect(await expectConsistent(graphId)).toEqual(before);
        });

        it('the CLI importer moves a subtree the way the routes do, and the head agrees', async () => {
          const graphId = await graphOf(kind, tree);
          const document = await container.exportService.exportGraph({ graphId, scope: 'full', includeProvenance: false });
          const edited = JSON.parse(JSON.stringify(document.export)) as { data: { arcs: Array<Record<string, unknown>> } };
          // P goes to the top, and its subtree with it.
          // (A document is an end state: it says the whole subtree's levels.)
          const moved: Record<string, Record<string, unknown>> = { P: { level: 0, parent_arc_id: null, metadata: {} }, C: { level: 1 }, D: { level: 2 } };
          for (const arc of edited.data.arcs) Object.assign(arc, moved[arc.id as string] ?? {});
          await new GraphImporter().import(JSON.stringify(edited), container as never, { strategy: 'overwrite', graphId });
          expect(await expectConsistent(graphId)).toMatchObject({ P: [0, null], C: [1, 'P'], D: [2, 'C'] });
        });
      });

      describe('LOW: M9, the rebuild keeps an arc whose recorded parent it lies outside', () => {
        it('materializes a head arc whose metadata.parentArcId names a parent that does not contain it', async () => {
          graphCount += 1;
          const graphId = (await container.graphService.createGraph({ name: `M9 ${kind} ${graphCount}` })).id;
          await commitArcs(graphId, [arcSpec('G', 0, 1700, 1950), arcSpec('P', 1, 1800, 1900, 'G'), arcSpec('C', 2, 1960, 1970, 'P')], { C: { metadata: { parentArcId: 'P' } } });
          const rebuilt = await container.liveStoreSyncService.materialize(graphId, 'rollback');
          expect(rebuilt.skipped).toEqual([]);
          expect(rebuilt.warnings).toHaveLength(1);
          expect(Object.keys(await live(graphId)).sort()).toEqual(['C', 'G', 'P']);
        });
      });

      describe('MEDIUM 8: a rebuild reports what it kept or could not write to the response', () => {
        it('names the arcs in the rollback response', async () => {
          graphCount += 1;
          const graphId = (await container.graphService.createGraph({ name: `Report ${kind} ${graphCount}` })).id;
          await commitArcs(graphId, [arcSpec('G', 0, 1700, 1950), arcSpec('C', 1, 1960, 1970, 'G')]);
          const response = await asKey(request(app).post(`/api/graphs/${graphId}/rollback/${(await container.graphRepository.getLatestVersion(graphId))!.version}`), graphId).expect(200);
          expect(response.body.rebuild.skipped).toEqual([]);
          expect(response.body.rebuild.warnings).toHaveLength(1);
          expect(response.body.rebuild.warnings[0]).toMatch(/"C".*outside its parent "G"/);
          // A whole graph says nothing.
          const whole = await graphOf(kind, tree);
          const clean = await asKey(request(app).post(`/api/graphs/${whole}/rollback/${(await container.graphRepository.getLatestVersion(whole))!.version}`), whole).expect(200);
          expect(clean.body.rebuild).toBeUndefined();
        });
      });
    });
  }
});
