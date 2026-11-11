/**
 * Graph Repository for managing multiple graphs with versioning
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  Graph,
  IGraph,
  CreateGraphData,
  UpdateGraphData,
  GraphStatus,
  GraphMetadata,
  VersionRef,
  VersionOperation,
  MergeParent,
  EntityType,
} from '../models/Graph';
import { VersionRepository, EntityChanges, ResolvedGraphData } from './VersionRepository';

export interface GraphRepositoryConfig {
  dataDir: string;
}

export interface GraphListOptions {
  status?: GraphStatus;
  /** Keep only the graphs this accepts, before counting and paging. */
  include?: (graphId: string) => boolean;
  limit?: number;
  offset?: number;
}

export interface GraphListResult {
  graphs: IGraph[];
  total: number;
}

/**
 * Repository for Graph CRUD operations with integrated versioning
 */
export class GraphRepository {
  private readonly dataDir: string;
  private readonly versionRepository: VersionRepository;
  private graphsIndexPath: string;

  constructor(config: GraphRepositoryConfig) {
    this.dataDir = config.dataDir;
    this.graphsIndexPath = path.join(this.dataDir, 'graphs', 'index.json');
    this.versionRepository = new VersionRepository({ dataDir: this.dataDir });
  }

  /**
   * Initialize the repository (create directories if needed)
   */
  async initialize(): Promise<void> {
    const graphsDir = path.join(this.dataDir, 'graphs');
    await fs.promises.mkdir(graphsDir, { recursive: true });

    // Create index file if it doesn't exist. Under the index lock, which reads
    // the index again first: another repository may have just created a graph.
    try {
      await fs.promises.access(this.graphsIndexPath);
    } catch {
      await this.mutateIndex(() => undefined);
    }
  }

  /**
   * Create a new graph
   */
  async create(data: CreateGraphData): Promise<Graph> {
    const graph = new Graph(data);
    
    // Initialize version storage for this graph
    await this.versionRepository.initializeGraph(graph.id);

    // Save graph metadata
    await this.saveGraphMetadata(graph);

    // Add to index; if this is the first graph, make it active
    await this.mutateIndex((index) => {
      index.graphs.push(graph.id);
      if (!index.activeGraphId) {
        index.activeGraphId = graph.id;
      }
    });

    return graph;
  }

  /**
   * Get a graph by ID
   */
  async findById(id: string): Promise<Graph | null> {
    try {
      const metadata = await this.loadGraphMetadata(id);
      return new Graph(metadata);
    } catch {
      return null;
    }
  }

  /**
   * Whether a graph is known to exist.
   *
   * `findById` answers `null` both for a graph that does not exist and for one
   * whose metadata could not be read, and the two mean different things to a
   * caller: a missing graph is a dangling reference, an unreadable one is a
   * transient failure. The index says which ids exist, so a caller can tell
   * them apart.
   */
  async exists(id: string): Promise<boolean> {
    const index = await this.loadIndex();
    return index.graphs.includes(id);
  }

  /**
   * List all graphs
   */
  async findAll(options: GraphListOptions = {}): Promise<GraphListResult> {
    const { status, include, limit = 50, offset = 0 } = options;
    const index = await this.loadIndex();

    const graphs: IGraph[] = [];
    for (const graphId of index.graphs) {
      if (include && !include(graphId)) {
        continue;
      }
      try {
        const metadata = await this.loadGraphMetadata(graphId);
        
        // Filter by status if specified
        if (status && metadata.status !== status) {
          continue;
        }
        
        graphs.push(metadata);
      } catch {
        // Skip graphs that can't be loaded
        continue;
      }
    }

    // Sort by updatedAt descending
    graphs.sort((a, b) => 
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );

    const total = graphs.length;
    const paginated = graphs.slice(offset, offset + limit);

    return { graphs: paginated, total };
  }

  /**
   * Update a graph
   */
  async update(id: string, updates: UpdateGraphData): Promise<Graph | null> {
    const existing = await this.findById(id);
    if (!existing) {
      return null;
    }

    const updated = existing.update(updates);
    await this.saveGraphMetadata(updated);

    return updated;
  }

