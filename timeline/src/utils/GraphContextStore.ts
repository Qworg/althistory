import * as fs from 'fs/promises';
import * as path from 'path';
import { LocalGraphStore } from './LocalGraphStore';
import { loadConfig } from './config';
import { DataCorruptionError, LocalStorageError, NotFoundError, ValidationError } from './errors';

/**
 * `WeakRef` is part of the Node runtime (Node 14+) and the ECMAScript 2021
 * standard, but this package compiles against `lib: ES2020`, which predates it.
 * Declare the minimal surface the cache needs locally instead of widening the
 * project's build config (out of scope) or reaching for a cast.
 */
interface WeakRefLike<T extends object> {
  deref(): T | undefined;
}
interface WeakRefConstructor {
  new <T extends object>(target: T): WeakRefLike<T>;
}
declare const WeakRef: WeakRefConstructor;

/**
 * One slot in the resident cache. The promise is stored (not just its value) so
 * two concurrent requests for the same graph share a single load instead of
 * racing to read the file twice.
 */
interface CacheEntry {
  readonly promise: Promise<LocalGraphStore>;
  /** True once `promise` has resolved; an unsettled entry is never evicted. */
  settled: boolean;
  /** Number of `getStore` calls currently resolving or returning this entry. */
  refs: number;
  /** The resolved store, available once `settled` is true. */
  store?: LocalGraphStore;
}

/**
 * Directory name under the configured data directory that holds the per-graph
 * live stores, adjacent to the existing `graphs/` version-store tree.
 */
export const GRAPHS_LIVE_DIRECTORY = 'graphs-live';

/**
 * A graph id is used verbatim as a file name, so it must not be able to escape
 * the live-store directory. The rule is deliberately narrow: an alphanumeric
 * first character (which rules out `.`, `..` and hidden names) followed by
 * alphanumerics, dot, underscore or hyphen, up to 128 characters. That excludes
 * path separators, NUL bytes, whitespace and every other traversal primitive.
 */
const SAFE_GRAPH_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const DEFAULT_MAX_CACHED_GRAPHS = 32;

export interface GraphContextStoreOptions {
  /**
   * Root directory for per-graph live stores. Defaults to
   * `<config.localExecution.dataDirectory>/graphs-live`.
   */
  dataDirectory?: string;

  /**
   * Maximum number of graphs whose stores stay resident. Least-recently-used
   * stores are evicted (after a save) once the bound is exceeded. Defaults to
   * 32.
   */
  maxCachedGraphs?: number;

  /**
   * Factory used to construct a store for a resolved file path. Injectable so
   * tests can observe construction; defaults to a real `LocalGraphStore` bound
   * to `dataFile`.
   */
  storeFactory?: (dataFile: string) => LocalGraphStore;
}

export interface GetGraphStoreOptions {
  /**
   * When `true`, a graph whose file does not exist is an error instead of a new
   * empty store. Callers that know the graph must already exist should set this
   * so a missing file cannot masquerade as "this graph has no data".
   */
  requireExisting?: boolean;
}

/**
 * Owns the lifecycle of one live `LocalGraphStore` per graph.
 *
 * Stores are created and loaded lazily on first request, cached for reuse, and
 * kept in a bounded least-recently-used cache so a long-running process does not
 * accumulate an unbounded number of open stores. This class does not touch the
 * global container or any route: it is the foundation that graph-scoped
 * repositories will be built on.
 */
export class GraphContextStore {
  private readonly baseDirectory: string;
  private readonly maxCachedGraphs: number;
  private readonly storeFactory: (dataFile: string) => LocalGraphStore;

  /**
   * Resident cache, keyed by graph id. Map iteration order is the LRU order:
   * the oldest entry is first, and a hit is moved to the end. Entries may be
   * in flight (`settled === false`) or being actively returned (`refs > 0`).
   */
  private readonly stores = new Map<string, CacheEntry>();

  /**
   * Stores evicted from the resident cache that a caller may still reference.
   *
   * Eviction must save a store and stop its backup timer so the object can be
   * reclaimed, but it must never leave an id able to produce a SECOND live
   * `LocalGraphStore` while the first is still reachable: two instances on one
   * file are two writers, and the last save wins. The weak reference lets a
   * later request hand back the very same instance while it is still reachable,
   * and only construct a fresh one once it has been collected (at which point
   * no caller can still be holding it).
   */
  private readonly retired = new Map<string, WeakRefLike<LocalGraphStore>>();

  constructor(options: GraphContextStoreOptions = {}) {
    this.baseDirectory = options.dataDirectory
      ?? path.join(loadConfig().localExecution.dataDirectory, GRAPHS_LIVE_DIRECTORY);
    this.maxCachedGraphs = options.maxCachedGraphs ?? DEFAULT_MAX_CACHED_GRAPHS;
    if (!Number.isInteger(this.maxCachedGraphs) || this.maxCachedGraphs < 1) {
      throw new ValidationError(
        'maxCachedGraphs must be a positive integer',
        'maxCachedGraphs',
        this.maxCachedGraphs
      );
    }
    this.storeFactory = options.storeFactory ?? ((dataFile) => new LocalGraphStore({ dataFile }));
  }

