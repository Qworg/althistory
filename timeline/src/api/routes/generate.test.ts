/**
 * The generation routes, mounted as `routes.ts` mounts them, against a real
 * local container and real API keys: permissions, graph access, validation,
 * the job lifecycle over HTTP, cancel, ownership and the rate limit.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express, { type Express } from 'express';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { loadConfig, initializeDatabaseManager } from '@/utils';
import { initializeContainer, cleanupContainer, type Container } from '@/container';
import { errorHandler, injectContainer } from '@/api/middleware';
import { generateRoutes } from './generate';
import { GenerationJobService, type GenerationJobView } from '@/services/GenerationJobService';
import type { LLMClient } from '@/services/llm/LLMClient';

type Permissions = Parameters<Container['authService']['createApiKey']>[0]['permissions'];

describe('Generation routes (real auth)', () => {
  let app: Express;
  let container: Container;
  let dataDir: string;
  let graphA: string;
  let graphB: string;
  let eventInA: string;
  let generateKey: string;
  let writeKey: string;
  let readOnlyKey: string;
  let otherGenerateKey: string;
  let graphAOnlyKey: string;

  const post = (url: string, key?: string, graph?: string) => {
    const req = request(app).post(url);
    if (key) req.set('X-API-Key', key);
    if (graph) req.set('X-Graph-Id', graph);
    return req;
  };
  const get = (url: string, key: string) => request(app).get(url).set('X-API-Key', key);

  async function finished(id: string, key: string): Promise<GenerationJobView> {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const res = await get(`/api/generate/jobs/${id}`, key).expect(200);
      if (res.body.status !== 'running') return res.body as GenerationJobView;
      if (Date.now() > deadline) throw new Error(`job ${id} did not finish`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  beforeAll(async () => {
    dataDir = path.join(os.tmpdir(), `generate-routes-${process.pid}-${Date.now()}`);
    process.env.LOCAL_EXECUTION_ENABLED = 'true';
    process.env.LOCAL_DATA_DIR = dataDir;
    process.env.LOCAL_GRAPH_FILE = 'generate-routes-graph.json';
    process.env.LOCAL_BACKUP_ENABLED = 'false';
    process.env.LOCAL_MAX_MEMORY_MB = '64';
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    await fs.mkdir(path.join(dataDir, 'graphs'), { recursive: true });

    const config = loadConfig();
    container = initializeContainer(initializeDatabaseManager(config.database), config);
    await container.initialize();

    graphA = (await container.graphService.createGraph({ name: 'Generation A' })).id;
    graphB = (await container.graphService.createGraph({ name: 'Generation B' })).id;
    const scoped = await container.graphScopedRepositories(graphA);
    eventInA = (
      await scoped.eventRepository.create({
        description: 'The sea wall is raised',
        actor: 'Harbour League',
        target: 'The Tide',
        timestamp: new Date('1200-03-01T00:00:00Z'),
      })
    ).id;
    await scoped.eventRepository.create({
      description: 'The first flood',
      actor: 'The Tide',
      target: 'Harbour League',
      timestamp: new Date('1210-03-01T00:00:00Z'),
    });

    const createKey = async (name: string, permissions: Permissions, allowedGraphs: string[] | '*' = '*') =>
      (await container.authService.createApiKey({ name, permissions, allowedGraphs })).key;
    generateKey = await createKey('Generator', ['generate']);
    otherGenerateKey = await createKey('Another generator', ['generate']);
    writeKey = await createKey('Writer', ['write:graphs', 'write:events', 'write:arcs', 'write:relationships']);
    readOnlyKey = await createKey('Reader', ['read:events', 'read:graphs']);
    graphAOnlyKey = await createKey('Generator for A', ['generate'], [graphA]);

    app = express();
    app.use(express.json());
    app.use(injectContainer);
    app.use('/api/generate', generateRoutes);
    app.use(errorHandler);
  });

  afterAll(async () => {
    await cleanupContainer();
    await fs.rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
  });

  const timelineBody = { premise: 'What if the tide never turned?', divergencePoint: 'The wall holds in 1200', eventCount: 4 };

  describe('permission', () => {
    it('refuses a request without a key (401) and an unknown key (401)', async () => {
      await post('/api/generate/timeline').send(timelineBody).expect(401);
      await post('/api/generate/timeline', 'not-a-key').send(timelineBody).expect(401);
      await get('/api/generate/jobs', 'not-a-key').expect(401);
    });

    it('refuses a key that cannot generate or write (403), on every start route', async () => {
      for (const [url, graph] of [
        ['/api/generate/timeline', undefined],
        ['/api/generate/branch', graphA],
        ['/api/generate/expand', graphA],
      ] as const) {
        const res = await post(url, readOnlyKey, graph).send({}).expect(403);
        expect(res.body.error.message).toContain("'generate' permission");
      }
    });

    it('accepts the generate permission, or every write the run makes', async () => {
      const viaGenerate = await post('/api/generate/timeline', generateKey).send({ ...timelineBody, dryRun: true }).expect(202);
      const viaWrites = await post('/api/generate/timeline', writeKey).send({ ...timelineBody, dryRun: true }).expect(202);
      expect(viaGenerate.body.status).toBe('running');
      expect(viaWrites.body.id).not.toBe(viaGenerate.body.id);
    });

    it('does not accept a key with only some of the writes', async () => {
      const partial = (await container.authService.createApiKey({ name: 'Partial', permissions: ['write:events', 'write:arcs'] })).key;
      await post('/api/generate/timeline', partial).send(timelineBody).expect(403);
      // An expansion makes use of only the events and the arcs.
      await post('/api/generate/expand', partial, graphA).send({ eventCount: 2, dryRun: true }).expect(202);
    });
  });

  describe('graph access', () => {
    it('refuses a branch or an expansion of a graph the key may not access (403)', async () => {
      await post('/api/generate/branch', graphAOnlyKey, graphB)
        .send({ divergeAtEventId: eventInA, counterfactualPrompt: 'x', branchName: 'x' })
        .expect(403);
      await post('/api/generate/expand', graphAOnlyKey, graphB).send({}).expect(403);
    });

    it('answers 404 for a graph that does not exist, and 400 for one that is malformed', async () => {
      await post('/api/generate/expand', generateKey, 'no-such-graph').send({}).expect(404);
      await post('/api/generate/expand', generateKey, '../escape').send({}).expect(400);
    });

    it('refuses a body that names a different graph than the header scopes to', async () => {
      const res = await post('/api/generate/expand', generateKey, graphA).send({ graphId: graphB }).expect(400);
      expect(res.body.error.message).toContain('does not match');
      await post('/api/generate/branch', generateKey, graphA)
        .send({ sourceGraphId: graphB, divergeAtEventId: eventInA, counterfactualPrompt: 'x', branchName: 'x' })
        .expect(400);
    });

    it('lets a key restricted to a graph work on that graph', async () => {
      await post('/api/generate/expand', graphAOnlyKey, graphA).send({ eventCount: 2, dryRun: true }).expect(202);
    });
  });

  describe('validation', () => {
    it('refuses a timeline request that cannot run, before a job exists', async () => {
      const before = (await get('/api/generate/jobs', generateKey).expect(200)).body.jobs.length;
      const res = await post('/api/generate/timeline', generateKey).send({ premise: 'only a premise' }).expect(400);
      expect(res.body.error.message).toContain('premise and a point of divergence');
      await post('/api/generate/timeline', generateKey)
        .send({ world: 'Vael', premise: 'and a premise' })
        .expect(400);
      expect((await get('/api/generate/jobs', generateKey).expect(200)).body.jobs.length).toBe(before);
    });

    it('refuses fields of the wrong type or out of range', async () => {
      for (const body of [
        { ...timelineBody, eventCount: 'many' },
        { ...timelineBody, eventCount: -1 },
        { ...timelineBody, style: 'epic' },
        { ...timelineBody, provider: 'acme' },
        { ...timelineBody, model: 'bad model name!' },
        { ...timelineBody, temperature: 9 },
        { ...timelineBody, dryRun: 'yes' },
        { ...timelineBody, calendar: 'AR' },
        { ...timelineBody, premise: 12 },
      ]) {
        await post('/api/generate/timeline', generateKey).send(body).expect(400);
      }
    });

    it('requires what a branch needs, and a point of divergence that exists', async () => {
      await post('/api/generate/branch', generateKey, graphA).send({}).expect(400);
      await post('/api/generate/branch', generateKey, graphA)
        .send({ divergeAtEventId: eventInA, counterfactualPrompt: 'x' })
        .expect(400);
      await post('/api/generate/branch', generateKey, graphA)
        .send({ divergeAtEventId: 'no-such-event', counterfactualPrompt: 'The wall breaks', branchName: 'Breaks' })
        .expect(404);
    });
  });

  describe('the job', () => {
    it('answers 202 with the running job and where to read it, and completes with a result that names its source', async () => {
      const res = await post('/api/generate/timeline', generateKey).send({ ...timelineBody, graphName: 'Tide that held' }).expect(202);
      expect(res.headers.location).toBe(`/api/generate/jobs/${res.body.id}`);
      expect(res.body).toMatchObject({ kind: 'timeline', status: 'running', dryRun: false });

      const done = await finished(res.body.id, generateKey);
      expect(done.status).toBe('completed');
      expect(done.progress).toBe(100);
      expect(done.source).toBe('template');
      expect(done.result?.source).toBe('template');
      expect(done.result?.graphName).toBe('Tide that held');
      const listed = await container.graphService.getGraph(done.graphId as string);
      expect(listed.name).toBe('Tide that held');
    });

    it('runs a world timeline, a branch and an expansion', async () => {
      const world = await post('/api/generate/timeline', generateKey)
        .send({ world: 'Vael, a drowned coast', eventCount: 4, calendar: { epochYear: 1000, eraLabel: 'AR' } })
        .expect(202);
      const worldDone = await finished(world.body.id, generateKey);
      expect(worldDone.status).toBe('completed');
      expect(worldDone.result?.world).toBe('Vael, a drowned coast');

      const branch = await post('/api/generate/branch', generateKey, graphA)
        .send({ divergeAtEventId: eventInA, counterfactualPrompt: 'The wall breaks', branchName: 'Wall breaks', eventCount: 3 })
        .expect(202);
      const branchDone = await finished(branch.body.id, generateKey);
      expect(branchDone.status).toBe('completed');
      expect(branchDone.result?.graphName).toBe('Wall breaks');
      expect(branchDone.graphId).not.toBe(graphA);

      const expand = await post('/api/generate/expand', generateKey, graphA).send({ eventCount: 2 }).expect(202);
      expect(expand.body.graphId).toBe(graphA);
      const expandDone = await finished(expand.body.id, generateKey);
      expect(expandDone.status).toBe('completed');
      expect(expandDone.written.events).toBe(2);
    });

    it('fails a job that cannot go on, with the reason in the job', async () => {
      const empty = (await container.graphService.createGraph({ name: 'Nothing to expand' })).id;
      const started = await post('/api/generate/expand', generateKey, empty).send({}).expect(202);
      const done = await finished(started.body.id, generateKey);
      expect(done.status).toBe('failed');
      expect(done.error).toContain('Cannot expand empty graph');
    });

    it('shows a job only to the key that started it', async () => {
      const started = await post('/api/generate/timeline', generateKey).send({ ...timelineBody, dryRun: true }).expect(202);
      await get(`/api/generate/jobs/${started.body.id}`, otherGenerateKey).expect(404);
      await post(`/api/generate/jobs/${started.body.id}/cancel`, otherGenerateKey).expect(404);
      const others = await get('/api/generate/jobs', otherGenerateKey).expect(200);
      expect(others.body.jobs.map((job: GenerationJobView) => job.id)).not.toContain(started.body.id);
      const mine = await get('/api/generate/jobs', generateKey).expect(200);
      expect(mine.body.jobs.map((job: GenerationJobView) => job.id)).toContain(started.body.id);
      expect(mine.body.jobs.every((job: GenerationJobView) => job.result === undefined)).toBe(true);
    });

    it('answers 404 for a job that does not exist', async () => {
      await get('/api/generate/jobs/gen_nope', generateKey).expect(404);
    });
  });

  describe('cancel and limits', () => {
    function withService(service: GenerationJobService): void {
      (container as unknown as { _generationJobService: GenerationJobService })._generationJobService = service;
    }

    it('cancels a running job: it stops before its next write, and the job says so', async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const slow: LLMClient = {
        provider: 'slow',
        extractEvents: async () => {
          await gate;
          return [];
        },
        suggestRelationships: async () => [],
        enrichDescription: async (event) => event.description,
      };
      const service = new GenerationJobService({ container: () => container, llmClient: () => slow });
      withService(service);

      const started = await post('/api/generate/timeline', generateKey).send(timelineBody).expect(202);
      const cancelled = await post(`/api/generate/jobs/${started.body.id}/cancel`, generateKey).expect(200);
      expect(cancelled.body.status).toBe('cancelled');
      release();
      await service.idle();
      const after = await get(`/api/generate/jobs/${started.body.id}`, generateKey).expect(200);
      expect(after.body.status).toBe('cancelled');
      expect(after.body.written).toEqual({ events: 0, arcs: 0, relationships: 0 });
      // Cancelling again, once it is over, changes nothing.
      const again = await post(`/api/generate/jobs/${started.body.id}/cancel`, generateKey).expect(200);
      expect(again.body.status).toBe('cancelled');
    });

    it('answers 429 with Retry-After when the key is at its limit, and a different key is not', async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const slow: LLMClient = {
        provider: 'slow',
        extractEvents: async () => {
          await gate;
          return [];
        },
        suggestRelationships: async () => [],
        enrichDescription: async (event) => event.description,
      };
      const service = new GenerationJobService({
        container: () => container,
        llmClient: () => slow,
        limits: { maxRunningPerKey: 1, maxRunningTotal: 5 },
      });
      withService(service);

      await post('/api/generate/timeline', generateKey).send(timelineBody).expect(202);
      const refused = await post('/api/generate/timeline', generateKey).send(timelineBody).expect(429);
      expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
      expect(refused.body.error.message).toContain('already has 1 generation job');
      await post('/api/generate/timeline', otherGenerateKey).send(timelineBody).expect(202);

      release();
      await service.shutdown();
    });
  });
});
