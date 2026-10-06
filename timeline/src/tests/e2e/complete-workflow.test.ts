import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import type { Server } from 'http';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Application } from '@/index';
import { getContainer, cleanupContainer } from '@/container';
import { requestTimeout } from '@/api/middleware';

/**
 * `Application` keeps its Express instance private and exposes no accessor,
 * so the tests need a way to reach it. This is the single documented place
 * that cast happens; adding a public `get expressApp()` to Application would
 * remove the need for it entirely.
 */
function expressApp(application: Application): express.Application {
  return (application as unknown as { app: express.Application }).app;
}

/**
 * Container services are lazy singletons: `getHealthStatus()` reports a
 * service as up only once its getter has been resolved (pinned by
 * src/tests/unit/container.test.ts, "should track service initialization
 * status"), so a container nothing has asked for yet answers /health with
 * 503 "unhealthy" even though nothing is actually broken. Resolving the whole
 * roster first also proves local mode can construct every service, and makes
 * the health assertions below describe real component state rather than
 * whichever getter an earlier test happened to touch.
 */
function resolveServiceRoster(): Record<string, unknown> {
  const container = getContainer();
  return {
    temporalService: container.temporalService,
    causalService: container.causalService,
    inferenceService: container.inferenceService,
    graphCopyService: container.graphCopyService,
    validationService: container.validationService,
    cacheInvalidationService: container.cacheInvalidationService,
    databaseOptimizationService: container.databaseOptimizationService,
    eventRepository: container.eventRepository,
    arcRepository: container.arcRepository,
    graphService: container.graphService,
    exportService: container.exportService,
    jobService: container.jobService,
    graphRepository: container.graphRepository,
    versionRepository: container.versionRepository,
    jobRepository: container.jobRepository,
    authService: container.authService,
    rateLimitService: container.rateLimitService,
    apiKeyRepository: container.apiKeyRepository
  };
}