  /**
   * Soft delete a graph
   */
  async delete(id: string): Promise<boolean> {
    const existing = await this.findById(id);
    if (!existing) {
      return false;
    }

    const deleted = existing.update({ status: 'deleted' });
    await this.saveGraphMetadata(deleted);

    // Remove from active if it was active
    await this.mutateIndex((index) => {
      if (index.activeGraphId !== id) return false;
      // Find another active graph
      const activeGraphs = index.graphs.filter(gid => gid !== id);
      index.activeGraphId = activeGraphs.length > 0 ? activeGraphs[0] : null;
    });

    return true;
  }

  /**
   * Permanently delete a graph and all its data
   */
  async hardDelete(id: string): Promise<boolean> {
    const existing = await this.findById(id);
    if (!existing) {
      return false;
    }

    // Delete version data
    await this.versionRepository.deleteGraph(id);

    // Delete metadata
    const metadataPath = this.getGraphMetadataPath(id);
    try {
      await fs.promises.unlink(metadataPath);
    } catch {
      // Ignore if already deleted
    }

    // Remove from index
    await this.mutateIndex((index) => {
      index.graphs = index.graphs.filter(gid => gid !== id);
      if (index.activeGraphId === id) {
        index.activeGraphId = index.graphs.length > 0 ? index.graphs[0] : null;
      }
    });

    return true;
  }

  /**
   * Get the currently active graph
   */
  async getActiveGraph(): Promise<Graph | null> {
    const index = await this.loadIndex();
    if (!index.activeGraphId) {
      return null;
    }
    return this.findById(index.activeGraphId);
  }

  /**
   * Set the active graph
   */
  async setActiveGraph(id: string): Promise<boolean> {
    const graph = await this.findById(id);
    if (!graph || graph.status !== 'active') {
      return false;
    }

    await this.mutateIndex((index) => {
      index.activeGraphId = id;
    });

    return true;
  }

  /**
   * Get version history for a graph
   */
  async getVersionHistory(
    graphId: string,
    limit = 50,
    offset = 0
  ): Promise<{ versions: VersionRef[]; total: number }> {
    return this.versionRepository.getVersionHistory(graphId, limit, offset);
  }

  /**
   * Get a specific version
   */
  async getVersion(graphId: string, version: number): Promise<VersionRef | null> {
    return this.versionRepository.getVersionRef(graphId, version);
  }

  /** Name a version (or clear its name with null). See VersionRef.label. */
  async setVersionLabel(graphId: string, version: number, label: string | null): Promise<void> {
    return this.versionRepository.setVersionLabel(graphId, version, label);
  }

  /**
   * Get the latest version of a graph, or null when it has no versions.
   */
  async getLatestVersion(graphId: string): Promise<VersionRef | null> {
    return this.versionRepository.getLatestVersion(graphId);
  }

  /**
   * Some entities' data at the graph's head version, by id (absent ids are
   * omitted). For describing a write in Version history.
   */
  async getHeadEntities(
    graphId: string,
    type: EntityType,
    ids: string[]
  ): Promise<Record<string, Record<string, unknown>>> {
    return this.versionRepository.getHeadEntities(graphId, type, ids);
  }

  /**
   * Rollback to a specific version
   */
  async rollback(graphId: string, version: number, userId?: string): Promise<VersionRef> {
    const versionRef = await this.versionRepository.rollback(graphId, version, userId);

    // Rollback commits a new tree directly through the version repository, so
    // the metadata recompute in `commitChanges` does not run. Without this the
    // graph's counts keep describing the pre-rollback head, which the export
    // entity-count trigger reads.
    const graph = await this.findById(graphId);
    if (graph) {
      const metadata = await this.calculateMetadata(graphId);
      await this.update(graphId, { metadata });
    }

    return versionRef;
  }

  /**
   * Commit changes to a graph
   */
  async commitChanges(
    graphId: string,
    changes: EntityChanges,
    operation: VersionOperation,
    description?: string,
    userId?: string,
    mergeParent?: MergeParent,
    expectedParentVersion?: number | null
  ): Promise<VersionRef> {
    // Commit to version repository. Optional arguments are forwarded only when
    // present so a linear commit keeps its existing five-argument call shape
    // (and a merge parent is never recorded as `undefined`).
    const versionRef =
      mergeParent !== undefined || expectedParentVersion !== undefined
        ? await this.versionRepository.commit(
            graphId,
            changes,
            operation,
            description,
            userId,
            mergeParent,
            expectedParentVersion
          )
        : await this.versionRepository.commit(
            graphId,
            changes,
            operation,
            description,
            userId
          );

    // Update graph metadata
    const graph = await this.findById(graphId);
    if (graph) {
      const metadata = await this.calculateMetadata(graphId);
      await this.update(graphId, { metadata });
    }

    return versionRef;
  }

