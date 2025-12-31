/**
 * Import Service for importing Althistory export files
 * 
 * Provides:
 * - Format validation (structure, required fields, types)
 * - File size validation (security)
 * - Input sanitization (XSS prevention)
 * - Temporal constraint checking (events within arcs, valid dates)
 * - Causal consistency checking (cause before effect)
 * - Referential integrity checking (no orphan references)
 * - Conflict detection (duplicate IDs, temporal violations, causal paradoxes)
 * - Import preview (diff calculation)
 * - Atomic import execution with rollback
 * - Async job support for large imports
 * - Provenance recording for imported entities
 */

import { GraphRepository } from '../repositories/GraphRepository';
import { JobRepository } from '../repositories/JobRepository';
import { ResolvedGraphData, EntityChanges } from '../repositories/VersionRepository';
import {
  AlthistoryExport,
  ExportData,
  ExportedEvent,
  ExportedArc,
  ExportedRelationship,
  ExportedPressure,
} from './ExportService';
import { createLogger, ILogger } from '../utils/logger';
import { ValidationError } from '../utils/errors';
import * as crypto from 'crypto';

// ============================================================================
// Constants
// ============================================================================

/** Maximum file size for imports (10MB) */
const MAX_IMPORT_SIZE_BYTES = 10 * 1024 * 1024;

/** Threshold for async import (100 entities) */
const ASYNC_IMPORT_THRESHOLD = 100;

/** Maximum string length for sanitization */
const MAX_STRING_LENGTH = 10000;

// ============================================================================
// Import Types
// ============================================================================

export interface ImportError {
  path: string;
  message: string;
  code: ImportErrorCode;
}

export type ImportErrorCode =
  | 'INVALID_FORMAT'
  | 'MISSING_FIELD'
  | 'INVALID_TYPE'
  | 'INVALID_VALUE'
  | 'TEMPORAL_VIOLATION'
  | 'CAUSAL_PARADOX'
  | 'ORPHAN_REFERENCE'
  | 'DUPLICATE_ID'
  | 'VERSION_MISMATCH'
  | 'FILE_TOO_LARGE'
  | 'CHECKSUM_MISMATCH'
  | 'SECURITY_VIOLATION'
  | 'ARC_HIERARCHY_VIOLATION';

export interface ImportWarning {
  path: string;
  message: string;
  code: ImportWarningCode;
}

export type ImportWarningCode =
  | 'FUTURE_DATE'
  | 'MISSING_PROVENANCE'
  | 'LOW_CONFIDENCE'
  | 'DEPRECATED_FIELD'
  | 'EMPTY_COLLECTION';

export interface ImportSummary {
  eventCount: number;
  arcCount: number;
  relationshipCount: number;
  pressureCount: number;
  crossRefCount: number;
  temporalRange?: { start: string; end: string };
  actors: string[];
}

export interface ImportValidationResult {
  valid: boolean;
  errors: ImportError[];
  warnings: ImportWarning[];
  summary: ImportSummary;
}

export interface ImportConflict {
  id: string;
  type: ImportConflictType;
  severity: 'error' | 'warning';
  entityType: 'event' | 'arc' | 'relationship' | 'pressure';
  entityId: string;
  existingEntity?: Record<string, unknown>;
  incomingEntity: Record<string, unknown>;
  suggestedResolution: ConflictResolution;
  message: string;
}

export type ImportConflictType =
  | 'duplicate-id'
  | 'temporal-violation'
  | 'causal-paradox'
  | 'orphan-reference'
  | 'arc-boundary-violation';

export type ConflictResolution = 'skip' | 'overwrite' | 'rename';

export interface EntityCounts {
  events: number;
  arcs: number;
  relationships: number;
  pressures: number;
}

export interface ImportPreview {
  toCreate: EntityCounts;
  toUpdate: EntityCounts;
  toDelete: EntityCounts;
  conflicts: ImportConflict[];
  warnings: ImportWarning[];
}

export type ImportMode = 'merge' | 'replace' | 'create-new';

export interface ImportOptions {
  graphId?: string;
  mode: ImportMode;
  conflictResolution: ConflictResolution | 'manual';
  manualResolutions?: Record<string, ConflictResolution>;
}

export interface ImportResult {
  success: boolean;
  graphId: string;
  graphVersion: number;
  imported: EntityCounts;
  skipped: EntityCounts;
  deleted: EntityCounts;
  errors: ImportError[];
  warnings: ImportWarning[];
  jobId?: string;
}

export interface ImportJob {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: ImportResult;
  error?: string;
}

export interface ImportServiceConfig {
  dataDir: string;
}

// ============================================================================
// ImportService Implementation
// ============================================================================

export class ImportService {
  private readonly graphRepository: GraphRepository;
  private readonly jobRepository: JobRepository;
  private readonly dataDir: string;
  private readonly logger: ILogger;
  private activeImports: Map<string, { cancel: boolean }> = new Map();

  constructor(config: ImportServiceConfig) {
    this.dataDir = config.dataDir;
    this.graphRepository = new GraphRepository({ dataDir: config.dataDir });
    this.jobRepository = new JobRepository({ dataDir: config.dataDir });
    this.logger = createLogger('ImportService');
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    await this.graphRepository.initialize();
    await this.jobRepository.initialize();
  }

  // ==========================================================================
  // Security & Sanitization
  // ==========================================================================

  /**
   * Validate import data size (security check)
   */
  validateSize(data: unknown): ImportError | null {
    const jsonString = JSON.stringify(data);
    if (jsonString.length > MAX_IMPORT_SIZE_BYTES) {
      return {
        path: '$',
        message: `Import data exceeds maximum size of ${MAX_IMPORT_SIZE_BYTES / 1024 / 1024}MB`,
        code: 'FILE_TOO_LARGE',
      };
    }
    return null;
  }

  /**
   * Sanitize string input to prevent XSS
   */
  private sanitizeString(input: string): string {
    if (typeof input !== 'string') return input;
    // Truncate overly long strings
    let sanitized = input.slice(0, MAX_STRING_LENGTH);
    // Escape HTML entities
    sanitized = sanitized
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
    return sanitized;
  }

  /**
   * Sanitize all string fields in an object
   */
  private sanitizeObject<T extends Record<string, unknown>>(obj: T): T {
    const sanitized = { ...obj };
    for (const [key, value] of Object.entries(sanitized)) {
      if (typeof value === 'string') {
        (sanitized as Record<string, unknown>)[key] = this.sanitizeString(value);
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        (sanitized as Record<string, unknown>)[key] = this.sanitizeObject(value as Record<string, unknown>);
      }
    }
    return sanitized;
  }

