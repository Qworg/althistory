/**
 * Route-level tests for the ingestion API. Middleware auth is stubbed the same
 * way `batch.test.ts` does it, so the assertions here are about the route
 * contract and auth rejection, not the auth implementation.
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
  return {
    ...actual,
    authenticate: (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
      const key = req.get('X-API-Key');
      req.isAuthenticated = key === 'valid-ingest-key' || key === 'no-ingest-key';
      next();
    },
    requireAuth: (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      if (!req.isAuthenticated) {
        res.status(401).json({ error: { message: 'API key is required' } });
        return;
      }
      next();
    },
    authorize: () => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      const key = req.get('X-API-Key');
      if (key === 'valid-ingest-key') {
        next();
        return;
      }
      if (key === 'no-ingest-key') {
        res.status(403).json({ error: { message: 'Missing required permissions: ingest' } });
        return;
      }
      res.status(401).json({ error: { message: 'Authentication required' } });
    },
    authorizeGraphAccess: () => (_req: AuthenticatedRequest, _res: Response, next: NextFunction) => next(),
    resolveGraphContext: () => (req: Request, res: Response, next: NextFunction) => {
      const graphId = req.get('X-Graph-Id');
      if (!graphId) {
        res.status(404).json({ error: { message: 'No graph context available' } });
        return;
      }
      (req as Request & { graphId: string }).graphId = graphId;
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
      .set('X-API-Key', 'no-ingest-key')
      .send({ text: 'hello' });
    expect(response.status).toBe(403);
  });

  it('extracts text and returns a review preview', async () => {
    const response = await request(app)
      .post('/api/ingest/text')
      .set('X-API-Key', 'valid-ingest-key')
      .send({ text: 'The Battle of Hastings was fought in 1066.' });

    expect(response.status).toBe(200);
    expect(response.body.jobId).toBe('job-1');
    expect(response.body.status).toBe('review');
    expect(response.body.extraction.events).toHaveLength(1);
  });

  it('rejects an empty text body with 400', async () => {
    const response = await request(app)
      .post('/api/ingest/text')
      .set('X-API-Key', 'valid-ingest-key')
      .send({ text: '   ' });
    expect(response.status).toBe(400);
  });

  it('returns the stored preview for a known job and 404 for an unknown one', async () => {
    await request(app)
      .post('/api/ingest/text')
      .set('X-API-Key', 'valid-ingest-key')
      .send({ text: 'x' });

    const found = await request(app)
      .get('/api/ingest/jobs/job-1/preview')
      .set('X-API-Key', 'valid-ingest-key');
    expect(found.status).toBe(200);
    expect(found.body.jobId).toBe('job-1');

    const missing = await request(app)
      .get('/api/ingest/jobs/nope/preview')
      .set('X-API-Key', 'valid-ingest-key');
    expect(missing.status).toBe(404);
  });

  it('requires a graph context to approve', async () => {
    await request(app)
      .post('/api/ingest/text')
      .set('X-API-Key', 'valid-ingest-key')
      .send({ text: 'x' });

    const response = await request(app)
      .post('/api/ingest/jobs/job-1/approve')
      .set('X-API-Key', 'valid-ingest-key')
      .send({});
    expect(response.status).toBe(404);
  });

  it('imports approved entities into the resolved graph', async () => {
    await request(app)
      .post('/api/ingest/text')
      .set('X-API-Key', 'valid-ingest-key')
      .send({ text: 'x' });

    const response = await request(app)
      .post('/api/ingest/jobs/job-1/approve')
      .set('X-API-Key', 'valid-ingest-key')
      .set('X-Graph-Id', 'graph-1')
      .send({});
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, graphId: 'graph-1' });
  });

  it('rejects an approve body whose targetGraphId does not match the resolved graph', async () => {
    await request(app)
      .post('/api/ingest/text')
      .set('X-API-Key', 'valid-ingest-key')
      .send({ text: 'x' });

    const response = await request(app)
      .post('/api/ingest/jobs/job-1/approve')
      .set('X-API-Key', 'valid-ingest-key')
      .set('X-Graph-Id', 'graph-1')
      .send({ targetGraphId: 'graph-2' });
    expect(response.status).toBe(400);
  });

  it('deletes a review job', async () => {
    await request(app)
      .post('/api/ingest/text')
      .set('X-API-Key', 'valid-ingest-key')
      .send({ text: 'x' });

    const response = await request(app)
      .delete('/api/ingest/jobs/job-1')
      .set('X-API-Key', 'valid-ingest-key');
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
