/**
 * Cloud-mode (LOCAL_EXECUTION_ENABLED=false) coverage for the Phase 1/3 I/O
 * subsystem.
 *
 * GraphService, ExportService, JobService and their repositories build their
 * storage from `localExecution.dataDirectory`; no Redis- or Neo4j-backed
 * implementation of GraphRepository/VersionRepository/JobRepository/
 * RateLimitService exists. The contract these tests pin down is therefore: with
 * `localExecution.enabled: false`, `Container.initialize()` still initialises
 * the graph/export/job services, and the graph/export/job routes serve requests
 * against the configured file-backed store.
 *
 * The config is constructed inline with `enabled: false` and the database
 * manager is a health-check stub, so nothing in this file can fall back to a
 * local-mode container or to a running Neo4j/Redis.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express, { Express } from 'express';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Container, initializeContainer, cleanupContainer } from '@/container';
import { DatabaseManager } from '@/utils/database';
import { AppConfig } from '@/utils/config';
import { apiRouter } from '@/api/routes';
import { errorHandler, injectContainer } from '@/api/middleware';
import { JobRepository } from '@/repositories/JobRepository';
import { RateLimitConfig } from '@/models/ApiKey';

/**
 * A DatabaseManager whose initialisation succeeds without a running Neo4j or
 * Redis. The cloud branch of `Container.initialize()` runs the database health
 * check before anything else, so this is the minimum stand-in that lets that
 * branch execute in a unit-test environment.
 */
class AlwaysHealthyDatabaseManager extends DatabaseManager {
  constructor() {
    super({
      neo4j: { uri: 'bolt://localhost:7687', username: 'neo4j', password: 'password' },
      redis: { host: 'localhost', port: 6379 },
    });
  }

  async initializeNeo4j(): Promise<void> {
    // No connection: this stub is only ever used to reach the cloud branch.
  }

  async initializeRedis(): Promise<void> {
    // No connection: this stub is only ever used to reach the cloud branch.
  }

  async healthCheck(): Promise<{ neo4j: boolean; redis: boolean }> {
    return { neo4j: true, redis: true };
  }

  async close(): Promise<void> {
    // Nothing was opened.
  }
}

function cloudConfig(dataDirectory: string): AppConfig {
  return {
    port: 3000,
    nodeEnv: 'test',
    database: {
      neo4j: { uri: 'bolt://localhost:7687', username: 'neo4j', password: 'password' },
      redis: { host: 'localhost', port: 6379 },
    },
    performance: {
      queryTimeoutMs: 2000,
      maxQueryResults: 10000,
      cacheExpirationMs: 300000,
    },
    localExecution: {
      enabled: false,
      dataDirectory,
      graphFile: 'graph.json',
      cacheSize: 1000,
      persistenceInterval: 30000,
      backupEnabled: false,
      backupInterval: 300000,
      maxMemoryUsage: 512,
    },
  };
}

const rateLimitConfig: RateLimitConfig = {
  requestsPerMinute: 100,
  requestsPerHour: 1000,
  requestsPerDay: 10000,
  batchSizeLimit: 10,
  concurrentStreams: 5,
};