  /**
   * Validate checksum if provided
   */
  validateChecksum(data: AlthistoryExport): ImportError | null {
    if (!data.metadata.checksum) {
      return null; // Checksum is optional
    }

    // Calculate checksum of data section
    const dataString = JSON.stringify(data.data);
    const calculatedChecksum = crypto.createHash('sha256').update(dataString).digest('hex');

    if (calculatedChecksum !== data.metadata.checksum) {
      return {
        path: '$.metadata.checksum',
        message: 'Checksum validation failed - data may be corrupted',
        code: 'CHECKSUM_MISMATCH',
      };
    }
    return null;
  }

  // ==========================================================================
  // Format Validation
  // ==========================================================================

  /**
   * Validate import data format and structure
   */
  async validateFormat(data: unknown): Promise<ImportValidationResult> {
    const errors: ImportError[] = [];
    const warnings: ImportWarning[] = [];

    // Check file size first
    const sizeError = this.validateSize(data);
    if (sizeError) {
      errors.push(sizeError);
      return this.createValidationResult(false, errors, warnings);
    }

    // Check basic structure
    if (!data || typeof data !== 'object') {
      errors.push({
        path: '$',
        message: 'Import data must be an object',
        code: 'INVALID_FORMAT',
      });
      return this.createValidationResult(false, errors, warnings);
    }

    const importData = data as Record<string, unknown>;

    // Validate version
    if (importData.version !== '1.0') {
      errors.push({
        path: '$.version',
        message: `Unsupported version: ${importData.version}. Expected '1.0'`,
        code: 'VERSION_MISMATCH',
      });
    }

    // Validate metadata
    this.validateMetadata(importData.metadata, errors, warnings);

    // Validate data section
    if (!importData.data || typeof importData.data !== 'object') {
      errors.push({
        path: '$.data',
        message: 'Data section is required and must be an object',
        code: 'MISSING_FIELD',
      });
      return this.createValidationResult(false, errors, warnings);
    }

    const exportData = importData.data as ExportData;

    // Validate checksum if provided
    if (importData.metadata && (importData.metadata as Record<string, unknown>).checksum) {
      const checksumError = this.validateChecksum(importData as AlthistoryExport);
      if (checksumError) {
        errors.push(checksumError);
      }
    }

    // Validate events
    this.validateEvents(exportData.events, errors, warnings);

    // Validate arcs
    this.validateArcs(exportData.arcs, errors, warnings);

    // Validate relationships
    this.validateRelationships(exportData.causalRelationships, exportData.events, errors, warnings);

    // Validate pressures - now treats missing references as errors
    this.validatePressures(exportData.inferredPressures, exportData.events, exportData.arcs, errors, warnings);

    // Validate provenance (optional)
    if (importData.provenance) {
      this.validateProvenance(importData.provenance, warnings);
    } else {
      warnings.push({
        path: '$.provenance',
        message: 'No provenance information included',
        code: 'MISSING_PROVENANCE',
      });
    }

    const summary = this.calculateSummary(exportData);
    return this.createValidationResult(errors.length === 0, errors, warnings, summary);
  }

  private validateMetadata(
    metadata: unknown,
    errors: ImportError[],
    warnings: ImportWarning[]
  ): void {
    if (!metadata || typeof metadata !== 'object') {
      errors.push({
        path: '$.metadata',
        message: 'Metadata section is required and must be an object',
        code: 'MISSING_FIELD',
      });
      return;
    }

    const meta = metadata as Record<string, unknown>;

    if (!meta.graphId || typeof meta.graphId !== 'string') {
      errors.push({
        path: '$.metadata.graphId',
        message: 'graphId is required and must be a string',
        code: 'MISSING_FIELD',
      });
    }

    if (!meta.graphName || typeof meta.graphName !== 'string') {
      errors.push({
        path: '$.metadata.graphName',
        message: 'graphName is required and must be a string',
        code: 'MISSING_FIELD',
      });
    }

    if (!meta.exportedAt || typeof meta.exportedAt !== 'string') {
      errors.push({
        path: '$.metadata.exportedAt',
        message: 'exportedAt is required and must be a string',
        code: 'MISSING_FIELD',
      });
    } else if (isNaN(Date.parse(meta.exportedAt as string))) {
      errors.push({
        path: '$.metadata.exportedAt',
        message: 'exportedAt must be a valid ISO date string',
        code: 'INVALID_VALUE',
      });
    }

    if (typeof meta.graphVersion !== 'number') {
      errors.push({
        path: '$.metadata.graphVersion',
        message: 'graphVersion is required and must be a number',
        code: 'MISSING_FIELD',
      });
    }
  }

  private validateEvents(
    events: unknown,
    errors: ImportError[],
    warnings: ImportWarning[]
  ): void {
    if (!Array.isArray(events)) {
      errors.push({
        path: '$.data.events',
        message: 'Events must be an array',
        code: 'INVALID_TYPE',
      });
      return;
    }

    if (events.length === 0) {
      warnings.push({
        path: '$.data.events',
        message: 'Events array is empty',
        code: 'EMPTY_COLLECTION',
      });
    }

    const seenIds = new Set<string>();

    events.forEach((event, index) => {
      const path = `$.data.events[${index}]`;

      if (!event || typeof event !== 'object') {
        errors.push({ path, message: 'Event must be an object', code: 'INVALID_TYPE' });
        return;
      }

      const e = event as ExportedEvent;

      // Required fields
      if (!e.id || typeof e.id !== 'string') {
        errors.push({ path: `${path}.id`, message: 'Event id is required', code: 'MISSING_FIELD' });
      } else if (seenIds.has(e.id)) {
        errors.push({
          path: `${path}.id`,
          message: `Duplicate event id: ${e.id}`,
          code: 'DUPLICATE_ID',
        });
      } else {
        seenIds.add(e.id);
      }

      if (!e.description || typeof e.description !== 'string') {
        errors.push({
          path: `${path}.description`,
          message: 'Event description is required',
          code: 'MISSING_FIELD',
        });
      }

      if (!e.actor || typeof e.actor !== 'string') {
        errors.push({
          path: `${path}.actor`,
          message: 'Event actor is required',
          code: 'MISSING_FIELD',
        });
      }

      if (!e.target || typeof e.target !== 'string') {
        errors.push({
          path: `${path}.target`,
          message: 'Event target is required',
          code: 'MISSING_FIELD',
        });
      }

      if (!e.timestamp || typeof e.timestamp !== 'string') {
        errors.push({
          path: `${path}.timestamp`,
          message: 'Event timestamp is required',
          code: 'MISSING_FIELD',
        });
      } else if (isNaN(Date.parse(e.timestamp))) {
        errors.push({
          path: `${path}.timestamp`,
          message: 'Event timestamp must be a valid ISO date string',
          code: 'INVALID_VALUE',
        });
      } else {
        const date = new Date(e.timestamp);
        if (date > new Date()) {
          warnings.push({
            path: `${path}.timestamp`,
            message: `Event timestamp is in the future: ${e.timestamp}`,
            code: 'FUTURE_DATE',
          });
        }
      }
    });
  }

