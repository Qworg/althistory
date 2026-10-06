/**
 * Route-level tests for the ingestion API.
 *
 * The auth middleware is stubbed only where it needs a live container:
 * `authenticate` injects a real `ApiKey` for the presented key id, and
 * `resolveGraphContext` reads `X-Graph-Id` instead of querying the container.
 * `requireAuth`, `authorize` and `authorizeGraphAccess` are the real
 * implementations, so the 401/403 cases below exercise the real permission and
 * graph-scope checks: the 403 test fails if the route stops asking for `ingest`,
 * and the graph-scope test fails if the scope check is skipped.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from '@/api/middleware';
import { ImportOptions, ImportResult } from '@/services/ImportService';
import { AlthistoryExport } from '@/services/ExportService';
import {
  ImportExecutor,
  IngestionOrchestrator,
} from '@/services/ingestion/IngestionOrchestrator';
import {
  ExtractedEvent,
  ExtractionResult,
  Extractor,
  TextExtractionInput,
  WikidataExtractionInput,
  WikipediaExtractionInput,
} from '@/services/ingestion/types';

vi.mock('@/api/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/api/middleware')>('@/api/middleware');
  const { ApiKey } = await import('@/models/ApiKey');

  // Real keys with real permission lists and real graph scopes. `key-ingest`
  // holds only `ingest`, so the 403 test below cannot pass because the route
  // asked for some other permission it also lacks.
  const keys = new Map([
    [
      'valid-ingest-key',
      new ApiKey({
        id: 'key-ingest',
        name: 'ingest key',
        keyHash: 'hash-ingest',
        keyPrefix: 'ingest-key-',
        permissions: ['ingest'],
        allowedGraphs: ['graph-1'],
      }),
    ],
    [
      'no-ingest-key',
      new ApiKey({
        id: 'key-read',
        name: 'read-only key',
        keyHash: 'hash-read',
        keyPrefix: 'read-only-',
        permissions: ['read:events'],
        allowedGraphs: '*',
      }),
    ],
    [
      'other-graph-key',
      new ApiKey({
        id: 'key-other-graph',
        name: 'other graph key',
        keyHash: 'hash-other',
        keyPrefix: 'other-grap',
        permissions: ['ingest'],
        allowedGraphs: ['graph-9'],
      }),
    ],
  ]);

  return {
    ...actual,
    authenticate: (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
      const presented = req.get('X-API-Key');
      const apiKey = presented ? keys.get(presented) : undefined;
      req.isAuthenticated = apiKey !== undefined;
      req.apiKey = apiKey;
      next();
    },
    // The one stub: graph existence lives in the container, and graph-context
    // resolution has its own suite (`graph-context.test.ts`). The value it
    // writes is what the real `authorizeGraphAccess` then checks.
    resolveGraphContext: () => (req: Request, res: Response, next: NextFunction) => {
      const graphId = req.get('X-Graph-Id');
      if (!graphId) {
        res.status(404).json({ error: { message: 'No graph context available' } });
        return;
      }
      req.graphId = graphId;
      next();
    },
  };
});

// Imported after the mock so the route file picks up the stubbed middleware.
import { createIngestRouter } from '@/api/routes/ingest';
import { apiRouter } from '@/api/routes';
import { errorHandler } from '@/api/middleware';

function makeEvent(): ExtractedEvent {
  return {
    tempId: 'event-1',
    description: 'An event',
    actor: 'Actor',
    target: 'Target',
    timestamp: '1066-10-14T00:00:00Z',
    confidence: 0.9,
    source: { type: 'text', extractedAt: '2020-01-01T00:00:00Z' },
    selected: true,
    edited: false,
  };
}

function makeExtraction(): ExtractionResult {
  return {
    events: [makeEvent()],
    arcs: [],
    relationships: [],
    sources: [],
    overallConfidence: 0.9,
  };
}

function makeImportExecutor(): ImportExecutor {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    executeImport: vi.fn(async (_data: AlthistoryExport, options: ImportOptions): Promise<ImportResult> => ({
      success: true,
      graphId: options.graphId ?? 'graph-1',
      graphVersion: 1,
      imported: { events: 1, arcs: 0, relationships: 0, pressures: 0 },
      skipped: { events: 0, arcs: 0, relationships: 0, pressures: 0 },
      deleted: { events: 0, arcs: 0, relationships: 0, pressures: 0 },
      errors: [],
      warnings: [],
    })),
  };
}

function buildApp(): express.Application {
  const extraction = makeExtraction();
  const extractors = {
    wikipedia: { sourceType: 'wikipedia', extract: vi.fn().mockResolvedValue(extraction) } as Extractor<WikipediaExtractionInput>,
    wikidata: { sourceType: 'wikidata', extract: vi.fn().mockResolvedValue(extraction) } as Extractor<WikidataExtractionInput>,
    text: { sourceType: 'text', extract: vi.fn().mockResolvedValue(extraction) } as Extractor<TextExtractionInput>,
  };
  const orchestrator = new IngestionOrchestrator({
    extractors,
    importExecutor: makeImportExecutor(),
    idFactory: () => 'job-1',
  });

  const app = express();
  app.use(express.json());
  app.use((req: Request, _res, next) => {
    req.requestId = 'test-request-id';
    req.startTime = Date.now();
    next();
  });
  app.use('/api/ingest', createIngestRouter({ dataDir: '/tmp/unused', orchestrator }));
  app.use(errorHandler);
  return app;
}

const INGEST_KEY = 'valid-ingest-key';
const NO_INGEST_KEY = 'no-ingest-key';
const OTHER_GRAPH_KEY = 'other-graph-key';

describe('Ingestion routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = buildApp();
  });

  it('rejects an unauthenticated ingest request with 401', async () => {
    const response = await request(app).post('/api/ingest/text').send({ text: 'hello' });
    expect(response.status).toBe(401);
  });

  it('rejects an authenticated request without the ingest permission with 403', async () => {
    const response = await request(app)
      .post('/api/ingest/text')
      .set('X-API-Key', NO_INGEST_KEY)
      .send({ text: 'hello' });

    expect(response.status).toBe(403);
    // The refusal names `ingest`: the route asks for that specific permission,
    // not for the one this key happens to hold (`read:events`).
    expect(response.body.error.message).toContain('ingest');

    // And the same request succeeds with a key that holds only `ingest`, so the
    // 403 above is the permission check and not something else.
    const permitted = await request(app)
      .post('/api/ingest/text')
      .set('X-API-Key', INGEST_KEY)
      .send({ text: 'hello' });
    expect(permitted.status).toBe(200);
  });

  it('extracts text and returns a review preview', async () => {
    const response = await request(app)
      .post('/api/ingest/text')
      .set('X-API-Key', INGEST_KEY)
      .send({ text: 'The Battle of Hastings was fought in 1066.' });

    expect(response.status).toBe(200);
    expect(response.body.jobId).toBe('job-1');
    expect(response.body.status).toBe('review');
    expect(response.body.extraction.events).toHaveLength(1);
  });

  it('rejects an empty text body with 400', async () => {
    const response = await request(app)
      .post('/api/ingest/text')
      .set('X-API-Key', INGEST_KEY)
      .send({ text: '   ' });
    expect(response.status).toBe(400);
  });

  it('returns the stored preview for a known job and 404 for an unknown one', async () => {
    await request(app)
      .post('/api/ingest/text')
      .set('X-API-Key', INGEST_KEY)
      .send({ text: 'x' });

    const found = await request(app)
      .get('/api/ingest/jobs/job-1/preview')
      .set('X-API-Key', INGEST_KEY);
    expect(found.status).toBe(200);
    expect(found.body.jobId).toBe('job-1');

    const missing = await request(app)
      .get('/api/ingest/jobs/nope/preview')
      .set('X-API-Key', INGEST_KEY);
    expect(missing.status).toBe(404);
  });

  it('requires a graph context to approve', async () => {
    await request(app)
      .post('/api/ingest/text')
      .set('X-API-Key', INGEST_KEY)
      .send({ text: 'x' });

    const response = await request(app)
      .post('/api/ingest/jobs/job-1/approve')
      .set('X-API-Key', INGEST_KEY)
      .send({});
    expect(response.status).toBe(404);
  });

  it('imports approved entities into the resolved graph', async () => {
    await request(app)
      .post('/api/ingest/text')
      .set('X-API-Key', INGEST_KEY)
      .send({ text: 'x' });

    const response = await request(app)
      .post('/api/ingest/jobs/job-1/approve')
      .set('X-API-Key', INGEST_KEY)
      .set('X-Graph-Id', 'graph-1')
      .send({});
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, graphId: 'graph-1' });
  });

  it('refuses to approve into a graph the key is not scoped to', async () => {
    await request(app)
      .post('/api/ingest/text')
      .set('X-API-Key', INGEST_KEY)
      .send({ text: 'x' });

    const response = await request(app)
      .post('/api/ingest/jobs/job-1/approve')
      .set('X-API-Key', INGEST_KEY)
      .set('X-Graph-Id', 'graph-2')
      .send({});

    expect(response.status).toBe(403);
  });

  it('rejects a second approve of the same job with 409', async () => {
    await request(app)
      .post('/api/ingest/text')
      .set('X-API-Key', INGEST_KEY)
      .send({ text: 'x' });

    const first = await request(app)
      .post('/api/ingest/jobs/job-1/approve')
      .set('X-API-Key', INGEST_KEY)
      .set('X-Graph-Id', 'graph-1')
      .send({});
    expect(first.status).toBe(200);

    const second = await request(app)
      .post('/api/ingest/jobs/job-1/approve')
      .set('X-API-Key', INGEST_KEY)
      .set('X-Graph-Id', 'graph-1')
      .send({});
    expect(second.status).toBe(409);
  });

  it('rejects an approve body whose targetGraphId does not match the resolved graph', async () => {
    await request(app)
      .post('/api/ingest/text')
      .set('X-API-Key', INGEST_KEY)
      .send({ text: 'x' });

    const response = await request(app)
      .post('/api/ingest/jobs/job-1/approve')
      .set('X-API-Key', INGEST_KEY)
      .set('X-Graph-Id', 'graph-1')
      .send({ targetGraphId: 'graph-2' });
    expect(response.status).toBe(400);
  });

  it('does not expose, approve or delete another key job', async () => {
    const created = await request(app)
      .post('/api/ingest/text')
      .set('X-API-Key', INGEST_KEY)
      .send({ text: 'private pasted text' });
    expect(created.status).toBe(200);

    const preview = await request(app)
      .get('/api/ingest/jobs/job-1/preview')
      .set('X-API-Key', OTHER_GRAPH_KEY);
    expect(preview.status).toBe(404);
    expect(JSON.stringify(preview.body)).not.toContain('private pasted text');

    const status = await request(app)
      .get('/api/ingest/jobs/job-1')
      .set('X-API-Key', OTHER_GRAPH_KEY);
    expect(status.status).toBe(404);

    const approve = await request(app)
      .post('/api/ingest/jobs/job-1/approve')
      .set('X-API-Key', OTHER_GRAPH_KEY)
      .set('X-Graph-Id', 'graph-9')
      .send({});
    expect(approve.status).toBe(404);

    const deleted = await request(app)
      .delete('/api/ingest/jobs/job-1')
      .set('X-API-Key', OTHER_GRAPH_KEY);
    expect(deleted.status).toBe(200);
    expect(deleted.body.success).toBe(false);

    // The owner still sees the job: the other key's attempts changed nothing.
    const ownerPreview = await request(app)
      .get('/api/ingest/jobs/job-1/preview')
      .set('X-API-Key', INGEST_KEY);
    expect(ownerPreview.status).toBe(200);
  });

  it('deletes a review job', async () => {
    await request(app)
      .post('/api/ingest/text')
      .set('X-API-Key', INGEST_KEY)
      .send({ text: 'x' });

    const response = await request(app)
      .delete('/api/ingest/jobs/job-1')
      .set('X-API-Key', INGEST_KEY);
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it('is mounted on the main API router at /api/ingest', async () => {
    const mounted = express();
    mounted.use(express.json());
    mounted.use((req: Request, _res, next) => {
      req.requestId = 'mount-test';
      req.startTime = Date.now();
      next();
    });
    mounted.use('/api', apiRouter);
    mounted.use(errorHandler);

    // Unauthenticated: a mounted ingest route answers 401, an unmounted prefix
    // would fall through to the not-found handler instead.
    const response = await request(mounted).get('/api/ingest/jobs/nope');
    expect(response.status).toBe(401);
  });
});
