/**
 * Request-level tests for the graph routes.
 *
 * Unlike the unit-style route tests that mock `@/api/middleware`, these boot the
 * real local container, mount the real API router with `injectContainer`, and
 * authenticate with real API keys. That way the assertions exercise the real
 * auth middleware (401/403), the real route wiring, and the client-facing
 * request paths that the frontend `apiClient` calls.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express, { Express } from 'express';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { loadConfig, initializeDatabaseManager } from '@/utils';
import { initializeContainer, cleanupContainer, Container } from '@/container';
import { apiRouter } from '@/api/routes';
import { errorHandler, injectContainer } from '@/api/middleware';
import { IGraph } from '@/models/Graph';
import { ValidationError } from '@/utils/errors';
import type { CopyResult as GraphCopyServiceResult } from '@/services/GraphCopyService';

describe('Graph routes (request-level)', () => {
  let app: Express;
  let container: Container;
  let testDataDir: string;
  let writeKey: string;
  let readKey: string;
  let sourceGraph: IGraph;

  beforeAll(async () => {
    testDataDir = path.join(os.tmpdir(), `graphs-routes-test-${process.pid}-${Date.now()}`);
    process.env.LOCAL_EXECUTION_ENABLED = 'true';
    process.env.LOCAL_DATA_DIR = testDataDir;
    process.env.LOCAL_GRAPH_FILE = 'graphs-routes-graph.json';
    process.env.LOCAL_BACKUP_ENABLED = 'false';
    // config.ts rejects anything below 64 MB
    process.env.LOCAL_MAX_MEMORY_MB = '64';

    await fs.mkdir(testDataDir, { recursive: true });

    const config = loadConfig();
    const dbManager = initializeDatabaseManager(config.database);
    container = initializeContainer(dbManager, config);
    await container.initialize();

    const writeKeyResponse = await container.authService.createApiKey({
      name: 'Graph Routes Write Key',
      permissions: ['read:graphs', 'write:graphs', 'export'],
    });
    writeKey = writeKeyResponse.key;

    const readKeyResponse = await container.authService.createApiKey({
      name: 'Graph Routes Read Key',
      permissions: ['read:graphs'],
    });
    readKey = readKeyResponse.key;

    sourceGraph = await container.graphService.createGraph({ name: 'Route Test Source' });
    await container.graphService.setActiveGraph(sourceGraph.id);

    app = express();
    app.use(express.json());
    app.use(injectContainer);
    app.use('/api', apiRouter);
    app.use(errorHandler);
  });

  afterAll(async () => {
    await cleanupContainer();

    try {
      await fs.rm(testDataDir, { recursive: true, force: true });
    } catch {
      // Cleanup is best-effort.
    }
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('authentication and permissions', () => {
    it('rejects an unauthenticated graph listing with 401', async () => {
      const response = await request(app).get('/api/graphs').expect(401);
      expect(response.body.error.message).toBe('API key is required');
    });

    it('rejects a write with a read-only key with 403', async () => {
      const response = await request(app)
        .post('/api/graphs')
        .set('X-API-Key', readKey)
        .send({ name: 'Not Allowed' })
        .expect(403);
      expect(response.body.error.message).toContain('write:graphs');
    });

    it('allows a read with a read-only key', async () => {
      const response = await request(app)
        .get('/api/graphs')
        .set('X-API-Key', readKey)
        .expect(200);
      expect(Array.isArray(response.body.data)).toBe(true);
    });
  });

  describe('copy (frontend apiClient.graph.copy*)', () => {
    it('POST /api/graphs/copy creates a copy and returns a completed copy result', async () => {
      const copyResult: GraphCopyServiceResult = {
        sourceGraphId: sourceGraph.id,
        targetGraphId: 'resolved-by-route',
        copiedNodes: 2,
        copiedRelationships: 1,
        duration: 3,
        success: true,
        errors: [],
      };
      const copySpy = vi
        .spyOn(container.graphCopyService, 'copyFullGraph')
        .mockResolvedValue(copyResult);

      const response = await request(app)
        .post('/api/graphs/copy')
        .set('X-API-Key', writeKey)
        .send({ targetName: 'Route Test Copy', copyType: 'full' })
        .expect(201);

      const targetId = response.body.data.id;
      expect(response.body.data.status).toBe('completed');
      expect(response.body.data.progress).toBe(100);
      expect(copySpy).toHaveBeenCalledWith(sourceGraph.id, targetId);
      // The target graph really exists, so GET /graphs/copy/:id can resolve it.
      const target = await container.graphService.getGraph(targetId);
      expect(target.name).toBe('Route Test Copy');
    });

    it('POST /api/graphs/copy routes a time_range copy to copyByTimeRange', async () => {
      const copyResult: GraphCopyServiceResult = {
        sourceGraphId: sourceGraph.id,
        targetGraphId: 'resolved-by-route',
        copiedNodes: 1,
        copiedRelationships: 0,
        duration: 1,
        success: true,
        errors: [],
      };
      const rangeSpy = vi
        .spyOn(container.graphCopyService, 'copyByTimeRange')
        .mockResolvedValue(copyResult);

      const response = await request(app)
        .post('/api/graphs/copy')
        .set('X-API-Key', writeKey)
        .send({
          targetName: 'Route Test Time Range Copy',
          copyType: 'time_range',
          timeRange: { start: '1914-01-01T00:00:00.000Z', end: '1919-01-01T00:00:00.000Z' },
        })
        .expect(201);

      expect(rangeSpy).toHaveBeenCalledWith(
        sourceGraph.id,
        {
          start: new Date('1914-01-01T00:00:00.000Z'),
          end: new Date('1919-01-01T00:00:00.000Z'),
        },
        response.body.data.id
      );
    });

    it('POST /api/graphs/copy routes a filtered copy to copyByEntityFilter', async () => {
      const copyResult: GraphCopyServiceResult = {
        sourceGraphId: sourceGraph.id,
        targetGraphId: 'resolved-by-route',
        copiedNodes: 1,
        copiedRelationships: 0,
        duration: 1,
        success: true,
        errors: [],
      };
      const filterSpy = vi
        .spyOn(container.graphCopyService, 'copyByEntityFilter')
        .mockResolvedValue(copyResult);

      const response = await request(app)
        .post('/api/graphs/copy')
        .set('X-API-Key', writeKey)
        .send({
          targetName: 'Route Test Filtered Copy',
          copyType: 'filtered',
          filter: { actors: ['Actor A'], targets: ['Target B'], eventTypes: ['battle'] },
        })
        .expect(201);

      expect(filterSpy).toHaveBeenCalledWith(
        sourceGraph.id,
        { actors: ['Actor A'], targets: ['Target B'], eventTypes: ['battle'] },
        response.body.data.id
      );
    });

    it('POST /api/graphs/copy rejects a copy without a target name', async () => {
      await request(app)
        .post('/api/graphs/copy')
        .set('X-API-Key', writeKey)
        .send({ copyType: 'full' })
        .expect(400);
    });

    it('GET /api/graphs/copy/:copyId reports the copy as completed', async () => {
      const target = await container.graphService.createGraph({ name: 'Route Test Copy Status' });

      const response = await request(app)
        .get(`/api/graphs/copy/${target.id}`)
        .set('X-API-Key', readKey)
        .expect(200);

      expect(response.body.data).toMatchObject({
        id: target.id,
        name: 'Route Test Copy Status',
        status: 'completed',
        progress: 100,
      });
    });
  });

  describe('branches (frontend apiClient.graphs.getBranches)', () => {
    it('GET /api/graphs/:id/branches lists graphs branched from the source', async () => {
      const branch = await container.graphService.branchGraph(sourceGraph.id, {
        name: 'Route Test Branch',
      });

      const response = await request(app)
        .get(`/api/graphs/${sourceGraph.id}/branches`)
        .set('X-API-Key', readKey)
        .expect(200);

      const branchIds = response.body.data.map((graph: IGraph) => graph.id);
      expect(branchIds).toContain(branch.id);
    });

    it('GET /api/graphs/:id/branches returns 404 for an unknown graph', async () => {
      await request(app)
        .get('/api/graphs/does-not-exist/branches')
        .set('X-API-Key', readKey)
        .expect(404);
    });
  });

  describe('rollback (frontend apiClient.graphs.rollback)', () => {
    it('POST /api/graphs/:id/rollback/:version returns the rolled-back graph', async () => {
      const versionRef = await container.graphService.commitChanges(
        sourceGraph.id,
        { added: [], modified: [], deleted: [] },
        'import',
        'test version for rollback'
      );

      const response = await request(app)
        .post(`/api/graphs/${sourceGraph.id}/rollback/${versionRef.version}`)
        .set('X-API-Key', writeKey)
        .expect(200);

      expect(response.body.data.id).toBe(sourceGraph.id);
      expect(response.body.data.name).toBe('Route Test Source');
    });
  });

  describe('activate (frontend apiClient.graphs.switch)', () => {
    it('POST /api/graphs/:id/activate makes the graph active', async () => {
      const target = await container.graphService.createGraph({ name: 'Route Test Activate' });

      await request(app)
        .post(`/api/graphs/${target.id}/activate`)
        .set('X-API-Key', writeKey)
        .expect(200);

      const active = await container.graphService.getActiveGraph();
      expect(active?.id).toBe(target.id);
    });
  });

  describe('export authentication', () => {
    it('rejects an unauthenticated export request with 401', async () => {
      await request(app).get('/api/export/stats').expect(401);
    });

    it('rejects a key without the export permission with 403', async () => {
      const response = await request(app)
        .get('/api/export/stats')
        .set('X-API-Key', readKey)
        .expect(403);
      expect(response.body.error.message).toContain('export');
    });

    it('allows an export request with the export permission', async () => {
      const response = await request(app)
        .get('/api/export/stats')
        .set('X-API-Key', writeKey)
        .expect(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('export graph scoping (X-Graph-Id)', () => {
    it('uses the header as the scope for a sync export with no body graphId', async () => {
      const response = await request(app)
        .post('/api/export/sync')
        .set('X-API-Key', writeKey)
        .set('X-Graph-Id', sourceGraph.id)
        .send({ scope: 'full' })
        .expect(200);
      expect(response.body.success).toBe(true);
    });

    it('uses the header as the scope for an export job with no body graphId', async () => {
      const response = await request(app)
        .post('/api/export/jobs')
        .set('X-API-Key', writeKey)
        .set('X-Graph-Id', sourceGraph.id)
        .send({ scope: 'full' })
        .expect(202);
      expect(response.body.success).toBe(true);
    });

    it('accepts a body graphId that agrees with the header', async () => {
      const response = await request(app)
        .post('/api/export/sync')
        .set('X-API-Key', writeKey)
        .set('X-Graph-Id', sourceGraph.id)
        .send({ graphId: sourceGraph.id, scope: 'full' })
        .expect(200);
      expect(response.body.success).toBe(true);
    });

    it('rejects a sync export whose body graphId contradicts the header', async () => {
      const other = await container.graphService.createGraph({ name: 'Route Test Contradiction Sync' });
      const response = await request(app)
        .post('/api/export/sync')
        .set('X-API-Key', writeKey)
        .set('X-Graph-Id', sourceGraph.id)
        .send({ graphId: other.id, scope: 'full' })
        .expect(400);
      expect(response.body.error.message).toContain('contradicts');
    });

    it('rejects an export job whose body graphId contradicts the header', async () => {
      const other = await container.graphService.createGraph({ name: 'Route Test Contradiction Job' });
      const response = await request(app)
        .post('/api/export/jobs')
        .set('X-API-Key', writeKey)
        .set('X-Graph-Id', sourceGraph.id)
        .send({ graphId: other.id, scope: 'full' })
        .expect(400);
      expect(response.body.error.message).toContain('contradicts');
    });
  });

  describe('merge validation (frontend apiClient.graphs.merge)', () => {
    it.each([null, '', 'garbage'])(
      'POST /api/graphs/:id/merge rejects %j as a manual resolution value',
      async (invalidValue) => {
        // The route owns a value check as well as the service. Mocking the
        // service to succeed means a route that omitted its own check would
        // answer 200 here, so this asserts the route rejects before delegating
        // rather than merely observing that the service also rejects.
        const mergeSpy = vi
          .spyOn(container.graphService, 'mergeGraph')
          .mockResolvedValue({ success: true, newVersion: 1 });

        const response = await request(app)
          .post(`/api/graphs/${sourceGraph.id}/merge`)
          .set('X-API-Key', writeKey)
          .send({
            sourceGraphId: sourceGraph.id,
            conflictResolution: 'manual',
            manualResolutions: { 'event:any': invalidValue },
          })
          .expect(400);

        expect(response.body.error.message).toContain('keep-source');
        expect(mergeSpy).not.toHaveBeenCalled();
      }
    );

    it('accepts a harmonized compromise payload and passes it to the service', async () => {
      const mergeSpy = vi
        .spyOn(container.graphService, 'mergeGraph')
        .mockResolvedValue({ success: true, newVersion: 1 });

      const mergedValue = {
        description: 'Blended',
        actor: 'Actor 1',
        target: 'Target 1',
        timestamp: '2024-01-01T00:00:00Z',
      };

      const response = await request(app)
        .post(`/api/graphs/${sourceGraph.id}/merge`)
        .set('X-API-Key', writeKey)
        .send({
          sourceGraphId: sourceGraph.id,
          conflictResolution: 'manual',
          manualResolutions: {
            'event:event-1': { strategy: 'merged', value: mergedValue },
          },
        })
        .expect(200);

      expect(mergeSpy).toHaveBeenCalledWith(
        sourceGraph.id,
        expect.objectContaining({
          conflictResolution: 'manual',
          manualResolutions: {
            'event:event-1': { strategy: 'merged', value: mergedValue },
          },
        })
      );
      expect(response.body.success).toBe(true);
    });

    it.each([
      ['a payload that is not an object', { strategy: 'merged', value: 'everything' }],
      ['a payload that is an array', { strategy: 'merged', value: ['a'] }],
      ['a payload that is null', { strategy: 'merged', value: null }],
      ['an unknown strategy', { strategy: 'blend', value: { description: 'x' } }],
    ])('rejects %s as a harmonized compromise', async (_label, invalidValue) => {
      const mergeSpy = vi
        .spyOn(container.graphService, 'mergeGraph')
        .mockResolvedValue({ success: true, newVersion: 1 });

      const response = await request(app)
        .post(`/api/graphs/${sourceGraph.id}/merge`)
        .set('X-API-Key', writeKey)
        .send({
          sourceGraphId: sourceGraph.id,
          conflictResolution: 'manual',
          manualResolutions: { 'event:any': invalidValue },
        })
        .expect(400);

      expect(response.body.error.message).toContain('manualResolutions');
      expect(mergeSpy).not.toHaveBeenCalled();
    });

    it('returns the anomalies of a refused dry run', async () => {
      // A dry run that finds a causal cycle is refused with 409 and the
      // anomalies, so the caller can see what is wrong before writing.
      vi.spyOn(container.graphService, 'mergeGraph').mockResolvedValue({
        success: false,
        dryRun: true,
        conflicts: [],
        anomalies: [
          {
            type: 'causal_cycle',
            message: 'Causal cycle detected: e1 -> e2 -> e1',
            details: { cycle: ['e1', 'e2', 'e1'] },
          },
        ],
      });

      const response = await request(app)
        .post(`/api/graphs/${sourceGraph.id}/merge`)
        .set('X-API-Key', writeKey)
        .send({ sourceGraphId: sourceGraph.id, conflictResolution: 'keep-target', dryRun: true })
        .expect(409);

      expect(response.body.success).toBe(false);
      expect(response.body.anomalies).toHaveLength(1);
      expect(response.body.anomalies[0].type).toBe('causal_cycle');
      expect(response.body.anomalies[0].message).toContain('Causal cycle');
    });

    it('returns the anomalies of a clean dry run', async () => {
      vi.spyOn(container.graphService, 'mergeGraph').mockResolvedValue({
        success: true,
        dryRun: true,
        conflicts: [],
        anomalies: [],
      });

      const response = await request(app)
        .post(`/api/graphs/${sourceGraph.id}/merge`)
        .set('X-API-Key', writeKey)
        .send({ sourceGraphId: sourceGraph.id, conflictResolution: 'keep-target', dryRun: true })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.anomalies).toEqual([]);
      expect(response.body.dryRun).toBe(true);
    });

    it('reports a payload the service refuses as a 400', async () => {
      // The service refuses a payload that would corrupt the entity; the
      // route has to surface that as a client error rather than a 500.
      vi.spyOn(container.graphService, 'mergeGraph').mockRejectedValue(
        new ValidationError(
          "The merge was refused: The merged event 'event1' is not usable: timestamp must stay a string",
          'manualResolutions'
        )
      );

      const response = await request(app)
        .post(`/api/graphs/${sourceGraph.id}/merge`)
        .set('X-API-Key', writeKey)
        .send({
          sourceGraphId: sourceGraph.id,
          conflictResolution: 'manual',
          manualResolutions: {
            'event:event-1': { strategy: 'merged', value: { timestamp: 1 } },
          },
        })
        .expect(400);

      expect(response.body.error.message).toContain('must stay a string');
    });
  });
});
