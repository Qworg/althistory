/**
 * Graph model for multi-graph management with Git-like versioning
 */

/**
 * Represents a historical graph containing events, arcs, and relationships
 */
export interface IGraph {
  /** Unique identifier for the graph */
  id: string;
  /** Human-readable name */
  name: string;
  /** Optional description */
  description?: string;
  /** When the graph was created */
  createdAt: string;
  /** When the graph was last modified */
  updatedAt: string;
  /** Current version number (incremented on each change) */
  version: number;
  /** Parent graph ID if this is a branch */
  parentGraphId?: string;
  /** Version number of parent when branched */
  branchPoint?: number;
  /** Graph status */
  status: GraphStatus;
  /** Computed metadata */
  metadata: GraphMetadata;
}

export type GraphStatus = 'active' | 'archived' | 'deleted';

export interface GraphMetadata {
  eventCount: number;
  arcCount: number;
  relationshipCount: number;
  pressureCount: number;
  temporalRange?: {
    start: string;
    end: string;
  };
  actors?: string[];
}

/**
 * Graph class with validation and utility methods
 */
export class Graph implements IGraph {
  public readonly id: string;
  public readonly name: string;
  public readonly description?: string;
  public readonly createdAt: string;
  public readonly updatedAt: string;
  public readonly version: number;
  public readonly parentGraphId?: string;
  public readonly branchPoint?: number;
  public readonly status: GraphStatus;
  public readonly metadata: GraphMetadata;

  constructor(data: CreateGraphData & { id?: string }) {
    this.id = data.id || this.generateId();
    
    const validation = Graph.validate(data);
    if (!validation.isValid) {
      throw new Error(`Graph validation failed: ${validation.errors.join(', ')}`);
    }

    this.name = data.name.trim();
    this.description = data.description?.trim();
    this.createdAt = data.createdAt || new Date().toISOString();
    this.updatedAt = data.updatedAt || this.createdAt;
    this.version = data.version ?? 0;
    this.parentGraphId = data.parentGraphId;
    this.branchPoint = data.branchPoint;
    this.status = data.status || 'active';
    this.metadata = data.metadata || {
      eventCount: 0,
      arcCount: 0,
      relationshipCount: 0,
      pressureCount: 0,
    };
  }