  /**
   * Resolve the store for a graph, creating and loading it on first use and
   * reusing the cached instance afterwards.
   *
   * A missing file is treated as a new graph only when `requireExisting` is not
   * set; a corrupt or unreadable file always raises a clear error rather than
   * yielding a silently empty store.
   */
  async getStore(graphId: string, options: GetGraphStoreOptions = {}): Promise<LocalGraphStore> {
    const filePath = this.getFilePath(graphId);
    const entry = this.resolveEntry(graphId, filePath, options.requireExisting === true);

    // Hold the entry for the whole resolution, including the eviction pass
    // below. `evictOverflow` only considers entries with `refs === 0`, so this
    // call can never evict the store it is about to hand back, and no concurrent
    // `evictOverflow` can evict it while this caller is still resolving it.
    entry.refs += 1;
    try {
      const store = await entry.promise;
      entry.settled = true;
      entry.store = store;
      await this.evictOverflow();
      return store;
    } catch (error) {
      if (this.stores.get(graphId) === entry) {
        this.stores.delete(graphId);
      }
      throw error;
    } finally {
      entry.refs -= 1;
    }
  }

  /**
   * Load a graph that is expected to already exist. Equivalent to
   * `getStore(graphId, { requireExisting: true })`.
   */
  async getExistingStore(graphId: string): Promise<LocalGraphStore> {
    return this.getStore(graphId, { requireExisting: true });
  }

  /**
   * Drop and shut down one graph's cached store. Shutting down saves pending
   * changes and clears the store's backup timer; a subsequent request reloads
   * the graph from disk.
   */
  async evict(graphId: string): Promise<void> {
    assertSafeGraphId(graphId);
    const entry = this.stores.get(graphId);
    this.stores.delete(graphId);
    // Explicit eviction is the caller asserting the store is no longer needed,
    // so it also drops any weak reference: the next request must reload from
    // disk rather than revive the shut-down instance.
    this.retired.delete(graphId);
    if (entry) {
      await this.shutdownQuietly(entry.promise, graphId);
    }
  }

  /**
   * Drop and shut down every cached store. Intended for process shutdown and
   * tests.
   */
  async evictAll(): Promise<void> {
    const entries = Array.from(this.stores.entries());
    this.stores.clear();
    this.retired.clear();
    await Promise.all(
      entries.map(([graphId, entry]) => this.shutdownQuietly(entry.promise, graphId))
    );
  }

  /** Whether a graph is currently resident in the cache. */
  has(graphId: string): boolean {
    assertSafeGraphId(graphId);
    return this.stores.has(graphId);
  }

  /** Number of graphs currently resident in the cache. */
  get size(): number {
    return this.stores.size;
  }

  /**
   * Resolve and validate the file a graph id maps to. Throws a
   * `ValidationError` for any id that is not safe to use as a file name; the
   * containment check is redundant with the pattern but guards against a future
   * loosening of it.
   */
  getFilePath(graphId: string): string {
    assertSafeGraphId(graphId);
    const base = path.resolve(this.baseDirectory);
    const resolved = path.resolve(base, `${graphId}.json`);
    if (path.dirname(resolved) !== base) {
      throw new ValidationError(
        `Graph id '${graphId}' resolves outside the live-store directory`,
        'graphId',
        graphId
      );
    }
    return resolved;
  }

  private async loadStore(
    graphId: string,
    filePath: string,
    requireExisting: boolean
  ): Promise<LocalGraphStore> {
    await this.inspectPersistedFile(graphId, filePath, requireExisting);
    const store = this.storeFactory(filePath);
    // `LocalGraphStore.load()` treats a missing file as first run and tolerates
    // corrupt JSON. The inspection above already rejected corruption, so this
    // call cannot turn a failure into an empty-looking store.
    await store.load();
    return store;
  }

