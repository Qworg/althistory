/**
 * Request-level acceptance test for the live-store -> version-store bridge.
 *
 * The defect this guards against: a graph built through the normal API had an
 * empty version history and an empty export, because entity writes only reached
 * the live store while ExportService read exclusively from the version store.
 *
 * These tests boot the real local container, mount the real API router and drive
 * events/arcs/causal links through their routes, then assert the write is visible
 * in (a) the active graph's version history, (b) its checkout, and (c) an export.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express, { Express } from 'express';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { loadConfig, initializeDatabaseManager } from '@/utils';
import { initializeContainer, cleanupContainer, Container } from '@/container';
import { apiRouter } from '@/api/routes';
import { errorHandler, injectContainer } from '@/api/middleware';

describe('Versioned entity writes (route level)', () => {
  let app: Express;
  let container: Container;
  let testDataDir: string;

  beforeAll(async () => {
    testDataDir = path.join(os.tmpdir(), `versioned-writes-test-${process.pid}-${Date.now()}`);
    process.env.LOCAL_EXECUTION_ENABLED = 'true';
    process.env.LOCAL_DATA_DIR = testDataDir;
    process.env.LOCAL_GRAPH_FILE = 'versioned-writes-graph.json';
    process.env.LOCAL_BACKUP_ENABLED = 'false';
    // config.ts rejects anything below 64 MB
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

  afterAll(async () => {
    await cleanupContainer();
    try {
      await fs.rm(testDataDir, { recursive: true, force: true });
    } catch {
      // Cleanup is best-effort.
    }
  });

  it('commits created events, arcs and causal relationships to the active graph and its export', async () => {
    const graph = await container.graphService.createGraph({ name: 'Versioned Writes' });
    await container.graphService.setActiveGraph(graph.id);

    const initialHistory = await container.graphRepository.getVersionHistory(graph.id);
    expect(initialHistory.total).toBe(0);

    const eventAResponse = await request(app)
      .post('/api/events')
      .send({
        description: 'Cause event',
        actor: 'Actor A',
        target: 'Target A',
        timestamp: '2020-01-01T00:00:00.000Z',
      })
      .expect(201);
    const eventAId = eventAResponse.body.data.id;

    const eventBResponse = await request(app)
      .post('/api/events')
      .send({
        description: 'Effect event',
        actor: 'Actor B',
        target: 'Target B',
        timestamp: '2021-01-01T00:00:00.000Z',
      })
      .expect(201);
    const eventBId = eventBResponse.body.data.id;

    const arcResponse = await request(app)
      .post('/api/arcs')
      .send({
        name: 'Versioned Arc',
        description: 'An arc created through the API',
        start_time: '2019-01-01T00:00:00.000Z',
        end_time: '2022-01-01T00:00:00.000Z',
        level: 0,
      })
      .expect(201);
    const arcId = arcResponse.body.data.id;

    await request(app)
      .post('/api/causal/link')
      .send({
        causeEventId: eventAId,
        effectEventId: eventBId,
        relationship: {
          type: 'direct',
          strength: 0.8,
          confidence: 0.9,
          evidence: 'Observed sequence',
        },
      })
      .expect(201);

    // (a) A version now exists for the active graph.
    const history = await container.graphRepository.getVersionHistory(graph.id);
    expect(history.total).toBe(4);
    expect(history.versions.map(v => v.operation)).toEqual(
      expect.arrayContaining(['create'])
    );

    // (b) Checkout contains every entity.
    const data = await container.graphRepository.checkout(graph.id);
    expect(data.events[eventAId]).toBeDefined();
    expect(data.events[eventBId]).toBeDefined();
    expect(data.arcs[arcId]).toBeDefined();
    const relationship = Object.values(data.relationships).find(
      rel => rel.cause_event_id === eventAId && rel.effect_event_id === eventBId
    );
    expect(relationship).toBeDefined();
    expect(relationship?.relationship_type).toBe('direct');

    // (c) ExportService, which reads only the version store, includes them.
    const exportResult = await container.exportService.exportGraph({
      graphId: graph.id,
      scope: 'full',
      includeProvenance: false,
    });
    expect(exportResult.export.data.events.map(event => event.id)).toEqual(
      expect.arrayContaining([eventAId, eventBId])
    );
    expect(exportResult.export.data.arcs.map(arc => arc.id)).toContain(arcId);
    expect(
      exportResult.export.data.causalRelationships.some(
        rel => rel.cause_event_id === eventAId && rel.effect_event_id === eventBId
      )
    ).toBe(true);
  });

  it('commits updates and deletes to the active graph', async () => {
    const graph = await container.graphService.createGraph({ name: 'Versioned Update Delete' });
    await container.graphService.setActiveGraph(graph.id);

    const created = await request(app)
      .post('/api/events')
      .send({
        description: 'Mutable event',
        actor: 'Actor',
        target: 'Target',
        timestamp: '2020-06-01T00:00:00.000Z',
      })
      .expect(201);
    const eventId = created.body.data.id;

    await request(app)
      .put(`/api/events/${eventId}`)
      .send({ description: 'Updated event' })
      .expect(200);

    await request(app).delete(`/api/events/${eventId}`).expect(200);

    const history = await container.graphRepository.getVersionHistory(graph.id);
    expect(history.total).toBe(3);
    expect(history.versions.map(v => v.operation)).toEqual(
      expect.arrayContaining(['create', 'update', 'delete'])
    );

    const data = await container.graphRepository.checkout(graph.id);
    expect(data.events[eventId]).toBeUndefined();
  });

  it('cascades a linked event deletion so checkout and export hold no dangling relationship', async () => {
    const graph = await container.graphService.createGraph({ name: 'Versioned Cascade Delete' });
    await container.graphService.setActiveGraph(graph.id);

    const causeResponse = await request(app)
      .post('/api/events')
      .send({
        description: 'Cause event',
        actor: 'Actor A',
        target: 'Target A',
        timestamp: '2020-01-01T00:00:00.000Z',
      })
      .expect(201);
    const causeId = causeResponse.body.data.id;

    const effectResponse = await request(app)
      .post('/api/events')
      .send({
        description: 'Effect event',
        actor: 'Actor B',
        target: 'Target B',
        timestamp: '2021-01-01T00:00:00.000Z',
      })
      .expect(201);
    const effectId = effectResponse.body.data.id;

    await request(app)
      .post('/api/causal/link')
      .send({
        causeEventId: causeId,
        effectEventId: effectId,
        relationship: {
          type: 'direct',
          strength: 0.8,
          confidence: 0.9,
          evidence: 'Observed sequence',
        },
      })
      .expect(201);

    // Deleting the cause must remove the event AND its incident relationship
    // from the version store, mirroring the live store's cascade.
    await request(app).delete(`/api/events/${causeId}`).expect(200);

    const data = await container.graphRepository.checkout(graph.id);
    expect(data.events[causeId]).toBeUndefined();
    expect(data.events[effectId]).toBeDefined();
    expect(
      Object.values(data.relationships).some(
        rel => rel.cause_event_id === causeId || rel.effect_event_id === causeId
      )
    ).toBe(false);

    const exportResult = await container.exportService.exportGraph({
      graphId: graph.id,
      scope: 'full',
      includeProvenance: false,
    });
    expect(exportResult.export.data.events.map(event => event.id)).not.toContain(causeId);
    expect(exportResult.export.data.events.map(event => event.id)).toContain(effectId);
    expect(
      exportResult.export.data.causalRelationships.some(
        rel => rel.cause_event_id === causeId || rel.effect_event_id === causeId
      )
    ).toBe(false);
  });

  it('rolls back live store entities when the version store record fails', async () => {
    const graph = await container.graphService.createGraph({ name: 'Rollback Test' });
    await container.graphService.setActiveGraph(graph.id);

    const originalRecord = container.graphWriteVersioningService.recordEvent;
    container.graphWriteVersioningService.recordEvent = async () => {
      throw new Error('Simulated version store commit failure');
    };

    try {
      const res = await request(app)
        .post('/api/events')
        .send({
          description: 'Orphan Event',
          actor: 'Actor X',
          target: 'Target Y',
          timestamp: '2023-01-01T00:00:00.000Z',
        });

      expect(res.status).toBe(500);

      const { eventRepository } = await container.graphScopedRepositories(graph.id);
      const allEvents = await eventRepository.findAll();
      expect(allEvents.some(e => e.description === 'Orphan Event')).toBe(false);
    } finally {
      container.graphWriteVersioningService.recordEvent = originalRecord;
    }
  });
});
