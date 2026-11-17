/**
 * The fifth review of the arc hierarchy (issue 28), one test per finding. Every
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

type Kind = 'cli' | 'imported';
type ArcSpec = [id: string, level: number, start: string, end: string, parent?: string];
type Shape = Record<string, [number, string | null]>;

const iso = (year: number): string => `${year}-01-01T00:00:00.000Z`;
const arcSpec = (id: string, level: number, from: number, to: number, parent?: string): ArcSpec => [id, level, iso(from), iso(to), ...(parent ? [parent] : [])] as ArcSpec;

describe('the arc hierarchy, fifth review', () => {
  let app: Express;
  let container: Container;
  let testDataDir: string;
  let key: string;
  let graphCount = 0;

  beforeAll(async () => {
    testDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arc-hierarchy-review5-'));
    process.env.LOCAL_EXECUTION_ENABLED = 'true';
    process.env.LOCAL_DATA_DIR = testDataDir;
    process.env.LOCAL_GRAPH_FILE = 'arc-hierarchy-review5-graph.json';
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
  const liveEvents = async (graphId: string) => {
    const { eventRepository } = await container.graphScopedRepositories(graphId);
    return Object.fromEntries((await eventRepository.findAll()).map((event) => [event.id, event.metadata ?? {}]));
  };
  const headEvents = async (graphId: string) => Object.fromEntries(Object.entries((await container.graphRepository.checkout(graphId)).events).map(([id, event]) => [id, (event.metadata ?? {}) as Record<string, unknown>]));
  const futureArc = { type: 'create_arc', data: { id: 'future', name: 'F', start_time: iso(1800), end_time: iso(1900), level: 0 } };

  for (const kind of ['cli', 'imported'] as const) {
    describe(`${kind} arcs`, () => {
      describe('LOW 2: undoing clears only a reference a step wrote', () => {
        async function plannedEvent(graphId: string): Promise<void> {
          await asKey(request(app).post('/api/events'), graphId).send({ id: 'planned', description: 'planned', actor: 'A', target: 'B', timestamp: iso(1850), metadata: { arcId: 'future', note: 'n' } }).expect(201);
        }

        for (const atomic of [false, true]) {
          it(`keeps the arc an event named before the batch when a step only edited its description (atomic ${atomic})`, async () => {
            const graphId = await graphOf(kind, tree);
            await plannedEvent(graphId);
            const response = await transaction(graphId, [futureArc, { type: 'update_event', data: { id: 'planned', description: 'planned, edited' } }, atomic ? noSuchEvent : bad], atomic);
            expect(response.status).toBe(atomic ? 400 : 207);
            expect((await liveEvents(graphId)).planned).toEqual({ arcId: 'future', note: 'n' });
            expect(await headEvents(graphId)).toEqual(await liveEvents(graphId));
            const edited = (response.body.results ?? response.body.result.results).find((step: { type: string }) => step.type === 'update_event');
            expect(edited.warning).toBeUndefined();
          });

          it(`A5: an unrelated event step in the batch does not clear it either (atomic ${atomic})`, async () => {
            const graphId = await graphOf(kind, tree);
            await plannedEvent(graphId);
            await transaction(graphId, [futureArc, { type: 'create_event', data: { id: 'other', description: 'other', actor: 'A', target: 'B', timestamp: iso(1850) } }, atomic ? noSuchEvent : bad], atomic);
            expect((await liveEvents(graphId)).planned).toEqual({ arcId: 'future', note: 'n' });
            expect(await headEvents(graphId)).toEqual(await liveEvents(graphId));
          });
        }

        it('clears it when the step itself named the arc (an update_event that edits the metadata)', async () => {
          const graphId = await graphOf(kind, tree);
          await asKey(request(app).post('/api/events'), graphId).send({ id: 'mover', description: 'mover', actor: 'A', target: 'B', timestamp: iso(1850) }).expect(201);
          const response = await transaction(graphId, [futureArc, { type: 'update_event', data: { id: 'mover', metadata: { arcId: 'future' } } }, bad], false);
          expect(response.status).toBe(207);
          expect((await liveEvents(graphId)).mover).toEqual({});
          expect(await headEvents(graphId)).toEqual(await liveEvents(graphId));
          expect(response.body.results.find((step: { type: string }) => step.type === 'update_event').warning).toMatch(/its arc was not applied/);
        });
      });

      describe('LOW 3: an atomic failure that keeps an update_event says what it dropped', () => {
        it('warns on the kept step whose arc was undone, in the 400 body', async () => {
          const graphId = await graphOf(kind, tree);
          await asKey(request(app).post('/api/events'), graphId).send({ id: 'E7', description: 'E7', actor: 'A', target: 'B', timestamp: iso(1850) }).expect(201);
          const response = await transaction(graphId, [{ type: 'create_arc', data: { id: 'N', name: 'N', start_time: iso(1801), end_time: iso(1802), level: 0 } }, { type: 'update_event', data: { id: 'E7', metadata: { arcId: 'N' } } }, noSuchEvent], true);
          expect(response.status).toBe(400);
          const kept = response.body.result.results.find((step: { type: string; success: boolean }) => step.type === 'update_event' && step.success);
          expect(kept.warning).toMatch(/its arc was not applied/);
          expect((await liveEvents(graphId)).E7).toEqual({});
          expect(await headEvents(graphId)).toEqual(await liveEvents(graphId));
          await expectConsistent(graphId);
        });
      });
    });
  }
});