  /**
   * Read and parse the persisted file before the store loads it, so a corrupt
   * file raises `DataCorruptionError` rather than being swallowed by
   * `LocalGraphStore.load()` (whose graceful-degradation behaviour must stay
   * intact for the legacy single store).
   */
  private async inspectPersistedFile(
    graphId: string,
    filePath: string,
    requireExisting: boolean
  ): Promise<void> {
    let raw: string;
    try {
      raw = await fs.readFile(filePath, 'utf8');
    } catch (error) {
      if (isFileNotFoundError(error)) {
        if (requireExisting) {
          throw new NotFoundError(
            `Live store for graph '${graphId}' does not exist at ${filePath}`,
            'graph',
            graphId
          );
        }
        return;
      }
      throw new LocalStorageError(
        `Failed to read live store for graph '${graphId}' at ${filePath}`,
        'read',
        filePath,
        toError(error)
      );
    }

    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('expected a JSON object');
      }
    } catch (error) {
      throw new DataCorruptionError(
        `Live store for graph '${graphId}' at ${filePath} is not valid JSON`,
        filePath,
        'invalid-json',
        undefined,
        undefined,
        toError(error)
      );
    }
  }

  /**
   * Return the resident entry for a graph, creating (or reviving) one on miss.
   *
   * A never-resolved entry is never evicted (`findEvictionVictim` requires
   * `settled`), so a concurrent miss cannot construct a second store while the
   * first is still loading.
   */
  private resolveEntry(graphId: string, filePath: string, requireExisting: boolean): CacheEntry {
    const cached = this.stores.get(graphId);
    if (cached) {
      this.touch(graphId, cached);
      return cached;
    }

    const retiredRef = this.retired.get(graphId);
    const revived = retiredRef?.deref();
    if (revived) {
      this.retired.delete(graphId);
      // The instance was saved and its timer stopped when it was evicted, but it
      // is still the one live store for this graph (a caller holds it), so hand
      // it back rather than construct a second writer on the same file.
      revived.resumeBackupTimer();
      const entry: CacheEntry = {
        promise: Promise.resolve(revived),
        settled: true,
        refs: 0,
        store: revived,
      };
      this.stores.set(graphId, entry);
      return entry;
    }
    if (retiredRef) {
      // The weakly-referenced instance has been collected; prune the stale slot.
      this.retired.delete(graphId);
    }

    const promise = this.loadStore(graphId, filePath, requireExisting);
    const entry: CacheEntry = { promise, settled: false, refs: 0 };
    this.stores.set(graphId, entry);

    // A failed load must not poison the cache: drop the rejected promise so the
    // next request retries instead of replaying the same failure forever.
    promise.catch(() => {
      if (this.stores.get(graphId) === entry) {
        this.stores.delete(graphId);
      }
    });

    return entry;
  }

  private touch(graphId: string, entry: CacheEntry): void {
    this.stores.delete(graphId);
    this.stores.set(graphId, entry);
  }

  /**
   * Evict least-recently-used entries until the cache is within its bound.
   *
   * Only settled entries with no in-flight `getStore` call are candidates. An
   * entry whose load has not settled or that a caller is currently resolving is
   * skipped, so this can briefly leave the cache over its bound rather than
   * hand out (or shut down underneath) a store that is still in use. Correctness
   * wins over the memory target when the two conflict.
   */
  private async evictOverflow(): Promise<void> {
    while (this.stores.size > this.maxCachedGraphs) {
      const victim = this.findEvictionVictim();
      if (!victim) {
        break;
      }
      this.stores.delete(victim.graphId);
      const store = victim.entry.store;
      if (store) {
        // Record the weak reference BEFORE awaiting the shutdown below, so a
        // `getStore` interleaving with that save revives this instance instead
        // of constructing a second one.
        this.retired.set(victim.graphId, new WeakRef(store));
      }
      await this.shutdownQuietly(victim.entry.promise, victim.graphId);
    }
    this.pruneRetired();
  }

  /**
   * The oldest entry that may be evicted: settled and not being resolved by any
   * `getStore` call. Returns `undefined` when every entry is in use, which lets
   * the cache exceed its bound temporarily rather than break the one-live-store
   * invariant.
   */
  private findEvictionVictim(): { graphId: string; entry: CacheEntry } | undefined {
    for (const [graphId, entry] of this.stores) {
      if (entry.settled && entry.refs === 0) {
        return { graphId, entry };
      }
    }
    return undefined;
  }

  /** Forget weak references whose store has been collected. */
  private pruneRetired(): void {
    for (const [graphId, ref] of this.retired) {
      if (ref.deref() === undefined) {
        this.retired.delete(graphId);
      }
    }
  }

  private async shutdownQuietly(pending: Promise<LocalGraphStore>, graphId: string): Promise<void> {
    try {
      const store = await pending;
      await store.shutdown();
    } catch (error) {
      // Eviction must not fail the request that triggered it; a store that
      // never loaded has nothing to save.
      console.error(`Failed to shut down live store for graph '${graphId}':`, error);
    }
  }
}

/**
 * Validate a graph id before it is used as a file name. Throws a
 * `ValidationError` when the id is empty, too long, or contains anything other
 * than the safe character set.
 */
export function assertSafeGraphId(graphId: string): void {
  if (typeof graphId !== 'string' || !SAFE_GRAPH_ID_PATTERN.test(graphId)) {
    throw new ValidationError(
      `Unsafe graph id: ${JSON.stringify(graphId)}. Graph ids must start with a letter or digit and contain only letters, digits, dot, underscore or hyphen (max 128 characters).`,
      'graphId',
      graphId
    );
  }
}

function isFileNotFoundError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
