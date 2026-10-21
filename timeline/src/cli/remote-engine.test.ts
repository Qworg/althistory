/**
 * @vitest-environment node
 */

/**
 * The remote engine, exercised against a stand-in for the daemon.
 *
 * The stand-in answers the routes the daemon really serves, in the daemon's
 * own response shape, and records every request it receives. That is what
 * makes the two properties this file checks observable: the requests name the
 * graph they are about in the header the daemon reads, and they call the
 * routes that exist.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { Express, Request, Response } from 'express';
import { AddressInfo } from 'net';
import { RemoteEngine } from './engine/RemoteEngine';

interface RecordedRequest {
  method: string;
  path: string;
  graphId: string | undefined;
  body: unknown;
}

interface FakeEvent {
  id: string;
  description: string;
  actor: string;
  target: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

interface FakeArc {
  id: string;
  name: string;
  description: string;
  start_time: string;
  end_time: string;
  level: number;
  metadata?: Record<string, unknown>;
  /** The graph the arc lives in. */
  graphId?: string;
}

interface FakeRelationship {
  id: string;
  cause_event_id: string;
  effect_event_id: string;
  weight: number;
  confidence: number;
  evidence: string;
  relationship_type: string;
}

/**
 * A stand-in for the daemon.
 *
 * It serves the routes the CLI is allowed to call, in the shapes the daemon
 * answers in: `{ success, data }` for most routes, the export document for
 * the export route, and the events of the graph the `X-Graph-Id` header
 * names.
 */
