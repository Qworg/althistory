/**
 * WebSocket stream handler (requirement 16, tasks 5.1/5.2/5.3).
 *
 * Connection path:
 *   1. The client upgrades `GET /api/ws/stream?token=<token>`.
 *   2. The upgrade REQUEST is validated first (method, `Upgrade: websocket`,
 *      `Sec-WebSocket-Key`, `Sec-WebSocket-Version`) and refused if it is not a
 *      request `ws` would complete. This runs before the token is consumed and
 *      before any concurrency slot is reserved: `ws.handleUpgrade` refuses those
 *      same requests by returning WITHOUT ever calling its callback, so any
 *      resource reserved before it would be reserved forever.
 *   3. The token is consumed from the token store. Unknown, malformed, expired
 *      and replayed tokens are refused at the HTTP upgrade with a non-101
 *      response, so no WebSocket session is ever created for them.
 *   4. The API key the token was issued to is re-resolved from the repository.
 *      A missing/inactive/expired key is refused. This is what makes the token
 *      "tied to an API key" mean something after issue.
 *   5. The key must still hold `write:events`, and must be allowed to access the
 *      token's graph. A valid token whose key lacks the permission is refused
 *      (403), not merely checked for existence.
 *   6. The key's `concurrentStreams` limit is enforced through
 *      `StreamSessionManager.tryOpen`; the N+1th connection is refused (429).
 *   7. Only then is the socket accepted and an `auth_result` sent.
 *
 * Connecting without leaking a slot:
 *   The slot reserved in step 6 is released by listeners installed on the RAW
 *   socket (`error` and `close`) plus a reservation timeout, in addition to the
 *   per-path cleanup. The socket is the resource the slot is bound to, so the
 *   release cannot be forgotten on a code path added later: whatever ends the
 *   socket -- `ws` destroying it for a failed handshake, the peer resetting, the
 *   reservation timing out -- releases the slot. The `error` listener is
 *   installed as the first statement of `handleUpgrade`, before any validation
 *   or await, because `ws` only installs its own listener later; a reset in that
 *   window would otherwise be an uncaught `'error'` event that takes the process
 *   down (a bogus token reaches that window with no credentials).
 *
 * Per-message checks (repeated on every write, not just at connect):
 *   - the API key is re-resolved from the repository, so revoking, deactivating,
 *     expiring or deleting a key -- or removing `write:events`/`write:arcs` --
 *     is enforced on the next message instead of only on the next connection;
 *   - the key's request rate limit (minute/hour/day) is charged for the message,
 *     so the HTTP limit cannot be bypassed by moving writes onto the socket;
 *   - at most `maxInFlightWrites` writes may be outstanding per session, which
 *     bounds how much work a client can have in flight without waiting;
 *   - the session must be inside `maxLifetimeMs` of its connect and inside
 *     `idleTimeoutMs` of its last message (also swept on a timer), which bounds
 *     how long a session -- and the concurrency slot it holds -- can outlive
 *     the key's authority over it;
 *   - the session id must still be one the manager holds. A session that was
 *     expired, swept, closed or released is refused on every later message
 *     (`refusalReason` reports `unknown`), and the same check runs again
 *     immediately before an entity is persisted, so a session that dies while
 *     its write is being authorised cannot persist either.
 *
 * Outbound bound (the inbound limits above say nothing about what the server
 * sends back):
 *   - no frame is handed to `ws.send` while the socket is already holding
 *     `maxBufferedBytes` of unsent data (`ws.bufferedAmount`). Such a socket is
 *     closed with 1013 instead of being handed a queue that grows without
 *     limit, because a peer that is not consuming what the server already sent
 *     cannot be caught up by writing more;
 *   - a write message that arrives while the socket is over that limit is
 *     refused BEFORE it reaches the repository, so the server does not persist
 *     work whose acknowledgement it cannot deliver.
 *
 * Every `event`/`arc` message is answered with an `ack` carrying `success: true`
 * and the created id, or `success: false`, the error and a machine-readable
 * `code`.
 *
 * Not implemented here (stated so it is not mistaken for done):
 *   - requirement 16.4 validation WARNINGS are emitted only for the narrow
 *     "entity persisted, versioning record failed" case. There is still no
 *     non-fatal validator on the stream path, so a repository validation failure
 *     is acked as an error instead of being warned about and accepted.
 *   - the token store is per-process, not Redis-backed. It is evicted on issue
 *     and on a timer (see `StreamTokenStore`).
 *   - the outbound bound REFUSES and closes; it does not pause the reader
 *     (`ws.pause`) or wait for a drain before the next write. A socket over
 *     `maxBufferedBytes` is dropped with 1013 rather than slowed down, so a
 *     client that is merely slow is treated the same as one that has stopped
 *     reading.
 */

import type { IncomingMessage, Server as HttpServer } from 'http';
import type { Duplex } from 'stream';
import { WebSocketServer, WebSocket } from 'ws';
import type { RawData } from 'ws';
import { createLogger } from '@/utils/logger';
import type { ILogger } from '@/utils/logger';
import type { ApiKey, Permission, RateLimitConfig } from '@/models/ApiKey';
import { assertSafeGraphId } from '@/utils/GraphContextStore';
import type { GraphScopedRepositories } from '@/container';
import { StreamTokenStore } from './StreamTokenStore';
import { StreamSessionManager } from './StreamSession';
import type { StreamSession, StreamSessionRefusalReason } from './StreamSession';
import type { CreateEventRequest } from '@/models/Event';
import type { CreateArcRequest } from '@/models/Arc';
import {
  isRecord,
  readNonEmptyString,
} from './StreamProtocol';
import type { ServerMessage, StreamErrorCode } from './StreamProtocol';

/** The single WebSocket endpoint this handler serves. */
export const STREAM_PATH = '/api/ws/stream';

/** Permission required to open a stream and to write events over it. */
export const STREAM_REQUIRED_PERMISSION: Permission = 'write:events';

