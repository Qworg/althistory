/**
 * The live change feed over the WebSocket (issue 23).
 *
 * A real HTTP server, a real `ws` client and a real local container: a change
 * made by another writer (an HTTP request carrying an agent's key, the
 * versioning bridge, a graph operation) reaches the socket that watches the
 * graph, attributed; a graph the key may not read is refused and silent; a key
 * that loses access stops hearing; and a client that was away is caught up, or
 * told to refetch.
 *
 * What each load-bearing test would break on:
 *   - "delivers another writer's change": fails if the feed is not wired to the
 *     handler, or only the socket's own writes were announced.
 *   - "does not deliver a graph the socket did not subscribe to": fails if the
 *     handler broadcasts to every socket.
 *   - "refuses a graph the key may not access": fails if `subscribe` checks the
 *     token's graph instead of the requested one.
 *   - "stops delivering when the key loses the graph": fails if access is
 *     checked at subscribe only.
 *   - "replays what a reconnecting client missed": fails without the ring, the
 *     epoch check, or the replay-before-register ordering.
 *   - "refuses a feed token to a key that cannot read": fails if the token route
 *     keeps asking for write:events only (or nothing).
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createServer } from 'http';
import type { Server } from 'http';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { WebSocket } from 'ws';
import type { RawData } from 'ws';
import { loadConfig, initializeDatabaseManager } from '@/utils';
import { Container, initializeContainer, cleanupContainer } from '@/container';
import { injectContainer, errorHandler, authenticate, asRequestHandler } from '@/api/middleware';
import { attributeChanges } from '@/api/changeAttribution';
import { streamRoutes } from '@/api/routes/stream';
import { eventRoutes } from '@/api/routes/events';
import { batchRoutes } from '@/api/routes/batch';
import { inferenceRoutes } from '@/api/routes/inference';
import {
  StreamHandler,
  StreamSessionManager,
  StreamTokenStore,
  getStreamTokenStore,
  resetStreamTokenStore,
  STREAM_PATH,
} from '@/websocket';
import { ChangeFeedService } from '@/services/ChangeFeedService';

type Message = Record<string, unknown>;

interface Client {
  ws: WebSocket;
  /** The next message, or a failure after the timeout. */
  next(timeoutMs?: number): Promise<Message>;
  /** The next message of this type, skipping others. */
  nextOf(type: string, timeoutMs?: number): Promise<Message>;
  /** Everything received so far that has not been read. */
  drain(): Message[];
  send(message: Message): void;
  closed: Promise<number>;
  close(): Promise<void>;
}

function rawToString(data: RawData): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}

function connect(url: string): Promise<Client> {
  const ws = new WebSocket(url);
  const queue: Message[] = [];
  const waiters: Array<(message: Message) => void> = [];
  ws.on('message', (data) => {
    const message = JSON.parse(rawToString(data)) as Message;
    const waiter = waiters.shift();
    if (waiter) waiter(message);
    else queue.push(message);
  });
  const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));
  const next = (timeoutMs = 3000): Promise<Message> =>
    new Promise((resolve, reject) => {
      const queued = queue.shift();
      if (queued) {
        resolve(queued);
        return;
      }
      const timer = setTimeout(() => reject(new Error('timed out waiting for a message')), timeoutMs);
      waiters.push((message) => {
        clearTimeout(timer);
        resolve(message);
      });
    });
  const client: Client = {
    ws,
    next,
    async nextOf(type, timeoutMs) {
      for (;;) {
        const message = await next(timeoutMs);
        if (message.type === type) return message;
      }
    },
    drain() {
      return queue.splice(0, queue.length);
    },
    send: (message) => ws.send(JSON.stringify(message)),
    closed,
    async close() {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      await closed;
    },
  };
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(client));
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) => reject(new Error(`upgrade refused: ${res.statusCode}`)));
  });
}

