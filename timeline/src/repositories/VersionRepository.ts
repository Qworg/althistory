/**
 * Git-like Version Repository for content-addressable storage and delta-based versioning
 * 
 * This implements a storage system similar to Git:
 * - Content-addressable objects (stored by SHA-256 hash)
 * - Tree objects that map entity IDs to content hashes
 * - Version refs that store deltas from parent versions
 * - Pack files for compressing old versions
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  ContentObject,
  TreeObject,
  VersionRef,
  VersionOperation,
  EntityType,
  PackFile,
  MergeParent,
} from '../models/Graph';

export interface VersionRepositoryConfig {
  dataDir: string;
  packThreshold?: number;  // Number of versions before packing (default: 100)
}

/**
 * Represents changes to be committed
 */
export interface EntityChanges {
  added: Array<{ type: EntityType; id: string; data: Record<string, unknown> }>;
  modified: Array<{ type: EntityType; id: string; data: Record<string, unknown> }>;
  deleted: Array<{ type: EntityType; id: string }>;
}

/**
 * Full graph data resolved from a tree
 */
export interface ResolvedGraphData {
  events: Record<string, Record<string, unknown>>;
  arcs: Record<string, Record<string, unknown>>;
  relationships: Record<string, Record<string, unknown>>;
  pressures: Record<string, Record<string, unknown>>;
}

/**
 * Thrown by `commit` when the caller supplied an `expectedParentVersion` that no
 * longer matches the graph's head. It means another commit landed between the
 * caller reading the graph and committing to it, so the changes were computed
 * against a tree that is no longer the parent. Callers that can recompute (a
 * merge) retry; callers that cannot should surface it.
 */
export class StaleVersionError extends Error {
  constructor(
    public readonly graphId: string,
    public readonly expectedParentVersion: number | null,
    public readonly actualParentVersion: number | null
  ) {
    super(
      `Graph ${graphId} advanced from version ${expectedParentVersion ?? 'none'} to ` +
        `${actualParentVersion ?? 'none'} while the commit was in flight`
    );
    this.name = 'StaleVersionError';
  }
}

/**
 * Simple async mutex for preventing concurrent commits to the same graph
 */
class GraphMutex {
  private locks: Map<string, Promise<void>> = new Map();

  async acquire(graphId: string): Promise<() => void> {
    // Wait for any existing lock to release
    while (this.locks.has(graphId)) {
      await this.locks.get(graphId);
    }

    // Create a new lock
    let release: () => void;
    const lock = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(graphId, lock);

    return () => {
      this.locks.delete(graphId);
      release!();
    };
  }
}

export class VersionRepository {
  private readonly dataDir: string;
  private readonly packThreshold: number;
  private readonly commitMutex: GraphMutex;

  constructor(config: VersionRepositoryConfig) {
    this.dataDir = config.dataDir;
    this.packThreshold = config.packThreshold ?? 100;
    this.commitMutex = new GraphMutex();
  }

  /**
   * Initialize storage directories for a graph
   */
  async initializeGraph(graphId: string): Promise<void> {
    const graphDir = this.getGraphDir(graphId);
    const dirs = [
      graphDir,
      path.join(graphDir, 'objects'),
      path.join(graphDir, 'versions'),
      path.join(graphDir, 'packs'),
    ];

    for (const dir of dirs) {
      await fs.promises.mkdir(dir, { recursive: true });
    }

    // Create initial empty tree
    const emptyTree: TreeObject = {
      events: {},
      arcs: {},
      relationships: {},
      pressures: {},
    };
    const treeHash = await this.storeTree(graphId, emptyTree);
    
    // Store current tree pointer
    await this.setCurrentTree(graphId, treeHash);
  }

