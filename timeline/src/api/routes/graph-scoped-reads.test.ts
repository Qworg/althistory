import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { temporalRoutes } from './temporal';
import { inferenceRoutes } from './inference';
import { errorHandler } from '@/api/middleware';
import { Container } from '@/container';
import { LocalDatabaseManager } from '@/utils/database';
import { LocalGraphStore } from '@/utils/LocalGraphStore';
import { AppConfig } from '@/utils/config';
import { CreateEventRequest } from '@/models/Event';

/**
 * Route-level isolation for the READ-ONLY groups migrated onto graph-scoped
 * repositories. Unlike the write routes these have no auth
 * chain, so the middleware is stubbed down to its one essential job: establish
 * `req.graphId` from the header, or refuse the request. The middleware's own
 * resolution behaviour is covered by `src/api/graph-context.test.ts`.
 */
vi.mock('@/api/middleware', async () => {
  const actual = await vi.importActual('@/api/middleware');
  return {
    ...actual,
    resolveGraphContext: () => (req: Request, res: Response, next: NextFunction) => {
      const graphId = req.get('X-Graph-Id');
      if (!graphId) {
        return res.status(404).json({ error: { message: 'No graph context available' } });
      }
      req.graphId = graphId;
      next();
    },
  };
});

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

function eventData(description: string, actor: string): CreateEventRequest {
  return {
    description,
    actor,
    target: 'target',
    // Inside the range used by the temporal timeline request below.
    timestamp: new Date('2020-01-01T00:00:00.000Z'),
  };
}

describe('graph-scoped route reads', () => {
  let testDir: string;
  let container: Container;
  let app: express.Express;
  const originalBackupSetting = process.env.LOCAL_BACKUP_ENABLED;

  beforeEach(async () => {
    process.env.LOCAL_BACKUP_ENABLED = 'false';
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'graph-scoped-routes-'));

    const unscopedStore = new LocalGraphStore({
      dataFile: path.join(testDir, 'unscoped.json'),
    });
    container = new Container(new LocalDatabaseManager(unscopedStore), createConfig(testDir));

    app = express();
    app.use(express.json());
    // Stand in for injectContainer; the routes only read `req.container`.
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.requestId = 'test-request-id';
      req.startTime = Date.now();
      req.container = container;
      next();
    });
    app.use('/api/temporal', temporalRoutes);
    app.use('/api/inference', inferenceRoutes);
    app.use(errorHandler);
  });

  afterEach(async () => {
    await container.cleanup();
    await fs.rm(testDir, { recursive: true, force: true });
    if (originalBackupSetting === undefined) {
      delete process.env.LOCAL_BACKUP_ENABLED;
    } else {
      process.env.LOCAL_BACKUP_ENABLED = originalBackupSetting;
    }
  });

  it('serves a timeline containing only the header-scoped graph events', async () => {
    const graphA = await container.graphScopedRepositories('graph-a');
    const graphB = await container.graphScopedRepositories('graph-b');
    await graphA.eventRepository.create(eventData('Only in A', 'actor-a'));
    await graphB.eventRepository.create(eventData('Only in B', 'actor-b'));

    const response = await request(app)
      .get('/api/temporal/timeline')
      .set('X-Graph-Id', 'graph-a')
      .query({
        startTime: '2019-01-01T00:00:00.000Z',
        endTime: '2021-01-01T00:00:00.000Z',
      })
      .expect(200);

    const descriptions = (response.body.data.events as Array<{ description: string }>).map(
      (event) => event.description
    );
    expect(descriptions).toEqual(['Only in A']);
  });

  it('analyses only the header-scoped graph for actor relationships', async () => {
    const graphA = await container.graphScopedRepositories('graph-a');
    const graphB = await container.graphScopedRepositories('graph-b');
    // The route requires at least two actors, so graph A holds two matching
    // events while graph B holds none for the same actor pair.
    await graphA.eventRepository.create(eventData('First in A', 'actor-a1'));
    await graphA.eventRepository.create(eventData('Second in A', 'actor-a2'));
    await graphB.eventRepository.create(eventData('Only in B', 'actor-b'));

    const actorQuery = JSON.stringify(['actor-a1', 'actor-a2']);
    const inA = await request(app)
      .get('/api/inference/actor-relationships')
      .set('X-Graph-Id', 'graph-a')
      .query({ actors: actorQuery })
      .expect(200);
    expect(inA.body.data.interactions).toBe(2);

    const inB = await request(app)
      .get('/api/inference/actor-relationships')
      .set('X-Graph-Id', 'graph-b')
      .query({ actors: actorQuery })
      .expect(200);
    expect(inB.body.data.interactions).toBe(0);
  });

  it('refuses an unscoped request instead of reading the global store', async () => {
    const graphA = await container.graphScopedRepositories('graph-a');
    await graphA.eventRepository.create(eventData('Only in A', 'actor-a'));

    const response = await request(app)
      .get('/api/temporal/timeline')
      .query({
        startTime: '2019-01-01T00:00:00.000Z',
        endTime: '2021-01-01T00:00:00.000Z',
      })
      .expect(404);

    expect(response.body.error.message).toBe('No graph context available');
  });
});
