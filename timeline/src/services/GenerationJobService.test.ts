/**
 * Generation jobs: the lifecycle (run, progress, complete, fail, cancel), what
 * a run announces on the live change feed, ownership, and the cost limits.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { loadConfig, initializeDatabaseManager } from '@/utils';
import { initializeContainer, cleanupContainer, type Container } from '@/container';
import type { LLMClient } from '@/services/llm/LLMClient';
import type { ExtractedEvent } from '@/services/ingestion/types';
import {
  GenerationJobService,
  GenerationLimitError,
  type GenerationJobView,
  type GenerationRequest,
} from './GenerationJobService';
import { ChangeFeedService, type ChangeRecord } from './ChangeFeedService';

const OWNER = { keyId: 'key-owner', name: 'agent-key' };
const OTHER = { keyId: 'key-other', name: 'other-key' };

const TIMELINE: GenerationRequest = {
  kind: 'timeline',
  options: { premise: 'What if the tide never turned?', divergencePoint: 'The sea wall holds in 1200', eventCount: 5 },
};

function modelEvents(count: number): ExtractedEvent[] {
  return Array.from({ length: count }, (_, index) => ({
    tempId: `m${index}`,
    description: `Model event ${index}`,
    actor: 'Harbour League',
    target: 'The Tide Court',
    timestamp: new Date(Date.UTC(1200 + index * 5, 0, 1)).toISOString(),
    confidence: 0.9,
    source: { type: 'llm' as const, extractedAt: '2026-01-01T00:00:00Z' },
    selected: true,
    edited: false,
  }));
}

function modelClient(events: ExtractedEvent[], gate?: Promise<void>): LLMClient {
  return {
    provider: 'test-model',
    extractEvents: async () => {
      if (gate) await gate;
      return events;
    },
    suggestRelationships: async () => [],
    enrichDescription: async (event: ExtractedEvent) => event.description,
  };
}

/** Resolves once the job leaves `running`, or fails the test. */
async function settled(service: GenerationJobService, id: string, keyId = OWNER.keyId): Promise<GenerationJobView> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const job = service.get(id, keyId);
    if (job && job.status !== 'running') return job;
    if (Date.now() > deadline) throw new Error(`job ${id} did not finish: ${JSON.stringify(job)}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('GenerationJobService', () => {
  let container: Container;
  let dataDir: string;
  let feed: ChangeFeedService;
  let heard: ChangeRecord[];
  let stopListening: () => void;

  beforeAll(async () => {
    dataDir = path.join(os.tmpdir(), `generation-jobs-${process.pid}-${Date.now()}`);
    process.env.LOCAL_EXECUTION_ENABLED = 'true';
    process.env.LOCAL_DATA_DIR = dataDir;
    process.env.LOCAL_GRAPH_FILE = 'generation-jobs-graph.json';
    process.env.LOCAL_BACKUP_ENABLED = 'false';
    process.env.LOCAL_MAX_MEMORY_MB = '64';
    await fs.mkdir(path.join(dataDir, 'graphs'), { recursive: true });
    const config = loadConfig();
    container = initializeContainer(initializeDatabaseManager(config.database), config);
    await container.initialize();
    feed = container.changeFeedService;
  });

  afterAll(async () => {
    await cleanupContainer();
    await fs.rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
  });

  beforeEach(() => {
    heard = [];
    stopListening = feed.subscribe((record) => heard.push(record));
  });

  afterEach(() => {
    stopListening();
  });

  function serviceWith(config: Partial<ConstructorParameters<typeof GenerationJobService>[0]> = {}): GenerationJobService {
    return new GenerationJobService({
      container: () => container,
      changeFeed: feed,
      llmClient: () => null,
      progressIntervalMs: 0,
      ...config,
    });
  }

  describe('a run', () => {
    it('starts running, writes the timeline as it goes and completes with the result', async () => {
      const service = serviceWith();
      const started = service.start(TIMELINE, OWNER);
      expect(started).toMatchObject({ kind: 'timeline', status: 'running', dryRun: false });
      expect(started.progress).toBeLessThan(10);
      expect(started.id).toMatch(/^gen_/);

      const done = await settled(service, started.id);
      expect(done.status).toBe('completed');
      expect(done.progress).toBe(100);
      expect(done.phase).toBe('done');
      expect(done.result?.graphId).toBe(done.graphId);
      expect(done.written).toEqual({
        events: done.result?.eventCount,
        arcs: done.result?.arcCount,
        relationships: done.result?.relationshipCount,
      });

      // What the job says it wrote is in the app's graph.
      const { eventRepository } = await container.graphScopedRepositories(done.graphId as string);
      expect(await eventRepository.findAll()).toHaveLength(done.result?.eventCount as number);
    });

    it('reports the template as the author when the app has no model key', async () => {
      const service = serviceWith({ llmClient: () => null });
      const done = await settled(service, service.start(TIMELINE, OWNER).id);
      expect(done.source).toBe('template');
      expect(done.result?.source).toBe('template');
    });

    it('reports a model as the author when it wrote the events', async () => {
      const service = serviceWith({ llmClient: () => modelClient(modelEvents(4)) });
      const done = await settled(service, service.start(TIMELINE, OWNER).id);
      expect(done.source).toBe('model');
      expect(done.result?.source).toBe('model');
      expect(done.result?.events[0].description).toBe('Model event 0');
    });

    it('passes the requested provider and model to the client factory, never a key', async () => {
      const seen: unknown[] = [];
      const service = serviceWith({
        llmClient: (choice) => {
          seen.push(choice);
          return null;
        },
      });
      await settled(
        service,
        service.start(TIMELINE, OWNER, { provider: 'anthropic', model: 'claude-test', temperature: 0.2 }).id
      );
      expect(seen).toEqual([{ provider: 'anthropic', model: 'claude-test', temperature: 0.2 }]);
    });

    it('announces its writes to the feed, attributed to generation and naming the key, in the order it writes', async () => {
      const service = serviceWith();
      const done = await settled(service, service.start(TIMELINE, OWNER).id);
      const graphMessages = heard.filter((record) => record.graphId === done.graphId);

      const entityKinds = graphMessages
        .filter((record) => record.kind === 'entities')
        .map((record) => (record.kind === 'entities' ? record.entities[0].type : ''));
      const firstEvent = entityKinds.indexOf('event');
      const firstLink = entityKinds.indexOf('relationship');
      expect(entityKinds.indexOf('arc')).toBeLessThan(firstEvent);
      expect(firstEvent).toBeLessThan(firstLink);
      expect(entityKinds.filter((kind) => kind === 'event')).toHaveLength(done.result?.eventCount as number);

      for (const record of graphMessages.filter((r) => r.kind === 'entities' || r.kind === 'generation')) {
        expect(record.actor).toMatchObject({ kind: 'generation', keyId: OWNER.keyId });
        expect(record.actor.name).toContain('agent-key');
      }
      const progress = graphMessages.filter((record) => record.kind === 'generation');
      expect(progress.length).toBeGreaterThan(2);
      const last = progress[progress.length - 1];
      expect(last).toMatchObject({ kind: 'generation', status: 'completed', progress: 100, source: 'template' });
      // The graph itself was announced too, to anyone watching the list.
      expect(graphMessages.some((record) => record.kind === 'graph' && record.operation === 'create')).toBe(true);
    });

    it('writes nothing, and announces nothing, for a dry run', async () => {
      const service = serviceWith();
      const before = heard.length;
      const done = await settled(service, service.start({ ...TIMELINE, options: { ...TIMELINE.options, dryRun: true } }, OWNER).id);
      expect(done.status).toBe('completed');
      expect(done.dryRun).toBe(true);
      expect(done.result?.events.length).toBeGreaterThan(0);
      expect(heard.slice(before)).toEqual([]);
      expect(done.message).toContain('nothing was written');
    });

    it('runs a branch and an expansion against an existing graph', async () => {
      const service = serviceWith();
      const base = await settled(service, service.start(TIMELINE, OWNER).id);
      const graphId = base.graphId as string;
      const pivot = base.result?.events[1].id as string;

      const branch = await settled(
        service,
        service.start(
          {
            kind: 'branch',
            options: { sourceGraphId: graphId, divergeAtEventId: pivot, counterfactualPrompt: 'The wall breaks', branchName: 'Wall breaks', eventCount: 3 },
          },
          OWNER
        ).id
      );
      expect(branch.status).toBe('completed');
      expect(branch.graphId).not.toBe(graphId);
      expect(branch.source).toBe('template');

      const expansion = service.start({ kind: 'expand', options: { graphId, eventCount: 2 } }, OWNER);
      // An expansion extends the graph it was started on, so it is known at once.
      expect(expansion.graphId).toBe(graphId);
      const expanded = await settled(service, expansion.id);
      expect(expanded.status).toBe('completed');
      expect(expanded.written.events).toBe(2);
    });

    it('fails the job, saying why, when the run cannot go on', async () => {
      const service = serviceWith();
      const empty = await container.graphService.createGraph({ name: 'Empty graph' });
      const failed = await settled(service, service.start({ kind: 'expand', options: { graphId: empty.id } }, OWNER).id);
      expect(failed.status).toBe('failed');
      expect(failed.error).toContain('Cannot expand empty graph');
      expect(failed.result).toBeUndefined();
    });
  });

  describe('cancelling', () => {
    it('stops before the next write once the model answers, and writes nothing', async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const graphsBefore = (await container.graphService.listGraphs()).total;
      const service = serviceWith({ llmClient: () => modelClient(modelEvents(4), gate) });
      const job = service.start(TIMELINE, OWNER);

      const cancelled = service.cancel(job.id, OWNER.keyId);
      expect(cancelled?.status).toBe('cancelled');
      release();
      await service.shutdown();

      expect(service.get(job.id, OWNER.keyId)?.status).toBe('cancelled');
      expect((await container.graphService.listGraphs()).total).toBe(graphsBefore);
    });

    it('stops part way: what was written stays, and the job says how much', async () => {
      const service = serviceWith();
      const started: { id?: string } = {};
      let cancelledAt = 0;
      const stop = feed.subscribe((record) => {
        if (record.kind === 'entities' && record.entities[0].type === 'event' && cancelledAt === 0 && record.actor.kind === 'generation') {
          cancelledAt = record.seq;
          if (started.id) service.cancel(started.id, OWNER.keyId);
        }
      });
      const job = service.start({ ...TIMELINE, options: { ...TIMELINE.options, eventCount: 10 } }, OWNER);
      started.id = job.id;
      await service.idle();
      stop();

      const done = service.get(job.id, OWNER.keyId) as GenerationJobView;
      expect(done.status).toBe('cancelled');
      expect(done.written.events).toBeGreaterThanOrEqual(1);
      expect(done.written.events).toBeLessThan(10);
      expect(done.written.relationships).toBe(0);
      expect(done.message).toContain('stays in the graph');
      const { eventRepository } = await container.graphScopedRepositories(done.graphId as string);
      expect(await eventRepository.findAll()).toHaveLength(done.written.events);
      // The feed was told it was cancelled.
      const last = [...heard].reverse().find((record) => record.kind === 'generation' && record.graphId === done.graphId);
      expect(last).toMatchObject({ status: 'cancelled' });
    });

    it('returns a finished job as it is', async () => {
      const service = serviceWith();
      const done = await settled(service, service.start(TIMELINE, OWNER).id);
      expect(service.cancel(done.id, OWNER.keyId)?.status).toBe('completed');
    });
  });

  describe('ownership', () => {
    it('shows a job only to the key that started it, and lets only that key cancel it', async () => {
      const service = serviceWith();
      const job = service.start(TIMELINE, OWNER);
      expect(service.get(job.id, OTHER.keyId)).toBeUndefined();
      expect(service.cancel(job.id, OTHER.keyId)).toBeUndefined();
      expect(service.list(OTHER.keyId)).toEqual([]);
      expect(service.list(OWNER.keyId).map((listed) => listed.id)).toEqual([job.id]);
      await service.shutdown();
    });

    it('lists jobs newest first, without their results', async () => {
      const service = serviceWith();
      const first = service.start(TIMELINE, OWNER);
      await settled(service, first.id);
      await new Promise((resolve) => setTimeout(resolve, 3));
      const second = service.start(TIMELINE, OWNER);
      await settled(service, second.id);
      const listed = service.list(OWNER.keyId);
      expect(listed.map((job) => job.id)).toEqual([second.id, first.id]);
      expect(listed.every((job) => job.result === undefined)).toBe(true);
    });
  });

  describe('limits', () => {
    function gated(): { service: GenerationJobService; release: () => void } {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const service = serviceWith({
        llmClient: () => modelClient(modelEvents(4), gate),
        limits: { maxRunningPerKey: 2, maxRunningTotal: 3 },
      });
      return { service, release };
    }

    it('refuses a third job from one key while two run, and takes it once one is cancelled', async () => {
      const { service, release } = gated();
      const a = service.start(TIMELINE, OWNER);
      service.start(TIMELINE, OWNER);
      expect(() => service.start(TIMELINE, OWNER)).toThrow(GenerationLimitError);
      service.cancel(a.id, OWNER.keyId);
      expect(() => service.start(TIMELINE, OWNER)).not.toThrow();
      release();
      await service.shutdown();
    });

    it('refuses any key once the app is at its own limit', async () => {
      const { service, release } = gated();
      service.start(TIMELINE, OWNER);
      service.start(TIMELINE, OWNER);
      service.start(TIMELINE, OTHER);
      try {
        service.start(TIMELINE, { keyId: 'third-key' });
        expect.unreachable('the app limit should have refused it');
      } catch (error) {
        expect(error).toBeInstanceOf(GenerationLimitError);
        expect((error as GenerationLimitError).retryAfterSeconds).toBeGreaterThan(0);
      }
      release();
      await service.shutdown();
    });

    it('caps how many jobs a key may start in an hour, and says when it may try again', async () => {
      let now = Date.parse('2026-05-01T00:00:00Z');
      const service = serviceWith({ limits: { maxPerKeyPerHour: 2 }, now: () => now });
      await settled(service, service.start(TIMELINE, OWNER).id);
      now += 10 * 60 * 1000;
      await settled(service, service.start(TIMELINE, OWNER).id);
      try {
        service.start(TIMELINE, OWNER);
        expect.unreachable('the hourly cap should have refused it');
      } catch (error) {
        expect(error).toBeInstanceOf(GenerationLimitError);
        // The first start leaves the window 50 minutes from now.
        expect((error as GenerationLimitError).retryAfterSeconds).toBe(50 * 60);
      }
      // Another key is not charged for it.
      expect(() => service.start({ ...TIMELINE, options: { ...TIMELINE.options, dryRun: true } }, OTHER)).not.toThrow();
      // And the window moves on.
      now += 51 * 60 * 1000;
      expect(() => service.start({ ...TIMELINE, options: { ...TIMELINE.options, dryRun: true } }, OWNER)).not.toThrow();
      await service.shutdown();
    });
  });

  it('forgets finished jobs after the retention period, and keeps the running ones', async () => {
    let now = Date.parse('2026-05-01T00:00:00Z');
    const service = serviceWith({ limits: { retentionMs: 60_000 }, now: () => now });
    const done = await settled(service, service.start({ ...TIMELINE, options: { ...TIMELINE.options, dryRun: true } }, OWNER).id);
    now += 120_000;
    expect(service.list(OWNER.keyId)).toEqual([]);
    expect(service.get(done.id, OWNER.keyId)).toBeUndefined();
  });
});