  /**
   * Commit changes to create a new version.
   *
   * `mergeParent`, when supplied, records the source graph's head version as the
   * second parent of a merge commit. It is never inferred: a linear commit has no
   * second parent and leaves the field unset.
   *
   * `expectedParentVersion`, when supplied (including `null`, meaning "no
   * versions yet"), is a compare-and-swap guard. Under the commit mutex the
   * graph's head must still equal it or the commit is refused with a
   * `StaleVersionError`. That is what makes a recorded first parent identify the
   * tree the caller actually read.
   */
  async commit(
    graphId: string,
    changes: EntityChanges,
    operation: VersionOperation,
    description?: string,
    userId?: string,
    mergeParent?: MergeParent,
    expectedParentVersion?: number | null
  ): Promise<VersionRef> {
    // Acquire mutex to prevent concurrent commits to the same graph
    const release = await this.commitMutex.acquire(graphId);
    
    try {
      return await this.commitInternal(graphId, changes, operation, description, userId, mergeParent, expectedParentVersion);
    } finally {
      release();
    }
  }

  /**
   * Internal commit implementation (must be called with mutex held)
   */
  private async commitInternal(
    graphId: string,
    changes: EntityChanges,
    operation: VersionOperation,
    description?: string,
    userId?: string,
    mergeParent?: MergeParent,
    expectedParentVersion?: number | null
  ): Promise<VersionRef> {
    // Get current state
    const currentTreeHash = await this.getCurrentTree(graphId);
    const currentTree = currentTreeHash 
      ? await this.getTree(graphId, currentTreeHash)
      : { events: {}, arcs: {}, relationships: {}, pressures: {} };
    
    const latestVersion = await this.getLatestVersion(graphId);

    // Compare-and-swap. When the caller names the parent it computed against,
    // refuse to commit if the graph has advanced in the meantime; otherwise the
    // commit would record a first parent that is not the tree it diffed.
    const actualParentVersion = latestVersion?.version ?? null;
    if (
      expectedParentVersion !== undefined &&
      actualParentVersion !== expectedParentVersion
    ) {
      throw new StaleVersionError(graphId, expectedParentVersion, actualParentVersion);
    }

    const newVersion = (latestVersion?.version ?? -1) + 1;

    // Process changes and build new tree
    const newTree: TreeObject = { ...currentTree };
    const versionChanges: VersionRef['changes'] = {
      added: [],
      modified: [],
      deleted: [],
    };

    // Handle added entities
    for (const entity of changes.added) {
      const hash = await this.storeObject(graphId, {
        type: entity.type,
        data: entity.data,
      });
      this.setEntityHash(newTree, entity.type, entity.id, hash);
      versionChanges.added.push({
        type: entity.type,
        id: entity.id,
        hash,
      });
    }

    // Handle modified entities
    for (const entity of changes.modified) {
      const prevHash = this.getEntityHash(currentTree, entity.type, entity.id);
      const hash = await this.storeObject(graphId, {
        type: entity.type,
        data: entity.data,
      });
      this.setEntityHash(newTree, entity.type, entity.id, hash);
      versionChanges.modified.push({
        type: entity.type,
        id: entity.id,
        hash,
        prevHash,
      });
    }

    // Handle deleted entities
    for (const entity of changes.deleted) {
      const prevHash = this.getEntityHash(currentTree, entity.type, entity.id);
      this.deleteEntityHash(newTree, entity.type, entity.id);
      versionChanges.deleted.push({
        type: entity.type,
        id: entity.id,
        hash: '',
        prevHash,
      });
    }

    // Store new tree
    const newTreeHash = await this.storeTree(graphId, newTree);

    // Create version ref
    const versionRef: VersionRef = {
      graphId,
      version: newVersion,
      timestamp: new Date().toISOString(),
      parentVersion: latestVersion?.version ?? null,
      operation,
      description,
      userId,
      changes: versionChanges,
      treeHash: newTreeHash,
    };

    if (mergeParent) {
      versionRef.mergeParent = mergeParent;
    }

    // Store version ref
    await this.storeVersionRef(graphId, versionRef);

    // Update current tree pointer
    await this.setCurrentTree(graphId, newTreeHash);

    // Check if we should pack old versions
    if (newVersion > 0 && newVersion % this.packThreshold === 0) {
      await this.packVersions(graphId, 0, newVersion - this.packThreshold);
    }

    return versionRef;
  }

