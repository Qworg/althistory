/**
 * The first review of the arc hierarchy (issue 28), one test per finding. Every
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
import { ArcRepository } from '@/repositories/ArcRepository';
import type { ChangeRecord } from '@/services/ChangeFeedService';

type Kind = 'cli' | 'imported';
type ArcSpec = [id: string, level: number, start: string, end: string, parent?: string];
type Shape = Record<string, [number, string | null]>;

const iso = (year: number): string => `${year}-01-01T00:00:00.000Z`;
const arcSpec = (id: string, level: number, from: number, to: number, parent?: string): ArcSpec => [id, level, iso(from), iso(to), ...(parent ? [parent] : [])] as ArcSpec;

describe('the arc hierarchy, first review', () => {
  let app: Express;
  let container: Container;
  let testDataDir: string;
  let key: string;
  let graphCount = 0;

  beforeAll(async () => {
    testDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arc-hierarchy-review-'));
    process.env.LOCAL_EXECUTION_ENABLED = 'true';
    process.env.LOCAL_DATA_DIR = testDataDir;
    process.env.LOCAL_GRAPH_FILE = 'arc-hierarchy-review-graph.json';
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
  const del = (graphId: string, id: string): request.Test => asKey(request(app).delete(`/api/arcs/${id}`), graphId);

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

  const versionCount = async (graphId: string): Promise<number> => (await container.graphRepository.getVersionHistory(graphId)).total;

  // G (0) > P (1) > C (2) > D (3), and a sibling S (1) under G.
  const tree: ArcSpec[] = [arcSpec('G', 0, 1700, 1950), arcSpec('P', 1, 1800, 1900, 'G'), arcSpec('C', 2, 1810, 1850, 'P'), arcSpec('D', 3, 1812, 1820, 'C'), arcSpec('S', 1, 1790, 1940, 'G')];

  for (const kind of ['cli', 'imported'] as const) {
    describe(`${kind} arcs`, () => {
      describe('HIGH 1: the temporal rule is parent-based', () => {
        const overlapping = [
          arcSpec('G', 0, 1700, 1950),
          arcSpec('P', 1, 1800, 1900, 'G'),
          arcSpec('Q', 1, 1805, 1835, 'G'),
          arcSpec('C', 2, 1810, 1830, 'P'),
          arcSpec('Qc', 2, 1825, 1834, 'Q'),
        ];

        it('lifts a child next to a branch it overlaps, and nothing is stranded', async () => {
          const graphId = await graphOf(kind, overlapping);
          await del(graphId, 'P').expect(200);
          expect(await expectConsistent(graphId)).toEqual({ G: [0, null], Q: [1, 'G'], C: [1, 'G'], Qc: [2, 'Q'] });
          // Both lifted and unlifted arcs still take edits.
          await put(graphId, 'C', { name: 'C renamed' }).expect(200);
          await put(graphId, 'Qc', { name: 'Qc renamed' }).expect(200);
          await expectConsistent(graphId);
        });

        it('moves a subtree next to a branch it overlaps', async () => {
          const graphId = await graphOf(kind, [
            arcSpec('G', 0, 1700, 1950),
            arcSpec('P', 1, 1800, 1900, 'G'),
            arcSpec('K', 2, 1805, 1835, 'P'),
            arcSpec('Kc', 3, 1812, 1817, 'K'),
            arcSpec('C', 2, 1810, 1830, 'P'),
            arcSpec('D', 3, 1815, 1820, 'C'),
          ]);
          await put(graphId, 'C', { metadata: { parentArcId: 'K' } }).expect(200);
          expect(await expectConsistent(graphId)).toMatchObject({ C: [3, 'K'], D: [4, 'C'], Kc: [3, 'K'] });
          await put(graphId, 'D', { name: 'D renamed' }).expect(200);
        });

        it('lets arcs of different branches overlap at any level, by POST', async () => {
          const graphId = await graphOf(kind, tree);
          // Inside P's span and overlapping C and D without containing them; under S.
          await post(graphId, { name: 'Overlap', start_time: iso(1805), end_time: iso(1860), level: 2, parent_arc_id: 'S' }).expect(201);
          await expectConsistent(graphId);
        });

        it('refuses a move that would put an arc outside its new parent\'s span, saying so', async () => {
          const graphId = await graphOf(kind, [...tree, arcSpec('T', 1, 1930, 1945, 'G')]);
          const before = await expectConsistent(graphId);
          const response = await put(graphId, 'C', { metadata: { parentArcId: 'T' } }).expect(400);
          expect(response.body.error.message).toMatch(/Arc "C".*must lie within its parent "T"/);
          expect(await expectConsistent(graphId)).toEqual(before);
        });

        it('answers 400, never 500, for a span that leaves its parent', async () => {
          const graphId = await graphOf(kind, tree);
          await put(graphId, 'C', { end_time: iso(1950) }).expect(400);
          await post(graphId, { name: 'Out', start_time: iso(1850), end_time: iso(1960), level: 1, parent_arc_id: 'G' }).expect(400);
          // A parent that shrinks inside its child.
          await put(graphId, 'P', { end_time: iso(1815) }).expect(400);
          await expectConsistent(graphId);
        });

        it('refuses a delete whose lifted child would not fit its new parent, naming the child', async () => {
          // Stored before the rule: C lies outside G, its grandparent.
          graphCount += 1;
          const graphId = (await container.graphService.createGraph({ name: `Legacy ${kind} ${graphCount}` })).id;
          await commitArcs(graphId, [arcSpec('G', 0, 1700, 1950), arcSpec('P', 1, 1800, 1900, 'G'), arcSpec('C', 2, 1960, 1970, 'P')]);
          // The rebuild keeps it (no data lost) and says so.
          const rebuilt = await container.liveStoreSyncService.materialize(graphId, 'rollback');
          expect(rebuilt.skipped).toEqual([]);
          expect(rebuilt.warnings).toHaveLength(1);
          expect(Object.keys(await live(graphId)).sort()).toEqual(['C', 'G', 'P']);
          const versions = await versionCount(graphId);
          const response = await del(graphId, 'P').expect(400);
          expect(response.body.error.message).toMatch(/Arc "C".*must lie within its parent "G"/);
          expect(Object.keys(await live(graphId)).sort()).toEqual(['C', 'G', 'P']);
          expect(await versionCount(graphId)).toBe(versions);
          await transaction(graphId, [{ type: 'delete_arc', data: { id: 'P' } }]).expect(400);
        });

        it('says so on the live feed when a rebuild keeps or cannot write something', async () => {
          graphCount += 1;
          const graphId = (await container.graphService.createGraph({ name: `Feed ${kind} ${graphCount}` })).id;
          await commitArcs(graphId, [arcSpec('G', 0, 1700, 1950), arcSpec('C', 1, 1960, 1970, 'G')]);
          const heard: ChangeRecord[] = [];
          const stop = container.changeFeedService.subscribe((record) => {
            if (record.graphId === graphId) heard.push(record);
          });
          try {
            await container.liveStoreSyncService.materialize(graphId, 'rollback');
          } finally {
            stop();
          }
          expect(heard.map((record) => record as unknown as { warnings?: number })[0].warnings).toBe(1);
        });
      });

      describe('HIGH 2: a step that fails after the preflight leaves nothing behind', () => {
        const badStep = { type: 'create_relationship', data: { cause_event_id: 'nope1', effect_event_id: 'nope2' } };

        it('an atomic transaction restores the arcs it moved when it fails', async () => {
          const graphId = await graphOf(kind, tree);
          const before = await expectConsistent(graphId);
          const liveBefore = await live(graphId);
          const headBefore = await container.graphRepository.checkout(graphId);
          const response = await transaction(graphId, [
            { type: 'create_arc', data: { id: 'NP', name: 'NP', start_time: iso(1805), end_time: iso(1860), level: 1, metadata: { parentArcId: 'G' } } },
            { type: 'update_arc', data: { id: 'C', metadata: { parentArcId: 'NP' } } },
            { type: 'delete_arc', data: { id: 'S' } },
            badStep,
          ]).expect(400);
          expect(response.body.result.rollbackPerformed).toBe(true);
          expect(await live(graphId)).toEqual(liveBefore);
          expect(await expectConsistent(graphId)).toEqual(before);
          expect((await container.graphRepository.checkout(graphId)).arcs).toEqual(headBefore.arcs);
        });

        it('an atomic transaction that deleted a parent puts it, and its children, back', async () => {
          const graphId = await graphOf(kind, tree);
          const before = await expectConsistent(graphId);
          await transaction(graphId, [{ type: 'delete_arc', data: { id: 'P' } }, badStep]).expect(400);
          expect(await expectConsistent(graphId)).toEqual(before);
        });

        it('a non-atomic transaction never leaves an arc under a parent that failed to be made', async () => {
          const graphId = await graphOf(kind, tree);
          const before = await expectConsistent(graphId);
          // The parent's name is empty, so its creation fails; the preflight cannot see that.
          const response = await transaction(
            graphId,
            [
              { type: 'create_arc', data: { id: 'NP', name: '', start_time: iso(1800), end_time: iso(1900), level: 1, metadata: { parentArcId: 'G' } } },
              { type: 'update_arc', data: { id: 'C', level: 2, metadata: { parentArcId: 'NP' } } },
            ],
            false
          );
          expect(response.status).toBe(207);
          expect(response.body.results.map((step: { success: boolean }) => step.success)).toEqual([false, false]);
          expect(await expectConsistent(graphId)).toEqual(before);
        });

        it('a non-atomic transaction keeps the steps that stand on their own', async () => {
          const graphId = await graphOf(kind, tree);
          const response = await transaction(
            graphId,
            [
              { type: 'create_arc', data: { id: 'NP', name: '', start_time: iso(1800), end_time: iso(1900), level: 1, metadata: { parentArcId: 'G' } } },
              { type: 'update_arc', data: { id: 'C', level: 2, metadata: { parentArcId: 'NP' } } },
              { type: 'update_arc', data: { id: 'D', name: 'D renamed' } },
              { type: 'update_arc', data: { id: 'S', level: 0 } },
            ],
            false
          );
          expect(response.status).toBe(207);
          expect(await expectConsistent(graphId)).toMatchObject({ C: [2, 'P'], S: [0, null] });
          const { arcRepository } = await container.graphScopedRepositories(graphId);
          expect((await arcRepository.findById('D'))?.name).toBe('D renamed');
        });

        it('POST /api/batch/arcs undoes a child whose parent failed, and reports it', async () => {
          const graphId = await graphOf(kind, tree);
          const before = await expectConsistent(graphId);
          const response = await asKey(request(app).post('/api/batch/arcs'), graphId)
            .send({
              graphId,
              onError: 'collect',
              arcs: [
                { id: 'kid', name: 'kid', start_time: iso(1815), end_time: iso(1818), level: 3, metadata: { parentArcId: 'mid' } },
                // No name: fails once the child is made, which the plan cannot see.
                { id: 'mid', name: '', start_time: iso(1810), end_time: iso(1850), level: 2, metadata: { parentArcId: 'P' } },
              ],
            });
          expect(response.status).toBe(207);
          expect(response.body.created).toEqual([]);
          expect(response.body.failed).toHaveLength(2);
          expect(await expectConsistent(graphId)).toEqual(before);
        });
      });

      describe('HIGH 3: deleting an arc inside a stored cycle', () => {
        // X and Y name each other; Z is unrelated.
        const cycle = [arcSpec('Z', 0, 1000, 3000), arcSpec('X', 1, 1100, 1200, 'Y'), arcSpec('Y', 1, 1100, 1200, 'X')];

        it('lifts the other arc to the top, not under itself', async () => {
          for (const via of ['DELETE', 'batch'] as const) {
            const graphId = await graphOf(kind, cycle);
            if (via === 'DELETE') await del(graphId, 'X').expect(200);
            else await transaction(graphId, [{ type: 'delete_arc', data: { id: 'X' } }]).expect(200);
            expect(await expectConsistent(graphId)).toEqual({ Z: [0, null], Y: [0, null] });
          }
        });
      });

      describe('MEDIUM 4: the edit says where the arc goes, whatever the stale metadata says', () => {
        async function staleGraph(): Promise<string> {
          graphCount += 1;
          const graphId = (await container.graphService.createGraph({ name: `Stale ${kind} ${graphCount}` })).id;
          // R's head parent is Y; its metadata still names X (as a renaming import once left it).
          await commitArcs(graphId, [arcSpec('X', 0, 1700, 1800), arcSpec('Y', 0, 1700, 1800), arcSpec('R', 1, 1710, 1720, 'Y')], { R: { metadata: { parentArcId: 'X' } } });
          return graphId;
        }

        for (const [how, body] of [
          ['parent_arc_id', { parent_arc_id: 'X' }],
          ['metadata', { metadata: { parentArcId: 'X' } }],
        ] as const) {
          it(`moves R by PUT, naming X by ${how}`, async () => {
            const graphId = await staleGraph();
            expect((await exported(graphId)).arcs.R).toEqual([1, 'Y']);
            await put(graphId, 'R', body).expect(200);
            expect((await exported(graphId)).arcs.R).toEqual([1, 'X']);
            expect((await container.graphRepository.checkout(graphId)).arcs.R.parent_arc_id).toBe('X');
            await expectConsistent(graphId);
          });
        }

        it('moves R by a batch step', async () => {
          const graphId = await staleGraph();
          await transaction(graphId, [{ type: 'update_arc', data: { id: 'R', parent_arc_id: 'X' } }]).expect(200);
          expect((await exported(graphId)).arcs.R).toEqual([1, 'X']);
          await expectConsistent(graphId);
        });
      });

      describe('MEDIUM 5: an arc with no parent is level 0', () => {
        it('refuses a level above 0 on a root, and a root created above 0', async () => {
          const graphId = await graphOf(kind, tree);
          const before = await expectConsistent(graphId);
          const response = await put(graphId, 'G', { level: 2 }).expect(400);
          expect(response.body.error.message).toMatch(/no parent but is at level 2/);
          await post(graphId, { name: 'Root3', start_time: iso(1960), end_time: iso(1970), level: 3 }).expect(400);
          await transaction(graphId, [{ type: 'create_arc', data: { name: 'Root3', start_time: iso(1960), end_time: iso(1970), level: 3 } }]).expect(400);
          expect(await expectConsistent(graphId)).toEqual(before);
        });
      });

      describe('MEDIUM 6: an edit that does not move the arc reads one arc', () => {
        it('does not load every arc for a PUT that carries metadata, a level or dates it already has', async () => {
          const graphId = await graphOf(kind, tree);
          const findAll = vi.spyOn(ArcRepository.prototype, 'findAll');
          await put(graphId, 'C', { metadata: { note: 1 } }).expect(200);
          await put(graphId, 'C', { level: 2, metadata: { note: 2, parentArcId: 'P' }, start_time: iso(1810), end_time: iso(1850) }).expect(200);
          await put(graphId, 'C', { name: 'renamed' }).expect(200);
          expect(findAll).not.toHaveBeenCalled();
          // A real move does.
          await put(graphId, 'C', { metadata: { parentArcId: 'S' } }).expect(200);
          expect(findAll).toHaveBeenCalled();
          expect((await expectConsistent(graphId)).C).toEqual([2, 'S']);
        });

        it('reads the head by entity, a few reads per write however many arcs there are', async () => {
          const many: ArcSpec[] = [arcSpec('R', 0, 1000, 3000), ...Array.from({ length: 60 }, (_, i) => arcSpec(`a${i}`, 1, 1100, 1900, 'R'))];
          const graphId = await graphOf(kind, many);
          const reads = vi.spyOn(container.graphRepository, 'getHeadEntities');
          const whole = vi.spyOn(container.graphRepository, 'checkout');
          for (let i = 0; i < 10; i += 1) await put(graphId, `a${i}`, { metadata: { note: i } }).expect(200);
          expect(reads.mock.calls.length).toBeLessThanOrEqual(10 * 3);
          expect(reads.mock.calls.every((call) => (call[2] as string[]).length <= 1)).toBe(true);
          reads.mockClear();
          // A move reads every arc's head copy once (one call, however many arcs), not once per arc.
          await put(graphId, 'a10', { level: 2, metadata: { parentArcId: 'a11' } }).expect(200);
          expect(reads.mock.calls.length).toBeLessThanOrEqual(5);
          expect(whole.mock.calls.filter((call) => call[2] !== undefined)).toEqual([]);
        });
      });

      describe('MEDIUM 7: a batch passes whatever the order of its steps', () => {
        it('moves an arc under a parent created in the same batch, in either order', async () => {
          for (const childFirst of [true, false]) {
            const graphId = await graphOf(kind, tree);
            const create = { type: 'create_arc', data: { id: 'NEW', name: 'NEW', start_time: iso(1800), end_time: iso(1900), level: 2, metadata: { parentArcId: 'S' } } };
            const move = { type: 'update_arc', data: { id: 'C', metadata: { parentArcId: 'NEW' } } };
            await transaction(graphId, childFirst ? [move, create] : [create, move]).expect(200);
            expect(await expectConsistent(graphId)).toEqual({ G: [0, null], P: [1, 'G'], S: [1, 'G'], NEW: [2, 'S'], C: [3, 'NEW'], D: [4, 'C'] });
          }
        });
      });

      describe('lows', () => {
        it('clearing the parent through metadata means no parent and level 0', async () => {
          const graphId = await graphOf(kind, tree);
          await put(graphId, 'C', { metadata: { parentArcId: null } }).expect(200);
          expect(await expectConsistent(graphId)).toMatchObject({ C: [0, null], D: [1, 'C'] });
        });

        it('a pressure that names a deleted arc lets go of it, by DELETE and by batch', async () => {
          for (const via of ['DELETE', 'batch'] as const) {
            const graphId = await graphOf(kind, tree);
            await container.graphRepository.commitChanges(
              graphId,
              { added: [{ type: 'pressure', id: 'pr1', data: { id: 'pr1', description: 'p', confidence_score: 0.5, pressure_type: 'economic', evidence_event_ids: [], affected_arc_ids: ['P', 'S'] } }], modified: [], deleted: [] } as never,
              'import',
              'A pressure'
            );
            expect((await exported(graphId)).valid).toBe(true);
            if (via === 'DELETE') await del(graphId, 'P').expect(200);
            else await transaction(graphId, [{ type: 'delete_arc', data: { id: 'P' } }]).expect(200);
            expect((await container.graphRepository.checkout(graphId)).pressures.pr1.affected_arc_ids).toEqual(['S']);
            expect((await exported(graphId)).valid).toBe(true);
          }
        });

        it('a delete leaves the head, the export and the live store agreeing', async () => {
          const graphId = await graphOf(kind, tree);
          await del(graphId, 'P').expect(200);
          expect(await expectConsistent(graphId)).toEqual({ G: [0, null], S: [1, 'G'], C: [1, 'G'], D: [2, 'C'] });
        });
      });
    });
  }
});
