import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express, { Express } from 'express';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { causalRoutes } from './causal';
import { errorHandler } from '@/api/middleware';
import { Container, getContainer } from '@/container';
import { LocalDatabaseManager } from '@/utils/database';
import { LocalGraphStore } from '@/utils/LocalGraphStore';
import { AppConfig } from '@/utils/config';
import { Event } from '@/models/Event';

/**
 * Partial mock: `getContainer` is replaced so `resolveGraphContext` (which the
 * causal router mounts) resolves the real `Container` this suite owns, while
 * the `Container` class itself stays real. No `as any`: the real class keeps
 * the mock's return type honest.
 */
vi.mock('@/container', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/container')>();
  return {
    ...actual,
    getContainer: vi.fn(),
  };
});

/**
 * Request-level acceptance for graph-scoped causal isolation.
 *
 * The suite boots the real causal router over a real `Container` bound to a
 * temp data directory, so it exercises the whole path: header resolution ->
 * per-graph live store -> causal service -> response. A test that asserts graph
 * B sees an empty set while graph A has a link is the negative case that a
 * forgotten scope would fail.
 */
function createConfig(dataDirectory: string): AppConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    nodeEnv: 'test',
    database: {
      neo4j: {
        uri: 'bolt://localhost:7687',
        username: 'neo4j',
        password: 'password',
      },
      redis: {
        host: 'localhost',
        port: 6379,
      },
    },
    performance: {
      queryTimeoutMs: 2000,
      maxQueryResults: 10000,
      cacheExpirationMs: 300000,
    },
    cloudState: {
      singleReplicaAcknowledged: true,
    },
    // Required by `AppConfig`; the entity guard reads the environment (`api/entityAuth.ts`).
    apiAuth: { required: false },
    localExecution: {
      enabled: true,
      dataDirectory,
      graphFile: 'unscoped-graph.json',
      cacheSize: 1000,
      persistenceInterval: 30000,
      backupEnabled: false,
      backupInterval: 300000,
      maxMemoryUsage: 512,
    },
  };
}

const RELATIONSHIP = {
  type: 'direct' as const,
  strength: 0.8,
  confidence: 0.9,
  evidence: 'Documented in the archive',
};

