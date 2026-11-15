import { describe, it, expect, vi } from 'vitest';
import { ChangeFeedService, type ChangeBody, type ChangeRecord } from './ChangeFeedService';
import { runWithChangeContext } from '@/utils/ChangeContext';
import type { ILogger } from '@/utils/logger';

const added = (id: string): ChangeBody => ({
  kind: 'entities',
  operation: 'create',
  entities: [{ type: 'event', id }],
  summary: `Added event ${id}`,
});

describe('ChangeFeedService', () => {
  it('stamps each message with a graph, a rising sequence number, a time and an author', () => {
    const feed = new ChangeFeedService({ now: () => new Date('2024-01-02T03:04:05.000Z') });
    const first = feed.publish('g1', added('a'));
    const second = feed.publish('g2', added('b'));
    expect(first).toMatchObject({ graphId: 'g1', seq: 1, at: '2024-01-02T03:04:05.000Z', actor: { kind: 'system' } });
    expect(second.seq).toBe(2);
    expect(feed.cursor).toBe(2);
  });

  it('attributes a change to the open change context, and to the tab that made it', () => {
    const feed = new ChangeFeedService();
    const record = runWithChangeContext(
      { actor: { kind: 'agent', name: 'claude', keyId: 'k1' }, origin: 'tab-7' },
      () => feed.publish('g1', added('a'))
    );
    expect(record.actor).toEqual({ kind: 'agent', name: 'claude', keyId: 'k1' });
    expect(record.origin).toBe('tab-7');
    // Outside any context it is the system's.
    expect(feed.publish('g1', added('b')).origin).toBeUndefined();
  });

  it('delivers every message to every listener, and stops when one unsubscribes', () => {
    const feed = new ChangeFeedService();
    const heard: ChangeRecord[] = [];
    const stop = feed.subscribe((record) => heard.push(record));
    feed.publish('g1', added('a'));
    stop();
    feed.publish('g1', added('b'));
    expect(heard.map((record) => record.seq)).toEqual([1]);
  });

  it('does not let a failing listener fail the write, or starve the others', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() } as unknown as ILogger;
    const feed = new ChangeFeedService({ logger });
    const heard: number[] = [];
    feed.subscribe(() => {
      throw new Error('listener broke');
    });
    feed.subscribe((record) => heard.push(record.seq));
    expect(() => feed.publish('g1', added('a'))).not.toThrow();
    expect(heard).toEqual([1]);
    expect(logger.warn).toHaveBeenCalled();
  });

  describe('replay', () => {
    it('replays what a client missed, for that graph only, in order', () => {
      const feed = new ChangeFeedService();
      feed.publish('g1', added('a')); // 1
      const seen = feed.cursor;
      feed.publish('g2', added('x')); // 2
      feed.publish('g1', added('b')); // 3
      feed.publish('g1', added('c')); // 4
      const result = feed.replay('g1', feed.epoch, seen);
      expect(result.ok && result.records.map((record) => record.seq)).toEqual([3, 4]);
    });

    it('replays nothing for a client that is up to date, or for a graph with no changes', () => {
      const feed = new ChangeFeedService();
      feed.publish('g1', added('a'));
      expect(feed.replay('g1', feed.epoch, feed.cursor)).toEqual({ ok: true, records: [] });
      expect(feed.replay('never-changed', feed.epoch, 0)).toEqual({ ok: true, records: [] });
    });

    it('refuses a client from another process: its numbers mean nothing here', () => {
      const feed = new ChangeFeedService();
      expect(feed.replay('g1', 'an-old-epoch', 3)).toEqual({ ok: false, reason: 'epoch' });
      expect(feed.replay('g1', undefined, 0)).toEqual({ ok: false, reason: 'epoch' });
    });

    it('refuses a position the feed never reached, or a negative or fractional one', () => {
      const feed = new ChangeFeedService();
      feed.publish('g1', added('a'));
      for (const since of [99, -1, 1.5, Number.NaN]) {
        expect(feed.replay('g1', feed.epoch, since)).toEqual({ ok: false, reason: 'gap' });
      }
    });

    it('says so when the ring has moved past the client', () => {
      const feed = new ChangeFeedService({ bufferSize: 3 });
      feed.publish('g1', added('a')); // 1
      for (const id of ['b', 'c', 'd', 'e']) feed.publish('g1', added(id)); // 2..5
      // The ring now holds 3, 4 and 5: a client at 2 can be caught up, one at 1 cannot.
      const caught = feed.replay('g1', feed.epoch, 2);
      expect(caught.ok && caught.records.map((record) => record.seq)).toEqual([3, 4, 5]);
      expect(feed.replay('g1', feed.epoch, 1)).toEqual({ ok: false, reason: 'gap' });
    });

    it('does not mistake a rebuilt ring for the one the client saw', () => {
      const feed = new ChangeFeedService({ maxGraphs: 2 });
      feed.publish('g1', added('a')); // 1
      const seen = feed.cursor;
      feed.publish('g2', added('b')); // 2
      feed.publish('g3', added('c')); // 3: g1's ring is dropped
      feed.publish('g1', added('d')); // 4: g1 starts a new ring
      expect(feed.replay('g1', feed.epoch, seen)).toEqual({ ok: false, reason: 'gap' });
    });

    it('needs a refetch from a client behind a graph that was forgotten', () => {
      const feed = new ChangeFeedService();
      feed.publish('g1', added('a'));
      const seen = feed.cursor;
      feed.publish('g2', added('b'));
      feed.forget('g2');
      expect(feed.replay('g1', feed.epoch, seen)).toEqual({ ok: false, reason: 'gap' });
      expect(feed.replay('g1', feed.epoch, feed.cursor)).toEqual({ ok: true, records: [] });
    });
  });

  it('bounds how many graphs hold a ring', () => {
    const feed = new ChangeFeedService({ maxGraphs: 3 });
    for (let i = 0; i < 10; i += 1) feed.publish(`g${i}`, added('a'));
    expect(feed.graphCount).toBe(3);
  });
});