/**
 * Largest single WebSocket frame accepted. `ws` defaults to 100 MiB, which
 * lets one client buffer more memory than the whole test/dev payload budget;
 * 1 MiB is far more than a single event or arc needs.
 */
export const STREAM_MAX_PAYLOAD_BYTES = 1024 * 1024;

/** How many writes one session may have outstanding at a time. */
export const DEFAULT_MAX_IN_FLIGHT_WRITES = 4;

/**
 * How many bytes of data the server may have queued on one socket without the
 * client having consumed them.
 *
 * `maxPayload` bounds one inbound frame and the in-flight cap bounds concurrent
 * work, but neither says anything about what the server sends BACK: a client
 * that stops reading would otherwise make the server queue ack frames until it
 * runs out of memory. 1 MiB is far more than a burst of acks can need, so only
 * a client that has stopped reading can reach it.
 */
export const STREAM_MAX_BUFFERED_BYTES = 1024 * 1024;

/** Close code for a socket that stopped consuming what the server sent. */
export const STREAM_BACKPRESSURE_CLOSE_CODE = 1013;

/**
 * How long a reserved-but-not-yet-established session may wait for the
 * handshake to complete before its slot is reclaimed and the socket destroyed.
 */
export const STREAM_RESERVATION_TIMEOUT_MS = 10 * 1000;

/** How often live sessions are checked for expiry and closed. */
export const DEFAULT_SESSION_SWEEP_INTERVAL_MS = 30 * 1000;

/** Minimal API-key lookup the connection path needs. */
export interface StreamKeyResolver {
  getApiKey(id: string): Promise<ApiKey | null>;
}

/**
 * Minimal rate-limit lookup the per-message path needs.
 *
 * `RateLimitService` satisfies this structurally; declared narrowly so tests
 * can pass a fake without importing the service's configuration.
 */
export interface StreamRateLimiter {
  recordRequest(
    keyId: string,
    config: RateLimitConfig
  ): { allowed: boolean; limit: string; retryAfter?: number };
}

/**
 * Write-side dependencies.
 *
 * Declared structurally so tests can supply a small fake and so the handler does
 * not import the whole container. `graphScopedRepositories` is the only way the
 * handler reaches graph data, mirroring the HTTP routes.
 */
export interface StreamWriteDeps {
  authService: StreamKeyResolver;
  graphScopedRepositories(graphId: string): Promise<GraphScopedRepositories>;
  graphWriteVersioningService: {
    recordEvent(graphId: string, event: Awaited<ReturnType<GraphScopedRepositories['eventRepository']['create']>>, operation: 'create'): Promise<void>;
    recordArc(graphId: string, arc: Awaited<ReturnType<GraphScopedRepositories['arcRepository']['create']>>, operation: 'create'): Promise<void>;
  };
  /**
   * When present, every write message is charged against the key's request rate
   * limit. Optional so a handler can be built without one, but production always
   * passes the container's service -- a stream that skipped the limit would be a
   * hole in the same limit the HTTP routes enforce.
   */
  rateLimitService?: StreamRateLimiter;
}

export interface StreamHandlerOptions {
  tokenStore: StreamTokenStore;
  sessionManager: StreamSessionManager;
  deps: StreamWriteDeps;
  logger?: ILogger;
  /** Largest accepted frame. Defaults to `STREAM_MAX_PAYLOAD_BYTES`. */
  maxPayloadBytes?: number;
  /** Concurrent outstanding writes per session. Defaults to 4, minimum 1. */
  maxInFlightWrites?: number;
  /** Reserved-slot lifetime before the handshake completes. Defaults to 10s. */
  reservationTimeoutMs?: number;
  /** Session expiry sweep interval. Defaults to 30s. */
  sweepIntervalMs?: number;
  /**
   * Unsent outbound bytes allowed on one socket before writes to it stop.
   * Defaults to `STREAM_MAX_BUFFERED_BYTES` (1 MiB).
   */
  maxBufferedBytes?: number;
}

interface ConnectionContext {
  session: StreamSession;
  apiKey: ApiKey;
  graphId: string;
}

interface Rejection {
  status: number;
  statusText: string;
  code: StreamErrorCode;
  message: string;
}

type AuthorizeResult =
  | { ok: true; apiKey: ApiKey; graphId: string }
  | { ok: false; rejection: Rejection };

type KeyResolution =
  | { ok: true; apiKey: ApiKey }
  | { ok: false; rejection: Rejection };

const TOKEN_REJECTIONS: Record<
  'malformed' | 'unknown' | 'expired' | 'replayed',
  Rejection
> = {
  malformed: {
    status: 400,
    statusText: 'Bad Request',
    code: 'MALFORMED_TOKEN',
    message: 'A non-empty token query parameter is required',
  },
  unknown: {
    status: 401,
    statusText: 'Unauthorized',
    code: 'UNKNOWN_TOKEN',
    message: 'Stream token is not recognised',
  },
  expired: {
    status: 401,
    statusText: 'Unauthorized',
    code: 'EXPIRED_TOKEN',
    message: 'Stream token has expired',
  },
  replayed: {
    status: 409,
    statusText: 'Conflict',
    code: 'REPLAYED_TOKEN',
    message: 'Stream token has already been used',
  },
};

/** The `Sec-WebSocket-Key` shape `ws` itself accepts (base64 of 16 bytes). */
const SEC_WEBSOCKET_KEY_PATTERN = /^[+/0-9A-Za-z]{22}==$/;

