/**
 * Export Service for generating Althistory export files
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { GraphRepository } from '../repositories/GraphRepository';
import { ResolvedGraphData } from '../repositories/VersionRepository';
import { IGraph } from '../models/Graph';
import { ExportFilters } from '../models/AsyncJob';

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

export interface CrossGraphRef {
  localEntityId: string;
  localEntityType: 'event' | 'arc' | 'relationship';
  referencedGraphId: string;
  referencedEntityId: string;
  referencedEntityType: 'event' | 'arc';
  embeddedEntity?: ExportedEvent | ExportedArc;
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
}

export interface ExportResult {
  export: AlthistoryExport;
  size: number;
}

export interface ExportServiceConfig {
  dataDir: string;
  appVersion?: string;
}

/**
 * Service for exporting graph data
 */
export class ExportService {
  private readonly graphRepository: GraphRepository;
  private readonly dataDir: string;
  private readonly appVersion: string;

  constructor(config: ExportServiceConfig) {
    this.dataDir = config.dataDir;
    this.appVersion = config.appVersion || '1.0.0';
    this.graphRepository = new GraphRepository({ dataDir: config.dataDir });
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

    // Get graph data
    const data = await this.graphRepository.checkout(options.graphId, options.version);

    // Apply filters if specified
    const filteredData = options.scope === 'filtered' && options.filters
      ? this.applyFilters(data, options.filters)
      : data;

    // Convert to export format
    const exportData = this.convertToExportFormat(filteredData);

    // Build export object (without checksum first)
    const exportObj: AlthistoryExport = {
      version: '1.0',
      metadata: {
        graphId: graph.id,
        graphName: graph.name,
        description: graph.description,
        exportedAt: new Date().toISOString(),
        sourceVersion: this.appVersion,
        graphVersion: graph.version,
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
    };
  }

  /**
   * Export and save to file
   */
  async exportToFile(options: ExportOptions, outputPath?: string): Promise<string> {
    const result = await this.exportGraph(options);

    // Determine output path
    const filePath = outputPath || path.join(
      this.dataDir,
      'exports',
      `export_${options.graphId}_${Date.now()}.json`
    );

    // Ensure directory exists
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });

    // Write file
    await fs.promises.writeFile(
      filePath,
      JSON.stringify(result.export, null, 2),
      'utf8'
    );

    return filePath;
  }

  /**
   * Estimate export size without generating full export
   */
  async estimateExportSize(options: ExportOptions): Promise<number> {
    const graph = await this.graphRepository.findById(options.graphId);
    if (!graph) {
      throw new Error(`Graph not found: ${options.graphId}`);
    }

    // Get counts from metadata
    const metadata = graph.metadata;
    
    // Rough estimate: ~500 bytes per event, ~300 per arc, ~200 per relationship
    const estimatedSize = 
      (metadata.eventCount * 500) +
      (metadata.arcCount * 300) +
      (metadata.relationshipCount * 200) +
      (metadata.pressureCount * 400) +
      2000; // Metadata overhead

    return estimatedSize;
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

    // Convert events
    for (const [id, event] of Object.entries(data.events)) {
      const e = event as Record<string, unknown>;
      events.push({
        id,
        description: e.description as string,
        actor: e.actor as string,
        target: e.target as string,
        timestamp: e.timestamp as string,
        metadata: e.metadata as Record<string, unknown> | undefined,
        sourceRef: e.sourceRef as string | undefined,
      });
    }

    // Convert arcs
    for (const [id, arc] of Object.entries(data.arcs)) {
      const a = arc as Record<string, unknown>;
      arcs.push({
        id,
        name: a.name as string,
        description: a.description as string,
        start_time: a.start_time as string,
        end_time: a.end_time as string,
        level: a.level as number,
        parent_arc_id: a.parent_arc_id as string | null,
        metadata: a.metadata as Record<string, unknown> | undefined,
        sourceRef: a.sourceRef as string | undefined,
      });
    }

    // Convert relationships
    for (const [id, rel] of Object.entries(data.relationships)) {
      const r = rel as Record<string, unknown>;
      relationships.push({
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
      });
    }

    // Convert pressures
    for (const [id, pressure] of Object.entries(data.pressures)) {
      const p = pressure as Record<string, unknown>;
      pressures.push({
        id,
        description: p.description as string,
        confidence_score: p.confidence_score as number,
        pressure_type: p.pressure_type as 'economic' | 'social' | 'environmental' | 'political',
        evidence_event_ids: (p.evidence_event_ids as string[]) || [],
        affected_arc_ids: (p.affected_arc_ids as string[]) || [],
      });
    }

    return {
      events,
      arcs,
      causalRelationships: relationships,
      inferredPressures: pressures,
    };
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
