/**
 * Unit tests for stream session concurrency enforcement.
 *
 * "refuses the N+1th" is the load-bearing test: if `tryOpen` stopped checking
 * the count, it would still return `ok: true` and the test fails.
 */

import { describe, it, expect } from 'vitest';
import { StreamSessionManager } from './StreamSession';

describe('StreamSessionManager', () => {
  it('refuses the N+1th session for the same API key and reports the limit', () => {
    const manager = new StreamSessionManager();

    expect(manager.tryOpen('key_1', 'graph_a', 2).ok).toBe(true);
    expect(manager.tryOpen('key_1', 'graph_a', 2).ok).toBe(true);

    const third = manager.tryOpen('key_1', 'graph_a', 2);
    expect(third.ok).toBe(false);
    if (!third.ok) {
      expect(third.reason).toBe('limit');
      expect(third.limit).toBe(2);
      expect(third.active).toBe(2);
    }
    expect(manager.countFor('key_1')).toBe(2);
  });

  it('counts limits independently per API key', () => {
    const manager = new StreamSessionManager();
    manager.tryOpen('key_1', 'graph_a', 1);
    // key_1 is at its limit, but key_2 is untouched.
    expect(manager.tryOpen('key_1', 'graph_a', 1).ok).toBe(false);
    expect(manager.tryOpen('key_2', 'graph_a', 1).ok).toBe(true);
    expect(manager.countFor('key_2')).toBe(1);
  });

  it('releases a slot when a session closes', () => {
    const manager = new StreamSessionManager();
    const first = manager.tryOpen('key_1', 'graph_a', 1);
    expect(first.ok).toBe(true);
    expect(manager.tryOpen('key_1', 'graph_a', 1).ok).toBe(false);

    if (first.ok) {
      manager.close(first.session.id);
    }
    expect(manager.countFor('key_1')).toBe(0);
    expect(manager.tryOpen('key_1', 'graph_a', 1).ok).toBe(true);
  });

  it('closeAll drops every session', () => {
    const manager = new StreamSessionManager();
    manager.tryOpen('key_1', 'graph_a', 5);
    manager.tryOpen('key_2', 'graph_a', 5);
    const closed = manager.closeAll();
    expect(closed).toHaveLength(2);
    expect(manager.totalCount).toBe(0);
  });

  it('clamps a non-positive limit to 1 rather than refusing every connection', () => {
    const manager = new StreamSessionManager();
    expect(manager.tryOpen('key_1', 'graph_a', 0).ok).toBe(true);
    expect(manager.tryOpen('key_1', 'graph_a', 0).ok).toBe(false);
  });

  it('reports the hard lifetime limit and does not extend it with traffic', () => {
    const manager = new StreamSessionManager({ maxLifetimeMs: 1000, idleTimeoutMs: 60_000 });
    const now = 1_700_000_000_000;
    const opened = manager.tryOpen('key_1', 'graph_a', 1, now);
    expect(opened.ok).toBe(true);
    if (!opened.ok) {
      return;
    }

    manager.recordMessage(opened.session.id, now + 900);
    expect(manager.expiredReason(opened.session.id, now + 999)).toBeUndefined();
    expect(manager.expiredReason(opened.session.id, now + 1000)).toBe('lifetime');

    // A message that arrives on the boundary must not buy a new lifetime.
    manager.recordMessage(opened.session.id, now + 2000);
    expect(manager.expiredReason(opened.session.id, now + 2000)).toBe('lifetime');
  });

  it('reports the idle limit and resets it on traffic', () => {
    const manager = new StreamSessionManager({ maxLifetimeMs: 60_000, idleTimeoutMs: 500 });
    const now = 1_700_000_000_000;
    const opened = manager.tryOpen('key_1', 'graph_a', 1, now);
    expect(opened.ok).toBe(true);
    if (!opened.ok) {
      return;
    }

    expect(manager.expiredReason(opened.session.id, now + 499)).toBeUndefined();
    manager.recordMessage(opened.session.id, now + 400);
    expect(manager.expiredReason(opened.session.id, now + 800)).toBeUndefined();
    expect(manager.expiredReason(opened.session.id, now + 900)).toBe('idle');
  });

  it('reports no expiry for an unknown session', () => {
    const manager = new StreamSessionManager();
    expect(manager.expiredReason('stream_does_not_exist')).toBeUndefined();
    expect(manager.sweep()).toEqual([]);
  });

  it('sweep removes an expired session and frees the slot it was holding', () => {
    const manager = new StreamSessionManager({ maxLifetimeMs: 1000, idleTimeoutMs: 1000 });
    const now = 1_700_000_000_000;
    expect(manager.tryOpen('key_1', 'graph_a', 1, now).ok).toBe(true);
    // The slot is taken, so a second connection is refused...
    expect(manager.tryOpen('key_1', 'graph_a', 1, now).ok).toBe(false);

    const swept = manager.sweep(now + 1000);
    expect(swept).toHaveLength(1);
    expect(swept[0]?.reason).toBe('lifetime');

    // ...and reclaiming it is what lets the key stream again.
    expect(manager.countFor('key_1')).toBe(0);
    expect(manager.expiredReason(swept[0]?.session.id ?? '', now + 1000)).toBeUndefined();
    expect(manager.tryOpen('key_1', 'graph_a', 1, now + 1000).ok).toBe(true);
  });
});
