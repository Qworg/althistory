/**
 * Export Service for generating Althistory export files
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { GraphRepository } from '../repositories/GraphRepository';
import { ResolvedGraphData } from '../repositories/VersionRepository';
import { ExportFilters } from '../models/AsyncJob';
import { NotFoundError } from '../utils/errors';
import { createLogger, ILogger } from '../utils/logger';
import { assertSafeGraphId } from '../utils/GraphContextStore';

/**
 * Althistory Export Format v1.0
 */
export interface AlthistoryExport {
  version: '1.0';
  metadata: ExportMetadata;
  data: ExportData;
  provenance?: ExportProvenance;
}

export interface ExportMetadata {
  graphId: string;
  graphName: string;
  description?: string;
  exportedAt: string;
  sourceVersion: string;
  graphVersion: number;
  checksum: string;
  filters?: ExportFilters;
}

export interface ExportData {
  events: ExportedEvent[];
  arcs: ExportedArc[];
  causalRelationships: ExportedRelationship[];
  inferredPressures: ExportedPressure[];
  crossGraphRefs?: CrossGraphRef[];
}

export interface ExportedEvent {
  id: string;
  description: string;
  actor: string;
  target: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
  sourceRef?: string;
}

export interface ExportedArc {
  id: string;
  name: string;
  description: string;
  start_time: string;
  end_time: string;
  level: number;
  parent_arc_id: string | null;
  metadata?: Record<string, unknown>;
  sourceRef?: string;
}

export interface ExportedRelationship {
  id: string;
  cause_event_id: string;
  effect_event_id: string;
  weight: number;
  evidence: string;
  confidence: number;
  relationship_type: 'direct' | 'indirect' | 'contributory';
  sourceRef?: string;
  causeGraphId?: string;
  effectGraphId?: string;
}

export interface ExportedPressure {
  id: string;
  description: string;
  confidence_score: number;
  pressure_type: 'economic' | 'social' | 'environmental' | 'political';
  evidence_event_ids: string[];
  affected_arc_ids: string[];
}

/**
 * Why an embedded payload is present or absent.
 *
 * `embedded` -- the payload is in `embeddedEntity`.
 * `forbidden` -- the caller may not read the referenced graph, so the payload
 *   was withheld.
 * `missing` -- the referenced entity does not exist (its graph was deleted, or
 *   the entity was).
 */
export type EmbeddedEntityStatus =
  | 'embedded'
  | 'forbidden'
  | 'missing'
  /** The referenced graph exists but could not be read. */
  | 'unreadable'
  /** Too many referenced graphs to embed; nothing was embedded. */
  | 'too-many';

export interface CrossGraphRef {
  localEntityId: string;
  localEntityType: 'event' | 'arc' | 'relationship';
  referencedGraphId: string;
  referencedEntityId: string;
  referencedEntityType: 'event' | 'arc';
  embeddedEntity?: ExportedEvent | ExportedArc;
  /**
   * Present only when the export asked for embedding. Its absence with no
   * `embeddedEntity` means the export did not ask, or nothing referenced
   * another graph.
   */
  embeddedEntityStatus?: EmbeddedEntityStatus;
}

export interface ExportProvenance {
  sources: DataSource[];
  importHistory: ImportRecord[];
}

export interface DataSource {
  id: string;
  type: 'wikipedia' | 'wikidata' | 'manual' | 'import' | 'llm-generated' | 'text-extraction';
  url?: string;
  accessedAt?: string;
  confidence: number;
  entityIds: string[];
}

export interface ImportRecord {
  id: string;
  importedAt: string;
  sourceFile?: string;
  entityCount: number;
  userId?: string;
}

export interface ExportOptions {
  graphId: string;
  scope: 'full' | 'filtered';
  filters?: ExportFilters;
  includeProvenance: boolean;
  version?: number;
  /**
   * Embed the entity each cross-graph reference points at (Req 4.4).
   *
   * Off by default: embedding copies another graph's data into the file the
   * caller downloads, so it has to be asked for deliberately.
   */
  embedReferences?: boolean;
  /**
   * Whether the caller may read a graph, used to decide whether a reference
   * may carry its embedded entity.
   *
   * A reference to a graph the caller may not read is still reported -- the
   * reference metadata is part of the export either way -- but its payload is
   * withheld. Absent means "no opinion", which withholds the payload as well:
   * an export that embeds by default would leak any graph it can name.
   */
  canReadGraph?: (graphId: string) => boolean;
}

export interface ExportResult {
  export: AlthistoryExport;
  size: number;
  /** Entities written to `data` (events + arcs + relationships + pressures). */
  entityCount: number;
}

/**
 * Optional hooks for a streaming export.
 *
 * A streamed export serialises the data section twice: once to hash it (the
 * checksum belongs in `metadata`, which precedes `data`) and once to write it.
 * `onPhase` announces which pass is running so a caller can say so, and
 * `onProgress` reports a fraction in [0, 1] within the writing pass, after
 * every entity. Both passes are proportional to the graph, so neither alone
 * describes the whole run.
 */
export interface ExportHooks {
  onPhase?: (phase: 'hashing' | 'writing') => void;
  onProgress?: (fraction: number) => void;
}

export interface ExportServiceConfig {
  dataDir: string;
  appVersion?: string;
  /**
   * Entity count above which an export must run as an async job instead of an
   * in-memory response (Req 5.4). Defaults to
   * `DEFAULT_ASYNC_EXPORT_ENTITY_THRESHOLD`.
   */
  asyncExportThreshold?: number;
  /**
   * Byte estimate above which `exportGraph` refuses to build the document in
   * memory. Only the in-memory API is bounded by it; `exportToFile` streams.
   * Defaults to 50 MB; tests lower it to exercise the boundary.
   */
  maxInMemorySize?: number;
}