describe('causal route graph scoping', () => {
  let testDir: string;
  let container: Container;
  let app: Express;
  const originalLocalExecution = process.env.LOCAL_EXECUTION_ENABLED;
  const originalBackupSetting = process.env.LOCAL_BACKUP_ENABLED;

  beforeEach(async () => {
    // The causal service branches on `loadConfig().localExecution.enabled`; the
    // local store branch is what these routes must use. Backups install a
    // per-store timer, so disable them for determinism.
    process.env.LOCAL_EXECUTION_ENABLED = 'true';
    process.env.LOCAL_BACKUP_ENABLED = 'false';
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'causal-routes-'));

    const unscopedStore = new LocalGraphStore({
      dataFile: path.join(testDir, 'unscoped.json'),
    });
    container = new Container(new LocalDatabaseManager(unscopedStore), createConfig(testDir));
    await container.graphRepository.initialize();
    vi.mocked(getContainer).mockReturnValue(container);

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.container = container;
      req.requestId = 'test-request-id';
      req.startTime = Date.now();
      next();
    });
    app.use('/api/causal', causalRoutes);
    app.use(errorHandler);
  });

  afterEach(async () => {
    await container.cleanup();
    await fs.rm(testDir, { recursive: true, force: true });
    vi.clearAllMocks();
    if (originalLocalExecution === undefined) {
      delete process.env.LOCAL_EXECUTION_ENABLED;
    } else {
      process.env.LOCAL_EXECUTION_ENABLED = originalLocalExecution;
    }
    if (originalBackupSetting === undefined) {
      delete process.env.LOCAL_BACKUP_ENABLED;
    } else {
      process.env.LOCAL_BACKUP_ENABLED = originalBackupSetting;
    }
  });

  async function seedEvent(
    graphId: string,
    description: string,
    actor: string,
    timestamp: Date
  ): Promise<Event> {
    const { eventRepository } = await container.graphScopedRepositories(graphId);
    return eventRepository.create({ description, actor, target: 'target', timestamp });
  }

  async function createLink(
    graphId: string,
    causeEventId: string,
    effectEventId: string
  ): Promise<void> {
    const response = await request(app)
      .post('/api/causal/link')
      .set('X-Graph-Id', graphId)
      .send({ causeEventId, effectEventId, relationship: RELATIONSHIP });
    expect(response.status).toBe(201);
  }

  it('returns 404 and never falls back to global data when no graph resolves', async () => {
    const response = await request(app).get('/api/causal/relationships').expect(404);

    expect(response.body.error.message).toMatch(/No graph context available/);
  });

  it('creates and reads a causal link only inside the header graph', async () => {
    const graphA = await container.graphRepository.create({ name: 'Graph A' });
    const graphB = await container.graphRepository.create({ name: 'Graph B' });

    const causeA = await seedEvent(graphA.id, 'A cause', 'actor-a', new Date('2020-01-01T00:00:00Z'));
    const effectA = await seedEvent(graphA.id, 'A effect', 'actor-a', new Date('2020-01-02T00:00:00Z'));
    const causeB = await seedEvent(graphB.id, 'B cause', 'actor-b', new Date('2020-02-01T00:00:00Z'));
    const effectB = await seedEvent(graphB.id, 'B effect', 'actor-b', new Date('2020-02-02T00:00:00Z'));

    await createLink(graphA.id, causeA.id, effectA.id);

    const linksA = await request(app)
      .get('/api/causal/relationships')
      .set('X-Graph-Id', graphA.id)
      .expect(200);
    expect(linksA.body.data).toHaveLength(1);
    expect(linksA.body.data[0].cause_event_id).toBe(causeA.id);

    // The same request in graph B's context must not see graph A's link.
    const linksB = await request(app)
      .get('/api/causal/relationships')
      .set('X-Graph-Id', graphB.id)
      .expect(200);
    expect(linksB.body.data).toHaveLength(0);

    // Graph B's event ids do not resolve while scoped to graph A, so a link
    // naming them cannot be created: the boundary holds on the write path too.
    const crossGraph = await request(app)
      .post('/api/causal/link')
      .set('X-Graph-Id', graphA.id)
      .send({ causeEventId: causeB.id, effectEventId: effectB.id, relationship: RELATIONSHIP })
      .expect(404);
    expect(crossGraph.body.error.message).toMatch(/Cause event with ID/);
  });

  it('reads the resolved active graph when no header is sent, and header overrides it', async () => {
    const graphA = await container.graphRepository.create({ name: 'Graph A' });
    const graphB = await container.graphRepository.create({ name: 'Graph B' });

    const causeA = await seedEvent(graphA.id, 'A cause', 'actor-a', new Date('2020-01-01T00:00:00Z'));
    const effectA = await seedEvent(graphA.id, 'A effect', 'actor-a', new Date('2020-01-02T00:00:00Z'));
    await createLink(graphA.id, causeA.id, effectA.id);

    // Graph A is active (first graph created), so no header reads A's link.
    const activeA = await request(app).get('/api/causal/relationships').expect(200);
    expect(activeA.body.data).toHaveLength(1);

    // An explicit header wins over the active pointer.
    const headerB = await request(app)
      .get('/api/causal/relationships')
      .set('X-Graph-Id', graphB.id)
      .expect(200);
    expect(headerB.body.data).toHaveLength(0);
  });

  it('changes the data read when the active graph changes', async () => {
    const graphA = await container.graphRepository.create({ name: 'Graph A' });
    const graphB = await container.graphRepository.create({ name: 'Graph B' });

    const causeA = await seedEvent(graphA.id, 'A cause', 'actor-a', new Date('2020-01-01T00:00:00Z'));
    const effectA = await seedEvent(graphA.id, 'A effect', 'actor-a', new Date('2020-01-02T00:00:00Z'));
    await createLink(graphA.id, causeA.id, effectA.id);

    expect(await container.graphRepository.setActiveGraph(graphB.id)).toBe(true);
    const whileBActive = await request(app).get('/api/causal/relationships').expect(200);
    expect(whileBActive.body.data).toHaveLength(0);

    expect(await container.graphRepository.setActiveGraph(graphA.id)).toBe(true);
    const whileAActive = await request(app).get('/api/causal/relationships').expect(200);
    expect(whileAActive.body.data).toHaveLength(1);
  });
});
