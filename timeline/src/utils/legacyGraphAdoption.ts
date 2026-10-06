import * as fs from 'fs/promises';
import * as path from 'path';
import { GraphContextStore } from './GraphContextStore';

/**
 * Name of the graph created to receive legacy data when no graph metadata
 * exists yet. Graph-scoped isolation keeps live data per graph; a developer who
 * only ever had the historical single store has no graph to attach it to.
 */
const DEFAULT_GRAPH_NAME = 'Default Graph';

/**
 * Minimal view of `GraphRepository` that adoption needs. Declaring it here
 * rather than importing the repository keeps this module a leaf: it depends on
 * a store registry and graph metadata, not on the repository layer.
 */
export interface LegacyAdoptionGraphRepository {
  getActiveGraph(): Promise<{ id: string } | null>;
  create(data: { name: string }): Promise<{ id: string }>;
  setActiveGraph(id: string): Promise<boolean>;
}

/** Structured logging seam so tests can capture adoption decisions quietly. */
export interface LegacyAdoptionLogger {
  info(message: string): void;
  warn(message: string, error?: unknown): void;
}

export interface AdoptLegacyGraphStoreOptions {
  /** Absolute path of the historical single-store file (config graphFile). */
  legacyFilePath: string;
  /** Registry that owns the per-graph live stores. */
  graphContextStore: GraphContextStore;
  /** Graph metadata repository used to resolve or create the active graph. */
  graphRepository: LegacyAdoptionGraphRepository;
  /** Name for the graph created when no active graph exists. */
  defaultGraphName?: string;
  /** Defaults to the console. */
  logger?: LegacyAdoptionLogger;
}

/**
 * Why adoption did or did not happen. Callers do not branch on this today; it
 * exists so tests and logs can state the outcome without re-deriving it.
 */
export type LegacyAdoptionStatus =
  | 'no-legacy-file'
  | 'legacy-unreadable'
  | 'legacy-invalid'
  | 'adopted'
  | 'skipped-existing-file'
  | 'skipped-store-loaded'
  | 'write-failed';

export interface LegacyAdoptionResult {
  status: LegacyAdoptionStatus;
  /** Graph the legacy data was (or would have been) adopted into. */
  graphId?: string;
  /** Per-graph file path, present once a target graph is known. */
  perGraphPath?: string;
}

/**
 * One-shot adoption of the historical global live store into a per-graph store.
 *
 * Before graph-scoped isolation, local data lived at
 * `<dataDirectory>/<graphFile>`; afterwards each graph reads its own
 * `<dataDirectory>/graphs-live/<graphId>.json`. This function copies the legacy
 * file into the active graph's per-graph file exactly once, so a developer's
 * existing data does not silently disappear after the upgrade.
 *
 * The function is intentionally idempotent and side-effect-minimal:
 *
 * - If the legacy file does not exist it does nothing (the common case).
 * - It creates a default graph only when a legacy file exists and no graph does.
 * - It never overwrites a per-graph file, and never calls
 *   `GraphContextStore.getStore` (which would create one and defeat the guard).
 * - It never deletes, moves or rewrites the legacy file; it remains as a backup.
 * - A corrupt or unreadable legacy file is logged and skipped rather than
 *   crashing startup, and is left untouched for a human to inspect.
 */
export async function adoptLegacyGraphStore(
  options: AdoptLegacyGraphStoreOptions
): Promise<LegacyAdoptionResult> {
  const {
    legacyFilePath,
    graphContextStore,
    graphRepository,
    defaultGraphName = DEFAULT_GRAPH_NAME,
  } = options;
  const logger = options.logger ?? console;

  // (a) Nothing to do unless the legacy single store exists. Reading it once
  // both tests for existence and yields the bytes to adopt; the missing-file
  // case stays a single cheap syscall.
  let legacyContents: string;
  try {
    legacyContents = await fs.readFile(legacyFilePath, 'utf8');
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return { status: 'no-legacy-file' };
    }
    // An unreadable legacy file (for example a permission error) must not take
    // the whole process down at startup, and must not be deleted or rewritten.
    // Warn loudly and carry on; the data is still on disk for a human to fix.
    logger.warn(
      `Legacy live store at ${legacyFilePath} could not be read; skipping adoption and leaving it untouched.`,
      error
    );
    return { status: 'legacy-unreadable' };
  }

  // Validate before creating a graph or writing anything: a corrupt legacy file
  // must not become a corrupt per-graph store (which would make every later read
  // of that graph fail) and must not spuriously create a graph.
  if (!isUsableStoreDocument(legacyContents)) {
    logger.warn(
      `Legacy live store at ${legacyFilePath} is not a valid JSON object; skipping adoption and leaving it untouched.`
    );
    return { status: 'legacy-invalid' };
  }

  // (b) Resolve the target graph, creating a default one when none exists so
  // data with no graph metadata still ends up reachable. `create` activates the
  // first graph; setting it explicitly keeps the "make it active" guarantee
  // independent of that detail.
  let active = await graphRepository.getActiveGraph();
  if (!active) {
    active = await graphRepository.create({ name: defaultGraphName });
    await graphRepository.setActiveGraph(active.id);
    logger.info(`Created graph '${active.id}' to receive the legacy live store.`);
  }
  const graphId = active.id;

  // (c) Never adopt over an existing store. `has` catches a store already
  // loaded (or loading) in memory; the file check catches one on disk. Either
  // way this graph already has data — possibly adopted on an earlier run — and
  // overwriting it would destroy it.
  if (graphContextStore.has(graphId)) {
    logger.info(
      `Legacy live store not adopted: graph '${graphId}' already has a loaded live store.`
    );
    return { status: 'skipped-store-loaded', graphId };
  }

  const perGraphPath = graphContextStore.getFilePath(graphId);
  if (await fileExists(perGraphPath)) {
    logger.info(
      `Legacy live store not adopted: graph '${graphId}' already has a live store at ${perGraphPath}.`
    );
    return { status: 'skipped-existing-file', graphId, perGraphPath };
  }

  // (d) Copy the legacy contents verbatim. Write to a sibling temp file and
  // rename into place so a crash cannot leave a half-written per-graph file that
  // the guard would then treat as real data forever. Writing directly rather
  // than through `getStore` is essential: `getStore` creates and caches a store,
  // which would defeat the guard above.
  const tempPath = `${perGraphPath}.adopting-${process.pid}-${Date.now()}`;
  try {
    await fs.mkdir(path.dirname(perGraphPath), { recursive: true });
    await fs.writeFile(tempPath, legacyContents, 'utf8');
    await fs.rename(tempPath, perGraphPath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {
      // Best-effort temp cleanup; a leftover `.adopting-*` file is inert.
    });
    logger.warn(
      `Failed to adopt legacy live store into graph '${graphId}'; leaving the legacy file untouched.`,
      error
    );
    return { status: 'write-failed', graphId, perGraphPath };
  }

  logger.info(
    `Adopted legacy live store into graph '${graphId}' at ${perGraphPath}; the legacy file is left in place as a backup.`
  );
  return { status: 'adopted', graphId, perGraphPath };
}

function isFileNotFoundError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * A live store is a JSON object (`LocalGraphStore` serialises its maps into
 * object properties). Anything that is not a plain object cannot be loaded, so
 * adopting it would only plant a corrupt store.
 */
function isUsableStoreDocument(raw: string): boolean {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}
