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
  /** Number of `getStore`/`lease` calls currently resolving this entry. */
  refs: number;
  /**
   * Number of leases handed out and not yet released. A lease is the caller's
   * declaration that it is still using (and may still write to) the store, so
   * an entry with `leases > 0` is never evicted or handed a second instance.
   */
  leases: number;
  /** The resolved store, available once `settled` is true. */
  store?: LocalGraphStore;
}

/**
 * A store removed from the resident cache whose shutdown is still in flight.
 *
 * The object identity (not the weak reference it carries) is what tells
 * "this graph is still retired" from "this graph was revived while the
 * shutdown was pending": revival deletes the slot, so the pending shutdown can
 * see that it no longer owns the store and leave it alone.
 */
interface RetiredEntry {
  readonly ref: WeakRefLike<LocalGraphStore>;
}

/**
 * A store pinned for the duration of a caller's usage.
 *
 * `release` must be called when the caller is done with the store; until then
 * the entry cannot be evicted, so the instance's pending writes cannot be
 * dropped by this class. Releasing is idempotent.
 */
export interface GraphStoreLease {
  readonly store: LocalGraphStore;
  release(): Promise<void>;
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
 *
 * ## The invariant, and the window this class cannot close by itself
 *
 * Two things hold on every path this class controls:
 *
 * 1. **One live store per graph id.** Eviction saves a store before retiring it
 *    and records a weak reference, so a later request for the same graph revives
 *    the very same instance while it is still reachable instead of constructing a
 *    second writer on the same file.
 * 2. **No unsaved state is dropped by this class.** `evictOverflow` flushes a
 *    store as it retires it, and `evictAll()` — the process-shutdown path —
 *    drains BOTH the resident cache and the retired registry, saving every
 *    instance that is still reachable. A store that is reachable at shutdown is
 *    therefore always flushed; a store that is not reachable has no callers left
 *    to write to it.
 *
 * Repositories never call `save()` (only `CausalService`, `BackupRecoveryService`
 * and a store's own shutdown do), so a store's writes live in memory until one of
 * those flushes runs. `getStore()` borrows an instance and returns: the reference
 * it hands back is NOT counted, because the class cannot observe when the caller
 * stops using it. Such an instance may therefore be flushed, retired and shut
 * down before the caller writes through it. `lease()`/`withStore()` extend the
 * reference over the caller's usage and are the contract for any caller that
 * writes; while a lease is outstanding the entry cannot be evicted at all.
 *
 * Residual window, stated rather than implied: a write made through a borrowed
 * (`getStore`) reference *after* that instance was retired, and then dropped
 * without any later `getStore`/`lease`/`evictAll()` for the same graph, is lost —
 * the instance becomes unreachable, so the shutdown drain cannot deref it and
 * nothing else flushes it. Writes made after `evictAll()` or `evict()` have run
 * are outside the class entirely. Closing that window needs write-through saving
 * in the repository layer or the same lease discipline at every call site; the
 * earlier claim that "at most one live store" closes the data-loss race was
 * wrong to imply otherwise.
 */
export class GraphContextStore {
  private readonly baseDirectory: string;
  private readonly maxCachedGraphs: number;
  private readonly storeFactory: (dataFile: string) => LocalGraphStore;

  /**
   * Resident cache, keyed by graph id. Map iteration order is the LRU order:
   * the oldest entry is first, and a hit is moved to the end. Entries may be
   * in flight (`settled === false`), being resolved (`refs > 0`) or leased
   * (`leases > 0`); only a settled entry with both counters at zero may be
   * evicted.
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
   * no caller can still be holding it). `evictAll()` drains this registry — it is
   * the last chance to save those instances — and then clears it, so a request
   * after a shutdown starts from disk again.
   *
   * Retirement is subject to the same honesty as the rest of the class: a
   * retired instance a caller still holds is still writable, and its later
   * writes are only durable if the instance is revived (a later `getStore`) or
   * is still reachable when `evictAll()` drains this registry.
   */
  private readonly retired = new Map<string, RetiredEntry>();

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
   *
   * This is a BORROWED reference: it is protected only for the duration of the
   * call. A caller that keeps the instance and writes through it later must use
   * `lease()`/`withStore()` instead, or the instance may be flushed, retired and
   * shut down before that write happens.
   */
  async getStore(graphId: string, options: GetGraphStoreOptions = {}): Promise<LocalGraphStore> {
    const pinned = await this.pinEntry(graphId, options.requireExisting === true, false);
    return pinned.store;
  }

  /**
   * Load a graph that is expected to already exist. Equivalent to
   * `getStore(graphId, { requireExisting: true })`.
   */
  async getExistingStore(graphId: string): Promise<LocalGraphStore> {
    return this.getStore(graphId, { requireExisting: true });
  }

  /**
   * Pin a graph's store for the duration of the caller's usage and return it
   * with the function that releases it.
   *
   * This is the acquisition to use for any caller that may write: while the
   * lease is outstanding the entry can neither be evicted nor handed to a second
   * caller, so the instance the caller holds keeps its data until `release()`
   * runs. Because repositories write in memory (they never call `save()`), that
   * pin is what keeps those writes from being dropped by an eviction.
   *
   * `release()` is idempotent and safe to call from a `finally`. It returns once
   * the eviction pass that follows the release has finished, so a store that is
   * no longer needed is flushed (saved and retired) before the returned promise
   * resolves rather than at an arbitrary later point.
   */
  async lease(
    graphId: string,
    options: GetGraphStoreOptions = {}
  ): Promise<GraphStoreLease> {
    const pinned = await this.pinEntry(graphId, options.requireExisting === true, true);
    let released = false;
    return {
      store: pinned.store,
      release: async (): Promise<void> => {
        if (released) {
          return;
        }
        released = true;
        await this.releaseLease(pinned.entry);
      },
    };
  }

  /**
   * Run `use` with a leased store and release the lease exactly once, however
   * `use` settles. Sugar over `lease()` for the common "do some work, then stop"
   * shape; long-lived holders (the container's wrapper cache) should keep the
   * lease object itself so the pin spans the whole lifetime of what they hand
   * out.
   */
  async withStore<T>(
    graphId: string,
    use: (store: LocalGraphStore) => Promise<T> | T,
    options: GetGraphStoreOptions = {}
  ): Promise<T> {
    const leased = await this.lease(graphId, options);
    try {
      return await use(leased.store);
    } finally {
      await leased.release();
    }
  }

  /**
   * Drop and shut down one graph's cached store. Shutting down saves pending
   * changes and clears the store's backup timer; a subsequent request reloads
   * the graph from disk.
   *
   * This is the force/destroy path: it invalidates the retired weak reference,
   * so a caller still holding the old instance gets a stale writer while the
   * next request reads a fresh one from disk. It therefore refuses to run while
   * a lease is outstanding — release the lease, then evict.
   */
  async evict(graphId: string): Promise<void> {
    assertSafeGraphId(graphId);
    const entry = this.stores.get(graphId);
    if (entry && entry.leases > 0) {
      throw new LocalStorageError(
        `Refusing to evict the live store for graph '${graphId}': ${entry.leases} lease(s) are still held`,
        'evict',
        this.getFilePath(graphId)
      );
    }
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
   * Drop and shut down every store this registry knows about, resident or
   * retired. Intended for process shutdown and tests.
   *
   * This is the last chance to persist in-memory writes, so it flushes the
   * retired registry as well as the resident cache: retired instances are still
   * writable while a caller holds them, and dropping them here would discard
   * exactly the writes this class promises not to lose. Both registries are
   * cleared first so a store that is revived concurrently cannot be shut down
   * twice, and outstanding leases do not block the drain — shutdown overrides
   * them and leaves them to be released harmlessly afterwards.
   */
  async evictAll(): Promise<void> {
    const entries = Array.from(this.stores.entries());
    const retiredEntries = Array.from(this.retired.entries());
    this.stores.clear();
    this.retired.clear();
    await Promise.all([
      ...entries.map(([graphId, entry]) => this.shutdownQuietly(entry.promise, graphId)),
      ...retiredEntries.map(([graphId, retired]) =>
        this.shutdownRetiredInstance(graphId, retired)
      ),
    ]);
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
   * Resolve the entry for a graph and hold it across its load and the eviction
   * pass, optionally as a lease that the caller releases itself.
   *
   * `entry.refs` (and `entry.leases` for a lease) are incremented before the
   * first await, so no `evictOverflow` — including a concurrent one — can select
   * this entry while it is being resolved or returned.
   */
  private async pinEntry(
    graphId: string,
    requireExisting: boolean,
    asLease: boolean
  ): Promise<{ entry: CacheEntry; store: LocalGraphStore }> {
    const filePath = this.getFilePath(graphId);
    const entry = this.resolveEntry(graphId, filePath, requireExisting);
    entry.refs += 1;
    if (asLease) {
      entry.leases += 1;
    }
    try {
      const store = await entry.promise;
      entry.settled = true;
      entry.store = store;
      await this.evictOverflow();
      return { entry, store };
    } catch (error) {
      if (asLease) {
        entry.leases -= 1;
      }
      if (this.stores.get(graphId) === entry) {
        this.stores.delete(graphId);
      }
      throw error;
    } finally {
      entry.refs -= 1;
    }
  }

  /**
   * Drop one lease and enforce the cache bound again. The store may now be
   * evicted, which flushes it (save + shutdown) as part of retiring it.
   */
  private async releaseLease(entry: CacheEntry): Promise<void> {
    entry.leases -= 1;
    await this.evictOverflow();
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

    const retiredEntry = this.retired.get(graphId);
    const revived = retiredEntry?.ref.deref();
    if (revived) {
      this.retired.delete(graphId);
      // The instance was saved and its timer stopped when it was evicted (or its
      // shutdown is still in flight and will notice this revival and stop), but
      // it is still the one live store for this graph (a caller holds it), so
      // hand it back rather than construct a second writer on the same file.
      // `resumeBackupTimer` is idempotent, so calling it here — and again from
      // the pending shutdown's revival check — always leaves a resident store
      // with a live timer.
      revived.resumeBackupTimer();
      const entry: CacheEntry = {
        promise: Promise.resolve(revived),
        settled: true,
        refs: 0,
        leases: 0,
        store: revived,
      };
      this.stores.set(graphId, entry);
      return entry;
    }
    if (retiredEntry) {
      // The weakly-referenced instance has been collected; prune the stale slot.
      this.retired.delete(graphId);
    }

    const promise = this.loadStore(graphId, filePath, requireExisting);
    const entry: CacheEntry = { promise, settled: false, refs: 0, leases: 0 };
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
      let retirement: RetiredEntry | undefined;
      if (store) {
        // Record the weak reference BEFORE awaiting the shutdown below, so a
        // `getStore` interleaving with that save revives this instance instead
        // of constructing a second one.
        retirement = { ref: new WeakRef(store) };
        this.retired.set(victim.graphId, retirement);
      }
      await this.shutdownRetired(victim.graphId, retirement, victim.entry.promise);
    }
    this.pruneRetired();
  }

  /**
   * The oldest settled entry with nothing using it. A lease or an in-flight
   * `getStore`/`lease` call counts as use, so such an entry is skipped rather
   * than saved and torn down underneath its holder. Returns `undefined` when
   * every entry is in use, which lets the cache exceed its bound temporarily
   * rather than drop a store a caller can still write to.
   */
  private findEvictionVictim(): { graphId: string; entry: CacheEntry } | undefined {
    for (const [graphId, entry] of this.stores) {
      if (entry.settled && entry.refs === 0 && entry.leases === 0) {
        return { graphId, entry };
      }
    }
    return undefined;
  }

  /** Forget weak references whose store has been collected. */
  private pruneRetired(): void {
    for (const [graphId, retired] of this.retired) {
      if (retired.ref.deref() === undefined) {
        this.retired.delete(graphId);
      }
    }
  }

  /**
   * Shut down a just-retired store, unless it has been revived in the meantime.
   *
   * Both checks matter and they are not the same check:
   *
   * - Before shutting down, skip entirely if the slot no longer holds THIS
   *   retirement. A revived instance is resident again and owned by its new
   *   entry, so shutting it down here would clear the timer the revival just
   *   reinstated (and save the same instance twice, concurrently, from two
   *   owners).
   * - After shutting down, re-arm only if that instance is the one now resident
   *   for the graph: a revival that landed while the save was in flight found
   *   the timer already stopped, so the resident instance must get it back.
   *   Testing residency (rather than just "not this retirement") is what keeps
   *   the shutdown drain from leaving a timer armed on a store the process has
   *   already torn down.
   *
   * Together these make "a resident store always has a live backup timer" true
   * for every interleaving rather than for the likely one.
   */
  private async shutdownRetired(
    graphId: string,
    retirement: RetiredEntry | undefined,
    pending: Promise<LocalGraphStore>
  ): Promise<void> {
    try {
      const store = await pending;
      if (retirement && this.retired.get(graphId) !== retirement) {
        return;
      }
      await store.shutdown();
      if (retirement && this.stores.get(graphId)?.store === store) {
        store.resumeBackupTimer();
      }
    } catch (error) {
      // Eviction must not fail the request that triggered it; a store that
      // never loaded has nothing to save.
      console.error(`Failed to shut down live store for graph '${graphId}':`, error);
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

  /**
   * Save a store that is still retired. Used by the shutdown drain: unlike
   * `shutdownRetired`, the caller has already cleared the registry, so there is
   * no revival to race against and nothing to re-arm.
   */
  private async shutdownRetiredInstance(graphId: string, retired: RetiredEntry): Promise<void> {
    const store = retired.ref.deref();
    if (!store) {
      // Collected before the drain: no caller holds it, so it has nothing
      // pending that the drain could persist.
      return;
    }
    try {
      await store.shutdown();
    } catch (error) {
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
