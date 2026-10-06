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

export class StreamTokenStore {
  private readonly tokens = new Map<string, StreamTokenRecord>();

  /**
   * Mint a token bound to one API key, one graph and a snapshot of the key's
   * permissions. Returns the stored record (the caller must not mutate it).
   */
  issue(input: IssueStreamTokenInput): StreamTokenRecord {
    const now = input.now ?? Date.now();
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
}
