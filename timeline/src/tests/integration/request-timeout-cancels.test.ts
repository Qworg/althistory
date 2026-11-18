/**
 * A request that is answered 408 saved nothing (issue 44), in local mode.
 *
 * `requestTimeout` used to answer 408 and let the request carry on: the write
 * landed a moment later, a client that retried wrote it twice, and the late
 * reply logged "Cannot set headers after they are sent". These tests mount the
 * real routes behind `requestTimeout` with a tiny budget and a middleware that
 * makes the request slow, and check:
 *
 * - the 408 left no event, no link and no version behind, and logged no
 *   "Cannot set headers";
 * - the retry then writes exactly one;
 * - a write that was already committing when the timer fired is not cut in
 *   half: the live store and the version store both hold it, and the request
 *   gets its real reply instead of a false 408.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express, { Express, NextFunction, Request, Response } from 'express';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { loadConfig, initializeDatabaseManager } from '@/utils';
import { initializeContainer, cleanupContainer, Container } from '@/container';
import { apiRouter } from '@/api/routes';
import { errorHandler, injectContainer, requestTimeout } from '@/api/middleware';

const BUDGET_MS = 300;
const SLOW_MS = 700;

describe('A 408 means nothing was saved (local mode)', () => {
  let app: Express;
  let container: Container;
  let testDataDir: string;
  let graphId: string;
  let logged: string[];

  beforeAll(async () => {
    testDataDir = path.join(os.tmpdir(), `request-timeout-cancels-${process.pid}-${Date.now()}`);
    process.env.LOCAL_EXECUTION_ENABLED = 'true';
    process.env.LOCAL_DATA_DIR = testDataDir;
    process.env.LOCAL_GRAPH_FILE = 'request-timeout-cancels.json';
    process.env.LOCAL_BACKUP_ENABLED = 'false';
    process.env.LOCAL_MAX_MEMORY_MB = '64';
    await fs.mkdir(testDataDir, { recursive: true });

    const config = loadConfig();
    const dbManager = initializeDatabaseManager(config.database);
    container = initializeContainer(dbManager, config);
    await container.initialize();

    app = express();
    app.use(express.json());
    app.use(injectContainer);
    app.use(requestTimeout(BUDGET_MS));
    // `X-Slow: before` holds the request up before it reaches the route, as a
    // slow read or a queue would.
    app.use((req: Request, _res: Response, next: NextFunction) => {
      if (req.get('X-Slow') === 'before') setTimeout(next, SLOW_MS);
      else next();
    });
    app.use('/api', apiRouter);
    app.use(errorHandler);

    const graph = await container.graphService.createGraph({ name: 'Timeouts' });
    await container.graphService.setActiveGraph(graph.id);
    graphId = graph.id;
  });

  afterAll(async () => {
    await cleanupContainer();
    await fs.rm(testDataDir, { recursive: true, force: true }).catch(() => undefined);
  });

  beforeEach(() => {
    logged = [];
    for (const method of ['error', 'warn', 'log'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(' ')));
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const event = (description: string) => ({
    description,
    actor: 'Actor',
    target: 'Target',
    timestamp: '2020-01-01T00:00:00.000Z',
  });

  const versions = async (): Promise<number> => (await container.graphRepository.getVersionHistory(graphId)).total;
  const listed = async (): Promise<Array<{ id: string; description: string }>> =>
    (await request(app).get('/api/events').expect(200)).body.data;
  const settle = (ms = SLOW_MS + 100): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
  const noHeaderErrors = (): void => {
    expect(logged.filter((line) => line.includes('Cannot set headers'))).toEqual([]);
  };

  it('does not save an event whose request timed out, and a retry saves it once', async () => {
    const before = await versions();

    const first = await request(app).post('/api/events').set('X-Slow', 'before').send(event('Timed out'));
    expect(first.status).toBe(408);
    await settle();

    expect(await listed()).toHaveLength(0);
    expect(await versions()).toBe(before);
    noHeaderErrors();

    const retry = await request(app).post('/api/events').send(event('Timed out'));
    expect(retry.status).toBe(201);
    const stored = await listed();
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe(retry.body.data.id);
    expect(await versions()).toBe(before + 1);
    noHeaderErrors();
  });

  it('does not save a link whose request timed out', async () => {
    const cause = (await request(app).post('/api/events').send(event('Cause'))).body.data.id;
    const effect = (await request(app).post('/api/events').send(event('Effect'))).body.data.id;
    const before = await versions();
    const body = {
      causeEventId: cause,
      effectEventId: effect,
      relationship: { type: 'direct', strength: 0.8, confidence: 0.9, evidence: 'The cause came first' },
    };

    const first = await request(app).post('/api/causal/link').set('X-Slow', 'before').send(body);
    expect(first.status).toBe(408);
    await settle();

    expect(Object.keys((await container.graphRepository.checkout(graphId)).relationships)).toHaveLength(0);
    expect(await versions()).toBe(before);
    noHeaderErrors();

    await request(app).post('/api/causal/link').send(body).expect(201);
    expect(Object.keys((await container.graphRepository.checkout(graphId)).relationships)).toHaveLength(1);
  });

  it('lets a write that was already committing finish, in both stores, with its real reply', async () => {
    const before = await versions();
    const commit = container.graphRepository.commitChanges.bind(container.graphRepository);
    // The live write has committed by the time the version is recorded; the
    // budget runs out while the version is being recorded.
    vi.spyOn(container.graphRepository, 'commitChanges').mockImplementation(async (...args) => {
      await settle(BUDGET_MS + 40);
      return commit(...args);
    });

    const response = await request(app).post('/api/events').send(event('Slow to version'));
    expect(response.status).toBe(201);
    const stored = await listed();
    expect(stored.map((e) => e.description)).toContain('Slow to version');
    expect(await versions()).toBe(before + 1);
    expect(Object.keys((await container.graphRepository.checkout(graphId)).events)).toContain(response.body.data.id);
    noHeaderErrors();
  });
});
