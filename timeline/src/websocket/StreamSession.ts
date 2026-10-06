/**
 * Active WebSocket stream session tracking and concurrency enforcement.
 *
 * The limit is enforced here rather than merely stored: `tryOpen` refuses to
 * create a session once the key already has `maxConcurrent` sessions, and it is
 * called on the connection path before the session is ever established. The
 * limit value comes from the API key's
 * `rateLimit.concurrentStreams` (default 5, see `DEFAULT_RATE_LIMITS`).
 */

import { randomUUID } from 'crypto';

/** One live streaming session (design §WebSocket Streaming Models). */
export interface StreamSession {
  id: string;
  apiKeyId: string;
  graphId: string;
  connectedAt: string;
  lastActivityAt: string;
  messagesReceived: number;
  entitiesCreated: number;
}

export type OpenSessionResult =
  | { ok: true; session: StreamSession }
  | { ok: false; reason: 'limit'; limit: number; active: number };

export class StreamSessionManager {
  private readonly sessions = new Map<string, StreamSession>();

  /**
   * Reserve a session slot for `apiKeyId` if it is under `maxConcurrent`.
   *
   * `maxConcurrent` is floored and clamped to at least 1 so a malformed limit
   * of 0 or a negative value cannot make the stream endpoint unusable while
   * still refusing to over-admit.
   */
  tryOpen(
    apiKeyId: string,
    graphId: string,
    maxConcurrent: number,
    now: number = Date.now()
  ): OpenSessionResult {
    const limit = Math.max(1, Math.floor(maxConcurrent));
    const active = this.countFor(apiKeyId);

    if (active >= limit) {
      return { ok: false, reason: 'limit', limit, active };
    }

    const timestamp = new Date(now).toISOString();
    const session: StreamSession = {
      id: `stream_${randomUUID()}`,
      apiKeyId,
      graphId,
      connectedAt: timestamp,
      lastActivityAt: timestamp,
      messagesReceived: 0,
      entitiesCreated: 0,
    };

    this.sessions.set(session.id, session);
    return { ok: true, session };
  }

  get(sessionId: string): StreamSession | undefined {
    return this.sessions.get(sessionId);
  }

  /** Bump the activity timestamp. Called on every inbound message. */
  touch(sessionId: string, now: number = Date.now()): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivityAt = new Date(now).toISOString();
    }
  }

  recordMessage(sessionId: string, now: number = Date.now()): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.messagesReceived += 1;
      session.lastActivityAt = new Date(now).toISOString();
    }
  }

  recordEntity(sessionId: string, count = 1): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.entitiesCreated += count;
    }
  }

  /** Remove a session. Returns the removed session, if any. */
  close(sessionId: string): StreamSession | undefined {
    const session = this.sessions.get(sessionId);
    this.sessions.delete(sessionId);
    return session;
  }

  countFor(apiKeyId: string): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.apiKeyId === apiKeyId) {
        count += 1;
      }
    }
    return count;
  }

  all(): StreamSession[] {
    return Array.from(this.sessions.values());
  }

  get totalCount(): number {
    return this.sessions.size;
  }

  /** Remove every session. Returns the sessions that were open. */
  closeAll(): StreamSession[] {
    const open = this.all();
    this.sessions.clear();
    return open;
  }
}
