import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { GraphContextStore, assertSafeGraphId } from './GraphContextStore';
import { LocalGraphStore } from './LocalGraphStore';
import { DataCorruptionError, NotFoundError, ValidationError } from './errors';

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
