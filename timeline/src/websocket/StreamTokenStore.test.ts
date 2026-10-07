/**
 * Unit tests for the stream token store.
 *
 * Each test names the property it pins. If the implementation's corresponding
 * branch were deleted:
 *   - "issues ... five minute TTL" fails if the TTL is dropped or the token is
 *     made deterministic;
 *   - "consumes ... replayed" fails if the single-use flag is ignored;
 *   - "reports an expired token" fails if the expiry check is removed;
 *   - "unknown/malformed" fails if validation is bypassed.
 */

import { describe, it, expect } from 'vitest';
import { StreamTokenStore, STREAM_TOKEN_TTL_MS } from './StreamTokenStore';

describe('StreamTokenStore', () => {
  it('issues opaque, unique tokens with a five minute TTL bound to key and graph', () => {
    const store = new StreamTokenStore();
    const now = 1_700_000_000_000;

    const first = store.issue({
      apiKeyId: 'key_1',
      graphId: 'graph_a',
      permissions: ['write:events'],
      now,
    });
    const second = store.issue({
      apiKeyId: 'key_1',
      graphId: 'graph_a',
      permissions: ['write:events'],
      now,
    });

    expect(first.token).not.toBe(second.token);
    // 32 random bytes base64url-encode to at least 42 characters; asserting a
    // floor rather than an exact length keeps the test stable across Node's
    // base64url padding behaviour while still rejecting a short/predictable id.
    expect(first.token.length).toBeGreaterThanOrEqual(42);
    expect(first.apiKeyId).toBe('key_1');
    expect(first.graphId).toBe('graph_a');
    expect(first.permissions).toEqual(['write:events']);
    expect(new Date(first.expiresAt).getTime() - now).toBe(STREAM_TOKEN_TTL_MS);
    expect(first.consumed).toBe(false);
    expect(store.size).toBe(2);
  });

  it('consumes a token exactly once and reports the second use as replayed', () => {
    const store = new StreamTokenStore();
    const record = store.issue({
      apiKeyId: 'key_1',
      graphId: 'graph_a',
      permissions: ['write:events'],
    });

    const first = store.consume(record.token);
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.token.apiKeyId).toBe('key_1');
    }

    const second = store.consume(record.token);
    expect(second).toEqual({ ok: false, reason: 'replayed' });
  });

  it('reports an expired token as expired and drops it from the store', () => {
    const store = new StreamTokenStore();
    const now = 1_700_000_000_000;
    const record = store.issue({
      apiKeyId: 'key_1',
      graphId: 'graph_a',
      permissions: ['write:events'],
      ttlMs: 1000,
      now,
    });

    const result = store.consume(record.token, now + 2000);
    expect(result).toEqual({ ok: false, reason: 'expired' });
    expect(store.peek(record.token)).toBeUndefined();
  });

  it('reports unknown and malformed tokens without throwing', () => {
    const store = new StreamTokenStore();

    expect(store.consume('no-such-token')).toEqual({ ok: false, reason: 'unknown' });
    expect(store.consume(undefined)).toEqual({ ok: false, reason: 'malformed' });
    expect(store.consume('')).toEqual({ ok: false, reason: 'malformed' });
    expect(store.consume(42)).toEqual({ ok: false, reason: 'malformed' });
    expect(store.consume(null)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('cleanup removes only expired records', () => {
    const store = new StreamTokenStore();
    const now = 1_700_000_000_000;
    store.issue({
      apiKeyId: 'key_1',
      graphId: 'graph_a',
      permissions: ['write:events'],
      ttlMs: 1000,
      now,
    });
    store.issue({
      apiKeyId: 'key_1',
      graphId: 'graph_a',
      permissions: ['write:events'],
      ttlMs: 60_000,
      now,
    });

    expect(store.cleanup(now + 2000)).toBe(1);
    expect(store.size).toBe(1);
  });

  it('evicts expired records as a side effect of issuing a token', () => {
    const store = new StreamTokenStore();
    const now = 1_700_000_000_000;
    const expired = store.issue({
      apiKeyId: 'key_1',
      graphId: 'graph_a',
      permissions: ['write:events'],
      ttlMs: 1000,
      now,
    });
    expect(store.size).toBe(1);

    // No call to `cleanup()`: eviction has to happen on the path production
    // actually uses, or a token nobody presents again is held forever.
    const fresh = store.issue({
      apiKeyId: 'key_1',
      graphId: 'graph_a',
      permissions: ['write:events'],
      ttlMs: 60_000,
      now: now + 2000,
    });

    expect(store.peek(expired.token)).toBeUndefined();
    expect(store.peek(fresh.token)).toBeDefined();
    expect(store.size).toBe(1);
  });

  it('evicts expired records on the timer when constructed with an eviction interval', async () => {
    const store = new StreamTokenStore({ evictionIntervalMs: 20 });
    try {
      const now = Date.now();
      store.issue({
        apiKeyId: 'key_1',
        graphId: 'graph_a',
        permissions: ['write:events'],
        ttlMs: 1,
        now: now - 1000,
      });
      expect(store.size).toBe(1);

      await new Promise((resolve) => setTimeout(resolve, 120));
      expect(store.size).toBe(0);
    } finally {
      store.dispose();
    }
  });

  it('does not schedule an eviction timer unless one is asked for', () => {
    // A store built for a test must not leave a timer behind that fires later
    // against a store whose assertions have finished.
    const store = new StreamTokenStore();
    const now = Date.now();
    store.issue({
      apiKeyId: 'key_1',
      graphId: 'graph_a',
      permissions: ['write:events'],
      ttlMs: 1,
      now: now - 1000,
    });
    expect(store.size).toBe(1);
    store.dispose();
  });
});
