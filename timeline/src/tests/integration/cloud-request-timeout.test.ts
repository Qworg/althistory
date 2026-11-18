/**
 * A request answered 408 saved nothing, in Neo4j (issue 44).
 *
 * `requestTimeout` used to answer 408 and let the request run on: the node or
 * the edge was written a moment later, a client that retried wrote it twice,
 * and the late reply logged "Cannot set headers after they are sent". Now the
 * request's signal fires before the 408 and the Neo4j session rolls its
 * transaction back.
 *
 * This boots the real `Application` in cloud mode with a 1 s budget and
 * slows every write statement of the Neo4j driver by 3 s (`apoc.util.sleep`
 * in front of it), so the budget runs out while the write is in flight. It runs
 * only under `vitest.cloud.config.ts` (`npm run test:cloud`).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { Application } from '@/index';
import { getContainer, type Container } from '@/container';
import { getDatabaseManager } from '@/utils/database';
import type { Permission } from '@/models/ApiKey';

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

const SLOW_MS = 3000;

describe('a 408 saves nothing, in Neo4j', () => {
  let app: Application;
  let container: Container;
  let dataDir: string;
  let base: string;
  let graph: string;
  let key: string;
  let slow = false;
  const exits: number[] = [];
  const saved: Record<string, string | undefined> = {};
  const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  const setEnv = (name: string, value: string | undefined): void => {
    if (!(name in saved)) saved[name] = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };

  async function http(method: 'GET' | 'POST', url: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await fetch(`${base}${url}`, {
      method,
      headers: { 'X-API-Key': key, 'Content-Type': 'application/json', 'X-Graph-Id': graph },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  async function count(cypher: string, params: Record<string, unknown>): Promise<number> {
    const session = getDatabaseManager().getNeo4jSession();
    try {
      const result = await session.run(cypher, params);
      return Number(result.records[0].get('n'));
    } finally {
      await session.close();
    }
  }

  const events = (): Promise<number> => count('MATCH (e:Event {graphId: $graph}) RETURN count(e) AS n', { graph });
  const versions = async (): Promise<number> => (await container.graphRepository.getVersionHistory(graph)).total;
  const event = (description: string) => ({ description, actor: 'Actor', target: 'Target', timestamp: '1200-03-01T00:00:00.000Z' });

  /** Put a delay in front of every write statement sent to Neo4j while `slow` is set. */
  function slowTheDriver(): void {
    const driver = (getDatabaseManager() as unknown as { neo4jDriver: { session: (...args: unknown[]) => Record<string, unknown> } }).neo4jDriver;
    const open = driver.session.bind(driver);
    driver.session = (...args: unknown[]) => {
      const session = open(...args) as {
        run: (q: string, p?: unknown, c?: unknown) => unknown;
        beginTransaction: (...a: unknown[]) => { run: (q: string, p?: unknown) => unknown };
      };
      const slowed = (query: string): string => (slow && /\b(CREATE|MERGE)\b/.test(query) ? `CALL apoc.util.sleep(${SLOW_MS}) ${query}` : query);
      // Auto-commit statements too, so the same slowness applies before and after the transactional path.
      const runPlain = session.run.bind(session);
      session.run = (query: string, p?: unknown, c?: unknown) => runPlain(slowed(query), p, c);
      const begin = session.beginTransaction.bind(session);
      session.beginTransaction = (...a: unknown[]) => {
        const tx = begin(...a);
        const run = tx.run.bind(tx);
        tx.run = (query: string, params?: unknown) => run(slowed(query), params);
        return tx;
      };
      return session;
    };
  }

  beforeAll(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cloud-request-timeout-'));
    setEnv('LOCAL_EXECUTION_ENABLED', 'false');
    setEnv('CLOUD_SINGLE_REPLICA_STATE', 'true');
    setEnv('LOCAL_DATA_DIR', dataDir);
    setEnv('QUERY_TIMEOUT_MS', '1000');
    setEnv('OPENAI_API_KEY', undefined);
    setEnv('ANTHROPIC_API_KEY', undefined);
    const port = await freePort();
    setEnv('PORT', String(port));
    setEnv('HOST', '127.0.0.1');
    base = `http://127.0.0.1:${port}`;

    app = new Application({ exit: (code) => exits.push(code) });
    await app.initialize();
    container = getContainer();
    expect(container.config.localExecution.enabled).toBe(false);
    expect(container.config.performance.queryTimeoutMs).toBe(1000);

    graph = (await container.graphService.createGraph({ name: 'Cloud timeout' })).id;
    const rateLimit = { requestsPerMinute: 1000, requestsPerHour: 10000, requestsPerDay: 100000, concurrentStreams: 8 };
    const everything: Permission[] = ['read:events', 'write:events', 'read:arcs', 'write:arcs', 'read:relationships', 'write:relationships', 'read:graphs', 'write:graphs'];
    key = (await container.authService.createApiKey({ name: 'Timeout agent', permissions: everything, rateLimit })).key;
    slowTheDriver();
    await app.start();
  });

  afterAll(async () => {
    slow = false;
    await wait(SLOW_MS + 200);
    const session = getDatabaseManager().getNeo4jSession();
    try {
      await session.run('MATCH (n) WHERE n.graphId = $graph DETACH DELETE n', { graph });
    } finally {
      await session.close();
    }
    process.emit('SIGTERM');
    const deadline = Date.now() + 10_000;
    while (exits.length === 0 && Date.now() < deadline) await wait(20);
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await fs.rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it('leaves no node and no version for an event create that timed out, and a retry writes one', async () => {
    const logged: string[] = [];
    for (const method of ['error', 'warn'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(' ')));
    }
    const versionsBefore = await versions();

    slow = true;
    const first = await http('POST', '/api/events', event('Timed out'));
    slow = false;
    expect(first.status).toBe(408);
    await wait(SLOW_MS + 500);

    expect(await events()).toBe(0);
    expect(await versions()).toBe(versionsBefore);
    expect(logged.filter((line) => line.includes('Cannot set headers'))).toEqual([]);
    vi.restoreAllMocks();

    const retry = await http('POST', '/api/events', event('Timed out'));
    expect(retry.status).toBe(201);
    expect(await events()).toBe(1);
    expect(await versions()).toBe(versionsBefore + 1);
  });

  it('leaves no edge and no version for a link create that timed out', async () => {
    const cause = ((await http('POST', '/api/events', event('Cause'))).body.data as { id: string }).id;
    const effect = ((await http('POST', '/api/events', event('Effect'))).body.data as { id: string }).id;
    const versionsBefore = await versions();
    const link = {
      causeEventId: cause,
      effectEventId: effect,
      relationship: { type: 'direct', strength: 0.8, confidence: 0.9, evidence: 'The cause came first' },
    };
    const edges = (): Promise<number> =>
      count('MATCH (a:Event {id: $cause})-[r]->(b:Event {id: $effect}) RETURN count(r) AS n', { cause, effect });

    slow = true;
    const first = await http('POST', '/api/causal/link', link);
    slow = false;
    expect(first.status).toBe(408);
    await wait(SLOW_MS + 500);

    expect(await edges()).toBe(0);
    expect(await versions()).toBe(versionsBefore);
    expect(Object.keys((await container.graphRepository.checkout(graph)).relationships)).toHaveLength(0);

    expect((await http('POST', '/api/causal/link', link)).status).toBe(201);
    expect(await edges()).toBe(1);
    expect(await versions()).toBe(versionsBefore + 1);
  });
});
