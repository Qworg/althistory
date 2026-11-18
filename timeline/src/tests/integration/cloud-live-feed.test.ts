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
import { ImportService } from '@/services/ImportService';
import { getDatabaseManager } from '@/utils/database';
import { runCausalLinkIdMigration, type CausalLinkIdMigrationResult } from '@/services/CausalLinkIdMigration';
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
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
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
    // A graph copy runs apoc over every node and relationship and then versions the copy: more than the default 2 s request budget on a cold database.
    setEnv('QUERY_TIMEOUT_MS', '20000');
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

    it('takes a create of an arc id another graph holds, in both doors, and leaves that graph\'s arc alone (#35)', async () => {
      const arc = (id: string, name: string) => ({ id, name, start_time: '1800-01-01T00:00:00.000Z', end_time: '1900-01-01T00:00:00.000Z', level: 0 });
      // An id is unique within a graph: a branch holds its parent's ids, so graph B may take what graph A has.
      expect((await http('POST', '/api/arcs', agentKey, graphA, arc('held-elsewhere', 'in A'))).status).toBe(201);
      expect((await http('POST', '/api/arcs', agentKey, graphB, arc('held-elsewhere', 'in B'))).status).toBe(201);
      expect((await http('POST', '/api/arcs', agentKey, graphA, arc('held-by-batch', 'in A'))).status).toBe(201);
      const batch = await http('POST', '/api/batch/transaction', agentKey, graphB, { graphId: graphB, operations: [{ type: 'create_arc', data: arc('held-by-batch', 'in B') }] });
      expect(batch.status).toBe(200);
      const inA = await container.graphScopedRepositories(graphA);
      const inB = await container.graphScopedRepositories(graphB);
      expect((await inA.arcRepository.findById('held-elsewhere'))?.name).toBe('in A');
      expect((await inB.arcRepository.findById('held-elsewhere'))?.name).toBe('in B');
      expect((await inA.arcRepository.findById('held-by-batch'))?.name).toBe('in A');
      expect((await inB.arcRepository.findById('held-by-batch'))?.name).toBe('in B');
      // The same graph still refuses its own id, by id, without the store's wording.
      const again = await http('POST', '/api/arcs', agentKey, graphB, arc('held-elsewhere', 'twice'));
      expect(again.status).toBe(400);
      expect(JSON.stringify(again.body)).toContain('held-elsewhere');
      expect(JSON.stringify(again.body)).not.toMatch(/Neo4jError|Node\(\d+\)/);
    });

    it('copies a graph under the source\'s ids, with a version of its own that rollback, export and a branch read (#35)', async () => {
      const made = await http('POST', '/api/graphs', agentKey, undefined, { name: 'Copy source' });
      const source = ((made.body.data ?? made.body) as { id: string }).id;
      graphsMade.push(source);
      const arc = (await http('POST', '/api/arcs', agentKey, source, { name: 'The Age', start_time: '1800-01-01T00:00:00.000Z', end_time: '1900-01-01T00:00:00.000Z', level: 0 })).body.data as { id: string };
      const event = (id: string, description: string, timestamp: string) =>
        http('POST', '/api/events', agentKey, source, { id, description, actor: 'A', target: 'B', timestamp }).then((res) => (res.body.data as { id: string }).id);
      const first = await event('copy-event-1', 'First', '1810-01-01T00:00:00.000Z');
      const second = await event('copy-event-2', 'Second', '1820-01-01T00:00:00.000Z');
      expect((await http('POST', '/api/causal/link', agentKey, source, { causeEventId: first, effectEventId: second, relationship: { type: 'direct', strength: 0.5, confidence: 0.5, evidence: 'Seen' } })).status).toBe(201);

      const copied = await http('POST', '/api/graphs/copy', agentKey, undefined, { sourceGraphId: source, targetName: 'Copy target' });
      expect(copied.status).toBe(201);
      const target = ((copied.body.data as { id: string }).id);
      graphsMade.push(target);

      // The copy's entities answer to the source's ids.
      expect((await http('GET', `/api/events/${first}`, agentKey, target)).status).toBe(200);
      expect((await http('GET', `/api/arcs/${arc.id}`, agentKey, target)).status).toBe(200);
      expect((await http('PUT', `/api/events/${first}`, agentKey, target, { description: 'Edited in the copy' })).status).toBe(200);
      expect((await http('PUT', `/api/arcs/${arc.id}`, agentKey, target, { name: 'Renamed in the copy' })).status).toBe(200);
      expect(((await http('GET', `/api/events/${first}`, agentKey, source)).body.data as { description: string }).description).toBe('First');
      expect(((await http('GET', `/api/arcs/${arc.id}`, agentKey, source)).body.data as { name: string }).name).toBe('The Age');

      // No marker of the copy is left on its nodes.
      const session = getDatabaseManager().getNeo4jSession();
      try {
        const marked = await session.run('MATCH (n) WHERE n.graphId = $target AND n._sourceNodeId IS NOT NULL RETURN count(n) AS marked', { target });
        expect(Number(marked.records[0]?.get('marked'))).toBe(0);
      } finally {
        await session.close();
      }

      // It has a version: the copy as it was made, which export and a branch read.
      const head = await container.graphRepository.checkout(target);
      expect(Object.keys(head.events).sort()).toEqual([first, second].sort());
      expect(Object.keys(head.arcs)).toEqual([arc.id]);
      expect(Object.keys(head.relationships)).toHaveLength(1);
      const exported = await container.exportService.exportGraph({ graphId: target, scope: 'full', includeProvenance: false });
      expect(exported.export.data.events.map((e: { id: string }) => e.id).sort()).toEqual([first, second].sort());
      expect(exported.export.data.arcs.map((a: { id: string }) => a.id)).toEqual([arc.id]);
      const branched = await container.graphService.branchGraph(target, { name: 'Branch of the copy' } as never);
      graphsMade.push(branched.id);
      const { eventRepository } = await container.graphScopedRepositories(branched.id);
      expect((await eventRepository.findAll()).map((e) => e.id).sort()).toEqual([first, second].sort());

      // And the copy's entities can be deleted by those ids, leaving the source's.
      expect((await http('DELETE', `/api/events/${second}`, agentKey, target)).status).toBe(200);
      expect((await http('DELETE', `/api/arcs/${arc.id}`, agentKey, target)).status).toBe(200);
      expect((await http('GET', `/api/events/${second}`, agentKey, source)).status).toBe(200);
      expect((await http('GET', `/api/arcs/${arc.id}`, agentKey, source)).status).toBe(200);
    });

    /**
     * A graph written the way an import writes one: the version head first, with the fields only the
     * version store keeps (`sourceRef`, `parent_arc_id`, a link at 0/0, a link to another graph's
     * event), then the live store rebuilt from it.
     */
    async function importedSource(name: string): Promise<string> {
      const graphId = (await container.graphService.createGraph({ name })).id;
      graphsMade.push(graphId);
      const event = (id: string, description: string, year: number, extra: Record<string, unknown> = {}) => ({
        type: 'event' as const, id, data: { id, description, actor: 'A', target: 'B', timestamp: `${year}-01-01T00:00:00.000Z`, metadata: {}, ...extra },
      });
      const arc = (id: string, label: string, level: number, parent: string | null, from: number, to: number) => ({
        type: 'arc' as const, id, data: { id, name: label, description: label, start_time: `${from}-01-01T00:00:00.000Z`, end_time: `${to}-01-01T00:00:00.000Z`, level, parent_arc_id: parent, metadata: {}, sourceRef: `doc:${id}` },
      });
      const link = (id: string, cause: string, effect: string, weight: number, extra: Record<string, unknown> = {}) => ({
        type: 'relationship' as const, id, data: { id, cause_event_id: cause, effect_event_id: effect, weight, confidence: weight, evidence: 'Seen', relationship_type: 'direct', ...extra },
      });
      await container.graphRepository.commitChanges(
        graphId,
        {
          added: [
            arc('imp-arc-outer', 'Outer', 0, null, 1700, 1900),
            arc('imp-arc-inner', 'Inner', 1, 'imp-arc-outer', 1750, 1850),
            event('imp-ev-1', 'First', 1760, { sourceRef: 'wiki:First' }),
            event('imp-ev-2', 'Second', 1770),
            event('imp-ev-3', 'Third', 1880),
            link('imp-link-zero', 'imp-ev-1', 'imp-ev-2', 0, { sourceRef: 'wiki:Link' }),
            link('imp-link-plain', 'imp-ev-2', 'imp-ev-3', 0.6),
            link('imp-link-cross', 'elsewhere-ev', 'imp-ev-1', 0.5, { causeGraphId: 'some-other-graph' }),
          ],
          modified: [],
          deleted: [],
        },
        'import',
        'Imported'
      );
      await container.liveStoreSyncService.materialize(graphId, 'import');
      return graphId;
    }

    /** What an export holds of a graph, in a fixed order. */
    async function exportedContents(graphId: string): Promise<{ events: Array<Record<string, unknown>>; arcs: Array<Record<string, unknown>>; links: Array<Record<string, unknown>> }> {
      const { export: doc } = await container.exportService.exportGraph({ graphId, scope: 'full', includeProvenance: false });
      const byId = <T extends { id: string }>(rows: T[]): T[] => [...rows].sort((a, b) => a.id.localeCompare(b.id));
      return {
        events: byId(doc.data.events) as unknown as Array<Record<string, unknown>>,
        arcs: byId(doc.data.arcs) as unknown as Array<Record<string, unknown>>,
        links: byId(doc.data.causalRelationships) as unknown as Array<Record<string, unknown>>,
      };
    }

    async function liveContents(graphId: string): Promise<unknown> {
      const { eventRepository, arcRepository, causalService } = await container.graphScopedRepositories(graphId);
      const byId = <T extends { id: string }>(rows: T[]): T[] => [...rows].sort((a, b) => a.id.localeCompare(b.id));
      return JSON.parse(JSON.stringify({ events: byId(await eventRepository.findAll()), arcs: byId(await arcRepository.findAll()), links: byId(await causalService.getAllRelationships()) }));
    }

    async function markersIn(graphId: string): Promise<number> {
      const session = getDatabaseManager().getNeo4jSession();
      try {
        const rows = await session.run('MATCH (n) WHERE n.graphId = $graphId AND n._sourceNodeId IS NOT NULL RETURN count(n) AS marked', { graphId });
        return Number(rows.records[0]?.get('marked'));
      } finally {
        await session.close();
      }
    }

    async function copyOf(source: string, name: string, body: Record<string, unknown> = {}): Promise<string> {
      const res = await http('POST', '/api/graphs/copy', agentKey, undefined, { sourceGraphId: source, targetName: name, ...body });
      expect(res.status).toBe(201);
      const data = res.body.data as { id: string; status: string };
      expect((data as { status: string; error_message?: string }).error_message ?? data.status).toBe('completed');
      graphsMade.push(data.id);
      return data.id;
    }

    it('records a copy as the source’s head, so it exports as a branch does, rolls back unchanged and merges without conflicts (#35)', async () => {
      const source = await importedSource('Imported source');
      const copy = await copyOf(source, 'Imported copy');
      const branch = (await container.graphService.branchGraph(source, { name: 'Imported branch' } as never)).id;
      graphsMade.push(branch);

      const fromCopy = await exportedContents(copy);
      expect(fromCopy).toEqual(await exportedContents(branch));
      expect(fromCopy.events.find((e) => e.id === 'imp-ev-1')).toMatchObject({ sourceRef: 'wiki:First' });
      expect(fromCopy.links.find((l) => l.id === 'imp-link-zero')).toMatchObject({ weight: 0, confidence: 0, sourceRef: 'wiki:Link' });
      expect(fromCopy.links.find((l) => l.id === 'imp-link-cross')?.causeGraphId).toBe('some-other-graph');
      expect(fromCopy.arcs.find((a) => a.id === 'imp-arc-inner')?.parent_arc_id).toBe('imp-arc-outer');

      // Rolling back an unedited copy changes nothing of what it holds.
      const liveBefore = await liveContents(copy);
      const version = (await container.graphRepository.getLatestVersion(copy))?.version as number;
      expect((await http('POST', `/api/graphs/${copy}/rollback/${version}`, agentKey, copy)).status).toBe(200);
      expect(await liveContents(copy)).toEqual(liveBefore);
      expect(await exportedContents(copy)).toEqual(fromCopy);

      // And an unedited copy has nothing to conflict with.
      const merged = await http('POST', `/api/graphs/${source}/merge`, agentKey, source, { sourceGraphId: copy, conflictResolution: 'manual', dryRun: true });
      expect(merged.status).toBe(200);
      expect(merged.body.conflicts).toEqual([]);
    });

    it('copies only the time range it names, keeps ids, and leaves no marker (#35)', async () => {
      const source = await importedSource('Range source');
      const copy = await copyOf(source, 'Range copy', { copyType: 'time_range', timeRange: { start: '1755-01-01T00:00:00.000Z', end: '1775-01-01T00:00:00.000Z' } });
      const { eventRepository, arcRepository } = await container.graphScopedRepositories(copy);
      expect((await eventRepository.findAll()).map((e) => e.id).sort()).toEqual(['imp-ev-1', 'imp-ev-2']);
      // The arcs that overlap the range: the outer and the inner arc both do.
      expect((await arcRepository.findAll()).map((a) => a.id).sort()).toEqual(['imp-arc-inner', 'imp-arc-outer']);
      const head = await container.graphRepository.checkout(copy);
      expect(Object.keys(head.events).sort()).toEqual(['imp-ev-1', 'imp-ev-2']);
      expect(Object.keys(head.relationships)).toEqual(['imp-link-zero']);
      expect(head.events['imp-ev-1']).toMatchObject({ sourceRef: 'wiki:First' });
      expect(await markersIn(copy)).toBe(0);
      // The source still holds all three.
      const sourceEvents = (await container.graphScopedRepositories(source)).eventRepository;
      expect((await sourceEvents.findAll()).map((e) => e.id).sort()).toEqual(['imp-ev-1', 'imp-ev-2', 'imp-ev-3']);
    });

    it('copies only the events a filter names, keeps ids, and leaves no marker (#35)', async () => {
      const source = await importedSource('Filter source');
      await (await container.graphScopedRepositories(source)).eventRepository.update('imp-ev-3', { actor: 'Someone else' });
      const copy = await copyOf(source, 'Filter copy', { copyType: 'filtered', filter: { actors: ['A'] } });
      const { eventRepository, arcRepository } = await container.graphScopedRepositories(copy);
      expect((await eventRepository.findAll()).map((e) => e.id).sort()).toEqual(['imp-ev-1', 'imp-ev-2']);
      expect(await arcRepository.findAll()).toEqual([]);
      const head = await container.graphRepository.checkout(copy);
      expect(Object.keys(head.events).sort()).toEqual(['imp-ev-1', 'imp-ev-2']);
      expect(Object.keys(head.arcs)).toEqual([]);
      expect(Object.keys(head.relationships)).toEqual(['imp-link-zero']);
      expect(await markersIn(copy)).toBe(0);
    });

    it('leaves no graph behind when a copy cannot be versioned, whatever it copies, and answers with an error and no id (#35)', async () => {
      const source = await importedSource('Unversionable source');
      const holding = async (): Promise<string[]> => {
        const session = getDatabaseManager().getNeo4jSession();
        try {
          const rows = await session.run('MATCH (n) WHERE n.graphId IS NOT NULL RETURN DISTINCT n.graphId AS graphId');
          return rows.records.map((r) => String(r.get('graphId'))).sort();
        } finally {
          await session.close();
        }
      };
      for (const body of [
        {},
        { copyType: 'time_range', timeRange: { start: '1755-01-01T00:00:00.000Z', end: '1775-01-01T00:00:00.000Z' } },
        { copyType: 'filtered', filter: { actors: ['A'] } },
      ]) {
        const spy = vi.spyOn(container.graphRepository, 'commitChanges').mockRejectedValueOnce(new Error('the version store is down'));
        const before = (await container.graphService.listGraphs({ limit: 1000 })).graphs.map((g) => g.id).sort();
        const holdingBefore = await holding();
        const res = await http('POST', '/api/graphs/copy', agentKey, undefined, { sourceGraphId: source, targetName: 'Unversionable copy', ...body });
        spy.mockRestore();
        // An error, with no graph id to chase, and nothing written before the version was refused.
        expect(res.status).toBe(500);
        expect(res.body.data).toBeUndefined();
        expect((await container.graphService.listGraphs({ limit: 1000 })).graphs.map((g) => g.id).sort()).toEqual(before);
        expect(await holding()).toEqual(holdingBefore);
      }
    });

    it('copies an empty graph as an empty graph that can be used (#35)', async () => {
      const source = (await container.graphService.createGraph({ name: 'Empty source' })).id;
      graphsMade.push(source);
      const copy = await copyOf(source, 'Empty copy');
      expect((await http('GET', `/api/graphs/${copy}`, agentKey, copy)).status).toBe(200);
      expect((await http('POST', '/api/events', agentKey, copy, { description: 'First', actor: 'A', target: 'B', timestamp: '1800-01-01T00:00:00.000Z' })).status).toBe(201);
    });

    it('makes a filtered copy whose export imports, because an arc whose parent was left out is a top-level arc (#35)', async () => {
      const source = await importedSource('Hierarchy source');
      const copy = await copyOf(source, 'Hierarchy copy', { copyType: 'filtered', filter: { actors: ['A'], arcLevels: [1] } });

      const head = await container.graphRepository.checkout(copy);
      expect(head.arcs['imp-arc-inner']).toMatchObject({ parent_arc_id: null, level: 0 });
      const live = await (await container.graphScopedRepositories(copy)).arcRepository.findById('imp-arc-inner');
      expect(live?.level).toBe(0);
      expect(live?.metadata?.parentArcId).toBeUndefined();

      const { export: doc } = await container.exportService.exportGraph({ graphId: copy, scope: 'full', includeProvenance: false });
      const importer = new ImportService({ dataDir });
      const imported = await importer.executeImport(doc, { mode: 'create-new', conflictResolution: 'skip' });
      graphsMade.push(imported.graphId);
      expect(imported.errors).toEqual([]);
      expect(imported.success).toBe(true);
    });

    it('versions a source that has live nodes and no version, so an edit and a rollback of the copy keep its nodes (#35)', async () => {
      const source = (await container.graphService.createGraph({ name: 'Unversioned source' })).id;
      graphsMade.push(source);
      // Live nodes that were never versioned: what data adopted at startup looks like.
      const repos = await container.graphScopedRepositories(source);
      const first = await repos.eventRepository.create({ description: 'Live one', actor: 'A', target: 'B', timestamp: new Date(Date.UTC(1810, 0, 1)) });
      const second = await repos.eventRepository.create({ description: 'Live two', actor: 'A', target: 'B', timestamp: new Date(Date.UTC(1820, 0, 1)) });
      expect(await container.graphRepository.getLatestVersion(source)).toBeNull();

      const copy = await copyOf(source, 'Unversioned copy');
      expect(Object.keys((await container.graphRepository.checkout(copy)).events).sort()).toEqual([first.id, second.id].sort());

      expect((await http('PUT', `/api/events/${first.id}`, agentKey, copy, { description: 'Edited' })).status).toBe(200);
      const latest = (await container.graphRepository.getLatestVersion(copy))?.version as number;
      expect((await http('POST', `/api/graphs/${copy}/rollback/${latest}`, agentKey, copy)).status).toBe(200);
      const { eventRepository } = await container.graphScopedRepositories(copy);
      expect((await eventRepository.findAll()).map((e) => e.id).sort()).toEqual([first.id, second.id].sort());
    });

    it('makes the version and the live copy agree on a re-placed arc when the source was never versioned, so the export imports and a rollback leaves no dangling parent (#35)', async () => {
      const source = (await container.graphService.createGraph({ name: 'Unversioned hierarchy source' })).id;
      graphsMade.push(source);
      const { arcRepository, eventRepository } = await container.graphScopedRepositories(source);
      const arc = (id: string, level: number, parent: string | null, from: number, to: number) =>
        arcRepository.create(
          { id, name: id, description: id, start_time: new Date(Date.UTC(from, 0, 1)), end_time: new Date(Date.UTC(to, 0, 1)), level, metadata: parent ? { parentArcId: parent } : {} },
          { validated: true }
        );
      await arc('hier-r', 0, null, 1700, 1900);
      await arc('hier-a', 1, 'hier-r', 1710, 1890);
      await arc('hier-b', 2, 'hier-a', 1720, 1880);
      await arc('hier-c', 3, 'hier-b', 1730, 1870);
      await eventRepository.create({ id: 'hier-w1', description: 'W1', actor: 'A', target: 'B', timestamp: new Date(Date.UTC(1800, 0, 1)) });
      expect(await container.graphRepository.getLatestVersion(source)).toBeNull();

      // Levels 2 and 3 only: B's parent A was left out.
      const copy = await copyOf(source, 'Unversioned hierarchy copy', { copyType: 'filtered', filter: { arcLevels: [2, 3] } });

      const danglingIn = async (): Promise<string[]> => {
        const { arcRepository: arcs } = await container.graphScopedRepositories(copy);
        const live = await arcs.findAll();
        const ids = new Set(live.map((a) => a.id));
        return live.filter((a) => typeof a.metadata?.parentArcId === 'string' && !ids.has(a.metadata.parentArcId as string)).map((a) => a.id);
      };
      const head = await container.graphRepository.checkout(copy);
      expect(head.arcs['hier-b']?.level).toBe(0);
      expect(head.arcs['hier-b']?.parent_arc_id ?? null).toBeNull();
      expect(head.arcs['hier-b']?.metadata).not.toHaveProperty('parentArcId');
      expect(head.arcs['hier-c']).toMatchObject({ parent_arc_id: 'hier-b', level: 1 });
      expect(await danglingIn()).toEqual([]);

      const { export: doc } = await container.exportService.exportGraph({ graphId: copy, scope: 'full', includeProvenance: false });
      const imported = await new ImportService({ dataDir }).executeImport(doc, { mode: 'create-new', conflictResolution: 'skip' });
      graphsMade.push(imported.graphId);
      expect(imported.errors).toEqual([]);
      expect(imported.success).toBe(true);

      const version = (await container.graphRepository.getLatestVersion(copy))?.version as number;
      expect((await http('POST', `/api/graphs/${copy}/rollback/${version}`, agentKey, copy)).status).toBe(200);
      expect(await danglingIn()).toEqual([]);
      const { arcRepository: after } = await container.graphScopedRepositories(copy);
      expect((await after.findById('hier-b'))?.metadata?.parentArcId).toBeUndefined();
    });

    it('builds the copy’s live store from its version when the source’s head holds entities its live store does not (#35)', async () => {
      const source = (await container.graphService.createGraph({ name: 'Head-only source' })).id;
      graphsMade.push(source);
      await container.graphRepository.commitChanges(
        source,
        {
          added: [
            { type: 'event', id: 'head-ev-1', data: { id: 'head-ev-1', description: 'Only in the head', actor: 'A', target: 'B', timestamp: '1800-01-01T00:00:00.000Z', metadata: {} } },
            { type: 'event', id: 'head-ev-2', data: { id: 'head-ev-2', description: 'Also only there', actor: 'A', target: 'B', timestamp: '1801-01-01T00:00:00.000Z', metadata: {} } },
          ],
          modified: [],
          deleted: [],
        },
        'import',
        'Imported'
      );
      // Its live store was never built.
      expect(await (await container.graphScopedRepositories(source)).eventRepository.findAll()).toEqual([]);

      const copy = await copyOf(source, 'Head-only copy');

      const { eventRepository } = await container.graphScopedRepositories(copy);
      expect((await eventRepository.findAll()).map((e) => e.id).sort()).toEqual(['head-ev-1', 'head-ev-2']);
      expect(Object.keys((await container.graphRepository.checkout(copy)).events).sort()).toEqual(['head-ev-1', 'head-ev-2']);
    });

    it('copies an event and an arc that share an id, in a time range and by a filter (#35)', async () => {
      const source = (await container.graphService.createGraph({ name: 'Shared id source' })).id;
      graphsMade.push(source);
      await container.graphRepository.commitChanges(
        source,
        {
          added: [
            { type: 'event', id: 'W2', data: { id: 'W2', description: 'An event named W2', actor: 'A', target: 'B', timestamp: '1760-01-01T00:00:00.000Z', metadata: {} } },
            { type: 'arc', id: 'W2', data: { id: 'W2', name: 'An arc named W2', description: 'W2', start_time: '1750-01-01T00:00:00.000Z', end_time: '1850-01-01T00:00:00.000Z', level: 1, parent_arc_id: null, metadata: {} } },
          ],
          modified: [],
          deleted: [],
        },
        'import',
        'Imported'
      );
      await container.liveStoreSyncService.materialize(source, 'import');

      for (const body of [
        { copyType: 'time_range', timeRange: { start: '1755-01-01T00:00:00.000Z', end: '1775-01-01T00:00:00.000Z' } },
        { copyType: 'filtered', filter: { actors: ['A'], arcLevels: [1] } },
      ]) {
        const copy = await copyOf(source, `Shared id copy ${body.copyType}`, body);
        const { eventRepository, arcRepository } = await container.graphScopedRepositories(copy);
        expect((await eventRepository.findAll()).map((e) => e.id)).toEqual(['W2']);
        expect((await arcRepository.findAll()).map((a) => a.id)).toEqual(['W2']);
        const head = await container.graphRepository.checkout(copy);
        expect(Object.keys(head.events)).toEqual(['W2']);
        expect(Object.keys(head.arcs)).toEqual(['W2']);
      }
    });

    it('re-places an arc whose live metadata is stored as an empty string (#35)', async () => {
      const source = await importedSource('Empty metadata source');
      const session = getDatabaseManager().getNeo4jSession();
      try {
        await session.run("MATCH (a:Arc {graphId: $source, id: 'imp-arc-inner'}) SET a.metadata = ''", { source });
      } finally {
        await session.close();
      }
      const copy = await copyOf(source, 'Empty metadata copy', { copyType: 'filtered', filter: { actors: ['A'], arcLevels: [1] } });
      const placed = await (await container.graphScopedRepositories(copy)).arcRepository.findById('imp-arc-inner');
      expect(placed?.level).toBe(0);
    });

    /** A graph whose version head is written and whose live store is left as the caller makes it. */
    async function headOnlySource(name: string, arcs: string[] = []): Promise<string> {
      const graphId = (await container.graphService.createGraph({ name })).id;
      graphsMade.push(graphId);
      const added = [
        { type: 'event' as const, id: 'ho-ev-1', data: { id: 'ho-ev-1', description: 'One', actor: 'A', target: 'B', timestamp: '1800-01-01T00:00:00.000Z', metadata: {} } },
        { type: 'event' as const, id: 'ho-ev-2', data: { id: 'ho-ev-2', description: 'Two', actor: 'A', target: 'B', timestamp: '1801-01-01T00:00:00.000Z', metadata: {} } },
        ...arcs.map((id, i) => ({
          type: 'arc' as const,
          id,
          data: { id, name: id, description: id, start_time: `${1700 + i * 10}-01-01T00:00:00.000Z`, end_time: `${1705 + i * 10}-01-01T00:00:00.000Z`, level: 0, parent_arc_id: null, metadata: {} },
        })),
      ];
      await container.graphRepository.commitChanges(graphId, { added, modified: [], deleted: [] }, 'import', 'Imported');
      return graphId;
    }

    /** The ids a graph's version and its live store hold, by label. */
    async function idsByLabel(graphId: string): Promise<{ head: { events: string[]; arcs: string[] }; live: { events: string[]; arcs: string[] } }> {
      const head = await container.graphRepository.checkout(graphId);
      const { eventRepository, arcRepository } = await container.graphScopedRepositories(graphId);
      return {
        head: { events: Object.keys(head.events).sort(), arcs: Object.keys(head.arcs).sort() },
        live: { events: (await eventRepository.findAll()).map((e) => e.id).sort(), arcs: (await arcRepository.findAll()).map((a) => a.id).sort() },
      };
    }

    it('rebuilds the copy’s live store from its version when the source’s live store holds only a pressure (#35)', async () => {
      const source = await headOnlySource('Pressure-only source');
      const session = getDatabaseManager().getNeo4jSession();
      try {
        await session.run("CREATE (:InferredPressure {id: 'pressure-only', graphId: $source, description: 'p', confidence_score: 0.5, pressure_type: 'economic'})", { source });
      } finally {
        await session.close();
      }

      const copy = await copyOf(source, 'Pressure-only copy');

      const { head, live } = await idsByLabel(copy);
      expect(head.events).toEqual(['ho-ev-1', 'ho-ev-2']);
      expect(live).toEqual(head);
    });

    it('rebuilds the copy’s live store from its version when the source is missing some arcs live (#35)', async () => {
      const source = await headOnlySource('Missing-arcs source', ['ho-arc-1', 'ho-arc-2', 'ho-arc-3']);
      await container.liveStoreSyncService.materialize(source, 'import');
      const session = getDatabaseManager().getNeo4jSession();
      try {
        await session.run("MATCH (a:Arc {graphId: $source}) WHERE a.id IN ['ho-arc-2', 'ho-arc-3'] DETACH DELETE a", { source });
      } finally {
        await session.close();
      }
      expect((await idsByLabel(source)).live.arcs).toEqual(['ho-arc-1']);

      const copy = await copyOf(source, 'Missing-arcs copy');

      const { head, live } = await idsByLabel(copy);
      expect(head.arcs).toEqual(['ho-arc-1', 'ho-arc-2', 'ho-arc-3']);
      expect(live).toEqual(head);
    });

    it('discards the copy when its live store cannot be built from its version (#35)', async () => {
      const source = await headOnlySource('Unbuildable source');
      const spy = vi.spyOn(container.liveStoreSyncService, 'materialize').mockRejectedValueOnce(new Error('the live store is down'));
      const before = (await container.graphService.listGraphs({ limit: 1000 })).graphs.map((g) => g.id).sort();

      const res = await http('POST', '/api/graphs/copy', agentKey, undefined, { sourceGraphId: source, targetName: 'Unbuildable copy' });
      spy.mockRestore();

      expect(res.status).toBe(500);
      expect(res.body.data).toBeUndefined();
      expect((await container.graphService.listGraphs({ limit: 1000 })).graphs.map((g) => g.id).sort()).toEqual(before);
    });

    it('keeps an event and an arc that share an id apart in a copy’s version and its live store, on both paths (#35)', async () => {
      const bodies = [
        { copyType: 'time_range', timeRange: { start: '1755-01-01T00:00:00.000Z', end: '1775-01-01T00:00:00.000Z' } },
        { copyType: 'filtered', filter: { actors: ['A'], arcLevels: [1] } },
      ];

      // The head path: the source has a version.
      const versioned = (await container.graphService.createGraph({ name: 'Shared id, versioned' })).id;
      graphsMade.push(versioned);
      await container.graphRepository.commitChanges(
        versioned,
        {
          added: [
            { type: 'event', id: 'W2', data: { id: 'W2', description: 'An event named W2', actor: 'A', target: 'B', timestamp: '1760-01-01T00:00:00.000Z', metadata: {} } },
            { type: 'arc', id: 'W2', data: { id: 'W2', name: 'An arc named W2', description: 'W2', start_time: '1750-01-01T00:00:00.000Z', end_time: '1850-01-01T00:00:00.000Z', level: 1, parent_arc_id: null, metadata: {} } },
          ],
          modified: [],
          deleted: [],
        },
        'import',
        'Imported'
      );
      await container.liveStoreSyncService.materialize(versioned, 'import');

      // The no-head path: the source has live nodes only.
      const unversioned = (await container.graphService.createGraph({ name: 'Shared id, unversioned' })).id;
      graphsMade.push(unversioned);
      const live = await container.graphScopedRepositories(unversioned);
      await live.eventRepository.create({ id: 'W2', description: 'An event named W2', actor: 'A', target: 'B', timestamp: new Date(Date.UTC(1760, 0, 1)) });
      await live.arcRepository.create(
        { id: 'W2', name: 'An arc named W2', description: 'W2', start_time: new Date(Date.UTC(1750, 0, 1)), end_time: new Date(Date.UTC(1850, 0, 1)), level: 1 },
        { validated: true }
      );
      expect(await container.graphRepository.getLatestVersion(unversioned)).toBeNull();

      for (const source of [versioned, unversioned]) {
        for (const body of bodies) {
          const copy = await copyOf(source, `Shared id copy ${body.copyType}`, body);
          const { head, live: held } = await idsByLabel(copy);
          expect(head).toEqual({ events: ['W2'], arcs: ['W2'] });
          expect(held).toEqual(head);
        }
      }
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
      // Each link carries an id of its own in Neo4j, the single route's and
      // the batch's alike; it is not the pair of its events (#30).
      const [singleId] = ofPair(before, effect, doomed);
      expect(singleId).toMatch(/^link_/);
      const batchIds = ofPair(before, cause, effect);
      expect(batchIds).toHaveLength(1);
      expect(batchIds[0]).toMatch(/^link_/);
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

    describe('links between the same pair of events (#30)', () => {
      const addEvent = async (description: string, timestamp: string): Promise<string> => {
        const res = await http('POST', '/api/events', agentKey, graphA, { description, actor: 'A', target: 'B', timestamp });
        expect(res.status).toBe(201);
        return (res.body.data as { id: string }).id;
      };
      const link = (cause: string, effect: string, evidence: string): Promise<{ status: number; body: Record<string, unknown> }> =>
        http('POST', '/api/causal/link', agentKey, graphA, {
          causeEventId: cause,
          effectEventId: effect,
          relationship: { type: 'direct', strength: 0.5, confidence: 0.5, evidence },
        });
      const headLinks = async (cause: string, effect: string): Promise<Array<[string, Record<string, unknown>]>> => {
        const head = await container.graphRepository.checkout(graphA);
        return Object.entries(head.relationships).filter(([, l]) => l.cause_event_id === cause && l.effect_event_id === effect);
      };
      const neo4jLinks = async (cause: string, effect: string): Promise<Array<{ id: unknown; evidence: unknown }>> => {
        const session = getDatabaseManager().getNeo4jSession();
        try {
          const result = await session.run(
            'MATCH (:Event {id: $cause})-[r:CAUSES]->(:Event {id: $effect}) RETURN r.id AS id, r.evidence AS evidence ORDER BY r.created_at',
            { cause, effect }
          );
          return result.records.map((record) => ({ id: record.get('id'), evidence: record.get('evidence') }));
        } finally {
          await session.close();
        }
      };
      const changeIds = (change: Message): string[] => (change.entities as Array<{ id: string }>).map((entity) => entity.id);

      it('gives two links on one pair, from the single route and from a batch, ids of their own', async () => {
        const cause = await addEvent('Pair cause', '1300-01-01T00:00:00.000Z');
        const effect = await addEvent('Pair effect', '1301-01-01T00:00:00.000Z');
        const client = await watcher(agentKey, graphA);

        expect((await link(cause, effect, 'first')).status).toBe(201);
        const first = await client.nextOf('change');
        expect((await link(cause, effect, 'second')).status).toBe(201);
        const second = await client.nextOf('change');
        const batch = await http('POST', '/api/batch/relationships', agentKey, graphA, {
          graphId: graphA,
          relationships: [{ cause_event_id: cause, effect_event_id: effect, evidence: 'third' }],
        });
        expect(batch.status).toBe(201);
        const third = await client.nextOf('change');

        // Three announcements, three different ids: a watcher can tell them apart.
        const announced = [first, second, third].map((change) => changeIds(change)[0]);
        expect(new Set(announced).size).toBe(3);
        for (const change of [first, second, third]) expect(change).toMatchObject({ operation: 'create', entities: [{ type: 'relationship' }] });

        // The version store holds all three, under those ids.
        const versioned = await headLinks(cause, effect);
        expect(versioned.map(([id]) => id).sort()).toEqual([...announced].sort());
        expect(versioned.map(([, l]) => l.evidence).sort()).toEqual(['first', 'second', 'third']);

        // And Neo4j stores the same ids on the edges.
        const stored = await neo4jLinks(cause, effect);
        expect(stored.map((l) => l.id)).toEqual(announced);

        // The read route returns them too.
        const read = await http('GET', '/api/causal/relationships', agentKey, graphA);
        const ids = (read.body.data as Array<{ id: string; cause_event_id: string }>).filter((l) => l.cause_event_id === cause).map((l) => l.id);
        expect(ids.sort()).toEqual([...announced].sort());
      });

      it('deletes the links of one pair one at a time, announcing and versioning each', async () => {
        const cause = await addEvent('Del cause', '1310-01-01T00:00:00.000Z');
        const effect = await addEvent('Del effect', '1311-01-01T00:00:00.000Z');
        const ids: string[] = [];
        const client = await watcher(agentKey, graphA);
        for (const evidence of ['one', 'two', 'three']) {
          expect((await link(cause, effect, evidence)).status).toBe(201);
          ids.push(changeIds(await client.nextOf('change'))[0]);
        }

        // The route names a link by its events and takes the oldest, as the local store does.
        const removed = await http('DELETE', '/api/causal/link', agentKey, graphA, { causeEventId: cause, effectEventId: effect });
        expect(removed.status).toBe(200);
        expect(await client.nextOf('change')).toMatchObject({ operation: 'delete', entities: [{ type: 'relationship', id: ids[0] }] });
        expect((await headLinks(cause, effect)).map(([id]) => id).sort()).toEqual([ids[1], ids[2]].sort());
        expect((await neo4jLinks(cause, effect)).map((l) => l.evidence)).toEqual(['two', 'three']);

        // A transaction does the same for the next one; the third stays.
        const tx = await http('POST', '/api/batch/transaction', agentKey, graphA, {
          graphId: graphA,
          operations: [{ type: 'delete_relationship', data: { cause_event_id: cause, effect_event_id: effect } }],
        });
        expect(tx.status).toBe(200);
        expect(await client.nextOf('change')).toMatchObject({ operation: 'delete', entities: [{ type: 'relationship', id: ids[1] }] });
        expect((await headLinks(cause, effect)).map(([id]) => id)).toEqual([ids[2]]);
        expect((await neo4jLinks(cause, effect)).map((l) => l.id)).toEqual([ids[2]]);
      });

      it('creates two links on one pair in one transaction and versions both', async () => {
        const cause = await addEvent('Tx cause', '1320-01-01T00:00:00.000Z');
        const effect = await addEvent('Tx effect', '1321-01-01T00:00:00.000Z');
        const tx = await http('POST', '/api/batch/transaction', agentKey, graphA, {
          graphId: graphA,
          operations: [
            { type: 'create_relationship', data: { cause_event_id: cause, effect_event_id: effect, evidence: 'tx one' } },
            { type: 'create_relationship', data: { cause_event_id: cause, effect_event_id: effect, evidence: 'tx two' } },
          ],
        });
        expect(tx.status).toBe(200);
        const versioned = await headLinks(cause, effect);
        expect(versioned.map(([, l]) => l.evidence).sort()).toEqual(['tx one', 'tx two']);
        expect((await neo4jLinks(cause, effect)).map((l) => l.id).sort()).toEqual(versioned.map(([id]) => id).sort());
      });

      // Links made before ids existed are named once, by the startup migration; the
      // app is already running here, so the test runs the migration as a restart would.
      const legacyEdge = async (cause: string, effect: string, evidence: string, createdAt: string): Promise<void> => {
        const session = getDatabaseManager().getNeo4jSession();
        try {
          await session.run(
            `MATCH (c:Event {id: $cause}), (e:Event {id: $effect})
             CREATE (c)-[:CAUSES {weight: 0.4, evidence: $evidence, confidence: 0.6, relationship_type: 'direct', created_at: datetime($createdAt), graphId: $graphId}]->(e)`,
            { cause, effect, evidence, createdAt, graphId: graphA }
          );
        } finally {
          await session.close();
        }
      };
      const migrate = (): Promise<CausalLinkIdMigrationResult> => runCausalLinkIdMigration(container, { log: () => undefined });
      /** What main versioned for a cloud link: the pair as its id. */
      const versionAsMainDid = (cause: string, effect: string, evidence: string): Promise<void> =>
        container.graphWriteVersioningService.recordRelationship(
          graphA,
          { id: `${cause}->${effect}`, cause_event_id: cause, effect_event_id: effect, weight: 0.4, confidence: 0.6, evidence, relationship_type: 'direct' },
          'create'
        );
      const liveLinks = async (cause: string): Promise<Array<{ id: string; evidence: string }>> => {
        const res = await http('GET', '/api/causal/relationships', agentKey, graphA);
        expect(res.status).toBe(200);
        return (res.body.data as Array<{ id: string; evidence: string; cause_event_id: string }>).filter((l) => l.cause_event_id === cause);
      };

      it('names an upgraded link as the version history knew it, so an edit, a delete and a rollback stay consistent', async () => {
        const cause = await addEvent('Upgraded cause', '1330-01-01T00:00:00.000Z');
        const effect = await addEvent('Upgraded effect', '1331-01-01T00:00:00.000Z');
        await legacyEdge(cause, effect, 'OLD', '2020-01-01T00:00:00Z');
        await versionAsMainDid(cause, effect, 'OLD');
        const pairId = `${cause}->${effect}`;

        const first = await migrate();
        expect(first.named).toBeGreaterThanOrEqual(1);
        expect((await neo4jLinks(cause, effect)).map((l) => l.id)).toEqual([pairId]);
        expect((await liveLinks(cause)).map((l) => l.id)).toEqual([pairId]);

        // An edit updates the one head entry; it does not add a second.
        const updated = await http('PUT', '/api/causal/link', agentKey, graphA, {
          causeEventId: cause,
          effectEventId: effect,
          relationship: { evidence: 'REVISED' },
        });
        expect(updated.status).toBe(200);
        expect((await headLinks(cause, effect)).map(([id, l]) => [id, l.evidence])).toEqual([[pairId, 'REVISED']]);

        // A delete removes it from the head.
        const removed = await http('DELETE', '/api/causal/link', agentKey, graphA, { causeEventId: cause, effectEventId: effect });
        expect(removed.status).toBe(200);
        expect(removed.body.data).toMatchObject({ id: pairId });
        expect(await headLinks(cause, effect)).toEqual([]);

        // Rolling back to the head does not bring it back.
        const versions = await http('GET', `/api/graphs/${graphA}/versions`, agentKey, graphA);
        const latest = Math.max(...(versions.body.data as Array<{ version: number }>).map((v) => v.version));
        expect((await http('POST', `/api/graphs/${graphA}/rollback/${latest}`, agentKey, graphA)).status).toBeLessThan(300);
        expect(await liveLinks(cause)).toEqual([]);
        expect(await neo4jLinks(cause, effect)).toEqual([]);
        expect(await headLinks(cause, effect)).toEqual([]);
      });

      it('gives each of two id-less edges on a pair the id the head holds for its data, or a derived one, and puts both in the head', async () => {
        const cause = await addEvent('Twin cause', '1340-01-01T00:00:00.000Z');
        const effect = await addEvent('Twin effect', '1341-01-01T00:00:00.000Z');
        await legacyEdge(cause, effect, 'ELDER', '2020-01-01T00:00:00Z');
        await legacyEdge(cause, effect, 'YOUNGER', '2021-01-01T00:00:00Z');
        // Both shared one head entry, which holds whichever was written last.
        await versionAsMainDid(cause, effect, 'YOUNGER');
        const pairId = `${cause}->${effect}`;

        const result = await migrate();
        expect(result.reconciledGraphs).toBeGreaterThanOrEqual(1);

        const stored = await neo4jLinks(cause, effect);
        const idOf = (evidence: string): string => String(stored.find((l) => l.evidence === evidence)!.id);
        // The head held `cause->effect` with the younger edge's data: the younger edge keeps it.
        expect(idOf('YOUNGER')).toBe(pairId);
        expect(idOf('ELDER')).toMatch(/^link_[0-9a-f]{24}$/);

        // Nothing lost: the head holds each live link under its own id, with its own evidence.
        const head = await headLinks(cause, effect);
        expect(Object.fromEntries(head.map(([id, l]) => [id, l.evidence]))).toEqual({ [pairId]: 'YOUNGER', [idOf('ELDER')]: 'ELDER' });

        // Each can be named by id; deleting one leaves the other, live and versioned.
        const removed = await http('DELETE', '/api/causal/link', agentKey, graphA, { causeEventId: cause, effectEventId: effect, id: idOf('ELDER') });
        expect(removed.status).toBe(200);
        expect((await neo4jLinks(cause, effect)).map((l) => l.evidence)).toEqual(['YOUNGER']);
        expect((await headLinks(cause, effect)).map(([id]) => id)).toEqual([pairId]);

        // The pair's own id also names the survivor on a PUT.
        const put = await http('PUT', '/api/causal/link', agentKey, graphA, {
          causeEventId: cause,
          effectEventId: effect,
          id: pairId,
          relationship: { evidence: 'YOUNGER, revised' },
        });
        expect(put.status).toBe(200);
        expect((await headLinks(cause, effect)).map(([id, l]) => [id, l.evidence])).toEqual([[pairId, 'YOUNGER, revised']]);
      });

      it('changes and removes the named link of a pair, and only it (cloud)', async () => {
        const cause = await addEvent('ById cause', '1350-01-01T00:00:00.000Z');
        const effect = await addEvent('ById effect', '1351-01-01T00:00:00.000Z');
        expect((await link(cause, effect, 'first')).status).toBe(201);
        expect((await link(cause, effect, 'second')).status).toBe(201);
        const [first, second] = await neo4jLinks(cause, effect);

        const put = await http('PUT', '/api/causal/link', agentKey, graphA, {
          causeEventId: cause,
          effectEventId: effect,
          id: second!.id,
          relationship: { evidence: 'second, revised' },
        });
        expect(put.status).toBe(200);
        expect((await neo4jLinks(cause, effect)).map((l) => l.evidence)).toEqual(['first', 'second, revised']);

        const del = await http('DELETE', '/api/causal/link', agentKey, graphA, { causeEventId: cause, effectEventId: effect, id: second!.id });
        expect(del.status).toBe(200);
        expect((await neo4jLinks(cause, effect)).map((l) => l.id)).toEqual([first!.id]);
        expect((await headLinks(cause, effect)).map(([id]) => id)).toEqual([first!.id]);

        const missing = await http('DELETE', '/api/causal/link', agentKey, graphA, { causeEventId: cause, effectEventId: effect, id: second!.id });
        expect(missing.status).toBe(404);
      });

      it('is safe to run again: nothing is renamed and no version is made', async () => {
        const cause = await addEvent('Rerun cause', '1360-01-01T00:00:00.000Z');
        const effect = await addEvent('Rerun effect', '1361-01-01T00:00:00.000Z');
        await legacyEdge(cause, effect, 'A', '2020-01-01T00:00:00Z');
        await legacyEdge(cause, effect, 'B', '2021-01-01T00:00:00Z');
        await migrate();
        const idsBefore = (await neo4jLinks(cause, effect)).map((l) => l.id);
        const versionsBefore = ((await http('GET', `/api/graphs/${graphA}/versions`, agentKey, graphA)).body.data as unknown[]).length;

        expect(await migrate()).toEqual({ named: 0, adopted: 0, reconciledGraphs: 0, failedGraphs: 0 });

        expect((await neo4jLinks(cause, effect)).map((l) => l.id)).toEqual(idsBefore);
        expect(((await http('GET', `/api/graphs/${graphA}/versions`, agentKey, graphA)).body.data as unknown[]).length).toBe(versionsBefore);
      });

      it('returns stable ids to concurrent reads, and a read does not write', async () => {
        const cause = await addEvent('Race cause', '1370-01-01T00:00:00.000Z');
        const effect = await addEvent('Race effect', '1371-01-01T00:00:00.000Z');
        await legacyEdge(cause, effect, 'X', '2020-01-01T00:00:00Z');
        await legacyEdge(cause, effect, 'Y', '2021-01-01T00:00:00Z');
        await migrate();
        const settled = (await neo4jLinks(cause, effect)).map((l) => l.id);

        // Three waves of ten concurrent reads. One wave of thirty queues long enough on a slow CI
        // runner for the last reads to pass the default 2 s request budget (408), which says
        // nothing about the ids.
        for (let wave = 0; wave < 3; wave += 1) {
          const reads = await Promise.all(Array.from({ length: 10 }, () => liveLinks(cause)));
          for (const links of reads) expect(links.map((l) => l.id).sort()).toEqual([...settled].sort());
        }
        expect((await neo4jLinks(cause, effect)).map((l) => l.id)).toEqual(settled);

        // An edge that appears after the migration is read under its pair name and left alone:
        // a GET never writes an id.
        const later = await addEvent('Late cause', '1372-01-01T00:00:00.000Z');
        const latest = await addEvent('Late effect', '1373-01-01T00:00:00.000Z');
        await legacyEdge(later, latest, 'LATE', '2022-01-01T00:00:00Z');
        const seen = await Promise.all(Array.from({ length: 10 }, () => liveLinks(later)));
        for (const links of seen) expect(links.map((l) => l.id)).toEqual([`${later}->${latest}`]);
        expect((await neo4jLinks(later, latest)).map((l) => l.id)).toEqual([null]);
      });
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