/**
 * How many distinct graphs one export may embed from.
 *
 * The number of references is not bounded by the entity count: one event's
 * metadata can name any number of graphs. Each one costs a checkout, so the
 * count is capped rather than left to the caller.
 */
const MAX_EMBEDDED_GRAPHS = 50;

/**
 * How many references one export may embed, in total.
 *
 * The graph cap alone does not bound the work: one graph can be named by ten
 * thousand references.
 */
const MAX_EMBEDDED_REFS = 1000;

/**
 * How many bytes of embedded payload one export may carry.
 *
 * The payloads are copies of other graphs' entities, and they are serialised
 * into the document twice (once to hash it, once to write it), so their size
 * has to be bounded as well as their number.
 */
const MAX_EMBEDDED_BYTES = 5 * 1024 * 1024;

// Maximum size for in-memory exports (50MB)
const MAX_IN_MEMORY_EXPORT_SIZE = 50 * 1024 * 1024;

/**
 * Req 5.4: "WHEN exporting a large graph (>10k entities) THEN the system SHALL
 * create an async job with progress tracking."
 *
 * This is an entity count, not a byte estimate. A graph can be large in
 * entities while still serialising to a modest file, and the synchronous
 * endpoints are bounded by how much work they do, not only by response size.
 */
const DEFAULT_ASYNC_EXPORT_ENTITY_THRESHOLD = 10_000;

/**
 * Service for exporting graph data
 */
export class ExportService {
  private readonly graphRepository: GraphRepository;
  private readonly dataDir: string;
  private readonly appVersion: string;
  private readonly logger: ILogger;
  /** Ceiling for `exportGraph`; readable so callers can describe the limit. */
  readonly maxInMemorySize: number;
  /** Entity count above which an export must run as an async job (Req 5.4). */
  readonly asyncExportThreshold: number;

  constructor(config: ExportServiceConfig) {
    this.dataDir = config.dataDir;
    this.appVersion = config.appVersion || '1.0.0';
    this.graphRepository = new GraphRepository({ dataDir: config.dataDir });
    this.maxInMemorySize = config.maxInMemorySize ?? MAX_IN_MEMORY_EXPORT_SIZE;
    this.logger = createLogger('ExportService');
    this.asyncExportThreshold =
      config.asyncExportThreshold ?? DEFAULT_ASYNC_EXPORT_ENTITY_THRESHOLD;
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    await this.graphRepository.initialize();
    
    // Ensure exports directory exists
    const exportsDir = path.join(this.dataDir, 'exports');
    await fs.promises.mkdir(exportsDir, { recursive: true });
  }

  /**
   * Export a graph to the Althistory format
   */
  async exportGraph(options: ExportOptions): Promise<ExportResult> {
    // Get graph metadata
    const graph = await this.graphRepository.findById(options.graphId);
    if (!graph) {
      throw new Error(`Graph not found: ${options.graphId}`);
    }

    // Resolve the version before reading anything: a pinned version that does
    // not exist is a client error, not whatever the version store throws, and
    // `graphVersion` must name the version the data actually came from.
    // `graph.version` is a metadata counter that also advances on metadata-only
    // updates (see `GraphRepository`), so it is not the numbering `?version=`
    // accepts.
    const versionRef = await this.resolveVersionRef(options);

    const isFiltered = options.scope === 'filtered' && options.filters !== undefined;

    let data: ResolvedGraphData;
    let scoped: ResolvedGraphData;
    let estimatedSize: number;

    if (options.version !== undefined || isFiltered) {
      // Both cases have to read the tree before it can be measured: a pinned
      // version is not described by the metadata's counts, and filters change
      // which entities survive. Reading is unavoidable -- `checkout` loads the
      // tree either way -- while the guard exists to stop this method building
      // the *document*, which is the allocation on top of the tree.
      data = await this.graphRepository.checkout(
        options.graphId,
        versionRef?.version ?? options.version
      );
      scoped = isFiltered ? this.applyFilters(data, options.filters!) : data;
      estimatedSize = this.estimateExportSizeFromData(scoped);
    } else {
      // An unfiltered latest-version estimate comes from `graph.metadata`, so
      // the guard runs before the tree is loaded.
      estimatedSize = await this.estimateExportSize(options);
      data = await this.graphRepository.checkout(options.graphId, versionRef?.version);
      scoped = data;
    }

    if (estimatedSize > this.maxInMemorySize) {
      throw new Error(
        `Export too large for in-memory operation (estimated ${Math.round(estimatedSize / 1024 / 1024)}MB, max ${Math.round(this.maxInMemorySize / 1024 / 1024)}MB). ` +
          'This method returns the whole document as an object. ' +
          'Use GET /export, POST /export/jobs or exportToFile(), which stream to a file.'
      );
    }

    // Convert to export format
    const exportData = this.convertToExportFormat(scoped);

    // Req 4.4: embed the referenced entity when the caller asked for it and
    // may read the graph it lives in.
    if (options.embedReferences && exportData.crossGraphRefs) {
      await this.embedReferencedEntities(exportData.crossGraphRefs, options);
    }

    // Build export object (without checksum first)
    const exportObj: AlthistoryExport = {
      version: '1.0',
      metadata: {
        graphId: graph.id,
        graphName: graph.name,
        description: graph.description,
        exportedAt: new Date().toISOString(),
        sourceVersion: this.appVersion,
        graphVersion: versionRef?.version ?? 0,
        checksum: '', // Will be calculated
        filters: options.scope === 'filtered' ? options.filters : undefined,
      },
      data: exportData,
    };

    // Add provenance if requested
    if (options.includeProvenance) {
      exportObj.provenance = await this.getProvenance(options.graphId);
    }

    // Calculate checksum of data section
    const dataString = JSON.stringify(exportObj.data);
    exportObj.metadata.checksum = this.calculateChecksum(dataString);

    // Calculate size
    const exportString = JSON.stringify(exportObj);
    const size = Buffer.byteLength(exportString, 'utf8');

    return {
      export: exportObj,
      size,
      entityCount: this.countExportDataEntities(exportData),
    };
  }