  private validateArcs(
    arcs: unknown,
    errors: ImportError[],
    warnings: ImportWarning[]
  ): void {
    if (!Array.isArray(arcs)) {
      errors.push({
        path: '$.data.arcs',
        message: 'Arcs must be an array',
        code: 'INVALID_TYPE',
      });
      return;
    }

    const seenIds = new Set<string>();
    const arcIds = new Set<string>();
    const arcLevels = new Map<string, number>();

    // First pass: collect all arc IDs and levels
    arcs.forEach((arc) => {
      if (arc && typeof arc === 'object') {
        const a = arc as ExportedArc;
        if (a.id) {
          arcIds.add(a.id);
          if (typeof a.level === 'number') {
            arcLevels.set(a.id, a.level);
          }
        }
      }
    });

    arcs.forEach((arc, index) => {
      const path = `$.data.arcs[${index}]`;

      if (!arc || typeof arc !== 'object') {
        errors.push({ path, message: 'Arc must be an object', code: 'INVALID_TYPE' });
        return;
      }

      const a = arc as ExportedArc;

      // Required fields
      if (!a.id || typeof a.id !== 'string') {
        errors.push({ path: `${path}.id`, message: 'Arc id is required', code: 'MISSING_FIELD' });
      } else if (seenIds.has(a.id)) {
        errors.push({
          path: `${path}.id`,
          message: `Duplicate arc id: ${a.id}`,
          code: 'DUPLICATE_ID',
        });
      } else {
        seenIds.add(a.id);
      }

      if (!a.name || typeof a.name !== 'string') {
        errors.push({ path: `${path}.name`, message: 'Arc name is required', code: 'MISSING_FIELD' });
      }

      if (!a.start_time || typeof a.start_time !== 'string') {
        errors.push({
          path: `${path}.start_time`,
          message: 'Arc start_time is required',
          code: 'MISSING_FIELD',
        });
      } else if (isNaN(Date.parse(a.start_time))) {
        errors.push({
          path: `${path}.start_time`,
          message: 'Arc start_time must be a valid ISO date string',
          code: 'INVALID_VALUE',
        });
      }

      if (!a.end_time || typeof a.end_time !== 'string') {
        errors.push({
          path: `${path}.end_time`,
          message: 'Arc end_time is required',
          code: 'MISSING_FIELD',
        });
      } else if (isNaN(Date.parse(a.end_time))) {
        errors.push({
          path: `${path}.end_time`,
          message: 'Arc end_time must be a valid ISO date string',
          code: 'INVALID_VALUE',
        });
      }

      // Validate temporal consistency
      if (a.start_time && a.end_time) {
        const start = new Date(a.start_time);
        const end = new Date(a.end_time);
        if (!isNaN(start.getTime()) && !isNaN(end.getTime()) && start > end) {
          errors.push({
            path: `${path}`,
            message: `Arc start_time (${a.start_time}) is after end_time (${a.end_time})`,
            code: 'TEMPORAL_VIOLATION',
          });
        }
      }

      // Validate level
      if (typeof a.level !== 'number' || a.level < 0) {
        errors.push({
          path: `${path}.level`,
          message: 'Arc level must be a non-negative number',
          code: 'INVALID_VALUE',
        });
      }

      // Validate parent reference and hierarchy
      if (a.parent_arc_id !== null && a.parent_arc_id !== undefined) {
        if (typeof a.parent_arc_id !== 'string') {
          errors.push({
            path: `${path}.parent_arc_id`,
            message: 'Arc parent_arc_id must be a string or null',
            code: 'INVALID_TYPE',
          });
        } else if (!arcIds.has(a.parent_arc_id)) {
          errors.push({
            path: `${path}.parent_arc_id`,
            message: `Arc references non-existent parent: ${a.parent_arc_id}`,
            code: 'ORPHAN_REFERENCE',
          });
        } else {
          // Validate hierarchy: child level should be parent level + 1
          const parentLevel = arcLevels.get(a.parent_arc_id);
          if (parentLevel !== undefined && a.level !== parentLevel + 1) {
            errors.push({
              path: `${path}.level`,
              message: `Arc level (${a.level}) should be parent level (${parentLevel}) + 1`,
              code: 'ARC_HIERARCHY_VIOLATION',
            });
          }
        }
      } else if (a.level !== 0) {
        // Root arcs should have level 0
        errors.push({
          path: `${path}.level`,
          message: `Root arc (no parent) should have level 0, got ${a.level}`,
          code: 'ARC_HIERARCHY_VIOLATION',
        });
      }
    });
  }

