/**
 * Local-mode cases from the first review of #44: a 408 saves nothing, and a
 * request past its point of no return finishes with its real reply.
 *
 * - a link PUT or DELETE writes `LocalGraphStore` directly (not through a
 *   session), and its version is recorded after the budget: both stores must
 *   agree afterwards, whatever the status;
 * - a streamed simulation whose headers are already out is not cancelled;
 * - a graph create that times out leaves no graph, and a retry makes one;
 * - a graph branch that has started finishes instead of leaving an empty graph.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import express, { Express, NextFunction, Request, Response } from 'express';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { loadConfig, initializeDatabaseManager } from '@/utils';
import { initializeContainer, cleanupContainer, Container } from '@/container';
import { apiRouter } from '@/api/routes';
import { errorHandler, injectContainer, requestTimeout } from '@/api/middleware';
import { EventRepository } from '@/repositories/EventRepository';
import { VersionRepository } from '@/repositories/VersionRepository';
import { currentBudget } from '@/utils/requestBudget';

const BUDGET = 30_000; // never reached: the tests run it out by hand

describe('the first review of #44, local mode', () => {
  let app: Express;
  let container: Container;
  let dir: string;
  let graphId: string;
  let key: string;

  beforeAll(async () => {
    dir = path.join(os.tmpdir(), `request-timeout-review-${process.pid}-${Date.now()}`);
    process.env.LOCAL_EXECUTION_ENABLED = 'true';
    process.env.LOCAL_DATA_DIR = dir;
    process.env.LOCAL_GRAPH_FILE = 'request-timeout-review.json';
    process.env.LOCAL_BACKUP_ENABLED = 'false';
    process.env.LOCAL_MAX_MEMORY_MB = '64';
    await fs.mkdir(dir, { recursive: true });
    const config = loadConfig();
    container = initializeContainer(initializeDatabaseManager(config.database), config);
    await container.initialize();
    app = express();
    app.use(express.json());
    app.use(injectContainer);
    app.use(requestTimeout(BUDGET));
    // `X-Expire: before` runs the budget out at this exact point, ahead of the route.
    app.use((req: Request, _res: Response, next: NextFunction) => {
      if (req.get('X-Expire') === 'before') currentBudget()?.expireNow();
      next();
    });
    app.use('/api', apiRouter);
    app.use(errorHandler);
    graphId = (await container.graphService.createGraph({ name: 'Review' })).id;
    await container.graphService.setActiveGraph(graphId);
    const rateLimit = { requestsPerMinute: 1000, requestsPerHour: 10000, requestsPerDay: 100000, concurrentStreams: 8 };
    key = (await container.authService.createApiKey({ name: 'Review', permissions: ['read:graphs', 'write:graphs'], rateLimit })).key;
  });

  afterAll(async () => {
    await cleanupContainer();
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const link = async (tag: string) => {
    const c = (await request(app).post('/api/events').send({ description: `c ${tag}`, actor: 'A', target: 'B', timestamp: '1200-01-01T00:00:00.000Z' }).expect(201)).body.data.id;
    const e = (await request(app).post('/api/events').send({ description: `e ${tag}`, actor: 'A', target: 'B', timestamp: '1201-01-01T00:00:00.000Z' }).expect(201)).body.data.id;
    await request(app).post('/api/causal/link').send({ causeEventId: c, effectEventId: e, relationship: { type: 'direct', strength: 0.8, confidence: 0.9, evidence: `orig ${tag}` } }).expect(201);
    const rel = (await request(app).get('/api/causal/relationships').expect(200)).body.data.find((r: { cause_event_id: string }) => r.cause_event_id === c);
    return { c, e, id: rel.id as string };
  };
  const state = async (id: string) => {
    const live = (await request(app).get('/api/causal/relationships').expect(200)).body.data.find((r: { id: string }) => r.id === id);
    const version = (await container.graphRepository.checkout(graphId)).relationships[id] as { evidence?: string } | undefined;
    return { live: live ? live.evidence : '(gone)', version: version ? version.evidence : '(gone)' };
  };
  /** The live store has been written when the version is recorded, after the budget. */
  const slowVersioning = (): void => {
    const commit = container.graphRepository.commitChanges.bind(container.graphRepository);
    vi.spyOn(container.graphRepository, 'commitChanges').mockImplementation(async (...args) => {
      currentBudget()?.expireNow();
      return commit(...args);
    });
  };

  it('a link PUT whose version is recorded late changes both stores or neither', async () => {
    const l = await link('put');
    slowVersioning();
    const res = await request(app).put('/api/causal/link').send({ causeEventId: l.c, effectEventId: l.e, id: l.id, relationship: { evidence: 'updated' } });
    vi.restoreAllMocks();
    const s = await state(l.id);
    expect(res.status).toBe(200);
    expect(s).toEqual({ live: 'updated', version: 'updated' });
  });

  it('a link DELETE whose version is recorded late changes both stores or neither', async () => {
    const l = await link('del');
    slowVersioning();
    const res = await request(app).delete('/api/causal/link').send({ causeEventId: l.c, effectEventId: l.e, id: l.id });
    vi.restoreAllMocks();
    const s = await state(l.id);
    expect(res.status).toBe(200);
    expect(s).toEqual({ live: '(gone)', version: '(gone)' });
  });

  it('a streamed simulation is not cancelled once its headers are out', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push((await request(app).post('/api/events').send({ description: `war ${i}`, actor: 'A', target: 'B', timestamp: `130${i}-01-01T00:00:00.000Z` }).expect(201)).body.data.id);
    for (let i = 0; i < 3; i++) await request(app).post('/api/causal/link').send({ causeEventId: ids[i], effectEventId: ids[i + 1], relationship: { type: 'direct', strength: 0.8, confidence: 0.9, evidence: 'e' } }).expect(201);
    const original = EventRepository.prototype.findAll;
    EventRepository.prototype.findAll = async function (this: EventRepository, ...args: unknown[]) {
      currentBudget()?.expireNow();
      return (original as (...a: unknown[]) => Promise<unknown>).apply(this, args);
    } as typeof original;
    try {
      const res = await request(app).post('/api/inference/simulate').set('Accept', 'text/event-stream').send({ steps: 2, stream: true });
      expect(res.status).toBe(200);
      expect(res.text).toContain('simulation_complete');
    } finally {
      EventRepository.prototype.findAll = original;
    }
  });

  it('a graph create that timed out leaves no graph, and a retry makes one', async () => {
    const names = async (): Promise<string[]> => (await container.graphRepository.findAll({})).graphs.map((g) => g.name);
    const before = await names();
    const create = container.graphService.createGraph.bind(container.graphService);
    // The request's budget runs out while it is working, before anything is written.
    vi.spyOn(container.graphService, 'createGraph').mockImplementationOnce(async (...args) => {
      currentBudget()?.expireNow();
      return create(...args);
    });
    const first = await request(app).post('/api/graphs').set('X-API-Key', key).send({ name: 'Slow graph' });
    expect(first.status).toBe(408);
    expect(await names()).toEqual(before);

    await request(app).post('/api/graphs').set('X-API-Key', key).send({ name: 'Slow graph' }).expect(201);
    expect((await names()).filter((n) => n === 'Slow graph')).toHaveLength(1);
  });

  it('a graph branch that has started finishes with its real reply', async () => {
    await request(app).post('/api/events').send({ description: 'to branch', actor: 'A', target: 'B', timestamp: '1210-01-01T00:00:00.000Z' }).expect(201);
    const before = (await container.graphRepository.findAll({})).graphs.length;
    const branch = container.graphRepository.branch.bind(container.graphRepository);
    // The budget runs out after the branch has begun to write: it must not be cut off.
    vi.spyOn(container.graphRepository, 'branch').mockImplementation(async (...args) => {
      const result = await branch(...args);
      currentBudget()?.expireNow();
      return result;
    });
    const res = await request(app).post(`/api/graphs/${graphId}/branch`).set('X-API-Key', key).send({ name: 'Branch' });
    vi.restoreAllMocks();
    expect(res.status).toBe(201);
    const graphs = (await container.graphRepository.findAll({})).graphs;
    expect(graphs.length).toBe(before + 1);
    const made = graphs.find((g) => g.name === 'Branch');
    expect(Object.keys((await container.graphRepository.checkout(made!.id)).events).length).toBeGreaterThan(0);
  });

  const both = async (id: string): Promise<{ live: string; version: string }> => {
    const live = await request(app).get(`/api/events/${id}`);
    const version = (await container.graphRepository.checkout(graphId)).events[id] as { description?: string } | undefined;
    return { live: live.status === 200 ? live.body.data.description : '(gone)', version: version?.description ?? '(gone)' };
  };
  const make = async (description: string): Promise<string> =>
    (await request(app).post('/api/events').send({ description, actor: 'A', target: 'B', timestamp: '1200-01-01T00:00:00.000Z' }).expect(201)).body.data.id as string;

  it('an event DELETE whose budget ran out before the route leaves the event in both stores', async () => {
    const id = await make('keep');
    const res = await request(app).delete(`/api/events/${id}`).set('X-Expire', 'before');
    expect(res.status).toBe(408);
    expect(await both(id)).toEqual({ live: 'keep', version: 'keep' });
  });

  it('an event PUT whose budget ran out before the route leaves the event unchanged in both stores', async () => {
    const id = await make('orig');
    const res = await request(app).put(`/api/events/${id}`).set('X-Expire', 'before').send({ description: 'changed' });
    expect(res.status).toBe(408);
    expect(await both(id)).toEqual({ live: 'orig', version: 'orig' });
  });

  it('a rollback whose version objects are written after the budget saves nothing', async () => {
    await make('A');
    const head = (await container.graphRepository.getVersionHistory(graphId)).total;
    const b = await make('B');
    const proto = VersionRepository.prototype as unknown as { storeTree: (...a: unknown[]) => Promise<string> };
    const storeTree = proto.storeTree;
    vi.spyOn(proto, 'storeTree').mockImplementation(async function (this: unknown, ...args: unknown[]) {
      currentBudget()?.expireNow();
      return storeTree.apply(this, args);
    });
    const versionsBefore = (await container.graphRepository.getVersionHistory(graphId)).total;
    const res = await request(app).post(`/api/graphs/${graphId}/rollback/${head}`).set('X-API-Key', key);
    vi.restoreAllMocks();
    expect(res.status).toBe(408);
    expect((await container.graphRepository.getVersionHistory(graphId)).total).toBe(versionsBefore);
    expect(await both(b)).toEqual({ live: 'B', version: 'B' });
  });

  it('a 408 on an entity route logs nothing at error level', async () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void errors.push(args.map(String).join(' ')));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const id = await make('quiet');
    for (const route of [`/api/events/${id}`, '/api/events', '/api/arcs', '/api/causal/relationships']) {
      const res = await request(app).get(route).set('X-Expire', 'before');
      expect(res.status).toBe(408);
    }
    await request(app).post('/api/events').set('X-Expire', 'before').send({ description: 'x', actor: 'A', target: 'B', timestamp: '1200-01-01T00:00:00.000Z' });
    expect(errors).toEqual([]);
  });
});