  /**
   * Checkout a specific version
   */
  async checkout(graphId: string, version: number): Promise<ResolvedGraphData> {
    const versionRef = await this.getVersionRef(graphId, version);
    if (!versionRef) {
      throw new Error(`Version ${version} not found for graph ${graphId}`);
    }

    const tree = await this.getTree(graphId, versionRef.treeHash);
    return this.resolveTree(graphId, tree);
  }

  /**
   * Get the latest version for a graph
   */
  async getLatestVersion(graphId: string): Promise<VersionRef | null> {
    const versionsDir = path.join(this.getGraphDir(graphId), 'versions');
    
    try {
      const files = await fs.promises.readdir(versionsDir);
      const versionNumbers = files
        .filter(f => f.endsWith('.json'))
        .map(f => parseInt(f.replace('.json', ''), 10))
        .filter(n => !isNaN(n))
        .sort((a, b) => b - a);

      if (versionNumbers.length === 0) {
        return null;
      }

      return this.getVersionRef(graphId, versionNumbers[0]);
    } catch (error) {
      return null;
    }
  }

  /**
   * Get version history for a graph
   */
  async getVersionHistory(
    graphId: string,
    limit = 50,
    offset = 0
  ): Promise<{ versions: VersionRef[]; total: number }> {
    const versionsDir = path.join(this.getGraphDir(graphId), 'versions');
    
    try {
      const files = await fs.promises.readdir(versionsDir);
      const versionNumbers = files
        .filter(f => f.endsWith('.json'))
        .map(f => parseInt(f.replace('.json', ''), 10))
        .filter(n => !isNaN(n))
        .sort((a, b) => b - a);

      const total = versionNumbers.length;
      const paginated = versionNumbers.slice(offset, offset + limit);

      const versions: VersionRef[] = [];
      for (const vNum of paginated) {
        const vRef = await this.getVersionRef(graphId, vNum);
        if (vRef) {
          versions.push(vRef);
        }
      }

      return { versions, total };
    } catch (error) {
      return { versions: [], total: 0 };
    }
  }

  /**
   * Get a specific version ref
   */
  async getVersionRef(graphId: string, version: number): Promise<VersionRef | null> {
    const versionPath = path.join(
      this.getGraphDir(graphId),
      'versions',
      `${version}.json`
    );

    try {
      const content = await fs.promises.readFile(versionPath, 'utf-8');
      return JSON.parse(content) as VersionRef;
    } catch (error) {
      // Check pack files
      return this.getVersionFromPacks(graphId, version);
    }
  }

  /**
   * Rollback to a specific version
   */
  async rollback(
    graphId: string,
    targetVersion: number,
    userId?: string
  ): Promise<VersionRef> {
    const targetVersionRef = await this.getVersionRef(graphId, targetVersion);
    if (!targetVersionRef) {
      throw new Error(`Version ${targetVersion} not found`);
    }

    const currentTree = await this.getCurrentTree(graphId);
    const targetTree = await this.getTree(graphId, targetVersionRef.treeHash);

    // Calculate what changed
    const currentData = currentTree 
      ? await this.resolveTree(graphId, await this.getTree(graphId, currentTree))
      : { events: {}, arcs: {}, relationships: {}, pressures: {} };
    const targetData = await this.resolveTree(graphId, targetTree);

    const changes = this.calculateDiff(currentData, targetData);

    return this.commit(
      graphId,
      changes,
      'rollback',
      `Rollback to version ${targetVersion}`,
      userId
    );
  }

  /**
   * Store a content-addressable object
   */
  async storeObject(graphId: string, obj: ContentObject): Promise<string> {
    const content = JSON.stringify(obj);
    const hash = this.computeHash(content);
    const objectPath = this.getObjectPath(graphId, hash);

    // Check if already exists (deduplication)
    try {
      await fs.promises.access(objectPath);
      return hash; // Already exists
    } catch {
      // Doesn't exist, create it
      await fs.promises.writeFile(objectPath, content, 'utf-8');
      return hash;
    }
  }

