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
  let smallGraph: IGraph;
  let largeGraph: IGraph;

  beforeAll(async () => {
    testDataDir = path.join(os.tmpdir(), `export-routes-test-${process.pid}-${Date.now()}`);
    process.env.LOCAL_EXECUTION_ENABLED = 'true';
    process.env.LOCAL_DATA_DIR = testDataDir;
    process.env.LOCAL_GRAPH_FILE = 'export-routes-graph.json';
    process.env.LOCAL_BACKUP_ENABLED = 'false';
    process.env.LOCAL_MAX_MEMORY_MB = '64';
    // Req 5.4 threshold, lowered so the async branch is reachable here.
    process.env.LOCAL_EXPORT_ASYNC_ENTITY_THRESHOLD = '3';

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
