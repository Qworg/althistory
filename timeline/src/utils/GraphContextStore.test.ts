import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { GraphContextStore, assertSafeGraphId } from './GraphContextStore';
import { LocalGraphStore } from './LocalGraphStore';
import { DataCorruptionError, LocalStorageError, NotFoundError, ValidationError } from './errors';

/**
 * A one-shot latch used to hold an await open at a chosen point, so a test can
 * interleave two operations that a sequential await would serialise away.
 */
interface Gate {
  readonly promise: Promise<void>;
  open(): void;
}

function createGate(): Gate {
  let open = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

describe('GraphContextStore', () => {
  let testDir: string;
  let contextStore: GraphContextStore;
  const originalBackupSetting = process.env.LOCAL_BACKUP_ENABLED;

  beforeEach(async () => {
    // Backups install a per-store interval timer; disable them so the suite is
    // deterministic and leaves no lingering handles.
    process.env.LOCAL_BACKUP_ENABLED = 'false';
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'graph-context-'));
    contextStore = new GraphContextStore({ dataDirectory: testDir });
  });

  afterEach(async () => {
    await contextStore.evictAll();
    await fs.rm(testDir, { recursive: true, force: true });
    if (originalBackupSetting === undefined) {
      delete process.env.LOCAL_BACKUP_ENABLED;
    } else {
      process.env.LOCAL_BACKUP_ENABLED = originalBackupSetting;
    }
  });

  describe('isolation', () => {
    it('backing two graphs with separate files and separate stores', async () => {
      const storeA = await contextStore.getStore('graph-a');
      const storeB = await contextStore.getStore('graph-b');

      expect(storeA).not.toBe(storeB);
      expect(storeA.getDataFilePath()).toBe(path.join(testDir, 'graph-a.json'));
      expect(storeB.getDataFilePath()).toBe(path.join(testDir, 'graph-b.json'));

      await storeA.createNode(['Event'], { id: 'event-a', description: 'Only in A' });
      await storeB.createNode(['Event'], { id: 'event-b', description: 'Only in B' });
      await storeA.save();
      await storeB.save();

      // A re-request returns the cached A, which must not see B's write.
      const storeAAgain = await contextStore.getStore('graph-a');
      expect(storeAAgain).toBe(storeA);
      expect((await storeAAgain.getNode('event-a'))?.properties.description).toBe('Only in A');
      expect(await storeAAgain.getNode('event-b')).toBeNull();

      // B's file is its own: it contains B's node and none of A's data.
      const rawA = await fs.readFile(contextStore.getFilePath('graph-a'), 'utf8');
      const rawB = await fs.readFile(contextStore.getFilePath('graph-b'), 'utf8');
      expect(rawA).toContain('event-a');
      expect(rawA).not.toContain('event-b');
      expect(rawB).toContain('event-b');
      expect(rawB).not.toContain('event-a');

      // A completely fresh context reading the same directory still separates them.
      const freshContext = new GraphContextStore({ dataDirectory: testDir });
      const reloadedA = await freshContext.getStore('graph-a');
      const reloadedB = await freshContext.getStore('graph-b');
      expect(await reloadedA.getNode('event-b')).toBeNull();
      expect(await reloadedB.getNode('event-a')).toBeNull();
      await freshContext.evictAll();
    });
  });

  describe('lazy loading', () => {
    it('does not read the filesystem until a store is requested', async () => {
      const loadSpy = vi.spyOn(LocalGraphStore.prototype, 'load');
      const factory = vi.fn((dataFile: string) => new LocalGraphStore({ dataFile }));
      const lazyDir = path.join(testDir, 'nested', 'graphs-live');
      const lazyContext = new GraphContextStore({ dataDirectory: lazyDir, storeFactory: factory });

      try {
        // Construction is inert: no load, no store, and the directory that would
        // hold the file has not even been created.
        expect(loadSpy).not.toHaveBeenCalled();
        expect(factory).not.toHaveBeenCalled();
        await expect(fs.access(lazyDir)).rejects.toBeDefined();

        await lazyContext.getStore('graph-lazy');
        expect(loadSpy).toHaveBeenCalledTimes(1);
        expect(factory).toHaveBeenCalledTimes(1);
      } finally {
        loadSpy.mockRestore();
        await lazyContext.evictAll();
      }
    });

    it('does not construct a store until a store is requested', async () => {
      const factory = vi.fn((dataFile: string) => new LocalGraphStore({ dataFile }));
      const lazyContext = new GraphContextStore({ dataDirectory: testDir, storeFactory: factory });

      expect(factory).not.toHaveBeenCalled();
      const store = await lazyContext.getStore('graph-lazy');
      expect(factory).toHaveBeenCalledTimes(1);
      expect(store.getDataFilePath()).toBe(path.join(testDir, 'graph-lazy.json'));

      await lazyContext.evictAll();
    });
  });

  describe('caching', () => {
    it('reuses the loaded store instead of re-reading the file', async () => {
      const loadSpy = vi.spyOn(LocalGraphStore.prototype, 'load');
      try {
        const first = await contextStore.getStore('graph-cache');
        const second = await contextStore.getStore('graph-cache');

        expect(second).toBe(first);
        expect(loadSpy).toHaveBeenCalledTimes(1);
      } finally {
        loadSpy.mockRestore();
      }
    });
  });

  describe('eviction', () => {
    it('reloads from disk after evict', async () => {
      const first = await contextStore.getStore('graph-evict');
      await first.createNode(['Event'], { id: 'persisted-event' });

      await contextStore.evict('graph-evict');
      expect(contextStore.has('graph-evict')).toBe(false);

      const second = await contextStore.getStore('graph-evict');
      expect(second).not.toBe(first);
      // `evict` shuts the store down, which saves it, so the node survives.
      expect((await second.getNode('persisted-event'))?.properties.id).toBe('persisted-event');
    });

    it('bounds the cache with least-recently-used eviction', async () => {
      const bounded = new GraphContextStore({ dataDirectory: testDir, maxCachedGraphs: 2 });

      await bounded.getStore('graph-1');
      await bounded.getStore('graph-2');
      await bounded.getStore('graph-3');

      expect(bounded.size).toBe(2);
      expect(bounded.has('graph-1')).toBe(false);
      expect(bounded.has('graph-2')).toBe(true);
      expect(bounded.has('graph-3')).toBe(true);

      await bounded.evictAll();
    });

    it('never hands out a second live store for a graph a caller still references', async () => {
      const bounded = new GraphContextStore({ dataDirectory: testDir, maxCachedGraphs: 2 });

      const first = await bounded.getStore('graph-a');
      await bounded.getStore('graph-b');
      // graph-a is now the least-recently-used entry, so loading graph-c pushes
      // the cache over its bound and selects graph-a for eviction.
      await bounded.getStore('graph-c');
      expect(bounded.has('graph-a')).toBe(false);

      const again = await bounded.getStore('graph-a');

      // The caller above still holds `first`. If eviction replaced it with a
      // freshly constructed store, both references would be live writers on
      // graph-a.json and whichever saved last would silently erase the other's
      // node. One graph id must map to at most one live LocalGraphStore.
      expect(again).toBe(first);

      await first.createNode(['Event'], { id: 'from-first' });
      await again.createNode(['Event'], { id: 'from-second' });
      await again.save();

      const raw = await fs.readFile(bounded.getFilePath('graph-a'), 'utf8');
      expect(raw).toContain('from-first');
      expect(raw).toContain('from-second');

      await bounded.evictAll();
    });

    it('flushes a write made after eviction when the cache is drained', async () => {
      const bounded = new GraphContextStore({ dataDirectory: testDir, maxCachedGraphs: 1 });

      const first = await bounded.getStore('graph-drain');
      await bounded.getStore('graph-other');
      expect(bounded.has('graph-drain')).toBe(false);

      // The handler still holds `first` and writes through it AFTER eviction.
      // Eviction saved the store as it retired it, so only the drain can persist
      // this write; dropping the retired instance here would lose it silently.
      await first.createNode(['Event'], { id: 'written-after-evict' });

      await bounded.evictAll();

      const raw = await fs.readFile(bounded.getFilePath('graph-drain'), 'utf8');
      expect(raw).toContain('written-after-evict');
    });

    it('flushes a write made to a retired store when it is revived and drained', async () => {
      const bounded = new GraphContextStore({ dataDirectory: testDir, maxCachedGraphs: 1 });

      const first = await bounded.getStore('graph-revive');
      await bounded.getStore('graph-other');
      await first.createNode(['Event'], { id: 'written-after-evict' });

      // A later request revives the instance the caller still holds rather than
      // constructing a second writer on the same file.
      const revived = await bounded.getStore('graph-revive');
      expect(revived).toBe(first);
      await revived.createNode(['Event'], { id: 'written-after-revival' });

      await bounded.evictAll();

      const raw = await fs.readFile(bounded.getFilePath('graph-revive'), 'utf8');
      expect(raw).toContain('written-after-evict');
      expect(raw).toContain('written-after-revival');
    });
  });

  describe('concurrent loads', () => {
    it('keeps an in-flight load resident when a sibling load pushes the cache over its bound', async () => {
      const gate = createGate();
      const slowPath = path.join(testDir, 'graph-slow.json');
      const realLoad = LocalGraphStore.prototype.load;
      const loadSpy = vi.spyOn(LocalGraphStore.prototype, 'load').mockImplementation(async function (
        this: LocalGraphStore
      ) {
        if (this.getDataFilePath() === slowPath) {
          await gate.promise;
          return;
        }
        await realLoad.call(this);
      });

      try {
        const bounded = new GraphContextStore({ dataDirectory: testDir, maxCachedGraphs: 2 });

        // Deliberately not awaited: this load is still in flight while the two
        // sibling loads below run their eviction passes.
        const slowPending = bounded.getStore('graph-slow');
        await bounded.getStore('graph-a');
        await bounded.getStore('graph-b');

        // The siblings are settled and unused, so they are the eviction
        // candidates; the unsettled entry must be skipped rather than saved and
        // shut down while the caller that asked for it is still waiting.
        expect(bounded.has('graph-slow')).toBe(true);

        gate.open();
        const slow = await slowPending;
        expect(slow.getDataFilePath()).toBe(slowPath);
        expect(bounded.has('graph-slow')).toBe(true);

        await bounded.evictAll();
      } finally {
        loadSpy.mockRestore();
      }
    });

    it('never evicts a store whose own getStore call has not returned yet', async () => {
      const gatedPath = path.join(testDir, 'graph-gated.json');
      const gate = createGate();
      const shutdownEntered = createGate();
      const realShutdown = LocalGraphStore.prototype.shutdown;
      const shutdownSpy = vi
        .spyOn(LocalGraphStore.prototype, 'shutdown')
        .mockImplementation(async function (this: LocalGraphStore) {
          if (this.getDataFilePath() === gatedPath) {
            shutdownEntered.open();
            await gate.promise;
          }
          await realShutdown.call(this);
        });

      try {
        const bounded = new GraphContextStore({ dataDirectory: testDir, maxCachedGraphs: 1 });
        await bounded.getStore('graph-gated');

        // Evicting graph-gated starts a shutdown that is held open, which leaves
        // graph-second's own `getStore` settled but unfinished: its entry is in
        // the cache, and the call that will return it has not returned yet.
        const secondPending = bounded.getStore('graph-second');
        await shutdownEntered.promise;

        const third = await bounded.getStore('graph-third');
        expect(third).toBeDefined();

        // An eviction pass that only skipped unsettled entries would pick
        // graph-second here — saving and shutting down the store it is in the
        // middle of handing back. The `refs` check is what keeps it resident.
        expect(bounded.has('graph-second')).toBe(true);

        gate.open();
        const second = await secondPending;
        expect(second.getDataFilePath()).toBe(path.join(testDir, 'graph-second.json'));

        await bounded.evictAll();
      } finally {
        shutdownSpy.mockRestore();
      }
    });

    it('serves a burst of concurrent loads as one store per graph and keeps both writers', async () => {
      const bounded = new GraphContextStore({ dataDirectory: testDir, maxCachedGraphs: 2 });
      const ids = Array.from({ length: 10 }, (_unused, index) => `graph-burst-${index}`);

      // Ten overlapping loads of DISTINCT ids against a cache bound of two: the
      // in-flight and just-returned entries are evicted and retired while the
      // others are still starting up.
      const stores = await Promise.all(ids.map((id) => bounded.getStore(id)));
      expect(new Set(stores).size).toBe(ids.length);

      // The burst really did push the cache past its bound: most of the ten
      // entries were evicted (and therefore retired) while it ran, so the revival
      // path below is exercised rather than the whole burst fitting in cache.
      expect(bounded.size).toBeLessThan(ids.length);

      // Every id was pushed out of the LRU and then requested again while the
      // first reference is still held. A second instance here would be a second
      // writer on the same file, and the last save would erase the other's data.
      const again = await Promise.all(ids.map((id) => bounded.getStore(id)));
      for (const [index, store] of again.entries()) {
        expect(store).toBe(stores[index]);
      }

      await stores[0].createNode(['Event'], { id: 'from-first-reference' });
      await again[0].createNode(['Event'], { id: 'from-second-reference' });

      // The drain is the shutdown path; both writes must reach the file even
      // though the instance was evicted and retired several times above.
      await bounded.evictAll();

      const raw = await fs.readFile(bounded.getFilePath(ids[0]), 'utf8');
      expect(raw).toContain('from-first-reference');
      expect(raw).toContain('from-second-reference');
    });
  });

  describe('leases', () => {
    it('keeps a leased store resident while sibling loads exceed the cache bound', async () => {
      const bounded = new GraphContextStore({ dataDirectory: testDir, maxCachedGraphs: 1 });
      const leased = await bounded.lease('graph-leased');

      try {
        // The lease is the caller's claim that it may still write, so eviction
        // must skip this entry and let the cache exceed its bound instead.
        await bounded.getStore('graph-sibling-a');
        await bounded.getStore('graph-sibling-b');
        expect(bounded.has('graph-leased')).toBe(true);

        await leased.store.createNode(['Event'], { id: 'written-under-lease' });
      } finally {
        await leased.release();
      }

      await bounded.evictAll();
      const raw = await fs.readFile(bounded.getFilePath('graph-leased'), 'utf8');
      expect(raw).toContain('written-under-lease');
    });

    it('refuses to force an eviction while a lease is held, and allows it after release', async () => {
      const bounded = new GraphContextStore({ dataDirectory: testDir, maxCachedGraphs: 1 });
      const leased = await bounded.lease('graph-held');

      await expect(bounded.evict('graph-held')).rejects.toThrow(LocalStorageError);
      expect(bounded.has('graph-held')).toBe(true);

      await leased.release();
      await bounded.evict('graph-held');
      expect(bounded.has('graph-held')).toBe(false);
    });

    it('releases the lease and persists the work when the callback throws', async () => {
      const bounded = new GraphContextStore({ dataDirectory: testDir, maxCachedGraphs: 1 });

      await expect(
        bounded.withStore('graph-throwing', async (store) => {
          await store.createNode(['Event'], { id: 'written-before-throw' });
          throw new Error('handler failed');
        })
      ).rejects.toThrow('handler failed');

      // The release in `withStore`'s finally dropped the pin, so the entry can be
      // evicted again; the write it guarded must still be on disk afterwards.
      await bounded.getStore('graph-neighbour');
      await bounded.evictAll();

      const raw = await fs.readFile(bounded.getFilePath('graph-throwing'), 'utf8');
      expect(raw).toContain('written-before-throw');
    });

    it('releases a lease only once even if release is called twice', async () => {
      const bounded = new GraphContextStore({ dataDirectory: testDir, maxCachedGraphs: 1 });
      const leased = await bounded.lease('graph-once');

      await leased.release();
      await leased.release();

      // A double release must not push the counter negative and make the store
      // look unused to a later eviction while another lease still holds it.
      const second = await bounded.lease('graph-once');
      expect(second.store).toBe(leased.store);
      await second.release();

      await bounded.evictAll();
    });
  });

  describe('backup timer lifecycle', () => {
    it('reinstates the backup timer when a store is revived while its shutdown is in flight', async () => {
      const timerPath = path.join(testDir, 'graph-timer.json');
      const events: string[] = [];
      const shutdownEntered = createGate();
      const shutdownMayFinish = createGate();
      const realShutdown = LocalGraphStore.prototype.shutdown;
      const realResume = LocalGraphStore.prototype.resumeBackupTimer;

      const shutdownSpy = vi
        .spyOn(LocalGraphStore.prototype, 'shutdown')
        .mockImplementation(async function (this: LocalGraphStore) {
          const isGated = this.getDataFilePath() === timerPath;
          events.push('shutdown:start');
          if (isGated) {
            shutdownEntered.open();
            await shutdownMayFinish.promise;
          }
          await realShutdown.call(this);
          events.push('shutdown:end');
        });
      const resumeSpy = vi
        .spyOn(LocalGraphStore.prototype, 'resumeBackupTimer')
        .mockImplementation(function (this: LocalGraphStore) {
          events.push('resume');
          realResume.call(this);
        });

      try {
        const bounded = new GraphContextStore({ dataDirectory: testDir, maxCachedGraphs: 2 });

        const first = await bounded.getStore('graph-timer');
        await bounded.getStore('graph-filler');

        // Loading a third graph selects graph-timer for eviction; its shutdown is
        // held open so the test can revive it mid-flight.
        const evictionTrigger = bounded.getStore('graph-sibling');
        await shutdownEntered.promise;

        const revived = await bounded.getStore('graph-timer');
        expect(revived).toBe(first);

        shutdownMayFinish.open();
        await evictionTrigger;

        // The shutdown that had already started cleared the timer of a store that
        // is resident again. The re-arm must therefore be the LAST lifecycle
        // event: a resident store without a backup timer silently stops backing
        // itself up.
        expect(events[events.length - 1]).toBe('resume');

        await bounded.evictAll();
      } finally {
        shutdownSpy.mockRestore();
        resumeSpy.mockRestore();
      }
    });
  });

  describe('path safety', () => {
    it.each([
      '../../etc/passwd',
      '..',
      '.',
      '',
      'a/b',
      'a\\b',
      'graph id',
      'graph\u0000',
      '-leading-dash',
      'a'.repeat(200)
    ])('rejects unsafe graph id %j', (graphId) => {
      expect(() => contextStore.getFilePath(graphId)).toThrow(ValidationError);
      expect(() => assertSafeGraphId(graphId)).toThrow(ValidationError);
    });

    it('rejects an unsafe graph id before touching the filesystem', async () => {
      await expect(contextStore.getStore('../escape')).rejects.toThrow(ValidationError);
      expect(contextStore.size).toBe(0);
    });
  });

  describe('failure safety', () => {
    it('raises a clear error for a corrupt per-graph file', async () => {
      const corruptPath = contextStore.getFilePath('graph-corrupt');
      await fs.writeFile(corruptPath, 'this is not json');

      await expect(contextStore.getStore('graph-corrupt')).rejects.toThrow(DataCorruptionError);
      // A failed load must not be cached as a phantom empty store.
      expect(contextStore.has('graph-corrupt')).toBe(false);
    });

    it('raises a clear error when a required graph file is missing', async () => {
      await expect(contextStore.getExistingStore('graph-missing')).rejects.toThrow(NotFoundError);
    });

    it('treats a missing file as a new empty graph by default', async () => {
      const store = await contextStore.getStore('graph-new');
      expect(store.getStats().nodeCount).toBe(0);
      expect(store.getStats().relationshipCount).toBe(0);
    });
  });
});
