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

  /** Remove the object a head entry points at, as a damaged store would have lost it. */
  async function loseObject(graphId: string, kind: 'arcs' | 'events' | 'relationships', id: string): Promise<void> {
    const versions = (container.graphRepository as unknown as { versionRepository: Record<string, (...args: unknown[]) => Promise<unknown>> }).versionRepository;
    const tree = (await versions.getTree(graphId, await versions.getCurrentTree(graphId))) as Record<string, Record<string, string>>;
    await fs.rm((versions.getObjectPath as unknown as (graphId: string, hash: string) => string)(graphId, tree[kind][id]));
  }

  // Fourth review, finding 1: the batch read the whole head strictly, so one
  // missing object anywhere failed every batch on the graph, even one that
  // only creates, while the single routes went on working.
  it('versions a batch that does not touch an entity whose object is missing', async () => {
    const graphId = await graphOf('imported', [G, ['P', 0, '1800-01-01T00:00:00.000Z', '1900-01-01T00:00:00.000Z']]);
    await loseObject(graphId, 'arcs', 'G');
    const history = async (): Promise<number> => (await container.graphRepository.getVersionHistory(graphId)).total;
    const event = { description: 'An event', actor: 'A', target: 'B', timestamp: '1850-01-01T00:00:00.000Z' };

    let versions = await history();
    const bulk = await request(app).post('/api/batch/events').set('X-API-Key', key).set('X-Graph-Id', graphId).send({ graphId, events: [event] }).expect(201);
    expect(await history()).toBe(++versions);
    const created = await transaction(graphId, [{ type: 'create_event', data: event }]).expect(200);
    expect(await history()).toBe(++versions);
    await transaction(graphId, [{ type: 'update_arc', data: { id: 'P', name: 'P renamed' } }]).expect(200);
    expect(await history()).toBe(++versions);

    const head = await container.graphRepository.checkout(graphId);
    expect(head.events[bulk.body.created[0] as string]).toBeDefined();
    expect(head.events[created.body.results[0].id as string]).toBeDefined();
    expect(head.arcs.P).toMatchObject({ name: 'P renamed' });

    // A batch that touches the arc whose object is missing still fails, unversioned.
    await transaction(graphId, [{ type: 'update_arc', data: { id: 'G', name: 'G renamed' } }]).expect(500);
    expect(await history()).toBe(versions);
  });

  it("fails a batch that deletes an event when a link object it would have to check is missing", async () => {
    const graphId = (await container.graphService.createGraph({ name: 'Lost link' })).id;
    const add = async (description: string, timestamp: string): Promise<string> =>
      (await request(app).post('/api/events').set('X-API-Key', key).set('X-Graph-Id', graphId).send({ description, actor: 'A', target: 'B', timestamp }).expect(201)).body.data.id as string;
    const cause = await add('Cause', '1800-01-01T00:00:00.000Z');
    const effect = await add('Effect', '1801-01-01T00:00:00.000Z');
    await request(app)
      .post('/api/causal/link')
      .set('X-API-Key', key)
      .set('X-Graph-Id', graphId)
      .send({ causeEventId: cause, effectEventId: effect, relationship: { type: 'direct', strength: 0.5, confidence: 0.5, evidence: 'Seen' } })
      .expect(201);
    const linkId = Object.keys((await container.graphRepository.checkout(graphId)).relationships)[0]!;
    await loseObject(graphId, 'relationships', linkId);

    // The cascade cannot tell whether the unreadable link joins the deleted
    // event; versioning the delete without it could leave an orphan.
    await transaction(graphId, [{ type: 'delete_event', data: { id: cause } }]).expect(500);
  });

  // Fourth review, finding 2: an arc moved by naming a new parent in its
  // metadata kept the head's old parent_arc_id, which the export prefers.
  it("moves an imported arc to the parent its edit names in metadata, by PUT", async () => {
    const graphId = await graphOf('imported', [
      G,
      ['A', 0, '1800-01-01T00:00:00.000Z', '1900-01-01T00:00:00.000Z'],
      ['B', 1, '1805-01-01T00:00:00.000Z', '1850-01-01T00:00:00.000Z', 'A'],
      ['C', 2, '1810-01-01T00:00:00.000Z', '1820-01-01T00:00:00.000Z', 'B'],
    ]);
    await put(graphId, 'C', { level: 1, metadata: { parentArcId: 'G' } }).expect(200);
    expect(await exported(graphId)).toEqual({ valid: true, errors: [], arcs: { G: [0, null], A: [0, null], B: [1, 'A'], C: [1, 'G'] } });
  });

  it("moves an imported arc to the parent its edit names in metadata, in a batch, at the same level too", async () => {
    const graphId = await graphOf('imported', [
      G,
      ['A', 0, '1800-01-01T00:00:00.000Z', '1900-01-01T00:00:00.000Z'],
      ['B', 1, '1805-01-01T00:00:00.000Z', '1850-01-01T00:00:00.000Z', 'A'],
      ['C', 2, '1810-01-01T00:00:00.000Z', '1820-01-01T00:00:00.000Z', 'B'],
      ['D', 1, '1860-01-01T00:00:00.000Z', '1899-01-01T00:00:00.000Z', 'A'],
    ]);
    await transaction(graphId, [{ type: 'update_arc', data: { id: 'C', level: 1, metadata: { parentArcId: 'G' } } }]).expect(200);
    await transaction(graphId, [{ type: 'update_arc', data: { id: 'D', metadata: { parentArcId: 'G' } } }]).expect(200);
    expect(await exported(graphId)).toEqual({ valid: true, errors: [], arcs: { G: [0, null], A: [0, null], B: [1, 'A'], C: [1, 'G'], D: [1, 'G'] } });
  });

  /** The tree entries of a graph's head, by kind (present even when an object is lost). */
  async function headTree(graphId: string): Promise<Record<string, Record<string, string>>> {
    const versions = (container.graphRepository as unknown as { versionRepository: Record<string, (...args: unknown[]) => Promise<unknown>> }).versionRepository;
    return (await versions.getTree(graphId, await versions.getCurrentTree(graphId))) as Record<string, Record<string, string>>;
  }

  const versionCount = async (graphId: string): Promise<number> => (await container.graphRepository.getVersionHistory(graphId)).total;

  describe('fifth review', () => {
    let importer: ImportService;

    beforeAll(async () => {
      importer = new ImportService({ dataDir: testDataDir, onHeadReplaced: (graphId, reason) => container.liveStoreSyncService.materialize(graphId, reason).then(() => undefined) });
      await importer.initialize();
    });

    afterAll(async () => {
      await importer.destroy();
    });

    // 1. An import that renamed a conflicting arc remapped its parent_arc_id
    // and left metadata.parentArcId naming the old id; the overlay then took
    // that stale metadata for a move, and an unrelated rename moved the copy.
    for (const via of ['PUT', 'batch'] as const) {
      it(`keeps an arc copied by a renaming import under its renamed parent through a rename, by ${via}`, async () => {
        const graphId = await graphOf('cli', [['P', 0, '1800-01-01T00:00:00.000Z', '1900-01-01T00:00:00.000Z'], ['C', 1, '1810-01-01T00:00:00.000Z', '1820-01-01T00:00:00.000Z', 'P']]);
        const document = await container.exportService.exportGraph({ graphId, scope: 'full', includeProvenance: false });
        expect((await importer.executeImport(document.export, { mode: 'merge', conflictResolution: 'rename', graphId })).success).toBe(true);

        const imported = await exported(graphId);
        const childCopy = Object.keys(imported.arcs).find((id) => id.startsWith('C_imported'))!;
        const parentCopy = Object.keys(imported.arcs).find((id) => id.startsWith('P_imported'))!;
        expect(imported.arcs[childCopy]).toEqual([1, parentCopy]);
        // The import remaps the parent the metadata records too, so the live store agrees.
        const { arcRepository } = await container.graphScopedRepositories(graphId);
        expect((await arcRepository.findById(childCopy))?.metadata?.parentArcId).toBe(parentCopy);

        if (via === 'PUT') await put(graphId, childCopy, { name: 'Renamed copy' }).expect(200);
        else await transaction(graphId, [{ type: 'update_arc', data: { id: childCopy, name: 'Renamed copy' } }]).expect(200);

        const after = await exported(graphId);
        expect(after.valid).toBe(true);
        expect(after.arcs[childCopy]).toEqual([1, parentCopy]);
        expect(after.arcs.C).toEqual([1, 'P']);
      });
    }

    it('never moves an arc on an edit that leaves its recorded metadata parent as the head recorded it', async () => {
      // A head whose metadata and field disagree, as a renaming import before
      // this fix left one: the field is what the export reads.
      graphCount += 1;
      const graphId = (await container.graphService.createGraph({ name: `Stale metadata ${graphCount}` })).id;
      const arc = (id: string, level: number, start: string, end: string, parent: string | null, metadataParent?: string) => ({
        type: 'arc' as const,
        id,
        data: { id, name: id, description: id, start_time: start, end_time: end, level, parent_arc_id: parent, metadata: metadataParent ? { parentArcId: metadataParent } : {} },
      });
      await container.graphRepository.commitChanges(graphId, {
        added: [
          arc('A', 0, '1800-01-01T00:00:00.000Z', '1900-01-01T00:00:00.000Z', null),
          arc('B', 0, '1801-01-01T00:00:00.000Z', '1899-01-01T00:00:00.000Z', null),
          arc('C', 1, '1810-01-01T00:00:00.000Z', '1820-01-01T00:00:00.000Z', 'B', 'A'),
        ],
        modified: [],
        deleted: [],
      }, 'import', 'An import');
      await container.liveStoreSyncService.materialize(graphId, 'import');

      await put(graphId, 'C', { name: 'C renamed' }).expect(200);
      expect((await exported(graphId)).arcs.C).toEqual([1, 'B']);
      await transaction(graphId, [{ type: 'update_arc', data: { id: 'C', description: 'Edited in a batch' } }]).expect(200);
      expect((await exported(graphId)).arcs.C).toEqual([1, 'B']);
    });

    // 3. Nothing checked the arc metadata names as a parent.
    const badParents: Array<[string, string]> = [['itself', 'B'], ['its own child', 'C'], ['an arc that does not exist', 'missing-arc']];
    for (const kind of ['cli', 'imported'] as const) {
      for (const [what, parent] of badParents) {
        it(`refuses to give ${kind} arc B ${what} as its parent, by PUT and in a batch`, async () => {
          const graphId = await graphOf(kind, [
            G,
            ['A', 0, '1800-01-01T00:00:00.000Z', '1900-01-01T00:00:00.000Z'],
            ['B', 1, '1805-01-01T00:00:00.000Z', '1850-01-01T00:00:00.000Z', 'A'],
            ['C', 2, '1810-01-01T00:00:00.000Z', '1820-01-01T00:00:00.000Z', 'B'],
          ]);
          const before = await exported(graphId);
          expect(before.valid).toBe(true);

          const refused = await put(graphId, 'B', { metadata: { parentArcId: parent } }).expect(400);
          expect(refused.body.error.message).toContain('parentArcId');
          const step = await transaction(graphId, [{ type: 'update_arc', data: { id: 'B', metadata: { parentArcId: parent } } }]).expect(400);
          expect(step.body.result.results[0]).toMatchObject({ success: false });
          expect(String(step.body.result.results[0].error)).toContain('parentArcId');

          expect(await exported(graphId)).toEqual(before);
        });
      }
    }

    // 2. Any batch that touched a link read every link strictly, so one lost
    // link object failed every link batch on the graph.
    it('versions a batch that creates links, though an unrelated link object is lost', async () => {
      graphCount += 1;
      const graphId = (await container.graphService.createGraph({ name: `Lost link ${graphCount}` })).id;
      const add = async (description: string, timestamp: string): Promise<string> =>
        (await request(app).post('/api/events').set('X-API-Key', key).set('X-Graph-Id', graphId).send({ description, actor: 'A', target: 'B', timestamp }).expect(201)).body.data.id as string;
      const a = await add('A', '1800-01-01T00:00:00.000Z');
      const b = await add('B', '1801-01-01T00:00:00.000Z');
      const c = await add('C', '1802-01-01T00:00:00.000Z');
      const d = await add('D', '1803-01-01T00:00:00.000Z');
      await request(app)
        .post('/api/causal/link')
        .set('X-API-Key', key)
        .set('X-Graph-Id', graphId)
        .send({ causeEventId: a, effectEventId: b, relationship: { type: 'direct', strength: 0.5, confidence: 0.5, evidence: 'Seen' } })
        .expect(201);
      const lost = Object.keys((await container.graphRepository.checkout(graphId)).relationships)[0]!;
      await loseObject(graphId, 'relationships', lost);

      let versions = await versionCount(graphId);
      await transaction(graphId, [{ type: 'create_relationship', data: { cause_event_id: b, effect_event_id: c, evidence: 'Seen' } }]).expect(200);
      expect(await versionCount(graphId)).toBe(++versions);
      await request(app).post('/api/batch/relationships').set('X-API-Key', key).set('X-Graph-Id', graphId)
        .send({ graphId, relationships: [{ cause_event_id: a, effect_event_id: d, evidence: 'Seen' }] }).expect(201);
      expect(await versionCount(graphId)).toBe(++versions);

      const head = await container.graphRepository.checkout(graphId);
      const pairs = Object.values(head.relationships).map((link) => `${link.cause_event_id}>${link.effect_event_id}`);
      expect(pairs).toEqual(expect.arrayContaining([`${b}>${c}`, `${a}>${d}`]));
      // The lost link is still in the tree.
      expect(lost in (await headTree(graphId)).relationships).toBe(true);

      // A batch that deletes a link still reads every link, and fails.
      await transaction(graphId, [{ type: 'delete_relationship', data: { cause_event_id: b, effect_event_id: c } }]).expect(500);
    });

    // 4. A delete needs only the tree entry, but the batch read the object.
    it('deletes, in a batch, an arc and an event whose objects are lost, as the single DELETE does', async () => {
      const graphId = await graphOf('imported', [G, ['P', 0, '1800-01-01T00:00:00.000Z', '1900-01-01T00:00:00.000Z']]);
      const event = (await request(app).post('/api/events').set('X-API-Key', key).set('X-Graph-Id', graphId)
        .send({ description: 'Alone', actor: 'A', target: 'B', timestamp: '1850-01-01T00:00:00.000Z' }).expect(201)).body.data.id as string;
      await loseObject(graphId, 'arcs', 'G');
      await loseObject(graphId, 'events', event);
      const versions = await versionCount(graphId);

      await transaction(graphId, [{ type: 'delete_arc', data: { id: 'G' } }, { type: 'delete_event', data: { id: event } }]).expect(200);

      expect(await versionCount(graphId)).toBe(versions + 1);
      const tree = await headTree(graphId);
      expect('G' in tree.arcs).toBe(false);
      expect(event in tree.events).toBe(false);
      expect('P' in tree.arcs).toBe(true);
    });

    it('leaves an untouched entity whose object is lost in the tree', async () => {
      const graphId = await graphOf('imported', [G, ['P', 0, '1800-01-01T00:00:00.000Z', '1900-01-01T00:00:00.000Z']]);
      const before = (await headTree(graphId)).arcs.G;
      await loseObject(graphId, 'arcs', 'G');
      await transaction(graphId, [{ type: 'update_arc', data: { id: 'P', name: 'P2' } }]).expect(200);
      expect((await headTree(graphId)).arcs.G).toBe(before);
    });
  });

  // The interactions of the fifth review's changes with their neighbours.
  describe('fifth review, neighbours', () => {
    const fourDeep: ArcSpec[] = [
      G,
      ['A', 0, '1800-01-01T00:00:00.000Z', '1900-01-01T00:00:00.000Z'],
      ['B', 1, '1805-01-01T00:00:00.000Z', '1850-01-01T00:00:00.000Z', 'A'],
      ['C', 2, '1810-01-01T00:00:00.000Z', '1820-01-01T00:00:00.000Z', 'B'],
    ];

    for (const kind of ['cli', 'imported'] as const) {
      it(`${kind} arcs: a second move by metadata, and one back to the first parent, both land`, async () => {
        const graphId = await graphOf(kind, fourDeep);
        await put(graphId, 'B', { metadata: { parentArcId: 'G' } }).expect(200);
        expect((await exported(graphId)).arcs.B).toEqual([1, 'G']);
        await transaction(graphId, [{ type: 'update_arc', data: { id: 'B', metadata: { parentArcId: 'A' } } }]).expect(200);
        const after = await exported(graphId);
        expect(after.arcs.B).toEqual([1, 'A']);
        expect(after.valid).toBe(true);
      });

      it(`${kind} arcs: a move whose version cannot be made is undone, in the live store and the head`, async () => {
        const graphId = await graphOf(kind, fourDeep);
        const before = await exported(graphId);
        vi.spyOn(container.graphRepository, 'commitChanges').mockRejectedValueOnce(new Error('version store is down'));
        await put(graphId, 'B', { metadata: { parentArcId: 'G' } }).expect(500);
        expect(await exported(graphId)).toEqual(before);
        const { arcRepository } = await container.graphScopedRepositories(graphId);
        expect((await arcRepository.findById('B'))?.metadata?.parentArcId).toBe(kind === 'cli' ? 'A' : undefined);
      });

      it(`${kind} arcs: a move to the top level is not refused for the parent it names, which is cleared`, async () => {
        const graphId = await graphOf(kind, demoteArcs);
        await put(graphId, 'C', { level: 0, metadata: { parentArcId: 'no-such-arc' } }).expect(200);
        expect((await exported(graphId)).arcs.C).toEqual([0, null]);
      });

      it(`${kind} arcs: a batch cannot close a loop over two steps`, async () => {
        const graphId = await graphOf(kind, [
          ['X', 1, '1800-01-01T00:00:00.000Z', '1900-01-01T00:00:00.000Z', 'G'],
          ['Y', 1, '1801-01-01T00:00:00.000Z', '1899-01-01T00:00:00.000Z', 'G'],
          G,
        ]);
        const res = await transaction(graphId, [
          { type: 'update_arc', data: { id: 'X', metadata: { parentArcId: 'Y' } } },
          { type: 'update_arc', data: { id: 'Y', metadata: { parentArcId: 'X' } } },
        ]).expect(400);
        expect(String(res.body.result.results[1].error)).toContain('is inside this arc');
      });
    }

    it("does not refuse an edit that resends a CLI arc's recorded parent as it is, even a parent since deleted", async () => {
      const graphId = await graphOf('cli', fourDeep);
      const { arcRepository } = await container.graphScopedRepositories(graphId);
      await arcRepository.delete('A');
      const metadata = (await arcRepository.findById('B'))?.metadata;
      expect(metadata?.parentArcId).toBe('A');
      await put(graphId, 'B', { name: 'B renamed', metadata }).expect(200);
      await transaction(graphId, [{ type: 'update_arc', data: { id: 'B', description: 'Edited', metadata } }]).expect(200);
    });

    it('keeps the parents of a graph re-imported over itself (overwrite) through a rename', async () => {
      const graphId = await graphOf('cli', fourDeep);
      const document = await container.exportService.exportGraph({ graphId, scope: 'full', includeProvenance: false });
      const importer = new ImportService({ dataDir: testDataDir, onHeadReplaced: (id, reason) => container.liveStoreSyncService.materialize(id, reason).then(() => undefined) });
      await importer.initialize();
      try {
        expect((await importer.executeImport(document.export, { mode: 'merge', conflictResolution: 'overwrite', graphId })).success).toBe(true);
      } finally {
        await importer.destroy();
      }
      await put(graphId, 'C', { name: 'C renamed' }).expect(200);
      await transaction(graphId, [{ type: 'update_arc', data: { id: 'B', name: 'B renamed' } }]).expect(200);
      const after = await exported(graphId);
      expect(after).toMatchObject({ valid: true, arcs: { B: [1, 'A'], C: [2, 'B'] } });
    });

    it('deletes, in a batch, an event whose object is lost, with the readable link that went with it', async () => {
      graphCount += 1;
      const graphId = (await container.graphService.createGraph({ name: `Lost event ${graphCount}` })).id;
      const add = async (description: string, timestamp: string): Promise<string> =>
        (await request(app).post('/api/events').set('X-API-Key', key).set('X-Graph-Id', graphId).send({ description, actor: 'A', target: 'B', timestamp }).expect(201)).body.data.id as string;
      const cause = await add('Cause', '1800-01-01T00:00:00.000Z');
      const effect = await add('Effect', '1801-01-01T00:00:00.000Z');
      await request(app)
        .post('/api/causal/link')
        .set('X-API-Key', key)
        .set('X-Graph-Id', graphId)
        .send({ causeEventId: cause, effectEventId: effect, relationship: { type: 'direct', strength: 0.5, confidence: 0.5, evidence: 'Seen' } })
        .expect(201);
      await loseObject(graphId, 'events', cause);

      await transaction(graphId, [{ type: 'delete_event', data: { id: cause } }]).expect(200);
      const tree = await headTree(graphId);
      expect(cause in tree.events).toBe(false);
      expect(Object.keys(tree.relationships)).toEqual([]);
      expect(effect in tree.events).toBe(true);
    });
  });
});
