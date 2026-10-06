/**
 * End-to-end ingestion test.
 *
 * Drives the real route + orchestrator + Wikipedia extractor + `ImportService`
 * over a temporary data directory. The only fake is the HTTP client, which
 * replays the recorded MediaWiki fixture, so no network is used. The assertion
 * that matters: an ingested Wikipedia article becomes an entity in the graph's
 * version store, readable back through `GraphRepository.checkout`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { AuthenticatedRequest } from '@/api/middleware';
import { GraphRepository } from '@/repositories/GraphRepository';
import { HttpClient, HttpRequest, HttpResponse } from '@/services/ingestion/http';
import wikipediaFixture from '@/services/ingestion/fixtures/wikipedia-battle-of-hastings.json';

vi.mock('@/api/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/api/middleware')>('@/api/middleware');
  return {
    ...actual,
    authenticate: (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
      req.isAuthenticated = req.get('X-API-Key') === 'valid-ingest-key';
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
      if (req.get('X-API-Key') !== 'valid-ingest-key') {
        res.status(403).json({ error: { message: 'Missing required permissions: ingest' } });
        return;
      }
      next();
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

import { createIngestRouter } from '@/api/routes/ingest';
import { errorHandler } from '@/api/middleware';

class FixtureHttpClient implements HttpClient {
  readonly urls: string[] = [];

  async request(request: HttpRequest): Promise<HttpResponse> {
    this.urls.push(request.url);
    return { status: 200, body: JSON.stringify(wikipediaFixture), headers: {} };
  }
}

describe('Ingestion end-to-end', () => {
  let dataDir: string;
  let graphId: string;
  let app: express.Application;
  let httpClient: FixtureHttpClient;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ingest-e2e-'));
    const graphRepository = new GraphRepository({ dataDir });
    await graphRepository.initialize();
    const graph = await graphRepository.create({ name: 'Ingestion E2E' });
    graphId = graph.id;

    httpClient = new FixtureHttpClient();
    app = express();
    app.use(express.json());
    app.use((req: Request, _res, next) => {
      req.requestId = 'e2e-request-id';
      req.startTime = Date.now();
      next();
    });
    app.use(
      '/api/ingest',
      createIngestRouter({ dataDir, httpClient, llmClient: null })
    );
    app.use(errorHandler);
  });

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('turns an ingested Wikipedia article into an entity in the graph version store', async () => {
    const ingestResponse = await request(app)
      .post('/api/ingest/url')
      .set('X-API-Key', 'valid-ingest-key')
      .set('X-Graph-Id', graphId)
      .send({ url: 'https://en.wikipedia.org/wiki/Battle_of_Hastings' });

    expect(ingestResponse.status).toBe(200);
    expect(ingestResponse.body.extraction.events.length).toBeGreaterThan(0);
    expect(httpClient.urls[0]).toContain('en.wikipedia.org');

    const jobId = ingestResponse.body.jobId as string;

    const approveResponse = await request(app)
      .post(`/api/ingest/jobs/${jobId}/approve`)
      .set('X-API-Key', 'valid-ingest-key')
      .set('X-Graph-Id', graphId)
      .send({});

    expect(approveResponse.status).toBe(200);
    expect(approveResponse.body.success).toBe(true);
    expect(approveResponse.body.imported.events).toBeGreaterThan(0);

    const reader = new GraphRepository({ dataDir });
    await reader.initialize();
    const data = await reader.checkout(graphId);
    const events = Object.values(data.events);

    expect(events.length).toBeGreaterThan(0);
    expect(
      events.some((event) => String(event.description).includes('Battle of Hastings'))
    ).toBe(true);
    expect(
      events.some((event) => String(event.timestamp).includes('1066'))
    ).toBe(true);
  });
});