  /**
   * Get the full data for a graph at a specific version
   */
  async checkout(graphId: string, version?: number): Promise<ResolvedGraphData> {
    if (version !== undefined) {
      return this.versionRepository.checkout(graphId, version);
    }

    // Get latest version
    const latest = await this.versionRepository.getLatestVersion(graphId);
    if (!latest) {
      return {
        events: {},
        arcs: {},
        relationships: {},
        pressures: {},
      };
    }

    return this.versionRepository.checkout(graphId, latest.version);
  }

  /**
   * Branch a graph
   */
  async branch(
    sourceGraphId: string,
    name: string,
    description?: string
  ): Promise<Graph> {
    const source = await this.findById(sourceGraphId);
    if (!source) {
      throw new Error(`Source graph not found: ${sourceGraphId}`);
    }

    // Record the fork point before copying anything. It is a real version in the
    // source graph's version repository, not the graph metadata's `version`
    // counter (which also advances on metadata-only updates). Reading the head
    // first and checking out that exact version makes the branch's initial tree
    // identical to the recorded fork point even if the source advances while the
    // branch is being created.
    const forkVersion = await this.versionRepository.getLatestVersion(sourceGraphId);

    // Create new graph with branch metadata. `null` means the source had no
    // versions, i.e. there is no fork point to recover.
    const branchGraph = source.branch(name, description, forkVersion ? forkVersion.version : null);
    
    // Initialize version storage
    await this.versionRepository.initializeGraph(branchGraph.id);

    // Copy the state at the recorded fork point
    const sourceData = forkVersion
      ? await this.checkout(sourceGraphId, forkVersion.version)
      : await this.checkout(sourceGraphId);
    const changes: EntityChanges = {
      added: [],
      modified: [],
      deleted: [],
    };

    // Add all entities from source
    for (const [id, data] of Object.entries(sourceData.events)) {
      changes.added.push({ type: 'event', id, data });
    }
    for (const [id, data] of Object.entries(sourceData.arcs)) {
      changes.added.push({ type: 'arc', id, data });
    }
    for (const [id, data] of Object.entries(sourceData.relationships)) {
      changes.added.push({ type: 'relationship', id, data });
    }
    for (const [id, data] of Object.entries(sourceData.pressures)) {
      changes.added.push({ type: 'pressure', id, data });
    }

    // Commit the initial state
    if (changes.added.length > 0) {
      await this.versionRepository.commit(
        branchGraph.id,
        changes,
        'branch',
        `Branched from ${source.name}`
      );
    }

    // Save graph metadata
    await this.saveGraphMetadata(branchGraph);

    // Add to index
    await this.mutateIndex((index) => {
      index.graphs.push(branchGraph.id);
    });

    // Update metadata
    const metadata = await this.calculateMetadata(branchGraph.id);
    await this.update(branchGraph.id, { metadata });

    return new Graph({
      ...branchGraph.toJSON(),
      metadata,
    });
  }

  /**
   * Calculate metadata for a graph based on current state
   */
  async calculateMetadata(graphId: string): Promise<GraphMetadata> {
    const data = await this.checkout(graphId);

    const events = Object.values(data.events);
    const eventCount = events.length;
    const arcCount = Object.keys(data.arcs).length;
    const relationshipCount = Object.keys(data.relationships).length;
    const pressureCount = Object.keys(data.pressures).length;

    // Calculate temporal range from events
    let temporalRange: GraphMetadata['temporalRange'] = undefined;
    if (eventCount > 0) {
      const timestamps = events
        .map(e => (e as Record<string, unknown>).timestamp as string)
        .filter(t => t)
        .map(t => new Date(t).getTime())
        .filter(t => !isNaN(t));

      if (timestamps.length > 0) {
        temporalRange = {
          start: new Date(Math.min(...timestamps)).toISOString(),
          end: new Date(Math.max(...timestamps)).toISOString(),
        };
      }
    }

    // Collect unique actors
    const actorSet = new Set<string>();
    for (const event of events) {
      const actor = (event as Record<string, unknown>).actor as string;
      if (actor) actorSet.add(actor);
    }

    return {
      eventCount,
      arcCount,
      relationshipCount,
      pressureCount,
      temporalRange,
      actors: Array.from(actorSet),
    };
  }