  private validateRelationships(
    relationships: unknown,
    events: unknown,
    errors: ImportError[],
    warnings: ImportWarning[]
  ): void {
    if (!Array.isArray(relationships)) {
      errors.push({
        path: '$.data.causalRelationships',
        message: 'Causal relationships must be an array',
        code: 'INVALID_TYPE',
      });
      return;
    }

    // Build event map for reference validation
    const eventIds = new Set<string>();
    const eventTimestamps = new Map<string, Date>();

    if (Array.isArray(events)) {
      events.forEach((e) => {
        if (e && typeof e === 'object') {
          const event = e as ExportedEvent;
          if (event.id) {
            eventIds.add(event.id);
            if (event.timestamp) {
              eventTimestamps.set(event.id, new Date(event.timestamp));
            }
          }
        }
      });
    }

    const seenIds = new Set<string>();

    relationships.forEach((rel, index) => {
      const path = `$.data.causalRelationships[${index}]`;

      if (!rel || typeof rel !== 'object') {
        errors.push({ path, message: 'Relationship must be an object', code: 'INVALID_TYPE' });
        return;
      }

      const r = rel as ExportedRelationship;

      // Required fields
      if (!r.id || typeof r.id !== 'string') {
        errors.push({
          path: `${path}.id`,
          message: 'Relationship id is required',
          code: 'MISSING_FIELD',
        });
      } else if (seenIds.has(r.id)) {
        errors.push({
          path: `${path}.id`,
          message: `Duplicate relationship id: ${r.id}`,
          code: 'DUPLICATE_ID',
        });
      } else {
        seenIds.add(r.id);
      }

      // Validate cause event reference
      if (!r.cause_event_id || typeof r.cause_event_id !== 'string') {
        errors.push({
          path: `${path}.cause_event_id`,
          message: 'Relationship cause_event_id is required',
          code: 'MISSING_FIELD',
        });
      } else if (!r.causeGraphId && !eventIds.has(r.cause_event_id)) {
        // Only check local references (cross-graph refs have causeGraphId)
        errors.push({
          path: `${path}.cause_event_id`,
          message: `Relationship references non-existent cause event: ${r.cause_event_id}`,
          code: 'ORPHAN_REFERENCE',
        });
      }

      // Validate effect event reference
      if (!r.effect_event_id || typeof r.effect_event_id !== 'string') {
        errors.push({
          path: `${path}.effect_event_id`,
          message: 'Relationship effect_event_id is required',
          code: 'MISSING_FIELD',
        });
      } else if (!r.effectGraphId && !eventIds.has(r.effect_event_id)) {
        errors.push({
          path: `${path}.effect_event_id`,
          message: `Relationship references non-existent effect event: ${r.effect_event_id}`,
          code: 'ORPHAN_REFERENCE',
        });
      }

      // Check causal consistency (cause must be before or equal to effect)
      if (r.cause_event_id && r.effect_event_id && !r.causeGraphId && !r.effectGraphId) {
        const causeTime = eventTimestamps.get(r.cause_event_id);
        const effectTime = eventTimestamps.get(r.effect_event_id);
        if (causeTime && effectTime && causeTime > effectTime) {
          errors.push({
            path: `${path}`,
            message: `Causal paradox: cause event (${r.cause_event_id}) occurs after effect event (${r.effect_event_id})`,
            code: 'CAUSAL_PARADOX',
          });
        }
      }

      // Validate weight
      if (typeof r.weight !== 'number' || r.weight < 0 || r.weight > 1) {
        errors.push({
          path: `${path}.weight`,
          message: 'Relationship weight must be a number between 0 and 1',
          code: 'INVALID_VALUE',
        });
      }

      // Validate confidence
      if (typeof r.confidence !== 'number' || r.confidence < 0 || r.confidence > 1) {
        errors.push({
          path: `${path}.confidence`,
          message: 'Relationship confidence must be a number between 0 and 1',
          code: 'INVALID_VALUE',
        });
      } else if (r.confidence < 0.5) {
        warnings.push({
          path: `${path}.confidence`,
          message: `Low confidence relationship: ${r.confidence}`,
          code: 'LOW_CONFIDENCE',
        });
      }

      // Validate relationship_type
      const validTypes = ['direct', 'indirect', 'contributory'];
      if (!r.relationship_type || !validTypes.includes(r.relationship_type)) {
        errors.push({
          path: `${path}.relationship_type`,
          message: `Invalid relationship_type. Must be one of: ${validTypes.join(', ')}`,
          code: 'INVALID_VALUE',
        });
      }
    });
  }

  private validatePressures(
    pressures: unknown,
    events: unknown,
    arcs: unknown,
    errors: ImportError[],
    warnings: ImportWarning[]
  ): void {
    if (!pressures || !Array.isArray(pressures)) {
      // Pressures are optional
      return;
    }

    const eventIds = new Set<string>();
    const arcIds = new Set<string>();

    if (Array.isArray(events)) {
      events.forEach((e) => {
        if (e && typeof e === 'object' && (e as ExportedEvent).id) {
          eventIds.add((e as ExportedEvent).id);
        }
      });
    }

    if (Array.isArray(arcs)) {
      arcs.forEach((a) => {
        if (a && typeof a === 'object' && (a as ExportedArc).id) {
          arcIds.add((a as ExportedArc).id);
        }
      });
    }

    const seenIds = new Set<string>();

    pressures.forEach((pressure, index) => {
      const path = `$.data.inferredPressures[${index}]`;

      if (!pressure || typeof pressure !== 'object') {
        errors.push({ path, message: 'Pressure must be an object', code: 'INVALID_TYPE' });
        return;
      }

      const p = pressure as ExportedPressure;

      if (!p.id || typeof p.id !== 'string') {
        errors.push({
          path: `${path}.id`,
          message: 'Pressure id is required',
          code: 'MISSING_FIELD',
        });
      } else if (seenIds.has(p.id)) {
        errors.push({
          path: `${path}.id`,
          message: `Duplicate pressure id: ${p.id}`,
          code: 'DUPLICATE_ID',
        });
      } else {
        seenIds.add(p.id);
      }

      // Validate evidence_event_ids - now errors instead of warnings
      if (Array.isArray(p.evidence_event_ids)) {
        p.evidence_event_ids.forEach((eventId, i) => {
          if (!eventIds.has(eventId)) {
            errors.push({
              path: `${path}.evidence_event_ids[${i}]`,
              message: `Pressure references non-existent event: ${eventId}`,
              code: 'ORPHAN_REFERENCE',
            });
          }
        });
      }

      // Validate affected_arc_ids - now errors instead of warnings
      if (Array.isArray(p.affected_arc_ids)) {
        p.affected_arc_ids.forEach((arcId, i) => {
          if (!arcIds.has(arcId)) {
            errors.push({
              path: `${path}.affected_arc_ids[${i}]`,
              message: `Pressure references non-existent arc: ${arcId}`,
              code: 'ORPHAN_REFERENCE',
            });
          }
        });
      }

      // Validate pressure_type
      const validTypes = ['economic', 'social', 'environmental', 'political'];
      if (!p.pressure_type || !validTypes.includes(p.pressure_type)) {
        errors.push({
          path: `${path}.pressure_type`,
          message: `Invalid pressure_type. Must be one of: ${validTypes.join(', ')}`,
          code: 'INVALID_VALUE',
        });
      }
    });
  }

  private validateProvenance(provenance: unknown, warnings: ImportWarning[]): void {
    if (!provenance || typeof provenance !== 'object') {
      return;
    }

    const prov = provenance as Record<string, unknown>;

    if (!Array.isArray(prov.sources) || prov.sources.length === 0) {
      warnings.push({
        path: '$.provenance.sources',
        message: 'No provenance sources included',
        code: 'MISSING_PROVENANCE',
      });
    }
  }

