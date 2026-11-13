/**
 * Wire protocol for the WebSocket streaming endpoint.
 *
 * Kept separate from the handler so the route, the handler and the tests all
 * describe the same message shapes. There is no `any` here: each message type
 * is a discriminated union member and unknown inbound payloads are narrowed with
 * `isRecord` before use.
 */

import type { ChangeRecord } from '@/services/ChangeFeedService';

/** Why a connection or message was rejected. Sent to the client verbatim. */
export type StreamErrorCode =
  | 'MALFORMED_TOKEN'
  | 'UNKNOWN_TOKEN'
  | 'EXPIRED_TOKEN'
  | 'REPLAYED_TOKEN'
  | 'KEY_INVALID'
  | 'PERMISSION_DENIED'
  | 'GRAPH_ACCESS_DENIED'
  | 'CONCURRENT_LIMIT'
  | 'UPGRADE_INVALID'
  | 'INVALID_MESSAGE'
  | 'RATE_LIMITED'
  | 'CONCURRENT_WRITE_LIMIT'
  | 'SESSION_EXPIRED'
  | 'WRITE_FAILED'
  | 'GRAPH_NOT_FOUND'
  | 'SUBSCRIPTION_LIMIT'
  | 'READ_ONLY_STREAM';

/** Client -> server: write one event. */
export interface ClientEventMessage {
  type: 'event';
  requestId?: string;
  data: Record<string, unknown>;
}

/** Client -> server: write one arc. */
export interface ClientArcMessage {
  type: 'arc';
  requestId?: string;
  data: Record<string, unknown>;
}

/** Client -> server: write one causal relationship. */
export interface ClientRelationshipMessage {
  type: 'relationship';
  requestId?: string;
  data: Record<string, unknown>;
}

/** Client -> server: end the session cleanly. */
export interface ClientCloseMessage {
  type: 'close';
}

/**
 * Client -> server: watch a graph's changes (the live change feed).
 *
 * `graphId` is a graph the key may read, or `*` for changes to the graph list
 * (a graph made, renamed, deleted or replaced), filtered to the graphs the key
 * may access. A client that is reconnecting passes the `epoch` and the `seq` of
 * the last change it saw for the graph, and the server replays what it missed
 * or says it cannot (`resync`).
 */
export interface ClientSubscribeMessage {
  type: 'subscribe';
  requestId?: string;
  graphId: string;
  epoch?: string;
  since?: number;
}

/** Client -> server: stop watching a graph. */
export interface ClientUnsubscribeMessage {
  type: 'unsubscribe';
  requestId?: string;
  graphId: string;
}

/** Client -> server: keep the session from idling out; answered with `pong`. */
export interface ClientPingMessage {
  type: 'ping';
}

export type ClientMessage =
  | ClientEventMessage
  | ClientArcMessage
  | ClientRelationshipMessage
  | ClientCloseMessage
  | ClientSubscribeMessage
  | ClientUnsubscribeMessage
  | ClientPingMessage;

/**
 * Server -> client: result of the connection-time token validation.
 *
 * `success: false` is only sent if a policy chooses to accept the handshake and
 * then refuse the session. The current handler refuses invalid tokens at the
 * HTTP upgrade instead, so in practice a client only receives a successful
 * auth_result; the failure shape is kept part of the protocol for clients that
 * have already been handed a socket.
 */
export interface ServerAuthResultMessage {
  type: 'auth_result';
  success: boolean;
  sessionId?: string;
  apiKeyId?: string;
  graphId?: string;
  concurrentStreams?: number;
  /** `write` or `feed`; see `StreamToken.mode`. */
  mode?: 'write' | 'feed';
  error?: string;
  code?: StreamErrorCode;
}

/**
 * Server -> client: the subscription is in place.
 *
 * `epoch` names this server process and `seq` is where its feed was when the
 * subscription began: a client that keeps both can resume later. After it come
 * the `replayed` changes the client missed, in order. `resync` is set when the
 * client asked to resume and the server cannot replay what it missed (`gap`:
 * too much happened, `epoch`: the server restarted): the client must refetch
 * the graph instead.
 */
export interface ServerSubscribedMessage {
  type: 'subscribed';
  requestId?: string;
  graphId: string;
  epoch: string;
  seq: number;
  replayed: number;
  resync?: 'gap' | 'epoch';
}

/** Server -> client: the subscription ended (asked for, or the key lost access). */
export interface ServerUnsubscribedMessage {
  type: 'unsubscribed';
  requestId?: string;
  graphId: string;
  reason: 'requested' | 'access_revoked';
}

/** Server -> client: answer to `ping`. */
export interface ServerPongMessage {
  type: 'pong';
}

/**
 * Server -> client: a committed change to a graph the client watches, whoever
 * made it. See `ChangeRecord` for the fields: `kind` is `entities`,
 * `replaced`, `graph` or `generation`.
 */
export type ServerChangeMessage = { type: 'change' } & ChangeRecord;

/** Server -> client: per-event acknowledgment (requirement 16.3). */
export interface ServerAckMessage {
  type: 'ack';
  requestId?: string;
  entityType: 'event' | 'arc' | 'relationship';
  entityId: string | null;
  success: boolean;
  error?: string;
  /**
   * Why the write failed. Present only on `success: false`, and it is the
   * machine-readable counterpart of `error` (which is prose for a human).
   */
  code?: StreamErrorCode;
}

/** Server -> client: non-blocking validation warning (requirement 16.4). */
export interface ServerWarningMessage {
  type: 'warning';
  requestId?: string;
  message: string;
  entityId?: string;
}

/** Server -> client: protocol-level error. */
export interface ServerErrorMessage {
  type: 'error';
  code: StreamErrorCode;
  message: string;
}

/** Server -> client: the session is closing. */
export interface ServerClosedMessage {
  type: 'closed';
  reason: string;
}

export type ServerMessage =
  | ServerAuthResultMessage
  | ServerSubscribedMessage
  | ServerUnsubscribedMessage
  | ServerPongMessage
  | ServerChangeMessage
  | ServerAckMessage
  | ServerWarningMessage
  | ServerErrorMessage
  | ServerClosedMessage;

/** Runtime narrowing for `unknown` values before reading properties. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read a non-empty string field from an untyped record.
 *
 * Returns `undefined` for anything that is not a non-empty string, so a
 * numeric/object field is treated as missing rather than coerced.
 */
export function readNonEmptyString(
  data: Record<string, unknown>,
  key: string
): string | undefined {
  const value = data[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