describe('Cloud mode I/O subsystem (localExecution.enabled = false)', () => {
  let app: Express;
  let container: Container;
  let testDataDir: string;
  let writeKey: string;
  let graphId: string;
  /** Health captured immediately after `initialize()`, before any lazy getter. */
  let healthAfterInitialize: Awaited<ReturnType<Container['getHealthStatus']>>;

  beforeAll(async () => {
    testDataDir = path.join(os.tmpdir(), `cloud-mode-io-${process.pid}-${Date.now()}`);
    await fs.mkdir(testDataDir, { recursive: true });

    container = initializeContainer(new AlwaysHealthyDatabaseManager(), cloudConfig(testDataDir));
    await container.initialize();

    // Captured before the getters below are touched, so this snapshot is
    // evidence that `initialize()` created the services rather than a later
    // property access doing so.
    healthAfterInitialize = await container.getHealthStatus();

    writeKey = (
      await container.authService.createApiKey({
        name: 'Cloud Mode I/O Key',
        permissions: ['read:graphs', 'write:graphs', 'export'],
      })
    ).key;

    const graph = await container.graphRepository.create({ name: 'Cloud Mode Graph' });
    graphId = graph.id;
    await container.graphRepository.setActiveGraph(graphId);

    app = express();
    app.use(express.json());
    app.use(injectContainer);
    app.use('/api', apiRouter);
    app.use(errorHandler);
  });

  afterAll(async () => {
    await cleanupContainer();
    await fs.rm(testDataDir, { recursive: true, force: true });
  });

  describe('initialisation', () => {
    it('initialises graph/export/job services during initialize() in cloud config', () => {
      expect(healthAfterInitialize.services.graphService).toBe(true);
      expect(healthAfterInitialize.services.exportService).toBe(true);
      expect(healthAfterInitialize.services.jobService).toBe(true);
      // Auth services were already initialised in every mode; asserted here so
      // the cloud branch's full service set is pinned.
      expect(healthAfterInitialize.services.authService).toBe(true);
      expect(healthAfterInitialize.services.rateLimitService).toBe(true);
    });
  });

  describe('graph routes', () => {
    it('POST /api/graphs creates a graph', async () => {
      const response = await request(app)
        .post('/api/graphs')
        .set('X-API-Key', writeKey)
        .send({ name: 'Cloud Mode Route Graph', description: 'created in cloud config' })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toBe('Cloud Mode Route Graph');
    });

    it('GET /api/graphs lists graphs from the configured data directory', async () => {
      const response = await request(app)
        .get('/api/graphs')
        .set('X-API-Key', writeKey)
        .expect(200);

      expect(response.body.success).toBe(true);
      const names = (response.body.data as Array<{ name: string }>).map((g) => g.name);
      expect(names).toContain('Cloud Mode Graph');
    });
  });

  describe('export/job routes', () => {
    let jobId: string;

    it('POST /api/export/jobs creates a job and persists it under the data directory', async () => {
      const response = await request(app)
        .post('/api/export/jobs')
        .set('X-API-Key', writeKey)
        .set('X-Graph-Id', graphId)
        .send({ scope: 'full', includeProvenance: false })
        .expect(202);

      expect(response.body.success).toBe(true);
      jobId = response.body.data.jobId as string;
      expect(jobId).toBeTruthy();

      // The job file lands in the container's configured directory. Without the
      // cloud-mode initialisation this route fails before returning (the jobs
      // directory is never created).
      await expect(fs.access(path.join(testDataDir, 'jobs', `${jobId}.json`))).resolves.toBeUndefined();
    });

    it('GET /api/export/jobs/:jobId returns the created job', async () => {
      const response = await request(app)
        .get(`/api/export/jobs/${jobId}`)
        .set('X-API-Key', writeKey)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(jobId);
      expect(response.body.data.type).toBe('export');
    });
  });

  describe('file-backed stores', () => {
    it('JobRepository persists to the cloud-configured data directory and reloads', async () => {
      const job = await container.jobRepository.create({
        type: 'export',
        parameters: {
          type: 'export',
          graphId,
          scope: 'full',
          includeProvenance: false,
        },
      });

      await expect(
        fs.access(path.join(testDataDir, 'jobs', `${job.id}.json`))
      ).resolves.toBeUndefined();

      const reloaded = new JobRepository({ dataDir: testDataDir });
      await reloaded.initialize();
      try {
        const found = await reloaded.findById(job.id);
        expect(found).not.toBeNull();
        expect(found?.type).toBe('export');
      } finally {
        reloaded.stop();
      }
    });

    it('VersionRepository round-trips a write made through the cloud container', async () => {
      const graph = await container.graphService.createGraph({ name: 'Cloud Versioned Graph' });

      await container.graphRepository.commitChanges(
        graph.id,
        {
          added: [
            {
              type: 'event',
              id: 'cloud-event-1',
              data: { id: 'cloud-event-1', description: 'written in cloud config' },
            },
          ],
          modified: [],
          deleted: [],
        },
        'create',
        'cloud mode test'
      );

      const checkedOut = await container.graphRepository.checkout(graph.id);
      expect(Object.keys(checkedOut.events)).toContain('cloud-event-1');
    });

    it('RateLimitService records and persists under the cloud-configured data directory', async () => {
      const service = container.rateLimitService;
      const result = service.recordRequest('cloud-mode-key', rateLimitConfig);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(rateLimitConfig.requestsPerMinute - 1);

      // `stop()` flushes synchronously; the service still answers requests
      // in-process afterwards.
      service.stop();

      const raw = await fs.readFile(
        path.join(testDataDir, 'rate-limits', 'limits.json'),
        'utf8'
      );
      const persisted = JSON.parse(raw) as Array<{ keyId: string }>;
      expect(persisted.some((state) => state.keyId === 'cloud-mode-key')).toBe(true);
    });
  });
});