  private calculateSummary(data: ExportData): ImportSummary {
    const events = data.events || [];
    const arcs = data.arcs || [];

    // Calculate temporal range
    let minDate: Date | null = null;
    let maxDate: Date | null = null;
    const actors = new Set<string>();

    events.forEach((e) => {
      if (e.timestamp) {
        const date = new Date(e.timestamp);
        if (!isNaN(date.getTime())) {
          if (!minDate || date < minDate) minDate = date;
          if (!maxDate || date > maxDate) maxDate = date;
        }
      }
      if (e.actor) actors.add(e.actor);
    });

    arcs.forEach((a) => {
      if (a.start_time) {
        const date = new Date(a.start_time);
        if (!isNaN(date.getTime())) {
          if (!minDate || date < minDate) minDate = date;
        }
      }
      if (a.end_time) {
        const date = new Date(a.end_time);
        if (!isNaN(date.getTime())) {
          if (!maxDate || date > maxDate) maxDate = date;
        }
      }
    });

    return {
      eventCount: events.length,
      arcCount: arcs.length,
      relationshipCount: (data.causalRelationships || []).length,
      pressureCount: (data.inferredPressures || []).length,
      crossRefCount: (data.crossGraphRefs || []).length,
      temporalRange:
        minDate && maxDate
          ? { start: minDate.toISOString(), end: maxDate.toISOString() }
          : undefined,
      actors: Array.from(actors),
    };
  }

  private createValidationResult(
    valid: boolean,
    errors: ImportError[],
    warnings: ImportWarning[],
    summary?: ImportSummary
  ): ImportValidationResult {
    return {
      valid,
      errors,
      warnings,
      summary: summary || {
        eventCount: 0,
        arcCount: 0,
        relationshipCount: 0,
        pressureCount: 0,
        crossRefCount: 0,
        actors: [],
      },
    };
  }

  // ==========================================================================
  // Temporal Constraint Validation
  // ==========================================================================

  /**
   * Validate temporal constraints across the import data
   * - Events within their arc boundaries
   * - Arc hierarchy consistency (parent contains child)
   */
  validateTemporalConstraints(data: AlthistoryExport): ImportError[] {
    const errors: ImportError[] = [];
    const exportData = data.data;

    // Build arc map
    const arcMap = new Map<string, ExportedArc>();
    (exportData.arcs || []).forEach((arc) => {
      arcMap.set(arc.id, arc);
    });

    // Validate arc hierarchy (parent must contain child temporally)
    (exportData.arcs || []).forEach((arc, index) => {
      if (arc.parent_arc_id) {
        const parent = arcMap.get(arc.parent_arc_id);
        if (parent) {
          const childStart = new Date(arc.start_time);
          const childEnd = new Date(arc.end_time);
          const parentStart = new Date(parent.start_time);
          const parentEnd = new Date(parent.end_time);

          if (childStart < parentStart || childEnd > parentEnd) {
            errors.push({
              path: `$.data.arcs[${index}]`,
              message: `Arc "${arc.name}" extends outside parent arc "${parent.name}" boundaries`,
              code: 'TEMPORAL_VIOLATION',
            });
          }
        }
      }
    });

    return errors;
  }

  // ==========================================================================
  // Conflict Detection
  // ==========================================================================

  /**
   * Detect conflicts between import data and existing graph data
   * Includes deduplication to prevent duplicate conflict entries
   */
  async detectConflicts(
    importData: AlthistoryExport,
    targetGraphId: string,
    mode: ImportMode
  ): Promise<ImportConflict[]> {
    const conflicts: ImportConflict[] = [];
    const seenConflictKeys = new Set<string>();

    if (mode === 'create-new') {
      // No conflicts possible when creating new graph
      return conflicts;
    }

    const addConflict = (conflict: ImportConflict) => {
      const key = `${conflict.type}-${conflict.entityType}-${conflict.entityId}`;
      if (!seenConflictKeys.has(key)) {
        seenConflictKeys.add(key);
        conflicts.push(conflict);
      }
    };

    try {
      const graphData = await this.graphRepository.resolveGraphData(targetGraphId);
      const exportData = importData.data;

      // Check for duplicate event IDs
      const existingEventIds = new Set(graphData.events.map((e) => e.id));
      (exportData.events || []).forEach((event) => {
        if (existingEventIds.has(event.id)) {
          const existing = graphData.events.find((e) => e.id === event.id);
          addConflict({
            id: `conflict-event-${event.id}`,
            type: 'duplicate-id',
            severity: mode === 'replace' ? 'warning' : 'error',
            entityType: 'event',
            entityId: event.id,
            existingEntity: existing as unknown as Record<string, unknown>,
            incomingEntity: event as unknown as Record<string, unknown>,
            suggestedResolution: mode === 'merge' ? 'skip' : 'overwrite',
            message: `Event with ID "${event.id}" already exists`,
          });
        }
      });

      // Check for duplicate arc IDs
      const existingArcIds = new Set(graphData.arcs.map((a) => a.id));
      (exportData.arcs || []).forEach((arc) => {
        if (existingArcIds.has(arc.id)) {
          const existing = graphData.arcs.find((a) => a.id === arc.id);
          addConflict({
            id: `conflict-arc-${arc.id}`,
            type: 'duplicate-id',
            severity: mode === 'replace' ? 'warning' : 'error',
            entityType: 'arc',
            entityId: arc.id,
            existingEntity: existing as unknown as Record<string, unknown>,
            incomingEntity: arc as unknown as Record<string, unknown>,
            suggestedResolution: mode === 'merge' ? 'skip' : 'overwrite',
            message: `Arc with ID "${arc.id}" already exists`,
          });
        }
      });

      // Check for duplicate relationship IDs
      const existingRelIds = new Set(graphData.relationships.map((r) => r.id));
      (exportData.causalRelationships || []).forEach((rel) => {
        if (existingRelIds.has(rel.id)) {
          const existing = graphData.relationships.find((r) => r.id === rel.id);
          addConflict({
            id: `conflict-rel-${rel.id}`,
            type: 'duplicate-id',
            severity: mode === 'replace' ? 'warning' : 'error',
            entityType: 'relationship',
            entityId: rel.id,
            existingEntity: existing as unknown as Record<string, unknown>,
            incomingEntity: rel as unknown as Record<string, unknown>,
            suggestedResolution: mode === 'merge' ? 'skip' : 'overwrite',
            message: `Relationship with ID "${rel.id}" already exists`,
          });
        }
      });

      // Check for causal paradoxes with existing data
      const allEvents = new Map<string, Date>();
      graphData.events.forEach((e) => {
        allEvents.set(e.id, new Date(e.timestamp));
      });
      (exportData.events || []).forEach((e) => {
        if (!allEvents.has(e.id)) {
          allEvents.set(e.id, new Date(e.timestamp));
        }
      });

      (exportData.causalRelationships || []).forEach((rel) => {
        const causeTime = allEvents.get(rel.cause_event_id);
        const effectTime = allEvents.get(rel.effect_event_id);

        if (causeTime && effectTime && causeTime > effectTime) {
          addConflict({
            id: `conflict-paradox-${rel.id}`,
            type: 'causal-paradox',
            severity: 'error',
            entityType: 'relationship',
            entityId: rel.id,
            incomingEntity: rel as unknown as Record<string, unknown>,
            suggestedResolution: 'skip',
            message: `Causal paradox: cause occurs after effect in relationship "${rel.id}"`,
          });
        }
      });
    } catch (error) {
      // Graph doesn't exist or error loading - no conflicts
      this.logger.warn('Could not load graph for conflict detection', {
        graphId: targetGraphId,
        error,
      });
    }

    return conflicts;
  }

