/**
 * @vitest-environment node
 */

/**
 * Request-level tests for the graph routes.
 *
 * Unlike the unit-style route tests that mock `@/api/middleware`, these boot the
 * real local container, mount the real API router with `injectContainer`, and
 * authenticate with real API keys. That way the assertions exercise the real
 * auth middleware (401/403), the real route wiring, and the client-facing
 * request paths that the frontend `apiClient` calls.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { formatInWorld, legacyCalendarSet, storedCalendarSet } from '@althistory/calendar';
import request from 'supertest';
import express, { Express } from 'express';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { loadConfig, initializeDatabaseManager } from '@/utils';
import { initializeContainer, cleanupContainer, Container } from '@/container';
import { apiRouter } from '@/api/routes';
import { errorHandler, injectContainer } from '@/api/middleware';
import { IGraph } from '@/models/Graph';
import { ValidationError } from '@/utils/errors';
import type { CopyResult as GraphCopyServiceResult } from '@/services/GraphCopyService';
import { AddressInfo } from 'net';
import { RemoteEngine } from '@/cli/engine/RemoteEngine';
import { ImportService } from '@/services/ImportService';

describe('Graph routes (request-level)', () => {
  let app: Express;
  let container: Container;
  let testDataDir: string;
  let writeKey: string;
  let readKey: string;
  let sourceGraph: IGraph;

  beforeAll(async () => {
    testDataDir = path.join(os.tmpdir(), `graphs-routes-test-${process.pid}-${Date.now()}`);
    process.env.LOCAL_EXECUTION_ENABLED = 'true';
    process.env.LOCAL_DATA_DIR = testDataDir;
    process.env.LOCAL_GRAPH_FILE = 'graphs-routes-graph.json';
    process.env.LOCAL_BACKUP_ENABLED = 'false';
    // config.ts rejects anything below 64 MB
    process.env.LOCAL_MAX_MEMORY_MB = '64';

    await fs.mkdir(testDataDir, { recursive: true });

    const config = loadConfig();
    const dbManager = initializeDatabaseManager(config.database);
    container = initializeContainer(dbManager, config);
    await container.initialize();

    const writeKeyResponse = await container.authService.createApiKey({
      name: 'Graph Routes Write Key',
      permissions: ['read:graphs', 'write:graphs', 'export'],
    });
    writeKey = writeKeyResponse.key;

    const readKeyResponse = await container.authService.createApiKey({
      name: 'Graph Routes Read Key',
      permissions: ['read:graphs'],
    });
    readKey = readKeyResponse.key;

    sourceGraph = await container.graphService.createGraph({ name: 'Route Test Source' });
    await container.graphService.setActiveGraph(sourceGraph.id);

    app = express();
    app.use(express.json());
    app.use(injectContainer);
    app.use('/api', apiRouter);
    app.use(errorHandler);
  });

  afterAll(async () => {
    await cleanupContainer();

    try {
      await fs.rm(testDataDir, { recursive: true, force: true });
    } catch {
      // Cleanup is best-effort.
    }
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('authentication and permissions', () => {
    it('rejects an unauthenticated graph listing with 401', async () => {
      const response = await request(app).get('/api/graphs').expect(401);
      expect(response.body.error.message).toBe('API key is required');
    });

    it('rejects a write with a read-only key with 403', async () => {
      const response = await request(app)
        .post('/api/graphs')
        .set('X-API-Key', readKey)
        .send({ name: 'Not Allowed' })
        .expect(403);
      expect(response.body.error.message).toContain('write:graphs');
    });

    it('allows a read with a read-only key', async () => {
      const response = await request(app)
        .get('/api/graphs')
        .set('X-API-Key', readKey)
        .expect(200);
      expect(Array.isArray(response.body.data)).toBe(true);
    });
  });

  describe('graph scoping for a restricted key', () => {
    let allowed: IGraph;
    let hidden: IGraph;
    let hiddenBranch: IGraph;
    let scopedKey: string;

    beforeAll(async () => {
      allowed = await container.graphService.createGraph({ name: 'Scoped Allowed' });
      hidden = await container.graphService.createGraph({ name: 'Scoped Hidden' });
      // A branch of the allowed graph is a new graph, outside the key's list.
      hiddenBranch = await container.graphService.branchGraph(allowed.id, { name: 'Scoped Hidden Branch' });
      scopedKey = (
        await container.authService.createApiKey({
          name: 'Graph Routes Scoped Key',
          permissions: ['read:graphs', 'write:graphs'],
          allowedGraphs: [allowed.id],
        })
      ).key;
    });

    afterEach(async () => {
      // The other suites expect the source graph to be the active one.
      await container.graphService.setActiveGraph(sourceGraph.id);
    });

    it('lists and counts only the graphs the key may access', async () => {
      const response = await request(app).get('/api/graphs').set('X-API-Key', scopedKey).expect(200);

      const ids = response.body.data.map((graph: IGraph) => graph.id);
      expect(ids).toEqual([allowed.id]);
      expect(response.body.pagination.total).toBe(1);
    });

    it('lists only the branches the key may access', async () => {
      const response = await request(app)
        .get(`/api/graphs/${allowed.id}/branches`)
        .set('X-API-Key', scopedKey)
        .expect(200);

      expect(response.body.data.map((graph: IGraph) => graph.id)).not.toContain(hiddenBranch.id);
    });

    it('refuses the active graph when the key may not access it, without naming it', async () => {
      await container.graphService.setActiveGraph(hidden.id);

      const response = await request(app).get('/api/graphs/active').set('X-API-Key', scopedKey).expect(403);

      expect(JSON.stringify(response.body)).not.toContain(hidden.id);
    });

    it('refuses to copy the active graph when the key may not access it', async () => {
      await container.graphService.setActiveGraph(hidden.id);
      const copySpy = vi.spyOn(container.graphCopyService, 'copyFullGraph');

      const response = await request(app)
        .post('/api/graphs/copy')
        .set('X-API-Key', scopedKey)
        .send({ targetName: 'Copy Of Something Hidden' })
        .expect(403);

      expect(JSON.stringify(response.body)).not.toContain(hidden.id);
      expect(copySpy).not.toHaveBeenCalled();
    });
  });

  describe('world calendar', () => {
    const calendar = { epochYear: 1000, eraLabel: 'AR', name: 'the Reckoning' };

    it('creates a graph with a calendar and reads it back', async () => {
      const created = await request(app)
        .post('/api/graphs')
        .set('X-API-Key', writeKey)
        .send({ name: 'Vael', calendar })
        .expect(201);
      expect(created.body.data.calendar).toEqual(legacyCalendarSet(calendar));

      const read = await request(app).get(`/api/graphs/${created.body.data.id}`).set('X-API-Key', readKey).expect(200);
      expect(read.body.data.calendar).toEqual(legacyCalendarSet(calendar));
    });

    it('keeps a world of its own shape: festival days outside its months, a leap cycle and a day of twenty hours', async () => {
      const vael = {
        version: 2,
        dayLength: 30 * 3600,
        primary: 'reckoning',
        calendars: [
          {
            id: 'reckoning',
            name: 'the Reckoning of the Rising',
            parts: [
              ...['Lowtide', 'Greywater', 'Thaw', 'Seedtide', 'Brightwater', 'Highsun'].map((name) => ({ name, days: 30 })),
              { name: "Midyear's Day", days: 1, intercalary: true },
              ...['Saltreap', 'Panfire', 'Gale', 'Ebb', 'Wrack', 'Longnight'].map((name) => ({ name, days: 30 })),
              { name: 'The Drowned Days', days: 4, intercalary: true },
            ],
            leapRules: [{ every: 6, part: 13, days: 1 }],
            epoch: 0,
            eras: [{ label: 'AR', from: 1 }],
            time: { hoursPerDay: 20, minutesPerHour: 100, secondsPerMinute: 100 },
          },
        ],
      };
      const key = (
        await container.authService.createApiKey({
          name: 'World writer',
          permissions: ['read:graphs', 'write:graphs', 'read:events', 'write:events', 'read:arcs', 'write:arcs'],
        })
      ).key;
      const created = await request(app).post('/api/graphs').set('X-API-Key', key).send({ name: 'Vael', calendar: vael }).expect(201);
      const graphId = created.body.data.id;
      expect(created.body.data.calendar.calendars[0].parts).toHaveLength(14);

      const set = storedCalendarSet(created.body.data.calendar)!;
      const shown = (timestamp: string, precision: 'day' | 'month' | 'year' = 'day') => formatInWorld(set, Date.parse(timestamp), precision);
      const post = (path: string, body: Record<string, unknown>, status = 201) =>
        request(app).post(path).set('X-API-Key', key).set('X-Graph-Id', graphId).send(body).expect(status);

      // Text in the world's notation, and fields: the same day both ways.
      const byText = await post('/api/events', { description: 'The Tide War', actor: 'Tide-folk', target: 'Salt-kings', timestamp: 'Greywater 4, 312 AR, 13:50' });
      expect(shown(byText.body.data.timestamp)).toBe('Greywater 4, 312 AR, 13:50');
      const byFields = await post('/api/events', {
        description: 'The truce',
        actor: 'Salt-kings',
        target: 'Tide-folk',
        timestamp: { era: 'AR', year: 312, month: 'Greywater', day: 4 },
      });
      expect(shown(byFields.body.data.timestamp)).toBe('Greywater 4, 312 AR');

      // A festival, and a month alone, which records its precision.
      const festival = await post('/api/events', { description: 'Midyear', actor: 'All', target: 'All', timestamp: "Midyear's Day, 312 AR" });
      expect(shown(festival.body.data.timestamp)).toBe("Midyear's Day, 312 AR");
      const month = await post('/api/events', { description: 'Some time in Thaw', actor: 'A', target: 'B', timestamp: 'Thaw 312 AR' });
      expect(month.body.data.metadata.datePrecision).toBe('month');
      expect(shown(month.body.data.timestamp, 'month')).toBe('Thaw 312 AR');

      // A day the month does not have, and the leap day of a year without one, are refused.
      const refused = await post('/api/events', { description: 'x', actor: 'A', target: 'B', timestamp: 'Greywater 31, 312 AR' }, 400);
      expect(refused.body.error.message).toContain('Greywater has 30 days');
      await post('/api/events', { description: 'x', actor: 'A', target: 'B', timestamp: 'The Drowned Days 5, 313 AR' }, 400);
      await post('/api/events', { description: 'Leap', actor: 'A', target: 'B', timestamp: 'The Drowned Days 5, 312 AR' });

      // An arc ending in a month ends at that month's last moment.
      const arc = await post('/api/arcs', { name: 'The war years', start_time: 'Lowtide 312 AR', end_time: 'Longnight 312 AR', level: 0 });
      expect(shown(arc.body.data.start_time)).toBe('Lowtide 1, 312 AR');
      expect(shown(arc.body.data.end_time)).toBe('Longnight 30, 312 AR, 19:99');

      // Text that is neither ISO 8601 nor the world's notation is refused, not
      // read as a Gregorian date in the server's zone.
      for (const text of ['Year 312', '312', 'Mar 4, 312']) {
        await post('/api/events', { description: 'x', actor: 'A', target: 'B', timestamp: text }, 400);
        await post('/api/arcs', { name: 'x', start_time: text, end_time: 'Longnight 312 AR', level: 0 }, 400);
      }

      // A new date replaces the old one's precision.
      const put = (id: string, body: Record<string, unknown>) =>
        request(app).put(`/api/events/${id}`).set('X-API-Key', key).set('X-Graph-Id', graphId).send(body).expect(200);
      const toDay = await put(month.body.data.id, { timestamp: 'Thaw 4, 312 AR' });
      expect(toDay.body.data.metadata.datePrecision).toBeUndefined();
      const toYear = await put(month.body.data.id, { timestamp: '313 AR' });
      expect(toYear.body.data.metadata.datePrecision).toBe('year');
      const toIso = await put(month.body.data.id, { timestamp: '2400-01-01T00:00:00Z' });
      expect(toIso.body.data.metadata.datePrecision).toBeUndefined();
      // Unless the request says what it is (the app sends ISO with the precision it read).
      const stated = await put(month.body.data.id, { timestamp: '2400-01-01T00:00:00Z', metadata: { datePrecision: 'month' } });
      expect(stated.body.data.metadata.datePrecision).toBe('month');

      // A batch reads its dates the same way.
      const batch = await request(app)
        .post('/api/batch/events')
        .set('X-API-Key', key)
        .set('X-Graph-Id', graphId)
        .send({ graphId, events: [{ description: 'Batched', actor: 'A', target: 'B', timestamp: 'Thaw 312 AR' }] });
      expect(batch.status).toBeLessThan(300);
      const batched = await request(app).get(`/api/events/${batch.body.data?.created?.[0] ?? batch.body.created?.[0]}`).set('X-API-Key', key).set('X-Graph-Id', graphId).expect(200);
      expect(shown(batched.body.data.timestamp, 'month')).toBe('Thaw 312 AR');
      expect(batched.body.data.metadata.datePrecision).toBe('month');

      // A remote CLI with a key for events but not the graph sends world text
      // as written, and the server reads it with the graph's calendars.
      const eventsOnly = (
        await container.authService.createApiKey({ name: 'Events only', permissions: ['read:events', 'write:events', 'read:arcs', 'write:arcs'] })
      ).key;
      const server = app.listen(0);
      try {
        const { port } = server.address() as AddressInfo;
        const remote = new RemoteEngine(`http://127.0.0.1:${port}`, eventsOnly);
        const day = await remote.createEvent(graphId, { description: 'Remote', actor: 'A', target: 'B', timestamp: 'Thaw 4, 312 AR' });
        expect(shown(day.timestamp)).toBe('Thaw 4, 312 AR');
        const inMonth = await remote.createEvent(graphId, { description: 'Remote month', actor: 'A', target: 'B', timestamp: 'Thaw 312 AR' });
        expect(inMonth.metadata?.datePrecision).toBe('month');
        const remoteArc = await remote.createArc(graphId, { name: 'Remote arc', startTime: 'Thaw 312 AR', endTime: 'Thaw 312 AR' });
        expect(shown(remoteArc.endTime)).toBe('Thaw 30, 312 AR, 19:99');
        await expect(remote.createEvent(graphId, { description: 'x', actor: 'A', target: 'B', timestamp: 'Year 312' })).rejects.toThrow(/not a date/);
      } finally {
        server.close();
      }
    });

    it('refuses a calendar that does not check out, saying why', async () => {
      const response = await request(app)
        .post('/api/graphs')
        .set('X-API-Key', writeKey)
        .send({ name: 'Bad Calendar', calendar: { epochYear: 'soon' } })
        .expect(400);
      expect(response.body.error.message).toContain('epochYear');
    });

    it('changes the calendar with PUT, keeps it when it is not mentioned, and removes it with null', async () => {
      const graph = await container.graphService.createGraph({ name: 'Calendar Later' });

      const set = await request(app)
        .put(`/api/graphs/${graph.id}`)
        .set('X-API-Key', writeKey)
        .send({ calendar: { epochYear: 1200 } })
        .expect(200);
      expect(set.body.data.calendar).toEqual(legacyCalendarSet({ epochYear: 1200 }));

      const renamed = await request(app)
        .put(`/api/graphs/${graph.id}`)
        .set('X-API-Key', writeKey)
        .send({ name: 'Calendar Kept' })
        .expect(200);
      expect(renamed.body.data.calendar).toEqual(legacyCalendarSet({ epochYear: 1200 }));

      const cleared = await request(app)
        .put(`/api/graphs/${graph.id}`)
        .set('X-API-Key', writeKey)
        .send({ calendar: null })
        .expect(200);
      expect(cleared.body.data.calendar).toBeUndefined();
    });

    it('carries the calendar to a branch and to a copy, which are the same world', async () => {
      const world = await container.graphService.createGraph({ name: 'World To Fork', calendar });
      const branch = await container.graphService.branchGraph(world.id, { name: 'World Branch' });
      expect(branch.calendar).toEqual(legacyCalendarSet(calendar));

      const copy = await request(app)
        .post('/api/graphs/copy')
        .set('X-API-Key', writeKey)
        .send({ sourceGraphId: world.id, targetName: 'World Copy' })
        .expect(201);
      const copied = await container.graphService.getGraph(copy.body.data.id);
      expect(copied.calendar).toEqual(legacyCalendarSet(calendar));
    });

    it('lets the remote CLI engine create a world, change its calendar, and nest an arc one level down', async () => {
      const authorKey = (
        await container.authService.createApiKey({
          name: 'Graph Routes Author Key',
          permissions: [
            'read:graphs',
            'write:graphs',
            'read:arcs',
            'write:arcs',
            'read:events',
            'write:events',
            'read:relationships',
            'write:relationships',
          ],
        })
      ).key;
      const server = app.listen(0);
      try {
        const { port } = server.address() as AddressInfo;
        const engine = new RemoteEngine(`http://127.0.0.1:${port}`, authorKey);

        const made = await engine.createGraph('Remote World', undefined, calendar);
        expect(made.calendar).toEqual(legacyCalendarSet(calendar));
        const changed = await engine.setGraphCalendar(made.id, { epochYear: 1200 });
        expect(changed.calendar).toEqual(legacyCalendarSet({ epochYear: 1200 }));
        const cleared = await engine.setGraphCalendar(made.id, null);
        expect(cleared.calendar).toBeUndefined();

        const age = await engine.createArc(made.id, {
          name: 'Age',
          startTime: '1000-01-01T00:00:00Z',
          endTime: '1200-01-01T00:00:00Z',
        });
        const reign = await engine.createArc(made.id, {
          name: 'Reign',
          startTime: '1100-01-01T00:00:00Z',
          endTime: '1150-01-01T00:00:00Z',
          parentArcId: age.id,
        });
        const decade = await engine.createArc(made.id, {
          name: 'Decade',
          startTime: '1100-01-01T00:00:00Z',
          endTime: '1110-01-01T00:00:00Z',
          parentArcId: reign.id,
        });
        expect((await engine.getArc(made.id, decade.id)).level).toBe(2);

        // A link with no reasoning is accepted, as in direct mode: the API
        // requires evidence, so the engine supplies the same default.
        const cause = await engine.createEvent(made.id, { description: 'Cause', timestamp: '1001-01-01T00:00:00Z' });
        const effect = await engine.createEvent(made.id, { description: 'Effect', timestamp: '1002-01-01T00:00:00Z' });
        const link = await engine.createCausalLink(made.id, { causeId: cause.id, effectId: effect.id });
        expect(link.reasoning).toBe('Observed historical causality');
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    });

    it('keeps every graph in the index when two repositories over the same store create at once', async () => {
      const { GraphRepository } = await import('@/repositories/GraphRepository');
      const dataDir = path.join(testDataDir, 'two-repositories');
      const first = new GraphRepository({ dataDir });
      const second = new GraphRepository({ dataDir });
      await first.initialize();
      await second.initialize();
      const made = await Promise.all(
        Array.from({ length: 10 }, (_, n) => (n % 2 ? first : second).create({ name: `Concurrent ${n}` }))
      );
      const listed = new Set((await first.findAll({ limit: 100, offset: 0 })).graphs.map((graph) => graph.id));
      for (const graph of made) expect(listed.has(graph.id)).toBe(true);
    });

    it('exports a nested arc with its parent, so the export imports again', async () => {
      const world = await container.graphService.createGraph({ name: 'Nested World', calendar });
      const scoped = await container.graphScopedRepositories(world.id);
      const age = await scoped.arcRepository.create({
        name: 'Age',
        description: '',
        start_time: new Date('1000-01-01T00:00:00Z'),
        end_time: new Date('1200-01-01T00:00:00Z'),
        level: 0,
        metadata: {},
      });
      await container.graphWriteVersioningService.recordArc(world.id, age, 'create');
      // How the CLI, MCP and the generator record a parent: in the metadata.
      const reignArc = await scoped.arcRepository.create({
        name: 'Reign',
        description: '',
        start_time: new Date('1100-01-01T00:00:00Z'),
        end_time: new Date('1150-01-01T00:00:00Z'),
        level: 1,
        metadata: { parentArcId: age.id },
      });
      await container.graphWriteVersioningService.recordArc(world.id, reignArc, 'create');

      const exported = await request(app)
        .get('/api/export')
        .set('X-API-Key', writeKey)
        .set('X-Graph-Id', world.id)
        .expect(200);
      const reign = exported.body.data.arcs.find((arc: { name: string }) => arc.name === 'Reign');
      expect(reign.parent_arc_id).toBe(age.id);

      const importService = new ImportService({ dataDir: testDataDir });
      await importService.initialize();
      const check = await importService.validateFormat(exported.body);
      expect(check.errors.filter((error) => error.code === 'ARC_HIERARCHY_VIOLATION')).toEqual([]);
    });

    it('restores the calendar when an export is imported as a new graph, and drops one that does not check out', async () => {
      const world = await container.graphService.createGraph({ name: 'Imported World', calendar });
      const exported = await request(app)
        .get('/api/export')
        .set('X-API-Key', writeKey)
        .set('X-Graph-Id', world.id)
        .expect(200);

      const importService = new ImportService({ dataDir: testDataDir });
      await importService.initialize();
      const restored = await importService.executeImport(exported.body, { mode: 'create-new', conflictResolution: 'skip' });
      expect(restored.success).toBe(true);
      expect((await container.graphService.getGraph(restored.graphId)).calendar).toEqual(legacyCalendarSet(calendar));

      const tampered = { ...exported.body, metadata: { ...exported.body.metadata, calendar: { epochYear: 'soon' } } };
      const dropped = await importService.executeImport(tampered, { mode: 'create-new', conflictResolution: 'skip' });
      expect(dropped.success).toBe(true);
      expect((await container.graphService.getGraph(dropped.graphId)).calendar).toBeUndefined();
    });

    it('puts the calendar in the export metadata, outside the checksum', async () => {
      const world = await container.graphService.createGraph({ name: 'World To Export', calendar });
      const response = await request(app)
        .get('/api/export')
        .set('X-API-Key', writeKey)
        .set('X-Graph-Id', world.id)
        .expect(200);
      expect(response.body.metadata.calendar).toEqual(legacyCalendarSet(calendar));
      expect(response.body.data.calendar).toBeUndefined();
    });
  });

  describe('copy (frontend apiClient.graph.copy*)', () => {
    it('POST /api/graphs/copy creates a copy and returns a completed copy result', async () => {
      const copyResult: GraphCopyServiceResult = {
        sourceGraphId: sourceGraph.id,
        targetGraphId: 'resolved-by-route',
        copiedNodes: 2,
        copiedRelationships: 1,
        duration: 3,
        success: true,
        errors: [],
      };
      const copySpy = vi
        .spyOn(container.graphCopyService, 'copyFullGraph')
        .mockResolvedValue(copyResult);

      const response = await request(app)
        .post('/api/graphs/copy')
        .set('X-API-Key', writeKey)
        .send({ targetName: 'Route Test Copy', copyType: 'full' })
        .expect(201);

      const targetId = response.body.data.id;
      expect(response.body.data.status).toBe('completed');
      expect(response.body.data.progress).toBe(100);
      expect(copySpy).toHaveBeenCalledWith(sourceGraph.id, targetId);
      // The target graph really exists, so GET /graphs/copy/:id can resolve it.
      const target = await container.graphService.getGraph(targetId);
      expect(target.name).toBe('Route Test Copy');
    });

    it('POST /api/graphs/copy routes a time_range copy to copyByTimeRange', async () => {
      const copyResult: GraphCopyServiceResult = {
        sourceGraphId: sourceGraph.id,
        targetGraphId: 'resolved-by-route',
        copiedNodes: 1,
        copiedRelationships: 0,
        duration: 1,
        success: true,
        errors: [],
      };
      const rangeSpy = vi
        .spyOn(container.graphCopyService, 'copyByTimeRange')
        .mockResolvedValue(copyResult);

      const response = await request(app)
        .post('/api/graphs/copy')
        .set('X-API-Key', writeKey)
        .send({
          targetName: 'Route Test Time Range Copy',
          copyType: 'time_range',
          timeRange: { start: '1914-01-01T00:00:00.000Z', end: '1919-01-01T00:00:00.000Z' },
        })
        .expect(201);

      expect(rangeSpy).toHaveBeenCalledWith(
        sourceGraph.id,
        {
          start: new Date('1914-01-01T00:00:00.000Z'),
          end: new Date('1919-01-01T00:00:00.000Z'),
        },
        response.body.data.id
      );
    });

    it('POST /api/graphs/copy routes a filtered copy to copyByEntityFilter', async () => {
      const copyResult: GraphCopyServiceResult = {
        sourceGraphId: sourceGraph.id,
        targetGraphId: 'resolved-by-route',
        copiedNodes: 1,
        copiedRelationships: 0,
        duration: 1,
        success: true,
        errors: [],
      };
      const filterSpy = vi
        .spyOn(container.graphCopyService, 'copyByEntityFilter')
        .mockResolvedValue(copyResult);

      const response = await request(app)
        .post('/api/graphs/copy')
        .set('X-API-Key', writeKey)
        .send({
          targetName: 'Route Test Filtered Copy',
          copyType: 'filtered',
          filter: { actors: ['Actor A'], targets: ['Target B'], eventTypes: ['battle'] },
        })
        .expect(201);

      expect(filterSpy).toHaveBeenCalledWith(
        sourceGraph.id,
        { actors: ['Actor A'], targets: ['Target B'], eventTypes: ['battle'] },
        response.body.data.id
      );
    });

    it('POST /api/graphs/copy rejects a copy without a target name', async () => {
      await request(app)
        .post('/api/graphs/copy')
        .set('X-API-Key', writeKey)
        .send({ copyType: 'full' })
        .expect(400);
    });

    it('GET /api/graphs/copy/:copyId reports the copy as completed', async () => {
      const target = await container.graphService.createGraph({ name: 'Route Test Copy Status' });

      const response = await request(app)
        .get(`/api/graphs/copy/${target.id}`)
        .set('X-API-Key', readKey)
        .expect(200);

      expect(response.body.data).toMatchObject({
        id: target.id,
        name: 'Route Test Copy Status',
        status: 'completed',
        progress: 100,
      });
    });
  });

  describe('branches (frontend apiClient.graphs.getBranches)', () => {
    it('GET /api/graphs/:id/branches lists graphs branched from the source', async () => {
      const branch = await container.graphService.branchGraph(sourceGraph.id, {
        name: 'Route Test Branch',
      });

      const response = await request(app)
        .get(`/api/graphs/${sourceGraph.id}/branches`)
        .set('X-API-Key', readKey)
        .expect(200);

      const branchIds = response.body.data.map((graph: IGraph) => graph.id);
      expect(branchIds).toContain(branch.id);
    });

    it('GET /api/graphs/:id/branches returns 404 for an unknown graph', async () => {
      await request(app)
        .get('/api/graphs/does-not-exist/branches')
        .set('X-API-Key', readKey)
        .expect(404);
    });
  });

  describe('rollback (frontend apiClient.graphs.rollback)', () => {
    it('POST /api/graphs/:id/rollback/:version returns the rolled-back graph', async () => {
      const versionRef = await container.graphService.commitChanges(
        sourceGraph.id,
        { added: [], modified: [], deleted: [] },
        'import',
        'test version for rollback'
      );

      const response = await request(app)
        .post(`/api/graphs/${sourceGraph.id}/rollback/${versionRef.version}`)
        .set('X-API-Key', writeKey)
        .expect(200);

      expect(response.body.data.id).toBe(sourceGraph.id);
      expect(response.body.data.name).toBe('Route Test Source');
    });
  });

  describe('activate (frontend apiClient.graphs.switch)', () => {
    it('POST /api/graphs/:id/activate makes the graph active', async () => {
      const target = await container.graphService.createGraph({ name: 'Route Test Activate' });

      await request(app)
        .post(`/api/graphs/${target.id}/activate`)
        .set('X-API-Key', writeKey)
        .expect(200);

      const active = await container.graphService.getActiveGraph();
      expect(active?.id).toBe(target.id);
    });
  });

  describe('export authentication', () => {
    it('rejects an unauthenticated export request with 401', async () => {
      await request(app).get('/api/export/stats').expect(401);
    });

    it('rejects a key without the export permission with 403', async () => {
      const response = await request(app)
        .get('/api/export/stats')
        .set('X-API-Key', readKey)
        .expect(403);
      expect(response.body.error.message).toContain('export');
    });

    it('allows an export request with the export permission', async () => {
      const response = await request(app)
        .get('/api/export/stats')
        .set('X-API-Key', writeKey)
        .expect(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('export graph scoping (X-Graph-Id)', () => {
    it('uses the header as the scope for a sync export with no body graphId', async () => {
      const response = await request(app)
        .post('/api/export/sync')
        .set('X-API-Key', writeKey)
        .set('X-Graph-Id', sourceGraph.id)
        .send({ scope: 'full' })
        .expect(200);
      expect(response.body.success).toBe(true);
    });

    it('uses the header as the scope for an export job with no body graphId', async () => {
      const response = await request(app)
        .post('/api/export/jobs')
        .set('X-API-Key', writeKey)
        .set('X-Graph-Id', sourceGraph.id)
        .send({ scope: 'full' })
        .expect(202);
      expect(response.body.success).toBe(true);
    });

    it('accepts a body graphId that agrees with the header', async () => {
      const response = await request(app)
        .post('/api/export/sync')
        .set('X-API-Key', writeKey)
        .set('X-Graph-Id', sourceGraph.id)
        .send({ graphId: sourceGraph.id, scope: 'full' })
        .expect(200);
      expect(response.body.success).toBe(true);
    });

    it('rejects a sync export whose body graphId contradicts the header', async () => {
      const other = await container.graphService.createGraph({ name: 'Route Test Contradiction Sync' });
      const response = await request(app)
        .post('/api/export/sync')
        .set('X-API-Key', writeKey)
        .set('X-Graph-Id', sourceGraph.id)
        .send({ graphId: other.id, scope: 'full' })
        .expect(400);
      expect(response.body.error.message).toContain('contradicts');
    });

    it('rejects an export job whose body graphId contradicts the header', async () => {
      const other = await container.graphService.createGraph({ name: 'Route Test Contradiction Job' });
      const response = await request(app)
        .post('/api/export/jobs')
        .set('X-API-Key', writeKey)
        .set('X-Graph-Id', sourceGraph.id)
        .send({ graphId: other.id, scope: 'full' })
        .expect(400);
      expect(response.body.error.message).toContain('contradicts');
    });
  });

  describe('merge validation (frontend apiClient.graphs.merge)', () => {
    it.each([null, '', 'garbage'])(
      'POST /api/graphs/:id/merge rejects %j as a manual resolution value',
      async (invalidValue) => {
        // The route owns a value check as well as the service. Mocking the
        // service to succeed means a route that omitted its own check would
        // answer 200 here, so this asserts the route rejects before delegating
        // rather than merely observing that the service also rejects.
        const mergeSpy = vi
          .spyOn(container.graphService, 'mergeGraph')
          .mockResolvedValue({ success: true, newVersion: 1 });

        const response = await request(app)
          .post(`/api/graphs/${sourceGraph.id}/merge`)
          .set('X-API-Key', writeKey)
          .send({
            sourceGraphId: sourceGraph.id,
            conflictResolution: 'manual',
            manualResolutions: { 'event:any': invalidValue },
          })
          .expect(400);

        expect(response.body.error.message).toContain('keep-source');
        expect(mergeSpy).not.toHaveBeenCalled();
      }
    );

    it('refuses a merge whose source graph the key may not access', async () => {
      const otherGraph = await container.graphService.createGraph({ name: 'Merge Source Elsewhere' });
      const scoped = await container.authService.createApiKey({
        name: 'Graph Routes Scoped Write Key',
        permissions: ['read:graphs', 'write:graphs'],
        allowedGraphs: [sourceGraph.id],
      });
      const mergeSpy = vi.spyOn(container.graphService, 'mergeGraph');

      const response = await request(app)
        .post(`/api/graphs/${sourceGraph.id}/merge`)
        .set('X-API-Key', scoped.key)
        .send({ sourceGraphId: otherGraph.id, conflictResolution: 'keep-source', dryRun: true })
        .expect(403);

      expect(response.body.error.message).toContain(otherGraph.id);
      expect(mergeSpy).not.toHaveBeenCalled();
    });

    it('accepts a harmonized compromise payload and passes it to the service', async () => {
      const mergeSpy = vi
        .spyOn(container.graphService, 'mergeGraph')
        .mockResolvedValue({ success: true, newVersion: 1 });

      const mergedValue = {
        description: 'Blended',
        actor: 'Actor 1',
        target: 'Target 1',
        timestamp: '2024-01-01T00:00:00Z',
      };

      const response = await request(app)
        .post(`/api/graphs/${sourceGraph.id}/merge`)
        .set('X-API-Key', writeKey)
        .send({
          sourceGraphId: sourceGraph.id,
          conflictResolution: 'manual',
          manualResolutions: {
            'event:event-1': { strategy: 'merged', value: mergedValue },
          },
        })
        .expect(200);

      expect(mergeSpy).toHaveBeenCalledWith(
        sourceGraph.id,
        expect.objectContaining({
          conflictResolution: 'manual',
          manualResolutions: {
            'event:event-1': { strategy: 'merged', value: mergedValue },
          },
        })
      );
      expect(response.body.success).toBe(true);
    });

    it.each([
      ['a payload that is not an object', { strategy: 'merged', value: 'everything' }],
      ['a payload that is an array', { strategy: 'merged', value: ['a'] }],
      ['a payload that is null', { strategy: 'merged', value: null }],
      ['an unknown strategy', { strategy: 'blend', value: { description: 'x' } }],
    ])('rejects %s as a harmonized compromise', async (_label, invalidValue) => {
      const mergeSpy = vi
        .spyOn(container.graphService, 'mergeGraph')
        .mockResolvedValue({ success: true, newVersion: 1 });

      const response = await request(app)
        .post(`/api/graphs/${sourceGraph.id}/merge`)
        .set('X-API-Key', writeKey)
        .send({
          sourceGraphId: sourceGraph.id,
          conflictResolution: 'manual',
          manualResolutions: { 'event:any': invalidValue },
        })
        .expect(400);

      expect(response.body.error.message).toContain('manualResolutions');
      expect(mergeSpy).not.toHaveBeenCalled();
    });

    it('returns the anomalies of a refused dry run', async () => {
      // A dry run that finds a causal cycle is refused with 409 and the
      // anomalies, so the caller can see what is wrong before writing.
      vi.spyOn(container.graphService, 'mergeGraph').mockResolvedValue({
        success: false,
        dryRun: true,
        conflicts: [],
        anomalies: [
          {
            type: 'causal_cycle',
            message: 'Causal cycle detected: e1 -> e2 -> e1',
            details: { cycle: ['e1', 'e2', 'e1'] },
          },
        ],
      });

      const response = await request(app)
        .post(`/api/graphs/${sourceGraph.id}/merge`)
        .set('X-API-Key', writeKey)
        .send({ sourceGraphId: sourceGraph.id, conflictResolution: 'keep-target', dryRun: true })
        .expect(409);

      expect(response.body.success).toBe(false);
      expect(response.body.anomalies).toHaveLength(1);
      expect(response.body.anomalies[0].type).toBe('causal_cycle');
      expect(response.body.anomalies[0].message).toContain('Causal cycle');
    });

    it('returns the anomalies of a clean dry run', async () => {
      vi.spyOn(container.graphService, 'mergeGraph').mockResolvedValue({
        success: true,
        dryRun: true,
        conflicts: [],
        anomalies: [],
      });

      const response = await request(app)
        .post(`/api/graphs/${sourceGraph.id}/merge`)
        .set('X-API-Key', writeKey)
        .send({ sourceGraphId: sourceGraph.id, conflictResolution: 'keep-target', dryRun: true })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.anomalies).toEqual([]);
      expect(response.body.dryRun).toBe(true);
    });

    it('reports a payload the service refuses as a 400', async () => {
      // The service refuses a payload that would corrupt the entity; the
      // route has to surface that as a client error rather than a 500.
      vi.spyOn(container.graphService, 'mergeGraph').mockRejectedValue(
        new ValidationError(
          "The merge was refused: The merged event 'event1' is not usable: timestamp must stay a string",
          'manualResolutions'
        )
      );

      const response = await request(app)
        .post(`/api/graphs/${sourceGraph.id}/merge`)
        .set('X-API-Key', writeKey)
        .send({
          sourceGraphId: sourceGraph.id,
          conflictResolution: 'manual',
          manualResolutions: {
            'event:event-1': { strategy: 'merged', value: { timestamp: 1 } },
          },
        })
        .expect(400);

      expect(response.body.error.message).toContain('must stay a string');
    });
  });
});
