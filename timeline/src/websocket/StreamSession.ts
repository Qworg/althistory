/**
 * Active WebSocket stream session tracking, concurrency and lifetime
 * enforcement.
 *
 * The concurrency limit is enforced here rather than merely stored: `tryOpen`
 * refuses to create a session once the key already has `maxConcurrent` sessions,
 * and it is called on the connection path after the connection is authorised
 * but before the handshake is completed. The limit value comes from the API
 * key's `rateLimit.concurrentStreams` (default 5, see `DEFAULT_RATE_LIMITS`).
 *
 * Two lifetime limits are enforced on top of the concurrency limit:
 *   - `maxLifetimeMs` is a hard cap measured from `tryOpen`, and is never
 *     extended by traffic;
 *   - `idleTimeoutMs` is measured from the last received message.
 * `expiredReason` reports which limit a session has crossed and `sweep` removes
 * the crossed sessions, so a session that is abandoned while holding a
 * concurrency slot cannot hold it forever.
 *
 * A write path must ask `refusalReason`, not `expiredReason`: once `sweep` or
 * `close` has removed a session, `expiredReason` answers `undefined` for its id
 * -- the same answer a live session gets -- whereas `refusalReason` reports
 * `unknown`, so a message from a session the manager no longer holds cannot be
 * mistaken for a live one.
 */

import { randomUUID } from 'crypto';

/** How long any stream session may live, regardless of how active it is. */
export const DEFAULT_STREAM_MAX_LIFETIME_MS = 30 * 60 * 1000;

/** How long a stream session may sit idle before its slot is reclaimed. */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

export interface StreamSessionPolicy {
  maxLifetimeMs: number;
  idleTimeoutMs: number;
}

export const DEFAULT_STREAM_SESSION_POLICY: StreamSessionPolicy = {
  maxLifetimeMs: DEFAULT_STREAM_MAX_LIFETIME_MS,
  idleTimeoutMs: DEFAULT_STREAM_IDLE_TIMEOUT_MS,
};

/** Which limit an expired session crossed. */
export type StreamSessionExpiryReason = 'lifetime' | 'idle';

/**
 * Why a message carrying a session id must be refused.
 *
 * `unknown` is separate from the two expiry reasons on purpose: a session id
 * the manager does not hold is not a live session -- once a session has been
 * removed (expired and swept, closed by the client, or released by the socket)
 * its id is gone for good and can never become valid again. Reporting that as a
 * refusal reason rather than as `undefined` is what stops a caller from reading
 * "this id is not here" as "this id is fine to write with".
 */
export type StreamSessionRefusalReason = StreamSessionExpiryReason | 'unknown';

export interface ExpiredStreamSession {
  session: StreamSession;
  reason: StreamSessionExpiryReason;
}

/** One live streaming session. */
export interface StreamSession {
  id: string;
  apiKeyId: string;
  graphId: string;
  connectedAt: string;
  lastActivityAt: string;
  messagesReceived: number;
  entitiesCreated: number;
  /** Hard deadline. Never moved once the session is open. */
  expiresAt: string;
  /** Idle window applied to `lastActivityAt`. */
  idleTimeoutMs: number;
}

export type OpenSessionResult =
  | { ok: true; session: StreamSession }
  | { ok: false; reason: 'limit'; limit: number; active: number };

export class StreamSessionManager {
  private readonly sessions = new Map<string, StreamSession>();
  private readonly policy: StreamSessionPolicy;

  constructor(policy: Partial<StreamSessionPolicy> = {}) {
    this.policy = { ...DEFAULT_STREAM_SESSION_POLICY, ...policy };
  }

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
      expiresAt: new Date(now + this.policy.maxLifetimeMs).toISOString(),
      idleTimeoutMs: this.policy.idleTimeoutMs,
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

  /**
   * Which lifetime limit `sessionId` has crossed, if any.
   *
   * `lifetime` wins over `idle` so a session that is both past its hard cap and
   * idle is reported (and later logged) as having hit the hard cap. Returns
   * `undefined` for an unknown or live session, so a caller cannot act on a
   * session the manager no longer holds.
   */
  expiredReason(
    sessionId: string,
    now: number = Date.now()
  ): StreamSessionExpiryReason | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }
    return this.reasonFor(session, now);
  }

  /**
   * Why `sessionId` may not write, or `undefined` when it may.
   *
   * Unlike `expiredReason`, an id the manager does not hold is reported as
   * `unknown` rather than `undefined`. A caller on the write path needs that
   * distinction: after `sweep` or `close` removed the session, `expiredReason`
   * answers `undefined` for the same id that a live session would get, and a
   * caller that only asks it would treat the next message from a dead session
   * as live and persist the write.
   */
  refusalReason(
    sessionId: string,
    now: number = Date.now()
  ): StreamSessionRefusalReason | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return 'unknown';
    }
    return this.reasonFor(session, now);
  }

  /**
   * Remove every expired session and report why each one went. The caller is
   * responsible for closing the socket that owns the session; this only frees
   * the slot, so a caller that ignores the returned sessions still cannot
   * re-admit over the limit.
   */
  sweep(now: number = Date.now()): ExpiredStreamSession[] {
    const expired: ExpiredStreamSession[] = [];
    for (const session of Array.from(this.sessions.values())) {
      const reason = this.reasonFor(session, now);
      if (reason) {
        this.sessions.delete(session.id);
        expired.push({ session, reason });
      }
    }
    return expired;
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

  private reasonFor(
    session: StreamSession,
    now: number
  ): StreamSessionExpiryReason | undefined {
    if (new Date(session.expiresAt).getTime() <= now) {
      return 'lifetime';
    }
    const idleFor = now - new Date(session.lastActivityAt).getTime();
    if (idleFor >= session.idleTimeoutMs) {
      return 'idle';
    }
    return undefined;
  }
}
