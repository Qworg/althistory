/**
 * WebSocket stream handler (requirement 16, tasks 5.1/5.2/5.3).
 *
 * Connection path:
 *   1. The client upgrades `GET /api/ws/stream?token=<token>`.
 *   2. The token is consumed from the token store. Unknown, malformed, expired
 *      and replayed tokens are refused at the HTTP upgrade with a non-101
 *      response, so no WebSocket session is ever created for them.
 *   3. The API key the token was issued to is re-resolved from the repository.
 *      A missing/inactive/expired key is refused. This is what makes the token
 *      "tied to an API key" mean something after issue.
 *   4. The key must still hold `write:events`, and must be allowed to access the
 *      token's graph. A valid token whose key lacks the permission is refused
 *      (403), not merely checked for existence.
 *   5. The key's `concurrentStreams` limit is enforced through
 *      `StreamSessionManager.tryOpen`; the N+1th connection is refused (429).
 *   6. Only then is the socket accepted and an `auth_result` sent.
 *
 * Every subsequent `event`/`arc` message is answered with an `ack` carrying
 * `success: true` and the created id, or `success: false` and the error.
 *
 * Not implemented here (stated so it is not mistaken for done):
 *   - requirement 16.4 validation WARNINGS are never emitted. The protocol has
 *     a `warning` frame (`ServerWarningMessage`) but no code path produces one;
 *     a repository validation failure is acked as an error instead. Adding a
 *     real warning channel needs a non-fatal validator on the stream path.
 *   - per-message re-resolution of the API key, so revoking a key requires
 *     dropping its live sessions; the key is only resolved at connect.
 *   - the token store is per-process, not Redis-backed.
 */

import type { IncomingMessage, Server as HttpServer } from 'http';
import type { Duplex } from 'stream';
import { WebSocketServer, WebSocket } from 'ws';
import type { RawData } from 'ws';
import { createLogger } from '@/utils/logger';
import type { ILogger } from '@/utils/logger';
import type { ApiKey, Permission } from '@/models/ApiKey';
import { assertSafeGraphId } from '@/utils/GraphContextStore';
import type { GraphScopedRepositories } from '@/container';
import { StreamTokenStore } from './StreamTokenStore';
import { StreamSessionManager } from './StreamSession';
import type { StreamSession } from './StreamSession';
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

/** Minimal API-key lookup the connection path needs. */
export interface StreamKeyResolver {
  getApiKey(id: string): Promise<ApiKey | null>;
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
}

export interface StreamHandlerOptions {
  tokenStore: StreamTokenStore;
  sessionManager: StreamSessionManager;
  deps: StreamWriteDeps;
  logger?: ILogger;
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
  | { ok: true; context: ConnectionContext }
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

export class StreamHandler {
  private readonly tokenStore: StreamTokenStore;
  private readonly sessionManager: StreamSessionManager;
  private readonly deps: StreamWriteDeps;
  private readonly logger: ILogger;
  private readonly wss: WebSocketServer;
  private attachedServer: HttpServer | undefined;

  constructor(options: StreamHandlerOptions) {
    this.tokenStore = options.tokenStore;
    this.sessionManager = options.sessionManager;
    this.deps = options.deps;
    this.logger = options.logger ?? createLogger('StreamHandler');
    this.wss = new WebSocketServer({ noServer: true });
  }

  /** Expose the session registry so callers/tests can assert on it. */
  get sessions(): StreamSessionManager {
    return this.sessionManager;
  }

