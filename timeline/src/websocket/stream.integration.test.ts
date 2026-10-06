/**
 * Integration tests for the WebSocket streaming subsystem (requirement 16).
 *
 * These drive a REAL `http.Server` and a real `ws` client on an ephemeral port
 * against a real local-mode container, rather than mocking the socket layer.
 * Mocking the socket would let every assertion pass while nothing about
 * connection handling is exercised; here the token is actually consumed on an
 * upgrade, an event is actually written to the graph-scoped repository, and the
 * N+1th connection is actually refused by the live server.
 *
 * What each load-bearing test would break on:
 *   - "rejects an unknown token": fails if the handler accepts any token.
 *   - "rejects an expired token": fails if the expiry check is removed.
 *   - "rejects a replayed token": fails if the single-use flag is ignored.
 *   - "rejects a valid token for a key without permission": fails if connect
 *     checks only that the token exists.
 *   - "refuses the N+1th connection": fails if the limit is stored but not
 *     enforced.
 *   - "acks a successful event": the event is also read back from the graph
 *     repository, so an ack that lies is caught.
 *   - "acks a failing event with an error": fails if failures are swallowed.
 *   - "closes live sockets on shutdown": fails if shutdown leaves the socket
 *     open (and would hang on the server close).
 *
 * The client harness queues messages from the moment the socket is constructed.
 * Attaching a `message` listener after awaiting the `open` event races the
 * server's immediate `auth_result` and can lose it; that race would make the
 * suite flaky rather than test the handler.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createServer } from 'http';
import type { Server, ClientRequest, IncomingMessage } from 'http';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { WebSocket } from 'ws';
import type { RawData } from 'ws';
import { loadConfig, initializeDatabaseManager } from '@/utils';
import { Container, initializeContainer, cleanupContainer } from '@/container';
import { injectContainer, errorHandler } from '@/api/middleware';
import { streamRoutes } from '@/api/routes/stream';
import {
  StreamHandler,
  StreamSessionManager,
  StreamTokenStore,
  getStreamTokenStore,
  resetStreamTokenStore,
  isRecord,
  STREAM_PATH,
} from '@/websocket';

function rawToString(data: RawData): string {
  if (typeof data === 'string') {
    return data;
  }
  if (Buffer.isBuffer(data)) {
    return data.toString('utf8');
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString('utf8');
  }
  return Buffer.from(data).toString('utf8');
}

function readJsonObject(data: RawData): Record<string, unknown> {
  const text = rawToString(data);
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) {
    throw new Error(`Expected a JSON object, received: ${text}`);
  }
  return parsed;
}

interface UpgradeRejection {
  statusCode: number;
  code: string;
}

interface Waiter {
  resolve: (message: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * A WebSocket client whose inbound messages are queued from construction, so no
 * message can be lost between the `open` event and the first read.
 */
