/**
 * @vitest-environment node
 */

/**
 * `generate timeline|branch|expand` through the app (issue 23).
 *
 * Two layers: a stand-in daemon whose jobs move on a script, which pins the
 * engine's requests and how it waits, reports, cancels and fails; and the real
 * generation routes on a real container, which pins that a remote run writes
 * to the app's own graph and announces it on the live change feed.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import express, { type Express, type Request, type Response } from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { RemoteEngine } from './engine/RemoteEngine';
import type { GenerationResultDto } from './types';
import { ExitCode } from './utils/exitCodes';
import { loadConfig, initializeDatabaseManager } from '@/utils';
import { initializeContainer, cleanupContainer, type Container } from '@/container';
import { errorHandler, injectContainer } from '@/api/middleware';
import { generateRoutes } from '@/api/routes/generate';
import { attributeChanges } from '@/api/changeAttribution';
import type { ChangeRecord } from '@/services/ChangeFeedService';

const RESULT: GenerationResultDto = {
  graphId: 'g-new',
  graphName: 'What If',
  premise: 'p',
  divergencePoint: 'd',
  source: 'template',
  eventCount: 3,
  arcCount: 1,
  relationshipCount: 2,
  events: [],
  arcs: [],
  relationships: [],
  validation: { valid: true, graphId: 'g-new', errorCount: 0, warningCount: 0, issues: [] },
};

interface Scripted {
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  phase: string;
  message: string;
  error?: string;
  graphId?: string;
  source?: 'model' | 'template';
  written?: { events: number; arcs: number; relationships: number };
}

describe('RemoteEngine generation against a stand-in daemon', () => {
  let server: Server;
  let baseUrl: string;
  let requests: Array<{ method: string; path: string; graphId?: string; client?: string; body: unknown }>;
  let script: Scripted[];
  let polls: number;
  let cancelled: boolean;
  let startStatus: number;

  const slept: number[] = [];
  const engineWith = (options: ConstructorParameters<typeof RemoteEngine>[2] = {}) =>
    new RemoteEngine(baseUrl, 'key', { sleep: async (ms) => void slept.push(ms), ...options });

  beforeEach(async () => {
    requests = [];
    script = [];
    polls = 0;
    cancelled = false;
    startStatus = 202;
    slept.length = 0;
    const app: Express = express();
    app.use(express.json());
    app.use((req: Request, _res: Response, next: () => void) => {
      requests.push({
        method: req.method,
        path: req.path,
        graphId: req.get('X-Graph-Id') || undefined,
        client: req.get('X-Althistory-Client') || undefined,
        body: req.body,
      });
      next();
    });
    const view = (state: Scripted) => ({
      id: 'gen_1',
      kind: 'timeline',
      dryRun: false,
      written: { events: 0, arcs: 0, relationships: 0 },
      ...state,
      ...(state.status === 'completed' ? { result: RESULT } : {}),
    });
    app.post('/api/generate/:kind', (_req, res) => {
      if (startStatus !== 202) {
        res.status(startStatus).set('Retry-After', '30').json({ error: { message: 'at the limit' } });
        return;
      }
      res.status(202).json(view(script[0] ?? { status: 'running', progress: 0, phase: 'planning', message: 'Starting' }));
    });
    app.get('/api/generate/jobs/:id', (_req, res) => {
      polls += 1;
      const state = cancelled
        ? { status: 'cancelled' as const, progress: 40, phase: 'events', message: 'Cancelled', graphId: 'g-new', written: { events: 2, arcs: 1, relationships: 0 } }
        : script[Math.min(polls, script.length - 1)];
      res.json(view(state));
    });
    app.post('/api/generate/jobs/:id/cancel', (_req, res) => {
      cancelled = true;
      res.json(view({ status: 'cancelled', progress: 40, phase: 'events', message: 'Cancelled' }));
    });
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('starts the job on the route for the command, scoped to the graph it is about, and returns the result', async () => {
    script = [
      { status: 'running', progress: 0, phase: 'planning', message: 'Starting' },
      { status: 'running', progress: 50, phase: 'events', message: 'Writing events (2 of 4)' },
      { status: 'completed', progress: 100, phase: 'done', message: 'Wrote 3 events' },
    ];
    const result = await engineWith().generateBranch({
      sourceGraphId: 'g1',
      divergeAtEventId: 'e1',
      counterfactualPrompt: 'The wall breaks',
      branchName: 'Breaks',
    });
    expect(result).toEqual(RESULT);
    const start = requests[0];
    expect(start).toMatchObject({ method: 'POST', path: '/api/generate/branch', graphId: 'g1', client: 'cli' });
    // The graph travels in the header; the body is the rest of the request.
    expect(start.body).toEqual({ divergeAtEventId: 'e1', counterfactualPrompt: 'The wall breaks', branchName: 'Breaks' });
    expect(requests.some((request) => request.path === '/api/generate/jobs/gen_1')).toBe(true);
  });

  it('sends a timeline without a graph and an expansion with its own', async () => {
    script = [{ status: 'completed', progress: 100, phase: 'done', message: 'Done' }];
    await engineWith().generateTimeline({ premise: 'p', divergencePoint: 'd' });
    await engineWith().generateExpand({ graphId: 'g9', eventCount: 2 });
    expect(requests.find((request) => request.path === '/api/generate/timeline')).toMatchObject({ graphId: undefined, body: { premise: 'p', divergencePoint: 'd' } });
    expect(requests.find((request) => request.path === '/api/generate/expand')).toMatchObject({ graphId: 'g9', body: { eventCount: 2 } });
  });

  it('says which kind of client it is, so the app can attribute its changes', async () => {
    script = [{ status: 'completed', progress: 100, phase: 'done', message: 'Done' }];
    await engineWith({ client: 'mcp' }).generateTimeline({ premise: 'p', divergencePoint: 'd' });
    expect(requests[0].client).toBe('mcp');
  });

  it('reports each change of progress once, with the graph and source when they are known', async () => {
    script = [
      { status: 'running', progress: 5, phase: 'drafting', message: 'Drafting the events' },
      { status: 'running', progress: 5, phase: 'drafting', message: 'Drafting the events' },
      { status: 'running', progress: 30, phase: 'graph', message: 'Created the graph', graphId: 'g-new', source: 'template' },
      { status: 'completed', progress: 100, phase: 'done', message: 'Done' },
    ];
    const seen: unknown[] = [];
    await engineWith().generateTimeline({ premise: 'p', divergencePoint: 'd' }, { onProgress: (p) => seen.push(p) });
    expect(seen).toEqual([
      { progress: 5, phase: 'drafting', message: 'Drafting the events' },
      { progress: 30, phase: 'graph', message: 'Created the graph', graphId: 'g-new', source: 'template' },
      { progress: 100, phase: 'done', message: 'Done' },
    ]);
  });

  it('waits a little longer between reads as a run goes on', async () => {
    script = [
      ...Array.from({ length: 8 }, () => ({ status: 'running' as const, progress: 10, phase: 'events', message: 'x' })),
      { status: 'completed', progress: 100, phase: 'done', message: 'Done' },
    ];
    await engineWith().generateTimeline({ premise: 'p', divergencePoint: 'd' });
    expect(slept[0]).toBe(400);
    expect(Math.max(...slept)).toBe(2000);
    expect([...slept].sort((a, b) => a - b)).toEqual(slept.slice().sort((a, b) => a - b));
  });

  it('fails with the reason the job gave, and how much it wrote before', async () => {
    script = [
      { status: 'running', progress: 20, phase: 'events', message: 'x' },
      { status: 'failed', progress: 20, phase: 'events', message: 'Boom', error: 'The model refused', graphId: 'g-new', written: { events: 2, arcs: 1, relationships: 0 } },
    ];
    await expect(engineWith().generateTimeline({ premise: 'p', divergencePoint: 'd' })).rejects.toMatchObject({
      message: expect.stringContaining('Generation failed: The model refused; 2 events, 1 arc and 0 links stay in graph g-new'),
      code: 'GENERATION_FAILED',
      exitCode: ExitCode.GENERAL_ERROR,
    });
  });

  it('asks the app to cancel when its signal is aborted, and says what stays', async () => {
    script = [{ status: 'running', progress: 10, phase: 'events', message: 'x' }];
    const controller = new AbortController();
    const run = engineWith({
      sleep: async () => {
        controller.abort();
      },
    }).generateTimeline({ premise: 'p', divergencePoint: 'd' }, { signal: controller.signal });
    await expect(run).rejects.toMatchObject({
      message: expect.stringContaining('Generation was cancelled; 2 events, 1 arc and 0 links stay in graph g-new'),
      code: 'GENERATION_CANCELLED',
    });
    expect(requests.filter((request) => request.path.endsWith('/cancel'))).toHaveLength(1);
  });

  it('cancels a job that outlives its time limit, and says so', async () => {
    script = [{ status: 'running', progress: 10, phase: 'events', message: 'x' }];
    await expect(
      engineWith({ generationTimeoutMs: 0, sleep: async () => undefined }).generateTimeline({ premise: 'p', divergencePoint: 'd' })
    ).rejects.toMatchObject({ code: 'GENERATION_TIMEOUT' });
    expect(requests.some((request) => request.path.endsWith('/cancel'))).toBe(true);
  });

  it('turns a refused start into the daemon\'s own message', async () => {
    startStatus = 429;
    await expect(engineWith().generateTimeline({ premise: 'p', divergencePoint: 'd' })).rejects.toThrow(/429.*at the limit/);
    startStatus = 403;
    await expect(engineWith().generateTimeline({ premise: 'p', divergencePoint: 'd' })).rejects.toThrow(/Authentication failed/);
  });

  it('gives up on a daemon that no longer knows the job, rather than waiting for ever', async () => {
    script = [{ status: 'running', progress: 10, phase: 'events', message: 'x' }];
    // The job is gone on the second read.
    const gone = engineWith();
    const original = (gone as unknown as { client: { get: (...args: unknown[]) => Promise<unknown> } }).client;
    original.get = async () => {
      const error = Object.assign(new Error('not found'), { isAxiosError: true, response: { status: 404 } });
      throw error;
    };
    await expect(gone.generateTimeline({ premise: 'p', divergencePoint: 'd' })).rejects.toMatchObject({ code: 'GENERATION_LOST' });
  });

  it('refuses a daemon that answers a start with something that is not a job', async () => {
    const app = express();
    app.post('/api/generate/timeline', (_req, res) => res.status(202).json({ ok: true }));
    const odd = app.listen(0);
    await new Promise<void>((resolve) => odd.once('listening', () => resolve()));
    try {
      const engine = new RemoteEngine(`http://127.0.0.1:${(odd.address() as AddressInfo).port}`, 'key');
      await expect(engine.generateTimeline({ premise: 'p', divergencePoint: 'd' })).rejects.toMatchObject({
        code: 'UNSUPPORTED_REMOTE_OPERATION',
      });
    } finally {
      await new Promise<void>((resolve) => odd.close(() => resolve()));
    }
  });
});

describe('RemoteEngine generation against the real routes', () => {
  let container: Container;
  let dataDir: string;
  let server: Server;
  let baseUrl: string;
  let adminKey: string;
  let heard: ChangeRecord[];
  let stop: () => void;

  beforeAll(async () => {
    dataDir = path.join(os.tmpdir(), `remote-generation-${process.pid}-${Date.now()}`);
    process.env.LOCAL_EXECUTION_ENABLED = 'true';
    process.env.LOCAL_DATA_DIR = dataDir;
    process.env.LOCAL_GRAPH_FILE = 'remote-generation-graph.json';
    process.env.LOCAL_BACKUP_ENABLED = 'false';
    process.env.LOCAL_MAX_MEMORY_MB = '64';
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    await fs.mkdir(path.join(dataDir, 'graphs'), { recursive: true });
    const config = loadConfig();
    container = initializeContainer(initializeDatabaseManager(config.database), config);
    await container.initialize();
    adminKey = (await container.authService.createApiKey({ name: 'cli-key', permissions: ['generate', 'read:graphs'] })).key;

    const app = express();
    app.use(express.json());
    app.use(injectContainer);
    app.use('/api', attributeChanges);
    app.use('/api/generate', generateRoutes);
    app.use(errorHandler);
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await cleanupContainer();
    await fs.rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
  });

  beforeEach(() => {
    heard = [];
    stop = container.changeFeedService.subscribe((record) => heard.push(record));
  });
  afterEach(() => stop());

  it('writes the timeline into the app\'s own graph while the app announces it, with no stop-the-app step', async () => {
    const engine = new RemoteEngine(baseUrl, adminKey, { client: 'cli' });
    const progress: number[] = [];
    const result = await engine.generateTimeline(
      { premise: 'What if the tide never turned?', divergencePoint: 'The wall holds in 1200', eventCount: 4, graphName: 'Held wall' },
      { onProgress: (p) => progress.push(p.progress) }
    );

    expect(result.source).toBe('template');
    expect(result.eventCount).toBe(4);
    expect(progress[progress.length - 1]).toBe(100);

    // It is in the app's store, which is what the app serves.
    const graph = await container.graphService.getGraph(result.graphId);
    expect(graph.name).toBe('Held wall');
    const { eventRepository } = await container.graphScopedRepositories(result.graphId);
    expect(await eventRepository.findAll()).toHaveLength(4);

    // A watcher heard it, as a generation by the key that asked.
    const events = heard.filter((record) => record.kind === 'entities' && record.entities[0].type === 'event');
    expect(events).toHaveLength(4);
    expect(events[0].actor).toMatchObject({ kind: 'generation', name: expect.stringContaining('cli-key') });
  });

  it('branches and expands a graph in the app', async () => {
    const engine = new RemoteEngine(baseUrl, adminKey);
    const base = await engine.generateTimeline({ premise: 'Base', divergencePoint: 'A turning', eventCount: 4, graphName: 'Base' });

    const branch = await engine.generateBranch({
      sourceGraphId: base.graphId,
      divergeAtEventId: base.events[1].id,
      counterfactualPrompt: 'The other way',
      branchName: 'Other way',
      eventCount: 3,
    });
    expect(branch.graphName).toBe('Other way');
    expect((await container.graphService.getGraph(branch.graphId)).name).toBe('Other way');

    const expanded = await engine.generateExpand({ graphId: base.graphId, eventCount: 2 });
    expect(expanded.eventCount).toBe(2);
    expect(expanded.source).toBe('template');
  });

  it('refuses a key that may not generate', async () => {
    const reader = (await container.authService.createApiKey({ name: 'reader', permissions: ['read:graphs'] })).key;
    await expect(
      new RemoteEngine(baseUrl, reader).generateTimeline({ premise: 'p', divergencePoint: 'd' })
    ).rejects.toThrow(/Authentication failed.*generate/);
  });
});
