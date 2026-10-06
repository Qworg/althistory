/**
 * Wire protocol for the WebSocket streaming endpoint.
 *
 * Kept separate from the handler so the route, the handler and the tests all
 * describe the same message shapes. There is no `any` here: each message type
 * is a discriminated union member and unknown inbound payloads are narrowed with
 * `isRecord` before use.
 */

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
  | 'INVALID_MESSAGE'
  | 'WRITE_FAILED';

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

/** Client -> server: end the session cleanly. */
export interface ClientCloseMessage {
  type: 'close';
}

export type ClientMessage = ClientEventMessage | ClientArcMessage | ClientCloseMessage;

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
  error?: string;
  code?: StreamErrorCode;
}

/** Server -> client: per-event acknowledgment (requirement 16.3). */
export interface ServerAckMessage {
  type: 'ack';
  requestId?: string;
  entityType: 'event' | 'arc';
  entityId: string | null;
  success: boolean;
  error?: string;
}

/** Server -> client: non-blocking validation warning (requirement 16.4). */
export interface ServerWarningMessage {
  type: 'warning';
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
