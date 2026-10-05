/**
 * Cross-cutting acceptance tests for graph-scoped isolation (design §3, §6,
 * tasks 3-8). Every case drives the REAL local container and the REAL API router
 * through supertest, so graph-context resolution, the graph-scoped repositories
 * and the version-store bridge are all exercised end to end rather than stubbed.
 *
 * The suite is the negative half of the acceptance criterion: isolation is only
 * proven if scoping to A and to B each hide the other's data, a missing context
 * refuses instead of falling back, and a write for graph B versions into B even
 * while graph A is active.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express, { Express } from 'express';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { loadConfig, initializeDatabaseManager } from '@/utils';
import { initializeContainer, cleanupContainer, Container } from '@/container';
import { apiRouter } from '@/api/routes';
import { errorHandler, injectContainer } from '@/api/middleware';

interface EventSummary {
  id: string;
  description: string;
  actor: string;
}

describe('graph-scoped isolation (route level)', () => {
  let app: Express;
  let container: Container;
  let testDataDir: string;

  beforeEach(async () => {
    testDataDir = path.join(
      os.tmpdir(),
      `graph-scoped-isolation-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    process.env.LOCAL_EXECUTION_ENABLED = 'true';
    process.env.LOCAL_DATA_DIR = testDataDir;
    process.env.LOCAL_GRAPH_FILE = 'legacy-unscoped-graph.json';
    process.env.LOCAL_BACKUP_ENABLED = 'false';
    // config.ts rejects anything below 64 MB.
    process.env.LOCAL_MAX_MEMORY_MB = '64';

    await fs.mkdir(testDataDir, { recursive: true });

    const config = loadConfig();
    const dbManager = initializeDatabaseManager(config.database);
    container = initializeContainer(dbManager, config);
    await container.initialize();

    app = express();
    app.use(express.json());
    app.use(injectContainer);
    app.use('/api', apiRouter);
    app.use(errorHandler);
  });

  afterEach(async () => {
    await cleanupContainer();
    try {
      await fs.rm(testDataDir, { recursive: true, force: true });
    } catch {
      // Cleanup is best-effort.
    }
  });

  async function createGraph(name: string): Promise<string> {
    const graph = await container.graphService.createGraph({ name });
    return graph.id;
  }

  /** Create an event through the real route, scoped by the X-Graph-Id header. */
  async function createEventWithHeader(
    graphId: string,
    description: string,
    actor: string
  ): Promise<string> {
    const response = await request(app)
      .post('/api/events')
      .set('X-Graph-Id', graphId)
      .send({
        description,
        actor,
        target: 'target',
        timestamp: '2020-01-01T00:00:00.000Z',
      })
      .expect(201);
    return (response.body.data as EventSummary).id;
  }

  /** Read events through the real route, optionally scoped by a header. */
  async function readEvents(graphId?: string): Promise<EventSummary[]> {
    const pending = request(app).get('/api/events');
    if (graphId !== undefined) {
      pending.set('X-Graph-Id', graphId);
    }
    const response = await pending.expect(200);
    return response.body.data as EventSummary[];
  }

  it('(a) never returns graph B events from a read scoped to graph A, and vice versa', async () => {
    const graphA = await createGraph('Isolation A');
    const graphB = await createGraph('Isolation B');

    const eventAId = await createEventWithHeader(graphA, 'Only in A', 'actor-a');
    const eventBId = await createEventWithHeader(graphB, 'Only in B', 'actor-b');

    const eventsA = await readEvents(graphA);
    const eventsB = await readEvents(graphB);

    expect(eventsA.map((event) => event.id)).toEqual([eventAId]);
    expect(eventsA.map((event) => event.description)).toEqual(['Only in A']);
    expect(eventsB.map((event) => event.id)).toEqual([eventBId]);
    expect(eventsB.map((event) => event.description)).toEqual(['Only in B']);

    // A direct id lookup cannot cross the boundary either; the other graph's id
    // reads as not-found rather than being served from the wrong store.
    await request(app)
      .get(`/api/events/${eventBId}`)
      .set('X-Graph-Id', graphA)
      .expect(404);
    await request(app)
      .get(`/api/events/${eventAId}`)
      .set('X-Graph-Id', graphB)
      .expect(404);
  });

  it('(b) resolves unrouted requests to the active graph and follows when it switches (Req 2.1)', async () => {
    const graphA = await createGraph('Active A');
    const graphB = await createGraph('Active B');

    await createEventWithHeader(graphA, 'A event', 'actor-a');
    await createEventWithHeader(graphB, 'B event', 'actor-b');

    // The first-created graph is active, so a headerless request reads A.
    await container.graphService.setActiveGraph(graphA);
    const whileAActive = await readEvents();
    expect(whileAActive.map((event) => event.description)).toEqual(['A event']);

    // Switching the active pointer changes the DATA an unrouted read returns,
    // not merely the version history.
    await container.graphService.setActiveGraph(graphB);
    const whileBActive = await readEvents();
    expect(whileBActive.map((event) => event.description)).toEqual(['B event']);
  });

  it('(c) refuses a request with no header and no active graph instead of reading global data', async () => {
    // Seed the process-wide legacy store directly, so the test can prove the 404
    // is a refusal to fall back rather than an absence of data.
    await container.eventRepository.create({
      description: 'Global-only event',
      actor: 'global-actor',
      target: 'target',
      timestamp: new Date('2020-01-01T00:00:00.000Z'),
    });
    const globalEvents = await container.eventRepository.findAll();
    expect(globalEvents.map((event) => event.description)).toContain('Global-only event');

    const response = await request(app).get('/api/events').expect(404);

    expect(response.body.error.message).toMatch(/No graph context available/);
    expect(JSON.stringify(response.body)).not.toContain('Global-only event');
  });

  it('(d) versions a write into the request graph, not the active graph', async () => {
    const graphA = await createGraph('Versioning A');
    const graphB = await createGraph('Versioning B');

    // A is the active graph for the whole write...
    await container.graphService.setActiveGraph(graphA);

    // ...but this write is explicitly scoped to B.
    await createEventWithHeader(graphB, 'Belongs to B', 'actor-b');

    const historyA = await container.graphRepository.getVersionHistory(graphA);
    const historyB = await container.graphRepository.getVersionHistory(graphB);

    expect(historyB.total).toBe(1);
    expect(historyA.total).toBe(0);

    // And the version is actually B's event, not A resolving to itself.
    const checkoutB = await container.graphRepository.checkout(graphB);
    expect(Object.values(checkoutB.events).map((event) => event.description)).toEqual([
      'Belongs to B',
    ]);
  });

  it('(e) honours an explicit X-Graph-Id that differs from the active graph for reads', async () => {
    const graphA = await createGraph('Explicit A');
    const graphB = await createGraph('Explicit B');

    await createEventWithHeader(graphA, 'A data', 'actor-a');
    await createEventWithHeader(graphB, 'B data', 'actor-b');

    // A is active, yet the header forces the read into B.
    await container.graphService.setActiveGraph(graphA);

    const scopedToB = await readEvents(graphB);
    expect(scopedToB.map((event) => event.description)).toEqual(['B data']);

    // The unrouted read still sees the active graph, proving the header — not a
    // missing active pointer — is what changed the scope above.
    const activeRead = await readEvents();
    expect(activeRead.map((event) => event.description)).toEqual(['A data']);
  });
});
