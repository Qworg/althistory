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
 *   - "rejects a valid token whose key lacks write:events": fails if connect
 *     checks only that the token exists.
 *   - "rejects a token minted with permissions the key does not have": fails if
 *     the handler trusts the token's permission snapshot instead of re-resolving
 *     the key (the snapshot claims a permission the key lacks).
 *   - "rejects a token whose key was revoked/deleted/expired": fails if
 *     `ApiKey.isValid()` is not consulted on connect at all.
 *   - "requests that are not a WebSocket upgrade do not burn a concurrency
 *     slot": fails without the pre-handshake validation AND the socket-bound
 *     reservation guard (five leaked slots lock the key out of streaming).
 *   - "releases a reservation whose handshake never completes": fails unless a
 *     reserved slot is bounded by a timeout, not only by `ws` destroying the
 *     socket.
 *   - "installs a socket error listener before the first await": fails without
 *     the listener attached as the first statement of `handleUpgrade`.
 *   - "refuses writes after the key is revoked mid-session": fails if the key is
 *     only resolved at connect.
 *   - "closes an idle session": fails if no session lifetime/idle limit exists.
 *   - "charges the per-key request limit for stream writes": fails if stream
 *     messages bypass the HTTP rate limiter.
 *   - "bounds in-flight writes": fails if `onMessage`'s fire-and-forget writes
 *     are unbounded.
 *   - "refuses a SECOND message after the maximum lifetime/idle timeout" and
 *     "refuses writes for a session the sweep already removed": fail if the
 *     write path asks `expiredReason` (which answers `undefined` for an id the
 *     manager no longer holds) instead of `refusalReason`. Each sends TWO
 *     messages after the session is gone and reads the graph back, so the
 *     second write is caught even though its ack is never delivered.
 *   - "refuses a write whose session expires while the key is being
 *     re-resolved": fails if the only session check is the one at the top of
 *     `onMessage`, i.e. if nothing re-checks before the entity is persisted.
 *   - "bounds what the server sends back": fails if `send()` queues a frame on
 *     a socket that is already holding more than its outbound limit, and if a
 *     write is persisted while the ack for it could never be delivered.
 *   - "applies the configured outbound limit": fails if the refusal is
 *     unconditional rather than threshold-driven.
 *   - "refuses a frame over the payload limit": fails if the `ws` default
 *     (100 MiB) is left in place.
 *   - "acks success when versioning failed after the entity persisted": fails
 *     if a post-persist failure is reported as `success: false`.
 *   - "acks a repository failure": fails if a failure after conversion is
 *     swallowed (the pre-existing failing-ack test only covered conversion).
 *   - "refuses the N+1th connection": fails if the limit is stored but not
 *     enforced.
 *   - "acks a successful event": the event is also read back from the graph
 *     repository, so an ack that lies is caught. The arc test does the same.
 *   - "closes live sockets on shutdown": fails if shutdown leaves the socket
 *     open (and would hang on the server close). It drives
 *     `StreamHandler.close()` directly against a real HTTP server; the real
 *     `Application.start()`/shutdown sequence is covered separately in
 *     src/tests/integration/stream-shutdown.test.ts and
 *     src/tests/unit/shutdown.test.ts.
 *
 * The client harness queues messages from the moment the socket is constructed.
 * Attaching a `message` listener after awaiting the `open` event races the
 * server's immediate `auth_result` and can lose it; that race would make the
 * suite flaky rather than test the handler.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createServer, IncomingMessage } from 'http';
import type { Server, ClientRequest } from 'http';
import * as fs from 'fs/promises';
import * as net from 'net';
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
  STREAM_MAX_PAYLOAD_BYTES,
  STREAM_MAX_BUFFERED_BYTES,
  STREAM_BACKPRESSURE_CLOSE_CODE,
  STREAM_PATH,
} from '@/websocket';
import type { StreamWriteDeps } from '@/websocket';

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

/** Handler options the shared handler does not use, for the dedicated ones. */
interface LocalHandlerOptions {
  sessionManager?: StreamSessionManager;
  maxPayloadBytes?: number;
  maxInFlightWrites?: number;
  reservationTimeoutMs?: number;
  sweepIntervalMs?: number;
  maxBufferedBytes?: number;
  deps?: Partial<StreamWriteDeps>;
}

/** A handler on its own listener, with its own token store and session state. */
interface LocalHandler {
  handler: StreamHandler;
  sessionManager: StreamSessionManager;
  server: Server;
  store: StreamTokenStore;
  port: number;
  url(token: string): string;
  stop(): Promise<void>;
}

/** A raw HTTP reply to an upgrade request, including a refusal `ws` wrote. */
interface RawUpgradeResult {
  statusCode: number;
  /** JSON `code` from OUR refusal; empty when `ws` wrote the reply instead. */
  code: string;
  raw: string;
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

  function buildHandler(
    store: StreamTokenStore,
    options: LocalHandlerOptions = {}
  ): {
    handler: StreamHandler;
    sessionManager: StreamSessionManager;
  } {
    const sessions = options.sessionManager ?? new StreamSessionManager();
    const streamHandler = new StreamHandler({
      tokenStore: store,
      sessionManager: sessions,
      deps: streamDeps(options.deps),
      maxPayloadBytes: options.maxPayloadBytes,
      maxInFlightWrites: options.maxInFlightWrites,
      reservationTimeoutMs: options.reservationTimeoutMs,
      sweepIntervalMs: options.sweepIntervalMs,
      maxBufferedBytes: options.maxBufferedBytes,
    });
    return { handler: streamHandler, sessionManager: sessions };
  }

  /**
   * Production-shaped write dependencies. The rate limiter is the container's
   * real service, so the socket path is exercised against the same budget the
   * HTTP routes charge.
   */
  function streamDeps(overrides: Partial<StreamWriteDeps> = {}): StreamWriteDeps {
    return {
      authService: container.authService,
      graphScopedRepositories: (id) => container.graphScopedRepositories(id),
      graphWriteVersioningService: container.graphWriteVersioningService,
      rateLimitService: container.rateLimitService,
      ...overrides,
    };
  }