  /**
   * Get an object by hash
   */
  async getObject(graphId: string, hash: string): Promise<ContentObject | null> {
    const objectPath = this.getObjectPath(graphId, hash);

    try {
      const content = await fs.promises.readFile(objectPath, 'utf-8');
      return JSON.parse(content) as ContentObject;
    } catch {
      // Check pack files
      return this.getObjectFromPacks(graphId, hash);
    }
  }

  /**
   * Store a tree object
   */
  async storeTree(graphId: string, tree: TreeObject): Promise<string> {
    const content = JSON.stringify(tree);
    const hash = this.computeHash(content);
    const objectPath = this.getObjectPath(graphId, hash);

    try {
      await fs.promises.access(objectPath);
      return hash;
    } catch {
      await fs.promises.writeFile(objectPath, content, 'utf-8');
      return hash;
    }
  }

  /**
   * Get a tree object by hash
   */
  async getTree(graphId: string, hash: string): Promise<TreeObject> {
    const objectPath = this.getObjectPath(graphId, hash);

    try {
      const content = await fs.promises.readFile(objectPath, 'utf-8');
      return JSON.parse(content) as TreeObject;
    } catch {
      // Check pack files
      const fromPack = await this.getTreeFromPacks(graphId, hash);
      if (fromPack) return fromPack;
      throw new Error(`Tree not found: ${hash}`);
    }
  }

  /**
   * Resolve a tree to full graph data
   */
  async resolveTree(graphId: string, tree: TreeObject): Promise<ResolvedGraphData> {
    const result: ResolvedGraphData = {
      events: {},
      arcs: {},
      relationships: {},
      pressures: {},
    };

    // Resolve each entity type
    for (const [id, hash] of Object.entries(tree.events) as [string, string][]) {
      const obj = await this.getObject(graphId, hash);
      if (obj) result.events[id] = obj.data;
    }

    for (const [id, hash] of Object.entries(tree.arcs) as [string, string][]) {
      const obj = await this.getObject(graphId, hash);
      if (obj) result.arcs[id] = obj.data;
    }

    for (const [id, hash] of Object.entries(tree.relationships) as [string, string][]) {
      const obj = await this.getObject(graphId, hash);
      if (obj) result.relationships[id] = obj.data;
    }

    for (const [id, hash] of Object.entries(tree.pressures) as [string, string][]) {
      const obj = await this.getObject(graphId, hash);
      if (obj) result.pressures[id] = obj.data;
    }

    return result;
  }

