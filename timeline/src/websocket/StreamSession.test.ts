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
});