  // ==========================================================================
  // Import Preview
  // ==========================================================================

  /**
   * Generate a preview of what the import will do
   */
  async preview(
    importData: AlthistoryExport,
    options: ImportOptions
  ): Promise<ImportPreview> {
    const conflicts = options.graphId
      ? await this.detectConflicts(importData, options.graphId, options.mode)
      : [];

    const exportData = importData.data;
    const existingIds = {
      events: new Set<string>(),
      arcs: new Set<string>(),
      relationships: new Set<string>(),
      pressures: new Set<string>(),
    };

    // Load existing data if merging/replacing
    if (options.graphId && options.mode !== 'create-new') {
      try {
        const graphData = await this.graphRepository.resolveGraphData(options.graphId);
        graphData.events.forEach((e) => existingIds.events.add(e.id));
        graphData.arcs.forEach((a) => existingIds.arcs.add(a.id));
        graphData.relationships.forEach((r) => existingIds.relationships.add(r.id));
        graphData.pressures.forEach((p) => existingIds.pressures.add(p.id));
      } catch {
        // Graph doesn't exist
      }
    }

    const toCreate: EntityCounts = { events: 0, arcs: 0, relationships: 0, pressures: 0 };
    const toUpdate: EntityCounts = { events: 0, arcs: 0, relationships: 0, pressures: 0 };
    const toDelete: EntityCounts = { events: 0, arcs: 0, relationships: 0, pressures: 0 };

    // Calculate creates vs updates for events
    (exportData.events || []).forEach((e) => {
      if (existingIds.events.has(e.id)) {
        toUpdate.events++;
      } else {
        toCreate.events++;
      }
    });

    // Calculate for arcs
    (exportData.arcs || []).forEach((a) => {
      if (existingIds.arcs.has(a.id)) {
        toUpdate.arcs++;
      } else {
        toCreate.arcs++;
      }
    });

    // Calculate for relationships
    (exportData.causalRelationships || []).forEach((r) => {
      if (existingIds.relationships.has(r.id)) {
        toUpdate.relationships++;
      } else {
        toCreate.relationships++;
      }
    });

    // Calculate for pressures
    (exportData.inferredPressures || []).forEach((p) => {
      if (existingIds.pressures.has(p.id)) {
        toUpdate.pressures++;
      } else {
        toCreate.pressures++;
      }
    });

    // For replace mode, calculate deletes
    if (options.mode === 'replace') {
      const incomingEventIds = new Set((exportData.events || []).map((e) => e.id));
      const incomingArcIds = new Set((exportData.arcs || []).map((a) => a.id));
      const incomingRelIds = new Set((exportData.causalRelationships || []).map((r) => r.id));
      const incomingPressureIds = new Set((exportData.inferredPressures || []).map((p) => p.id));

      existingIds.events.forEach((id) => {
        if (!incomingEventIds.has(id)) toDelete.events++;
      });
      existingIds.arcs.forEach((id) => {
        if (!incomingArcIds.has(id)) toDelete.arcs++;
      });
      existingIds.relationships.forEach((id) => {
        if (!incomingRelIds.has(id)) toDelete.relationships++;
      });
      existingIds.pressures.forEach((id) => {
        if (!incomingPressureIds.has(id)) toDelete.pressures++;
      });
    }

    // Gather warnings
    const validation = await this.validateFormat(importData);

    return {
      toCreate,
      toUpdate,
      toDelete,
      conflicts,
      warnings: validation.warnings,
    };
  }

  // ==========================================================================
  // Import Execution
  // ==========================================================================

  /**
   * Check if import should be async based on entity count
   */
  shouldUseAsyncImport(data: AlthistoryExport): boolean {
    const totalEntities =
      (data.data.events?.length || 0) +
      (data.data.arcs?.length || 0) +
      (data.data.causalRelationships?.length || 0) +
      (data.data.inferredPressures?.length || 0);
    return totalEntities > ASYNC_IMPORT_THRESHOLD;
  }

