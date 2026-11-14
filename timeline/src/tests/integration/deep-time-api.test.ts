import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { loadConfig, initializeDatabaseManager } from '@/utils';
import { initializeContainer, cleanupContainer, Container } from '@/container';
import { apiRouter } from '@/api/routes';
import { asRequestHandler } from '@/index';
import { 
  errorHandler, 
  notFoundHandler, 
  requestLogger, 
  requestTimeout,
  validateJsonRequest,
  injectContainer,
  rateLimit
} from '@/api/middleware';
import * as fs from 'fs/promises';
import { toAxisTime } from '@althistory/calendar';

describe('Deep time through the API', () => {
  let app: express.Application;
  let container: Container;
  /** The graph every request in this suite resolves to. */
  let graphId: string;
  const testDataDir = './test-deep-time-data';

  beforeAll(async () => {
    // Force local execution mode
    process.env.LOCAL_EXECUTION_ENABLED = 'true';
    process.env.LOCAL_DATA_DIR = testDataDir;
    process.env.LOCAL_GRAPH_FILE = 'deep-time-graph.json';
    process.env.LOCAL_BACKUP_ENABLED = 'false';
    // config.ts rejects anything below 64 MB
    process.env.LOCAL_MAX_MEMORY_MB = '64';
    
    // Ensure test directory exists
    try {
      await fs.mkdir(testDataDir, { recursive: true });
    } catch (error) {
      // Directory might already exist
    }

    // Initialize config and database
    const config = loadConfig();
    const dbManager = initializeDatabaseManager(config.database);
    container = initializeContainer(dbManager, config);
    
    await container.initialize();

    // Migrated routes resolve exactly one graph per request and return 404
    // rather than falling back to global data when none can be resolved.
    // This suite sends no X-Graph-Id, so it creates and
    // activates the graph that resolution falls back to; the per-test reset
    // below clears that graph's live store.
    const graph = await container.graphRepository.create({
      name: 'Deep Time Graph',
      description: 'Active graph for the deep-time API suite'
    });
    graphId = graph.id;
    await container.graphRepository.setActiveGraph(graphId);

    // Create Express app with same configuration as main app
    app = express();
    
    // Apply middleware stack
    app.use(helmet());
    app.use(cors());
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true }));
    app.use(requestLogger);
    app.use(requestTimeout(30000)); // 30 second timeout
    app.use(validateJsonRequest);
    // rateLimit is a FACTORY: it takes an optional config and returns the
    // middleware. Passing `rateLimit` itself to app.use() makes Express invoke
    // it as middleware, so it returns the inner handler without ever calling
    // next() and every request hangs until requestTimeout fires. This mirrors
    // src/index.ts, which wires it as `asRequestHandler(rateLimit())`.
    // The adapter is needed as well as the call: rateLimit's handler declares
    // an AuthenticatedRequest, which is narrower than Express's Request and so
    // is not assignable without it.
    app.use(asRequestHandler(rateLimit()));
    // injectContainer is itself an Express middleware: it pulls the globally
    // registered container (set by initializeContainer above) off the request.
    app.use(injectContainer);
    
    // Mount API routes
    app.use('/api', apiRouter);

    // Health check endpoint.
    // Registered BEFORE notFoundHandler: that handler terminates the chain for
    // anything still unmatched, so a /health route added after it can never
    // run and every health request 404s.
    app.get('/health', async (req, res) => {
      try {
        const health = await container.getHealthStatus();
        res.json(health);
      } catch (error) {
        res.status(500).json({ error: 'Health check failed' });
      }
    });

    // Apply error handling middleware
    app.use(notFoundHandler);
    app.use(errorHandler);
  });

  afterAll(async () => {
    await cleanupContainer();
    
    // Clean up test directory
    try {
      await fs.rmdir(testDataDir, { recursive: true });
    } catch (error) {
      console.warn('Could not clean up test directory:', error);
    }
  });

  beforeEach(async () => {
    // Clear any existing data before each test.
    //
    // The routes now read and write through repositories bound to the resolved
    // graph's live store, so this reset targets that scoped store rather than
    // the container's global store. Clearing the global store left the scoped
    // store untouched, so events accumulated across tests and pagination
    // assertions saw more rows than the test itself created.
    const scoped = await container.graphScopedRepositories(graphId);
    const existingEvents = await scoped.eventRepository.findAll();
    for (const event of existingEvents) {
      await scoped.eventRepository.delete(event.id);
    }

    const existingArcs = await scoped.arcRepository.findAll();
    for (const arc of existingArcs) {
      await scoped.arcRepository.delete(arc.id);
    }
  });

  const stamps = [
    ['first hearths', '-499999-06-15T00:00:00Z'],
    ['the last city', '+300000-01-01T00:00:00Z'],
    ['Hastings', '1066-10-14T09:00:00Z'],
  ] as const;

  async function post(description: string, timestamp: string) {
    const response = await request(app).post('/api/events').send({ description, actor: 'A', target: 'B', timestamp }).expect(201);
    return response.body.data as { id: string; timestamp: string; timestamp_ms: string };
  }

  it('stores a moment beyond a Date and answers it as text and as exact milliseconds', async () => {
    const event = await post('the last city', '+300000-01-01T00:00:00Z');
    expect(event.timestamp).toBe('+300000-01-01T00:00:00.000Z');
    expect(event.timestamp_ms).toBe(String(toAxisTime('+300000-01-01T00:00:00.000Z')));
    // A decimal string: JSON has no bigint, and a number would round past 2^53.
    expect(typeof event.timestamp_ms).toBe('string');
    const fetched = await request(app).get(`/api/events/${event.id}`).expect(200);
    expect(fetched.body.data.timestamp).toBe('+300000-01-01T00:00:00.000Z');
    expect(fetched.body.data.timestamp_ms).toBe(event.timestamp_ms);
  });

  it('lists in the order of time, filters by a range given as text, including beyond a Date\'s range', async () => {
    for (const [description, timestamp] of stamps) await post(description, timestamp);
    const all = await request(app).get('/api/events').expect(200);
    expect(all.body.data.map((e: { description: string }) => e.description)).toEqual(['first hearths', 'Hastings', 'the last city']);
    const range = await request(app).get('/api/events').query({ startTime: '-100000-01-01T00:00:00Z', endTime: '+100000-01-01T00:00:00Z' }).expect(200);
    expect(range.body.data.map((e: { description: string }) => e.description)).toEqual(['Hastings']);
    const wide = await request(app).get('/api/events').query({ startTime: '-500000-01-01T00:00:00Z', endTime: '+400000-01-01T00:00:00Z' }).expect(200);
    expect(wide.body.data).toHaveLength(3);
  });

  it('refuses a moment past the bound, and says so', async () => {
    const response = await request(app).post('/api/events').send({ description: 'x', actor: 'A', target: 'B', timestamp: '+900000000-01-01T00:00:00Z' });
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toMatch(/beyond the range|valid date|not a date/);
  });

  it('puts an arc across a million years with its exact ends', async () => {
    const response = await request(app)
      .post('/api/arcs')
      .send({ name: 'Ages', start_time: '-499999-01-01T00:00:00Z', end_time: '+300000-12-31T23:59:59.999Z', level: 0 })
      .expect(201);
    expect(response.body.data.start_time).toBe('-499999-01-01T00:00:00.000Z');
    expect(response.body.data.end_time_ms).toBe(String(toAxisTime('+300000-12-31T23:59:59.999Z')));
    const found = await request(app).get('/api/arcs').query({ startTime: '+299999-01-01T00:00:00Z', endTime: '+300001-01-01T00:00:00Z' }).expect(200);
    expect(found.body.data.map((a: { id: string }) => a.id)).toContain(response.body.data.id);
    const elsewhere = await request(app).get('/api/arcs').query({ startTime: '+400000-01-01T00:00:00Z', endTime: '+500000-01-01T00:00:00Z' }).expect(200);
    expect(elsewhere.body.data.map((a: { id: string }) => a.id)).not.toContain(response.body.data.id);
  });

  it('never lets a bigint reach res.json', async () => {
    const event = await post('the last city', '+300000-01-01T00:00:00Z');
    const response = await request(app).get('/api/events').expect(200);
    const walk = (value: unknown): void => {
      if (typeof value === 'bigint') throw new Error('a bigint reached the wire');
      if (value && typeof value === 'object') Object.values(value).forEach(walk);
    };
    expect(() => walk(response.body)).not.toThrow();
    expect(event.id).toBeTruthy();
  });
});