  /**
   * The committed version an export is built from: the pinned one, or the head.
   * Absent history yields `null` (an empty graph), which callers label as 0.
   */
  private async resolveVersionRef(options: ExportOptions) {
    if (options.version === undefined) {
      return this.graphRepository.getLatestVersion(options.graphId);
    }

    const versionRef = await this.graphRepository.getVersion(options.graphId, options.version);
    if (!versionRef) {
      throw new NotFoundError(
        `Graph version ${options.version} not found`,
        'GraphVersion',
        `${options.graphId}@${options.version}`
      );
    }

    return versionRef;
  }

  /**
   * Count the entities an export would contain, without serialising it.
   *
   * Used to decide whether Req 5.4 requires an async job. For an unfiltered
   * export of the latest version the count comes from `graph.metadata`, which
   * `GraphRepository.commitChanges` recomputes on every commit, so the decision
   * does not load the whole graph. A filtered or pinned-version export falls
   * back to loading that exact tree, because neither the metadata counts nor
   * the filter predicates can be evaluated without it.
   */
  async countEntities(options: ExportOptions): Promise<number> {
    const useMetadata =
      options.version === undefined &&
      !(options.scope === 'filtered' && options.filters !== undefined);

    if (useMetadata) {
      const graph = await this.graphRepository.findById(options.graphId);
      if (!graph) {
        throw new Error(`Graph not found: ${options.graphId}`);
      }

      const { eventCount, arcCount, relationshipCount, pressureCount } = graph.metadata;
      return eventCount + arcCount + relationshipCount + pressureCount;
    }

    // A pinned version that does not exist is a 404, not a 500 from the
    // version store's own throw.
    if (options.version !== undefined) {
      await this.resolveVersionRef(options);
    }

    const data = await this.graphRepository.checkout(options.graphId, options.version);
    const scoped =
      options.scope === 'filtered' && options.filters
        ? this.applyFilters(data, options.filters)
        : data;

    return (
      Object.keys(scoped.events).length +
      Object.keys(scoped.arcs).length +
      Object.keys(scoped.relationships).length +
      Object.keys(scoped.pressures).length
    );
  }

  /**
   * Apply the Req 5.4 async rule: more than `asyncExportThreshold` entities
   * must become a job rather than an in-memory response.
   */
  async shouldUseAsyncExport(
    options: ExportOptions
  ): Promise<{ entityCount: number; useAsync: boolean }> {
    const entityCount = await this.countEntities(options);
    return { entityCount, useAsync: entityCount > this.asyncExportThreshold };
  }