export class StreamHandler {
  private readonly tokenStore: StreamTokenStore;
  private readonly sessionManager: StreamSessionManager;
  private readonly deps: StreamWriteDeps;
  private readonly logger: ILogger;
  private readonly wss: WebSocketServer;
  private readonly maxInFlightWrites: number;
  private readonly reservationTimeoutMs: number;
  private readonly sweepIntervalMs: number;
  /** Largest accepted frame; exposed so tests can assert the resolved value. */
  readonly maxPayloadBytes: number;
  /** Largest unsent outbound backlog allowed on one socket. */
  readonly maxBufferedBytes: number;
  private readonly sockets = new Map<string, WebSocket>();
  private readonly inFlightWrites = new Map<string, number>();
  /**
   * Sockets already closed for being over `maxBufferedBytes`, so every later
   * refusal on the same socket logs once and closes once.
   */
  private readonly backpressuredSockets = new WeakSet<WebSocket>();
  private attachedServer: HttpServer | undefined;
  private upgradeListener:
    | ((req: IncomingMessage, socket: Duplex, head: Buffer) => void)
    | undefined;
  private sweepTimer: NodeJS.Timeout | undefined;

  constructor(options: StreamHandlerOptions) {
    this.tokenStore = options.tokenStore;
    this.sessionManager = options.sessionManager;
    this.deps = options.deps;
    this.logger = options.logger ?? createLogger('StreamHandler');
    this.maxPayloadBytes = options.maxPayloadBytes ?? STREAM_MAX_PAYLOAD_BYTES;
    this.maxInFlightWrites = Math.max(
      1,
      Math.floor(options.maxInFlightWrites ?? DEFAULT_MAX_IN_FLIGHT_WRITES)
    );
    this.reservationTimeoutMs = options.reservationTimeoutMs ?? STREAM_RESERVATION_TIMEOUT_MS;
    this.sweepIntervalMs = options.sweepIntervalMs ?? DEFAULT_SESSION_SWEEP_INTERVAL_MS;
    this.maxBufferedBytes = options.maxBufferedBytes ?? STREAM_MAX_BUFFERED_BYTES;
    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: this.maxPayloadBytes,
    });
    this.sweepTimer = setInterval(() => {
      this.sweepSessions();
    }, this.sweepIntervalMs);
    // Session expiry must not keep the process alive by itself.
    this.sweepTimer.unref();
  }

  /** Expose the session registry so callers/tests can assert on it. */
  get sessions(): StreamSessionManager {
    return this.sessionManager;
  }

  /**
   * The underlying `ws` server.
   *
   * Exposed for tests and diagnostics: attaching a `wsClientError` listener
   * changes `ws` behaviour (it then leaves the socket open instead of destroying
   * it), which is one of the paths the reservation timeout exists for and cannot
   * be reached otherwise.
   */
  get webSocketServer(): WebSocketServer {
    return this.wss;
  }

  /** Register the HTTP `upgrade` listener for this handler's endpoint. */
  attach(server: HttpServer): void {
    this.attachedServer = server;
    const listener = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
      void this.handleUpgrade(req, socket, head);
    };
    this.upgradeListener = listener;
    server.on('upgrade', listener);
  }

  /**
   * Validate the connection and either refuse the upgrade or complete it.
   *
   * Public so tests can drive it without standing up a TCP listener, though the
   * integration tests exercise the real upgrade path.
   */
  async handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    // A socket error listener is the FIRST thing installed, before any
    // validation, any `await` and any write. `ws` installs its own listener only
    // inside `handleUpgrade`, so without this a peer reset during token/key
    // resolution (or during the rejection write below) is an uncaught 'error'
    // event on the socket, which crashes the process. It must not throw itself:
    // it runs inside an event handler with no caller to catch it.
    let sessionId: string | undefined;
    let reservationTimer: NodeJS.Timeout | undefined;
    // Set by the error/close listeners. Read before the slot is reserved, so a
    // peer that resets while we are resolving the key cannot be given a slot
    // that nothing will ever release.
    let socketFailed = false;

    const release = (): void => {
      try {
        if (reservationTimer) {
          clearTimeout(reservationTimer);
          reservationTimer = undefined;
        }
        if (sessionId) {
          // Idempotent: `StreamSessionManager.close` returns nothing the second
          // time, and `releaseSession` only logs the first release.
          this.releaseSession(sessionId, 'socket');
          sessionId = undefined;
        }
      } catch (error) {
        this.safeLog('error', 'Failed to release a stream reservation', {
          error: String(error),
        });
      }
    };

    const onSocketError = (error: unknown): void => {
      socketFailed = true;
      this.safeLog('warn', 'Stream socket error', { error: String(error) });
      release();
    };

    const onSocketClose = (): void => {
      socketFailed = true;
      release();
    };

    socket.on('error', onSocketError);
    socket.once('close', onSocketClose);

    const path = getRequestPath(req);
    if (path !== STREAM_PATH) {
      sendUpgradeRejection(socket, {
        status: 404,
        statusText: 'Not Found',
        code: 'UNKNOWN_TOKEN',
        message: `Unknown WebSocket path '${path}'`,
      });
      return;
    }

    // Refuse anything `ws` would refuse BEFORE burning the token or reserving a
    // slot. `handleUpgrade` never calls back on these requests; the token and
    // the slot would be spent on a connection that can never exist.
    const upgradeProblem = validateUpgradeRequest(req);
    if (upgradeProblem) {
      this.logger.warn('Stream upgrade refused before authorisation', {
        path,
        reason: upgradeProblem.message,
      });
      sendUpgradeRejection(socket, {
        status: upgradeProblem.status,
        statusText: upgradeProblem.statusText,
        code: 'UPGRADE_INVALID',
        message: upgradeProblem.message,
      });
      return;
    }

    let result: AuthorizeResult;
    try {
      result = await this.authorizeConnection(req);
    } catch (error) {
      this.logger.error('Stream connection authorisation failed', error);
      sendUpgradeRejection(socket, {
        status: 500,
        statusText: 'Internal Server Error',
        code: 'KEY_INVALID',
        message: 'Failed to authorise stream connection',
      });
      return;
    }

    if (!result.ok) {
      this.logger.warn('Stream connection refused', {
        code: result.rejection.code,
        path,
      });
      sendUpgradeRejection(socket, result.rejection);
      return;
    }

    if (socketFailed) {
      // The peer went away while the key was being resolved. Nothing was
      // reserved yet, and nothing will be: reserving here would create a slot
      // with no socket left to release it.
      try {
        socket.destroy();
      } catch {
        // Already gone.
      }
      return;
    }

    // Reserved here -- synchronously, after every validation and immediately
    // before the handshake -- rather than inside `authorizeConnection`, so there
    // is no `await` between "the socket is still good" and "a slot exists".
    const opened = this.sessionManager.tryOpen(
      result.apiKey.id,
      result.graphId,
      result.apiKey.rateLimit.concurrentStreams
    );
    if (!opened.ok) {
      this.logger.warn('Stream connection refused', {
        code: 'CONCURRENT_LIMIT',
        path,
      });
      sendUpgradeRejection(socket, {
        status: 429,
        statusText: 'Too Many Requests',
        code: 'CONCURRENT_LIMIT',
        message: `Concurrent stream limit of ${opened.limit} reached for this API key`,
      });
      return;
    }

    sessionId = opened.session.id;
    const context: ConnectionContext = {
      session: opened.session,
      apiKey: result.apiKey,
      graphId: result.graphId,
    };

    if (socketFailed || socket.destroyed) {
      // The peer gave up while we were validating.
      release();
      return;
    }

    // Belt and braces for the paths where `handleUpgrade` returns without
    // calling back AND without destroying the socket (for example when a
    // `wsClientError` listener is attached): the reservation is bounded by
    // time, not just by the socket's own close event.
    reservationTimer = setTimeout(() => {
      this.logger.warn('Stream upgrade reservation timed out', { sessionId });
      release();
      try {
        socket.destroy();
      } catch {
        // Already gone.
      }
    }, this.reservationTimeoutMs);
    reservationTimer.unref();

    try {
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        if (reservationTimer) {
          clearTimeout(reservationTimer);
          reservationTimer = undefined;
        }
        this.establish(ws, context);
      });
    } catch (error) {
      this.logger.error('Stream upgrade failed', error);
      release();
      try {
        socket.destroy();
      } catch {
        // Already gone.
      }
    }
  }

  /**
   * Run every connection-time credential check in order and return either the
   * resolved key or the rejection to send. Token validation happens first and is
   * destructive (single-use), so a later failure still burns the token.
   *
   * The concurrency slot is deliberately NOT reserved here: it is reserved by
   * `handleUpgrade` immediately before the handshake, after checking that the
   * socket is still usable.
   */
  private async authorizeConnection(req: IncomingMessage): Promise<AuthorizeResult> {
    const token = getRequestToken(req);
    const consumed = this.tokenStore.consume(token);
    if (!consumed.ok) {
      return { ok: false, rejection: TOKEN_REJECTIONS[consumed.reason] };
    }

    const record = consumed.token;

    let graphId: string;
    try {
      assertSafeGraphId(record.graphId);
      graphId = record.graphId;
    } catch {
      return {
        ok: false,
        rejection: {
          status: 400,
          statusText: 'Bad Request',
          code: 'MALFORMED_TOKEN',
          message: 'Stream token carries an invalid graph id',
        },
      };
    }

    // The token's `permissions` snapshot is deliberately NOT consulted: the
    // token proves which key asked, the repository says what that key may do.
    const resolved = await this.resolveKey(record.apiKeyId, graphId);
    if (!resolved.ok) {
      return { ok: false, rejection: resolved.rejection };
    }

    return { ok: true, apiKey: resolved.apiKey, graphId };
  }

  /**
   * Re-resolve an API key and re-check everything the stream needs from it.
   *
   * Used both at connect and before every write, so the guarantees cannot drift
   * apart between the two paths: revocation, deactivation, expiry, deletion,
   * permission removal and graph-access removal are all answered from the
   * repository, never from the token's snapshot or the connect-time answer.
   */
  private async resolveKey(apiKeyId: string, graphId: string): Promise<KeyResolution> {
    const apiKey = await this.deps.authService.getApiKey(apiKeyId);
    if (!apiKey || !apiKey.isValid()) {
      return {
        ok: false,
        rejection: {
          status: 401,
          statusText: 'Unauthorized',
          code: 'KEY_INVALID',
          message: 'The API key this token was issued to is missing, inactive or expired',
        },
      };
    }

    if (!apiKey.hasPermission(STREAM_REQUIRED_PERMISSION)) {
      return {
        ok: false,
        rejection: {
          status: 403,
          statusText: 'Forbidden',
          code: 'PERMISSION_DENIED',
          message: `The API key no longer has the '${STREAM_REQUIRED_PERMISSION}' permission`,
        },
      };
    }

    if (!apiKey.canAccessGraph(graphId)) {
      return {
        ok: false,
        rejection: {
          status: 403,
          statusText: 'Forbidden',
          code: 'GRAPH_ACCESS_DENIED',
          message: `The API key is not allowed to access graph '${graphId}'`,
        },
      };
    }

    return { ok: true, apiKey };
  }

  /** Accept the socket, announce the session and wire message handlers. */
  private establish(ws: WebSocket, context: ConnectionContext): void {
    const { session, apiKey, graphId } = context;

    this.sockets.set(session.id, ws);

    // Every handler is installed before anything is sent, so no synchronous
    // failure below can leave the session without a close/error path.
    ws.on('close', () => {
      this.inFlightWrites.delete(session.id);
      this.releaseSession(session.id, 'client');
    });

    ws.on('error', (error) => {
      this.safeLog('warn', 'Stream socket error', {
        sessionId: session.id,
        error: String(error),
      });
      this.inFlightWrites.delete(session.id);
      this.releaseSession(session.id, 'error');
    });

    ws.on('message', (data: RawData) => {
      void this.onMessage(ws, context, data);
    });

    this.send(ws, {
      type: 'auth_result',
      success: true,
      sessionId: session.id,
      apiKeyId: apiKey.id,
      graphId,
      concurrentStreams: apiKey.rateLimit.concurrentStreams,
    });

    this.logger.info('Stream session established', {
      sessionId: session.id,
      apiKeyId: apiKey.id,
      graphId,
    });
  }

  /**
   * Release a session slot, logging the session's counters exactly once.
   *
   * Called from the raw socket's close/error guard AND from the WebSocket's own
   * close/error events; whichever happens first reports the session, the other
   * is a no-op, so no release path has to be remembered for the other one.
   */
  private releaseSession(sessionId: string, source: string): void {
    this.sockets.delete(sessionId);
    const closed = this.sessionManager.close(sessionId);
    if (!closed) {
      return;
    }
    this.logger.info('Stream session closed', {
      sessionId,
      source,
      messagesReceived: closed.messagesReceived,
      entitiesCreated: closed.entitiesCreated,
    });
  }

  /** Close sessions that crossed their lifetime/idle limit. */
  private sweepSessions(): void {
    for (const expired of this.sessionManager.sweep()) {
      const ws = this.sockets.get(expired.session.id);
      if (!ws) {
        // Reserved but never established, or already gone: the slot is now free.
        this.logger.info('Expired stream session released', {
          sessionId: expired.session.id,
          reason: expired.reason,
        });
        continue;
      }
      this.refuseSession(ws, expired.session, expired.reason);
    }
  }

  /**
   * Stop a session that may no longer write, telling the client why.
   *
   * Covers both halves of "this session is over": a session that crossed a
   * lifetime limit, and an id the manager no longer holds at all (expired by
   * the sweep that already removed it, closed, or released). The second case is
   * why this is not only called for a session the manager still knows: a
   * removed id must be refused too, or the next message from it would be
   * handled as if the session were live and its write persisted.
   */
  private refuseSession(
    ws: WebSocket,
    session: StreamSession,
    reason: StreamSessionRefusalReason
  ): void {
    this.inFlightWrites.delete(session.id);
    this.sessionManager.close(session.id);
    let message = 'Session exceeded its maximum lifetime; request a new stream token';
    if (reason === 'unknown') {
      message = 'Session is no longer active; request a new stream token';
    } else if (reason === 'idle') {
      message = `Session was idle for longer than ${session.idleTimeoutMs}ms; request a new stream token`;
    }
    this.logger.info('Stream session expired', {
      sessionId: session.id,
      reason,
      messagesReceived: session.messagesReceived,
    });
    this.sendThenClose(ws, { type: 'error', code: 'SESSION_EXPIRED', message }, 'session_expired');
  }

  private async onMessage(
    ws: WebSocket,
    context: ConnectionContext,
    raw: RawData
  ): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawDataToString(raw));
    } catch {
      this.send(ws, {
        type: 'error',
        code: 'INVALID_MESSAGE',
        message: 'Message payload is not valid JSON',
      });
      return;
    }

    if (!isRecord(parsed) || typeof parsed.type !== 'string') {
      this.send(ws, {
        type: 'error',
        code: 'INVALID_MESSAGE',
        message: 'Message must be a JSON object with a string "type"',
      });
      return;
    }

    // Checked before the message is counted as activity: an expired session must
    // not be able to extend its own life by talking. `refusalReason` and not
    // `expiredReason`: an id the manager no longer holds (swept, closed,
    // released) must be refused as well, and `expiredReason` reports that case
    // as `undefined` -- indistinguishable from a live session.
    const refusal = this.sessionManager.refusalReason(context.session.id);
    if (refusal) {
      this.refuseSession(ws, context.session, refusal);
      return;
    }

    this.sessionManager.recordMessage(context.session.id);

    const requestId = typeof parsed.requestId === 'string' ? parsed.requestId : undefined;

    switch (parsed.type) {
      case 'close':
        this.send(ws, { type: 'closed', reason: 'client_requested' });
        this.sessionManager.close(context.session.id);
        ws.close(1000, 'client_requested');
        return;
      case 'event':
        await this.handleWrite(ws, context, 'event', parsed.data, requestId);
        return;
      case 'arc':
        await this.handleWrite(ws, context, 'arc', parsed.data, requestId);
        return;
      default:
        this.send(ws, {
          type: 'error',
          code: 'INVALID_MESSAGE',
          message: `Unsupported message type '${parsed.type}'`,
        });
    }
  }

  /**
   * Bound the writes a session may have outstanding.
   *
   * `onMessage` is fire-and-forget from the socket's point of view, so without
   * this a client could start an unbounded number of concurrent repository
   * writes with one connection.
   */
  private async handleWrite(
    ws: WebSocket,
    context: ConnectionContext,
    entityType: 'event' | 'arc',
    data: unknown,
    requestId: string | undefined
  ): Promise<void> {
    // Outbound capacity comes first. A socket that is already holding more than
    // `maxBufferedBytes` of unsent data cannot be sent the acknowledgement for
    // this write, so the write is refused before it reaches the repository
    // rather than persisted as work whose result can never be delivered. This
    // is the inbound half of the outbound bound: without it a client that never
    // reads could still make the server write to the graph forever.
    if (this.isOverBuffered(ws)) {
      this.logger.warn('Stream write refused: socket is over the outbound buffer limit', {
        sessionId: context.session.id,
        entityType,
        bufferedAmount: ws.bufferedAmount,
        maxBufferedBytes: this.maxBufferedBytes,
      });
      this.closeForBackpressure(ws);
      return;
    }

    const inFlight = this.inFlightWrites.get(context.session.id) ?? 0;
    if (inFlight >= this.maxInFlightWrites) {
      this.send(ws, {
        type: 'ack',
        requestId,
        entityType,
        entityId: null,
        success: false,
        code: 'CONCURRENT_WRITE_LIMIT',
        error: `Too many writes in flight (limit ${this.maxInFlightWrites})`,
      });
      return;
    }

    this.inFlightWrites.set(context.session.id, inFlight + 1);
    try {
      await this.handleEntity(ws, context, entityType, data, requestId);
    } finally {
      const remaining = (this.inFlightWrites.get(context.session.id) ?? 1) - 1;
      if (remaining > 0) {
        this.inFlightWrites.set(context.session.id, remaining);
      } else {
        this.inFlightWrites.delete(context.session.id);
      }
    }
  }

  /**
   * Create one entity and acknowledge it. Both the success and the failure path
   * send an `ack`; an unhandled rejection here would leave the client waiting
   * forever, so the whole body is guarded.
   */
  private async handleEntity(
    ws: WebSocket,
    context: ConnectionContext,
    entityType: 'event' | 'arc',
    data: unknown,
    requestId: string | undefined
  ): Promise<void> {
    if (!isRecord(data)) {
      this.send(ws, {
        type: 'ack',
        requestId,
        entityType,
        entityId: null,
        success: false,
        code: 'INVALID_MESSAGE',
        error: 'Message "data" must be an object',
      });
      return;
    }

    // Re-resolve the key for THIS message rather than trusting the connect-time
    // answer: otherwise a revoked, deleted or expired key (or one that lost a
    // permission) would keep writing for as long as it held the socket open.
    let apiKey: ApiKey;
    try {
      const resolved = await this.resolveKey(context.apiKey.id, context.graphId);
      if (!resolved.ok) {
        this.logger.warn('Stream write refused: key no longer authorised', {
          sessionId: context.session.id,
          code: resolved.rejection.code,
        });
        this.send(ws, {
          type: 'ack',
          requestId,
          entityType,
          entityId: null,
          success: false,
          code: resolved.rejection.code,
          error: resolved.rejection.message,
        });
        this.sendThenClose(
          ws,
          { type: 'error', code: resolved.rejection.code, message: resolved.rejection.message },
          'key_invalid'
        );
        return;
      }
      apiKey = resolved.apiKey;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown key resolution error';
      this.logger.warn('Stream key re-resolution failed', {
        sessionId: context.session.id,
        error: message,
      });
      this.send(ws, {
        type: 'ack',
        requestId,
        entityType,
        entityId: null,
        success: false,
        code: 'KEY_INVALID',
        error: 'Failed to re-resolve the API key',
      });
      return;
    }

    const requiredPermission: Permission = entityType === 'event' ? 'write:events' : 'write:arcs';
    if (!apiKey.hasPermission(requiredPermission)) {
      this.send(ws, {
        type: 'ack',
        requestId,
        entityType,
        entityId: null,
        success: false,
        code: 'PERMISSION_DENIED',
        error: `Missing required permission: ${requiredPermission}`,
      });
      return;
    }

    // Charge the same per-key request budget the HTTP routes use. Skipping it
    // here would make the socket a way around the limit.
    const limiter = this.deps.rateLimitService;
    if (limiter) {
      const result = limiter.recordRequest(apiKey.id, apiKey.rateLimit);
      if (!result.allowed) {
        this.logger.warn('Stream write rate limited', {
          sessionId: context.session.id,
          apiKeyId: apiKey.id,
          limit: result.limit,
        });
        this.send(ws, {
          type: 'ack',
          requestId,
          entityType,
          entityId: null,
          success: false,
          code: 'RATE_LIMITED',
          error: `Rate limit exceeded: ${result.limit}`,
        });
        return;
      }
    }

    if (entityType === 'event') {
      await this.writeEvent(ws, context, data, requestId);
      return;
    }
    await this.writeArc(ws, context, data, requestId);
  }

  private async writeEvent(
    ws: WebSocket,
    context: ConnectionContext,
    data: Record<string, unknown>,
    requestId: string | undefined
  ): Promise<void> {
    const converted = toCreateEventRequest(data);
    if (!converted.ok) {
      this.send(ws, {
        type: 'ack',
        requestId,
        entityType: 'event',
        entityId: null,
        success: false,
        code: 'INVALID_MESSAGE',
        error: converted.error,
      });
      return;
    }

    try {
      const { eventRepository } = await this.deps.graphScopedRepositories(context.graphId);
      if (!this.mayPersist(ws, context, 'event', requestId)) {
        return;
      }
      const event = await eventRepository.create(converted.value);
      // The event is durable from here on: the ack must say so even if the
      // versioning record below fails, or a retrying client would duplicate it.
      await this.ackPersistedEntity(
        ws,
        context,
        'event',
        event.id,
        () => this.deps.graphWriteVersioningService.recordEvent(context.graphId, event, 'create'),
        requestId
      );
    } catch (error) {
      this.sendWriteFailure(ws, context, 'event', error, requestId);
    }
  }

  private async writeArc(
    ws: WebSocket,
    context: ConnectionContext,
    data: Record<string, unknown>,
    requestId: string | undefined
  ): Promise<void> {
    const converted = toCreateArcRequest(data);
    if (!converted.ok) {
      this.send(ws, {
        type: 'ack',
        requestId,
        entityType: 'arc',
        entityId: null,
        success: false,
        code: 'INVALID_MESSAGE',
        error: converted.error,
      });
      return;
    }

    try {
      const { arcRepository } = await this.deps.graphScopedRepositories(context.graphId);
      if (!this.mayPersist(ws, context, 'arc', requestId)) {
        return;
      }
      const arc = await arcRepository.create(converted.value);
      await this.ackPersistedEntity(
        ws,
        context,
        'arc',
        arc.id,
        () => this.deps.graphWriteVersioningService.recordArc(context.graphId, arc, 'create'),
        requestId
      );
    } catch (error) {
      this.sendWriteFailure(ws, context, 'arc', error, requestId);
    }
  }

  /**
   * The last gate before an entity is persisted: the session must still be one
   * the manager holds and must still be inside its lifetime.
   *
   * `onMessage`'s check is not enough on its own. Between that check and this
   * one the handler awaits the API key lookup and the graph-scoped repository,
   * so a session can expire -- or be swept out of the manager -- while its
   * write is being authorised. Without this, the lifetime limit would only be
   * as strict as the repository's latency, and the write would be persisted
   * with no live session behind it.
   *
   * The client is told with a failing ack (so a client waiting on one is not
   * left hanging) followed by the same `SESSION_EXPIRED` error and close the
   * earlier check sends.
   */
  private mayPersist(
    ws: WebSocket,
    context: ConnectionContext,
    entityType: 'event' | 'arc',
    requestId: string | undefined
  ): boolean {
    const refusal = this.sessionManager.refusalReason(context.session.id);
    if (!refusal) {
      return true;
    }
    this.send(ws, {
      type: 'ack',
      requestId,
      entityType,
      entityId: null,
      success: false,
      code: 'SESSION_EXPIRED',
      error: 'Session is no longer active; nothing was written',
    });
    this.refuseSession(ws, context.session, refusal);
    return false;
  }

  /**
   * Acknowledge an entity the repository has ALREADY persisted.
   *
   * Only failures that happen before (or during) `create` may be reported as
   * `success: false`; once the entity exists, a versioning failure is reported
   * as a `warning` frame while the ack keeps `success: true` and the real id. A
   * `success: false` here would be a lie the client could only fix by retrying,
   * which would create a duplicate.
   */
  private async ackPersistedEntity(
    ws: WebSocket,
    context: ConnectionContext,
    entityType: 'event' | 'arc',
    entityId: string,
    recordVersion: () => Promise<void>,
    requestId: string | undefined
  ): Promise<void> {
    this.sessionManager.recordEntity(context.session.id);

    try {
      await recordVersion();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown versioning error';
      this.logger.warn('Stream versioning record failed after a successful write', {
        sessionId: context.session.id,
        entityType,
        entityId,
        error: message,
      });
      this.send(ws, {
        type: 'warning',
        message: `Entity ${entityId} was persisted but its versioning record failed: ${message}`,
        entityId,
      });
    }

    this.send(ws, {
      type: 'ack',
      requestId,
      entityType,
      entityId,
      success: true,
    });
  }

  private sendWriteFailure(
    ws: WebSocket,
    context: ConnectionContext,
    entityType: 'event' | 'arc',
    error: unknown,
    requestId: string | undefined
  ): void {
    const message = error instanceof Error ? error.message : 'Unknown write error';
    this.logger.warn('Stream write failed', {
      sessionId: context.session.id,
      entityType,
      error: message,
    });
    this.send(ws, {
      type: 'ack',
      requestId,
      entityType,
      entityId: null,
      success: false,
      code: 'WRITE_FAILED',
      error: message,
    });
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState !== WebSocket.OPEN) {
      return;
    }
    if (this.isOverBuffered(ws)) {
      // The frame is DROPPED rather than queued: this refusal is the bound.
      // Queueing it would be exactly the unbounded growth this exists to stop,
      // and a client this far behind cannot be brought up to date by sending
      // it more, so the socket is closed instead.
      this.closeForBackpressure(ws);
      return;
    }
    ws.send(JSON.stringify(message));
  }

  /**
   * Whether the socket is holding more unsent data than it is allowed to.
   *
   * `bufferedAmount` is `ws`'s own count of the bytes handed to it that are
   * still inside the sender or the socket -- i.e. bytes the client has NOT
   * consumed. It is the quantity the outbound bound is about.
   */
  private isOverBuffered(ws: WebSocket): boolean {
    return ws.bufferedAmount >= this.maxBufferedBytes;
  }

  /**
   * Drop a socket that is over the outbound limit, saying why.
   *
   * Idempotent per socket: the first refusal logs and closes, every later one
   * (there is one per dropped frame) is a no-op, so a burst of refusals cannot
   * log a storm or close a socket twice.
   */
  private closeForBackpressure(ws: WebSocket): void {
    const bufferedAmount = ws.bufferedAmount;
    if (this.backpressuredSockets.has(ws)) {
      return;
    }
    this.backpressuredSockets.add(ws);
    this.logger.warn('Stream socket exceeded the outbound buffer limit; closing it', {
      bufferedAmount,
      maxBufferedBytes: this.maxBufferedBytes,
    });
    try {
      ws.close(STREAM_BACKPRESSURE_CLOSE_CODE, 'backpressure');
    } catch {
      ws.terminate();
    }
  }

  /**
   * Send a final frame and close only once it has been handed to the socket, so
   * a client always learns WHY it is being dropped before the connection goes.
   * A socket that is over the outbound limit is closed without the frame: the
   * reason would be queued behind everything else it is already not reading.
   */
  private sendThenClose(ws: WebSocket, message: ServerMessage, reason: string): void {
    if (ws.readyState !== WebSocket.OPEN) {
      return;
    }
    if (this.isOverBuffered(ws)) {
      this.closeForBackpressure(ws);
      return;
    }
    try {
      ws.send(JSON.stringify(message), () => {
        try {
          ws.close(1000, reason);
        } catch {
          ws.terminate();
        }
      });
    } catch {
      ws.terminate();
    }
  }

  /** Log without ever letting a logging failure escape an event handler. */
  private safeLog(level: 'warn' | 'error', message: string, meta: Record<string, unknown>): void {
    try {
      this.logger[level](message, meta);
    } catch {
      // Logging must never be the reason a socket error becomes fatal.
    }
  }

  /**
   * Refuse all live sockets and stop the WebSocket server.
   *
   * `terminate` is used so a peer that ignores the close frame cannot hold the
   * process open during shutdown; the HTTP server's own `close()` then resolves.
   * Sessions are dropped explicitly so a concurrent-limit check cannot see a
   * stale slot after shutdown.
   */
  close(): Promise<void> {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }
    for (const client of this.wss.clients) {
      try {
        client.terminate();
      } catch {
        // Already gone; nothing to do.
      }
    }
    this.sessionManager.closeAll();
    this.sockets.clear();
    this.inFlightWrites.clear();

    return new Promise((resolve) => {
      this.wss.close(() => resolve());
    });
  }

  /** Stop listening for upgrades on the attached HTTP server. */
  detach(): void {
    if (this.attachedServer && this.upgradeListener) {
      // Only this handler's listener is removed: another listener on the same
      // server (a metrics tap, another endpoint) must survive this handler.
      this.attachedServer.removeListener('upgrade', this.upgradeListener);
    }
    this.attachedServer = undefined;
    this.upgradeListener = undefined;
  }
}