  /**
   * Run garbage collection on a graph
   */
  async gc(graphId: string): Promise<{ removedObjects: number; freedBytes: number }> {
    return this.versionRepository.gc(graphId);
  }

  // Private helper methods

  private getGraphMetadataPath(graphId: string): string {
    return path.join(this.dataDir, 'graphs', graphId, 'graph.json');
  }

  private async loadGraphMetadata(graphId: string): Promise<IGraph> {
    const metadataPath = this.getGraphMetadataPath(graphId);
    const content = await fs.promises.readFile(metadataPath, 'utf-8');
    try {
      return JSON.parse(content) as IGraph;
    } catch {
      // Both callers treat any throw as "metadata unusable" (findById returns
      // null, findAll skips the graph), so a descriptive error is as good as
      // the raw SyntaxError and names the file that is malformed.
      throw new Error(`Graph metadata is not valid JSON: ${metadataPath}`);
    }
  }

  private async saveGraphMetadata(graph: Graph): Promise<void> {
    const graphDir = path.join(this.dataDir, 'graphs', graph.id);
    await fs.promises.mkdir(graphDir, { recursive: true });
    
    const metadataPath = this.getGraphMetadataPath(graph.id);
    await fs.promises.writeFile(metadataPath, JSON.stringify(graph.toJSON(), null, 2), 'utf-8');
  }

  /**
   * The index, or an empty one when there is none yet (or it cannot be
   * parsed). With `strict`, any other failure to read it is thrown: a change
   * made on top of an index that could not be read for a moment would write
   * back an index holding only that change, and every other graph would drop
   * out of the list.
   */
  private async loadIndex(strict = false): Promise<GraphIndex> {
    let content: string;
    try {
      content = await fs.promises.readFile(this.graphsIndexPath, 'utf-8');
    } catch (error) {
      if (strict && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return { graphs: [], activeGraphId: null };
    }
    try {
      return JSON.parse(content) as GraphIndex;
    } catch {
      return { graphs: [], activeGraphId: null };
    }
  }

  /**
   * Written to a temporary file and renamed into place, so a reader never sees
   * half an index (which `loadIndex` would read as an empty one).
   */
  private async saveIndex(index: GraphIndex): Promise<void> {
    const temporary = `${this.graphsIndexPath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    try {
      await fs.promises.writeFile(temporary, JSON.stringify(index, null, 2), 'utf-8');
      // On Windows a rename onto a file that a scanner or indexer has open
      // fails for a moment (EPERM, EBUSY, EACCES); it is retried briefly.
      for (let attempt = 0; ; attempt++) {
        try {
          await fs.promises.rename(temporary, this.graphsIndexPath);
          return;
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (attempt >= 4 || !['EPERM', 'EBUSY', 'EACCES'].includes(code ?? '')) throw error;
          await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
        }
      }
    } catch (error) {
      await fs.promises.unlink(temporary).catch(() => undefined);
      throw error;
    }
  }


  /**
   * Read, change and write the index as one step. Two graphs created at once
   * (an agent's parallel tool calls) each read the index and wrote it back with
   * only their own graph added, so one of them vanished from the list. The
   * changes now run one after another. This is a lock within the process,
   * which is what the single-replica deployment the store requires allows.
   * `change` returns `false` when it changed nothing, so nothing is written.
   */
  private mutateIndex(change: (index: GraphIndex) => boolean | void): Promise<void> {
    // Keyed by file, not by repository: GraphService, ImportService and the
    // container each make their own repository over the same index.
    const key = path.resolve(this.graphsIndexPath);
    const run = (indexQueues.get(key) ?? Promise.resolve()).then(async () => {
      const index = await this.loadIndex(true);
      if (change(index) === false) return;
      await this.saveIndex(index);
    });
    // A failed change must not block the ones queued after it.
    indexQueues.set(key, run.catch(() => undefined));
    return run;
  }
}

/** The queue of changes to each index file, shared by every repository in the process. */
const indexQueues = new Map<string, Promise<unknown>>();

interface GraphIndex {
  graphs: string[];
  activeGraphId: string | null;
}
