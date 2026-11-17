/**
 * The live change feed, stream tokens and generation jobs in cloud mode
 * (issue 26), against a real Neo4j and Redis.
 *
 * All three keep their state in the process (the feed's ring, the token store,
 * the job table), which is what `CLOUD_SINGLE_REPLICA_STATE` asserts is enough.
 * Every other suite that drives them runs in local execution, so nothing showed
 * that they work when the entities are in Neo4j: that a write through the API
 * reaches a watcher, that a token is minted, accepted once and bound to its
 * graph, and that a generation job writes a graph that can be read back.
 *
 * This suite boots the real `Application` (src/index.ts) in cloud mode -- the
 * container, the schema, the routes and the stream handler on a real HTTP
 * server -- and drives it over HTTP and a real WebSocket. It runs only under
 * `vitest.cloud.config.ts` (`npm run test:cloud`); the default run excludes it.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { WebSocket } from 'ws';
import type { RawData } from 'ws';
import { Application } from '@/index';
import { getContainer, type Container } from '@/container';
import { getDatabaseManager } from '@/utils/database';
import { resetStreamTokenStore, STREAM_PATH } from '@/websocket';
import type { Permission } from '@/models/ApiKey';

type Message = Record<string, unknown>;

interface Client {
  next(timeoutMs?: number): Promise<Message>;
  nextOf(type: string, timeoutMs?: number): Promise<Message>;
  send(message: Message): void;
  close(): Promise<void>;
}

function rawToString(data: RawData): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (!address || typeof address === 'string') {
        probe.close();
        reject(new Error('probe server did not expose a port'));
        return;
      }
      const { port } = address;
      probe.close(() => resolve(port));
    });
  });
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
  const closed = new Promise<void>((resolve) => ws.on('close', () => resolve()));
  const next = (timeoutMs = 5000): Promise<Message> =>
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
    next,
    async nextOf(type, timeoutMs) {
      for (;;) {
        const message = await next(timeoutMs);
        if (message.type === type) return message;
      }
    },
    send: (message) => ws.send(JSON.stringify(message)),
    async close() {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
      await closed;
    },
  };
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(client));
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) => reject(new Error(`upgrade refused: ${res.statusCode}`)));
  });
}

describe('the live feed, stream tokens and generation jobs in cloud mode', () => {
  let app: Application;
  let container: Container;
  let dataDir: string;
  let port: number;
  let base: string;
  let graphA: string;
  let graphB: string;
  /** Reads and writes every graph. */
  let agentKey: string;
  /** May read and write graph A only. */
  let graphAKey: string;
  let generateKey: string;
  const exits: number[] = [];
  const open: Client[] = [];
  const graphsMade: string[] = [];
  let listenersBefore: Map<string, Set<(...args: never[]) => void>>;
  const saved: Record<string, string | undefined> = {};

  const setEnv = (name: string, value: string | undefined): void => {
    if (!(name in saved)) saved[name] = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };

  async function http(
    method: 'GET' | 'POST',
    url: string,
    key: string,
    graph?: string,
    body?: unknown
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const headers: Record<string, string> = { 'X-API-Key': key, 'Content-Type': 'application/json' };
    if (graph) headers['X-Graph-Id'] = graph;
    const response = await fetch(`${base}${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  async function token(key: string, graph: string, mode?: 'feed'): Promise<{ status: number; token?: string }> {
    const res = await http('POST', '/api/stream/token', key, graph, mode ? { mode } : {});
    return { status: res.status, token: res.body.token as string | undefined };
  }

  async function socket(tokenValue: string): Promise<Client> {
    const client = await connect(`ws://127.0.0.1:${port}${STREAM_PATH}?token=${encodeURIComponent(tokenValue)}`);
    open.push(client);
    return client;
  }

  async function watcher(key: string, graph: string): Promise<Client> {
    const minted = await token(key, graph, 'feed');
    expect(minted.status).toBe(201);
    const client = await socket(minted.token as string);
    expect(await client.next()).toMatchObject({ type: 'auth_result', success: true });
    client.send({ type: 'subscribe', graphId: graph });
    expect(await client.nextOf('subscribed')).toMatchObject({ graphId: graph });
    return client;
  }

  /** The graph an entity is stamped with in Neo4j, or null when Neo4j does not hold it. */
  async function neo4jGraphOf(label: 'Event' | 'Arc', id: string): Promise<string | null> {
    const session = getDatabaseManager().getNeo4jSession();
    try {
      const result = await session.run(`MATCH (n:${label} {id: $id}) RETURN n.graphId AS graphId`, { id });
      return result.records.length > 0 ? (result.records[0].get('graphId') as string) : null;
    } finally {
      await session.close();
    }
  }

  async function finished(jobId: string, key: string): Promise<Record<string, unknown>> {
    const deadline = Date.now() + 30_000;
    for (;;) {
      const res = await http('GET', `/api/generate/jobs/${jobId}`, key);
      expect(res.status).toBe(200);
      if (res.body.status !== 'running') return res.body;
      if (Date.now() > deadline) throw new Error(`job ${jobId} did not finish`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  beforeAll(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cloud-live-feed-'));
    // Cloud mode: the entities in Neo4j, the per-process state under the data dir.
    setEnv('LOCAL_EXECUTION_ENABLED', 'false');
    setEnv('CLOUD_SINGLE_REPLICA_STATE', 'true');
    setEnv('LOCAL_DATA_DIR', dataDir);
    // The template writes the generated events: no model is called.
    setEnv('OPENAI_API_KEY', undefined);
    setEnv('ANTHROPIC_API_KEY', undefined);
    port = await freePort();
    setEnv('PORT', String(port));
    setEnv('HOST', '127.0.0.1');
    base = `http://127.0.0.1:${port}`;

    listenersBefore = new Map(
      ['SIGTERM', 'SIGINT'].map((signal) => [signal, new Set(process.listeners(signal as NodeJS.Signals))])
    );
    resetStreamTokenStore();

    app = new Application({ exit: (code) => exits.push(code) });
    await app.initialize();
    container = getContainer();
    // Not the local store: the suite would prove nothing there.
    expect(container.config.localExecution.enabled).toBe(false);

    graphA = (await container.graphService.createGraph({ name: 'Cloud feed A' })).id;
    graphB = (await container.graphService.createGraph({ name: 'Cloud feed B' })).id;
    graphsMade.push(graphA, graphB);

    const rateLimit = { requestsPerMinute: 1000, requestsPerHour: 10000, requestsPerDay: 100000, concurrentStreams: 8 };
    const everything: Permission[] = ['read:events', 'write:events', 'read:arcs', 'write:arcs', 'read:relationships', 'write:relationships', 'read:graphs', 'write:graphs'];
    agentKey = (await container.authService.createApiKey({ name: 'Cloud agent', permissions: everything, rateLimit })).key;
    graphAKey = (await container.authService.createApiKey({ name: 'Graph A only', permissions: everything, allowedGraphs: [graphA], rateLimit })).key;
    generateKey = (await container.authService.createApiKey({ name: 'Cloud generator', permissions: ['generate', 'read:events', 'read:graphs'], rateLimit })).key;

    await app.start();
  });

  afterEach(async () => {
    await Promise.all(open.splice(0).map((client) => client.close()));
  });

  afterAll(async () => {
    // Leave Neo4j as the other cloud suites expect it: nothing of these graphs.
    const session = getDatabaseManager().getNeo4jSession();
    try {
      await session.run('MATCH (n) WHERE n.graphId IN $ids DETACH DELETE n', { ids: graphsMade });
    } finally {
      await session.close();
    }
    // The real shutdown: closes the server and the stream handler, then the container.
    process.emit('SIGTERM');
    const deadline = Date.now() + 10_000;
    while (exits.length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    for (const [signal, before] of listenersBefore) {
      for (const listener of process.listeners(signal as NodeJS.Signals)) {
        if (!before.has(listener)) process.removeListener(signal as NodeJS.Signals, listener);
      }
    }
    resetStreamTokenStore();
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await fs.rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
    expect(exits).toEqual([0]);
  });

  describe('the feed', () => {
    it('announces a write through the API, which Neo4j holds for its graph', async () => {
      const client = await watcher(agentKey, graphA);
      const res = await http('POST', '/api/events', agentKey, graphA, {
        description: 'The harbour wall is raised',
        actor: 'Harbour League',
        target: 'The Tide',
        timestamp: '1200-03-01T00:00:00.000Z',
      });
      expect(res.status).toBe(201);
      const id = (res.body.data as { id: string }).id;

      const change = await client.nextOf('change');
      expect(change).toMatchObject({
        kind: 'entities',
        graphId: graphA,
        operation: 'create',
        entities: [{ type: 'event', id }],
        actor: { kind: 'api', name: 'Cloud agent' },
      });
      expect(String(change.summary)).toContain('The harbour wall is raised');
      expect(await neo4jGraphOf('Event', id)).toBe(graphA);
    });

    it('announces a batch once and versions it, in Neo4j', async () => {
      const client = await watcher(agentKey, graphA);
      const res = await http('POST', '/api/batch/events', agentKey, graphA, {
        graphId: graphA,
        events: [
          { description: 'First flood', actor: 'The Tide', target: 'Harbour League', timestamp: '1210-03-01T00:00:00.000Z' },
          { description: 'Second flood', actor: 'The Tide', target: 'Harbour League', timestamp: '1220-03-01T00:00:00.000Z' },
        ],
      });
      expect(res.status).toBe(201);
      const created = res.body.created as string[];

      const change = await client.nextOf('change');
      expect(change).toMatchObject({ kind: 'entities', operation: 'create', graphId: graphA, summary: 'Added 2 events in a batch' });
      expect((change.entities as Array<{ id: string }>).map((entity) => entity.id).sort()).toEqual([...created].sort());
      for (const id of created) expect(await neo4jGraphOf('Event', id)).toBe(graphA);
      const head = await container.graphRepository.checkout(graphA);
      for (const id of created) expect(head.events[id]).toBeDefined();
    });

    it('never lets a create take the place of an arc, nor loses an arc deleted and made again in one batch, in Neo4j', async () => {
      const arc = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, start_time: '1800-01-01T00:00:00.000Z', end_time: '1900-01-01T00:00:00.000Z', level: 0, ...extra });
      await http('POST', '/api/arcs', agentKey, graphA, arc('keep-me')).then((res) => expect(res.status).toBe(201));
      const before = (await container.graphRepository.checkout(graphA)).arcs['keep-me'];
      const failing = { type: 'update_event', data: { id: 'no-such-event', description: 'x' } };

      // A create naming an arc that is there is refused, and the arc is as it was.
      expect((await http('POST', '/api/arcs', agentKey, graphA, arc('keep-me', { name: 'clobbered' }))).status).toBe(400);
      expect((await http('POST', '/api/batch/transaction', agentKey, graphA, { graphId: graphA, operations: [{ type: 'create_arc', data: arc('keep-me', { name: 'clobbered' }) }] })).status).toBe(400);
      // Deleted and made again in one batch that then fails: refused before anything is written.
      const refused = await http('POST', '/api/batch/transaction', agentKey, graphA, {
        graphId: graphA,
        operations: [{ type: 'delete_arc', data: { id: 'keep-me' } }, { type: 'create_arc', data: arc('keep-me', { name: 'again' }) }, failing],
      });
      expect(refused.status).toBe(400);
      const { arcRepository } = await container.graphScopedRepositories(graphA);
      expect((await arcRepository.findById('keep-me'))?.name).toBe('keep-me');
      expect((await container.graphRepository.checkout(graphA)).arcs['keep-me']).toEqual(before);
    });

    it('versions a batch of links under the id a single link gets in Neo4j, and a transaction that removes it', async () => {
      const add = async (description: string, timestamp: string): Promise<string> => {
        const res = await http('POST', '/api/events', agentKey, graphA, { description, actor: 'A', target: 'B', timestamp });
        expect(res.status).toBe(201);
        return (res.body.data as { id: string }).id;
      };
      const cause = await add('Cause', '1250-01-01T00:00:00.000Z');
      const effect = await add('Effect', '1251-01-01T00:00:00.000Z');
      const doomed = await add('Doomed', '1252-01-01T00:00:00.000Z');
      const single = await http('POST', '/api/causal/link', agentKey, graphA, {
        causeEventId: effect,
        effectEventId: doomed,
        relationship: { type: 'direct', strength: 0.5, confidence: 0.5, evidence: 'Seen' },
      });
      expect(single.status).toBe(201);

      const client = await watcher(agentKey, graphA);
      const batch = await http('POST', '/api/batch/relationships', agentKey, graphA, {
        graphId: graphA,
        relationships: [{ cause_event_id: cause, effect_event_id: effect, evidence: 'Seen' }],
      });
      expect(batch.status).toBe(201);
      const change = await client.nextOf('change');

      const links = (): Promise<Record<string, Record<string, unknown>>> =>
        container.graphRepository.checkout(graphA).then((head) => head.relationships);
      const ofPair = (all: Record<string, Record<string, unknown>>, a: string, b: string): string[] =>
        Object.entries(all).filter(([, link]) => link.cause_event_id === a && link.effect_event_id === b).map(([id]) => id);
      const before = await links();
      // Neo4j keeps no edge id, so a link is named by its events: the single
      // route's link, and the batch's, the same way (it used to be "null").
      expect(ofPair(before, effect, doomed)).toEqual([`${effect}->${doomed}`]);
      const batchIds = ofPair(before, cause, effect);
      expect(batchIds).toEqual([`${cause}->${effect}`]);
      expect(change).toMatchObject({ operation: 'create', entities: [{ type: 'relationship', id: batchIds[0] }] });

      // A transaction removes the batch's link and the event the single link ends at.
      const tx = await http('POST', '/api/batch/transaction', agentKey, graphA, {
        graphId: graphA,
        operations: [
          { type: 'delete_relationship', data: { cause_event_id: cause, effect_event_id: effect } },
          { type: 'delete_event', data: { id: doomed } },
        ],
      });
      expect(tx.body).toMatchObject({ success: true });
      expect(tx.status).toBe(200);
      const after = await links();
      expect(ofPair(after, cause, effect)).toEqual([]);
      expect(ofPair(after, effect, doomed)).toEqual([]);
      expect(await neo4jGraphOf('Event', doomed)).toBeNull();
    });

    it("undoes only the link a failed batch made, never the user's older link between the same events", async () => {
      const add = async (description: string, timestamp: string): Promise<string> => {
        const res = await http('POST', '/api/events', agentKey, graphA, { description, actor: 'A', target: 'B', timestamp });
        expect(res.status).toBe(201);
        return (res.body.data as { id: string }).id;
      };
      const a = await add('Undo A', '1260-01-01T00:00:00.000Z');
      const b = await add('Undo B', '1261-01-01T00:00:00.000Z');
      const original = await http('POST', '/api/causal/link', agentKey, graphA, {
        causeEventId: a,
        effectEventId: b,
        relationship: { type: 'direct', strength: 0.5, confidence: 0.5, evidence: 'ORIGINAL' },
      });
      expect(original.status).toBe(201);

      const transaction = await http('POST', '/api/batch/transaction', agentKey, graphA, {
        graphId: graphA,
        atomic: true,
        operations: [
          { type: 'create_relationship', data: { cause_event_id: a, effect_event_id: b, evidence: 'FROM-TX' } },
          { type: 'create_relationship', data: { cause_event_id: a, effect_event_id: 'nope', evidence: 'FROM-TX' } },
        ],
      });
      expect(transaction.status).toBe(400);
      const aborted = await http('POST', '/api/batch/relationships', agentKey, graphA, {
        graphId: graphA,
        relationships: [
          { cause_event_id: a, effect_event_id: b, evidence: 'FROM-BATCH' },
          { cause_event_id: a, effect_event_id: 'nope', evidence: 'FROM-BATCH' },
        ],
      });
      expect(aborted.status).toBe(400);

      const session = getDatabaseManager().getNeo4jSession();
      try {
        const edges = await session.run(
          'MATCH (:Event {id: $a})-[r:CAUSES]->(:Event {id: $b}) RETURN r.evidence AS evidence',
          { a, b }
        );
        expect(edges.records.map((record) => record.get('evidence'))).toEqual(['ORIGINAL']);
      } finally {
        await session.close();
      }
      const head = await container.graphRepository.checkout(graphA);
      const between = Object.values(head.relationships).filter((link) => link.cause_event_id === a && link.effect_event_id === b);
      expect(between.map((link) => link.evidence)).toEqual(['ORIGINAL']);
    });

    // Second review: both links of a pair are named "cause->effect" in Neo4j,
    // and the undo of an unversioned batch looked them up in a map by that id,
    // so it deleted the second link twice and left the first behind.
    it('undoes both links of one pair when a link batch cannot be versioned', async () => {
      const add = async (description: string, timestamp: string): Promise<string> => {
        const res = await http('POST', '/api/events', agentKey, graphA, { description, actor: 'A', target: 'B', timestamp });
        expect(res.status).toBe(201);
        return (res.body.data as { id: string }).id;
      };
      const a = await add('Dup A', '1270-01-01T00:00:00.000Z');
      const b = await add('Dup B', '1271-01-01T00:00:00.000Z');
      const commit = vi.spyOn(container.graphRepository, 'commitChanges').mockRejectedValueOnce(new Error('version store is down'));
      let status: number;
      try {
        status = (
          await http('POST', '/api/batch/relationships', agentKey, graphA, {
            graphId: graphA,
            relationships: [
              { cause_event_id: a, effect_event_id: b, evidence: 'ONE' },
              { cause_event_id: a, effect_event_id: b, evidence: 'TWO' },
            ],
          })
        ).status;
      } finally {
        commit.mockRestore();
      }
      expect(status).toBe(500);

      const session = getDatabaseManager().getNeo4jSession();
      try {
        const edges = await session.run('MATCH (:Event {id: $a})-[r:CAUSES]->(:Event {id: $b}) RETURN r.evidence AS evidence', { a, b });
        expect(edges.records.map((record) => record.get('evidence'))).toEqual([]);
      } finally {
        await session.close();
      }
      const head = await container.graphRepository.checkout(graphA);
      expect(Object.values(head.relationships).filter((link) => link.cause_event_id === a)).toEqual([]);
    });

    it('does not deliver another graph\'s writes', async () => {
      const client = await watcher(agentKey, graphA);
      const elsewhere = await http('POST', '/api/events', agentKey, graphB, {
        description: 'In graph B', actor: 'B', target: 'B', timestamp: '1300-01-01T00:00:00.000Z',
      });
      expect(elsewhere.status).toBe(201);
      const marker = await http('POST', '/api/events', agentKey, graphA, {
        description: 'In graph A', actor: 'A', target: 'A', timestamp: '1300-01-01T00:00:00.000Z',
      });
      const change = await client.nextOf('change');
      // The first change it hears is graph A's, though graph B's was written first.
      expect(change).toMatchObject({ graphId: graphA, entities: [{ type: 'event', id: (marker.body.data as { id: string }).id }] });
    });
  });

  describe('stream tokens', () => {
    it('are minted for a graph the key may use and refused for one it may not', async () => {
      expect((await token(graphAKey, graphA)).status).toBe(201);
      expect((await token(graphAKey, graphA, 'feed')).status).toBe(201);
      expect((await token(graphAKey, graphB)).status).toBe(403);
      expect((await token(graphAKey, graphB, 'feed')).status).toBe(403);
    });

    it('are accepted once, and write into the graph they were minted for', async () => {
      const minted = await token(graphAKey, graphA);
      const client = await socket(minted.token as string);
      expect(await client.next()).toMatchObject({ type: 'auth_result', success: true });

      client.send({
        type: 'event',
        requestId: 'over-the-socket',
        // A graph named in the message is not the scope; the token's graph is.
        data: { description: 'Written over the stream', actor: 'Stream', target: 'Graph', timestamp: '1400-01-01T00:00:00.000Z', graphId: graphB },
      });
      const ack = await client.nextOf('ack');
      expect(ack).toMatchObject({ requestId: 'over-the-socket', success: true });
      const id = ack.entityId as string;
      expect(await neo4jGraphOf('Event', id)).toBe(graphA);
      const { eventRepository } = await container.graphScopedRepositories(graphB);
      expect(await eventRepository.findById(id)).toBeNull();
      // Versioned into its graph too.
      expect((await container.graphRepository.checkout(graphA)).events[id]).toBeDefined();

      // The same token a second time is refused, at the upgrade.
      await expect(socket(minted.token as string)).rejects.toThrow('upgrade refused: 409');
    });

    it('let a feed socket watch only the graphs its key may read', async () => {
      const client = await watcher(graphAKey, graphA);
      client.send({ type: 'subscribe', graphId: graphB });
      expect(await client.nextOf('error')).toMatchObject({ graphId: graphB });
    });
  });

  describe('generation jobs', () => {
    it('run to completion, and the graph they wrote is read back from Neo4j', async () => {
      const start = await http('POST', '/api/generate/timeline', generateKey, undefined, {
        premise: 'What if the tide never turned?',
        divergencePoint: 'The wall holds in 1200',
        eventCount: 4,
        graphName: 'Cloud tide',
      });
      expect(start.status).toBe(202);
      expect(start.body).toMatchObject({ kind: 'timeline', status: 'running' });

      const done = await finished(start.body.id as string, generateKey);
      expect(done).toMatchObject({ status: 'completed', progress: 100, source: 'template' });
      const graphId = done.graphId as string;
      graphsMade.push(graphId);
      expect((done.result as { graphName?: string }).graphName).toBe('Cloud tide');
      const written = done.written as { events: number };
      expect(written.events).toBeGreaterThan(0);

      // Its result is readable: through the API, out of Neo4j.
      const events = await http('GET', '/api/events', generateKey, graphId);
      expect(events.status).toBe(200);
      const listed = events.body.data as Array<{ id: string }>;
      expect(listed).toHaveLength(written.events);
      for (const event of listed) expect(await neo4jGraphOf('Event', event.id)).toBe(graphId);
      // And versioned, so it exports.
      expect(Object.keys((await container.graphRepository.checkout(graphId)).events)).toHaveLength(written.events);
    });

    it('announce what they write on the feed', async () => {
      const client = await watcher(agentKey, graphA);
      const start = await http('POST', '/api/generate/expand', generateKey, graphA, { eventCount: 2 });
      expect(start.status).toBe(202);
      const done = await finished(start.body.id as string, generateKey);
      expect(done.status).toBe('completed');

      const heard: Array<{ type: string; id: string }> = [];
      while (heard.filter((entity) => entity.type === 'event').length < 2) {
        const change = await client.nextOf('change');
        if (change.kind === 'entities' && change.operation === 'create') heard.push(...(change.entities as Array<{ type: string; id: string }>));
      }
      for (const entity of heard.filter((e) => e.type === 'event')) expect(await neo4jGraphOf('Event', entity.id)).toBe(graphA);
    });
  });
});