  /**
   * A handler on its own HTTP listener, for the tests that need different
   * handler options (payload limit, reservation timeout, in-flight cap,
   * versioning failure) without disturbing the shared handler's state.
   */
  async function startLocalHandler(
    options: LocalHandlerOptions = {},
    store: StreamTokenStore = new StreamTokenStore()
  ): Promise<LocalHandler> {
    const { handler: localHandler, sessionManager: localSessions } = buildHandler(store, options);
    const localServer = createServer(app);
    localHandler.attach(localServer);
    await new Promise<void>((resolve) => localServer.listen(0, '127.0.0.1', resolve));
    const address = localServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('local handler server did not expose a port');
    }
    return {
      handler: localHandler,
      sessionManager: localSessions,
      server: localServer,
      store,
      port: address.port,
      url(token: string) {
        return `ws://127.0.0.1:${address.port}${STREAM_PATH}?token=${encodeURIComponent(token)}`;
      },
      async stop() {
        await localHandler.close();
        await new Promise<void>((resolve) => localServer.close(() => resolve()));
      },
    };
  }

  function eventData(description: string): Record<string, unknown> {
    return {
      description,
      actor: 'Stream Test Actor',
      target: 'Stream Test Target',
      timestamp: '1500-01-01T00:00:00.000Z',
    };
  }

  /**
   * Event data with a UNIQUE actor, so a test can read back exactly the events
   * its own session wrote and nothing another test's session wrote.
   */
  function eventDataForActor(actor: string, description: string): Record<string, unknown> {
    return { ...eventData(description), actor };
  }

  /** How many events that actor has in the graph, read from the repository. */
  async function persistedForActor(actor: string): Promise<number> {
    const scoped = await container.graphScopedRepositories(graphId);
    const events = await scoped.eventRepository.findByActor(actor);
    return events.length;
  }

  /**
   * Wait for work that a buggy handler would do asynchronously, so a test can
   * assert that it did NOT happen instead of racing it. Deliberately generous:
   * the window only has to be wider than an in-process repository call.
   */
  function settle(ms = 250): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * A versioning service whose failure message is far larger than any kernel
   * socket buffer, so the warning frame the handler writes fills the socket by
   * itself. The outbound bound is then reached with ONE write instead of by
   * pumping thousands of small acks, which is what makes it testable at all.
   */
  function oversizedWarningDeps(): Partial<StreamWriteDeps> {
    return {
      graphWriteVersioningService: {
        recordEvent: async () => {
          throw new Error(`version store unavailable: ${'x'.repeat(8 * 1024 * 1024)}`);
        },
        recordArc: async () => undefined,
      },
    };
  }

  /** Something the handler itself can observe about the socket it is writing to. */
  function serverSideSocket(local: LocalHandler): WebSocket {
    const sockets = Array.from(local.handler.webSocketServer.clients);
    const socket = sockets[0];
    if (!socket) {
      throw new Error('the handler has no server-side socket');
    }
    return socket;
  }

  /** Wait until the handler's socket is holding at least `bytes` unsent. */
  async function waitForBufferedOver(
    local: LocalHandler,
    bytes: number,
    timeoutMs = 5000
  ): Promise<void> {
    const start = Date.now();
    for (;;) {
      const bufferedAmount = serverSideSocket(local).bufferedAmount;
      if (bufferedAmount >= bytes) {
        return;
      }
      if (Date.now() - start > timeoutMs) {
        throw new Error(
          `the socket never buffered ${bytes} bytes (bufferedAmount ${bufferedAmount})`
        );
      }
      await settle(10);
    }
  }

  function arcData(name: string): Record<string, unknown> {
    return {
      name,
      start_time: '1400-01-01T00:00:00.000Z',
      end_time: '1600-01-01T00:00:00.000Z',
      level: 1,
    };
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

  /**
   * Open a socket to an ABSOLUTE url (`streamUrl(...)` or a local handler's
   * `url(...)`), not a query string, so the failover tests can target a
   * different listener.
   */
  async function openHarness(url: string): Promise<SocketHarness> {
    const harness = createHarness(url);
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
    const harness = await openHarness(streamUrl(`?token=${encodeURIComponent(token)}`));
    const auth = await harness.next();
    expect(auth.type).toBe('auth_result');
    expect(auth.success).toBe(true);
    expect(typeof auth.sessionId).toBe('string');
    return harness;
  }

  function expectUpgradeRejected(query: string): Promise<UpgradeRejection> {
    return expectUpgradeRejectedAt(STREAM_PATH, query);
  }

  function expectUpgradeRejectedAt(
    requestPath: string,
    query: string
  ): Promise<UpgradeRejection> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}${requestPath}${query}`);
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

  /**
   * Send an upgrade request the way `curl -H 'Upgrade: foo'` would, over a raw
   * socket. The `ws` client cannot produce one -- it always sends a correct
   * handshake -- and these are exactly the requests `ws.handleUpgrade` answers
   * by returning without calling its callback.
   */
  function rawUpgradeRequest(
    targetPort: number,
    target: string,
    headers: Record<string, string>,
    method = 'GET'
  ): Promise<RawUpgradeResult> {
    return new Promise((resolve) => {
      const socket = net.connect(targetPort, '127.0.0.1');
      const chunks: Buffer[] = [];
      let settled = false;

      const finish = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        const raw = Buffer.concat(chunks).toString('utf8');
        const statusLine = raw.split('\r\n')[0] ?? '';
        const statusMatch = /^HTTP\/1\.1 (\d{3})/.exec(statusLine);
        const bodyStart = raw.indexOf('\r\n\r\n');
        const body = bodyStart >= 0 ? raw.slice(bodyStart + 4) : '';
        let code = '';
        try {
          const parsed: unknown = JSON.parse(body);
          if (isRecord(parsed) && typeof parsed.code === 'string') {
            code = parsed.code;
          }
        } catch {
          // Not our JSON refusal (ws writes HTML for the requests it refuses).
        }
        resolve({ statusCode: statusMatch ? Number(statusMatch[1]) : 0, code, raw });
      };

      const timer = setTimeout(finish, 3000);
      socket.on('connect', () => {
        const lines = [
          `${method} ${target} HTTP/1.1`,
          'Host: 127.0.0.1',
          ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
          '',
          '',
        ];
        socket.write(lines.join('\r\n'));
      });
      socket.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      socket.on('error', finish);
      socket.on('end', finish);
      socket.on('close', finish);
    });
  }

  /** A valid handshake request's headers, for the raw-socket tests. */
  function websocketHandshakeHeaders(): Record<string, string> {
    return {
      Connection: 'Upgrade',
      Upgrade: 'websocket',
      'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
      'Sec-WebSocket-Version': '13',
    };
  }

  async function waitForSessionCount(
    keyId: string,
    expected: number,
    timeoutMs = 3000,
    sessions: StreamSessionManager = sessionManager
  ): Promise<void> {
    const start = Date.now();
    while (sessions.countFor(keyId) !== expected) {
      if (Date.now() - start > timeoutMs) {
        throw new Error(
          `session count for ${keyId} was ${sessions.countFor(keyId)}, expected ${expected}`
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

    it('evicts expired tokens when the route issues a new one', async () => {
      // The production path for eviction: `issue()`, called by this route, on
      // the process-wide store. Nothing here calls `cleanup()` -- which is
      // exactly the distinction that hid the unbounded growth, since the only
      // caller of `cleanup()` used to be its own unit test.
      const stale = tokenStore.issue({
        apiKeyId: writerKeyId,
        graphId,
        permissions: ['write:events'],
        ttlMs: 1000,
        now: Date.now() - 10 * 60 * 1000,
      });
      expect(tokenStore.peek(stale.token)).toBeDefined();

      await requestToken(writerKey);

      expect(tokenStore.peek(stale.token)).toBeUndefined();
      expect(tokenStore.size).toBeGreaterThan(0);
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

    it('rejects a token whose snapshot claims a permission the key does not have', async () => {
      // The token says write:events; the key is read-only. A handler that
      // trusted the token's permission snapshot instead of re-resolving the key
      // would ACCEPT this connection, so this is the test that pins the
      // "re-resolve at connect" guarantee (the sibling test above mints the
      // token with the same permissions as the key, so it passes either way).
      const record = tokenStore.issue({
        apiKeyId: readOnlyKeyId,
        graphId,
        permissions: ['write:events'],
      });

      const rejection = await expectUpgradeRejected(`?token=${encodeURIComponent(record.token)}`);
      expect(rejection.statusCode).toBe(403);
      expect(rejection.code).toBe('PERMISSION_DENIED');
    });

    it('rejects a token whose key lost write:events after the token was issued', async () => {
      const key = await container.authService.createApiKey({
        name: 'Stream Permission Dropped',
        permissions: ['write:events'],
      });
      const token = await requestToken(key.key);

      await container.authService.updateApiKey(key.id, { permissions: ['read:events'] });

      const rejection = await expectUpgradeRejected(`?token=${encodeURIComponent(token)}`);
      expect(rejection.statusCode).toBe(403);
      expect(rejection.code).toBe('PERMISSION_DENIED');
    });

    it('rejects a token whose key was revoked after the token was issued', async () => {
      const key = await container.authService.createApiKey({
        name: 'Stream Key Revoked Before Connect',
        permissions: ['write:events'],
      });
      const record = tokenStore.issue({
        apiKeyId: key.id,
        graphId,
        permissions: ['write:events'],
      });

      await container.authService.revokeApiKey(key.id);

      const rejection = await expectUpgradeRejected(`?token=${encodeURIComponent(record.token)}`);
      expect(rejection.statusCode).toBe(401);
      expect(rejection.code).toBe('KEY_INVALID');
    });

    it('rejects a token whose key was deleted after the token was issued', async () => {
      const key = await container.authService.createApiKey({
        name: 'Stream Key Deleted Before Connect',
        permissions: ['write:events'],
      });
      const record = tokenStore.issue({
        apiKeyId: key.id,
        graphId,
        permissions: ['write:events'],
      });

      await container.authService.deleteApiKey(key.id);

      const rejection = await expectUpgradeRejected(`?token=${encodeURIComponent(record.token)}`);
      expect(rejection.statusCode).toBe(401);
      expect(rejection.code).toBe('KEY_INVALID');
    });

    it('rejects a token whose key is expired', async () => {
      const key = await container.authService.createApiKey({
        name: 'Stream Key Already Expired',
        permissions: ['write:events'],
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      });
      const record = tokenStore.issue({
        apiKeyId: key.id,
        graphId,
        permissions: ['write:events'],
      });

      const rejection = await expectUpgradeRejected(`?token=${encodeURIComponent(record.token)}`);
      expect(rejection.statusCode).toBe(401);
      expect(rejection.code).toBe('KEY_INVALID');
    });

    it('rejects a token that carries an unsafe graph id', async () => {
      const record = tokenStore.issue({
        apiKeyId: writerKeyId,
        graphId: '../../etc/passwd',
        permissions: ['write:events'],
      });

      const rejection = await expectUpgradeRejected(`?token=${encodeURIComponent(record.token)}`);
      expect(rejection.statusCode).toBe(400);
      expect(rejection.code).toBe('MALFORMED_TOKEN');
    });

    it('rejects an unknown upgrade path with 404', async () => {
      const rejection = await expectUpgradeRejectedAt('/api/ws/not-the-stream', '?token=anything');
      expect(rejection.statusCode).toBe(404);
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

        // Read it back: an ack that named a row which was never written would
        // otherwise pass.
        const scoped = await container.graphScopedRepositories(graphId);
        const persisted = await scoped.arcRepository.findById(ack.entityId as string);
        expect(persisted).not.toBeNull();
        expect(persisted?.name).toBe('Renaissance');
      } finally {
        await harness.close();
      }
    });

    it('acks a repository failure with success:false and creates nothing', async () => {
      // Unlike the missing-actor test above, this fails AFTER input conversion
      // and inside the repository call, which is where a swallowed error would
      // leave a client waiting or believing a write happened.
      const local = await startLocalHandler({
        deps: {
          graphScopedRepositories: async () => {
            throw new Error('repository unavailable');
          },
        },
      });
      try {
        const record = local.store.issue({
          apiKeyId: writerKeyId,
          graphId,
          permissions: ['write:events'],
        });
        const harness = await openHarness(local.url(record.token));
        expect((await harness.next()).success).toBe(true);

        sendJson(harness, {
          type: 'event',
          requestId: 'repo-fail',
          data: eventData('Repository failure event'),
        });

        const ack = await harness.next();
        expect(ack.type).toBe('ack');
        expect(ack.success).toBe(false);
        expect(ack.entityId).toBeNull();
        expect(ack.code).toBe('WRITE_FAILED');
        expect(String(ack.error)).toContain('repository unavailable');
        await harness.close();
      } finally {
        await local.stop();
      }
    });

    it('acks success when the entity persisted but its versioning record failed', async () => {
      // The event IS in the repository, so `success: false` would be a lie a
      // retrying client would answer by writing a duplicate. The failure is
      // reported as a warning frame instead.
      const local = await startLocalHandler({
        deps: {
          graphWriteVersioningService: {
            recordEvent: async () => {
              throw new Error('version store unavailable');
            },
            recordArc: async () => {
              throw new Error('version store unavailable');
            },
          },
        },
      });
      try {
        const record = local.store.issue({
          apiKeyId: writerKeyId,
          graphId,
          permissions: ['write:events'],
        });
        const harness = await openHarness(local.url(record.token));
        expect((await harness.next()).success).toBe(true);

        sendJson(harness, {
          type: 'event',
          requestId: 'version-fail',
          data: eventData('Versioning failure event'),
        });

        const warning = await harness.next();
        expect(warning.type).toBe('warning');
        expect(String(warning.message)).toContain('versioning');
        expect(typeof warning.entityId).toBe('string');

        const ack = await harness.next();
        expect(ack.type).toBe('ack');
        expect(ack.success).toBe(true);
        expect(ack.entityId).toBe(warning.entityId);

        // The ack must describe what persisted, and it did persist.
        const scoped = await container.graphScopedRepositories(graphId);
        const persisted = await scoped.eventRepository.findById(ack.entityId as string);
        expect(persisted).not.toBeNull();
        expect(persisted?.description).toBe('Versioning failure event');
        await harness.close();
      } finally {
        await local.stop();
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
    it('terminates live sockets so a real HTTP server can close', async () => {
      // Scope note: this drives `StreamHandler.close()` directly against a
      // handler and server built here. It therefore does NOT prove that
      // `Application.start`/`shutdown` in src/index.ts attaches or closes the
      // handler; that is covered by src/tests/integration/stream-shutdown.test.ts
      // (real Application) and src/tests/unit/shutdown.test.ts (ordering).
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

  describe('upgrade validation and slot release', () => {
    it('refuses requests that are not a WebSocket upgrade without reserving a slot', async () => {
      const cases: Array<{ name: string; headers: Record<string, string>; method?: string; status: number }> = [
        {
          name: 'a non-WebSocket Upgrade header',
          headers: { Connection: 'Upgrade', Upgrade: 'foo' },
          status: 400,
        },
        {
          name: 'a missing Sec-WebSocket-Key',
          headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13' },
          status: 400,
        },
        {
          name: 'an unsupported Sec-WebSocket-Version',
          headers: { ...websocketHandshakeHeaders(), 'Sec-WebSocket-Version': '99' },
          status: 400,
        },
        {
          name: 'a non-GET method',
          headers: { ...websocketHandshakeHeaders() },
          method: 'POST',
          status: 405,
        },
      ];

      for (const testCase of cases) {
        const token = await requestToken(limitedKey);
        const result = await rawUpgradeRequest(
          port,
          `${STREAM_PATH}?token=${encodeURIComponent(token)}`,
          testCase.headers,
          testCase.method
        );
        expect(
          { name: testCase.name, status: result.statusCode },
          testCase.name
        ).toEqual({ name: testCase.name, status: testCase.status });
        expect(result.code, testCase.name).toBe('UPGRADE_INVALID');

        // Nothing was reserved, so the (concurrentStreams: 1) key still has its
        // slot, and the unconsumed token still works.
        expect(sessionManager.countFor(limitedKeyId), testCase.name).toBe(0);
        const accepted = await connectAccepted(token);
        await accepted.close();
        await waitForSessionCount(limitedKeyId, 0);
      }
    });

    it('does not leak a slot across repeated refused upgrades', async () => {
      // The review's reproduction: five bad upgrade requests with valid tokens.
      // If each reserved a slot, the key (concurrentStreams: 1) would be locked
      // out of streaming until the process restarted.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const token = await requestToken(limitedKey);
        const result = await rawUpgradeRequest(
          port,
          `${STREAM_PATH}?token=${encodeURIComponent(token)}`,
          { Connection: 'Upgrade', Upgrade: 'foo' }
        );
        expect(result.statusCode).toBe(400);
      }

      await waitForSessionCount(limitedKeyId, 0);

      // A valid client can still stream with the same key.
      const token = await requestToken(limitedKey);
      const harness = await connectAccepted(token);
      try {
        sendJson(harness, {
          type: 'event',
          requestId: 'after-bad-upgrades',
          data: eventData('Event after five refused upgrades'),
        });
        const ack = await harness.next();
        expect(ack.success).toBe(true);
      } finally {
        await harness.close();
      }
      await waitForSessionCount(limitedKeyId, 0);
    });

    it('releases a reservation whose handshake never completes', async () => {
      const local = await startLocalHandler({ reservationTimeoutMs: 150 });
      const refusedByWs: string[] = [];
      const onClientError = (error: Error): void => {
        refusedByWs.push(error.message);
      };
      // Attaching a `wsClientError` listener changes `ws` behaviour: it stops
      // destroying the socket, so the handshake neither completes nor fails.
      // Only the reservation timeout can free the slot in that case.
      local.handler.webSocketServer.on('wsClientError', onClientError);
      try {
        const record = local.store.issue({
          apiKeyId: limitedKeyId,
          graphId,
          permissions: ['write:events'],
        });
        const client = net.connect(local.port, '127.0.0.1');
        const closed = new Promise<void>((resolve) => client.once('close', () => resolve()));
        await new Promise<void>((resolve) => client.once('connect', () => resolve()));
        client.write(
          [
            `GET ${STREAM_PATH}?token=${encodeURIComponent(record.token)} HTTP/1.1`,
            'Host: 127.0.0.1',
            ...Object.entries(websocketHandshakeHeaders()).map(([n, v]) => `${n}: ${v}`),
            'Sec-WebSocket-Protocol: not a valid token',
            '',
            '',
          ].join('\r\n')
        );

        // Reserved first...
        await waitForSessionCount(limitedKeyId, 1, 3000, local.sessionManager);
        // ...then reclaimed by the timeout, with no callback and no close event
        // to have done it.
        await waitForSessionCount(limitedKeyId, 0, 3000, local.sessionManager);
        expect(refusedByWs).toHaveLength(1);

        // The timeout also destroys the socket it gave up on.
        await Promise.race([
          closed,
          new Promise<void>((_resolve, reject) =>
            setTimeout(
              () => reject(new Error('reservation timeout did not destroy the socket')),
              3000
            )
          ),
        ]);
      } finally {
        local.handler.webSocketServer.off('wsClientError', onClientError);
        await local.stop();
      }
    });

    it('releases the reservation when the socket dies without a handshake callback', async () => {
      // The server is already closed, so `ws` answers 503 and destroys the
      // socket without ever calling its callback. The reservation timeout is
      // set far beyond this test's window, so only the socket's own close can
      // have released the slot.
      const local = await startLocalHandler({ reservationTimeoutMs: 5000 });
      try {
        const record = local.store.issue({
          apiKeyId: limitedKeyId,
          graphId,
          permissions: ['write:events'],
        });
        await local.handler.close();

        const result = await rawUpgradeRequest(
          local.port,
          `${STREAM_PATH}?token=${encodeURIComponent(record.token)}`,
          websocketHandshakeHeaders()
        );
        expect(result.statusCode).toBe(503);

        await waitForSessionCount(limitedKeyId, 0, 1500, local.sessionManager);
      } finally {
        await local.stop();
      }
    });

    it('installs a socket error listener before the first await', async () => {
      // `ws` attaches its own listener only inside `handleUpgrade`, which runs
      // after authorisation. A peer reset in that window is an uncaught 'error'
      // event on the socket unless one is attached first; a bogus token reaches
      // the window with no credentials.
      const local = await startLocalHandler();
      const netServer = net.createServer();
      try {
        const accepted = new Promise<net.Socket>((resolve) => netServer.once('connection', resolve));
        await new Promise<void>((resolve) => netServer.listen(0, '127.0.0.1', resolve));
        const netAddress = netServer.address();
        if (!netAddress || typeof netAddress === 'string') {
          throw new Error('helper server did not expose a port');
        }
        const client = net.connect(netAddress.port, '127.0.0.1');
        const serverSocket = await accepted;

        const record = local.store.issue({
          apiKeyId: limitedKeyId,
          graphId,
          permissions: ['write:events'],
        });
        const req = new IncomingMessage(new net.Socket());
        req.method = 'GET';
        req.url = `${STREAM_PATH}?token=${encodeURIComponent(record.token)}`;
        req.headers = websocketHandshakeHeaders();

        const pending = local.handler.handleUpgrade(req, serverSocket, Buffer.alloc(0));

        // The assertion is made synchronously, before any await can run.
        expect(serverSocket.listenerCount('error')).toBeGreaterThan(0);

        // Emitting an error with no listener throws and fails the run.
        serverSocket.emit('error', new Error('ECONNRESET'));
        serverSocket.destroy();
        client.destroy();
        await pending;

        // Nothing was reserved for a socket that had already failed.
        expect(local.sessionManager.countFor(limitedKeyId)).toBe(0);
      } finally {
        await local.stop();
        await new Promise<void>((resolve) => netServer.close(() => resolve()));
      }
    });
  });

  describe('per-message authorisation', () => {
    it('refuses writes after the key is revoked mid-session', async () => {
      const key = await container.authService.createApiKey({
        name: 'Stream Revoked Mid Session',
        permissions: ['write:events'],
      });
      const token = await requestToken(key.key);
      const harness = await connectAccepted(token);
      try {
        await container.authService.revokeApiKey(key.id);

        sendJson(harness, {
          type: 'event',
          requestId: 'after-revoke',
          data: eventData('Write after revocation'),
        });

        const ack = await harness.next();
        expect(ack.type).toBe('ack');
        expect(ack.success).toBe(false);
        expect(ack.code).toBe('KEY_INVALID');

        // The socket is dropped too, so a revoked key cannot keep a session.
        const errorFrame = await harness.next();
        expect(errorFrame.type).toBe('error');
        expect(errorFrame.code).toBe('KEY_INVALID');
      } finally {
        await harness.close();
      }
    });

    it('refuses writes after the key is deleted mid-session', async () => {
      const key = await container.authService.createApiKey({
        name: 'Stream Deleted Mid Session',
        permissions: ['write:events'],
      });
      const token = await requestToken(key.key);
      const harness = await connectAccepted(token);
      try {
        await container.authService.deleteApiKey(key.id);

        sendJson(harness, {
          type: 'event',
          requestId: 'after-delete',
          data: eventData('Write after deletion'),
        });

        const ack = await harness.next();
        expect(ack.success).toBe(false);
        expect(ack.code).toBe('KEY_INVALID');
      } finally {
        await harness.close();
      }
    });

    it('enforces a permission removed mid-session on the next message', async () => {
      const key = await container.authService.createApiKey({
        name: 'Stream Permission Downgraded Mid Session',
        permissions: ['write:events', 'write:arcs'],
      });
      const token = await requestToken(key.key);
      const harness = await connectAccepted(token);
      try {
        await container.authService.updateApiKey(key.id, { permissions: ['write:events'] });

        sendJson(harness, { type: 'arc', requestId: 'arc-denied', data: arcData('Denied Arc') });
        const denied = await harness.next();
        expect(denied.success).toBe(false);
        expect(denied.code).toBe('PERMISSION_DENIED');

        // The permission it still has keeps working.
        sendJson(harness, {
          type: 'event',
          requestId: 'event-allowed',
          data: eventData('Allowed after downgrade'),
        });
        const allowed = await harness.next();
        expect(allowed.success).toBe(true);
      } finally {
        await harness.close();
      }
    });
  });

  describe('session lifetime', () => {
    it('drops a session that sits past its idle timeout', async () => {
      const local = await startLocalHandler({
        sessionManager: new StreamSessionManager({ idleTimeoutMs: 120, maxLifetimeMs: 60_000 }),
        sweepIntervalMs: 40,
      });
      try {
        const record = local.store.issue({
          apiKeyId: writerKeyId,
          graphId,
          permissions: ['write:events'],
        });
        const harness = await openHarness(local.url(record.token));
        expect((await harness.next()).success).toBe(true);

        // No message is sent: the sweep timer must reclaim the slot itself.
        const expiry = await harness.next(3000);
        expect(expiry.type).toBe('error');
        expect(expiry.code).toBe('SESSION_EXPIRED');
        expect(String(expiry.message)).toContain('idle');

        await new Promise<void>((resolve) => harness.ws.once('close', () => resolve()));
        expect(local.sessionManager.totalCount).toBe(0);
      } finally {
        await local.stop();
      }
    });

    it('refuses a write from a session that outlived its maximum lifetime', async () => {
      const local = await startLocalHandler({
        sessionManager: new StreamSessionManager({ maxLifetimeMs: 100, idleTimeoutMs: 60_000 }),
        // The timer must not race the message: the message path itself has to
        // notice the expiry.
        sweepIntervalMs: 60_000,
      });
      try {
        const record = local.store.issue({
          apiKeyId: writerKeyId,
          graphId,
          permissions: ['write:events'],
        });
        const harness = await openHarness(local.url(record.token));
        expect((await harness.next()).success).toBe(true);

        await new Promise((resolve) => setTimeout(resolve, 150));
        sendJson(harness, {
          type: 'event',
          requestId: 'after-lifetime',
          data: eventData('Write after lifetime'),
        });

        const expiry = await harness.next();
        expect(expiry.type).toBe('error');
        expect(expiry.code).toBe('SESSION_EXPIRED');
        expect(String(expiry.message)).toContain('lifetime');
      } finally {
        await local.stop();
      }
    });
  });

  describe('sessions that are no longer live', () => {
    /**
     * The review's reproduction, kept as the first test on purpose.
     *
     * When a session expires, the message that notices the expiry removes it
     * from the manager. `expiredReason` then answers `undefined` for that same
     * id -- the answer a LIVE session gets -- so the NEXT message was treated as
     * live and its write was persisted, with no live session behind it. Every
     * test here sends at least two messages and then reads the entities back
     * from the graph-scoped repository: the ack cannot be trusted here, and in
     * fact is never delivered, because the refusal that closes the socket also
     * stops the queued ack from being written.
     */
    it('refuses a SECOND message after the maximum lifetime and persists neither', async () => {
      const actor = 'Post Lifetime Actor';
      const repositoryCalls: string[] = [];
      const local = await startLocalHandler({
        sessionManager: new StreamSessionManager({ maxLifetimeMs: 100, idleTimeoutMs: 60_000 }),
        // The timer must not race the messages: the message path itself has to
        // notice the expiry.
        sweepIntervalMs: 60_000,
        deps: {
          graphScopedRepositories: async (id) => {
            repositoryCalls.push(id);
            return container.graphScopedRepositories(id);
          },
        },
      });
      try {
        const record = local.store.issue({
          apiKeyId: writerKeyId,
          graphId,
          permissions: ['write:events'],
        });
        const harness = await openHarness(local.url(record.token));
        expect((await harness.next()).success).toBe(true);

        await settle(150);

        sendJson(harness, {
          type: 'event',
          requestId: 'after-lifetime-1',
          data: eventDataForActor(actor, 'First write after the lifetime'),
        });
        sendJson(harness, {
          type: 'event',
          requestId: 'after-lifetime-2',
          data: eventDataForActor(actor, 'Second write after the lifetime'),
        });

        const first = await harness.next();
        expect(first.type).toBe('error');
        expect(first.code).toBe('SESSION_EXPIRED');
        expect(String(first.message)).toContain('lifetime');

        // And the slot is free NOW, not at the next sweep: the sweep interval in
        // this handler is a minute away, so counting zero here can only come
        // from the refusal itself removing the session.
        expect(local.sessionManager.countFor(writerKeyId)).toBe(0);

        // The repository is the authority, not the ack: nothing may have been
        // written for this actor, and the repository may not even have been
        // reached. The settle window is what a buggy second write would have
        // needed to land in.
        await settle();
        expect(repositoryCalls).toEqual([]);
        expect(await persistedForActor(actor)).toBe(0);
      } finally {
        await local.stop();
      }
    });

    it('refuses a SECOND message after the idle timeout and persists neither', async () => {
      const actor = 'Post Idle Actor';
      const repositoryCalls: string[] = [];
      const local = await startLocalHandler({
        sessionManager: new StreamSessionManager({ idleTimeoutMs: 120, maxLifetimeMs: 60_000 }),
        sweepIntervalMs: 60_000,
        deps: {
          graphScopedRepositories: async (id) => {
            repositoryCalls.push(id);
            return container.graphScopedRepositories(id);
          },
        },
      });
      try {
        const record = local.store.issue({
          apiKeyId: writerKeyId,
          graphId,
          permissions: ['write:events'],
        });
        const harness = await openHarness(local.url(record.token));
        expect((await harness.next()).success).toBe(true);

        // The client is silent past the idle window. The sweep interval is far
        // beyond the test, so only the message path can notice -- which is also
        // what makes the "checked before the message counts as activity"
        // ordering load-bearing: a handler that records the message first
        // refreshes `lastActivityAt` and revives the session instead of
        // refusing it.
        await settle(200);

        sendJson(harness, {
          type: 'event',
          requestId: 'after-idle-1',
          data: eventDataForActor(actor, 'First write after the idle timeout'),
        });
        sendJson(harness, {
          type: 'event',
          requestId: 'after-idle-2',
          data: eventDataForActor(actor, 'Second write after the idle timeout'),
        });

        const first = await harness.next();
        expect(first.type).toBe('error');
        expect(first.code).toBe('SESSION_EXPIRED');
        expect(String(first.message)).toContain('idle');

        await settle();
        expect(repositoryCalls).toEqual([]);
        expect(await persistedForActor(actor)).toBe(0);
      } finally {
        await local.stop();
      }
    });

    it('refuses writes for a session the sweep already removed', async () => {
      const actor = 'Post Sweep Actor';
      const repositoryCalls: string[] = [];
      const local = await startLocalHandler({
        sessionManager: new StreamSessionManager({ idleTimeoutMs: 120, maxLifetimeMs: 60_000 }),
        // The handler's own sweep closes the socket it sweeps, so its timer is
        // held out of the way: this is the window between "the session is gone
        // from the manager" and "the socket is closed", which is exactly where
        // the old code let a write through.
        sweepIntervalMs: 60_000,
        deps: {
          graphScopedRepositories: async (id) => {
            repositoryCalls.push(id);
            return container.graphScopedRepositories(id);
          },
        },
      });
      try {
        const record = local.store.issue({
          apiKeyId: writerKeyId,
          graphId,
          permissions: ['write:events'],
        });
        const harness = await openHarness(local.url(record.token));
        expect((await harness.next()).success).toBe(true);

        await settle(200);
        const swept = local.sessionManager.sweep();
        expect(swept).toHaveLength(1);
        expect(local.sessionManager.totalCount).toBe(0);
        // The socket is still open: only the message path can refuse now.
        expect(harness.ws.readyState).toBe(WebSocket.OPEN);

        sendJson(harness, {
          type: 'event',
          requestId: 'after-sweep-1',
          data: eventDataForActor(actor, 'First write after the sweep'),
        });
        sendJson(harness, {
          type: 'event',
          requestId: 'after-sweep-2',
          data: eventDataForActor(actor, 'Second write after the sweep'),
        });

        const first = await harness.next();
        expect(first.type).toBe('error');
        expect(first.code).toBe('SESSION_EXPIRED');

        await settle();
        expect(repositoryCalls).toEqual([]);
        expect(await persistedForActor(actor)).toBe(0);
      } finally {
        await local.stop();
      }
    });

    it('refuses a write whose session expires while the key is being re-resolved', async () => {
      // `onMessage` can only check the session before the awaits, and the write
      // path awaits the key lookup before it touches the repository. A session
      // that expires inside that window must not persist anything: otherwise
      // the lifetime limit is only as strict as the repository's latency.
      const actor = 'Expired Mid Write Actor';
      const local = await startLocalHandler({
        sessionManager: new StreamSessionManager({ maxLifetimeMs: 120, idleTimeoutMs: 60_000 }),
        sweepIntervalMs: 60_000,
        deps: {
          authService: {
            async getApiKey(id: string) {
              await settle(250);
              return container.authService.getApiKey(id);
            },
          },
        },
      });
      try {
        const record = local.store.issue({
          apiKeyId: writerKeyId,
          graphId,
          permissions: ['write:events'],
        });
        const harness = await openHarness(local.url(record.token));
        // The session's clock starts after the (slow) connect-time resolution,
        // so the message below is accepted by the check at the top of
        // `onMessage` and only expires during the second resolution.
        expect((await harness.next()).success).toBe(true);

        sendJson(harness, {
          type: 'event',
          requestId: 'expires-mid-write',
          data: eventDataForActor(actor, 'Write that outlives the session'),
        });

        const ack = await harness.next();
        expect(ack.type).toBe('ack');
        expect(ack.success).toBe(false);
        expect(ack.code).toBe('SESSION_EXPIRED');
        // The entity was never created, so there is nothing to read back.
        expect(await persistedForActor(actor)).toBe(0);
      } finally {
        await local.stop();
      }
    });
  });

  describe('message rate limiting and bounds', () => {
    it('charges the per-key request limit for stream writes', async () => {
      const key = await container.authService.createApiKey({
        name: 'Stream Rate Limited Writes',
        permissions: ['write:events'],
        rateLimit: { requestsPerMinute: 3, requestsPerHour: 100, requestsPerDay: 100 },
      });
      // The token request itself spends one of the three.
      const token = await requestToken(key.key);
      const harness = await connectAccepted(token);
      try {
        const outcomes: boolean[] = [];
        for (let index = 0; index < 3; index += 1) {
          sendJson(harness, {
            type: 'event',
            requestId: `rate-${index}`,
            data: eventData(`Rate limited event ${index}`),
          });
          const ack = await harness.next();
          expect(ack.requestId).toBe(`rate-${index}`);
          outcomes.push(ack.success === true);
          if (!ack.success) {
            expect(ack.code).toBe('RATE_LIMITED');
            expect(String(ack.error)).toContain('Rate limit exceeded');
          }
        }
        // Two writes fit in the remaining budget; the third is refused.
        expect(outcomes).toEqual([true, true, false]);
      } finally {
        await harness.close();
      }
    });

    it('bounds how many writes one session may have in flight', async () => {
      let releaseGate: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        releaseGate = resolve;
      });
      const local = await startLocalHandler({
        maxInFlightWrites: 1,
        deps: {
          graphScopedRepositories: async (id) => {
            // Held open so the first write is still in flight when the second
            // message arrives.
            await gate;
            return container.graphScopedRepositories(id);
          },
        },
      });
      try {
        const record = local.store.issue({
          apiKeyId: writerKeyId,
          graphId,
          permissions: ['write:events'],
        });
        const harness = await openHarness(local.url(record.token));
        expect((await harness.next()).success).toBe(true);

        sendJson(harness, { type: 'event', requestId: 'gate-1', data: eventData('Gated 1') });
        sendJson(harness, { type: 'event', requestId: 'gate-2', data: eventData('Gated 2') });

        const refused = await harness.next();
        expect(refused.requestId).toBe('gate-2');
        expect(refused.success).toBe(false);
        expect(refused.code).toBe('CONCURRENT_WRITE_LIMIT');

        releaseGate();
        const accepted = await harness.next();
        expect(accepted.requestId).toBe('gate-1');
        expect(accepted.success).toBe(true);
        await harness.close();
      } finally {
        releaseGate();
        await local.stop();
      }
    });

    it('refuses a frame larger than the configured maximum payload', async () => {
      const local = await startLocalHandler({ maxPayloadBytes: 512 });
      try {
        const record = local.store.issue({
          apiKeyId: writerKeyId,
          graphId,
          permissions: ['write:events'],
        });
        const harness = await openHarness(local.url(record.token));
        expect((await harness.next()).success).toBe(true);

        const closed = new Promise<number>((resolve) =>
          harness.ws.once('close', (code: number) => resolve(code))
        );
        harness.ws.send(
          JSON.stringify({
            type: 'event',
            requestId: 'oversize',
            data: { ...eventData('Oversize event'), padding: 'x'.repeat(2048) },
          })
        );

        // 1009 = message too big. Without a configured maxPayload the 100 MiB
        // `ws` default would accept this.
        await expect(closed).resolves.toBe(1009);
      } finally {
        await local.stop();
      }
    });

    it('defaults the payload limit to a small value rather than the ws default', async () => {
      const { handler: defaulted } = buildHandler(new StreamTokenStore());
      try {
        expect(defaulted.maxPayloadBytes).toBe(STREAM_MAX_PAYLOAD_BYTES);
        expect(defaulted.maxPayloadBytes).toBeLessThanOrEqual(1024 * 1024);
      } finally {
        await defaulted.close();
      }
    });
    it('defaults the outbound buffer limit to a bounded value', async () => {
      const { handler: defaulted } = buildHandler(new StreamTokenStore());
      try {
        expect(defaulted.maxBufferedBytes).toBe(STREAM_MAX_BUFFERED_BYTES);
        expect(defaulted.maxBufferedBytes).toBeLessThanOrEqual(1024 * 1024);
      } finally {
        await defaulted.close();
      }
    });

    it('bounds what the server sends back: a stalled socket is closed, not queued', async () => {
      const actor = 'Backpressure Actor';
      const local = await startLocalHandler({
        maxBufferedBytes: 64 * 1024,
        deps: oversizedWarningDeps(),
      });
      try {
        const record = local.store.issue({
          apiKeyId: writerKeyId,
          graphId,
          permissions: ['write:events'],
        });
        const harness = await openHarness(local.url(record.token));
        expect((await harness.next()).success).toBe(true);

        // The client stops consuming. From here on everything the server writes
        // stays on the socket, which is the situation the outbound bound exists
        // for: `maxPayload` and the in-flight cap bound what the client SENDS,
        // and say nothing about what the server sends back.
        harness.ws.pause();

        sendJson(harness, {
          type: 'event',
          requestId: 'over-limit-1',
          data: eventDataForActor(actor, 'First write'),
        });
        await waitForBufferedOver(local, 64 * 1024);

        // A write that arrives while the socket is over the limit is refused
        // BEFORE the repository: the ack for it could not be delivered, so
        // persisting it would be work with no client able to hear about it.
        sendJson(harness, {
          type: 'event',
          requestId: 'over-limit-2',
          data: eventDataForActor(actor, 'Second write'),
        });

        const closed = new Promise<number>((resolve) =>
          harness.ws.once('close', (code: number) => resolve(code))
        );
        harness.ws.resume();

        // The one frame the server wrote before the limit was reached...
        const warning = await harness.next(5000);
        expect(warning.type).toBe('warning');
        // ...then the socket is closed for backpressure rather than handed the
        // acks it is not reading.
        expect(await closed).toBe(STREAM_BACKPRESSURE_CLOSE_CODE);
        await expect(harness.next(2000)).rejects.toThrow(/socket closed/);

        // Only the first write reached the graph: the second was refused, not
        // persisted and then forgotten.
        expect(await persistedForActor(actor)).toBe(1);
      } finally {
        await local.stop();
      }
    });

    it('applies the configured outbound limit instead of refusing every write', async () => {
      // The same oversized frame and the same stalled client, with a limit ABOVE
      // what the socket is holding. Nothing may be dropped and the ack must
      // still arrive: that is what makes the limit a threshold rather than an
      // unconditional refusal.
      const actor = 'Backpressure Below Limit Actor';
      const local = await startLocalHandler({
        maxBufferedBytes: 32 * 1024 * 1024,
        deps: oversizedWarningDeps(),
      });
      try {
        const record = local.store.issue({
          apiKeyId: writerKeyId,
          graphId,
          permissions: ['write:events'],
        });
        const harness = await openHarness(local.url(record.token));
        expect((await harness.next()).success).toBe(true);

        harness.ws.pause();
        sendJson(harness, {
          type: 'event',
          requestId: 'under-limit-1',
          data: eventDataForActor(actor, 'Write that fits under the limit'),
        });
        // The socket really is holding megabytes -- more than the OTHER test's
        // limit -- so the ack below is sent with a huge backlog outstanding.
        await waitForBufferedOver(local, 8 * 1024 * 1024);
        harness.ws.resume();

        const warning = await harness.next(5000);
        expect(warning.type).toBe('warning');
        const ack = await harness.next(5000);
        expect(ack.type).toBe('ack');
        expect(ack.success).toBe(true);
        expect(harness.ws.readyState).toBe(WebSocket.OPEN);
        expect(await persistedForActor(actor)).toBe(1);
        await harness.close();
      } finally {
        await local.stop();
      }
    });
  });
});
