import * as fs from 'fs/promises';
import * as path from 'path';
import { LocalGraphStore } from './LocalGraphStore';
import { loadConfig } from './config';
import { DataCorruptionError, LocalStorageError, NotFoundError, ValidationError } from './errors';

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
   * In-flight or resolved stores, keyed by graph id. Storing the promise means
   * two concurrent requests for the same graph share one load instead of racing
   * to read the file twice. Map iteration order is the LRU order: the oldest
   * entry is first, and a hit is moved to the end.
   */
  private readonly stores = new Map<string, Promise<LocalGraphStore>>();

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

    const cached = this.stores.get(graphId);
    if (cached) {
      this.touch(graphId, cached);
      return cached;
    }

    const pending = this.loadStore(graphId, filePath, options.requireExisting === true);
    this.stores.set(graphId, pending);

    // A failed load must not poison the cache: drop the rejected promise so the
    // next request retries instead of replaying the same failure forever.
    pending.catch(() => {
      if (this.stores.get(graphId) === pending) {
        this.stores.delete(graphId);
      }
    });

    try {
      const store = await pending;
      await this.evictOverflow();
      return store;
    } catch (error) {
      if (this.stores.get(graphId) === pending) {
        this.stores.delete(graphId);
      }
      throw error;
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
    const pending = this.stores.get(graphId);
    if (!pending) {
      return;
    }
    this.stores.delete(graphId);
    await this.shutdownQuietly(pending, graphId);
  }

  /**
   * Drop and shut down every cached store. Intended for process shutdown and
   * tests.
   */
  async evictAll(): Promise<void> {
    const entries = Array.from(this.stores.entries());
    this.stores.clear();
    await Promise.all(entries.map(([graphId, pending]) => this.shutdownQuietly(pending, graphId)));
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

  private touch(graphId: string, pending: Promise<LocalGraphStore>): void {
    this.stores.delete(graphId);
    this.stores.set(graphId, pending);
  }

  private async evictOverflow(): Promise<void> {
    while (this.stores.size > this.maxCachedGraphs) {
      const oldest = this.stores.keys().next().value;
      if (oldest === undefined) {
        return;
      }
      const pending = this.stores.get(oldest);
      this.stores.delete(oldest);
      if (pending) {
        await this.shutdownQuietly(pending, oldest);
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
