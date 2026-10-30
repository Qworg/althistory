/**
 * Request-level auth tests for the import routes.
 *
 * `import.test.ts` exercises the router with auth disabled or with a stand-in
 * validator. These mount it the way `routes.ts` does — with neither — against a
 * real local container and real API keys, so they exercise the real key check,
 * the `import` permission, graph scoping and job ownership. Before this suite
 * existed the production router accepted any non-empty `X-API-Key`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express, { Express } from 'express';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { loadConfig, initializeDatabaseManager } from '@/utils';
import { initializeContainer, cleanupContainer, Container } from '@/container';
import { errorHandler, injectContainer } from '@/api/middleware';
import { createImportRouter, ImportRouter } from '@/api/routes/import';
import { AlthistoryExport } from '@/services/ExportService';

function exportDocument(): AlthistoryExport {
  return {
    version: '1.0',
    metadata: {
      graphId: 'exported-graph',
      graphName: 'Exported Graph',
      exportedAt: new Date().toISOString(),
      sourceVersion: '1.0.0',
      graphVersion: 1,
      checksum: '', // Empty checksum skips validation
    },
    data: {
      events: [
        {
          id: 'event-1',
          description: 'An event',
          actor: 'Actor',
          target: 'Target',
          timestamp: '1066-10-14T00:00:00Z',
        },
      ],
      arcs: [],
      causalRelationships: [],
      inferredPressures: [],
    },
  };
}

describe('Import routes (real auth)', () => {
  let app: Express;
  let router: ImportRouter;
  let container: Container;
  let testDataDir: string;
  let graphA: string;
  let graphB: string;
  let importAnyKey: string;
  let otherImportKey: string;
  let importGraphAKey: string;
  let readOnlyKey: string;

  beforeAll(async () => {
    testDataDir = path.join(os.tmpdir(), `import-auth-routes-${process.pid}-${Date.now()}`);
    process.env.LOCAL_EXECUTION_ENABLED = 'true';
    process.env.LOCAL_DATA_DIR = testDataDir;
    process.env.LOCAL_GRAPH_FILE = 'import-auth-graph.json';
    process.env.LOCAL_BACKUP_ENABLED = 'false';
    // config.ts rejects anything below 64 MB
    process.env.LOCAL_MAX_MEMORY_MB = '64';

    await fs.mkdir(path.join(testDataDir, 'graphs'), { recursive: true });
    await fs.mkdir(path.join(testDataDir, 'jobs'), { recursive: true });

    const config = loadConfig();
    const dbManager = initializeDatabaseManager(config.database);
    container = initializeContainer(dbManager, config);
    await container.initialize();

    graphA = (await container.graphService.createGraph({ name: 'Import Auth A' })).id;
    graphB = (await container.graphService.createGraph({ name: 'Import Auth B' })).id;

    const createKey = async (
      name: string,
      permissions: Parameters<typeof container.authService.createApiKey>[0]['permissions'],
      allowedGraphs: string[] | '*' = '*'
    ): Promise<string> =>
      (await container.authService.createApiKey({ name, permissions, allowedGraphs })).key;

    importAnyKey = await createKey('Import any graph', ['import']);
    otherImportKey = await createKey('Another importer', ['import']);
    importGraphAKey = await createKey('Import graph A only', ['import'], [graphA]);
    readOnlyKey = await createKey('Read only', ['read:events']);

    // Configured as routes.ts configures it: no disableAuth, no validateApiKey.
    router = createImportRouter({ dataDir: testDataDir, disableRateLimit: true }) as ImportRouter;

    app = express();
    app.use(express.json({ limit: '50mb' }));
    app.use(injectContainer);
    app.use('/api/import', router);
    app.use(errorHandler);
  });

  afterAll(async () => {
    await router?.cleanup?.();
    await cleanupContainer();
    await fs.rm(testDataDir, { recursive: true, force: true }).catch(() => undefined);
  });

  describe('authentication and permission', () => {
    it('rejects a request without a key with 401', async () => {
      await request(app).post('/api/import/validate').send(exportDocument()).expect(401);
    });

    it('rejects a key that does not exist with 401', async () => {
      await request(app)
        .post('/api/import')
        .set('X-API-Key', 'any-string-at-all')
        .set('X-CSRF-Token', 'any-string-at-all')
        .send({ data: exportDocument(), targetGraphId: graphB, mode: 'merge' })
        .expect(401);
    });

    it('rejects a key without the import permission with 403', async () => {
      const response = await request(app)
        .post('/api/import/validate')
        .set('X-API-Key', readOnlyKey)
        .send(exportDocument())
        .expect(403);
      expect(JSON.stringify(response.body)).toContain('import');
    });

    it('accepts a key with the import permission', async () => {
      const response = await request(app)
        .post('/api/import/validate')
        .set('X-API-Key', importAnyKey)
        .send(exportDocument())
        .expect(200);
      expect(response.body.valid).toBe(true);
    });
  });

  describe('graph scoping', () => {
    it('refuses an import into a graph the key may not access', async () => {
      const response = await request(app)
        .post('/api/import')
        .set('X-API-Key', importGraphAKey)
        .send({ data: exportDocument(), targetGraphId: graphB, mode: 'merge' })
        .expect(403);
      expect(response.body.error.message).toContain(graphB);
    });

    it('refuses a preview against a graph the key may not access', async () => {
      await request(app)
        .post('/api/import/preview')
        .set('X-API-Key', importGraphAKey)
        .send({ data: exportDocument(), targetGraphId: graphB, mode: 'merge' })
        .expect(403);
    });

    it('refuses incremental validation against a graph the key may not access', async () => {
      await request(app)
        .post('/api/import/validate-incremental')
        .set('X-API-Key', importGraphAKey)
        .send({ graphId: graphB, additions: { events: [] } })
        .expect(403);
    });

    it('rejects a graph id that is not a string', async () => {
      await request(app)
        .post('/api/import/preview')
        .set('X-API-Key', importGraphAKey)
        .send({ data: exportDocument(), targetGraphId: [graphB], mode: 'merge' })
        .expect(400);
    });

    it('allows a preview against a graph the key may access', async () => {
      const response = await request(app)
        .post('/api/import/preview')
        .set('X-API-Key', importGraphAKey)
        .send({ data: exportDocument(), targetGraphId: graphA, mode: 'merge' });
      expect([401, 403]).not.toContain(response.status);
    });
  });

  describe('job ownership', () => {
    it('shows and cancels a job only for the key that started it', async () => {
      const started = await request(app)
        .post('/api/import')
        .set('X-API-Key', importAnyKey)
        .send({ data: exportDocument(), mode: 'create-new', async: true })
        .expect(202);
      const jobId: string = started.body.jobId;

      await request(app)
        .get(`/api/import/jobs/${jobId}`)
        .set('X-API-Key', otherImportKey)
        .expect(404);
      await request(app)
        .post(`/api/import/jobs/${jobId}/cancel`)
        .set('X-API-Key', otherImportKey)
        .expect(404);

      const own = await request(app)
        .get(`/api/import/jobs/${jobId}`)
        .set('X-API-Key', importAnyKey)
        .expect(200);
      expect(own.body.id).toBe(jobId);
    });
  });
});