  /**
   * Pack old versions to save space
   */
  async packVersions(graphId: string, startVersion: number, endVersion: number): Promise<void> {
    const versionsTopack: VersionRef[] = [];
    const objectsToInclude: Record<string, ContentObject> = {};
    const treesToInclude: Record<string, TreeObject> = {};

    // Collect versions and their objects
    for (let v = startVersion; v <= endVersion; v++) {
      const vRef = await this.getVersionRef(graphId, v);
      if (vRef) {
        versionsTopack.push(vRef);

        // Collect tree for this version
        try {
          const tree = await this.getTree(graphId, vRef.treeHash);
          treesToInclude[vRef.treeHash] = tree;
        } catch {
          // Tree may already be in a pack
        }

        // Collect objects referenced by this version
        for (const change of [...vRef.changes.added, ...vRef.changes.modified]) {
          const obj = await this.getObject(graphId, change.hash);
          if (obj) {
            objectsToInclude[change.hash] = obj;
          }
        }
      }
    }

    if (versionsTopack.length === 0) return;

    // Create pack file
    const packFile: PackFile = {
      id: `pack_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      createdAt: new Date().toISOString(),
      versionRange: { start: startVersion, end: endVersion },
      objects: objectsToInclude,
      trees: treesToInclude,
      versions: versionsTopack,
    };

    // Write pack file
    const packPath = path.join(
      this.getGraphDir(graphId),
      'packs',
      `${packFile.id}.json`
    );
    await fs.promises.writeFile(packPath, JSON.stringify(packFile), 'utf-8');

    // Remove individual version files
    for (let v = startVersion; v <= endVersion; v++) {
      const versionPath = path.join(
        this.getGraphDir(graphId),
        'versions',
        `${v}.json`
      );
      try {
        await fs.promises.unlink(versionPath);
      } catch {
        // Ignore if already removed
      }
    }

    // Note: We don't remove objects as they might be referenced by newer versions
    // A full garbage collection would be needed to safely remove unreferenced objects
  }

  /**
   * Garbage collect unreferenced objects
   */
  async gc(graphId: string): Promise<{ removedObjects: number; freedBytes: number }> {
    const referencedHashes = new Set<string>();

    // Collect all referenced hashes from versions
    const { versions } = await this.getVersionHistory(graphId, 10000, 0);
    for (const version of versions) {
      referencedHashes.add(version.treeHash);
      for (const change of [...version.changes.added, ...version.changes.modified]) {
        referencedHashes.add(change.hash);
      }
    }

    // Collect from pack files
    const packsDir = path.join(this.getGraphDir(graphId), 'packs');
    try {
      const packFiles = await fs.promises.readdir(packsDir);
      for (const packFile of packFiles) {
        const packPath = path.join(packsDir, packFile);
        const content = await fs.promises.readFile(packPath, 'utf-8');
        const pack = JSON.parse(content) as PackFile;
        
        for (const hash of Object.keys(pack.objects)) {
          referencedHashes.add(hash);
        }
        for (const version of pack.versions) {
          referencedHashes.add(version.treeHash);
        }
      }
    } catch {
      // Packs dir might not exist
    }

    // Remove unreferenced objects
    const objectsDir = path.join(this.getGraphDir(graphId), 'objects');
    let removedObjects = 0;
    let freedBytes = 0;

    try {
      const objectFiles = await fs.promises.readdir(objectsDir);
      for (const objectFile of objectFiles) {
        const hash = objectFile.replace('.json', '');
        if (!referencedHashes.has(hash)) {
          const objectPath = path.join(objectsDir, objectFile);
          const stats = await fs.promises.stat(objectPath);
          freedBytes += stats.size;
          await fs.promises.unlink(objectPath);
          removedObjects++;
        }
      }
    } catch {
      // Objects dir might not exist
    }

    return { removedObjects, freedBytes };
  }

  /**
   * Delete all data for a graph
   */
  async deleteGraph(graphId: string): Promise<void> {
    const graphDir = this.getGraphDir(graphId);
    await fs.promises.rm(graphDir, { recursive: true, force: true });
  }

  // Private helper methods

  private getGraphDir(graphId: string): string {
    return path.join(this.dataDir, 'graphs', graphId);
  }

  private getObjectPath(graphId: string, hash: string): string {
    return path.join(this.getGraphDir(graphId), 'objects', `${hash}.json`);
  }

  private computeHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  private async getCurrentTree(graphId: string): Promise<string | null> {
    const currentPath = path.join(this.getGraphDir(graphId), 'current.json');
    try {
      const content = await fs.promises.readFile(currentPath, 'utf-8');
      const data = JSON.parse(content);
      return data.treeHash;
    } catch {
      return null;
    }
  }

  private async setCurrentTree(graphId: string, treeHash: string): Promise<void> {
    const currentPath = path.join(this.getGraphDir(graphId), 'current.json');
    await fs.promises.writeFile(
      currentPath,
      JSON.stringify({ treeHash, updatedAt: new Date().toISOString() }),
      'utf-8'
    );
  }

  private async storeVersionRef(graphId: string, versionRef: VersionRef): Promise<void> {
    const versionPath = path.join(
      this.getGraphDir(graphId),
      'versions',
      `${versionRef.version}.json`
    );
    await fs.promises.writeFile(versionPath, JSON.stringify(versionRef), 'utf-8');
  }

  private getEntityHash(tree: TreeObject, type: EntityType, id: string): string | undefined {
    switch (type) {
      case 'event': return tree.events[id];
      case 'arc': return tree.arcs[id];
      case 'relationship': return tree.relationships[id];
      case 'pressure': return tree.pressures[id];
    }
  }

  private setEntityHash(tree: TreeObject, type: EntityType, id: string, hash: string): void {
    switch (type) {
      case 'event': tree.events[id] = hash; break;
      case 'arc': tree.arcs[id] = hash; break;
      case 'relationship': tree.relationships[id] = hash; break;
      case 'pressure': tree.pressures[id] = hash; break;
    }
  }

  private deleteEntityHash(tree: TreeObject, type: EntityType, id: string): void {
    switch (type) {
      case 'event': delete tree.events[id]; break;
      case 'arc': delete tree.arcs[id]; break;
      case 'relationship': delete tree.relationships[id]; break;
      case 'pressure': delete tree.pressures[id]; break;
    }
  }

  private async getVersionFromPacks(graphId: string, version: number): Promise<VersionRef | null> {
    const packsDir = path.join(this.getGraphDir(graphId), 'packs');
    
    try {
      const packFiles = await fs.promises.readdir(packsDir);
      for (const packFile of packFiles) {
        const packPath = path.join(packsDir, packFile);
        const content = await fs.promises.readFile(packPath, 'utf-8');
        const pack = JSON.parse(content) as PackFile;
        
        if (version >= pack.versionRange.start && version <= pack.versionRange.end) {
          return pack.versions.find(v => v.version === version) || null;
        }
      }
    } catch {
      // Packs dir might not exist
    }
    
    return null;
  }

  private async getObjectFromPacks(graphId: string, hash: string): Promise<ContentObject | null> {
    const packsDir = path.join(this.getGraphDir(graphId), 'packs');
    
    try {
      const packFiles = await fs.promises.readdir(packsDir);
      for (const packFile of packFiles) {
        const packPath = path.join(packsDir, packFile);
        const content = await fs.promises.readFile(packPath, 'utf-8');
        const pack = JSON.parse(content) as PackFile;
        
        if (pack.objects[hash]) {
          return pack.objects[hash];
        }
      }
    } catch {
      // Packs dir might not exist
    }
    
    return null;
  }

  private async getTreeFromPacks(graphId: string, hash: string): Promise<TreeObject | null> {
    const packsDir = path.join(this.getGraphDir(graphId), 'packs');
    
    try {
      const packFiles = await fs.promises.readdir(packsDir);
      for (const packFile of packFiles) {
        const packPath = path.join(packsDir, packFile);
        const content = await fs.promises.readFile(packPath, 'utf-8');
        const pack = JSON.parse(content) as PackFile;
        
        // Check the trees storage (new format)
        if (pack.trees && pack.trees[hash]) {
          return pack.trees[hash];
        }
      }
    } catch {
      // Packs dir might not exist
    }
    
    return null;
  }

  private calculateDiff(
    current: ResolvedGraphData,
    target: ResolvedGraphData
  ): EntityChanges {
    const changes: EntityChanges = {
      added: [],
      modified: [],
      deleted: [],
    };

    // Helper to process each entity type
    const processType = (
      type: EntityType,
      currentEntities: Record<string, Record<string, unknown>>,
      targetEntities: Record<string, Record<string, unknown>>
    ) => {
      // Find added and modified
      for (const [id, data] of Object.entries(targetEntities)) {
        if (!currentEntities[id]) {
          changes.added.push({ type, id, data });
        } else if (JSON.stringify(currentEntities[id]) !== JSON.stringify(data)) {
          changes.modified.push({ type, id, data });
        }
      }

      // Find deleted
      for (const id of Object.keys(currentEntities)) {
        if (!targetEntities[id]) {
          changes.deleted.push({ type, id });
        }
      }
    };

    processType('event', current.events, target.events);
    processType('arc', current.arcs, target.arcs);
    processType('relationship', current.relationships, target.relationships);
    processType('pressure', current.pressures, target.pressures);

    return changes;
  }
}
