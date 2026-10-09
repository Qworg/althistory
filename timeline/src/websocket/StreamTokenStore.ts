/**
 * In-memory store for short-lived WebSocket stream tokens.
 *
 * Security properties that are implemented AND covered by tests:
 *   - Tokens are opaque 32-byte random values from `crypto.randomBytes`, never
 *     derived from or equal to the API key.
 *   - A token expires 5 minutes (`STREAM_TOKEN_TTL_MS`) after issue.
 *   - A token is single-use: the first successful `consume` marks it consumed
 *     and every later `consume` reports `replayed`. That is also the reconnect
 *     policy from requirement 16.5 -- a dropped connection cannot reuse its
 *     token and must request a new one.
 *
 * Bounded memory: a record is dropped as soon as it is expired, not only when
 * somebody presents it again.
 *   - `consume` deletes an expired record it is handed;
 *   - `issue` sweeps every expired record before storing the new one, so the
 *     store can never grow past the tokens issued in the last TTL window;
 *   - a store constructed with `evictionIntervalMs` also sweeps on a timer,
 *     which is what the process-wide store (see `getStreamTokenStore`) does.
 *
 * Properties that are deliberately NOT claimed:
 *   - The store is per-process and not shared across instances (no Redis
 *     backend exists for it).
 *   - The token record is not deleted when the API key is revoked; revocation
 *     is enforced instead by re-resolving the key on connect, which rejects a
 *     revoked key even when its token record is still present.
 */

import { randomBytes } from 'crypto';
import type { Permission, StreamToken } from '@/models/ApiKey';

/** Requirement 16.1: stream tokens live for five minutes. */
export const STREAM_TOKEN_TTL_MS = 5 * 60 * 1000;

/**
 * How often the process-wide store sweeps expired records. Eviction is not
 * only timer-driven -- `issue` sweeps too -- so a burst of traffic cannot
 * outrun this interval.
 */
export const STREAM_TOKEN_EVICTION_INTERVAL_MS = 60 * 1000;

/** A stored token plus the server-side single-use flag. */
export interface StreamTokenRecord extends StreamToken {
  consumed: boolean;
}

/**
 * Why `consume` refused a token. The handler maps each reason to a client code
 * and HTTP status; keeping them distinct is what makes "unknown", "expired" and
 * "replayed" separately testable.
 */
export type StreamTokenRejectionReason = 'malformed' | 'unknown' | 'expired' | 'replayed';

export type StreamTokenConsumeResult =
  | { ok: true; token: StreamTokenRecord }
  | { ok: false; reason: StreamTokenRejectionReason };

export interface IssueStreamTokenInput {
  apiKeyId: string;
  graphId: string;
  permissions: Permission[];
  ttlMs?: number;
  now?: number;
}

export interface StreamTokenStoreOptions {
  /**
   * When set, expired records are also swept on this interval (the timer is
   * unref'd so it never keeps the process alive). Omitted by default so a store
   * built inside a test does not schedule timers it does not own.
   */
  evictionIntervalMs?: number;
}

export class StreamTokenStore {
  private readonly tokens = new Map<string, StreamTokenRecord>();
  private evictionTimer: NodeJS.Timeout | undefined;

  constructor(options: StreamTokenStoreOptions = {}) {
    if (options.evictionIntervalMs !== undefined) {
      this.evictionTimer = setInterval(() => {
        this.cleanup();
      }, options.evictionIntervalMs);
      // Never hold the event loop open just to sweep tokens.
      this.evictionTimer.unref();
    }
  }

  /**
   * Mint a token bound to one API key, one graph and a snapshot of the key's
   * permissions. Returns the stored record (the caller must not mutate it).
   *
   * Expired records are evicted first, which is what bounds the store: every
   * record is either handed back by `consume` (which deletes it if expired),
   * swept here by the next `issue`, or swept by the eviction timer.
   */
  issue(input: IssueStreamTokenInput): StreamTokenRecord {
    const now = input.now ?? Date.now();
    this.cleanup(now);
    const ttlMs = input.ttlMs ?? STREAM_TOKEN_TTL_MS;
    const token = randomBytes(32).toString('base64url');

    const record: StreamTokenRecord = {
      token,
      apiKeyId: input.apiKeyId,
      graphId: input.graphId,
      permissions: [...input.permissions],
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlMs).toISOString(),
      consumed: false,
    };

    this.tokens.set(token, record);
    return record;
  }

  /**
   * Atomically validate and burn a token.
   *
   * Order matters for the reported reason: expiry is checked before the
   * consumed flag so an expired-and-already-used token reports `expired`, and a
   * consumed token that is still inside its window reports `replayed`.
   */
  consume(token: unknown, now: number = Date.now()): StreamTokenConsumeResult {
    if (typeof token !== 'string' || token.length === 0) {
      return { ok: false, reason: 'malformed' };
    }

    const record = this.tokens.get(token);
    if (!record) {
      return { ok: false, reason: 'unknown' };
    }

    if (new Date(record.expiresAt).getTime() <= now) {
      this.tokens.delete(token);
      return { ok: false, reason: 'expired' };
    }

    if (record.consumed) {
      return { ok: false, reason: 'replayed' };
    }

    record.consumed = true;
    return { ok: true, token: record };
  }

  /**
   * Read a token record without consuming it. Intended for tests and
   * introspection; the connection path must use `consume`.
   */
  peek(token: string): StreamTokenRecord | undefined {
    return this.tokens.get(token);
  }

  /** Number of live records, including consumed-but-not-expired ones. */
  get size(): number {
    return this.tokens.size;
  }

  /** Drop every expired record. Returns how many were removed. */
  cleanup(now: number = Date.now()): number {
    let removed = 0;
    for (const [token, record] of this.tokens) {
      if (new Date(record.expiresAt).getTime() <= now) {
        this.tokens.delete(token);
        removed += 1;
      }
    }
    return removed;
  }

  /** Remove all records. Used by tests and by nothing in production. */
  clear(): void {
    this.tokens.clear();
  }

  /** Stop the eviction timer so the store can be discarded. Idempotent. */
  dispose(): void {
    if (this.evictionTimer) {
      clearInterval(this.evictionTimer);
      this.evictionTimer = undefined;
    }
  }
}
