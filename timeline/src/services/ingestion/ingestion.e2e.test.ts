/**
 * End-to-end ingestion test.
 *
 * Drives the real route + orchestrator + Wikipedia extractor + `ImportService`
 * over a temporary data directory. The fakes are the HTTP client, which replays
 * the recorded MediaWiki fixture (so no network is used), and the two auth
 * middleware pieces that need the live container: `authenticate` (which injects
 * a real `ApiKey`) and `resolveGraphContext` (which reads `X-Graph-Id`). The
 * permission and graph-scope middleware are the real implementations, so the
 * scope-refusal and job-ownership tests below exercise production checks.
 *
 * The assertion that matters: an ingested Wikipedia article becomes an entity in
 * the graph's version store, readable back through `GraphRepository.checkout`.
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

/** Mutable auth state so a key can be scoped to the graph a test just created. */
const authConfig = vi.hoisted(() => ({
  scopedKey: 'valid-ingest-key',
  otherKey: 'other-ingest-key',
  allowedGraphs: ['*'] as string[] | '*',
}));

vi.mock('@/api/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/api/middleware')>('@/api/middleware');
  const { ApiKey } = await import('@/models/ApiKey');

  const makeKey = (id: string, keyPrefix: string, allowedGraphs: string[] | '*') =>
    new ApiKey({
      id,
      name: `key ${id}`,
      keyHash: `hash-${id}`,
      keyPrefix,
      permissions: ['ingest'],
      allowedGraphs,
    });

  return {
    ...actual,
    authenticate: (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
      const presented = req.get('X-API-Key');
      if (presented === authConfig.scopedKey) {
        req.apiKey = makeKey('key-scoped', 'scoped-key', authConfig.allowedGraphs);
        req.isAuthenticated = true;
      } else if (presented === authConfig.otherKey) {
        req.apiKey = makeKey('key-other', 'other-key-', '*');
        req.isAuthenticated = true;
      } else {
        req.apiKey = undefined;
        req.isAuthenticated = false;
      }
      next();
    },
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
    authConfig.allowedGraphs = [graphId];

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
      .set('X-API-Key', authConfig.scopedKey)
      .set('X-Graph-Id', graphId)
      .send({ url: 'https://en.wikipedia.org/wiki/Battle_of_Hastings' });

    expect(ingestResponse.status).toBe(200);
    expect(ingestResponse.body.extraction.events.length).toBeGreaterThan(0);
    expect(httpClient.urls[0]).toContain('en.wikipedia.org');

    const jobId = ingestResponse.body.jobId as string;

    const approveResponse = await request(app)
      .post(`/api/ingest/jobs/${jobId}/approve`)
      .set('X-API-Key', authConfig.scopedKey)
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

  it('refuses to import into a graph outside the key scope', async () => {
    const ingestResponse = await request(app)
      .post('/api/ingest/url')
      .set('X-API-Key', authConfig.scopedKey)
      .set('X-Graph-Id', graphId)
      .send({ url: 'https://en.wikipedia.org/wiki/Battle_of_Hastings' });

    const approveResponse = await request(app)
      .post(`/api/ingest/jobs/${ingestResponse.body.jobId}/approve`)
      .set('X-API-Key', authConfig.scopedKey)
      .set('X-Graph-Id', 'graph-outside-the-scope')
      .send({});

    expect(approveResponse.status).toBe(403);

    // Nothing reached the graph the job was created against either.
    const reader = new GraphRepository({ dataDir });
    await reader.initialize();
    const data = await reader.checkout(graphId);
    expect(Object.keys(data.events)).toHaveLength(0);
  });

  it('keeps a job readable only by the key that created it', async () => {
    const ingestResponse = await request(app)
      .post('/api/ingest/url')
      .set('X-API-Key', authConfig.scopedKey)
      .set('X-Graph-Id', graphId)
      .send({ url: 'https://en.wikipedia.org/wiki/Battle_of_Hastings' });
    const jobId = ingestResponse.body.jobId as string;

    const strangerPreview = await request(app)
      .get(`/api/ingest/jobs/${jobId}/preview`)
      .set('X-API-Key', authConfig.otherKey);
    expect(strangerPreview.status).toBe(404);

    const strangerApprove = await request(app)
      .post(`/api/ingest/jobs/${jobId}/approve`)
      .set('X-API-Key', authConfig.otherKey)
      .set('X-Graph-Id', graphId)
      .send({});
    expect(strangerApprove.status).toBe(404);

    const ownerPreview = await request(app)
      .get(`/api/ingest/jobs/${jobId}/preview`)
      .set('X-API-Key', authConfig.scopedKey);
    expect(ownerPreview.status).toBe(200);
    expect(ownerPreview.body.jobId).toBe(jobId);
  });
});
