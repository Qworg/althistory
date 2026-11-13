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
  | 'GRAPH_NOT_FOUND'
  | 'SUBSCRIPTION_LIMIT'
  | 'READ_ONLY_STREAM'

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

export interface ClientRelationshipMessage {
  type: 'relationship'
  requestId?: string
  data: Record<string, unknown>
}

export interface ClientCloseMessage {
  type: 'close'
}

/** Watch a graph (or `*`, the graph list); `since` and `epoch` resume after a drop. */
export interface ClientSubscribeMessage {
  type: 'subscribe'
  requestId?: string
  graphId: string
  epoch?: string
  since?: number
}

export interface ClientUnsubscribeMessage {
  type: 'unsubscribe'
  requestId?: string
  graphId: string
}

export interface ClientPingMessage {
  type: 'ping'
}

export type ClientStreamMessage =
  | ClientEventMessage
  | ClientArcMessage
  | ClientRelationshipMessage
  | ClientCloseMessage
  | ClientSubscribeMessage
  | ClientUnsubscribeMessage
  | ClientPingMessage

export interface ServerAuthResultMessage {
  type: 'auth_result'
  success: boolean
  sessionId?: string
  apiKeyId?: string
  graphId?: string
  concurrentStreams?: number
  mode?: 'write' | 'feed'
  error?: string
  code?: StreamErrorCode
}

/** The subscription is in place; `resync` says the client must refetch rather than resume. */
export interface ServerSubscribedMessage {
  type: 'subscribed'
  requestId?: string
  graphId: string
  epoch: string
  seq: number
  replayed: number
  resync?: 'gap' | 'epoch'
}

export interface ServerUnsubscribedMessage {
  type: 'unsubscribed'
  requestId?: string
  graphId: string
  reason: 'requested' | 'access_revoked'
}

export interface ServerPongMessage {
  type: 'pong'
}

export type ChangedEntityType = 'event' | 'arc' | 'relationship' | 'pressure'

export type ChangeActorKind = 'person' | 'agent' | 'cli' | 'api' | 'generation' | 'system'

/** Who made a change. */
export interface ChangeActor {
  kind: ChangeActorKind
  name?: string
  keyId?: string
}

/** What a change was, by kind; `LiveChange` adds where, when and by whom. */
export type LiveChangeBody =
  | {
      kind: 'entities'
      operation: 'create' | 'update' | 'delete'
      entities: Array<{ type: ChangedEntityType; id: string }>
      summary: string
    }
  | {
      kind: 'replaced'
      reason: string
      summary: string
      counts?: { events: number; arcs: number; relationships: number }
    }
  | {
      kind: 'graph'
      operation: 'create' | 'update' | 'delete'
      fields?: string[]
      name?: string
      summary: string
    }
  | {
      kind: 'generation'
      jobId: string
      status: 'running' | 'completed' | 'failed' | 'cancelled'
      phase?: string
      progress: number
      message: string
      source?: 'model' | 'template'
      written?: { events: number; arcs: number; relationships: number }
      summary: string
    }

/** A committed change to a graph, pushed by the server whoever made it. */
export type LiveChange = LiveChangeBody & {
  graphId: string
  seq: number
  at: string
  actor: ChangeActor
  /** The browser tab that made it, when it said. */
  origin?: string
}

export type ServerChangeMessage = { type: 'change' } & LiveChange

export interface ServerAckMessage {
  type: 'ack'
  requestId?: string
  entityType: 'event' | 'arc' | 'relationship'
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
  requestId?: string
  /** The channel a refused `subscribe` named. */
  graphId?: string
  /** Seconds until a rate-limited request may be repeated. */
  retryAfter?: number
}

export interface ServerClosedMessage {
  type: 'closed'
  reason: string
}

export type ServerStreamMessage =
  | ServerAuthResultMessage
  | ServerSubscribedMessage
  | ServerUnsubscribedMessage
  | ServerPongMessage
  | ServerChangeMessage
  | ServerAckMessage
  | ServerWarningMessage
  | ServerErrorMessage
  | ServerClosedMessage

export interface StreamTokenResponse {
  token: string
  expiresIn: number
  graphId: string
  permissions: string[]
  mode?: 'write' | 'feed'
  concurrentStreams: number
}