/**
 * A reason `ws` would refuse to complete a handshake after the HTTP server has
 * already handed us the socket.
 */
interface UpgradeProblem {
  status: number;
  statusText: string;
  message: string;
}

/**
 * Mirror of the request checks `ws` performs inside `handleUpgrade`.
 *
 * `ws` refuses these by returning without calling its callback, so the socket
 * would keep whatever was reserved for it. The accepted key shape and versions
 * are copied from `ws` (base64 of 16 bytes; protocols 13 and 8) rather than
 * invented here: accepting less than `ws` would break working clients, and
 * accepting more would reserve a slot for a handshake that never completes.
 * The body is used only for a diagnostics message.
 */
function validateUpgradeRequest(req: IncomingMessage): UpgradeProblem | undefined {
  if (req.method !== 'GET') {
    return {
      status: 405,
      statusText: 'Method Not Allowed',
      message: 'Invalid HTTP method for a WebSocket upgrade',
    };
  }

  const upgrade = req.headers.upgrade;
  if (typeof upgrade !== 'string' || upgrade.toLowerCase() !== 'websocket') {
    return {
      status: 400,
      statusText: 'Bad Request',
      message: 'Invalid Upgrade header',
    };
  }

  const key = req.headers['sec-websocket-key'];
  if (typeof key !== 'string' || !SEC_WEBSOCKET_KEY_PATTERN.test(key)) {
    return {
      status: 400,
      statusText: 'Bad Request',
      message: 'Missing or invalid Sec-WebSocket-Key header',
    };
  }

  const version = req.headers['sec-websocket-version'];
  if (version !== '13' && version !== '8') {
    return {
      status: 400,
      statusText: 'Bad Request',
      message: 'Missing or invalid Sec-WebSocket-Version header',
    };
  }

  return undefined;
}