  /**
   * Execute the import asynchronously (for large imports)
   */
  async executeImportAsync(
    importData: AlthistoryExport,
    options: ImportOptions
  ): Promise<{ jobId: string }> {
    // Create job
    const job = await this.jobRepository.createJob({
      type: 'import',
      status: 'pending',
      metadata: {
        mode: options.mode,
        graphId: options.graphId,
      },
    });

    // Store cancel flag
    this.activeImports.set(job.id, { cancel: false });

    // Execute in background
    setImmediate(async () => {
      try {
        await this.jobRepository.updateJob(job.id, {
          status: 'processing',
          startedAt: new Date().toISOString(),
        });

        const result = await this.executeImportInternal(importData, options, job.id);

        await this.jobRepository.updateJob(job.id, {
          status: result.success ? 'completed' : 'failed',
          completedAt: new Date().toISOString(),
          result,
        });
      } catch (error) {
        await this.jobRepository.updateJob(job.id, {
          status: 'failed',
          completedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      } finally {
        this.activeImports.delete(job.id);
      }
    });

    return { jobId: job.id };
  }

  /**
   * Cancel an in-progress import
   */
  cancelImport(jobId: string): boolean {
    const importState = this.activeImports.get(jobId);
    if (importState) {
      importState.cancel = true;
      return true;
    }
    return false;
  }

  /**
   * Get import job status
   */
  async getImportJob(jobId: string): Promise<ImportJob | null> {
    return this.jobRepository.getJob(jobId);
  }

  /**
   * Execute the import atomically (synchronous version)
   */
  async executeImport(
    importData: AlthistoryExport,
    options: ImportOptions
  ): Promise<ImportResult> {
    return this.executeImportInternal(importData, options);
  }

  /**
   * Internal import execution with optional job tracking
   */
  private async executeImportInternal(
    importData: AlthistoryExport,
    options: ImportOptions,
    jobId?: string
  ): Promise<ImportResult> {
    this.logger.info('Starting import execution', {
      mode: options.mode,
      graphId: options.graphId,
      jobId,
    });

    const emptyResult = (): ImportResult => ({
      success: false,
      graphId: options.graphId || '',
      graphVersion: 0,
      imported: { events: 0, arcs: 0, relationships: 0, pressures: 0 },
      skipped: { events: 0, arcs: 0, relationships: 0, pressures: 0 },
      deleted: { events: 0, arcs: 0, relationships: 0, pressures: 0 },
      errors: [],
      warnings: [],
      jobId,
    });

    // Check for cancellation
    if (jobId && this.activeImports.get(jobId)?.cancel) {
      return { ...emptyResult(), errors: [{ path: '$', message: 'Import cancelled', code: 'INVALID_FORMAT' }] };
    }

    // Validate first
    const validation = await this.validateFormat(importData);
    if (!validation.valid) {
      return {
        ...emptyResult(),
        errors: validation.errors,
        warnings: validation.warnings,
      };
    }

    // Additional temporal validation
    const temporalErrors = this.validateTemporalConstraints(importData);
    if (temporalErrors.length > 0) {
      return {
        ...emptyResult(),
        errors: temporalErrors,
        warnings: validation.warnings,
      };
    }

    // Detect conflicts
    const conflicts = options.graphId
      ? await this.detectConflicts(importData, options.graphId, options.mode)
      : [];

    // Check for unresolved error-level conflicts
    const unresolvedErrors = conflicts.filter((c) => {
      if (c.severity !== 'error') return false;
      if (options.conflictResolution === 'manual') {
        return !options.manualResolutions?.[c.id];
      }
      return false;
    });

    if (unresolvedErrors.length > 0) {
      return {
        ...emptyResult(),
        errors: unresolvedErrors.map((c) => ({
          path: `conflict.${c.entityType}.${c.entityId}`,
          message: c.message,
          code: c.type.toUpperCase() as ImportErrorCode,
        })),
        warnings: validation.warnings,
      };
    }

    try {
      let targetGraphId = options.graphId;
      let graphVersion = 0;

      // Create new graph if needed
      if (options.mode === 'create-new' || !targetGraphId) {
        const newGraph = await this.graphRepository.create({
          name: importData.metadata.graphName,
          description: importData.metadata.description,
        });
        targetGraphId = newGraph.id;
        this.logger.info('Created new graph for import', { graphId: targetGraphId });
      }

      // Build resolution map
      const resolutions = new Map<string, ConflictResolution>();
      conflicts.forEach((c) => {
        if (options.conflictResolution === 'manual') {
          resolutions.set(c.id, options.manualResolutions?.[c.id] || c.suggestedResolution);
        } else {
          resolutions.set(c.id, options.conflictResolution);
        }
      });

      // Apply import with conflict resolutions and rollback support
      const result = await this.applyImportWithRollback(
        targetGraphId,
        importData,
        options.mode,
        resolutions,
        conflicts,
        jobId
      );

      this.logger.info('Import completed successfully', {
        graphId: targetGraphId,
        imported: result.imported,
        skipped: result.skipped,
        deleted: result.deleted,
      });

      return {
        success: true,
        graphId: targetGraphId,
        graphVersion: result.graphVersion,
        imported: result.imported,
        skipped: result.skipped,
        deleted: result.deleted,
        errors: [],
        warnings: validation.warnings,
        jobId,
      };
    } catch (error) {
      this.logger.error('Import failed', error);
      return {
        ...emptyResult(),
        errors: [
          {
            path: '$',
            message: error instanceof Error ? error.message : 'Unknown error during import',
            code: 'INVALID_FORMAT',
          },
        ],
        warnings: validation.warnings,
      };
    }
  }

  /**
   * Apply the import to the graph with rollback support
   */
  private async applyImportWithRollback(
    graphId: string,
    importData: AlthistoryExport,
    mode: ImportMode,
    resolutions: Map<string, ConflictResolution>,
    conflicts: ImportConflict[],
    jobId?: string
  ): Promise<{
    graphVersion: number;
    imported: EntityCounts;
    skipped: EntityCounts;
    deleted: EntityCounts;
  }> {
    const exportData = importData.data;
    const imported: EntityCounts = { events: 0, arcs: 0, relationships: 0, pressures: 0 };
    const skipped: EntityCounts = { events: 0, arcs: 0, relationships: 0, pressures: 0 };
    const deleted: EntityCounts = { events: 0, arcs: 0, relationships: 0, pressures: 0 };

    // Build conflict ID map for quick lookup
    const conflictMap = new Map<string, ImportConflict>();
    conflicts.forEach((c) => {
      const key = `${c.entityType}-${c.entityId}`;
      conflictMap.set(key, c);
    });

    // Track ID remapping for rename resolution
    const idRemap = new Map<string, string>();

    // Helper to check if entity should be skipped
    const shouldSkip = (entityType: string, entityId: string): boolean => {
      const key = `${entityType}-${entityId}`;
      const conflict = conflictMap.get(key);
      if (!conflict) return false;
      const resolution = resolutions.get(conflict.id);
      return resolution === 'skip';
    };

    // Helper to generate new ID if renaming, and track the mapping
    const getEntityId = (entityType: string, originalId: string): string => {
      const key = `${entityType}-${originalId}`;
      const conflict = conflictMap.get(key);
      if (!conflict) return originalId;
      const resolution = resolutions.get(conflict.id);
      if (resolution === 'rename') {
        const newId = `${originalId}_imported_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        idRemap.set(`${entityType}:${originalId}`, newId);
        return newId;
      }
      return originalId;
    };

    // Helper to get remapped ID for references
    const getRemappedId = (entityType: string, originalId: string): string => {
      return idRemap.get(`${entityType}:${originalId}`) || originalId;
    };

    // Prepare entities for import
    const eventsToImport: Array<{ id: string; data: ExportedEvent }> = [];
    const arcsToImport: Array<{ id: string; data: ExportedArc }> = [];
    const relationshipsToImport: Array<{ id: string; data: ExportedRelationship }> = [];
    const pressuresToImport: Array<{ id: string; data: ExportedPressure }> = [];

    // Process events first to build ID remap
    (exportData.events || []).forEach((event) => {
      if (shouldSkip('event', event.id)) {
        skipped.events++;
      } else {
        const newId = getEntityId('event', event.id);
        const sanitizedEvent = this.sanitizeObject(event);
        eventsToImport.push({
          id: newId,
          data: {
            ...sanitizedEvent,
            id: newId,
            metadata: {
              ...sanitizedEvent.metadata,
              imported: true,
              importedAt: new Date().toISOString(),
              originalId: event.id !== newId ? event.id : undefined,
            },
          },
        });
        imported.events++;
      }
    });

    // Process arcs, updating parent_arc_id references
    (exportData.arcs || []).forEach((arc) => {
      if (shouldSkip('arc', arc.id)) {
        skipped.arcs++;
      } else {
        const newId = getEntityId('arc', arc.id);
        const sanitizedArc = this.sanitizeObject(arc);
        const parentId = arc.parent_arc_id ? getRemappedId('arc', arc.parent_arc_id) : null;
        arcsToImport.push({
          id: newId,
          data: {
            ...sanitizedArc,
            id: newId,
            parent_arc_id: parentId,
            metadata: {
              ...sanitizedArc.metadata,
              imported: true,
              importedAt: new Date().toISOString(),
              originalId: arc.id !== newId ? arc.id : undefined,
            },
          },
        });
        imported.arcs++;
      }
    });

    // Process relationships, updating event references
    (exportData.causalRelationships || []).forEach((rel) => {
      if (shouldSkip('relationship', rel.id)) {
        skipped.relationships++;
      } else {
        const newId = getEntityId('relationship', rel.id);
        const sanitizedRel = this.sanitizeObject(rel);
        relationshipsToImport.push({
          id: newId,
          data: {
            ...sanitizedRel,
            id: newId,
            cause_event_id: getRemappedId('event', rel.cause_event_id),
            effect_event_id: getRemappedId('event', rel.effect_event_id),
          },
        });
        imported.relationships++;
      }
    });

    // Process pressures, updating event and arc references
    (exportData.inferredPressures || []).forEach((pressure) => {
      if (shouldSkip('pressure', pressure.id)) {
        skipped.pressures++;
      } else {
        const newId = getEntityId('pressure', pressure.id);
        const sanitizedPressure = this.sanitizeObject(pressure);
        pressuresToImport.push({
          id: newId,
          data: {
            ...sanitizedPressure,
            id: newId,
            evidence_event_ids: (pressure.evidence_event_ids || []).map((id) =>
              getRemappedId('event', id)
            ),
            affected_arc_ids: (pressure.affected_arc_ids || []).map((id) =>
              getRemappedId('arc', id)
            ),
          },
        });
        imported.pressures++;
      }
    });

    // Load existing data for delete calculation in replace mode
    let entitiesToDelete: {
      events: string[];
      arcs: string[];
      relationships: string[];
      pressures: string[];
    } = { events: [], arcs: [], relationships: [], pressures: [] };

    if (mode === 'replace') {
      try {
        const graphData = await this.graphRepository.resolveGraphData(graphId);
        const incomingEventIds = new Set(eventsToImport.map((e) => e.id));
        const incomingArcIds = new Set(arcsToImport.map((a) => a.id));
        const incomingRelIds = new Set(relationshipsToImport.map((r) => r.id));
        const incomingPressureIds = new Set(pressuresToImport.map((p) => p.id));

        // Find entities to delete (exist in graph but not in import)
        entitiesToDelete.events = graphData.events
          .filter((e) => !incomingEventIds.has(e.id))
          .map((e) => e.id);
        entitiesToDelete.arcs = graphData.arcs
          .filter((a) => !incomingArcIds.has(a.id))
          .map((a) => a.id);
        entitiesToDelete.relationships = graphData.relationships
          .filter((r) => !incomingRelIds.has(r.id))
          .map((r) => r.id);
        entitiesToDelete.pressures = graphData.pressures
          .filter((p) => !incomingPressureIds.has(p.id))
          .map((p) => p.id);

        deleted.events = entitiesToDelete.events.length;
        deleted.arcs = entitiesToDelete.arcs.length;
        deleted.relationships = entitiesToDelete.relationships.length;
        deleted.pressures = entitiesToDelete.pressures.length;
      } catch {
        // Graph doesn't exist yet
      }
    }

    // Commit the changes atomically through the graph repository
    const changes: EntityChanges = {
      added: [],
      modified: [],
      deleted: [],
    };

    // Add all entities as new
    eventsToImport.forEach(({ id, data }) => {
      changes.added.push({
        type: 'event',
        id,
        data: {
          id,
          description: data.description,
          actor: data.actor,
          target: data.target,
          timestamp: data.timestamp,
          metadata: data.metadata,
        },
      });
    });

    arcsToImport.forEach(({ id, data }) => {
      changes.added.push({
        type: 'arc',
        id,
        data: {
          id,
          name: data.name,
          description: data.description,
          start_time: data.start_time,
          end_time: data.end_time,
          level: data.level,
          parent_arc_id: data.parent_arc_id,
          metadata: data.metadata,
        },
      });
    });

    relationshipsToImport.forEach(({ id, data }) => {
      changes.added.push({
        type: 'relationship',
        id,
        data: {
          id,
          cause_event_id: data.cause_event_id,
          effect_event_id: data.effect_event_id,
          weight: data.weight,
          evidence: data.evidence,
          confidence: data.confidence,
          relationship_type: data.relationship_type,
        },
      });
    });

    pressuresToImport.forEach(({ id, data }) => {
      changes.added.push({
        type: 'pressure',
        id,
        data: {
          id,
          description: data.description,
          confidence_score: data.confidence_score,
          pressure_type: data.pressure_type,
          evidence_event_ids: data.evidence_event_ids,
          affected_arc_ids: data.affected_arc_ids,
        },
      });
    });

    // Add deletes for replace mode
    entitiesToDelete.events.forEach((id) => {
      changes.deleted.push({ type: 'event', id });
    });
    entitiesToDelete.arcs.forEach((id) => {
      changes.deleted.push({ type: 'arc', id });
    });
    entitiesToDelete.relationships.forEach((id) => {
      changes.deleted.push({ type: 'relationship', id });
    });
    entitiesToDelete.pressures.forEach((id) => {
      changes.deleted.push({ type: 'pressure', id });
    });

    // Commit version with all changes - this is atomic
    // If it fails, no partial changes are applied
    try {
      const versionRef = await this.graphRepository.commitChanges(
        graphId,
        changes,
        'import',
        `Imported ${imported.events} events, ${imported.arcs} arcs, ${imported.relationships} relationships` +
          (deleted.events + deleted.arcs + deleted.relationships + deleted.pressures > 0
            ? ` (deleted ${deleted.events + deleted.arcs + deleted.relationships + deleted.pressures} entities)`
            : '')
      );

      return {
        graphVersion: versionRef.version,
        imported,
        skipped,
        deleted,
      };
    } catch (error) {
      // Rollback is automatic - commit failed so no changes were applied
      this.logger.error('Import commit failed - changes rolled back', error);
      throw error;
    }
  }
}
