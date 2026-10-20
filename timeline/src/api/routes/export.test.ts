/**
 * Request-level tests for the export routes.
 *
 * Like `graphs.test.ts`, these boot the real local container, mount the real API
 * router with `injectContainer`, and authenticate with real API keys, so the
 * assertions cover the auth middleware, the graph-context resolution and the
 * route wiring rather than a mocked express.
 *
 * The entity threshold is set to 3 through `LOCAL_EXPORT_ASYNC_ENTITY_THRESHOLD`
 * so the Req 5.4 branch can be exercised with a handful of entities instead of
 * ten thousand.
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
import { IGraph } from '@/models/Graph';

describe('Export routes (request-level)', () => {
  let app: Express;
  let container: Container;
  let testDataDir: string;
  let exportKey: string;
  let restrictedKey: string;
  let smallGraph: IGraph;
  let largeGraph: IGraph;
  let versionedGraph: IGraph;
  let versionedLargeGraph: IGraph;

  beforeAll(async () => {
    testDataDir = path.join(os.tmpdir(), `export-routes-test-${process.pid}-${Date.now()}`);
    process.env.LOCAL_EXECUTION_ENABLED = 'true';
    process.env.LOCAL_DATA_DIR = testDataDir;
    process.env.LOCAL_GRAPH_FILE = 'export-routes-graph.json';
    process.env.LOCAL_BACKUP_ENABLED = 'false';
    process.env.LOCAL_MAX_MEMORY_MB = '64';
    // Req 5.4 threshold, lowered so the async branch is reachable here.
    process.env.LOCAL_EXPORT_ASYNC_ENTITY_THRESHOLD = '3';
    // In-memory ceiling, lowered so `largeGraph` (estimated 3,500 bytes) is
    // refused by `exportGraph` while the streaming job path still exports it.
    process.env.LOCAL_EXPORT_MAX_IN_MEMORY_BYTES = '3200';

    await fs.mkdir(testDataDir, { recursive: true });

    const config = loadConfig();
    expect(config.localExecution.exportAsyncEntityThreshold).toBe(3);
    const dbManager = initializeDatabaseManager(config.database);
    container = initializeContainer(dbManager, config);
    await container.initialize();

    const keyResponse = await container.authService.createApiKey({
      name: 'Export Routes Key',
      permissions: ['read:graphs', 'write:graphs', 'export'],
    });
    exportKey = keyResponse.key;


    smallGraph = await container.graphService.createGraph({ name: 'Export Route Small' });
    await container.graphRepository.commitChanges(
      smallGraph.id,
      {
        added: [
          {
            type: 'event',
            id: 'event-1',
            data: {
              id: 'event-1',
              description: 'Battle of Austerlitz',
              actor: 'Napoleon',
              target: 'Coalition',
              timestamp: '1805-12-02T00:00:00Z',
            },
          },
          {
            type: 'event',
            id: 'event-2',
            data: {
              id: 'event-2',
              description: 'Battle of Waterloo',
              actor: 'Wellington',
              target: 'Napoleon',
              timestamp: '1815-06-18T00:00:00Z',
            },
          },
        ],
        modified: [],
        deleted: [],
      },
      'create',
      'seed small graph'
    );

    // Same permissions, but scoped to one graph: used to prove a key cannot see
    // another graph's export jobs.
    const restrictedResponse = await container.authService.createApiKey({
      name: 'Export Routes Restricted Key',
      permissions: ['read:graphs', 'export'],
      allowedGraphs: [smallGraph.id],
    });
    restrictedKey = restrictedResponse.key;

    // 2 events + 1 arc + 1 relationship = 4 entities, above the threshold of 3.
    largeGraph = await container.graphService.createGraph({ name: 'Export Route Large' });
    await container.graphRepository.commitChanges(
      largeGraph.id,
      {
        added: [
          {
            type: 'event',
            id: 'event-1',
            data: {
              id: 'event-1',
              description: 'Battle of Austerlitz',
              actor: 'Napoleon',
              target: 'Coalition',
              timestamp: '1805-12-02T00:00:00Z',
            },
          },
          {
            type: 'event',
            id: 'event-2',
            data: {
              id: 'event-2',
              description: 'Treaty of Tilsit',
              actor: 'Napoleon',
              target: 'Prussia',
              timestamp: '1807-07-07T00:00:00Z',
            },
          },
          {
            type: 'arc',
            id: 'arc-1',
            data: {
              id: 'arc-1',
              name: 'Napoleonic Wars',
              description: 'European conflicts',
              start_time: '1803-05-18',
              end_time: '1815-11-20',
              level: 0,
              parent_arc_id: null,
            },
          },
          {
            type: 'relationship',
            id: 'rel-1',
            data: {
              id: 'rel-1',
              cause_event_id: 'event-1',
              effect_event_id: 'event-2',
              weight: 0.8,
              evidence: 'Victory led to diplomatic advantage',
              confidence: 0.9,
              relationship_type: 'direct',
            },
          },
        ],
        modified: [],
        deleted: [],
      },
      'create',
      'seed large graph'
    );

    // Two commits, so a pinned export and the head hold different data.
    versionedGraph = await container.graphService.createGraph({ name: 'Export Route Versioned' });
    await container.graphRepository.commitChanges(
      versionedGraph.id,
      {
        added: [
          {
            type: 'event',
            id: 'v0-event-1',
            data: {
              id: 'v0-event-1',
              description: 'First version event',
              actor: 'A',
              target: 'B',
              timestamp: '1700-01-01T00:00:00Z',
            },
          },
          {
            type: 'event',
            id: 'v0-event-2',
            data: {
              id: 'v0-event-2',
              description: 'Second version event',
              actor: 'A',
              target: 'C',
              timestamp: '1701-01-01T00:00:00Z',
            },
          },
        ],
        modified: [],
        deleted: [],
      },
      'create',
      'v0'
    );
    await container.graphRepository.commitChanges(
      versionedGraph.id,
      {
        // Modified, not added: the head must differ from v0 without pushing the
        // estimate over the lowered in-memory ceiling this suite configures.
        added: [],
        modified: [
          {
            type: 'event',
            id: 'v0-event-2',
            data: {
              id: 'v0-event-2',
              description: 'Second version event, edited at the head',
              actor: 'A',
              target: 'C',
              timestamp: '1701-01-01T00:00:00Z',
            },
          },
        ],
        deleted: [],
      },
      'create',
      'v1'
    );

    // Above the threshold at v0 (4 > 3) but different again at the head (5),
    // so the async path can be checked for the version it carries.
    versionedLargeGraph = await container.graphService.createGraph({
      name: 'Export Route Versioned Large',
    });
    await container.graphRepository.commitChanges(
      versionedLargeGraph.id,
      {
        added: [
          {
            type: 'event',
            id: 'event-1',
            data: {
              id: 'event-1',
              description: 'Large v0 event one',
              actor: 'A',
              target: 'B',
              timestamp: '1800-01-01T00:00:00Z',
            },
          },
          {
            type: 'event',
            id: 'event-2',
            data: {
              id: 'event-2',
              description: 'Large v0 event two',
              actor: 'C',
              target: 'D',
              timestamp: '1801-01-01T00:00:00Z',
            },
          },
          {
            type: 'arc',
            id: 'arc-1',
            data: {
              id: 'arc-1',
              name: 'Large v0 arc',
              description: 'Arc',
              start_time: '1800-01-01',
              end_time: '1802-01-01',
              level: 0,
              parent_arc_id: null,
            },
          },
          {
            type: 'relationship',
            id: 'rel-1',
            data: {
              id: 'rel-1',
              cause_event_id: 'event-1',
              effect_event_id: 'event-2',
              weight: 0.5,
              evidence: 'Evidence',
              confidence: 0.7,
              relationship_type: 'direct',
            },
          },
        ],
        modified: [],
        deleted: [],
      },
      'create',
      'v0'
    );
    await container.graphRepository.commitChanges(
      versionedLargeGraph.id,
      {
        added: [
          {
            type: 'event',
            id: 'event-3',
            data: {
              id: 'event-3',
              description: 'Large head-only event',
              actor: 'E',
              target: 'F',
              timestamp: '1803-01-01T00:00:00Z',
            },
          },
        ],
        modified: [],
        deleted: [],
      },
      'create',
      'v1'
    );

    app = express();
    app.use(express.json());
    app.use(injectContainer);
    app.use('/api', apiRouter);
    app.use(errorHandler);
  });

  afterAll(async () => {
    await cleanupContainer();

    delete process.env.LOCAL_EXPORT_ASYNC_ENTITY_THRESHOLD;

    try {
      await fs.rm(testDataDir, { recursive: true, force: true });
    } catch {
      // Cleanup is best-effort.
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('authentication', () => {
    it('rejects an unauthenticated export with 401', async () => {
      const response = await request(app).get('/api/export').expect(401);
      expect(response.body.error.message).toBe('API key is required');
    });
  });

  describe('GET /api/export', () => {
    it('returns the export document itself for a graph under the entity threshold', async () => {
      const response = await request(app)
        .get('/api/export')
        .set('X-API-Key', exportKey)
        .set('X-Graph-Id', smallGraph.id)
        .expect(200);

      // The design specifies the export document, not a response envelope.
      expect(response.body.success).toBeUndefined();
      expect(response.body.version).toBe('1.0');
      expect(response.body.metadata.graphId).toBe(smallGraph.id);
      expect(response.body.data.events).toHaveLength(2);
      expect(response.body.metadata.checksum).toHaveLength(64);
      expect(response.headers['content-disposition']).toContain('attachment');
    });

    it('answers 202 with an export job above the entity threshold', async () => {
      const response = await request(app)
        .get('/api/export')
        .set('X-API-Key', exportKey)
        .set('X-Graph-Id', largeGraph.id)
        .expect(202);

      expect(response.body.success).toBe(true);
      expect(response.body.data.jobId).toBeDefined();
      expect(response.body.data.entityCount).toBe(4);
      expect(response.body.message).toContain('above the 3-entity synchronous limit');
    });

    it('applies filters[...] query parameters', async () => {
      const response = await request(app)
        .get('/api/export')
        .query({ scope: 'filtered', 'filters[actors]': 'Napoleon' })
        .set('X-API-Key', exportKey)
        .set('X-Graph-Id', smallGraph.id)
        .expect(200);

      expect(response.body.data.events).toHaveLength(1);
      expect(response.body.data.events[0].actor).toBe('Napoleon');
      expect(response.body.metadata.filters).toEqual({ actors: ['Napoleon'] });
    });

    it('accepts a JSON-encoded filters query parameter', async () => {
      const response = await request(app)
        .get('/api/export')
        .query({
          scope: 'filtered',
          filters: JSON.stringify({ eventIds: ['event-1', 'event-2'] }),
        })
        .set('X-API-Key', exportKey)
        .set('X-Graph-Id', smallGraph.id)
        .expect(200);

      expect(response.body.data.events).toHaveLength(2);
    });

    it('requires filters when scope is filtered', async () => {
      const response = await request(app)
        .get('/api/export')
        .query({ scope: 'filtered' })
        .set('X-API-Key', exportKey)
        .set('X-Graph-Id', smallGraph.id)
        .expect(400);

      expect(response.body.error.message).toContain('Filters are required');
    });

    it('rejects a graphId query that contradicts the resolved scope', async () => {
      const response = await request(app)
        .get('/api/export')
        .query({ graphId: largeGraph.id })
        .set('X-API-Key', exportKey)
        .set('X-Graph-Id', smallGraph.id)
        .expect(400);

      expect(response.body.error.message).toContain('contradicts');
    });

    it('pins the export to a committed version with ?version', async () => {
      const response = await request(app)
        .get('/api/export')
        .query({ version: 0 })
        .set('X-API-Key', exportKey)
        .set('X-Graph-Id', smallGraph.id)
        .expect(200);

      expect(response.body.data.events).toHaveLength(2);
    });

    it('pins the inline export to the requested version', async () => {
      const pinned = await request(app)
        .get('/api/export')
        .query({ version: 0 })
        .set('X-API-Key', exportKey)
        .set('X-Graph-Id', versionedGraph.id)
        .expect(200);

      expect(pinned.body.metadata.graphVersion).toBe(0);
      expect(
        pinned.body.data.events.find((e: { id: string }) => e.id === 'v0-event-2').description
      ).toBe('Second version event');

      const head = await request(app)
        .get('/api/export')
        .set('X-API-Key', exportKey)
        .set('X-Graph-Id', versionedGraph.id)
        .expect(200);

      expect(head.body.metadata.graphVersion).toBe(1);
      expect(
        head.body.data.events.find((e: { id: string }) => e.id === 'v0-event-2').description
      ).toBe('Second version event, edited at the head');
    });

    it('carries the pinned version into an async export job', async () => {
      const response = await request(app)
        .get('/api/export')
        .query({ version: 0 })
        .set('X-API-Key', exportKey)
        .set('X-Graph-Id', versionedLargeGraph.id)
        .expect(202);

      const job = await container.jobService.getJob(response.body.data.jobId);
      expect(job?.parameters).toMatchObject({ type: 'export', version: 0 });
    });

    it('answers 404 for a version that does not exist', async () => {
      const response = await request(app)
        .get('/api/export')
        .query({ version: 99 })
        .set('X-API-Key', exportKey)
        .set('X-Graph-Id', smallGraph.id)
        .expect(404);

      expect(response.body.error.message).toContain('Graph version 99 not found');
    });

    it('rejects filters when the scope is full', async () => {
      const response = await request(app)
        .get('/api/export')
        .query({ scope: 'full', 'filters[actors]': 'Napoleon' })
        .set('X-API-Key', exportKey)
        .set('X-Graph-Id', smallGraph.id)
        .expect(400);

      expect(response.body.error.message).toContain('only applied when scope is');
    });

    it('rejects a malformed version', async () => {
      const response = await request(app)
        .get('/api/export')
        .query({ version: 'latest' })
        .set('X-API-Key', exportKey)
        .set('X-Graph-Id', smallGraph.id)
        .expect(400);

      expect(response.body.error.message).toContain('version must be a non-negative integer');
    });

    it('rejects an invalid scope', async () => {
      const response = await request(app)
        .get('/api/export')
        .query({ scope: 'partial' })
        .set('X-API-Key', exportKey)
        .set('X-Graph-Id', smallGraph.id)
        .expect(400);

      expect(response.body.error.message).toContain('Scope must be');
    });

    it('rejects an invalid includeProvenance value', async () => {
      const response = await request(app)
        .get('/api/export')
        .query({ includeProvenance: 'yes' })
        .set('X-API-Key', exportKey)
        .set('X-Graph-Id', smallGraph.id)
        .expect(400);

      expect(response.body.error.message).toContain('includeProvenance');
    });
  });

  describe('async export of a graph above the threshold', () => {
    it('creates a job that completes with the full document', async () => {
      const response = await request(app)
        .get('/api/export')
        .set('X-API-Key', exportKey)
        .set('X-Graph-Id', largeGraph.id)
        .expect(202);

      const jobId: string = response.body.data.jobId;

      // This is the failure being fixed, stated in full: the same options are
      // refused by the in-memory API and delivered by the streaming job.
      const options = {
        graphId: largeGraph.id,
        scope: 'full' as const,
        includeProvenance: false,
      };
      const estimate = await container.exportService.estimateExportSize(options);
      expect(estimate).toBeGreaterThan(container.exportService.maxInMemorySize);
      await expect(container.exportService.exportGraph(options)).rejects.toThrow(
        'too large for in-memory operation'
      );

      // The worker polls on an interval; this container polls immediately on
      // `start()`, so the job is usually done on the first pass.
      const deadline = Date.now() + 10_000;
      let job = await container.jobService.getJob(jobId);
      while (job && job.status !== 'completed' && job.status !== 'failed' && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        job = await container.jobService.getJob(jobId);
      }

      // The original defect: a 202 followed by "export too large for in-memory
      // operation, use the async export job you just created".
      expect(job?.status).toBe('completed');

      const download = await request(app)
        .get(`/api/export/jobs/${jobId}/download`)
        .set('X-API-Key', exportKey)
        .expect(200);

      const document = JSON.parse(download.text) as { data: { events: unknown[] } };
      expect(document.data.events).toHaveLength(2);
    }, 20_000);
  });

  describe('job access scoping', () => {
    it('hides, and refuses, another graph\'s export jobs', async () => {
      const job = await container.jobService.createExportJob({
        graphId: largeGraph.id,
        scope: 'full',
      });

      const list = await request(app)
        .get('/api/export/jobs')
        .set('X-API-Key', restrictedKey)
        .expect(200);
      expect(list.body.data.map((entry: { id: string }) => entry.id)).not.toContain(job.jobId);

      await request(app)
        .get(`/api/export/jobs/${job.jobId}`)
        .set('X-API-Key', restrictedKey)
        .expect(404);

      await request(app)
        .delete(`/api/export/jobs/${job.jobId}`)
        .set('X-API-Key', restrictedKey)
        .expect(404);

      // The download route is the one that actually returns data.
      await request(app)
        .get(`/api/export/jobs/${job.jobId}/download`)
        .set('X-API-Key', restrictedKey)
        .expect(404);

      // The unrestricted key still sees its job.
      const ownList = await request(app)
        .get('/api/export/jobs')
        .set('X-API-Key', exportKey)
        .expect(200);
      expect(ownList.body.data.map((entry: { id: string }) => entry.id)).toContain(job.jobId);
    });

    it('still lets a restricted key see its own graph\'s jobs', async () => {
      const own = await container.jobService.createExportJob({
        graphId: smallGraph.id,
        scope: 'full',
      });

      const list = await request(app)
        .get('/api/export/jobs')
        .set('X-API-Key', restrictedKey)
        .expect(200);
      expect(list.body.data.map((entry: { id: string }) => entry.id)).toContain(own.jobId);

      await request(app)
        .get(`/api/export/jobs/${own.jobId}`)
        .set('X-API-Key', restrictedKey)
        .expect(200);
    });

    it('does not expose a non-export job through the export routes', async () => {
      // Import rows share the store; this router must not answer for them.
      const importJob = await container.jobRepository.create({
        type: 'import',
        parameters: {
          type: 'import',
          graphId: smallGraph.id,
          mode: 'merge',
          conflictResolution: 'skip',
          dataChecksum: 'abc',
        },
        status: 'pending',
      });

      await request(app)
        .get(`/api/export/jobs/${importJob.id}`)
        .set('X-API-Key', exportKey)
        .expect(404);
    });

    it('counts only the calling key\'s jobs in /stats', async () => {
      await container.jobService.createExportJob({ graphId: largeGraph.id, scope: 'full' });

      const restricted = await request(app)
        .get('/api/export/stats')
        .set('X-API-Key', restrictedKey)
        .expect(200);
      const unrestricted = await request(app)
        .get('/api/export/stats')
        .set('X-API-Key', exportKey)
        .expect(200);

      expect(restricted.body.data.export.total).toBeLessThan(
        unrestricted.body.data.export.total
      );
    });
  });

  describe('the three export routes agree on the same input', () => {
    const send = async (
      route: 'get' | 'sync' | 'jobs',
      payload: Record<string, unknown> | undefined,
      query: Record<string, unknown> = {}
    ) => {
      const headers = { 'X-API-Key': exportKey, 'X-Graph-Id': smallGraph.id };
      if (route === 'get') {
        // Send the same JSON document the POSTs receive. Passing the object
        // directly would let qs re-serialize it field by field, which turns
        // `actors: [1]` into the string "1" and would compare different inputs.
        const asQuery = { ...payload, ...query };
        if (asQuery.filters !== undefined && typeof asQuery.filters === 'object') {
          asQuery.filters = JSON.stringify(asQuery.filters);
        }
        return request(app).get('/api/export').query(asQuery).set(headers);
      }
      const path = route === 'sync' ? '/api/export/sync' : '/api/export/jobs';
      const req = request(app).post(path).set(headers);
      return payload === undefined ? req.send({}) : req.send(payload);
    };

    it.each([
      // `scope: 'full'` with filters is a client error everywhere.
      ['full with filters', { scope: 'full', filters: { actors: ['Napoleon'] } }, 400],
      // `filtered` without filters is a client error everywhere.
      ['filtered without filters', { scope: 'filtered' }, 400],
      // A non-object `filters` must not be accepted as "no filter".
      ['non-object filters', { scope: 'filtered', filters: 'x' }, 400],
      // A non-string list entry must be rejected, not silently dropped.
      ['non-string actor', { scope: 'filtered', filters: { actors: [1] } }, 400],
      // includeProvenance must be a boolean or 'true'/'false'.
      ['bad includeProvenance', { scope: 'full', includeProvenance: 'yes' }, 400],
      // version must be a non-negative integer.
      ['bad version', { scope: 'full', version: 'latest' }, 400],
    ])('rejects %s the same way on GET, POST /sync and POST /jobs', async (_label, payload, status) => {
      for (const route of ['get', 'sync', 'jobs'] as const) {
        const response = await send(route, payload);
        expect({ route, status: response.status }).toEqual({ route, status });
      }
    });

    it.each(['sync', 'jobs'] as const)(
      'rejects a body with no scope on POST /%s',
      async (route) => {
        const response = await send(route, {});
        expect(response.status).toBe(400);
        expect(response.body.error.message).toContain('Scope must be');
      }
    );

    it.each(['sync', 'jobs'] as const)(
      'normalises a comma-separated filter list on POST /%s',
      async (route) => {
        // Same input, same normalisation as the query-string parser.
        const response = await send(route, {
          scope: 'filtered',
          filters: { actors: 'Napoleon' },
        });
        expect(response.status).toBeLessThan(300);
      }
    );
  });

  describe('POST /api/export/jobs', () => {
    it('rejects a version that does not exist without creating a job', async () => {
      const before = await request(app)
        .get('/api/export/jobs')
        .set('X-API-Key', exportKey)
        .expect(200);

      const response = await request(app)
        .post('/api/export/jobs')
        .set('X-API-Key', exportKey)
        .set('X-Graph-Id', smallGraph.id)
        .send({ scope: 'full', version: 99 })
        .expect(404);

      expect(response.body.error.message).toContain('Graph version 99 not found');

      // The pre-check must run before `create`: a 404 that still left a pending
      // job behind would be a leak, not a rejection.
      const after = await request(app)
        .get('/api/export/jobs')
        .set('X-API-Key', exportKey)
        .expect(200);
      expect(after.body.pagination.total).toBe(before.body.pagination.total);
    });

    it('rejects filters with scope "full"', async () => {
      const response = await request(app)
        .post('/api/export/jobs')
        .set('X-API-Key', exportKey)
        .set('X-Graph-Id', smallGraph.id)
        .send({ scope: 'full', filters: { actors: ['Napoleon'] } })
        .expect(400);

      expect(response.body.error.message).toContain('only applied when scope is');
    });

    it('rejects a non-boolean includeProvenance', async () => {
      const response = await request(app)
        .post('/api/export/jobs')
        .set('X-API-Key', exportKey)
        .set('X-Graph-Id', smallGraph.id)
        .send({ scope: 'full', includeProvenance: 'yes' })
        .expect(400);

      expect(response.body.error.message).toContain('includeProvenance');
    });

    it('carries a body version into the job', async () => {
      const response = await request(app)
        .post('/api/export/jobs')
        .set('X-API-Key', exportKey)
        .set('X-Graph-Id', versionedLargeGraph.id)
        .send({ scope: 'full', version: 0 })
        .expect(202);

      const job = await container.jobService.getJob(response.body.data.jobId);
      expect(job?.parameters).toMatchObject({ type: 'export', version: 0 });
    });

    it('rejects a non-integer body version', async () => {
      const response = await request(app)
        .post('/api/export/jobs')
        .set('X-API-Key', exportKey)
        .set('X-Graph-Id', smallGraph.id)
        .send({ scope: 'full', version: 'latest' })
        .expect(400);

      expect(response.body.error.message).toContain('version must be a non-negative integer');
    });

    it('rejects a webhook target that is not publicly routable', async () => {
      const response = await request(app)
        .post('/api/export/jobs')
        .set('X-API-Key', exportKey)
        .set('X-Graph-Id', smallGraph.id)
        .send({ scope: 'full', webhook: 'http://127.0.0.1:9000/hook' })
        .expect(400);

      expect(response.body.error.message).toContain('private or loopback');
    });
  });

  describe('POST /api/export/sync', () => {
    it('rejects an export above the entity threshold and names the job endpoints', async () => {
      const response = await request(app)
        .post('/api/export/sync')
        .set('X-API-Key', exportKey)
        .set('X-Graph-Id', largeGraph.id)
        .send({ scope: 'full' })
        .expect(400);

      expect(response.body.error.message).toContain('4 entities');
      expect(response.body.error.message).toContain('POST /export/jobs');
      expect(response.body.error.message).toContain('GET /export');
    });

    it('requires filters when scope is "filtered"', async () => {
      const response = await request(app)
        .post('/api/export/sync')
        .set('X-API-Key', exportKey)
        .set('X-Graph-Id', smallGraph.id)
        .send({ scope: 'filtered' })
        .expect(400);

      expect(response.body.error.message).toContain('Filters are required');
    });

    it('pins a body version to that tree', async () => {
      const response = await request(app)
        .post('/api/export/sync')
        .set('X-API-Key', exportKey)
        .set('X-Graph-Id', versionedGraph.id)
        .send({ scope: 'full', version: 0 })
        .expect(200);

      expect(response.body.data.data.events).toHaveLength(2);
      expect(response.body.data.metadata.graphVersion).toBe(0);
    });

    it('still serves a small graph synchronously', async () => {
      const response = await request(app)
        .post('/api/export/sync')
        .set('X-API-Key', exportKey)
        .set('X-Graph-Id', smallGraph.id)
        .send({ scope: 'full' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.data.events).toHaveLength(2);
    });
  });
});
