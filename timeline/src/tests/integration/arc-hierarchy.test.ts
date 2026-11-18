/**
 * The arc hierarchy (issue 28): deleting a parent lifts its children,
 * changing a level moves the subtree, and an impossible parent is a 400.
 *
 * Two shapes of arc, the same rules: one made by the CLI, MCP or the
 * generator records its parent in `metadata.parentArcId` (live store and
 * head); an imported one only in the head's `parent_arc_id`. Every case runs
 * on both, through every door (the routes, the batch routes), and checks the
 * export validates and the head agrees with the live store.
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
import type { ChangeRecord } from '@/services/ChangeFeedService';

type Kind = 'cli' | 'imported';
type ArcSpec = [id: string, level: number, start: string, end: string, parent?: string];

const span = (from: number, to: number): [string, string] => [`${from}-01-01T00:00:00.000Z`, `${to}-01-01T00:00:00.000Z`];
const arcSpec = (id: string, level: number, from: number, to: number, parent?: string): ArcSpec => [id, level, ...span(from, to), ...(parent ? [parent] : [])] as ArcSpec;

describe('the arc hierarchy', () => {
  let app: Express;
  let container: Container;
  let testDataDir: string;
  let key: string;
  let graphCount = 0;

  beforeAll(async () => {
    testDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arc-hierarchy-'));
    process.env.LOCAL_EXECUTION_ENABLED = 'true';
    process.env.LOCAL_DATA_DIR = testDataDir;
    process.env.LOCAL_GRAPH_FILE = 'arc-hierarchy-graph.json';
    process.env.LOCAL_BACKUP_ENABLED = 'false';
    process.env.LOCAL_MAX_MEMORY_MB = '64';
    const config = loadConfig();
    container = initializeContainer(initializeDatabaseManager(config.database), config);
    await container.initialize();
    key = (
      await container.authService.createApiKey({
        name: 'Hierarchy',
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

  /** A graph of these arcs, made the way `kind` makes them. */
  async function graphOf(kind: Kind, arcs: ArcSpec[]): Promise<string> {
    graphCount += 1;
    const graphId = (await container.graphService.createGraph({ name: `Hierarchy ${kind} ${graphCount}` })).id;
    if (kind === 'cli') {
      const { arcRepository } = await container.graphScopedRepositories(graphId);
      for (const [id, level, start, end, parent] of arcs) {
        const arc = await arcRepository.create({ id, name: id, description: id, start_time: new Date(start), end_time: new Date(end), level, metadata: parent ? { parentArcId: parent } : {} } as never);
        await container.graphWriteVersioningService.recordArc(graphId, arc, 'create');
      }
      return graphId;
    }
    await container.graphRepository.commitChanges(
      graphId,
      {
        added: arcs.map(([id, level, start, end, parent]) => ({
          type: 'arc' as const,
          id,
          data: { id, name: id, description: id, start_time: start, end_time: end, level, parent_arc_id: parent ?? null },
        })),
        modified: [],
        deleted: [],
      },
      'import',
      'An import'
    );
    await container.liveStoreSyncService.materialize(graphId, 'import');
    return graphId;
  }

  /** Each arc's level and parent as the export reads them, and whether the export validates. */
  async function exported(graphId: string): Promise<{ valid: boolean; errors: string[]; arcs: Record<string, [number, string | null]> }> {
    const document = await container.exportService.exportGraph({ graphId, scope: 'full', includeProvenance: false });
    const result = await new ImportService({ dataDir: testDataDir }).validateFormat(document.export);
    const arcs = Object.fromEntries(document.export.data.arcs.map((arc) => [arc.id, [arc.level, arc.parent_arc_id ?? null] as [number, string | null]]));
    return { valid: result.valid, errors: result.errors.map((error) => `${error.code}: ${error.message}`), arcs };
  }

  /** The live store's levels and parents (the parent as the live arc records it). */
  async function live(graphId: string): Promise<Record<string, [number, string | null]>> {
    const { arcRepository } = await container.graphScopedRepositories(graphId);
    return Object.fromEntries((await arcRepository.findAll()).map((arc) => [arc.id, [arc.level, (arc.metadata?.parentArcId as string | undefined) ?? null] as [number, string | null]]));
  }

  const versionCount = async (graphId: string): Promise<number> => (await container.graphRepository.getVersionHistory(graphId)).total;

  // G (0) > P (1) > C (2) > D (3), and a sibling S (1) under G.
  const tree: ArcSpec[] = [
    arcSpec('G', 0, 1700, 1950),
    arcSpec('P', 1, 1800, 1900, 'G'),
    arcSpec('C', 2, 1810, 1850, 'P'),
    arcSpec('D', 3, 1812, 1820, 'C'),
    arcSpec('S', 1, 1790, 1940, 'G'),
  ];

  for (const kind of ['cli', 'imported'] as const) {
    describe(`${kind} arcs`, () => {
      describe('deleting a parent', () => {
        it('lifts its children to its parent, and their subtree one level, by DELETE', async () => {
          const graphId = await graphOf(kind, tree);
          const response = await del(graphId, 'P').expect(200);
          expect(response.body.data.movedChildArcs).toEqual(['C']);
          const after = await exported(graphId);
          expect(after).toEqual({ valid: true, errors: [], arcs: { G: [0, null], C: [1, 'G'], D: [2, 'C'], S: [1, 'G'] } });
          // The live store records the same (an imported arc's parent is in the head only, unless it moved).
          expect(await live(graphId)).toMatchObject({ C: [1, 'G'], D: [2, kind === 'cli' ? 'C' : null] });
        });

        it('makes a top-level arc\'s children top level', async () => {
          const graphId = await graphOf(kind, tree);
          await del(graphId, 'G').expect(200);
          const after = await exported(graphId);
          expect(after).toEqual({ valid: true, errors: [], arcs: { P: [0, null], S: [0, null], C: [1, 'P'], D: [2, 'C'] } });
          const { arcRepository } = await container.graphScopedRepositories(graphId);
          expect((await arcRepository.findById('P'))?.metadata?.parentArcId).toBeUndefined();
        });

        it('lifts three deep, one after another', async () => {
          const graphId = await graphOf(kind, tree);
          await del(graphId, 'P').expect(200);
          await del(graphId, 'C').expect(200);
          expect(await exported(graphId)).toEqual({ valid: true, errors: [], arcs: { G: [0, null], D: [1, 'G'], S: [1, 'G'] } });
        });

        it('does the same through a batch delete_arc, atomic or not', async () => {
          for (const atomic of [true, false]) {
            const graphId = await graphOf(kind, tree);
            await transaction(graphId, [{ type: 'delete_arc', data: { id: 'P' } }], atomic).expect(200);
            expect(await exported(graphId)).toEqual({ valid: true, errors: [], arcs: { G: [0, null], C: [1, 'G'], D: [2, 'C'], S: [1, 'G'] } });
            expect(await live(graphId)).toMatchObject({ C: [1, 'G'], D: [2, kind === 'cli' ? 'C' : null] });
          }
        });

        it('deletes a parent and its child in one batch, and a child and then its parent', async () => {
          const graphId = await graphOf(kind, tree);
          await transaction(graphId, [{ type: 'delete_arc', data: { id: 'C' } }, { type: 'delete_arc', data: { id: 'P' } }]).expect(200);
          expect(await exported(graphId)).toEqual({ valid: true, errors: [], arcs: { G: [0, null], D: [1, 'G'], S: [1, 'G'] } });
        });

        it('keeps the head and the live store the same, in one version', async () => {
          const graphId = await graphOf(kind, tree);
          const before = await versionCount(graphId);
          await del(graphId, 'P').expect(200);
          expect(await versionCount(graphId)).toBe(before + 1);
          const head = await container.graphRepository.checkout(graphId);
          expect(Object.keys(head.arcs).sort()).toEqual(['C', 'D', 'G', 'S']);
          expect(head.arcs.C.level).toBe(1);
          expect(head.arcs.D.level).toBe(2);
          // A rebuild from the head loses nothing.
          await container.liveStoreSyncService.materialize(graphId, 'rollback');
          expect(await exported(graphId)).toEqual({ valid: true, errors: [], arcs: { G: [0, null], C: [1, 'G'], D: [2, 'C'], S: [1, 'G'] } });
        });

        it('announces the children that moved', async () => {
          const graphId = await graphOf(kind, tree);
          const heard: ChangeRecord[] = [];
          const stop = container.changeFeedService.subscribe((record) => {
            if (record.graphId === graphId) heard.push(record);
          });
          try {
            await del(graphId, 'P').expect(200);
          } finally {
            stop();
          }
          const summaries = heard.map((record) => (record as { summary?: string }).summary);
          expect(summaries).toEqual(['Deleted arc “P”, moved 1 child arc up a level']);
        });

        it('keeps the events of a deleted arc, unassigned from it', async () => {
          const graphId = await graphOf(kind, tree);
          const event = (await asKey(request(app).post('/api/events'), graphId)
            .send({ description: 'In P', actor: 'A', target: 'B', timestamp: '1850-01-01T00:00:00.000Z', metadata: { arcId: 'P', mood: 'calm' } })
            .expect(201)).body.data.id as string;
          await del(graphId, 'P').expect(200);
          const { eventRepository } = await container.graphScopedRepositories(graphId);
          const kept = await eventRepository.findById(event);
          expect(kept?.metadata?.arcId).toBeUndefined();
          expect(kept?.metadata?.mood).toBe('calm');
          const head = await container.graphRepository.checkout(graphId);
          expect(head.events[event].metadata).toEqual(expect.objectContaining({ mood: 'calm' }));
          expect((head.events[event].metadata as Record<string, unknown>).arcId).toBeUndefined();
        });

        it('fails, unversioned, when its version cannot be made: the head is untouched', async () => {
          const graphId = await graphOf(kind, tree);
          vi.spyOn(container.graphRepository, 'commitChanges').mockRejectedValueOnce(new Error('version store is down'));
          await del(graphId, 'P').expect(500);
          // A delete has no before-image to undo from (as on main): the head is what it was, and the feed said "not versioned".
          const head = await container.graphRepository.checkout(graphId);
          expect(head.arcs.P).toBeDefined();
        });
      });

      describe('changing a level', () => {
        it('moves the whole subtree, three deep, by PUT', async () => {
          const graphId = await graphOf(kind, tree);
          await put(graphId, 'P', { level: 0 }).expect(200);
          expect(await exported(graphId)).toEqual({ valid: true, errors: [], arcs: { G: [0, null], P: [0, null], C: [1, 'P'], D: [2, 'C'], S: [1, 'G'] } });
          await put(graphId, 'P', { metadata: { parentArcId: 'S' } }).expect(200);
          // S is level 1, so P (under S) is level 2, and its subtree follows.
          expect(await exported(graphId)).toEqual({ valid: true, errors: [], arcs: { G: [0, null], S: [1, 'G'], P: [2, 'S'], C: [3, 'P'], D: [4, 'C'] } });
        });

        it('moves the subtree by a batch step, and by a parent named without a level', async () => {
          const graphId = await graphOf(kind, tree);
          await transaction(graphId, [{ type: 'update_arc', data: { id: 'P', metadata: { parentArcId: 'S' } } }]).expect(200);
          expect(await exported(graphId)).toEqual({ valid: true, errors: [], arcs: { G: [0, null], S: [1, 'G'], P: [2, 'S'], C: [3, 'P'], D: [4, 'C'], } });
        });

        it('refuses a level that cannot fit the arc\'s parent, saying why', async () => {
          const graphId = await graphOf(kind, tree);
          const before = await exported(graphId);
          const response = await put(graphId, 'P', { level: 2 }).expect(400);
          expect(response.body.error.message).toMatch(/level 2.*parent "G".*level 0.*child must be level 1.*new parent.*level to 0/);
          expect(await exported(graphId)).toEqual(before);
        });
      });

      describe('an impossible parent', () => {
        const impossible: Array<[string, string, Record<string, unknown>]> = [
          ['itself', 'P', { metadata: { parentArcId: 'P' } }],
          ['a descendant', 'P', { metadata: { parentArcId: 'D' } }],
          ['an arc that does not exist', 'P', { metadata: { parentArcId: 'nowhere' } }],
          ['itself, by parent_arc_id', 'P', { parent_arc_id: 'P' }],
          ['a descendant, by parent_arc_id', 'P', { parent_arc_id: 'C' }],
          ['an arc that does not exist, by parent_arc_id', 'P', { parent_arc_id: 'nowhere' }],
          // Arcs already at level 0 are covered too.
          ['itself, at level 0', 'G', { metadata: { parentArcId: 'G' } }],
          ['a descendant, at level 0', 'G', { metadata: { parentArcId: 'D' } }],
          ['a missing arc, at level 0', 'G', { parent_arc_id: 'nowhere' }],
        ];

        for (const [what, id, body] of impossible) {
          it(`is refused with a 400 on PUT: ${what}`, async () => {
            const graphId = await graphOf(kind, tree);
            const before = await exported(graphId);
            const liveBefore = await live(graphId);
            await put(graphId, id, body).expect(400);
            expect(await exported(graphId)).toEqual(before);
            expect(await live(graphId)).toEqual(liveBefore);
          });

          it(`is refused with a 400 on a batch update_arc, and nothing lands: ${what}`, async () => {
            const graphId = await graphOf(kind, tree);
            const before = await exported(graphId);
            const liveBefore = await live(graphId);
            const versions = await versionCount(graphId);
            for (const atomic of [true, false]) {
              await transaction(graphId, [{ type: 'update_arc', data: { id: 'S', name: 'Renamed first' } }, { type: 'update_arc', data: { id, ...body } }], atomic).expect(400);
            }
            expect(await exported(graphId)).toEqual(before);
            expect(await live(graphId)).toEqual(liveBefore);
            expect(await versionCount(graphId)).toBe(versions);
          });
        }

        it('is refused on create, by POST and by a batch create_arc, whichever way the parent is named', async () => {
          const graphId = await graphOf(kind, tree);
          const [start, end] = span(1820, 1830);
          const base = { name: 'New', start_time: start, end_time: end, level: 3 };
          await post(graphId, { ...base, metadata: { parentArcId: 'nowhere' } }).expect(400);
          await post(graphId, { ...base, parent_arc_id: 'nowhere' }).expect(400);
          // The level does not fit the parent (C is level 2, so a child is level 3: this one is level 1).
          await post(graphId, { ...base, level: 1, metadata: { parentArcId: 'C' } }).expect(400);
          await post(graphId, { ...base, id: 'Z', parent_arc_id: 'Z' }).expect(400);
          await transaction(graphId, [{ type: 'create_arc', data: { ...base, id: 'Z', parent_arc_id: 'Z' } }]).expect(400);
          await transaction(graphId, [{ type: 'create_arc', data: { ...base, metadata: { parentArcId: 'nowhere' } } }]).expect(400);
          await asKey(request(app).post('/api/batch/arcs'), graphId).send({ graphId, arcs: [{ ...base, metadata: { parentArcId: 'nowhere' } }] }).expect(400);
          expect(Object.keys((await exported(graphId)).arcs).sort()).toEqual(['C', 'D', 'G', 'P', 'S']);
        });

        it('accepts a parent named by parent_arc_id, and records it', async () => {
          const graphId = await graphOf(kind, tree);
          const [start, end] = span(1820, 1830);
          const created = await post(graphId, { name: 'New', start_time: start, end_time: end, level: 3, parent_arc_id: 'C' }).expect(201);
          const after = await exported(graphId);
          expect(after.valid).toBe(true);
          expect(after.arcs[created.body.data.id]).toEqual([3, 'C']);
        });
      });

      describe('a batch is judged by the state it ends in', () => {
        it('promotes B, then puts its old parent A under it', async () => {
          const graphId = await graphOf(kind, [arcSpec('A', 0, 1800, 1900), arcSpec('B', 1, 1805, 1850, 'A')]);
          await transaction(graphId, [
            { type: 'update_arc', data: { id: 'B', level: 0, start_time: '1790-01-01T00:00:00.000Z', end_time: '1910-01-01T00:00:00.000Z' } },
            { type: 'update_arc', data: { id: 'A', level: 1, metadata: { parentArcId: 'B' } } },
          ]).expect(200);
          expect(await exported(graphId)).toEqual({ valid: true, errors: [], arcs: { A: [1, 'B'], B: [0, null] } });
        });

        it('creates a child before its parent, by batch and by transaction', async () => {
          const graphId = await graphOf(kind, [arcSpec('G', 0, 1700, 1950)]);
          const [cs, ce] = span(1810, 1820);
          const [ps, pe] = span(1800, 1900);
          await transaction(graphId, [
            { type: 'create_arc', data: { id: 'kid', name: 'kid', start_time: cs, end_time: ce, level: 2, metadata: { parentArcId: 'mid' } } },
            { type: 'create_arc', data: { id: 'mid', name: 'mid', start_time: ps, end_time: pe, level: 1, parent_arc_id: 'G' } },
          ]).expect(200);
          expect(await exported(graphId)).toEqual({ valid: true, errors: [], arcs: { G: [0, null], mid: [1, 'G'], kid: [2, 'mid'] } });

          const [bs, be] = span(1820, 1830);
          const [os, oe] = span(1815, 1850);
          await asKey(request(app).post('/api/batch/arcs'), graphId)
            .send({ graphId, arcs: [{ id: 'k2', name: 'k2', start_time: bs, end_time: be, level: 3, metadata: { parentArcId: 'm2' } }, { id: 'm2', name: 'm2', start_time: os, end_time: oe, level: 2, metadata: { parentArcId: 'mid' } }] })
            .expect(201);
          const after = await exported(graphId);
          expect(after.valid).toBe(true);
          expect(after.arcs).toMatchObject({ m2: [2, 'mid'], k2: [3, 'm2'] });
        });

        it('moves a child first and its parent after (the end state is what counts)', async () => {
          const graphId = await graphOf(kind, [arcSpec('G', 0, 1700, 1950), arcSpec('P', 0, 1800, 1900), arcSpec('C', 1, 1810, 1820, 'P')]);
          await transaction(graphId, [
            { type: 'update_arc', data: { id: 'C', level: 2 } },
            { type: 'update_arc', data: { id: 'P', level: 1, metadata: { parentArcId: 'G' } } },
          ]).expect(200);
          expect(await exported(graphId)).toEqual({ valid: true, errors: [], arcs: { G: [0, null], P: [1, 'G'], C: [2, 'P'] } });
        });

        it('refuses a swap that ends in a cycle, and one that ends with a level that does not fit', async () => {
          const graphId = await graphOf(kind, tree);
          // P under D: D is P's own descendant.
          await transaction(graphId, [{ type: 'update_arc', data: { id: 'P', metadata: { parentArcId: 'D' } } }]).expect(400);
          // C to level 3 under a level-1 parent.
          await transaction(graphId, [{ type: 'update_arc', data: { id: 'C', level: 3 } }]).expect(400);
          expect((await exported(graphId)).valid).toBe(true);
        });

        it('deletes a parent and reparents its child in one batch', async () => {
          const graphId = await graphOf(kind, tree);
          await transaction(graphId, [
            { type: 'update_arc', data: { id: 'C', level: 2, metadata: { parentArcId: 'S' } } },
            { type: 'delete_arc', data: { id: 'P' } },
          ]).expect(200);
          expect(await exported(graphId)).toEqual({ valid: true, errors: [], arcs: { G: [0, null], S: [1, 'G'], C: [2, 'S'], D: [3, 'C'] } });
        });
      });

      describe('reading the head', () => {
        it('never checks the whole head out for a PUT, and once for a whole batch', async () => {
          // 40 siblings under a root, moved under each other: a batch of 40 reparentings.
          const arcs: ArcSpec[] = [arcSpec('R', 0, 1000, 3000), ...Array.from({ length: 40 }, (_, i) => arcSpec(`a${i}`, 1, 1100, 1900, 'R'))];
          const graphId = await graphOf(kind, arcs);
          // A commit also recounts the graph (`calculateMetadata`, a plain checkout), which main does too;
          // what a write must not do is resolve the whole head to judge or version an arc (a call with options).
          const checkout = vi.spyOn(container.graphRepository, 'checkout');
          const selected = vi.spyOn(container.graphRepository, 'checkoutSelected');
          const wholeHeadReads = (): number => checkout.mock.calls.filter((call) => call[2] !== undefined).length;
          for (let i = 0; i < 5; i += 1) {
            await put(graphId, `a${i}`, { level: 1, metadata: { parentArcId: 'R', note: i } }).expect(200);
          }
          await put(graphId, 'a0', { level: 2, metadata: { parentArcId: 'a1' } }).expect(200);
          expect(wholeHeadReads()).toBe(0);
          await transaction(graphId, Array.from({ length: 35 }, (_, i) => ({ type: 'update_arc', data: { id: `a${i + 5}`, level: i + 2, metadata: { parentArcId: `a${i + 4}` } } }))).expect(200);
          // The batch's one version reads only the entities it names (`checkoutSelected`, issue 40), never the whole head.
          expect(wholeHeadReads()).toBe(0);
          expect(selected).toHaveBeenCalledTimes(1);
          expect((await exported(graphId)).valid).toBe(true);
        });
      });

      describe('data that already holds a cycle', () => {
        it('still edits and deletes the arcs around it, without looping', async () => {
          // X and Y name each other (stored data may hold this); Z is unrelated.
          const graphId = await graphOf(kind, [arcSpec('Z', 0, 1000, 3000), arcSpec('X', 1, 1100, 1200, 'Y'), arcSpec('Y', 1, 1100, 1200, 'X')]);
          await put(graphId, 'Z', { name: 'Z renamed' }).expect(200);
          await put(graphId, 'Z', { level: 0, metadata: {} }).expect(200);
          await put(graphId, 'X', { level: 5 }).expect(400);
          await del(graphId, 'X').expect(200);
          await transaction(graphId, [{ type: 'delete_arc', data: { id: 'Y' } }, { type: 'update_arc', data: { id: 'Z', level: 0 } }]).expect(200);
        });
      });
    });
  }
});