  /**
   * Export and save to file, streaming the document.
   *
   * This is the path an async export job takes, and the one Req 5.4 requires for
   * large graphs. It deliberately does **not** call `exportGraph`: that method
   * applies the `maxInMemorySize` guard, which exists because it returns the
   * whole document as an object. Reporting a graph as "too large to export in
   * memory, use the async job" and then failing the async job with the same
   * message made the advice impossible to follow.
   *
   * Peak memory here is the resolved graph plus one serialised entity. The data
   * section is serialised twice -- once to hash it, once to write it -- because
   * the checksum has to appear in `metadata`, which precedes `data` in the
   * document. Each pass is generated, not buffered.
   *
   * The file is compact JSON rather than the indented output the in-memory path
   * produced via `JSON.stringify(doc, null, 2)`; nothing reads it by eye, and
   * the indented form would have to be reproduced string-for-string to keep the
   * checksum identical.
   */
  async exportToFile(
    options: ExportOptions,
    outputPath?: string,
    hooks: ExportHooks = {}
  ): Promise<string> {
    const graph = await this.graphRepository.findById(options.graphId);
    if (!graph) {
      throw new Error(`Graph not found: ${options.graphId}`);
    }

    const versionRef = await this.resolveVersionRef(options);
    const data = await this.graphRepository.checkout(
      options.graphId,
      versionRef?.version ?? options.version
    );

    const scoped =
      options.scope === 'filtered' && options.filters
        ? this.applyFilters(data, options.filters)
        : data;

    const filePath =
      outputPath ||
      path.join(
        this.dataDir,
        'exports',
        `export_${options.graphId}_${Date.now()}.json`
      );
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });

    // Req 4.4: embed the referenced entities. The resolution is asynchronous
    // and a generator cannot await, so it happens before the stream starts and
    // the results are matched to the references as they are written.
    //
    // It happens BEFORE the hashing pass on purpose: the checksum is over the
    // bytes that are written, and the written bytes carry the embedded
    // payloads. Hashing first would make the checksum describe a document that
    // is not the one on disk.
    const embedded = options.embedReferences
      ? await this.resolveEmbeddedEntities(scoped, options)
      : undefined;

    hooks.onPhase?.('hashing');
    const checksum = this.checksumOfExportData(scoped, embedded);

    const metadata: ExportMetadata = {
      graphId: graph.id,
      graphName: graph.name,
      description: graph.description,
      exportedAt: new Date().toISOString(),
      sourceVersion: this.appVersion,
      graphVersion: versionRef?.version ?? 0,
      checksum,
      filters: options.scope === 'filtered' ? options.filters : undefined,
    };

    const provenance = options.includeProvenance
      ? await this.getProvenance(options.graphId)
      : undefined;

    const head =
      `{"version":"1.0","metadata":${JSON.stringify(metadata)},"data":`;
    const tail = (provenance ? `,"provenance":${JSON.stringify(provenance)}` : '') + '}';

    hooks.onPhase?.('writing');
    await pipeline(
      Readable.from(
        this.exportDocumentChunks(head, scoped, tail, hooks.onProgress, embedded)
      ),
      fs.createWriteStream(filePath, { encoding: 'utf8' })
    );

    return filePath;
  }

  /**
   * The export document as a sequence of string chunks: the pre-computed head,
   * the streamed data section, then the tail (provenance, if any).
   */
  private *exportDocumentChunks(
    head: string,
    data: ResolvedGraphData,
    tail: string,
    onProgress?: (fraction: number) => void,
    embedded?: Map<string, { entity?: ExportedEvent | ExportedArc; status: EmbeddedEntityStatus }>
  ): Generator<string> {
    yield head;
    yield* this.exportDataChunks(data, onProgress, embedded);
    yield tail;
    onProgress?.(1);
  }

  /**
   * Serialise `data` exactly as `JSON.stringify(convertToExportFormat(data))`
   * would, one entity at a time.
   *
   * Byte-identity is the contract, not an implementation detail: the checksum
   * is taken over these bytes, and the same checksum has to describe the
   * document `exportGraph` returns for the same graph. `exportDataChunks` is
   * therefore used for both -- the hashing pass and the writing pass -- so the
   * two can never disagree.
   */
  private *exportDataChunks(
    data: ResolvedGraphData,
    onProgress?: (fraction: number) => void,
    embedded?: Map<string, { entity?: ExportedEvent | ExportedArc; status: EmbeddedEntityStatus }>
  ): Generator<string> {
    const crossGraphRefs: CrossGraphRef[] = [];
    const total =
      Object.keys(data.events).length +
      Object.keys(data.arcs).length +
      Object.keys(data.relationships).length +
      Object.keys(data.pressures).length;
    let written = 0;
    // Reported after every entity, not after every section: a 110k-event graph
    // is four sections, so section granularity would leave progress motionless
    // for the entire run -- the behaviour this hook exists to avoid.
    const advance = (): void => {
      written += 1;
      if (onProgress && total > 0) {
        onProgress(written / total);
      }
    };

    // The key order below matches `convertToExportFormat`; `crossGraphRefs`
    // last, and absent entirely when the graph has none.
    yield '{"events":';
    yield* this.entityChunks(
      data.events,
      (id, entity) => this.convertEvent(id, entity, crossGraphRefs),
      advance
    );

    yield ',"arcs":';
    yield* this.entityChunks(
      data.arcs,
      (id, entity) => this.convertArc(id, entity, crossGraphRefs),
      advance
    );

    yield ',"causalRelationships":';
    yield* this.entityChunks(
      data.relationships,
      (id, entity) => this.convertRelationship(id, entity, crossGraphRefs),
      advance
    );

    yield ',"inferredPressures":';
    yield* this.entityChunks(
      data.pressures,
      (id, entity) => this.convertPressure(id, entity),
      advance
    );

    if (crossGraphRefs.length > 0) {
      // The payloads were resolved before the stream started (resolution is
      // asynchronous, and a generator cannot await), so they are matched to the
      // references here.
      if (embedded) {
        for (const ref of crossGraphRefs) {
          const resolved = embedded.get(ExportService.refKey(ref));
          if (!resolved) continue;
          if (resolved.entity) ref.embeddedEntity = resolved.entity;
          ref.embeddedEntityStatus = resolved.status;
        }
      }
      yield `,"crossGraphRefs":${JSON.stringify(crossGraphRefs)}`;
    }

    yield '}';
  }

  /**
   * `[...]` with one JSON-serialised entity per chunk.
   *
   * Iterates the record's keys directly rather than through `Object.entries`:
   * the pair array would be one more O(entities) allocation held for the whole
   * section, which is exactly what this method exists to avoid.
   */
  private *entityChunks(
    entities: Record<string, Record<string, unknown>>,
    convert: (id: string, entity: Record<string, unknown>) => unknown,
    onEntity?: () => void
  ): Generator<string> {
    yield '[';
    let separator = '';
    for (const id of Object.keys(entities)) {
      yield separator + JSON.stringify(convert(id, entities[id]));
      separator = ',';
      onEntity?.();
    }
    yield ']';
  }

  /**
   * SHA-256 of the exported data section, matching `calculateChecksum`.
   *
   * The embedded payloads are part of the data section, so the hash has to be
   * taken over the same bytes the document contains.
   */
  private checksumOfExportData(
    data: ResolvedGraphData,
    embedded?: Map<string, { entity?: ExportedEvent | ExportedArc; status: EmbeddedEntityStatus }>
  ): string {
    const hash = crypto.createHash('sha256');
    for (const chunk of this.exportDataChunks(data, undefined, embedded)) {
      hash.update(chunk, 'utf8');
    }
    return hash.digest('hex');
  }

  /**
   * Estimate export size without generating full export
   */
  async estimateExportSize(options: ExportOptions): Promise<number> {
    const graph = await this.graphRepository.findById(options.graphId);
    if (!graph) {
      throw new Error(`Graph not found: ${options.graphId}`);
    }

    // A pinned version is estimated from that tree: the metadata counts
    // describe the head, and using them would reject a small historical export
    // because the head happens to be large. Resolving first turns a missing
    // version into the same NotFoundError every other read path produces.
    if (options.version !== undefined) {
      await this.resolveVersionRef(options);
      const data = await this.graphRepository.checkout(options.graphId, options.version);
      return this.estimateExportSizeFromData(data);
    }

    const metadata = graph.metadata;
    return this.estimateFromCounts(
      metadata.eventCount,
      metadata.arcCount,
      metadata.relationshipCount,
      metadata.pressureCount
    );
  }

  /** Estimate a tree that has already been resolved. */
  private estimateExportSizeFromData(data: ResolvedGraphData): number {
    return this.estimateFromCounts(
      Object.keys(data.events).length,
      Object.keys(data.arcs).length,
      Object.keys(data.relationships).length,
      Object.keys(data.pressures).length
    );
  }

  /** Rough estimate: ~500 bytes per event, ~300 per arc, ~200 per relationship. */
  private estimateFromCounts(
    eventCount: number,
    arcCount: number,
    relationshipCount: number,
    pressureCount: number
  ): number {
    return (
      eventCount * 500 +
      arcCount * 300 +
      relationshipCount * 200 +
      pressureCount * 400 +
      2000 // Metadata overhead
    );
  }

  /**
   * Validate an export file
   */
  validateExport(exportData: AlthistoryExport): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check version
    if (exportData.version !== '1.0') {
      warnings.push(`Unknown version: ${exportData.version}`);
    }

    // Check metadata
    if (!exportData.metadata) {
      errors.push('Missing metadata');
    } else {
      if (!exportData.metadata.graphId) errors.push('Missing graphId in metadata');
      if (!exportData.metadata.graphName) errors.push('Missing graphName in metadata');
      if (!exportData.metadata.exportedAt) errors.push('Missing exportedAt in metadata');
      if (!exportData.metadata.checksum) warnings.push('Missing checksum in metadata');
    }

    // Check data
    if (!exportData.data) {
      errors.push('Missing data');
    } else {
      if (!Array.isArray(exportData.data.events)) errors.push('Events must be an array');
      if (!Array.isArray(exportData.data.arcs)) errors.push('Arcs must be an array');
      if (!Array.isArray(exportData.data.causalRelationships)) {
        errors.push('CausalRelationships must be an array');
      }
    }

    // Verify checksum if present
    if (exportData.metadata?.checksum && exportData.data) {
      const calculatedChecksum = this.calculateChecksum(JSON.stringify(exportData.data));
      if (calculatedChecksum !== exportData.metadata.checksum) {
        errors.push('Checksum mismatch - data may be corrupted');
      }
    }

    // Validate event references in relationships
    if (exportData.data?.events && exportData.data?.causalRelationships) {
      const eventIds = new Set(exportData.data.events.map(e => e.id));
      for (const rel of exportData.data.causalRelationships) {
        // Skip cross-graph references
        if (rel.causeGraphId || rel.effectGraphId) continue;
        
        if (!eventIds.has(rel.cause_event_id)) {
          warnings.push(`Relationship ${rel.id} references missing cause event ${rel.cause_event_id}`);
        }
        if (!eventIds.has(rel.effect_event_id)) {
          warnings.push(`Relationship ${rel.id} references missing effect event ${rel.effect_event_id}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  // Private helper methods

  private applyFilters(data: ResolvedGraphData, filters: ExportFilters): ResolvedGraphData {
    const result: ResolvedGraphData = {
      events: {},
      arcs: {},
      relationships: {},
      pressures: {},
    };

    // Filter events
    for (const [id, event] of Object.entries(data.events)) {
      if (this.eventMatchesFilters(event as Record<string, unknown>, filters)) {
        result.events[id] = event;
      }
    }

    // Filter arcs
    for (const [id, arc] of Object.entries(data.arcs)) {
      if (this.arcMatchesFilters(arc as Record<string, unknown>, filters)) {
        result.arcs[id] = arc;
      }
    }

    // Keep relationships that reference included events
    const includedEventIds = new Set(Object.keys(result.events));
    for (const [id, rel] of Object.entries(data.relationships)) {
      const relationship = rel as Record<string, unknown>;
      const causeId = relationship.cause_event_id as string;
      const effectId = relationship.effect_event_id as string;
      
      if (includedEventIds.has(causeId) && includedEventIds.has(effectId)) {
        result.relationships[id] = rel;
      }
    }

    // Keep pressures that reference included arcs
    const includedArcIds = new Set(Object.keys(result.arcs));
    for (const [id, pressure] of Object.entries(data.pressures)) {
      const p = pressure as Record<string, unknown>;
      const affectedArcs = p.affected_arc_ids as string[] || [];
      
      if (affectedArcs.some(arcId => includedArcIds.has(arcId))) {
        result.pressures[id] = pressure;
      }
    }

    return result;
  }

  private eventMatchesFilters(event: Record<string, unknown>, filters: ExportFilters): boolean {
    // Check specific event IDs
    if (filters.eventIds && filters.eventIds.length > 0) {
      if (!filters.eventIds.includes(event.id as string)) {
        return false;
      }
    }

    // Check time range
    if (filters.timeRange) {
      const timestamp = new Date(event.timestamp as string).getTime();
      const start = new Date(filters.timeRange.start).getTime();
      const end = new Date(filters.timeRange.end).getTime();
      
      if (timestamp < start || timestamp > end) {
        return false;
      }
    }

    // Check actors
    if (filters.actors && filters.actors.length > 0) {
      if (!filters.actors.includes(event.actor as string)) {
        return false;
      }
    }

    // Check targets
    if (filters.targets && filters.targets.length > 0) {
      if (!filters.targets.includes(event.target as string)) {
        return false;
      }
    }

    return true;
  }

  private arcMatchesFilters(arc: Record<string, unknown>, filters: ExportFilters): boolean {
    // Check specific arc IDs
    if (filters.arcIds && filters.arcIds.length > 0) {
      if (!filters.arcIds.includes(arc.id as string)) {
        return false;
      }
    }

    // Check time range (arc must overlap with filter range)
    if (filters.timeRange) {
      const arcStart = new Date(arc.start_time as string).getTime();
      const arcEnd = new Date(arc.end_time as string).getTime();
      const filterStart = new Date(filters.timeRange.start).getTime();
      const filterEnd = new Date(filters.timeRange.end).getTime();
      
      // Arc overlaps if it starts before filter ends and ends after filter starts
      if (arcEnd < filterStart || arcStart > filterEnd) {
        return false;
      }
    }

    return true;
  }

  private convertToExportFormat(data: ResolvedGraphData): ExportData {
    const events: ExportedEvent[] = [];
    const arcs: ExportedArc[] = [];
    const relationships: ExportedRelationship[] = [];
    const pressures: ExportedPressure[] = [];
    const crossGraphRefs: CrossGraphRef[] = [];

    for (const [id, event] of Object.entries(data.events)) {
      events.push(
        this.convertEvent(id, event as Record<string, unknown>, crossGraphRefs)
      );
    }
    for (const [id, arc] of Object.entries(data.arcs)) {
      arcs.push(this.convertArc(id, arc as Record<string, unknown>, crossGraphRefs));
    }
    for (const [id, rel] of Object.entries(data.relationships)) {
      relationships.push(
        this.convertRelationship(id, rel as Record<string, unknown>, crossGraphRefs)
      );
    }
    for (const [id, pressure] of Object.entries(data.pressures)) {
      pressures.push(this.convertPressure(id, pressure as Record<string, unknown>));
    }

    return {
      events,
      arcs,
      causalRelationships: relationships,
      inferredPressures: pressures,
      // Omitted entirely when the graph has none, so the key's absence keeps
      // meaning "no cross-graph references" (Req 4.4).
      ...(crossGraphRefs.length > 0 ? { crossGraphRefs } : {}),
    };
  }

  /**
   * Convert one stored entity to its exported shape.
   *
   * The per-entity converters exist so the in-memory and streaming paths share
   * one definition of the format. Two implementations would drift, and the
   * checksum is taken over the serialised bytes, so drift would silently make
   * the two paths disagree about the same graph.
   *
   * Property order is part of the format here: `JSON.stringify` writes keys in
   * insertion order, and the streamed data section has to be byte-identical to
   * `JSON.stringify(convertToExportFormat(data))` for the checksums to match.
   */
  private convertEvent(
    id: string,
    e: Record<string, unknown>,
    crossGraphRefs: CrossGraphRef[]
  ): ExportedEvent {
    const { metadata, refs } = this.takeCrossGraphRefs(e.metadata, id, 'event');
    crossGraphRefs.push(...refs);
    return {
      id,
      description: e.description as string,
      actor: e.actor as string,
      target: e.target as string,
      timestamp: e.timestamp as string,
      metadata,
      sourceRef: e.sourceRef as string | undefined,
    };
  }

  private convertArc(
    id: string,
    a: Record<string, unknown>,
    crossGraphRefs: CrossGraphRef[]
  ): ExportedArc {
    const { metadata, refs } = this.takeCrossGraphRefs(a.metadata, id, 'arc');
    crossGraphRefs.push(...refs);
    return {
      id,
      name: a.name as string,
      description: a.description as string,
      start_time: a.start_time as string,
      end_time: a.end_time as string,
      level: a.level as number,
      parent_arc_id: a.parent_arc_id as string | null,
      metadata,
      sourceRef: a.sourceRef as string | undefined,
    };
  }

  private convertRelationship(
    id: string,
    r: Record<string, unknown>,
    crossGraphRefs: CrossGraphRef[]
  ): ExportedRelationship {
    const { refs } = this.takeCrossGraphRefs(r.metadata, id, 'relationship');
    crossGraphRefs.push(...refs);
    return {
      id,
      cause_event_id: r.cause_event_id as string,
      effect_event_id: r.effect_event_id as string,
      weight: r.weight as number,
      evidence: r.evidence as string,
      confidence: r.confidence as number,
      relationship_type: r.relationship_type as 'direct' | 'indirect' | 'contributory',
      sourceRef: r.sourceRef as string | undefined,
      causeGraphId: r.causeGraphId as string | undefined,
      effectGraphId: r.effectGraphId as string | undefined,
    };
  }

  private convertPressure(id: string, p: Record<string, unknown>): ExportedPressure {
    return {
      id,
      description: p.description as string,
      confidence_score: p.confidence_score as number,
      pressure_type: p.pressure_type as 'economic' | 'social' | 'environmental' | 'political',
      evidence_event_ids: (p.evidence_event_ids as string[]) || [],
      affected_arc_ids: (p.affected_arc_ids as string[]) || [],
    };
  }

  /**
   * Resolve the embedded payload of every cross-graph reference.
   *
   * Returns a map keyed by the reference's identity, so the serialiser can
   * match a payload to the reference it belongs to. The in-memory path does
   * not need this -- it can attach the payloads to the reference objects
   * directly -- but the streaming path has to resolve before it starts,
   * because a generator cannot await.
   */
  private async resolveEmbeddedEntities(
    data: ResolvedGraphData,
    options: ExportOptions
  ): Promise<Map<string, { entity?: ExportedEvent | ExportedArc; status: EmbeddedEntityStatus }>> {
    const resolved = new Map<string, { entity?: ExportedEvent | ExportedArc; status: EmbeddedEntityStatus }>();

    const refs = this.collectCrossGraphRefs(data);
    if (refs.length === 0) return resolved;

    // The resolution writes onto the references; the map is built from the
    // result, so the in-memory and the streaming path agree.
    await this.embedReferencedEntities(refs, options);

    for (const ref of refs) {
      resolved.set(ExportService.refKey(ref), {
        entity: ref.embeddedEntity,
        status: ref.embeddedEntityStatus ?? 'missing',
      });
    }

    return resolved;
  }

  /**
   * Embed the entity each cross-graph reference points at (Req 4.4).
   *
   * The payload is read from the referenced graph, so two things decide
   * whether it is included: whether the caller asked for embedding, and
   * whether the caller may read the referenced graph at all. A reference to a
   * graph the caller may not read is still reported -- the reference metadata
   * is part of the export either way -- but its payload is withheld, and the
   * reason is recorded so a consumer can tell "not embedded" from "not
   * allowed to".
   */
  private async embedReferencedEntities(
    refs: CrossGraphRef[],
    options: ExportOptions
  ): Promise<void> {
    const canRead = options.canReadGraph ?? (() => false);

    // The references are grouped by the graph they point at, so each graph is
    // loaded once -- and, more importantly, so only one referenced graph is in
    // memory at a time. Holding every referenced tree at once would make the
    // export's memory a multiple of the graph it exports.
    const byGraph = new Map<string, CrossGraphRef[]>();
    for (const ref of refs) {
      const list = byGraph.get(ref.referencedGraphId);
      if (list) {
        list.push(ref);
      } else {
        byGraph.set(ref.referencedGraphId, [ref]);
      }
    }

    // The caps are checked before anything is loaded, and only the graphs the
    // caller may read count towards them: a reference the caller may not read
    // is refused anyway, so it must not use up the budget of the ones it may.
    const readableGraphs = [...byGraph.keys()].filter((graphId) => canRead(graphId));

    if (readableGraphs.length > MAX_EMBEDDED_GRAPHS || refs.length > MAX_EMBEDDED_REFS) {
      // The number of references is not bounded by the entity count: one
      // event's metadata can name any number of graphs. Loading them all would
      // be unbounded work for a request that looked small.
      this.logger.warn('Refusing to embed: too many references', {
        referencedGraphs: readableGraphs.length,
        references: refs.length,
        limitGraphs: MAX_EMBEDDED_GRAPHS,
        limitReferences: MAX_EMBEDDED_REFS,
      });
      for (const ref of refs) {
        ref.embeddedEntityStatus = 'too-many';
      }
      return;
    }

    let embeddedBytes = 0;
    let tooLarge = false;

    for (const [graphId, graphRefs] of byGraph) {
      // The access check comes before any load, so a caller cannot learn
      // whether a graph exists by watching what is embedded.
      if (!canRead(graphId)) {
        for (const ref of graphRefs) {
          ref.embeddedEntityStatus = 'forbidden';
        }
        continue;
      }

      const referenced = await this.loadGraphIfItExists(graphId);
      if (referenced === null) {
        for (const ref of graphRefs) {
          ref.embeddedEntityStatus = 'missing';
        }
        continue;
      }
      if (referenced === 'unreadable') {
        for (const ref of graphRefs) {
          ref.embeddedEntityStatus = 'unreadable';
        }
        continue;
      }

      // One converted copy per entity, not per reference: ten thousand
      // references to the same entity must not produce ten thousand copies of
      // it.
      const converted = new Map<string, ExportedEvent | ExportedArc>();

      for (const ref of graphRefs) {
        const entityKey = `${ref.referencedEntityType}:${ref.referencedEntityId}`;
        let embedded = converted.get(entityKey);

        if (embedded === undefined) {
          const raw =
            ref.referencedEntityType === 'event'
              ? referenced.events[ref.referencedEntityId]
              : referenced.arcs[ref.referencedEntityId];

          // The lookup has to be an own-property one: an id of "constructor"
          // would otherwise resolve to `Object.prototype` and be embedded as
          // though it were an entity.
          const source =
            ref.referencedEntityType === 'event'
              ? referenced.events
              : referenced.arcs;
          if (!Object.prototype.hasOwnProperty.call(source, ref.referencedEntityId) || !raw) {
            for (const missing of graphRefs.filter((r) => r.referencedEntityId === ref.referencedEntityId)) {
              missing.embeddedEntityStatus = 'missing';
            }
            continue;
          }

          // The embedded entity is a copy of another graph's entity. Its own
          // cross-graph references are not followed: that would make embedding
          // recursive, and the reference metadata of the embedded copy is not
          // part of the format for it.
          const ignoredRefs: CrossGraphRef[] = [];
          embedded =
            ref.referencedEntityType === 'event'
              ? this.convertEvent(ref.referencedEntityId, raw, ignoredRefs)
              : this.convertArc(ref.referencedEntityId, raw, ignoredRefs);
          converted.set(entityKey, embedded);
        }

        embeddedBytes += Buffer.byteLength(JSON.stringify(embedded), 'utf8');
        if (embeddedBytes > MAX_EMBEDDED_BYTES) {
          tooLarge = true;
          break;
        }

        ref.embeddedEntity = embedded;
        ref.embeddedEntityStatus = 'embedded';
      }

      if (tooLarge) break;
    }

    if (tooLarge) {
      this.logger.warn('Refusing to embed: the payloads are too large', {
        embeddedBytes,
        limit: MAX_EMBEDDED_BYTES,
      });
      for (const ref of refs) {
        if (ref.embeddedEntityStatus === 'embedded') {
          ref.embeddedEntity = undefined;
        }
        ref.embeddedEntityStatus = 'too-many';
      }
    }
  }

  /**
   * The current contents of a graph.
   *
   * `null` means the graph does not exist; `'unreadable'` means it exists but
   * could not be read, which is a different thing: a consumer must not treat
   * a transient read error as "the referenced entity is gone".
   */
  private async loadGraphIfItExists(
    graphId: string
  ): Promise<ResolvedGraphData | null | 'unreadable'> {
    // The id comes from free-form metadata, so it is checked before it is used
    // as a path.
    try {
      assertSafeGraphId(graphId);
    } catch {
      return null;
    }

    const graph = await this.graphRepository.findById(graphId);
    if (!graph) {
      // `findById` answers null both for a graph that does not exist and for
      // one it could not read. The index says which ids exist.
      return (await this.graphRepository.exists(graphId)) ? 'unreadable' : null;
    }

    // A deleted graph is gone as far as the rest of the API is concerned: the
    // graph context resolver answers 404 for it.
    if (graph.status === 'deleted') return null;

    try {
      return await this.graphRepository.checkout(graphId);
    } catch (error) {
      this.logger.error('Could not read a referenced graph for embedding', error, { graphId });
      return 'unreadable';
    }
  }

  /**
   * Identifies a reference, so a resolved payload can be matched to it.
   *
   * The parts are joined with a separator that cannot occur in an id, and the
   * whole thing is JSON-encoded, so two different references cannot produce
   * the same key.
   */
  private static refKey(ref: CrossGraphRef): string {
    return JSON.stringify([
      ref.localEntityType,
      ref.localEntityId,
      ref.referencedGraphId,
      ref.referencedEntityId,
      ref.referencedEntityType,
    ]);
  }

  /**
   * The cross-graph references a tree carries, in the order the serialiser
   * emits them.
   *
   * The streaming path needs the referenced entities resolved before it can
   * serialise the references, so it collects them first. The traversal is the
   * same one the serialiser performs, so the two agree.
   */
  private collectCrossGraphRefs(data: ResolvedGraphData): CrossGraphRef[] {
    const refs: CrossGraphRef[] = [];

    for (const [id, event] of Object.entries(data.events)) {
      this.convertEvent(id, event, refs);
    }
    for (const [id, arc] of Object.entries(data.arcs)) {
      this.convertArc(id, arc, refs);
    }
    for (const [id, rel] of Object.entries(data.relationships)) {
      this.convertRelationship(id, rel, refs);
    }

    return refs;
  }

  /**
   * Split the cross-graph references an import stored next to an entity out of
   * its metadata.
   *
   * `ImportService` keeps them in `metadata.crossGraphRefs` because the entity
   * commit path copies metadata verbatim and the format defines no per-entity
   * field for them. They belong in `data.crossGraphRefs` on export, where the
   * format does declare them, so this hoists rather than duplicates them: the
   * returned metadata no longer carries the private key.
   *
   * `localEntityId`/`localEntityType` are taken from the containing entity, not
   * from the stored copy, so an id renamed during import cannot produce a ref
   * that points at the stale id. Entries without a referenced graph, entity or
   * valid referenced type are dropped: they carry no usable reference.
   */
  private takeCrossGraphRefs(
    metadata: unknown,
    localEntityId: string,
    localEntityType: CrossGraphRef['localEntityType']
  ): { metadata: Record<string, unknown> | undefined; refs: CrossGraphRef[] } {
    if (!metadata || typeof metadata !== 'object') {
      return { metadata: undefined, refs: [] };
    }

    const source = metadata as Record<string, unknown>;
    if (!('crossGraphRefs' in source)) {
      return { metadata: source, refs: [] };
    }

    const { crossGraphRefs: rawRefs, ...rest } = source;
    const refs: CrossGraphRef[] = [];

    if (Array.isArray(rawRefs)) {
      for (const raw of rawRefs) {
        if (!raw || typeof raw !== 'object') continue;
        const candidate = raw as Record<string, unknown>;
        const referencedGraphId = candidate.referencedGraphId;
        const referencedEntityId = candidate.referencedEntityId;
        const referencedEntityType = candidate.referencedEntityType;

        if (typeof referencedGraphId !== 'string' || referencedGraphId.length === 0) continue;
        if (typeof referencedEntityId !== 'string' || referencedEntityId.length === 0) continue;
        if (referencedEntityType !== 'event' && referencedEntityType !== 'arc') continue;

        refs.push({
          localEntityId,
          localEntityType,
          referencedGraphId,
          referencedEntityId,
          referencedEntityType,
        });
      }
    }

    return {
      metadata: Object.keys(rest).length > 0 ? rest : undefined,
      refs,
    };
  }

  /** Entities an export payload contains, in the Req 5.4 sense. */
  private countExportDataEntities(data: ExportData): number {
    return (
      data.events.length +
      data.arcs.length +
      data.causalRelationships.length +
      data.inferredPressures.length
    );
  }

  private async getProvenance(graphId: string): Promise<ExportProvenance> {
    const sources: DataSource[] = [];
    const importHistory: ImportRecord[] = [];

    // Load provenance data from version history
    const { versions } = await this.graphRepository.getVersionHistory(graphId, 1000, 0);
    
    // Track entity sources based on operation types
    const entitySourceMap = new Map<string, DataSource>();
    
    for (const version of versions) {
      // Track imports
      if (version.operation === 'import') {
        importHistory.push({
          id: `import-v${version.version}`,
          importedAt: version.timestamp,
          sourceFile: version.description || undefined,
          entityCount: version.changes.added.length,
          userId: version.userId,
        });
        
        // Mark imported entities as from 'import' source
        const sourceId = `import-v${version.version}`;
        if (!entitySourceMap.has(sourceId)) {
          entitySourceMap.set(sourceId, {
            id: sourceId,
            type: 'import',
            accessedAt: version.timestamp,
            confidence: 0.8,
            entityIds: [],
          });
        }
        for (const change of version.changes.added) {
          entitySourceMap.get(sourceId)!.entityIds.push(change.id);
        }
      }
      
      // Track manual creations
      if (version.operation === 'create') {
        const sourceId = `manual-v${version.version}`;
        if (!entitySourceMap.has(sourceId)) {
          entitySourceMap.set(sourceId, {
            id: sourceId,
            type: 'manual',
            accessedAt: version.timestamp,
            confidence: 1.0,
            entityIds: [],
          });
        }
        for (const change of version.changes.added) {
          entitySourceMap.get(sourceId)!.entityIds.push(change.id);
        }
      }
    }

    // Convert source map to array
    for (const source of entitySourceMap.values()) {
      if (source.entityIds.length > 0) {
        sources.push(source);
      }
    }

    // Sort import history by date descending
    importHistory.sort((a, b) => 
      new Date(b.importedAt).getTime() - new Date(a.importedAt).getTime()
    );

    return {
      sources,
      importHistory,
    };
  }

  private calculateChecksum(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