function createDaemon(): { app: Express; requests: RecordedRequest[]; state: DaemonState } {
  const requests: RecordedRequest[] = [];
  const state: DaemonState = {
    events: [],
    arcs: [],
    relationships: [],
  };

  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: () => void) => {
    requests.push({
      method: req.method,
      path: req.path,
      graphId: req.get('X-Graph-Id') || undefined,
      body: req.body,
    });
    next();
  });

  const eventsOf = (req: Request): FakeEvent[] => {
    const graphId = req.get('X-Graph-Id');
    if (!graphId) return state.events;
    return state.events.filter((event) => (event.metadata?.graphId ?? 'g1') === graphId);
  };

  app.get('/health', (_req, res) => {
    res.json({ status: 'healthy', uptime: 12 });
  });

  app.get('/api/graphs', (_req, res) => {
    if (state.failGraphsListAlways) {
      res.status(429).json({ error: { message: 'Too many requests' } });
      return;
    }
    if (state.failGraphsListOnce) {
      state.failGraphsListOnce = false;
      res.status(429).json({ error: { message: 'Too many requests' } });
      return;
    }
    res.json({
      success: true,
      data: state.graphs ?? [
        { id: 'g1', name: 'First', version: 1 },
        { id: 'g2', name: 'Second', version: 1 },
      ],
    });
  });

  app.get('/api/graphs/:id/data', (req, res) => {
    const graphId = req.params.id;
    const events = state.events.filter(
      (event) => (event.metadata?.graphId ?? 'g1') === graphId
    );
    const arcs = state.arcs.filter((arc) => (arc.graphId ?? 'g1') === graphId);
    res.json({
      success: true,
      data: {
        events,
        arcs,
        relationships: state.relationships,
        pressures: [],
      },
      counts: { events: events.length, arcs: arcs.length, relationships: state.relationships.length },
    });
  });

  app.get('/api/events', (req, res) => {
    const events = eventsOf(req);
    res.json({
      success: true,
      data: events,
      pagination: { limit: 1000, offset: 0, total: events.length, hasMore: false },
    });
  });

  app.post('/api/events', (req, res) => {
    const created: FakeEvent = {
      id: `event-${state.events.length + 1}`,
      description: String(req.body.description ?? ''),
      actor: String(req.body.actor ?? 'Unknown'),
      target: String(req.body.target ?? 'Unknown'),
      timestamp: String(req.body.timestamp ?? new Date().toISOString()),
      metadata: { graphId: req.get('X-Graph-Id') ?? 'g1', ...(req.body.metadata || {}) },
    };
    state.events.push(created);
    res.status(201).json({ success: true, data: created, message: 'Event created successfully' });
  });

  app.get('/api/events/:id', (req, res) => {
    const event = state.events.find((e) => e.id === req.params.id);
    if (!event) {
      res.status(404).json({ error: { message: 'Event not found' } });
      return;
    }
    res.json({ success: true, data: event });
  });

  app.put('/api/events/:id', (req, res) => {
    const event = state.events.find((e) => e.id === req.params.id);
    if (!event) {
      res.status(404).json({ error: { message: 'Event not found' } });
      return;
    }
    Object.assign(event, req.body);
    res.json({ success: true, data: event, message: 'Event updated successfully' });
  });

  app.get('/api/arcs', (req, res) => {
    const graphId = req.get('X-Graph-Id') ?? 'g1';
    const arcs = state.arcs.filter((arc) => (arc.graphId ?? 'g1') === graphId);
    res.json({
      success: true,
      data: arcs,
      pagination: { limit: 1000, offset: 0, total: arcs.length, hasMore: false },
    });
  });

  app.post('/api/arcs', (req, res) => {
    const created: FakeArc = {
      id: `arc-${state.arcs.length + 1}`,
      name: String(req.body.name ?? ''),
      description: String(req.body.description ?? ''),
      start_time: String(req.body.start_time ?? ''),
      end_time: String(req.body.end_time ?? ''),
      level: Number(req.body.level ?? 0),
      metadata: req.body.metadata,
    };
    state.arcs.push(created);
    res.status(201).json({ success: true, data: created, message: 'Arc created successfully' });
  });

  app.get('/api/arcs/:id', (req, res) => {
    const arc = state.arcs.find((a) => a.id === req.params.id);
    if (!arc) {
      res.status(404).json({ error: { message: 'Arc not found' } });
      return;
    }
    res.json({ success: true, data: arc });
  });

  app.post('/api/causal/link', (req, res) => {
    const { causeEventId, effectEventId, relationship } = req.body as {
      causeEventId: string;
      effectEventId: string;
      relationship: { type: string; strength: number; confidence: number; evidence: string };
    };
    const stored: FakeRelationship = {
      id: `rel-${state.relationships.length + 1}`,
      cause_event_id: causeEventId,
      effect_event_id: effectEventId,
      weight: Number(relationship?.strength ?? 1),
      confidence: Number(relationship?.confidence ?? 1),
      evidence: String(relationship?.evidence ?? ''),
      relationship_type: String(relationship?.type ?? 'direct'),
    };
    state.relationships.push(stored);
    res.status(201).json({
      success: true,
      data: { cause: { id: causeEventId }, effect: { id: effectEventId }, relationship },
      message: 'Causal link created successfully',
    });
  });

  app.get('/api/causal/relationships', (_req, res) => {
    res.json({ success: true, data: state.relationships });
  });

  app.delete('/api/causal/link', (req, res) => {
    const { causeEventId, effectEventId } = req.body as { causeEventId: string; effectEventId: string };
    // The daemon looks its ends up before it deletes a link, and answers 404
    // when one of them is gone.
    const graphId = req.get('X-Graph-Id') ?? 'g1';
    const known = (id: string): boolean =>
      state.events.some((event) => event.id === id && (event.metadata?.graphId ?? 'g1') === graphId);
    if (!known(causeEventId) || !known(effectEventId)) {
      res.status(404).json({ error: { message: 'Event not found' } });
      return;
    }
    const index = state.relationships.findIndex(
      (r) => r.cause_event_id === causeEventId && r.effect_event_id === effectEventId
    );
    if (index >= 0) state.relationships.splice(index, 1);
    res.json({ success: true, message: 'Causal link removed successfully' });
  });

  /**
   * The daemon's ingestion route: it runs the extractor and returns a review
   * job. Nothing is written, and the job holds the entities until a reviewer
   * approves it.
   *
   * The shapes are the ones the daemon really answers in: an event carries
   * the source of the reading that produced it -- `llm` for the model path,
   * `text` for the pattern path -- and the result names the reading as a
   * whole with `llm-generated` or `text-extraction`.
   */
  app.post('/api/ingest/text', (req, res) => {
    const useLLM = (req.body as { useLLM?: boolean }).useLLM !== false;
    const modelAnswered = state.ingestSourceType
      ? state.ingestSourceType === 'llm'
      : useLLM;
    const eventSourceType = modelAnswered ? 'llm' : 'text';
    const resultSourceType = modelAnswered ? 'llm-generated' : 'text-extraction';
    res.json({
      jobId: 'job-1',
      status: 'review',
      extraction: {
        events: [
          {
            tempId: 'e1',
            description: 'The Congress votes',
            actor: 'Continental Congress',
            target: 'King George III',
            timestamp: '1776-07-04T00:00:00Z',
            confidence: 0.9,
            source: {
              type: eventSourceType,
              extractedAt: '2026-01-01T00:00:00Z',
            },
            selected: true,
            edited: false,
          },
        ],
        arcs: [],
        relationships: [],
        sources: [
          {
            id: `${resultSourceType}-source`,
            type: resultSourceType,
            accessedAt: '2026-01-01T00:00:00Z',
            confidence: 0.9,
            entityIds: ['e1'],
          },
        ],
        overallConfidence: 0.9,
      },
      validationIssues: [],
    });
  });

  const exportDocument = (): Record<string, unknown> => ({
    version: '1.0',
    metadata: { graphId: 'g1', graphName: 'First', description: '', graphVersion: 1 },
    data: {
      events: state.events,
      arcs: state.arcs,
      causalRelationships: state.relationships,
      inferredPressures: [],
    },
  });

  app.get('/api/export', (_req, res) => {
    // A graph above the entity threshold is answered with a job instead of
    // the document, exactly as the daemon does.
    if (state.asyncExport) {
      res.status(202).json({
        success: true,
        data: { jobId: 'job-1', type: 'export', status: 'pending', entityCount: 5000 },
        message: 'Export has 5000 entities, above the 1000-entity synchronous limit; an export job was created',
      });
      return;
    }
    res.json(exportDocument());
  });

  app.get('/api/export/jobs/:jobId', (_req, res) => {
    const status = state.exportJobStatus ?? 'completed';
    res.json({
      success: true,
      data: {
        id: 'job-1',
        type: 'export',
        status,
        progress: status === 'completed' ? 100 : 10,
        ...(status === 'failed' ? { error: 'the export ran out of room' } : {}),
      },
    });
  });

  app.get('/api/export/jobs/:jobId/download', (_req, res) => {
    res.json(exportDocument());
  });

  return { app, requests, state };
}