const settle = (ms = 150): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('the live change feed over the WebSocket', () => {
  let container: Container;
  let testDataDir: string;
  let server: Server;
  let handler: StreamHandler;
  let tokenStore: StreamTokenStore;
  let feed: ChangeFeedService;
  let port: number;
  let app: express.Application;
  let graphA: string;
  let graphB: string;
  let readerKey: string;
  let agentKey: string;
  let agentKeyId: string;
  let writerKey: string;
  const open: Client[] = [];

  const url = (token: string): string => `ws://127.0.0.1:${port}${STREAM_PATH}?token=${encodeURIComponent(token)}`;

  async function tokenFor(key: string, graph: string, body: Record<string, unknown> = { mode: 'feed' }): Promise<string> {
    const res = await request(app).post('/api/stream/token').set('X-API-Key', key).set('X-Graph-Id', graph).send(body).expect(201);
    return res.body.token as string;
  }

  async function watcher(key: string, graph: string, subscribe: string[] = [graph]): Promise<Client> {
    const client = await connect(url(await tokenFor(key, graph)));
    open.push(client);
    expect((await client.next()).type).toBe('auth_result');
    for (const channel of subscribe) {
      client.send({ type: 'subscribe', graphId: channel });
      expect((await client.nextOf('subscribed')).graphId).toBe(channel);
    }
    return client;
  }

  /** An agent adds an event over HTTP, as the MCP server does through the app. */
  async function agentAddsEvent(graph: string, description: string, key = agentKey): Promise<string> {
    const res = await request(app)
      .post('/api/events')
      .set('X-API-Key', key)
      .set('X-Graph-Id', graph)
      .set('X-Althistory-Client', 'mcp')
      .send({ description, actor: 'The League', target: 'The Tide', timestamp: '1300-01-01T00:00:00Z' })
      .expect(201);
    return (res.body.data?.id ?? res.body.id) as string;
  }

  beforeAll(async () => {
    testDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'feed-test-'));
    process.env.LOCAL_EXECUTION_ENABLED = 'true';
    process.env.LOCAL_DATA_DIR = testDataDir;
    process.env.LOCAL_GRAPH_FILE = 'feed-graph.json';
    process.env.LOCAL_BACKUP_ENABLED = 'false';
    process.env.LOCAL_MAX_MEMORY_MB = '64';

    const config = loadConfig();
    container = initializeContainer(initializeDatabaseManager(config.database), config);
    await container.initialize();
    feed = container.changeFeedService;

    graphA = (await container.graphService.createGraph({ name: 'Feed A' })).id;
    graphB = (await container.graphService.createGraph({ name: 'Feed B' })).id;
    await container.graphRepository.setActiveGraph(graphA);

    const create = async (name: string, permissions: Parameters<typeof container.authService.createApiKey>[0]['permissions'], allowedGraphs: string[] | '*' = '*') =>
      container.authService.createApiKey({ name, permissions, allowedGraphs, rateLimit: { concurrentStreams: 8 } });
    readerKey = (await create('Watcher', ['read:events', 'read:graphs'])).key;
    const agent = await create('Claude agent', ['read:events', 'write:events', 'write:arcs', 'write:relationships', 'read:arcs', 'read:relationships', 'read:graphs', 'write:graphs']);
    agentKey = agent.key;
    agentKeyId = agent.id;
    writerKey = (await create('Writer', ['write:events'])).key;

    // The token route issues into the process-wide store, which the handler reads.
    resetStreamTokenStore();
    tokenStore = getStreamTokenStore();
    handler = new StreamHandler({
      tokenStore,
      sessionManager: new StreamSessionManager(),
      deps: {
        authService: container.authService,
        graphScopedRepositories: (id) => container.graphScopedRepositories(id),
        graphWriteVersioningService: container.graphWriteVersioningService,
        rateLimitService: container.rateLimitService,
        graphCalendar: async (id) => (await container.graphRepository.findById(id))?.calendar,
        graphExists: async (id) => {
          const graph = await container.graphRepository.findById(id);
          return Boolean(graph) && graph?.status !== 'deleted';
        },
      },
      feed,
      maxSubscriptions: 3,
    });

    app = express();
    app.use(express.json());
    app.use(injectContainer);
    app.use(asRequestHandler(authenticate));
    app.use('/api', attributeChanges);
    app.use('/api/stream', streamRoutes);
    app.use('/api/events', eventRoutes);
    app.use('/api/batch', batchRoutes);
    app.use('/api/inference', inferenceRoutes);
    app.use(errorHandler);

    server = createServer(app);
    handler.attach(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    port = address.port;
  });

  afterEach(async () => {
    await Promise.all(open.splice(0).map((client) => client.close()));
  });

  afterAll(async () => {
    await handler.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await cleanupContainer();
    await fs.rm(testDataDir, { recursive: true, force: true }).catch(() => undefined);
  });

  describe('the token', () => {
    it('is issued in feed mode to a key that may only read, and refused for write mode', async () => {
      const feedToken = await request(app)
        .post('/api/stream/token')
        .set('X-API-Key', readerKey)
        .set('X-Graph-Id', graphA)
        .send({ mode: 'feed' })
        .expect(201);
      expect(feedToken.body.mode).toBe('feed');
      await request(app).post('/api/stream/token').set('X-API-Key', readerKey).set('X-Graph-Id', graphA).send({}).expect(403);
      await request(app).post('/api/stream/token').set('X-API-Key', readerKey).set('X-Graph-Id', graphA).send({ mode: 'write' }).expect(403);
    });

    it('is refused in feed mode to a key that cannot read, and for a mode that is neither', async () => {
      await request(app).post('/api/stream/token').set('X-API-Key', writerKey).set('X-Graph-Id', graphA).send({ mode: 'feed' }).expect(403);
      await request(app).post('/api/stream/token').set('X-API-Key', readerKey).set('X-Graph-Id', graphA).send({ mode: 'listen' }).expect(400);
    });

    it('stays a write token when no mode is given', async () => {
      const res = await request(app).post('/api/stream/token').set('X-API-Key', writerKey).set('X-Graph-Id', graphA).send({}).expect(201);
      expect(res.body.mode).toBe('write');
    });
  });

  describe('watching a graph', () => {
    it("delivers another writer's change, attributed to who made it", async () => {
      const client = await watcher(readerKey, graphA);
      const id = await agentAddsEvent(graphA, 'The League raises the wall');

      const change = await client.nextOf('change');
      expect(change).toMatchObject({
        type: 'change',
        kind: 'entities',
        graphId: graphA,
        operation: 'create',
        entities: [{ type: 'event', id }],
        actor: { kind: 'agent', name: 'Claude agent', keyId: agentKeyId },
      });
      expect(String(change.summary)).toContain('The League raises the wall');
      expect(typeof change.seq).toBe('number');
      expect(typeof change.at).toBe('string');
    });

    it('says which browser tab made a change, so that tab can recognise its own', async () => {
      const client = await watcher(readerKey, graphA);
      await request(app)
        .post('/api/events')
        .set('X-API-Key', agentKey)
        .set('X-Graph-Id', graphA)
        .set('X-Althistory-Client', 'web')
        .set('X-Client-Id', 'tab-42')
        .send({ description: 'From a tab', actor: 'A', target: 'B', timestamp: '1301-01-01T00:00:00Z' })
        .expect(201);
      const change = await client.nextOf('change');
      expect(change).toMatchObject({ origin: 'tab-42', actor: { kind: 'person' } });
    });

    it('delivers edits and deletions, and the links that go with a deleted event', async () => {
      const client = await watcher(readerKey, graphA);
      const id = await agentAddsEvent(graphA, 'To be edited');
      await client.nextOf('change');
      await request(app)
        .put(`/api/events/${id}`)
        .set('X-API-Key', agentKey)
        .set('X-Graph-Id', graphA)
        .send({ description: 'Edited by the agent' })
        .expect(200);
      expect(await client.nextOf('change')).toMatchObject({ operation: 'update', entities: [{ type: 'event', id }] });
      await request(app).delete(`/api/events/${id}`).set('X-API-Key', agentKey).set('X-Graph-Id', graphA).expect(200);
      expect(await client.nextOf('change')).toMatchObject({ operation: 'delete', entities: [{ type: 'event', id }] });
    });

    it("delivers a simulation's milestones and their links as they are written", async () => {
      const anchor = await agentAddsEvent(graphA, 'The Tide Treaty is signed');
      const client = await watcher(readerKey, graphA);
      const res = await request(app)
        .post('/api/inference/simulate')
        .set('X-API-Key', agentKey)
        .set('X-Graph-Id', graphA)
        .set('X-Althistory-Client', 'mcp')
        .send({ anchorEventId: anchor, steps: 2 })
        .expect(200);
      const events = res.body.data.events as Array<{ id: string }>;
      expect(events).toHaveLength(2);

      const changes: Message[] = [];
      // Two events and two links, each announced by its own commit.
      for (let i = 0; i < 4; i += 1) changes.push(await client.nextOf('change'));
      const announced = changes.flatMap((change) => change.entities as Array<{ type: string; id: string }>);
      for (const event of events) expect(announced).toContainEqual({ type: 'event', id: event.id });
      expect(announced.filter((entity) => entity.type === 'relationship')).toHaveLength(2);
      for (const change of changes) {
        expect(change).toMatchObject({ kind: 'entities', operation: 'create', actor: { kind: 'agent', name: 'Claude agent' } });
      }
    });

    it('delivers a batch, which writes without a version', async () => {
      const client = await watcher(readerKey, graphA);
      await request(app)
        .post('/api/batch/events')
        .set('X-API-Key', agentKey)
        .set('X-Graph-Id', graphA)
        .send({
          graphId: graphA,
          events: [
            { description: 'One', actor: 'A', target: 'B', timestamp: '1302-01-01T00:00:00Z' },
            { description: 'Two', actor: 'A', target: 'B', timestamp: '1303-01-01T00:00:00Z' },
          ],
        })
        .expect(201);
      const change = await client.nextOf('change');
      expect(change).toMatchObject({ kind: 'entities', operation: 'create', graphId: graphA });
      expect((change.entities as unknown[]).length).toBe(2);
      expect(String(change.summary)).toBe('Added 2 events in a batch');
    });

    it('delivers a rollback as a replaced graph, after the live store holds the old head', async () => {
      const graph = (await container.graphService.createGraph({ name: 'Rolled back' })).id;
      const scoped = await container.graphScopedRepositories(graph);
      const event = await scoped.eventRepository.create({
        description: 'Kept',
        actor: 'A',
        target: 'B',
        timestamp: new Date('1400-01-01T00:00:00Z'),
      });
      await container.graphWriteVersioningService.recordEvent(graph, event, 'create');
      const history = await container.graphService.getVersionHistory(graph);
      const target = history.versions.find((version) => version.version === 1) ?? history.versions[history.versions.length - 1];
      const later = await scoped.eventRepository.create({
        description: 'Will be rolled back',
        actor: 'A',
        target: 'B',
        timestamp: new Date('1401-01-01T00:00:00Z'),
      });
      await container.graphWriteVersioningService.recordEvent(graph, later, 'create');

      const client = await watcher(readerKey, graph);
      // What the watcher refetches on the message must already be the old head.
      const heardWhileReplaced: number[] = [];
      const stop = feed.subscribe((record) => {
        if (record.kind === 'replaced') {
          void container.graphScopedRepositories(graph).then(async (s) => heardWhileReplaced.push((await s.eventRepository.findAll()).length));
        }
      });
      await container.graphService.rollbackGraph(graph, target.version);
      stop();
      const change = await client.nextOf('change');
      expect(change).toMatchObject({ kind: 'replaced', reason: 'rollback', graphId: graph });
      await settle(50);
      expect(heardWhileReplaced).toEqual([1]);
    });

    it('does not deliver a graph the socket did not subscribe to', async () => {
      const client = await watcher(readerKey, graphA);
      await agentAddsEvent(graphB, 'In another graph');
      await agentAddsEvent(graphA, 'In this graph');
      const change = await client.nextOf('change');
      expect(change.graphId).toBe(graphA);
      await settle();
      expect(client.drain().filter((message) => message.type === 'change')).toEqual([]);
    });

    it('stops delivering after unsubscribe, and answers a ping', async () => {
      const client = await watcher(readerKey, graphA);
      client.send({ type: 'unsubscribe', graphId: graphA, requestId: 'u1' });
      expect(await client.nextOf('unsubscribed')).toMatchObject({ graphId: graphA, reason: 'requested', requestId: 'u1' });
      await agentAddsEvent(graphA, 'Nobody is watching');
      client.send({ type: 'ping' });
      expect((await client.next()).type).toBe('pong');
      expect(client.drain()).toEqual([]);
    });

    it('delivers to every socket watching the graph', async () => {
      const first = await watcher(readerKey, graphA);
      const second = await watcher(agentKey, graphA);
      await agentAddsEvent(graphA, 'Heard twice');
      expect((await first.nextOf('change')).graphId).toBe(graphA);
      expect((await second.nextOf('change')).graphId).toBe(graphA);
    });
  });

  describe('who may watch', () => {
    it('refuses a graph the key may not access, and nothing from it arrives', async () => {
      const limited = (await container.authService.createApiKey({ name: 'Only A', permissions: ['read:events'], allowedGraphs: [graphA] })).key;
      const client = await watcher(limited, graphA, []);
      client.send({ type: 'subscribe', graphId: graphB });
      expect(await client.nextOf('error')).toMatchObject({ code: 'GRAPH_ACCESS_DENIED' });
      await agentAddsEvent(graphB, 'Secret');
      await settle();
      expect(client.drain().filter((message) => message.type === 'change')).toEqual([]);
    });

    it('refuses a key that cannot read events, even with a token from before it lost the permission', async () => {
      const key = await container.authService.createApiKey({ name: 'Loses read', permissions: ['read:events'] });
      const token = await tokenFor(key.key, graphA);
      await container.authService.updateApiKey(key.id, { permissions: ['write:graphs'] });
      await expect(connect(url(token))).rejects.toThrow(/403/);
    });

    it('refuses a graph that does not exist, and an id that is not one', async () => {
      const client = await watcher(readerKey, graphA, []);
      client.send({ type: 'subscribe', graphId: 'no-such-graph' });
      expect(await client.nextOf('error')).toMatchObject({ code: 'GRAPH_NOT_FOUND' });
      client.send({ type: 'subscribe', graphId: '../etc' });
      expect(await client.nextOf('error')).toMatchObject({ code: 'INVALID_MESSAGE' });
      client.send({ type: 'subscribe' });
      expect(await client.nextOf('error')).toMatchObject({ code: 'INVALID_MESSAGE' });
      client.send({ type: 'subscribe', graphId: graphA, since: 'later' });
      expect(await client.nextOf('error')).toMatchObject({ code: 'INVALID_MESSAGE' });
    });

    it('limits how many graphs one socket watches', async () => {
      const extra = [(await container.graphService.createGraph({ name: 'X1' })).id, (await container.graphService.createGraph({ name: 'X2' })).id];
      const client = await watcher(readerKey, graphA, [graphA, graphB, extra[0]]);
      client.send({ type: 'subscribe', graphId: extra[1] });
      expect(await client.nextOf('error')).toMatchObject({ code: 'SUBSCRIPTION_LIMIT' });
      // Watching one it already watches is not a new subscription.
      client.send({ type: 'subscribe', graphId: graphA });
      expect((await client.nextOf('subscribed')).graphId).toBe(graphA);
    });

    it('keeps a feed socket read-only', async () => {
      const client = await watcher(agentKey, graphA);
      client.send({ type: 'event', requestId: 'w1', data: { description: 'x', actor: 'a', target: 'b', timestamp: '1500-01-01T00:00:00Z' } });
      expect(await client.nextOf('error')).toMatchObject({ code: 'READ_ONLY_STREAM' });
    });

    it('lets a write socket watch too, when its key may read', async () => {
      const record = tokenStore.issue({ apiKeyId: agentKeyId, graphId: graphA, permissions: ['write:events'] });
      const client = await connect(url(record.token));
      open.push(client);
      expect(await client.next()).toMatchObject({ type: 'auth_result', mode: 'write' });
      client.send({ type: 'subscribe', graphId: graphA });
      expect((await client.nextOf('subscribed')).graphId).toBe(graphA);
    });

    it("credits a write made over the write socket to the key that made it, not to the app", async () => {
      const watching = await watcher(readerKey, graphA);
      const record = tokenStore.issue({ apiKeyId: agentKeyId, graphId: graphA, permissions: ['write:events'] });
      const writer = await connect(url(record.token));
      open.push(writer);
      expect((await writer.next()).type).toBe('auth_result');
      writer.send({
        type: 'event',
        requestId: 'w-credit',
        data: { description: 'Written over the socket', actor: 'The League', target: 'The Tide', timestamp: '1302-01-01T00:00:00Z' },
      });
      expect(await writer.nextOf('ack')).toMatchObject({ success: true });
      const change = await watching.nextOf('change');
      expect(change).toMatchObject({ operation: 'create', actor: { kind: 'api', name: 'Claude agent', keyId: agentKeyId } });
      expect(String(change.summary)).toContain('Written over the socket');
    });

    it('stops delivering when the key loses the graph, and ends the socket when the key is revoked', async () => {
      const key = await container.authService.createApiKey({ name: 'Temporary', permissions: ['read:events'] });
      const client = await watcher(key.key, graphA);
      await container.authService.updateApiKey(key.id, { allowedGraphs: [graphB] });
      await handler.revalidateFeedSessions();
      expect(await client.nextOf('unsubscribed')).toMatchObject({ graphId: graphA, reason: 'access_revoked' });
      await agentAddsEvent(graphA, 'After access was removed');
      await settle();
      expect(client.drain().filter((message) => message.type === 'change')).toEqual([]);

      const other = await watcher(key.key, graphB);
      await container.authService.revokeApiKey(key.id);
      await handler.revalidateFeedSessions();
      expect(await other.nextOf('error')).toMatchObject({ code: 'KEY_INVALID' });
      expect(await other.closed).toBe(1000);
    });
  });

  describe('the graph list', () => {
    it('announces a graph made, changed and deleted, only for graphs the key may access', async () => {
      const limited = (await container.authService.createApiKey({ name: 'List only A', permissions: ['read:events', 'read:graphs'], allowedGraphs: [graphA] })).key;
      const all = await watcher(readerKey, graphA, ['*']);
      const some = await watcher(limited, graphA, ['*']);

      const made = await container.graphService.createGraph({ name: 'Brand new' });
      expect(await all.nextOf('change')).toMatchObject({ kind: 'graph', operation: 'create', graphId: made.id, name: 'Brand new' });
      await container.graphService.updateGraph(made.id, { name: 'Renamed' });
      expect(await all.nextOf('change')).toMatchObject({ kind: 'graph', operation: 'update', fields: ['name'] });
      await container.graphService.deleteGraph(made.id);
      expect(await all.nextOf('change')).toMatchObject({ kind: 'graph', operation: 'delete' });

      await settle();
      expect(some.drain().filter((message) => message.type === 'change')).toEqual([]);
    });

    it('hears a branch as a new graph', async () => {
      const client = await watcher(readerKey, graphA, ['*']);
      const branch = await container.graphService.branchGraph(graphA, { name: 'A branch' });
      const created = await client.nextOf('change');
      expect(created).toMatchObject({ kind: 'graph', operation: 'create', graphId: branch.id });
      expect(await client.nextOf('change')).toMatchObject({ kind: 'replaced', reason: 'branch', graphId: branch.id });
    });

    it('needs read:graphs', async () => {
      const key = await container.authService.createApiKey({ name: 'No list', permissions: ['read:events'] });
      const client = await watcher(key.key, graphA, []);
      client.send({ type: 'subscribe', graphId: '*' });
      expect(await client.nextOf('error')).toMatchObject({ code: 'PERMISSION_DENIED' });
    });
  });

  describe('reconnecting', () => {
    it('replays what a client missed, in order, before anything new', async () => {
      const first = await watcher(readerKey, graphA);
      const subscribedSeq = feed.cursor;
      await agentAddsEvent(graphA, 'Seen before the drop');
      const seen = await first.nextOf('change');
      await first.close();

      // Two changes while it is away, one of them to another graph.
      const missedA = await agentAddsEvent(graphA, 'Missed one');
      await agentAddsEvent(graphB, 'Not this graph');
      const missedB = await agentAddsEvent(graphA, 'Missed two');

      const client = await connect(url(await tokenFor(readerKey, graphA)));
      open.push(client);
      await client.next();
      client.send({ type: 'subscribe', graphId: graphA, epoch: feed.epoch, since: seen.seq });
      const subscribed = await client.nextOf('subscribed');
      expect(subscribed).toMatchObject({ epoch: feed.epoch, replayed: 2 });
      expect(subscribed.resync).toBeUndefined();
      expect(subscribed.seq as number).toBeGreaterThan(subscribedSeq);
      const one = await client.next();
      const two = await client.next();
      expect(one).toMatchObject({ type: 'change', entities: [{ id: missedA }] });
      expect(two).toMatchObject({ type: 'change', entities: [{ id: missedB }] });
      expect(one.seq as number).toBeLessThan(two.seq as number);

      // And what happens after is live.
      const live = await agentAddsEvent(graphA, 'Live again');
      expect(await client.nextOf('change')).toMatchObject({ entities: [{ id: live }] });
    });

    it('replays nothing for a client that missed nothing', async () => {
      const first = await watcher(readerKey, graphA);
      await agentAddsEvent(graphA, 'Last thing');
      const seen = await first.nextOf('change');
      await first.close();

      const client = await connect(url(await tokenFor(readerKey, graphA)));
      open.push(client);
      await client.next();
      client.send({ type: 'subscribe', graphId: graphA, epoch: feed.epoch, since: seen.seq });
      const subscribed = await client.nextOf('subscribed');
      expect(subscribed).toMatchObject({ replayed: 0 });
      expect(subscribed.resync).toBeUndefined();
    });

    it('tells a client from another server process to refetch', async () => {
      const client = await watcher(readerKey, graphA, []);
      client.send({ type: 'subscribe', graphId: graphA, epoch: 'an-earlier-process', since: 5 });
      expect(await client.nextOf('subscribed')).toMatchObject({ replayed: 0, resync: 'epoch', epoch: feed.epoch });
    });

    it('tells a client the ring has moved past to refetch, and the next change is still live', async () => {
      const small = new ChangeFeedService({ bufferSize: 2 });
      const smallHandler = new StreamHandler({
        tokenStore,
        sessionManager: new StreamSessionManager(),
        deps: {
          authService: container.authService,
          graphScopedRepositories: (id) => container.graphScopedRepositories(id),
          graphWriteVersioningService: container.graphWriteVersioningService,
        },
        feed: small,
      });
      const smallServer = createServer(app);
      smallHandler.attach(smallServer);
      await new Promise<void>((resolve) => smallServer.listen(0, '127.0.0.1', resolve));
      const address = smallServer.address();
      if (!address || typeof address === 'string') throw new Error('no port');
      try {
        for (let i = 0; i < 5; i += 1) {
          small.publish(graphA, { kind: 'entities', operation: 'create', entities: [{ type: 'event', id: `e${i}` }], summary: `e${i}` });
        }
        const record = tokenStore.issue({ apiKeyId: agentKeyId, graphId: graphA, permissions: ['read:events'], mode: 'feed' });
        const client = await connect(`ws://127.0.0.1:${address.port}${STREAM_PATH}?token=${encodeURIComponent(record.token)}`);
        open.push(client);
        await client.next();
        client.send({ type: 'subscribe', graphId: graphA, epoch: small.epoch, since: 1 });
        expect(await client.nextOf('subscribed')).toMatchObject({ replayed: 0, resync: 'gap' });
        small.publish(graphA, { kind: 'entities', operation: 'create', entities: [{ type: 'event', id: 'live' }], summary: 'live' });
        expect(await client.nextOf('change')).toMatchObject({ entities: [{ id: 'live' }] });
      } finally {
        await smallHandler.close();
        await new Promise<void>((resolve) => smallServer.close(() => resolve()));
      }
    });
  });
});