describe('Complete End-to-End Workflow Tests', () => {
  let app: Application;
  let server: Server;
  let testDataDir: string;

  beforeAll(async () => {
    // Point local execution at a throwaway directory BEFORE the Application
    // exists: Application's constructor calls loadConfig(), and the local
    // graph store resolves its file path from that config when it is
    // constructed during initialize(). Without this the suite ran against the
    // repository's real ./data/graph.json and every run left its "Test
    // historical event" rows behind (state leaked between runs: 11 events, 6
    // of them ours).
    testDataDir = path.join(process.cwd(), `test-e2e-data-${process.pid}-${Date.now()}`);
    process.env.LOCAL_EXECUTION_ENABLED = 'true';
    process.env.LOCAL_DATA_DIR = testDataDir;
    process.env.LOCAL_GRAPH_FILE = 'e2e-workflow-graph.json';
    process.env.LOCAL_BACKUP_ENABLED = 'false';
    // config.ts rejects anything below 64 MB
    process.env.LOCAL_MAX_MEMORY_MB = '64';
    await fs.mkdir(testDataDir, { recursive: true });

    // Initialize application
    app = new Application();
    await app.initialize();

    // Every migrated route resolves its graph context and refuses the request
    // (404) rather than reading global data when none can be resolved (design
    // §5.1). This suite drives the API without an X-Graph-Id header, so it
    // establishes the active graph that context resolution falls back to.
    // Creating the first graph makes it active; setActiveGraph pins that
    // explicitly so the fallback cannot depend on creation order.
    const container = getContainer();
    const graph = await container.graphRepository.create({
      name: 'E2E Workflow Graph',
      description: 'Active graph for the end-to-end workflow suite'
    });
    await container.graphRepository.setActiveGraph(graph.id);

    // Start a real HTTP listener on an ephemeral port (port 0 lets the OS
    // pick, so concurrent runs cannot collide on a fixed port).
    server = await new Promise<Server>((resolve) => {
      const s = expressApp(app).listen(0, () => {
        resolve(s);
      });
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
    await cleanupContainer();
    if (testDataDir) {
      await fs.rm(testDataDir, { recursive: true, force: true });
    }
  });

  describe('Application Health and Status', () => {
    it('should return application status from root endpoint', async () => {
      const response = await request(expressApp(app))
        .get('/')
        .expect(200);

      expect(response.body).toMatchObject({
        name: 'Hierarchical Temporal Graph System',
        version: '1.0.0',
        status: 'running',
        api: '/api',
        health: '/health'
      });
      expect(response.body.timestamp).toBeDefined();
    });

    it('should return health status', async () => {
      const singletons = resolveServiceRoster();

      const response = await request(expressApp(app))
        .get('/health')
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'healthy',
        services: expect.any(Object),
        database: {
          neo4j: true,
          redis: true
        },
        uptime: expect.any(Number),
        memory: expect.any(Object),
        version: '1.0.0'
      });

      // The health endpoint reports on exactly the roster of services the
      // container can build, and every one of them is up.
      expect(Object.keys(singletons).sort()).toEqual(Object.keys(response.body.services).sort());
      expect(Object.values(response.body.services).every(Boolean)).toBe(true);
    });

    it('should return API info', async () => {
      const response = await request(expressApp(app))
        .get('/api/info')
        .expect(200);

      expect(response.body).toMatchObject({
        name: 'Hierarchical Temporal Graph API',
        version: '1.0.0',
        description: expect.any(String),
        endpoints: expect.any(Object)
      });
    });

    it('should serve the API over the real HTTP listener', async () => {
      // Everything else drives supertest with the Express app (supertest spins
      // up its own ephemeral listener per request). This one goes through the
      // server this suite booted, so the listener itself is exercised too.
      const response = await request(server)
        .get('/api/health')
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'ok',
        service: 'hierarchical-temporal-graph'
      });
      expect(response.body.timestamp).toEqual(expect.any(String));
    });
  });

  describe('Event Management Workflow', () => {
    let createdEventId: string;

    it('should create a new event', async () => {
      const eventData = {
        description: 'Test historical event',
        actor: 'Test Actor',
        target: 'Test Target',
        timestamp: '2023-01-01T12:00:00Z',
        metadata: {
          source: 'test',
          confidence: 0.9
        }
      };

      const response = await request(expressApp(app))
        .post('/api/events')
        .send(eventData)
        .expect(201);

      expect(response.body).toMatchObject({
        success: true,
        message: 'Event created successfully',
        requestId: expect.any(String)
      });

      expect(response.body.data).toMatchObject({
        id: expect.any(String),
        description: eventData.description,
        actor: eventData.actor,
        target: eventData.target,
        // The route parses the ISO string into a Date and Event.toJSON()
        // serialises it back through toISOString(), which always carries
        // milliseconds. The echoed value is therefore the normalised instant,
        // not the literal request string.
        timestamp: new Date(eventData.timestamp).toISOString()
      });
      expect(response.body.data.metadata).toEqual(eventData.metadata);

      createdEventId = response.body.data.id;
    });

    it('should retrieve the created event by ID', async () => {
      const response = await request(expressApp(app))
        .get(`/api/events/${createdEventId}`)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        requestId: expect.any(String)
      });

      expect(response.body.data).toMatchObject({
        id: createdEventId,
        description: 'Test historical event',
        actor: 'Test Actor',
        target: 'Test Target'
      });
    });

    it('should update the event', async () => {
      const updateData = {
        description: 'Updated test historical event',
        metadata: {
          source: 'test-updated',
          confidence: 0.95
        }
      };

      const response = await request(expressApp(app))
        .put(`/api/events/${createdEventId}`)
        .send(updateData)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        message: 'Event updated successfully',
        requestId: expect.any(String)
      });

      expect(response.body.data).toMatchObject({
        id: createdEventId,
        description: updateData.description,
        actor: 'Test Actor',
        target: 'Test Target',
        metadata: updateData.metadata
      });
    });

    it('should list events with pagination', async () => {
      const response = await request(expressApp(app))
        .get('/api/events?limit=10&offset=0')
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: expect.any(Array),
        pagination: {
          limit: 10,
          offset: 0,
          total: expect.any(Number),
          hasMore: expect.any(Boolean)
        },
        requestId: expect.any(String)
      });

      // The store is this run's own (see beforeAll), so the workflow created
      // exactly one event and offset paging has nothing else to walk past.
      expect(response.body.pagination.total).toBe(1);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].id).toBe(createdEventId);
    });

    it('should filter events by actor', async () => {
      const response = await request(expressApp(app))
        .get('/api/events?actor=Test Actor')
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: expect.any(Array),
        filters: {
          actor: 'Test Actor',
          target: null,
          timeRange: null
        }
      });

      // Should contain our created event
      const foundEvent = response.body.data.find((event: { id?: string }) => event.id === createdEventId);
      expect(foundEvent).toBeDefined();
    });

    it('should filter events by time range', async () => {
      const response = await request(expressApp(app))
        .get('/api/events?startTime=2022-01-01T00:00:00Z&endTime=2024-01-01T00:00:00Z')
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: expect.any(Array),
        filters: {
          actor: null,
          target: null,
          timeRange: {
            startTime: '2022-01-01T00:00:00Z',
            endTime: '2024-01-01T00:00:00Z'
          }
        }
      });

      const foundEvent = response.body.data.find((event: { id?: string }) => event.id === createdEventId);
      expect(foundEvent).toBeDefined();
    });

    it('should get event count statistics', async () => {
      const response = await request(expressApp(app))
        .get('/api/events/stats/count')
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          count: 1
        },
        requestId: expect.any(String)
      });
    });

    it('should delete the event', async () => {
      const response = await request(expressApp(app))
        .delete(`/api/events/${createdEventId}`)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        message: 'Event deleted successfully',
        data: { id: createdEventId },
        requestId: expect.any(String)
      });
    });

    it('should return 404 for deleted event', async () => {
      const response = await request(expressApp(app))
        .get(`/api/events/${createdEventId}`)
        .expect(404);

      expect(response.body.error.message).toContain(createdEventId);
      expect(response.body.error.requestId).toEqual(expect.any(String));
    });
  });

  describe('Error Handling and Validation', () => {
    it('should validate required fields for event creation', async () => {
      const invalidEventData = {
        description: 'Test event',
        // Missing required fields: actor, target, timestamp
      };

      const response = await request(expressApp(app))
        .post('/api/events')
        .send(invalidEventData)
        .expect(400);

      expect(response.body.error).toMatchObject({
        message: expect.stringContaining('Missing required fields'),
        requestId: expect.any(String)
      });
    });

    it('should validate JSON content type', async () => {
      const response = await request(expressApp(app))
        .post('/api/events')
        .set('Content-Type', 'text/plain')
        .send('invalid data')
        .expect(400);

      expect(response.body.error).toMatchObject({
        message: 'Content-Type must be application/json',
        requestId: expect.any(String)
      });
    });

    it('should handle invalid JSON', async () => {
      // KNOWN DEFECT (not fixed here, see the run report): malformed JSON is a
      // client error but comes back as 500. express.json()'s `verify` callback
      // in src/index.ts throws, body-parser rewraps it as
      // http-errors {status: 403, type: 'entity.verify.failed'}, and
      // errorHandler only understands AppError, so it flattens everything else
      // to 500 "Internal server error". The fix belongs in errorHandler
      // (honour an http-errors `status` for 4xx); it is not applied here
      // because src/api/routes/events.test.ts pins the current 500 behaviour
      // for the same input and is outside this file's remit.
      const response = await request(expressApp(app))
        .post('/api/events')
        .set('Content-Type', 'application/json')
        .send('{"invalid": json}')
        .expect(500);

      expect(response.body.error).toMatchObject({
        message: 'Internal server error',
        requestId: expect.any(String)
      });
    });

    it('should return 404 for non-existent routes', async () => {
      const response = await request(expressApp(app))
        .get('/api/nonexistent')
        .expect(404);

      expect(response.body.error).toMatchObject({
        message: expect.stringContaining('Route GET /api/nonexistent not found')
      });
    });

    it('should handle invalid event ID format', async () => {
      const response = await request(expressApp(app))
        .get('/api/events/invalid-id-format')
        .expect(404);

      expect(response.body.error.message).toContain('Event with ID invalid-id-format not found');
      expect(response.body.error.requestId).toEqual(expect.any(String));
    });

    it('should reject an out-of-range pagination limit', async () => {
      const response = await request(expressApp(app))
        .get('/api/events?limit=5000')
        .expect(400);

      expect(response.body.error.message).toContain('Limit must be a number between 1 and 1000');
    });
  });

  describe('Request Logging and Monitoring', () => {
    it('should include a distinct request ID in every response', async () => {
      const first = await request(expressApp(app))
        .get('/api/events?limit=1')
        .expect(200);

      const second = await request(expressApp(app))
        .get('/api/events?limit=1')
        .expect(200);

      expect(first.body.requestId).toMatch(/^req_/);
      expect(second.body.requestId).toMatch(/^req_/);
      expect(first.body.requestId).not.toBe(second.body.requestId);
    });

    it('should return 408 when a request outlives the configured timeout', async () => {
      // Exercises the same requestTimeout() factory the Application wires with
      // config.performance.queryTimeoutMs, against a handler that never
      // answers, and pins the 408 contract the suite depends on.
      const timeoutApp = express();
      timeoutApp.use(requestTimeout(50));
      timeoutApp.get('/never-answers', () => {
        // deliberately never responds
      });

      const response = await request(timeoutApp)
        .get('/never-answers')
        .expect(408);

      expect(response.body.error).toMatchObject({
        message: 'Request timeout',
        timeout: 50
      });
    });
  });

  describe('Service Integration', () => {
    it('should demonstrate service container integration', async () => {
      // This test verifies that the container is properly injected
      // and services are accessible through the API
      const singletons = resolveServiceRoster();

      const response = await request(expressApp(app))
        .get('/health')
        .expect(200);

      expect(response.body.status).toBe('healthy');
      expect(response.body.services).toBeDefined();
      expect(response.body.database).toEqual({ neo4j: true, redis: true });
      expect(Object.keys(singletons).sort()).toEqual(Object.keys(response.body.services).sort());
    });

    it('should serve event routes from the container-injected repository', async () => {
      // A request with no container injection would fail here: the routes read
      // req.container.eventRepository, which injectContainer populates.
      const created = await request(expressApp(app))
        .post('/api/events')
        .send({
          description: 'Container injected event',
          actor: 'Test Actor',
          target: 'Test Target',
          timestamp: '2023-06-01T00:00:00Z'
        })
        .expect(201);

      const eventId: string = created.body.data.id;
      expect(eventId).toEqual(expect.any(String));

      const listed = await request(expressApp(app))
        .get('/api/events?limit=10&offset=0')
        .expect(200);

      expect(listed.body.data.map((event: { id: string }) => event.id)).toContain(eventId);

      await request(expressApp(app))
        .delete(`/api/events/${eventId}`)
        .expect(200);
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle multiple concurrent requests', async () => {
      const requests = Array.from({ length: 10 }, () =>
        request(expressApp(app))
          .get('/api/info')
          .expect(200)
      );

      const responses = await Promise.all(requests);

      responses.forEach(response => {
        expect(response.body.name).toBe('Hierarchical Temporal Graph API');
      });
    });

    it('should respect pagination limits', async () => {
      const response = await request(expressApp(app))
        .get('/api/events?limit=5')
        .expect(200);

      expect(response.body.pagination.limit).toBe(5);
      expect(response.body.data.length).toBeLessThanOrEqual(5);
    });
  });
});