interface DaemonState {
  events: FakeEvent[];
  arcs: FakeArc[];
  relationships: FakeRelationship[];
  /**
   * The source the ingestion route records its events with: `llm` when the
   * model answered, `text` when the patterns did.
   */
  ingestSourceType?: 'llm' | 'text';
  /** Whether `GET /export` answers 202 with a job instead of the document. */
  asyncExport?: boolean;
  /** The status the export job reports while it is being polled. */
  exportJobStatus?: 'pending' | 'completed' | 'failed';
  /** The graphs the daemon lists. */
  graphs?: Array<{ id: string; name: string; version: number }>;
  /** Whether the next request for the graphs is rate limited. */
  failGraphsListOnce?: boolean;
  /** Whether every request for the graphs is rate limited. */
  failGraphsListAlways?: boolean;
}

describe('RemoteEngine against a stand-in daemon', () => {
  let daemon: ReturnType<typeof createDaemon>;
  let server: ReturnType<Express['listen']>;
  let baseUrl: string;
  let engine: RemoteEngine;

  beforeEach(async () => {
    daemon = createDaemon();
    server = daemon.app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
    engine = new RemoteEngine(baseUrl);
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('names the graph in the header the daemon reads on every graph-scoped request', async () => {
    await engine.createEvent('g1', {
      description: 'The Congress votes',
      timestamp: '1776-07-04T00:00:00Z',
      actor: 'Continental Congress',
      target: 'King George III',
    });
    await engine.listEvents('g1');
    await engine.createArc('g1', {
      name: 'The Revolution',
      startTime: '1775-04-19T00:00:00Z',
      endTime: '1783-09-03T00:00:00Z',
    });
    await engine.listArcs('g1');
    await engine.listCausalLinks('g1');
    await engine.exportGraph('g1', 'json');

    const graphScoped = daemon.requests.filter((request) =>
      /^\/api\/(events|arcs|causal|export)/.test(request.path)
    );

    expect(graphScoped.length).toBeGreaterThan(4);
    for (const request of graphScoped) {
      expect(request.graphId).toBe('g1');
    }
  });

  it('unwraps the response envelope instead of returning it', async () => {
    const created = await engine.createEvent('g1', {
      description: 'The Congress votes',
      timestamp: '1776-07-04T00:00:00Z',
      actor: 'Continental Congress',
      target: 'King George III',
    });

    expect(created.id).toBe('event-1');
    expect(created.description).toBe('The Congress votes');

    const events = await engine.listEvents('g1');
    expect(Array.isArray(events)).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe('event-1');
  });

  it('calls the causal routes the daemon serves', async () => {
    await engine.createEvent('g1', {
      description: 'First',
      timestamp: '1775-04-19T00:00:00Z',
    });
    await engine.createEvent('g1', {
      description: 'Second',
      timestamp: '1776-07-04T00:00:00Z',
    });

    const link = await engine.createCausalLink('g1', {
      causeId: 'event-1',
      effectId: 'event-2',
      weight: 0.9,
      type: 'direct',
      reasoning: 'Because',
    });
    expect(link.causeId).toBe('event-1');
    expect(link.effectId).toBe('event-2');

    await engine.deleteCausalLink('g1', 'event-1', 'event-2');

    const paths = daemon.requests.map((request) => `${request.method} ${request.path}`);
    expect(paths).toContain('POST /api/causal/link');
    expect(paths).toContain('GET /api/causal/relationships');
    expect(paths).toContain('DELETE /api/causal/link');
    expect(paths).not.toContain('POST /api/causal');
    expect(paths).not.toContain('GET /api/causal');
    expect(paths).not.toContain('GET /api/causal/paths');
    expect(paths).not.toContain('DELETE /api/causal/links');
  });

  it('computes the diff from the graph data route, not from a route that does not exist', async () => {
    daemon.state.events.push({
      id: 'event-1',
      description: 'Only in the source',
      actor: 'A',
      target: 'B',
      timestamp: '1775-04-19T00:00:00Z',
      metadata: { graphId: 'g1' },
    });
    daemon.state.events.push({
      id: 'event-2',
      description: 'Only in the target',
      actor: 'A',
      target: 'B',
      timestamp: '1776-07-04T00:00:00Z',
      metadata: { graphId: 'g2' },
    });

    const diff = await engine.diffGraph('g1', 'g2');

    const paths = daemon.requests.map((request) => request.path);
    expect(paths).toContain('/api/graphs/g1/data');
    expect(paths).toContain('/api/graphs/g2/data');
    expect(paths).not.toContain('/api/graphs/diff');
    expect((diff.events as { added: number }).added).toBe(1);
    expect((diff.events as { deleted: number }).deleted).toBe(1);
  });

  it('finds causal paths from the relationships the daemon serves', async () => {
    daemon.state.relationships.push(
      {
        id: 'rel-1',
        cause_event_id: 'event-1',
        effect_event_id: 'event-2',
        weight: 1,
        confidence: 1,
        evidence: '',
        relationship_type: 'direct',
      },
      {
        id: 'rel-2',
        cause_event_id: 'event-2',
        effect_event_id: 'event-3',
        weight: 1,
        confidence: 1,
        evidence: '',
        relationship_type: 'direct',
      }
    );

    const result = await engine.findCausalPaths('g1', 'event-1', 'event-3');

    expect(result.count).toBe(1);
    expect(result.paths[0]).toEqual(['event-1', 'event-2', 'event-3']);
  });

  it('says which route is missing when the daemon cannot generate a timeline', async () => {
    await expect(
      engine.generateTimeline({
        premise: 'What if Napoleon won Waterloo?',
        divergencePoint: 'The charge succeeds',
      })
    ).rejects.toThrow(/POST \/api\/generate\/timeline/);

    await expect(
      engine.generateExpand({ graphId: 'g1' })
    ).rejects.toThrow(/POST \/api\/generate\/expand/);
  });

  it('validates the graph it was asked about instead of always passing', async () => {
    // A link whose cause comes after its effect is a temporal paradox; the
    // validator has to see it.
    daemon.state.events.push(
      {
        id: 'event-1',
        description: 'The later event',
        actor: 'A',
        target: 'B',
        timestamp: '1900-01-01T00:00:00Z',
        metadata: { graphId: 'g1' },
      },
      {
        id: 'event-2',
        description: 'The earlier event',
        actor: 'A',
        target: 'B',
        timestamp: '1800-01-01T00:00:00Z',
        metadata: { graphId: 'g1' },
      }
    );
    daemon.state.relationships.push({
      id: 'rel-1',
      cause_event_id: 'event-1',
      effect_event_id: 'event-2',
      weight: 1,
      confidence: 1,
      evidence: '',
      relationship_type: 'direct',
    });

    const report = await engine.validateGraph('g1');

    expect(report.valid).toBe(false);
    expect(report.errorCount).toBeGreaterThan(0);
    expect(report.issues.some((issue) => issue.type === 'causal_direction')).toBe(true);
  });

  it('refuses to put an event into an arc that the graph does not hold', async () => {
    daemon.state.events.push({
      id: 'event-1',
      description: 'The Congress votes',
      actor: 'Continental Congress',
      target: 'King George III',
      timestamp: '1776-07-04T00:00:00Z',
      metadata: { graphId: 'g1' },
    });

    await expect(engine.assignEventToArc('g1', 'event-1', 'arc-that-is-not-there')).rejects.toThrow(
      /not found/i
    );
  });

  it('reports a remote ingestion as a preview, because the daemon writes nothing', async () => {
    const result = await engine.ingestText('g1', 'The Congress votes on 4 July 1776.', {
      mode: 'pattern',
    });

    // Nothing was created: the daemon holds the entities in a review job.
    expect(result.eventsCreated).toBe(0);
    expect(result.dryRun).toBe(true);
    expect(result.pendingReview?.jobId).toBe('job-1');
    expect(result.pendingReview?.events).toBe(1);
    expect(result.entities.events).toHaveLength(1);
  });

  it('says that the daemon reads Wikipedia only, instead of failing as a server error', async () => {
    await expect(engine.ingestUrl('g1', 'https://example.org/history', {})).rejects.toThrow(/--direct/);
  });

  it('refuses to report a pattern extraction as a model one in remote mode either', async () => {
    // The stand-in answers with a pattern-made event even when the model was
    // asked for, which is what a daemon without a provider does.
    daemon.state.ingestSourceType = 'text';

    await expect(
      engine.ingestText('g1', 'The Congress votes on 4 July 1776.', { mode: 'llm' })
    ).rejects.toThrow(/LLM extraction produced nothing/);
  });

  it('accepts a remote model extraction when the daemon answered with the model', async () => {
    // The daemon marks the events of the model path with the source `llm`,
    // which is what the providers put on the events they return.
    daemon.state.ingestSourceType = 'llm';

    const result = await engine.ingestText('g1', 'The Congress votes on 4 July 1776.', {
      mode: 'llm',
    });

    expect(result.pendingReview?.events).toBe(1);
    expect(result.entities.events[0].description).toBe('The Congress votes');
  });

  it('tries the graph list again after it was rate limited', async () => {
    // A failed list must not be cached: one 429 would otherwise make every
    // later lookup of the run fail, and the reference into the other graph
    // would be reported as a broken one.
    daemon.state.arcs.push({
      id: 'arc-elsewhere',
      name: 'An arc of the other graph',
      description: '',
      start_time: '1900-01-01T00:00:00Z',
      end_time: '1950-01-01T00:00:00Z',
      level: 0,
      graphId: 'g2',
    });
    daemon.state.events.push({
      id: 'event-1',
      description: 'An event that points across graphs',
      actor: 'A',
      target: 'B',
      timestamp: '1910-01-01T00:00:00Z',
      metadata: { graphId: 'g1', arcId: 'arc-elsewhere' },
    });

    // The first request for the graphs is rate limited.
    daemon.state.failGraphsListOnce = true;

    const report = await engine.validateGraph('g1', false, true);

    // The lookup that failed was reported, and the one that followed it
    // found the arc in the other graph.
    const crossGraph = report.issues.find((issue) => issue.type === 'cross_graph_reference');
    expect(crossGraph).toBeDefined();
    expect(crossGraph?.message).toContain('g2');
  });

  it('leaves a reference into another graph alone when the lookup fails', async () => {
    daemon.state.arcs.push({
      id: 'arc-elsewhere',
      name: 'An arc of the other graph',
      description: '',
      start_time: '1900-01-01T00:00:00Z',
      end_time: '1950-01-01T00:00:00Z',
      level: 0,
      graphId: 'g2',
    });
    daemon.state.events.push({
      id: 'event-1',
      description: 'An event that points across graphs',
      actor: 'A',
      target: 'B',
      timestamp: '1910-01-01T00:00:00Z',
      metadata: { graphId: 'g1', arcId: 'arc-elsewhere' },
    });

    // Every request for the graphs is rate limited.
    daemon.state.failGraphsListAlways = true;

    const report = await engine.validateGraph('g1', false, true);

    // The reference was not deleted: the lookup failed, so it could not be
    // checked, and a reference nobody could check is not a dangling one.
    const updated = daemon.requests.filter((request) => request.method === 'PUT');
    expect(updated).toHaveLength(0);
    expect(report.repairsApplied?.some((repair) => repair.includes('Removed orphan arc reference'))).toBe(false);
    expect(report.repairFailures?.some((failure) => failure.includes('arc-elsewhere'))).toBe(true);
  });

  it('does not claim that an orphan link was removed when the daemon refuses the delete', async () => {
    // The daemon looks the ends of a link up before it deletes it, so it
    // refuses to delete a link whose end is gone -- and the link is still
    // there afterwards. The report has to say that, not claim the orphan was
    // removed.
    daemon.state.events.push({
      id: 'event-1',
      description: 'The event that is there',
      actor: 'A',
      target: 'B',
      timestamp: '1900-01-01T00:00:00Z',
      metadata: { graphId: 'g1' },
    });
    daemon.state.relationships.push({
      id: 'rel-1',
      cause_event_id: 'event-that-is-gone',
      effect_event_id: 'event-1',
      weight: 1,
      confidence: 1,
      evidence: '',
      relationship_type: 'direct',
    });

    const report = await engine.validateGraph('g1', false, true);

    // The link is still there.
    expect(daemon.state.relationships).toHaveLength(1);
    // The report does not claim that it was deleted.
    expect(report.repairsApplied?.some((repair) => repair.includes('Deleted orphaned causal relationship'))).toBe(false);
    const failure = report.repairFailures?.find((entry) => entry.includes('rel-1'));
    expect(failure).toBeDefined();
    expect(failure).toContain('still there');
  });

  it('renders the export formats from the document the daemon serves', async () => {
    daemon.state.events.push({
      id: 'event-1',
      description: 'The Congress votes',
      actor: 'Continental Congress',
      target: 'King George III',
      timestamp: '1776-07-04T00:00:00Z',
      metadata: { graphId: 'g1' },
    });

    const markdown = await engine.exportGraph('g1', 'markdown');
    expect(markdown.content).toContain('# Timeline Context');
    expect(markdown.content).toContain('The Congress votes');

    const graphml = await engine.exportGraph('g1', 'graphml');
    expect(graphml.content).toContain('<graphml');
    expect(graphml.content).toContain('event-1');
  });

  it('follows the export job the daemon starts for a large graph', async () => {
    // The daemon answers 202 with a job above its entity threshold. Rendering
    // that answer as a document would write a well-formed, empty graph and
    // report success.
    daemon.state.asyncExport = true;
    daemon.state.exportJobStatus = 'pending';
    daemon.state.events.push({
      id: 'event-1',
      description: 'The Congress votes',
      actor: 'Continental Congress',
      target: 'King George III',
      timestamp: '1776-07-04T00:00:00Z',
      metadata: { graphId: 'g1' },
    });

    // The job finishes on the second poll.
    let polls = 0;
    const originalStatus = daemon.state.exportJobStatus;
    const statusTimer = setInterval(() => {
      polls += 1;
      if (polls >= 2) daemon.state.exportJobStatus = 'completed';
    }, 20);

    try {
      const markdown = await engine.exportGraph('g1', 'markdown');
      expect(markdown.content).toContain('The Congress votes');
    } finally {
      clearInterval(statusTimer);
      daemon.state.exportJobStatus = originalStatus;
    }
  });

  it('reports a failed export job instead of writing an empty graph', async () => {
    daemon.state.asyncExport = true;
    daemon.state.exportJobStatus = 'failed';

    await expect(engine.exportGraph('g1', 'markdown')).rejects.toThrow(/export job job-1 ended as "failed"/);
  });
});