/** Extract the pathname of the upgrade request. */
function getRequestPath(req: IncomingMessage): string {
  try {
    return new URL(req.url ?? '/', 'http://localhost').pathname;
  } catch {
    return req.url ?? '/';
  }
}

/** Extract the `token` query parameter, or `undefined` if absent. */
function getRequestToken(req: IncomingMessage): string | undefined {
  try {
    const value = new URL(req.url ?? '/', 'http://localhost').searchParams.get('token');
    return value ?? undefined;
  } catch {
    return undefined;
  }
}

/** Write an HTTP response for a refused upgrade and close the socket. */
function sendUpgradeRejection(socket: Duplex, rejection: Rejection): void {
  if (socket.destroyed || !socket.writable) {
    socket.destroy();
    return;
  }
  const body = JSON.stringify({ error: rejection.message, code: rejection.code });
  const response =
    `HTTP/1.1 ${rejection.status} ${rejection.statusText}\r\n` +
    'Content-Type: application/json\r\n' +
    `Content-Length: ${Buffer.byteLength(body)}\r\n` +
    'Connection: close\r\n' +
    '\r\n' +
    body;

  try {
    socket.end(response, () => {
      socket.destroy();
    });
  } catch {
    socket.destroy();
  }
}

/** Convert a `ws` raw frame into a UTF-8 string. */
function rawDataToString(raw: RawData): string {
  if (typeof raw === 'string') {
    return raw;
  }
  if (Buffer.isBuffer(raw)) {
    return raw.toString('utf8');
  }
  if (Array.isArray(raw)) {
    return Buffer.concat(raw).toString('utf8');
  }
  return Buffer.from(raw).toString('utf8');
}