  /** Register the HTTP `upgrade` listener for this handler's endpoint. */
  attach(server: HttpServer): void {
    this.attachedServer = server;
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      void this.handleUpgrade(req, socket, head);
    });
  }

  /**
   * Validate the connection and either refuse the upgrade or complete it.
   *
   * Public so tests can drive it without standing up a TCP listener, though the
   * integration tests exercise the real upgrade path.
   */
  async handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
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

    if (socket.destroyed) {
      // The peer gave up while we were validating; release the reserved slot.
      this.sessionManager.close(result.context.session.id);
      return;
    }

    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.establish(ws, result.context);
    });
  }

  /**
   * Run every connection-time check in order and return either a session
   * context or the rejection to send. Token validation happens first and is
   * destructive (single-use), so a later failure still burns the token.
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

    const apiKey = await this.deps.authService.getApiKey(record.apiKeyId);
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

    const opened = this.sessionManager.tryOpen(
      apiKey.id,
      graphId,
      apiKey.rateLimit.concurrentStreams
    );
    if (!opened.ok) {
      return {
        ok: false,
        rejection: {
          status: 429,
          statusText: 'Too Many Requests',
          code: 'CONCURRENT_LIMIT',
          message: `Concurrent stream limit of ${opened.limit} reached for this API key`,
        },
      };
    }

    return {
      ok: true,
      context: { session: opened.session, apiKey, graphId },
    };
  }

  /** Accept the socket, announce the session and wire message handlers. */
  private establish(ws: WebSocket, context: ConnectionContext): void {
    const { session, apiKey, graphId } = context;

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

    ws.on('message', (data: RawData) => {
      void this.onMessage(ws, context, data);
    });

    ws.on('close', () => {
      const closed = this.sessionManager.close(session.id);
      this.logger.info('Stream session closed', {
        sessionId: session.id,
        messagesReceived: closed?.messagesReceived ?? 0,
        entitiesCreated: closed?.entitiesCreated ?? 0,
      });
    });

    ws.on('error', (error) => {
      this.logger.warn('Stream socket error', { sessionId: session.id, error: String(error) });
      this.sessionManager.close(session.id);
    });
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

    this.sessionManager.recordMessage(context.session.id);

    const requestId = typeof parsed.requestId === 'string' ? parsed.requestId : undefined;

    switch (parsed.type) {
      case 'close':
        this.send(ws, { type: 'closed', reason: 'client_requested' });
        this.sessionManager.close(context.session.id);
        ws.close(1000, 'client_requested');
        return;
      case 'event':
        await this.handleEntity(ws, context, 'event', parsed.data, requestId);
        return;
      case 'arc':
        await this.handleEntity(ws, context, 'arc', parsed.data, requestId);
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
        error: 'Message "data" must be an object',
      });
      return;
    }

    const requiredPermission: Permission = entityType === 'event' ? 'write:events' : 'write:arcs';
    if (!context.apiKey.hasPermission(requiredPermission)) {
      this.send(ws, {
        type: 'ack',
        requestId,
        entityType,
        entityId: null,
        success: false,
        error: `Missing required permission: ${requiredPermission}`,
      });
      return;
    }

    try {
      if (entityType === 'event') {
        const converted = toCreateEventRequest(data);
        if (!converted.ok) {
          throw new Error(converted.error);
        }
        const { eventRepository } = await this.deps.graphScopedRepositories(context.graphId);
        const event = await eventRepository.create(converted.value);
        await this.deps.graphWriteVersioningService.recordEvent(context.graphId, event, 'create');
        this.sessionManager.recordEntity(context.session.id);
        this.send(ws, {
          type: 'ack',
          requestId,
          entityType,
          entityId: event.id,
          success: true,
        });
        return;
      }

      const converted = toCreateArcRequest(data);
      if (!converted.ok) {
        throw new Error(converted.error);
      }
      const { arcRepository } = await this.deps.graphScopedRepositories(context.graphId);
      const arc = await arcRepository.create(converted.value);
      await this.deps.graphWriteVersioningService.recordArc(context.graphId, arc, 'create');
      this.sessionManager.recordEntity(context.session.id);
      this.send(ws, {
        type: 'ack',
        requestId,
        entityType,
        entityId: arc.id,
        success: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown write error';
      this.logger.warn('Stream write failed', { sessionId: context.session.id, entityType, error: message });
      this.send(ws, {
        type: 'ack',
        requestId,
        entityType,
        entityId: null,
        success: false,
        error: message,
      });
    }
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState !== WebSocket.OPEN) {
      return;
    }
    ws.send(JSON.stringify(message));
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
    for (const client of this.wss.clients) {
      try {
        client.terminate();
      } catch {
        // Already gone; nothing to do.
      }
    }
    this.sessionManager.closeAll();

    return new Promise((resolve) => {
      this.wss.close(() => resolve());
    });
  }

  /** Stop listening for upgrades on the attached HTTP server. */
  detach(): void {
    if (this.attachedServer) {
      this.attachedServer.removeAllListeners('upgrade');
      this.attachedServer = undefined;
    }
  }
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
  if (socket.destroyed) {
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
    socket.end(response);
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