  /**
   * Validates graph data
   */
  static validate(data: Partial<CreateGraphData>): GraphValidationResult {
    const errors: string[] = [];

    if (!data.name || typeof data.name !== 'string' || data.name.trim().length === 0) {
      errors.push('Name is required and must be a non-empty string');
    }

    if (data.name && data.name.length > 255) {
      errors.push('Name must be 255 characters or less');
    }

    if (data.description && data.description.length > 2000) {
      errors.push('Description must be 2000 characters or less');
    }

    if (data.status && !['active', 'archived', 'deleted'].includes(data.status)) {
      errors.push('Status must be active, archived, or deleted');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Creates a copy with updated properties
   */
  update(updates: UpdateGraphData): Graph {
    return new Graph({
      id: this.id,
      name: updates.name ?? this.name,
      description: updates.description ?? this.description,
      createdAt: this.createdAt,
      updatedAt: new Date().toISOString(),
      version: this.version + 1,
      parentGraphId: this.parentGraphId,
      branchPoint: this.branchPoint,
      status: updates.status ?? this.status,
      metadata: updates.metadata ?? this.metadata,
    });
  }

  /**
   * Creates a branch of this graph
   */
  branch(name: string, description?: string): Graph {
    return new Graph({
      name,
      description,
      parentGraphId: this.id,
      branchPoint: this.version,
      status: 'active',
      metadata: { ...this.metadata },
    });
  }

  /**
   * Converts to plain object
   */
  toJSON(): IGraph {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      version: this.version,
      parentGraphId: this.parentGraphId,
      branchPoint: this.branchPoint,
      status: this.status,
      metadata: this.metadata,
    };
  }

  private generateId(): string {
    return `graph_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}

export interface CreateGraphData {
  name: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
  version?: number;
  parentGraphId?: string;
  branchPoint?: number;
  status?: GraphStatus;
  metadata?: GraphMetadata;
}

export interface UpdateGraphData {
  name?: string;
  description?: string;
  status?: GraphStatus;
  metadata?: GraphMetadata;
}

export interface GraphValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Request/Response types for API
 */
export interface CreateGraphRequest {
  name: string;
  description?: string;
}

export interface UpdateGraphRequest {
  name?: string;
  description?: string;
  status?: 'active' | 'archived';
}

export interface BranchGraphRequest {
  name: string;
  description?: string;
}

export interface MergeGraphRequest {
  sourceGraphId: string;
  /**
   * How to reconcile entities that differ in both graphs. The HTTP route
   * requires this field; it is optional in the service contract so that a
   * caller who omits it gets a defined outcome rather than an undefined one:
   * a merge with conflicts is refused (`success: false` plus the conflict
   * list), a merge with no conflicts proceeds (there is nothing to resolve).
   */
  conflictResolution?: 'keep-target' | 'keep-source' | 'manual';
  manualResolutions?: Record<string, 'keep-target' | 'keep-source'>;
}

/**
 * Cross-graph reference types
 */
export interface EntityRef {
  graphId: string;
  entityType: 'event' | 'arc';
  entityId: string;
}

export interface CrossGraphCausalRelationship {
  id: string;
  causeRef: EntityRef | string;
  effectRef: EntityRef | string;
  weight: number;
  evidence: string;
  confidence: number;
  relationship_type: 'direct' | 'indirect' | 'contributory';
  isCrossGraph: boolean;
}

export interface ReferenceNotification {
  id: string;
  type: 'entity_modified' | 'entity_deleted' | 'graph_deleted';
  sourceGraphId: string;
  targetGraphId: string;
  entityId: string;
  entityType: EntityType | 'event' | 'arc';
  message: string;
  timestamp: string;
  acknowledged: boolean;
}

/**
 * Git-like versioning types
 */
export type EntityType = 'event' | 'arc' | 'relationship' | 'pressure';

export interface ContentObject {
  type: EntityType;
  data: Record<string, unknown>;
}

export interface TreeObject {
  events: Record<string, string>;
  arcs: Record<string, string>;
  relationships: Record<string, string>;
  pressures: Record<string, string>;
}

export type VersionOperation = 
  | 'create'
  | 'update'
  | 'delete'
  | 'import'
  | 'merge'
  | 'branch'
  | 'rollback';

export interface VersionChange {
  type: EntityType;
  id: string;
  hash: string;
  prevHash?: string;
}

/**
 * A parent of a merge commit that lives in another graph.
 *
 * Version numbers are allocated per graph, so a bare number does not identify a
 * version: the graph id is part of the identity. The merge target's own
 * predecessor is already `VersionRef.parentVersion`; `VersionRef.mergeParent`
 * names the source graph's head version that was merged in.
 */
export interface MergeParent {
  graphId: string;
  version: number | null;
}

export interface VersionRef {
  graphId: string;
  version: number;
  timestamp: string;
  parentVersion: number | null;
  /**
   * Set only on merge commits, where `parentVersion` is the first parent (the
   * merge target's head at merge time) and this is the second parent (the
   * source graph's head). Absent on every single-parent commit, so existing
   * version records keep their exact shape.
   */
  mergeParent?: MergeParent;
  operation: VersionOperation;
  description?: string;
  userId?: string;
  changes: {
    added: VersionChange[];
    modified: VersionChange[];
    deleted: VersionChange[];
  };
  treeHash: string;
}

export interface PackFile {
  id: string;
  createdAt: string;
  versionRange: {
    start: number;
    end: number;
  };
  objects: Record<string, ContentObject>;
  trees: Record<string, TreeObject>;
  versions: VersionRef[];
}

/**
 * Merge conflict types
 */
export interface MergeConflict {
  entityType: EntityType;
  entityId: string;
  sourceVersion: Record<string, unknown>;
  targetVersion: Record<string, unknown>;
  baseVersion?: Record<string, unknown>;
  suggestedResolution: 'keep-source' | 'keep-target';
}

export interface MergeResult {
  success: boolean;
  /**
   * The conflicts found between the two graphs. Present on failure (the caller
   * must resolve them) and on success (the conflicts the strategy resolved).
   */
  conflicts?: MergeConflict[];
  mergedGraph?: IGraph;
  newVersion?: number;
}
