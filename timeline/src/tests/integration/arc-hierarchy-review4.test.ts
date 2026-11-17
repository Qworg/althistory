/**
 * The fourth review of the arc hierarchy (issue 28), one test per finding. Every
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
import { ArcHierarchyService } from '@/services/ArcHierarchyService';
import { ArcRepository } from '@/repositories/ArcRepository';

type Kind = 'cli' | 'imported';
type ArcSpec = [id: string, level: number, start: string, end: string, parent?: string];
type Shape = Record<string, [number, string | null]>;

const iso = (year: number): string => `${year}-01-01T00:00:00.000Z`;
const arcSpec = (id: string, level: number, from: number, to: number, parent?: string): ArcSpec => [id, level, iso(from), iso(to), ...(parent ? [parent] : [])] as ArcSpec;

describe('the arc hierarchy, fourth review', () => {
  let app: Express;
  let container: Container;
  let testDataDir: string;
  let key: string;
  let graphCount = 0;

  beforeAll(async () => {
    testDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arc-hierarchy-review4-'));
    process.env.LOCAL_EXECUTION_ENABLED = 'true';
    process.env.LOCAL_DATA_DIR = testDataDir;
    process.env.LOCAL_GRAPH_FILE = 'arc-hierarchy-review4-graph.json';
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

  const bad = { type: 'create_arc', data: { id: 'BAD', start_time: iso(1700), end_time: iso(1950), level: 0 } }; // no name: the store refuses it
  const noSuchEvent = { type: 'update_event', data: { id: 'nosuch', description: 'x' } };
  const eventIn = (id: string, arcId: string, extra: Record<string, unknown> = {}) => ({ type: 'create_event', data: { id, description: id, actor: 'A', target: 'B', timestamp: iso(1850), metadata: { arcId, ...extra } } });
  const liveEvents = async (graphId: string) => {
    const { eventRepository } = await container.graphScopedRepositories(graphId);
    return Object.fromEntries((await eventRepository.findAll()).map((event) => [event.id, event.metadata ?? {}]));
  };
  const headEvents = async (graphId: string) => Object.fromEntries(Object.entries((await container.graphRepository.checkout(graphId)).events).map(([id, event]) => [id, (event.metadata ?? {}) as Record<string, unknown>]));

  for (const kind of ['cli', 'imported'] as const) {
    describe(`${kind} arcs`, () => {
      describe('HIGH 1: an arc deleted and made again in one batch', () => {
        for (const atomic of [true, false]) {
          it(`is refused before anything is written (atomic ${atomic}), so a failing step cannot lose the arc`, async () => {
            const graphId = await graphOf(kind, tree);
            await transaction(graphId, [eventIn('E1', 'P'), eventIn('E2', 'P')]).expect(200);
            const before = await expectConsistent(graphId);
            const arcsBefore = (await container.graphRepository.checkout(graphId)).arcs;
            const response = await transaction(
              graphId,
              [
                { type: 'delete_arc', data: { id: 'P' } },
                { type: 'create_arc', data: { id: 'P', name: 'P recreated', start_time: iso(1800), end_time: iso(1900), level: 1, parent_arc_id: 'G' } },
                atomic ? noSuchEvent : bad,
              ],
              atomic
            );
            expect(response.status).toBe(400);
            expect(JSON.stringify(response.body)).toContain('"P\\"');
            expect(await expectConsistent(graphId)).toEqual(before);
            expect((await container.graphRepository.checkout(graphId)).arcs).toEqual(arcsBefore);
            expect(await liveEvents(graphId)).toEqual({ E1: { arcId: 'P' }, E2: { arcId: 'P' } });
            expect(await headEvents(graphId)).toEqual({ E1: { arcId: 'P' }, E2: { arcId: 'P' } });
          });
        }

        it('is refused for a create of an id an earlier step touched, whatever the step', async () => {
          const graphId = await graphOf(kind, tree);
          const before = await expectConsistent(graphId);
          const make = (id: string) => ({ type: 'create_arc', data: { id, name: id, start_time: iso(1801), end_time: iso(1802), level: 0 } });
          await transaction(graphId, [{ type: 'update_arc', data: { id: 'S', name: 'S renamed' } }, make('S')]).expect(400);
          await transaction(graphId, [make('N'), make('N')]).expect(400);
          await asKey(request(app).post('/api/batch/arcs'), graphId).send({ graphId, arcs: [make('N').data, make('N').data] }).expect(400);
          expect(await expectConsistent(graphId)).toEqual(before);
        });

        it('defence in depth: a create never overwrites the before-image of an arc the session deleted', async () => {
          const graphId = await graphOf(kind, tree);
          const before = await expectConsistent(graphId);
          const scoped = await container.graphScopedRepositories(graphId);
          const session = new ArcHierarchyService(container.graphWriteVersioningService).open(graphId, scoped);
          await session.preflight([{ kind: 'delete', id: 'P' }]);
          expect(await session.delete('P')).toBe(true);
          // Past the preflight, as a caller that skipped it would: the same id made again.
          await session.create({ id: 'P', name: 'P again', start_time: new Date(iso(1800)), end_time: new Date(iso(1900)), level: 1 });
          await session.undo();
          expect((await scoped.arcRepository.findById('P'))?.name).toBe('P');
          expect(await expectConsistent(graphId)).toEqual(before);
        });
      });

      describe('MEDIUM 2: undoing clears only the references the batch made', () => {
        it('leaves an event that named the arc id before the batch, whichever kind of batch', async () => {
          for (const atomic of [false, true]) {
            const graphId = await graphOf(kind, [arcSpec('G', 0, 1700, 1950)]);
            // Planned before its arc exists.
            await asKey(request(app).post('/api/events'), graphId).send({ id: 'planned', description: 'planned', actor: 'A', target: 'B', timestamp: iso(1850), metadata: { arcId: 'future-arc' } }).expect(201);
            const planned = (await liveEvents(graphId)).planned;
            const response = await transaction(graphId, [{ type: 'create_arc', data: { id: 'future-arc', name: 'F', start_time: iso(1800), end_time: iso(1900), level: 0 } }, atomic ? noSuchEvent : bad], atomic);
            expect(response.status).toBe(atomic ? 400 : 207);
            expect((await liveEvents(graphId)).planned).toEqual(planned);
            expect(await headEvents(graphId)).toEqual(await liveEvents(graphId));
            expect((await liveEvents(graphId)).planned.arcId).toBe('future-arc');
          }
        });

        it('N5: an event the batch pointed at an arc that an atomic failure removed is cleared in the head too', async () => {
          const graphId = await graphOf(kind, tree);
          await transaction(graphId, [{ type: 'create_event', data: { id: 'E7', description: 'E7', actor: 'A', target: 'B', timestamp: iso(1850) } }]).expect(200);
          const response = await transaction(graphId, [{ type: 'create_arc', data: { id: 'N', name: 'N', start_time: iso(1801), end_time: iso(1802), level: 0 } }, { type: 'update_event', data: { id: 'E7', metadata: { arcId: 'N' } } }, noSuchEvent], true);
          expect(response.status).toBe(400);
          expect((await liveEvents(graphId)).E7.arcId).toBeUndefined();
          expect(await headEvents(graphId)).toEqual(await liveEvents(graphId));
          await expectConsistent(graphId);
        });
      });

      describe('MUTANTS: the snake_case arc reference', () => {
        it('N16: an event that named its arc as arc_id gets it back, with its other keys', async () => {
          const graphId = await graphOf(kind, tree);
          await transaction(graphId, [{ type: 'create_event', data: { id: 'Z', description: 'Z', actor: 'A', target: 'B', timestamp: iso(1850), metadata: { arc_id: 'P', note: 'snake' } } }]).expect(200);
          await transaction(graphId, [{ type: 'delete_arc', data: { id: 'P' } }, bad], false);
          expect((await liveEvents(graphId)).Z).toEqual({ arc_id: 'P', note: 'snake' });
          expect(await headEvents(graphId)).toEqual(await liveEvents(graphId));
        });

        it('N17: an arc_id a later step set is not overwritten by the undo', async () => {
          const graphId = await graphOf(kind, tree);
          await transaction(graphId, [{ type: 'create_event', data: { id: 'Z', description: 'Z', actor: 'A', target: 'B', timestamp: iso(1850), metadata: { arcId: 'P' } } }]).expect(200);
          await transaction(graphId, [{ type: 'delete_arc', data: { id: 'P' } }, { type: 'update_event', data: { id: 'Z', metadata: { arc_id: 'S' } } }, bad], false);
          expect((await liveEvents(graphId)).Z).toEqual({ arc_id: 'S' });
          expect(await headEvents(graphId)).toEqual({ Z: { arc_id: 'S' } });
        });
      });

      describe('LOW 3: a create with an id does not read the graph', () => {
        it('POST /api/arcs, /api/batch/arcs and a transaction create read no arc list for a parentless create', async () => {
          const graphId = await graphOf(kind, tree);
          const findAll = vi.spyOn(ArcRepository.prototype, 'findAll');
          await post(graphId, { id: 'N1', name: 'N1', start_time: iso(1801), end_time: iso(1802), level: 0 }).expect(201);
          await asKey(request(app).post('/api/batch/arcs'), graphId).send({ graphId, arcs: [{ id: 'N2', name: 'N2', start_time: iso(1801), end_time: iso(1802), level: 0 }] }).expect(201);
          await transaction(graphId, [{ type: 'create_arc', data: { id: 'N3', name: 'N3', start_time: iso(1801), end_time: iso(1802), level: 0 } }]).expect(200);
          expect(findAll).not.toHaveBeenCalled();
        });
      });
    });
  }
});
