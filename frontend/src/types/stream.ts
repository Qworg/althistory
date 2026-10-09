/**
 * Types and wire protocol definitions for the WebSocket streaming write client (Requirement 16).
 */

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

export interface ClientEventMessage {
  type: 'event'
  requestId?: string
  data: Record<string, unknown>
}

export interface ClientArcMessage {
  type: 'arc'
  requestId?: string
  data: Record<string, unknown>
}

export interface ClientCloseMessage {
  type: 'close'
}

export type ClientStreamMessage = ClientEventMessage | ClientArcMessage | ClientCloseMessage

export interface ServerAuthResultMessage {
  type: 'auth_result'
  success: boolean
  sessionId?: string
  apiKeyId?: string
  graphId?: string
  concurrentStreams?: number
  error?: string
  code?: StreamErrorCode
}

export interface ServerAckMessage {
  type: 'ack'
  requestId?: string
  entityType: 'event' | 'arc'
  entityId: string | null
  success: boolean
  error?: string
  code?: StreamErrorCode
}

export interface ServerWarningMessage {
  type: 'warning'
  message: string
  entityId?: string
}

export interface ServerErrorMessage {
  type: 'error'
  code: StreamErrorCode
  message: string
}

export interface ServerClosedMessage {
  type: 'closed'
  reason: string
}

export type ServerStreamMessage =
  | ServerAuthResultMessage
  | ServerAckMessage
  | ServerWarningMessage
  | ServerErrorMessage
  | ServerClosedMessage

export interface StreamTokenResponse {
  token: string
  expiresIn: number
  graphId: string
  permissions: string[]
  concurrentStreams: number
}