type Converted<T> = { ok: true; value: T } | { ok: false; error: string };

function toCreateEventRequest(data: Record<string, unknown>): Converted<CreateEventRequest> {
  const description = readNonEmptyString(data, 'description');
  const actor = readNonEmptyString(data, 'actor');
  const target = readNonEmptyString(data, 'target');

  if (!description || !actor || !target || data.timestamp === undefined) {
    const missing = [
      ...(!description ? ['description'] : []),
      ...(!actor ? ['actor'] : []),
      ...(!target ? ['target'] : []),
      ...(data.timestamp === undefined ? ['timestamp'] : []),
    ];
    return { ok: false, error: `Missing required fields: ${missing.join(', ')}` };
  }

  const timestamp = toDate(data.timestamp);
  if (!timestamp) {
    return { ok: false, error: 'Invalid timestamp' };
  }

  const value: CreateEventRequest = { description, actor, target, timestamp };
  if (isRecord(data.metadata)) {
    value.metadata = data.metadata;
  }
  return { ok: true, value };
}

function toCreateArcRequest(data: Record<string, unknown>): Converted<CreateArcRequest> {
  const name = readNonEmptyString(data, 'name');
  const level = data.level;

  if (
    !name ||
    typeof level !== 'number' ||
    Number.isNaN(level) ||
    data.start_time === undefined ||
    data.end_time === undefined
  ) {
    const missing = [
      ...(!name ? ['name'] : []),
      ...(typeof level !== 'number' || Number.isNaN(level) ? ['level'] : []),
      ...(data.start_time === undefined ? ['start_time'] : []),
      ...(data.end_time === undefined ? ['end_time'] : []),
    ];
    return { ok: false, error: `Missing required fields: ${missing.join(', ')}` };
  }

  const startTime = toDate(data.start_time);
  const endTime = toDate(data.end_time);
  if (!startTime || !endTime) {
    return { ok: false, error: 'Invalid start_time or end_time' };
  }

  const value: CreateArcRequest = {
    name,
    start_time: startTime,
    end_time: endTime,
    level,
  };
  if (typeof data.description === 'string') {
    value.description = data.description;
  }
  if (isRecord(data.metadata)) {
    value.metadata = data.metadata;
  }
  return { ok: true, value };
}

/** Parse a Date, an ISO string or an epoch-milliseconds number; else null. */
function toDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}