interface SocketHarness {
  ws: WebSocket;
  next(timeoutMs?: number): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

describe('WebSocket streaming (requirement 16)', () => {
  let container: Container;
  let app: express.Application;
  let server: Server;
  let handler: StreamHandler;
  let sessionManager: StreamSessionManager;
  let tokenStore: StreamTokenStore;
  let port: number;
  let testDataDir: string;
  let graphId: string;

  let writerKeyId: string;
  let writerKey: string;
  let limitedKeyId: string;
  let limitedKey: string;
  let readOnlyKeyId: string;
  let readOnlyKey: string;
  let noGraphKeyId: string;
  let noGraphKey: string;

  function buildHandler(store: StreamTokenStore): {
    handler: StreamHandler;
    sessionManager: StreamSessionManager;
  } {
    const sessions = new StreamSessionManager();
    const streamHandler = new StreamHandler({
      tokenStore: store,
      sessionManager: sessions,
      deps: {
        authService: container.authService,
        graphScopedRepositories: (id) => container.graphScopedRepositories(id),
        graphWriteVersioningService: container.graphWriteVersioningService,
      },
    });
    return { handler: streamHandler, sessionManager: sessions };
  }

  beforeAll(async () => {
    testDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stream-test-'));
    process.env.LOCAL_EXECUTION_ENABLED = 'true';
    process.env.LOCAL_DATA_DIR = testDataDir;
    process.env.LOCAL_GRAPH_FILE = 'stream-graph.json';
    process.env.LOCAL_BACKUP_ENABLED = 'false';
    process.env.LOCAL_MAX_MEMORY_MB = '64';

    const config = loadConfig();
    const dbManager = initializeDatabaseManager(config.database);
    container = initializeContainer(dbManager, config);
    await container.initialize();

    const graph = await container.graphRepository.create({ name: 'Stream Test Graph' });
    graphId = graph.id;
    await container.graphRepository.setActiveGraph(graphId);

    const writer = await container.authService.createApiKey({
      name: 'Stream Writer',
      permissions: ['write:events', 'write:arcs', 'read:events'],
      rateLimit: { concurrentStreams: 3 },
    });
    writerKeyId = writer.id;
    writerKey = writer.key;

    const limited = await container.authService.createApiKey({
      name: 'Stream Limited',
      permissions: ['write:events'],
      rateLimit: { concurrentStreams: 1 },
    });
    limitedKeyId = limited.id;
    limitedKey = limited.key;

    const readOnly = await container.authService.createApiKey({
      name: 'Stream Read Only',
      permissions: ['read:events'],
    });
    readOnlyKeyId = readOnly.id;
    readOnlyKey = readOnly.key;

    const noGraph = await container.authService.createApiKey({
      name: 'Stream Other Graph Only',
      permissions: ['write:events'],
      allowedGraphs: ['some-other-graph'],
    });
    noGraphKeyId = noGraph.id;
    noGraphKey = noGraph.key;

    resetStreamTokenStore();
    tokenStore = getStreamTokenStore();
    ({ handler, sessionManager } = buildHandler(tokenStore));

    app = express();
    app.use(express.json());
    app.use(injectContainer);
    app.use('/api/stream', streamRoutes);
    app.use(errorHandler);

    server = createServer(app);
    handler.attach(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Server did not expose a numeric port');
    }
    port = address.port;
  });

  afterAll(async () => {
    await handler.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await cleanupContainer();
    await fs.rm(testDataDir, { recursive: true, force: true });
  });

  function streamUrl(query: string): string {
    return `ws://127.0.0.1:${port}${STREAM_PATH}${query}`;
  }

  function createHarness(url: string): SocketHarness {
    const ws = new WebSocket(url);
    const queue: Record<string, unknown>[] = [];
    const waiters: Waiter[] = [];
    let failure: Error | undefined;

    function flushWaiters(error: Error): void {
      failure = error;
      for (const waiter of waiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
    }

    ws.on('message', (data: RawData) => {
      let message: Record<string, unknown>;
      try {
        message = readJsonObject(data);
      } catch (error) {
        flushWaiters(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      const waiter = waiters.shift();
      if (waiter) {
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      } else {
        queue.push(message);
      }
    });
    ws.on('error', (error: Error) => flushWaiters(error));
    ws.on('close', (code: number) => {
      flushWaiters(new Error(`socket closed (code ${code})`));
    });

    return {
      ws,
      next(timeoutMs = 3000): Promise<Record<string, unknown>> {
        const queued = queue.shift();
        if (queued) {
          return Promise.resolve(queued);
        }
        if (failure) {
          return Promise.reject(failure);
        }
        return new Promise<Record<string, unknown>>((resolve, reject) => {
          const timer = setTimeout(() => {
            const index = waiters.findIndex((waiter) => waiter.timer === timer);
            if (index >= 0) {
              waiters.splice(index, 1);
            }
            reject(new Error('timed out waiting for a server message'));
          }, timeoutMs);
          waiters.push({ resolve, reject, timer });
        });
      },
      close(): Promise<void> {
        return new Promise((resolve) => {
          if (ws.readyState === WebSocket.CLOSED) {
            resolve();
            return;
          }
          ws.once('close', () => resolve());
          ws.close();
        });
      },
    };
  }

  async function openHarness(query: string): Promise<SocketHarness> {
    const harness = createHarness(streamUrl(query));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        harness.ws.terminate();
        reject(new Error('timed out opening socket'));
      }, 3000);
      harness.ws.once('open', () => {
        clearTimeout(timer);
        resolve();
      });
      harness.ws.once('error', (error: Error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    return harness;
  }

  async function connectAccepted(token: string): Promise<SocketHarness> {
    const harness = await openHarness(`?token=${encodeURIComponent(token)}`);
    const auth = await harness.next();
    expect(auth.type).toBe('auth_result');
    expect(auth.success).toBe(true);
    expect(typeof auth.sessionId).toBe('string');
    return harness;
  }

  function expectUpgradeRejected(query: string): Promise<UpgradeRejection> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(streamUrl(query));
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          ws.terminate();
          reject(new Error('timed out waiting for the upgrade rejection'));
        }
      }, 3000);

      ws.on('unexpected-response', (_req: ClientRequest, res: IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          ws.terminate();
          const text = Buffer.concat(chunks).toString('utf8');
          const parsed: unknown = JSON.parse(text);
          const code = isRecord(parsed) && typeof parsed.code === 'string' ? parsed.code : '';
          resolve({ statusCode: res.statusCode ?? 0, code });
        });
      });
      ws.on('open', () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          ws.terminate();
          reject(new Error('expected the upgrade to be rejected but it was accepted'));
        }
      });
      ws.on('error', (error: Error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(error);
        }
      });
    });
  }

  async function requestToken(apiKey: string): Promise<string> {
    const response = await request(app)
      .post('/api/stream/token')
      .set('X-API-Key', apiKey)
      .set('X-Graph-Id', graphId)
      .send({});
    expect(response.status).toBe(201);
    expect(typeof response.body.token).toBe('string');
    return response.body.token as string;
  }

  function sendJson(harness: SocketHarness, message: Record<string, unknown>): void {
    harness.ws.send(JSON.stringify(message));
  }

  async function waitForSessionCount(
    keyId: string,
    expected: number,
    timeoutMs = 3000
  ): Promise<void> {
    const start = Date.now();
    while (sessionManager.countFor(keyId) !== expected) {
      if (Date.now() - start > timeoutMs) {
        throw new Error(
          `session count for ${keyId} was ${sessionManager.countFor(keyId)}, expected ${expected}`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  describe('POST /api/stream/token', () => {
    it('requires authentication', async () => {
      const response = await request(app)
        .post('/api/stream/token')
        .set('X-Graph-Id', graphId)
        .send({});
      expect(response.status).toBe(401);
    });

    it('rejects a key that lacks write:events', async () => {
      const response = await request(app)
        .post('/api/stream/token')
        .set('X-API-Key', readOnlyKey)
        .set('X-Graph-Id', graphId)
        .send({});

      expect(response.status).toBe(403);
    });

    it('issues a short-lived token tied to the key and graph', async () => {
      const response = await request(app)
        .post('/api/stream/token')
        .set('X-API-Key', writerKey)
        .set('X-Graph-Id', graphId)
        .send({});

      expect(response.status).toBe(201);
      expect(typeof response.body.token).toBe('string');
      expect(response.body.token.length).toBeGreaterThan(0);
      expect(response.body.expiresIn).toBe(300);
      expect(response.body.graphId).toBe(graphId);
      expect(response.body.permissions).toContain('write:events');
    });

    it('rejects a token request for a graph the key cannot access', async () => {
      const response = await request(app)
        .post('/api/stream/token')
        .set('X-API-Key', noGraphKey)
        .set('X-Graph-Id', graphId)
        .send({});

      expect(response.status).toBe(403);
    });
  });

  describe('connection token validation', () => {
    it('rejects an unknown token', async () => {
      const rejection = await expectUpgradeRejected('?token=this-token-was-never-issued');
      expect(rejection.statusCode).toBe(401);
      expect(rejection.code).toBe('UNKNOWN_TOKEN');
    });

    it('rejects a missing token as malformed', async () => {
      const rejection = await expectUpgradeRejected('');
      expect(rejection.statusCode).toBe(400);
      expect(rejection.code).toBe('MALFORMED_TOKEN');
    });

    it('rejects an empty token as malformed', async () => {
      const rejection = await expectUpgradeRejected('?token=');
      expect(rejection.statusCode).toBe(400);
      expect(rejection.code).toBe('MALFORMED_TOKEN');
    });

    it('rejects an expired token', async () => {
      const expired = tokenStore.issue({
        apiKeyId: writerKeyId,
        graphId,
        permissions: ['write:events'],
        ttlMs: 1000,
        now: Date.now() - 10 * 60 * 1000,
      });

      const rejection = await expectUpgradeRejected(`?token=${encodeURIComponent(expired.token)}`);
      expect(rejection.statusCode).toBe(401);
      expect(rejection.code).toBe('EXPIRED_TOKEN');
    });

    it('rejects a replayed token', async () => {
      const record = tokenStore.issue({
        apiKeyId: writerKeyId,
        graphId,
        permissions: ['write:events'],
      });

      const harness = await connectAccepted(record.token);
      await harness.close();

      const rejection = await expectUpgradeRejected(`?token=${encodeURIComponent(record.token)}`);
      expect(rejection.statusCode).toBe(409);
      expect(rejection.code).toBe('REPLAYED_TOKEN');
    });

    it('rejects a valid token whose key lacks write:events', async () => {
      // Minted directly rather than through the route, which would refuse it at
      // issuance. This proves the CONNECT path re-checks the key's permissions
      // instead of trusting the token's existence.
      const record = tokenStore.issue({
        apiKeyId: readOnlyKeyId,
        graphId,
        permissions: ['read:events'],
      });

      const rejection = await expectUpgradeRejected(`?token=${encodeURIComponent(record.token)}`);
      expect(rejection.statusCode).toBe(403);
      expect(rejection.code).toBe('PERMISSION_DENIED');
    });

    it('rejects a valid token whose key cannot access the token graph', async () => {
      const record = tokenStore.issue({
        apiKeyId: noGraphKeyId,
        graphId,
        permissions: ['write:events'],
      });

      const rejection = await expectUpgradeRejected(`?token=${encodeURIComponent(record.token)}`);
      expect(rejection.statusCode).toBe(403);
      expect(rejection.code).toBe('GRAPH_ACCESS_DENIED');
    });
  });

  describe('event acknowledgments', () => {
    it('acks a successful event and actually persists it', async () => {
      const token = await requestToken(writerKey);
      const harness = await connectAccepted(token);
      try {
        sendJson(harness, {
          type: 'event',
          requestId: 'req-1',
          data: {
            description: 'The printing press is invented',
            actor: 'Johannes Gutenberg',
            target: 'Europe',
            timestamp: '1440-01-01T00:00:00.000Z',
          },
        });

        const ack = await harness.next();
        expect(ack.type).toBe('ack');
        expect(ack.success).toBe(true);
        expect(ack.requestId).toBe('req-1');
        expect(ack.entityType).toBe('event');
        expect(typeof ack.entityId).toBe('string');

        // The ack must not be a lie: read the event back from the same
        // graph-scoped repository the HTTP route would use.
        const scoped = await container.graphScopedRepositories(graphId);
        const persisted = await scoped.eventRepository.findById(ack.entityId as string);
        expect(persisted).not.toBeNull();
        expect(persisted?.description).toBe('The printing press is invented');
      } finally {
        await harness.close();
      }
    });

    it('acks a failing event with success:false and an error', async () => {
      const token = await requestToken(writerKey);
      const harness = await connectAccepted(token);
      try {
        sendJson(harness, {
          type: 'event',
          requestId: 'req-bad',
          data: {
            description: 'Missing the actor field',
            target: 'Nowhere',
            timestamp: '1440-01-01T00:00:00.000Z',
          },
        });

        const ack = await harness.next();
        expect(ack.type).toBe('ack');
        expect(ack.success).toBe(false);
        expect(ack.requestId).toBe('req-bad');
        expect(ack.entityId).toBeNull();
        expect(String(ack.error)).toContain('actor');
      } finally {
        await harness.close();
      }
    });

    it('acks a successful arc', async () => {
      const token = await requestToken(writerKey);
      const harness = await connectAccepted(token);
      try {
        sendJson(harness, {
          type: 'arc',
          requestId: 'arc-1',
          data: {
            name: 'Renaissance',
            start_time: '1400-01-01T00:00:00.000Z',
            end_time: '1600-01-01T00:00:00.000Z',
            level: 1,
          },
        });

        const ack = await harness.next();
        expect(ack.type).toBe('ack');
        expect(ack.success).toBe(true);
        expect(ack.entityType).toBe('arc');
        expect(typeof ack.entityId).toBe('string');
      } finally {
        await harness.close();
      }
    });
  });

  describe('concurrent stream limits', () => {
    it('refuses the N+1th connection and frees the slot when one closes', async () => {
      const firstToken = await requestToken(limitedKey);
      const first = await connectAccepted(firstToken);
      try {
        expect(sessionManager.countFor(limitedKeyId)).toBe(1);

        const secondToken = await requestToken(limitedKey);
        const rejection = await expectUpgradeRejected(
          `?token=${encodeURIComponent(secondToken)}`
        );
        expect(rejection.statusCode).toBe(429);
        expect(rejection.code).toBe('CONCURRENT_LIMIT');
      } finally {
        await first.close();
      }

      await waitForSessionCount(limitedKeyId, 0);

      // After the first session is gone the slot is usable again; a fresh
      // token is required because the second token was burned by the refused
      // upgrade and the first was single-use.
      const thirdToken = await requestToken(limitedKey);
      const third = await connectAccepted(thirdToken);
      await third.close();
      await waitForSessionCount(limitedKeyId, 0);
    });
  });

  describe('shutdown', () => {
    it('closes live sockets so the HTTP server can close', async () => {
      const store = new StreamTokenStore();
      const { handler: shutdownHandler, sessionManager: shutdownSessions } = buildHandler(store);
      const shutdownServer = createServer(app);
      shutdownHandler.attach(shutdownServer);
      await new Promise<void>((resolve) => shutdownServer.listen(0, '127.0.0.1', resolve));
      const address = shutdownServer.address();
      if (!address || typeof address === 'string') {
        throw new Error('shutdown server did not expose a port');
      }

      const record = store.issue({
        apiKeyId: writerKeyId,
        graphId,
        permissions: ['write:events'],
      });

      const harness = createHarness(
        `ws://127.0.0.1:${address.port}${STREAM_PATH}?token=${record.token}`
      );
      await new Promise<void>((resolve, reject) => {
        harness.ws.once('open', () => resolve());
        harness.ws.once('error', reject);
      });
      const auth = await harness.next();
      expect(auth.success).toBe(true);
      expect(shutdownSessions.totalCount).toBe(1);

      const closed = new Promise<void>((resolve) => harness.ws.once('close', () => resolve()));

      await shutdownHandler.close();
      await Promise.race([
        closed,
        new Promise<void>((_resolve, reject) =>
          setTimeout(() => reject(new Error('socket was not closed by shutdown')), 3000)
        ),
      ]);

      expect(shutdownSessions.totalCount).toBe(0);
      await Promise.race([
        new Promise<void>((resolve) => shutdownServer.close(() => resolve())),
        new Promise<void>((_resolve, reject) =>
          setTimeout(() => reject(new Error('HTTP server did not close after shutdown')), 3000)
        ),
      ]);
    });
  });
});
