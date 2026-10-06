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
} from '../models/Graph';
import { VersionRepository, EntityChanges, ResolvedGraphData } from './VersionRepository';

export interface GraphRepositoryConfig {
  dataDir: string;
}

export interface GraphListOptions {
  status?: GraphStatus;
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

    // Create index file if it doesn't exist
    try {
      await fs.promises.access(this.graphsIndexPath);
    } catch {
      await this.saveIndex({ graphs: [], activeGraphId: null });
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

    // Add to index
    const index = await this.loadIndex();
    index.graphs.push(graph.id);
    
    // If this is the first graph, make it active
    if (!index.activeGraphId) {
      index.activeGraphId = graph.id;
    }
    
    await this.saveIndex(index);

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
   * List all graphs
   */
  async findAll(options: GraphListOptions = {}): Promise<GraphListResult> {
    const { status, limit = 50, offset = 0 } = options;
    const index = await this.loadIndex();

    const graphs: IGraph[] = [];
    for (const graphId of index.graphs) {
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
    const index = await this.loadIndex();
    if (index.activeGraphId === id) {
      // Find another active graph
      const activeGraphs = index.graphs.filter(gid => gid !== id);
      index.activeGraphId = activeGraphs.length > 0 ? activeGraphs[0] : null;
      await this.saveIndex(index);
    }

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
    const index = await this.loadIndex();
    index.graphs = index.graphs.filter(gid => gid !== id);
    if (index.activeGraphId === id) {
      index.activeGraphId = index.graphs.length > 0 ? index.graphs[0] : null;
    }
    await this.saveIndex(index);

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

    const index = await this.loadIndex();
    index.activeGraphId = id;
    await this.saveIndex(index);

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

  /**
   * Get the latest version of a graph, or null when it has no versions.
   */
  async getLatestVersion(graphId: string): Promise<VersionRef | null> {
    return this.versionRepository.getLatestVersion(graphId);
  }

  /**
   * Rollback to a specific version
   */
  async rollback(graphId: string, version: number, userId?: string): Promise<VersionRef> {
    return this.versionRepository.rollback(graphId, version, userId);
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
    mergeParent?: MergeParent
  ): Promise<VersionRef> {
    // Commit to version repository. The merge parent is forwarded only when
    // present so that a linear commit keeps its existing single-parent call
    // shape (and a merge parent is never recorded as `undefined`).
    const versionRef = mergeParent
      ? await this.versionRepository.commit(
          graphId,
          changes,
          operation,
          description,
          userId,
          mergeParent
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

    // Create new graph with branch metadata
    const branchGraph = source.branch(name, description);
    
    // Initialize version storage
    await this.versionRepository.initializeGraph(branchGraph.id);

    // Copy the current state from source
    const sourceData = await this.checkout(sourceGraphId);
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
    const index = await this.loadIndex();
    index.graphs.push(branchGraph.id);
    await this.saveIndex(index);

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

  private async loadIndex(): Promise<GraphIndex> {
    try {
      const content = await fs.promises.readFile(this.graphsIndexPath, 'utf-8');
      return JSON.parse(content) as GraphIndex;
    } catch {
      return { graphs: [], activeGraphId: null };
    }
  }

  private async saveIndex(index: GraphIndex): Promise<void> {
    await fs.promises.writeFile(this.graphsIndexPath, JSON.stringify(index, null, 2), 'utf-8');
  }
}

interface GraphIndex {
  graphs: string[];
  activeGraphId: string | null;
}
