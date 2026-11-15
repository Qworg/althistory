/**
 * An arc's parent through edits that move a subtree (issue 26, third review).
 *
 * The second review's rule cleared an arc's parent whenever its new level
 * was not the parent's level + 1, judged against the parent as the store held
 * it at that moment. Moving a subtree child first (a batch, two PUTs, the
 * CLI importer's overwrite) therefore deleted a parent that was valid once
 * every edit had landed, and the export failed the importer's check. The
 * rule now clears a parent only when the arc becomes top level (level 0):
 * clearing the parent of an arc above level 0 never makes it valid, because
 * a root arc must be level 0.
 *
 * Two shapes of arc, the same rule: one made by the CLI, MCP or the
 * generator records its parent in `metadata.parentArcId` (live store and
 * head); an imported one only in the head's `parent_arc_id`.
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
import type { ChangeRecord } from '@/services/ChangeFeedService';

type Kind = 'cli' | 'imported';
type ArcSpec = [id: string, level: number, start: string, end: string, parent?: string];

const G: ArcSpec = ['G', 0, '1700-01-01T00:00:00.000Z', '1950-01-01T00:00:00.000Z'];

describe("an arc's parent when a subtree moves", () => {
  let app: Express;
  let container: Container;
  let testDataDir: string;
  let key: string;
  let graphCount = 0;

  beforeAll(async () => {
    testDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arc-parent-order-'));
    process.env.LOCAL_EXECUTION_ENABLED = 'true';
    process.env.LOCAL_DATA_DIR = testDataDir;
    process.env.LOCAL_GRAPH_FILE = 'arc-parent-order-graph.json';
    process.env.LOCAL_BACKUP_ENABLED = 'false';
    process.env.LOCAL_MAX_MEMORY_MB = '64';
    const config = loadConfig();
    container = initializeContainer(initializeDatabaseManager(config.database), config);
    await container.initialize();
    key = (
      await container.authService.createApiKey({
        name: 'Arcs',
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

  const transaction = (graphId: string, operations: unknown[]): request.Test =>
    request(app).post('/api/batch/transaction').set('X-API-Key', key).set('X-Graph-Id', graphId).send({ graphId, operations });
  const put = (graphId: string, id: string, body: Record<string, unknown>): request.Test =>
    request(app).put(`/api/arcs/${id}`).set('X-API-Key', key).set('X-Graph-Id', graphId).send(body);

  /** A graph of these arcs, made the way `kind` makes them. */
  async function graphOf(kind: Kind, arcs: ArcSpec[]): Promise<string> {
    graphCount += 1;
    const graphId = (await container.graphService.createGraph({ name: `Arcs ${kind} ${graphCount}` })).id;
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

  /** Each arc's level and its parent as the export reads it (`parent_arc_id`, or the recorded `metadata.parentArcId`). */
  async function exported(graphId: string): Promise<{ valid: boolean; errors: string[]; arcs: Record<string, [number, string | null]> }> {
    const document = await container.exportService.exportGraph({ graphId, scope: 'full', includeProvenance: false });
    const result = await new ImportService({ dataDir: testDataDir }).validateFormat(document.export);
    const arcs = Object.fromEntries(document.export.data.arcs.map((arc) => [arc.id, [arc.level, arc.parent_arc_id ?? null] as [number, string | null]]));
    return { valid: result.valid, errors: result.errors.map((error) => `${error.code}: ${error.message}`), arcs };
  }

  // P (0) with child C (1) moves under G: [C -> 2, P -> 1 under G].
  const demoteArcs: ArcSpec[] = [G, ['P', 0, '1800-01-01T00:00:00.000Z', '1900-01-01T00:00:00.000Z'], ['C', 1, '1810-01-01T00:00:00.000Z', '1820-01-01T00:00:00.000Z', 'P']];
  const demoteChild = { type: 'update_arc', data: { id: 'C', level: 2 } };
  const demoteParent = { type: 'update_arc', data: { id: 'P', level: 1, metadata: { parentArcId: 'G' } } };
  const demoted = { G: [0, null], P: [1, 'G'], C: [2, 'P'] };

  // P (1, under G) with child C (2) moves to the top: [C -> 1, P -> 0].
  const promoteArcs: ArcSpec[] = [G, ['P', 1, '1800-01-01T00:00:00.000Z', '1900-01-01T00:00:00.000Z', 'G'], ['C', 2, '1810-01-01T00:00:00.000Z', '1820-01-01T00:00:00.000Z', 'P']];
  const promoteChild = { type: 'update_arc', data: { id: 'C', level: 1 } };
  const promoteParent = { type: 'update_arc', data: { id: 'P', level: 0 } };
  const promoted = { G: [0, null], P: [0, null], C: [1, 'P'] };

  for (const kind of ['cli', 'imported'] as const) {
    for (const childFirst of [true, false]) {
      const order = childFirst ? 'child first' : 'parent first';

      it(`${kind} arcs: one batch demotes a subtree, ${order}`, async () => {
        const graphId = await graphOf(kind, demoteArcs);
        expect((await exported(graphId)).valid).toBe(true);
        await transaction(graphId, childFirst ? [demoteChild, demoteParent] : [demoteParent, demoteChild]).expect(200);
        expect(await exported(graphId)).toEqual({ valid: true, errors: [], arcs: demoted });
      });

      it(`${kind} arcs: one batch promotes a subtree to the top, ${order}`, async () => {
        const graphId = await graphOf(kind, promoteArcs);
        expect((await exported(graphId)).valid).toBe(true);
        await transaction(graphId, childFirst ? [promoteChild, promoteParent] : [promoteParent, promoteChild]).expect(200);
        expect(await exported(graphId)).toEqual({ valid: true, errors: [], arcs: promoted });
      });

      it(`${kind} arcs: two PUTs demote a subtree, ${order}`, async () => {
        const graphId = await graphOf(kind, demoteArcs);
        const steps = childFirst ? [demoteChild, demoteParent] : [demoteParent, demoteChild];
        for (const step of steps) {
          const { id, ...body } = step.data as { id: string } & Record<string, unknown>;
          await put(graphId, id, body).expect(200);
        }
        expect(await exported(graphId)).toEqual({ valid: true, errors: [], arcs: demoted });
      });

      it(`${kind} arcs: two PUTs promote a subtree to the top, ${order}`, async () => {
        const graphId = await graphOf(kind, promoteArcs);
        const steps = childFirst ? [promoteChild, promoteParent] : [promoteParent, promoteChild];
        for (const step of steps) {
          const { id, ...body } = step.data as { id: string } & Record<string, unknown>;
          await put(graphId, id, body).expect(200);
        }
        expect(await exported(graphId)).toEqual({ valid: true, errors: [], arcs: promoted });
      });
    }

    it(`${kind} arcs: a batch moves a three-deep subtree up a level, deepest first`, async () => {
      // G (0) > P (1) > C (2) > D (3), then [D -> 2, C -> 1, P -> 0].
      const graphId = await graphOf(kind, [
        G,
        ['P', 1, '1800-01-01T00:00:00.000Z', '1900-01-01T00:00:00.000Z', 'G'],
        ['C', 2, '1810-01-01T00:00:00.000Z', '1820-01-01T00:00:00.000Z', 'P'],
        ['D', 3, '1812-01-01T00:00:00.000Z', '1814-01-01T00:00:00.000Z', 'C'],
      ]);
      expect((await exported(graphId)).valid).toBe(true);
      await transaction(graphId, [
        { type: 'update_arc', data: { id: 'D', level: 2 } },
        { type: 'update_arc', data: { id: 'C', level: 1 } },
        { type: 'update_arc', data: { id: 'P', level: 0 } },
      ]).expect(200);
      expect(await exported(graphId)).toEqual({ valid: true, errors: [], arcs: { G: [0, null], P: [0, null], C: [1, 'P'], D: [2, 'C'] } });
    });

    it(`${kind} arcs: a promotion to the top level still clears the parent`, async () => {
      const graphId = await graphOf(kind, demoteArcs);
      await put(graphId, 'C', { level: 0 }).expect(200);
      expect(await exported(graphId)).toEqual({ valid: true, errors: [], arcs: { G: [0, null], P: [0, null], C: [0, null] } });
      const { arcRepository } = await container.graphScopedRepositories(graphId);
      expect((await arcRepository.findById('C'))?.metadata?.parentArcId).toBeUndefined();
    });
  }

  for (const childFirst of [true, false]) {
    it(`the CLI importer's overwrite demotes a subtree, ${childFirst ? 'child' : 'parent'} listed first`, async () => {
      const graphId = await graphOf('cli', demoteArcs);
      const C = { id: 'C', name: 'C', description: 'C', start_time: '1810-01-01T00:00:00.000Z', end_time: '1820-01-01T00:00:00.000Z', level: 2, metadata: { parentArcId: 'P' } };
      const P = { id: 'P', name: 'P', description: 'P', start_time: '1800-01-01T00:00:00.000Z', end_time: '1900-01-01T00:00:00.000Z', level: 1, metadata: { parentArcId: 'G' } };
      const Garc = { id: 'G', name: 'G', description: 'G', start_time: '1700-01-01T00:00:00.000Z', end_time: '1950-01-01T00:00:00.000Z', level: 0, metadata: {} };
      const document = { metadata: { graphId }, data: { arcs: childFirst ? [C, P, Garc] : [Garc, P, C], events: [], causalRelationships: [] } };

      await new GraphImporter().import(JSON.stringify(document), container as never, { strategy: 'overwrite', graphId });

      // The importer writes the live store only (it records no version), so
      // the live store is what is checked.
      const { arcRepository } = await container.graphScopedRepositories(graphId);
      const live = async (id: string): Promise<[number | undefined, unknown]> => {
        const arc = await arcRepository.findById(id);
        return [arc?.level, arc?.metadata?.parentArcId];
      };
      expect(await live('C')).toEqual([2, 'P']);
      expect(await live('P')).toEqual([1, 'G']);
    });
  }

  // Third review, finding 2: the batch read the head leniently, so a tree
  // entry whose object is missing was taken for an arc the head never had,
  // and the edit was versioned as the bare projection, announced as ordinary.
  it('fails a batch edit, as a PUT fails, when the head names an arc whose object is missing', async () => {
    const graphId = await graphOf('imported', demoteArcs);
    const versions = (container.graphRepository as unknown as { versionRepository: Record<string, (...args: unknown[]) => Promise<unknown>> }).versionRepository;
    const tree = (await versions.getTree(graphId, await versions.getCurrentTree(graphId))) as { arcs: Record<string, string> };
    await fs.rm((versions.getObjectPath as unknown as (graphId: string, hash: string) => string)(graphId, tree.arcs.C));
    const history = async (): Promise<number> => (await container.graphRepository.getVersionHistory(graphId)).total;
    const before = await history();

    await put(graphId, 'C', { name: 'Renamed by PUT' }).expect(500);

    const heard: ChangeRecord[] = [];
    const stop = container.changeFeedService.subscribe((record) => {
      if (record.graphId === graphId) heard.push(record);
    });
    try {
      await transaction(graphId, [{ type: 'update_arc', data: { id: 'C', name: 'Renamed by a batch' } }]).expect(500);
    } finally {
      stop();
    }
    expect(heard.map((record) => (record as { summary?: string }).summary)).toEqual(['Edited 1 arc in a batch (not versioned)']);
    expect(await history()).toBe(before);
  });
});
