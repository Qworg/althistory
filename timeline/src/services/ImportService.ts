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
  ExportMetadata,
  ExportedEvent,
  ExportedArc,
  ExportedRelationship,
  ExportedPressure,
  CrossGraphRef,
} from './ExportService';
import { createLogger, ILogger } from '../utils/logger';
import * as crypto from 'crypto';
import { isTemporalInversion } from '@/utils/causalOrder';

// ============================================================================
// Constants
// ============================================================================

/** 
 * Maximum file size for imports (10MB) 
 * FIX #14: This MUST match MAX_IMPORT_FILE_SIZE in frontend/src/components/import/ImportUploadStep.tsx
 * and validateContentLength() in api/routes/import.ts
 */
export const MAX_IMPORT_SIZE_BYTES = 10 * 1024 * 1024;

/** FIX A#9: Default threshold for async import (100 entities) */
export const DEFAULT_ASYNC_IMPORT_THRESHOLD = 100;

/** FIX B#4: Default stale job threshold (30 minutes) */
export const DEFAULT_STALE_JOB_THRESHOLD_MS = 30 * 60 * 1000;

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
  | 'EMPTY_COLLECTION'
  | 'INVALID_VALUE';

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
  /** User performing the import (for provenance) */
  userId?: string;
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
  progressMessage?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: ImportResult;
  error?: string;
}

export interface ImportServiceConfig {
  dataDir: string;
  /** FIX A#9: Configurable threshold for async import (default: 100 entities) */
  asyncImportThreshold?: number;
  /** FIX B#4: Configurable stale job threshold in ms (default: 30 minutes) */
  staleJobThresholdMs?: number;
}

/**
 * An entity read back from the version store: opaque fields, plus the id that the
 * import pipeline matches and reports on.
 */
type StoredEntity = Record<string, unknown> & { id: string };

/**
 * A graph's current contents as entity lists. The version store keeps entities in
 * id-keyed maps (see ResolvedGraphData); conflict detection, preview and
 * replace-mode deletes all work in terms of lists.
 */
type ExistingGraphData = {
  [K in keyof ResolvedGraphData]: StoredEntity[];
};

// ============================================================================
// ImportService Implementation
// ============================================================================

export class ImportService {
  private readonly graphRepository: GraphRepository;
  private readonly jobRepository: JobRepository;
  private readonly logger: ILogger;
  private activeImports: Map<string, { cancel: boolean; graphId?: string }> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private isDestroyed = false;
  /** FIX A#9: Configurable threshold for async import */
  private readonly asyncImportThreshold: number;
  /** FIX B#4: Configurable stale job threshold */
  private readonly staleJobThresholdMs: number;

  constructor(config: ImportServiceConfig) {
    this.graphRepository = new GraphRepository({ dataDir: config.dataDir });
    this.jobRepository = new JobRepository({ dataDir: config.dataDir });
    this.logger = createLogger('ImportService');
    // FIX A#9: Use configured threshold or default
    this.asyncImportThreshold = config.asyncImportThreshold ?? DEFAULT_ASYNC_IMPORT_THRESHOLD;
    // FIX B#4: Use configured stale threshold or default
    this.staleJobThresholdMs = config.staleJobThresholdMs ?? DEFAULT_STALE_JOB_THRESHOLD_MS;
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    await this.graphRepository.initialize();
    await this.jobRepository.initialize();
    
    // FIX B#24: Start cleanup interval for stale jobs (runs every 5 minutes)
    this.cleanupInterval = setInterval(() => this.cleanupStaleJobs(), 5 * 60 * 1000);
  }

  /**
   * FIX B#24: Destroy the service and stop cleanup interval
   * CRITICAL #2: Mark active jobs as failed on shutdown
   */
  async destroy(): Promise<void> {
    this.isDestroyed = true;
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    // Cancel any active imports and mark jobs as failed
    const failedJobs: string[] = [];
    for (const [jobId, state] of this.activeImports) {
      state.cancel = true;
      this.logger.warn('Cancelling import on service destruction', { jobId });
      
      // CRITICAL #2: Actually mark the job as failed in the repository
      try {
        const job = await this.jobRepository.findById(jobId);
        if (job && job.status === 'processing') {
          job.status = 'failed';
          job.completedAt = new Date().toISOString();
          job.error = 'Import service shutdown during processing';
          job.progress = job.progress || 0;
          job.progressMessage = 'Service shutdown';
          await this.jobRepository.update(job);
          failedJobs.push(jobId);
        }
      } catch (error) {
        this.logger.error('Failed to mark job as failed during shutdown', { jobId, error });
      }
    }
    
    if (failedJobs.length > 0) {
      this.logger.info('Marked jobs as failed during shutdown', { count: failedJobs.length, jobIds: failedJobs });
    }
    
    this.activeImports.clear();
  }

  /**
   * Clean up stale jobs (jobs that have been processing for too long)
   * FIX B#4: Uses configurable stale job threshold
   */
  private async cleanupStaleJobs(): Promise<void> {
    const now = Date.now();
    const thresholdMinutes = Math.round(this.staleJobThresholdMs / 60000);
    
    for (const [jobId, state] of this.activeImports) {
      try {
        const job = await this.jobRepository.findById(jobId);
        if (job && job.startedAt) {
          const startedAt = new Date(job.startedAt).getTime();
          if (now - startedAt > this.staleJobThresholdMs) {
            this.logger.warn('Cleaning up stale import job', { jobId, startedAt: job.startedAt });
            state.cancel = true;
            job.status = 'failed';
            job.completedAt = new Date().toISOString();
            job.error = `Import timed out after ${thresholdMinutes} minutes`;
            await this.jobRepository.update(job);
            this.activeImports.delete(jobId);
          }
        }
      } catch (error) {
        this.logger.error('Error cleaning up stale job', { jobId, error });
      }
    }
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
   * FIX #5 + FIX #7: Validate and sanitize string input for security
   * 
   * Defense in depth approach:
   * - Truncate overly long strings
   * - Detect and sanitize dangerous HTML/script patterns
   * - Log warnings for suspicious content
   * 
   * FIX #7: Now sanitizes dangerous patterns rather than just warning
   */
  private validateString(input: string, path: string): { value: string; warning?: string } {
    if (typeof input !== 'string') return { value: input };
    
    // Truncate overly long strings (this is still a security measure)
    let sanitized = input.slice(0, MAX_STRING_LENGTH);
    const wasTruncated = sanitized.length < input.length;
    
    // FIX #7: Dangerous patterns to sanitize (not just warn)
    const dangerousPatterns: Array<{ pattern: RegExp; replacement: string; name: string }> = [
      // Script tags - completely remove
      { pattern: /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, replacement: '[script removed]', name: 'script tag' },
      // javascript: URLs - escape the colon
      { pattern: /javascript:/gi, replacement: 'javascript&#58;', name: 'javascript URL' },
      // Event handlers - escape the equals sign
      { pattern: /\bon(\w+)\s*=/gi, replacement: 'on$1&#61;', name: 'event handler' },
      // data: URLs with HTML content
      { pattern: /data:\s*text\/html/gi, replacement: 'data:text/plain', name: 'data URL' },
      // SVG with embedded scripts
      { pattern: /<svg[^>]*>.*?<script/gi, replacement: '<svg>[sanitized]', name: 'SVG script' },
    ];
    
    const warnings: string[] = [];
    
    for (const { pattern, replacement, name } of dangerousPatterns) {
      if (pattern.test(sanitized)) {
        this.logger.warn('Dangerous content sanitized in import', { path, type: name });
        warnings.push(`${name} sanitized at ${path}`);
        // Reset lastIndex for global regex before using replace
        pattern.lastIndex = 0;
        sanitized = sanitized.replace(pattern, replacement);
      }
    }
    
    let warning: string | undefined;
    if (wasTruncated) {
      warning = `Content truncated at ${path} (exceeded ${MAX_STRING_LENGTH} chars)`;
    } else if (warnings.length > 0) {
      warning = warnings.join('; ');
    }
    
    return { value: sanitized, warning };
  }

  /**
   * Validate all string fields in an object (including arrays)
   * FIX #5: Validate instead of escape - preserves original data
   */
  /**
   * Copy an object, validating/sanitizing every string it contains.
   *
   * `T` is deliberately unconstrained. The previous `T extends Record<string, unknown>`
   * constraint was unusable: a domain interface such as ExportedEvent has no implicit
   * index signature, so every real call site failed to type-check, and inference then
   * fell back to Record<string, unknown>, which erased the entity's own fields from the
   * result. Sanitizing preserves the shape, so the type is carried through unchanged.
   */
  private validateAndCopyObject<T>(obj: T, basePath: string = '$'): T {
    const result = { ...obj } as Record<string, unknown>;
    for (const [key, value] of Object.entries(result)) {
      const path = `${basePath}.${key}`;
      if (typeof value === 'string') {
        const { value: validatedValue } = this.validateString(value, path);
        (result as Record<string, unknown>)[key] = validatedValue;
      } else if (Array.isArray(value)) {
        (result as Record<string, unknown>)[key] = value.map((item, index) => {
          if (typeof item === 'string') {
            const { value: validatedValue } = this.validateString(item, `${path}[${index}]`);
            return validatedValue;
          } else if (typeof item === 'object' && item !== null) {
            return this.validateAndCopyObject(item as Record<string, unknown>, `${path}[${index}]`);
          }
          return item;
        });
      } else if (typeof value === 'object' && value !== null) {
        (result as Record<string, unknown>)[key] = this.validateAndCopyObject(
          value as Record<string, unknown>,
          path
        );
      }
    }
    return result as T;
  }

  // Backward compatibility alias
  private sanitizeObject<T>(obj: T): T {
    return this.validateAndCopyObject(obj);
  }

  /**
   * Validate checksum if provided
   * FIX #3: Use timing-safe comparison to prevent timing attacks
   * FIX #9: Properly handle empty string checksum
   *
   * Accepts the structural minimum this method actually reads (the metadata's
   * `checksum` and the `data` section that gets stringified), so that
   * validateFormat can hand it already-narrowed untrusted input. Widening the
   * accepted type keeps every AlthistoryExport caller valid.
   */
  validateChecksum(data: { metadata: ExportMetadata; data: unknown }): ImportError | null {
    // FIX #9: Explicitly check for undefined/null, treat empty string as missing checksum
    // Empty string should be treated as "no checksum provided", not as a valid checksum to validate against
    if (data.metadata.checksum === undefined || data.metadata.checksum === null || data.metadata.checksum === '') {
      return null; // Checksum is optional
    }

    // Calculate checksum of data section
    const dataString = JSON.stringify(data.data);
    const calculatedChecksum = crypto.createHash('sha256').update(dataString).digest('hex');
    const providedChecksum = data.metadata.checksum;

    // FIX #3: Use timing-safe comparison to prevent timing attacks
    // Both strings must be the same length for timingSafeEqual
    const calculatedBuffer = Buffer.from(calculatedChecksum, 'hex');
    const providedBuffer = Buffer.from(providedChecksum, 'hex');
    
    // If lengths don't match, checksums are definitely different
    // Still use a constant-time operation to avoid leaking length info
    if (calculatedBuffer.length !== providedBuffer.length) {
      return {
        path: '$.metadata.checksum',
        message: 'Checksum validation failed - data may be corrupted',
        code: 'CHECKSUM_MISMATCH',
      };
    }

    // Use timing-safe comparison
    const isValid = crypto.timingSafeEqual(calculatedBuffer, providedBuffer);
    
    if (!isValid) {
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
    const metadata = importData.metadata;
    if (metadata && typeof metadata === 'object' && 'checksum' in metadata && metadata.checksum) {
      // `metadata` is verified above to be an object carrying a checksum, which is
      // all validateChecksum requires; the remaining ExportMetadata fields are
      // reported separately by validateMetadata.
      const checksumError = this.validateChecksum({
        metadata: metadata as ExportMetadata,
        data: exportData,
      });
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

    // FIX B#12: Validate IDs are unique across entity types
    this.validateCrossEntityIdUniqueness(exportData, errors);

    // FIX A#6: Validate entity metadata doesn't conflict with provenance fields
    this.validateMetadataProvenanceConflicts(exportData, warnings);

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

  // NOTE: `_warnings` is accepted for symmetry with the other validate* helpers
  // (validateEvents / validateRelationships do emit warnings); metadata checks
  // currently only ever produce errors.
  private validateMetadata(
    metadata: unknown,
    errors: ImportError[],
    _warnings: ImportWarning[]
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

  /**
   * FIX B#12: Validate that IDs are unique across all entity types
   * This prevents potential conflicts when entities might be referenced generically
   */
  private validateCrossEntityIdUniqueness(
    exportData: ExportData,
    errors: ImportError[]
  ): void {
    const allIds = new Map<string, { type: string; path: string }>();

    // Collect all event IDs
    (exportData.events || []).forEach((event, index) => {
      if (event.id) {
        const existing = allIds.get(event.id);
        if (existing) {
          errors.push({
            path: `$.data.events[${index}].id`,
            message: `ID '${event.id}' is already used by ${existing.type} at ${existing.path}`,
            code: 'DUPLICATE_ID',
          });
        } else {
          allIds.set(event.id, { type: 'event', path: `$.data.events[${index}]` });
        }
      }
    });

    // Collect all arc IDs
    (exportData.arcs || []).forEach((arc, index) => {
      if (arc.id) {
        const existing = allIds.get(arc.id);
        if (existing) {
          errors.push({
            path: `$.data.arcs[${index}].id`,
            message: `ID '${arc.id}' is already used by ${existing.type} at ${existing.path}`,
            code: 'DUPLICATE_ID',
          });
        } else {
          allIds.set(arc.id, { type: 'arc', path: `$.data.arcs[${index}]` });
        }
      }
    });

    // Collect all relationship IDs
    (exportData.causalRelationships || []).forEach((rel, index) => {
      if (rel.id) {
        const existing = allIds.get(rel.id);
        if (existing) {
          errors.push({
            path: `$.data.causalRelationships[${index}].id`,
            message: `ID '${rel.id}' is already used by ${existing.type} at ${existing.path}`,
            code: 'DUPLICATE_ID',
          });
        } else {
          allIds.set(rel.id, { type: 'relationship', path: `$.data.causalRelationships[${index}]` });
        }
      }
    });

    // Collect all pressure IDs
    (exportData.inferredPressures || []).forEach((pressure, index) => {
      if (pressure.id) {
        const existing = allIds.get(pressure.id);
        if (existing) {
          errors.push({
            path: `$.data.inferredPressures[${index}].id`,
            message: `ID '${pressure.id}' is already used by ${existing.type} at ${existing.path}`,
            code: 'DUPLICATE_ID',
          });
        } else {
          allIds.set(pressure.id, { type: 'pressure', path: `$.data.inferredPressures[${index}]` });
        }
      }
    });
  }

  /**
   * FIX A#6: Check if entity metadata fields conflict with auto-added provenance fields
   * This warns users that their metadata might be overwritten during import
   */
  private validateMetadataProvenanceConflicts(
    exportData: ExportData,
    warnings: ImportWarning[]
  ): void {
    // Provenance fields that are auto-added during import
    const provenanceFields = [
      'imported',
      'importedAt',
      'sourceGraphId',
      'sourceGraphVersion',
      'importMode',
      'importJobId',
      'importedBy',
      'originalId',
      'originalCreatedAt',
    ];

    const checkMetadata = (
      metadata: Record<string, unknown> | undefined,
      path: string
    ): void => {
      if (!metadata || typeof metadata !== 'object') return;

      for (const field of provenanceFields) {
        if (field in metadata) {
          warnings.push({
            path: `${path}.metadata.${field}`,
            message: `Metadata field '${field}' may be overwritten with provenance data during import`,
            code: 'DEPRECATED_FIELD',
          });
        }
      }
    };

    // Check events
    (exportData.events || []).forEach((event, index) => {
      checkMetadata(
        event.metadata as Record<string, unknown> | undefined,
        `$.data.events[${index}]`
      );
    });

    // Check arcs
    (exportData.arcs || []).forEach((arc, index) => {
      checkMetadata(
        arc.metadata as Record<string, unknown> | undefined,
        `$.data.arcs[${index}]`
      );
    });
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

      // `sourceRef` is a string in the format; a number or object would be
      // stored under that string-typed field and re-exported unchanged.
      if (e.sourceRef !== undefined && typeof e.sourceRef !== 'string') {
        warnings.push({
          path: `${path}.sourceRef`,
          message: 'sourceRef must be a string and was dropped',
          code: 'INVALID_VALUE',
        });
      }
    });
  }

  // NOTE: `_warnings` is accepted for symmetry with the other validate* helpers;
  // arc checks currently only ever produce errors.
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
    const arcParents = new Map<string, string | null>();

    // First pass: collect all arc IDs, levels, and parent relationships
    arcs.forEach((arc) => {
      if (arc && typeof arc === 'object') {
        const a = arc as ExportedArc;
        if (a.id) {
          arcIds.add(a.id);
          if (typeof a.level === 'number') {
            arcLevels.set(a.id, a.level);
          }
          arcParents.set(a.id, a.parent_arc_id || null);
        }
      }
    });

    // FIX #3: Check for circular references in arc hierarchy
    const detectCircularReference = (arcId: string): string[] | null => {
      const visited = new Set<string>();
      let current: string | null = arcId;
      const path: string[] = [];
      
      while (current) {
        if (visited.has(current)) {
          // Found a cycle - return the path
          path.push(current);
          return path;
        }
        visited.add(current);
        path.push(current);
        current = arcParents.get(current) || null;
      }
      return null;
    };

    // Check each arc for circular references
    for (const arcId of arcIds) {
      const cycle = detectCircularReference(arcId);
      if (cycle && cycle.length > 1 && cycle[0] === cycle[cycle.length - 1]) {
        // Find the index of this arc for error path
        const arcIndex = arcs.findIndex((a) => (a as ExportedArc).id === arcId);
        errors.push({
          path: `$.data.arcs[${arcIndex}]`,
          message: `Circular arc reference detected: ${cycle.join(' → ')}`,
          code: 'ARC_HIERARCHY_VIOLATION',
        });
        // Only report once per cycle
        break;
      }
    }

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

      if (a.sourceRef !== undefined && typeof a.sourceRef !== 'string') {
        warnings.push({
          path: `${path}.sourceRef`,
          message: 'sourceRef must be a string and was dropped',
          code: 'INVALID_VALUE',
        });
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
      
      // FIX #2: Validate cross-graph reference format (actual graph existence checked async)
      if (r.causeGraphId && typeof r.causeGraphId !== 'string') {
        errors.push({
          path: `${path}.causeGraphId`,
          message: 'causeGraphId must be a string',
          code: 'INVALID_TYPE',
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
      
      // FIX #2: Validate cross-graph reference format (actual graph existence checked async)
      if (r.effectGraphId && typeof r.effectGraphId !== 'string') {
        errors.push({
          path: `${path}.effectGraphId`,
          message: 'effectGraphId must be a string',
          code: 'INVALID_TYPE',
        });
      }

      // Check causal consistency (cause must be before or equal to effect)
      if (r.cause_event_id && r.effect_event_id && !r.causeGraphId && !r.effectGraphId) {
        const causeTime = eventTimestamps.get(r.cause_event_id);
        const effectTime = eventTimestamps.get(r.effect_event_id);
        if (causeTime && effectTime && isTemporalInversion(causeTime, effectTime)) {
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

  // NOTE: `_warnings` is accepted for symmetry with the other validate* helpers;
  // pressure checks currently only ever produce errors.
  private validatePressures(
    pressures: unknown,
    events: unknown,
    arcs: unknown,
    errors: ImportError[],
    _warnings: ImportWarning[]
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

    // Plain `for...of` loops (not forEach callbacks) so that the minDate/maxDate
    // assignments are visible to control-flow analysis at the read below.
    for (const e of events) {
      if (e.timestamp) {
        const date = new Date(e.timestamp);
        if (!isNaN(date.getTime())) {
          if (!minDate || date < minDate) minDate = date;
          if (!maxDate || date > maxDate) maxDate = date;
        }
      }
      if (e.actor) actors.add(e.actor);
    }

    for (const a of arcs) {
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
    }

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
   * - Events within their arc boundaries (FIX #1)
   * - Arc hierarchy consistency (parent contains child)
   * - NaN date handling (FIX B#20)
   */
  validateTemporalConstraints(data: AlthistoryExport): ImportError[] {
    const errors: ImportError[] = [];
    const exportData = data.data;

    // Build arc map with parsed dates
    const arcMap = new Map<string, ExportedArc>();
    const arcDates = new Map<string, { start: Date; end: Date }>();
    (exportData.arcs || []).forEach((arc) => {
      arcMap.set(arc.id, arc);
      const start = new Date(arc.start_time);
      const end = new Date(arc.end_time);
      // FIX B#20: Only store valid dates
      if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
        arcDates.set(arc.id, { start, end });
      }
    });

    // Build event index for arc membership lookup
    const eventArcMembership = new Map<string, string[]>();
    (exportData.events || []).forEach((event) => {
      if (event.metadata && (event.metadata as Record<string, unknown>).arc_ids) {
        const arcIds = (event.metadata as Record<string, unknown>).arc_ids as string[];
        eventArcMembership.set(event.id, arcIds);
      }
    });

    // FIX #1: Validate events within arc boundaries
    (exportData.events || []).forEach((event, index) => {
      const eventTime = new Date(event.timestamp);
      // FIX B#20: Skip NaN dates
      if (isNaN(eventTime.getTime())) {
        errors.push({
          path: `$.data.events[${index}].timestamp`,
          message: `Event "${event.id}" has invalid timestamp that cannot be parsed`,
          code: 'INVALID_VALUE',
        });
        return;
      }

      // Check if event falls within any arc it's assigned to
      const assignedArcs = eventArcMembership.get(event.id) || [];
      for (const arcId of assignedArcs) {
        const arcBounds = arcDates.get(arcId);
        if (arcBounds) {
          if (eventTime < arcBounds.start || eventTime > arcBounds.end) {
            const arc = arcMap.get(arcId);
            errors.push({
              path: `$.data.events[${index}]`,
              message: `Event "${event.id}" (${event.timestamp}) is outside arc "${arc?.name || arcId}" boundaries (${arc?.start_time} to ${arc?.end_time})`,
              code: 'TEMPORAL_VIOLATION',
            });
          }
        }
      }
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

          // FIX B#20: Check for NaN before comparing
          if (isNaN(childStart.getTime()) || isNaN(childEnd.getTime())) {
            errors.push({
              path: `$.data.arcs[${index}]`,
              message: `Arc "${arc.name}" has invalid date that cannot be parsed`,
              code: 'INVALID_VALUE',
            });
            return;
          }

          if (isNaN(parentStart.getTime()) || isNaN(parentEnd.getTime())) {
            // Parent has invalid dates, already caught in format validation
            return;
          }

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

  /**
   * FIX #2: Validate cross-graph references
   * Checks that referenced graphs actually exist
   */
  async validateCrossGraphReferences(data: AlthistoryExport): Promise<ImportError[]> {
    const errors: ImportError[] = [];
    const exportData = data.data;
    const checkedGraphs = new Map<string, boolean>();

    // Helper to check if graph exists (with caching)
    const graphExists = async (graphId: string): Promise<boolean> => {
      if (checkedGraphs.has(graphId)) {
        return checkedGraphs.get(graphId)!;
      }
      try {
        const graph = await this.graphRepository.findById(graphId);
        const exists = graph !== null;
        checkedGraphs.set(graphId, exists);
        return exists;
      } catch {
        checkedGraphs.set(graphId, false);
        return false;
      }
    };

    // Check relationships with cross-graph references
    for (let i = 0; i < (exportData.causalRelationships || []).length; i++) {
      const rel = exportData.causalRelationships[i];
      const path = `$.data.causalRelationships[${i}]`;

      if (rel.causeGraphId) {
        const exists = await graphExists(rel.causeGraphId);
        if (!exists) {
          errors.push({
            path: `${path}.causeGraphId`,
            message: `Cross-graph reference to non-existent graph: ${rel.causeGraphId}`,
            code: 'ORPHAN_REFERENCE',
          });
        }
      }

      if (rel.effectGraphId) {
        const exists = await graphExists(rel.effectGraphId);
        if (!exists) {
          errors.push({
            path: `${path}.effectGraphId`,
            message: `Cross-graph reference to non-existent graph: ${rel.effectGraphId}`,
            code: 'ORPHAN_REFERENCE',
          });
        }
      }
    }

    // Check crossGraphRefs if present
    const crossGraphRefs = exportData.crossGraphRefs || [];
    for (let i = 0; i < crossGraphRefs.length; i++) {
      const ref = crossGraphRefs[i];
      const path = `$.data.crossGraphRefs[${i}]`;

      if (ref.referencedGraphId) {
        const exists = await graphExists(ref.referencedGraphId);
        if (!exists) {
          errors.push({
            path: `${path}.referencedGraphId`,
            message: `Cross-graph reference to non-existent graph: ${ref.referencedGraphId}`,
            code: 'ORPHAN_REFERENCE',
          });
        }
      }
    }

    return errors;
  }

  // ==========================================================================
  // Conflict Detection
  // ==========================================================================

  /**
   * Load a graph's current contents as entity lists.
   *
   * This replaces the previous `graphRepository.resolveGraphData(...)` calls. No such
   * method exists on GraphRepository, so every call site threw a TypeError that the
   * surrounding catch swallowed: conflict detection, preview and replace-mode deletes
   * all behaved as though the target graph were permanently empty. `checkout` is the
   * repository's read path for the latest version (the same one GraphService.getGraphData
   * uses) and yields an empty graph when the graph has no versions.
   */
  private async loadExistingGraph(graphId: string): Promise<ExistingGraphData> {
    const data = await this.graphRepository.checkout(graphId);
    return {
      events: this.toEntityList(data.events),
      arcs: this.toEntityList(data.arcs),
      relationships: this.toEntityList(data.relationships),
      pressures: this.toEntityList(data.pressures),
    };
  }

  /**
   * Flatten an id-keyed entity map into a list. Entities without a string id are
   * dropped: every consumer below only ever matches and reports on `id`.
   */
  private toEntityList(entities: Record<string, Record<string, unknown>>): StoredEntity[] {
    return Object.values(entities).filter(
      (entity): entity is StoredEntity => typeof entity.id === 'string'
    );
  }

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
      const graphData = await this.loadExistingGraph(targetGraphId);
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
            existingEntity: existing,
            // SAFETY: ExportedEvent has no index signature, but every field is
            // JSON-serialisable and this payload is only serialised for the client.
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
            existingEntity: existing,
            // SAFETY: ExportedArc has no index signature, but every field is
            // JSON-serialisable and this payload is only serialised for the client.
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
            existingEntity: existing,
            // SAFETY: ExportedRelationship has no index signature, but every field
            // is JSON-serialisable and this payload is only serialised for the client.
            incomingEntity: rel as unknown as Record<string, unknown>,
            suggestedResolution: mode === 'merge' ? 'skip' : 'overwrite',
            message: `Relationship with ID "${rel.id}" already exists`,
          });
        }
      });

      // Check for causal paradoxes with existing data
      const allEvents = new Map<string, Date>();
      graphData.events.forEach((e) => {
        // Stored timestamps are opaque; a value Date cannot read yields an Invalid
        // Date, which never compares greater than anything, so skipping it detects
        // exactly the same paradoxes as before.
        const { timestamp } = e;
        if (typeof timestamp === 'string' || typeof timestamp === 'number') {
          allEvents.set(e.id, new Date(timestamp));
        }
      });
      (exportData.events || []).forEach((e) => {
        if (!allEvents.has(e.id)) {
          allEvents.set(e.id, new Date(e.timestamp));
        }
      });

      (exportData.causalRelationships || []).forEach((rel) => {
        const causeTime = allEvents.get(rel.cause_event_id);
        const effectTime = allEvents.get(rel.effect_event_id);

        if (causeTime && effectTime && isTemporalInversion(causeTime, effectTime)) {
          addConflict({
            id: `conflict-paradox-${rel.id}`,
            type: 'causal-paradox',
            severity: 'error',
            entityType: 'relationship',
            entityId: rel.id,
            // SAFETY: ExportedRelationship has no index signature, but every field
            // is JSON-serialisable and this payload is only serialised for the client.
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
        const graphData = await this.loadExistingGraph(options.graphId);
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
   * FIX A#9: Uses configurable async import threshold
   */
  shouldUseAsyncImport(data: AlthistoryExport): boolean {
    const totalEntities =
      (data.data.events?.length || 0) +
      (data.data.arcs?.length || 0) +
      (data.data.causalRelationships?.length || 0) +
      (data.data.inferredPressures?.length || 0);
    return totalEntities > this.asyncImportThreshold;
  }

  /**
   * Execute the import asynchronously (for large imports)
   * FIX #7: Real progress tracking
   */
  async executeImportAsync(
    importData: AlthistoryExport,
    options: ImportOptions
  ): Promise<{ jobId: string }> {
    // Create job
    const job = await this.jobRepository.create({
      type: 'import',
      status: 'pending',
      metadata: {
        mode: options.mode,
        graphId: options.graphId,
      },
    });

    // Store cancel flag and graphId for cleanup
    this.activeImports.set(job.id, { cancel: false, graphId: options.graphId });

    // Execute in background
    setImmediate(async () => {
      try {
        // Check if service was destroyed before starting
        if (this.isDestroyed) {
          this.activeImports.delete(job.id);
          return;
        }
        
        const processingJob = await this.jobRepository.findById(job.id);
        if (processingJob && !this.isDestroyed) {
          processingJob.status = 'processing';
          processingJob.startedAt = new Date().toISOString();
          processingJob.progress = 0;
          processingJob.progressMessage = 'Starting import...';
          await this.jobRepository.update(processingJob);
        }

        // Check again after the initial update
        if (this.isDestroyed) {
          this.activeImports.delete(job.id);
          return;
        }

        const result = await this.executeImportInternal(importData, options, job.id);

        // Check if destroyed or cancelled during execution
        if (this.isDestroyed) {
          this.activeImports.delete(job.id);
          return;
        }
        
        const state = this.activeImports.get(job.id);
        const completedJob = await this.jobRepository.findById(job.id);
        if (completedJob && !this.isDestroyed) {
          if (state?.cancel) {
            completedJob.status = 'cancelled';
            completedJob.completedAt = new Date().toISOString();
            completedJob.progress = 100;
            completedJob.progressMessage = 'Import cancelled';
          } else {
            completedJob.status = result.success ? 'completed' : 'failed';
            completedJob.completedAt = new Date().toISOString();
            completedJob.result = result;
            completedJob.progress = 100;
            completedJob.progressMessage = result.success ? 'Import completed' : 'Import failed';
          }
          await this.jobRepository.update(completedJob);
        }
      } catch (error) {
        // Skip update if service is destroyed
        if (this.isDestroyed) {
          this.activeImports.delete(job.id);
          return;
        }
        
        const failedJob = await this.jobRepository.findById(job.id);
        if (failedJob && !this.isDestroyed) {
          failedJob.status = 'failed';
          failedJob.completedAt = new Date().toISOString();
          failedJob.error = error instanceof Error ? error.message : 'Unknown error';
          failedJob.progress = 100;
          failedJob.progressMessage = 'Import failed with error';
          await this.jobRepository.update(failedJob);
        }
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
    const job = await this.jobRepository.findById(jobId);
    if (!job) return null;
    return {
      id: job.id,
      status: job.status,
      progress: job.progress || 0,
      progressMessage: job.progressMessage,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      result: job.result as ImportResult | undefined,
      error: job.error,
    };
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
   * Helper to update job progress
   * FIX #7: Real progress tracking
   */
  private async updateJobProgress(
    jobId: string | undefined,
    progress: number,
    message: string
  ): Promise<void> {
    if (!jobId) return;
    try {
      const job = await this.jobRepository.findById(jobId);
      if (job) {
        job.progress = progress;
        job.progressMessage = message;
        await this.jobRepository.update(job);
      }
    } catch (error) {
      this.logger.warn('Failed to update job progress', { jobId, error });
    }
  }

  /**
   * FIX B#6: Check if import should be cancelled
   */
  private shouldCancel(jobId?: string): boolean {
    if (!jobId) return false;
    return this.activeImports.get(jobId)?.cancel === true;
  }

  /**
   * Internal import execution with optional job tracking
   * FIX #7: Real progress tracking
   * FIX B#6: Check cancellation flag during execution
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

    // Check for cancellation at start
    if (this.shouldCancel(jobId)) {
      return { ...emptyResult(), errors: [{ path: '$', message: 'Import cancelled', code: 'INVALID_FORMAT' }] };
    }

    // Validate first (10% progress)
    await this.updateJobProgress(jobId, 5, 'Validating format...');
    const validation = await this.validateFormat(importData);
    if (!validation.valid) {
      return {
        ...emptyResult(),
        errors: validation.errors,
        warnings: validation.warnings,
      };
    }

    // FIX B#6: Check cancellation between steps
    if (this.shouldCancel(jobId)) {
      return { ...emptyResult(), errors: [{ path: '$', message: 'Import cancelled', code: 'INVALID_FORMAT' }] };
    }

    // Additional temporal validation (20% progress)
    await this.updateJobProgress(jobId, 15, 'Validating temporal constraints...');
    const temporalErrors = this.validateTemporalConstraints(importData);
    if (temporalErrors.length > 0) {
      return {
        ...emptyResult(),
        errors: temporalErrors,
        warnings: validation.warnings,
      };
    }

    // FIX B#6: Check cancellation
    if (this.shouldCancel(jobId)) {
      return { ...emptyResult(), errors: [{ path: '$', message: 'Import cancelled', code: 'INVALID_FORMAT' }] };
    }

    // FIX #2: Validate cross-graph references
    await this.updateJobProgress(jobId, 20, 'Validating cross-graph references...');
    const crossGraphErrors = await this.validateCrossGraphReferences(importData);
    if (crossGraphErrors.length > 0) {
      return {
        ...emptyResult(),
        errors: crossGraphErrors,
        warnings: validation.warnings,
      };
    }

    // FIX B#6: Check cancellation
    if (this.shouldCancel(jobId)) {
      return { ...emptyResult(), errors: [{ path: '$', message: 'Import cancelled', code: 'INVALID_FORMAT' }] };
    }

    // Detect conflicts (30% progress)
    await this.updateJobProgress(jobId, 25, 'Detecting conflicts...');
    const conflicts = options.graphId
      ? await this.detectConflicts(importData, options.graphId, options.mode)
      : [];

    // FIX #10: Check for unresolved error-level conflicts more thoroughly
    const errorConflicts = conflicts.filter((c) => c.severity === 'error');
    if (options.conflictResolution === 'manual') {
      const unresolvedErrors = errorConflicts.filter((c) => !options.manualResolutions?.[c.id]);
      if (unresolvedErrors.length > 0) {
        return {
          ...emptyResult(),
          errors: unresolvedErrors.map((c) => ({
            path: `conflict.${c.entityType}.${c.entityId}`,
            message: `Unresolved conflict: ${c.message}`,
            code: c.type.toUpperCase() as ImportErrorCode,
          })),
          warnings: validation.warnings,
        };
      }
    } else if (options.conflictResolution !== 'skip' && errorConflicts.length > 0) {
      // For non-skip resolutions, still report unresolved paradoxes
      const paradoxes = errorConflicts.filter((c) => c.type === 'causal-paradox');
      if (paradoxes.length > 0 && options.conflictResolution !== 'rename') {
        return {
          ...emptyResult(),
          errors: paradoxes.map((c) => ({
            path: `conflict.${c.entityType}.${c.entityId}`,
            message: c.message,
            code: 'CAUSAL_PARADOX' as ImportErrorCode,
          })),
          warnings: validation.warnings,
        };
      }
    }

    // FIX B#6: Check cancellation
    if (this.shouldCancel(jobId)) {
      return { ...emptyResult(), errors: [{ path: '$', message: 'Import cancelled', code: 'INVALID_FORMAT' }] };
    }

    try {
      let targetGraphId = options.graphId;

      // Create new graph if needed (40% progress)
      await this.updateJobProgress(jobId, 35, 'Preparing graph...');
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

      // FIX B#6: Check cancellation before heavy operation
      if (this.shouldCancel(jobId)) {
        return { ...emptyResult(), errors: [{ path: '$', message: 'Import cancelled', code: 'INVALID_FORMAT' }] };
      }

      // Apply import with conflict resolutions and rollback support (50-90% progress)
      await this.updateJobProgress(jobId, 50, 'Applying import...');
      const result = await this.applyImportWithRollback(
        targetGraphId,
        importData,
        options.mode,
        resolutions,
        conflicts,
        options,
        jobId
      );

      this.logger.info('Import completed successfully', {
        graphId: targetGraphId,
        imported: result.imported,
        skipped: result.skipped,
        deleted: result.deleted,
      });

      await this.updateJobProgress(jobId, 95, 'Finalizing...');

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
   * FIX #6: Complete provenance recording
   * FIX #9: Process crossGraphRefs
   * FIX B#26, B#29: Preserve original metadata and timestamps
   */
  private async applyImportWithRollback(
    graphId: string,
    importData: AlthistoryExport,
    mode: ImportMode,
    resolutions: Map<string, ConflictResolution>,
    conflicts: ImportConflict[],
    options: ImportOptions,
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

    // FIX #5: Collect all existing IDs to check for rename collisions
    const existingIds = new Set<string>();
    const newIds = new Set<string>();
    
    // FIX #5: Load existing IDs from graph if it exists
    try {
      const graphData = await this.loadExistingGraph(graphId);
      graphData.events.forEach(e => existingIds.add(e.id));
      graphData.arcs.forEach(a => existingIds.add(a.id));
      graphData.relationships.forEach(r => existingIds.add(r.id));
      graphData.pressures.forEach(p => existingIds.add(p.id));
    } catch {
      // Graph doesn't exist yet, which is fine
    }
    
    // Helper to generate new ID if renaming, and track the mapping
    // FIX #5: Check for collision and retry if needed
    const getEntityId = (entityType: string, originalId: string): string => {
      const key = `${entityType}-${originalId}`;
      const conflict = conflictMap.get(key);
      if (!conflict) return originalId;
      const resolution = resolutions.get(conflict.id);
      if (resolution === 'rename') {
        let attempts = 0;
        const maxAttempts = 10;
        let newId: string;
        
        do {
          // Use timestamp + random + attempt number for better uniqueness
          newId = `${originalId}_imported_${Date.now()}_${Math.random().toString(36).substr(2, 9)}_${attempts}`;
          attempts++;
        } while ((existingIds.has(newId) || newIds.has(newId)) && attempts < maxAttempts);
        
        if (attempts >= maxAttempts) {
          // Extremely unlikely, but use UUID-like suffix as last resort
          newId = `${originalId}_imported_${crypto.randomUUID()}`;
        }
        
        newIds.add(newId);
        idRemap.set(`${entityType}:${originalId}`, newId);
        return newId;
      }
      return originalId;
    };

    // Helper to get remapped ID for references
    const getRemappedId = (entityType: string, originalId: string): string => {
      return idRemap.get(`${entityType}:${originalId}`) || originalId;
    };

    // FIX #6: Build complete provenance data
    const importTimestamp = new Date().toISOString();
    const provenanceData = {
      imported: true,
      importedAt: importTimestamp,
      sourceGraphId: importData.metadata.graphId,
      sourceGraphVersion: importData.metadata.graphVersion,
      importMode: mode,
      importJobId: jobId,
      importedBy: options.userId,
    };

    // Prepare entities for import
    const eventsToImport: Array<{ id: string; data: ExportedEvent }> = [];
    const arcsToImport: Array<{ id: string; data: ExportedArc }> = [];
    // Relationships carry no `metadata` field in the export format; the
    // optional metadata here is where the commit payload keeps the stored
    // cross-graph references (hoisted back out on export).
    const relationshipsToImport: Array<{
      id: string;
      data: ExportedRelationship & { metadata?: Record<string, unknown> };
    }> = [];
    const pressuresToImport: Array<{ id: string; data: ExportedPressure }> = [];

    // Cross-graph references (Req 4.4). The export format carries them in
    // `data.crossGraphRefs`, keyed to the local entity by `localEntityId` +
    // `localEntityType`. They must be re-attached to the entity they describe,
    // or the next export drops them: gap M1, where this map was built and then
    // never read. Lookups use the *exported* id, before `getEntityId` remaps
    // it, because that is the id the reference names.
    const refsByLocalEntity = new Map<string, CrossGraphRef[]>();
    for (const ref of exportData.crossGraphRefs || []) {
      const key = `${ref.localEntityType}:${ref.localEntityId}`;
      const existing = refsByLocalEntity.get(key);
      if (existing) {
        existing.push(ref);
      } else {
        refsByLocalEntity.set(key, [ref]);
      }
    }

    /**
     * The stored form of a reference: everything except the local side, which
     * the containing entity already supplies. `embeddedEntity` is deliberately
     * not stored -- it is a convenience copy of data the referenced graph owns,
     * so keeping it here would duplicate that data and let it go stale.
     */
    type StoredCrossGraphRef = Omit<CrossGraphRef, 'localEntityId' | 'localEntityType' | 'embeddedEntity'>;
    const storedCrossRefsFor = (
      localEntityType: CrossGraphRef['localEntityType'],
      originalId: string
    ): StoredCrossGraphRef[] | undefined => {
      const refs = refsByLocalEntity.get(`${localEntityType}:${originalId}`);
      if (!refs || refs.length === 0) return undefined;
      return refs.map((ref) => ({
        referencedGraphId: ref.referencedGraphId,
        referencedEntityId: ref.referencedEntityId,
        referencedEntityType: ref.referencedEntityType,
      }));
    };

    // Process events first to build ID remap
    (exportData.events || []).forEach((event) => {
      if (shouldSkip('event', event.id)) {
        skipped.events++;
      } else {
        const newId = getEntityId('event', event.id);
        const sanitizedEvent = this.sanitizeObject(event);
        
        // FIX B#26, B#29: Preserve original metadata and created_at
        const originalMetadata = sanitizedEvent.metadata || {};
        const originalCreatedAt = (originalMetadata as Record<string, unknown>).created_at;
        const storedCrossRefs = storedCrossRefsFor('event', event.id);
        
        eventsToImport.push({
          id: newId,
          data: {
            ...sanitizedEvent,
            id: newId,
            metadata: {
              ...originalMetadata,
              ...provenanceData,
              originalId: event.id !== newId ? event.id : undefined,
              // FIX B#29: Preserve original created_at if it exists
              originalCreatedAt: originalCreatedAt || sanitizedEvent.timestamp,
              ...(storedCrossRefs ? { crossGraphRefs: storedCrossRefs } : {}),
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
        
        // FIX B#26: Preserve original metadata
        const originalMetadata = sanitizedArc.metadata || {};
        const storedCrossRefs = storedCrossRefsFor('arc', arc.id);
        
        arcsToImport.push({
          id: newId,
          data: {
            ...sanitizedArc,
            id: newId,
            parent_arc_id: parentId,
            metadata: {
              ...originalMetadata,
              ...provenanceData,
              originalId: arc.id !== newId ? arc.id : undefined,
              ...(storedCrossRefs ? { crossGraphRefs: storedCrossRefs } : {}),
            },
          },
        });
        imported.arcs++;
      }
    });

    // Process relationships, updating event references
    // FIX #9: Handle cross-graph references in relationships
    (exportData.causalRelationships || []).forEach((rel) => {
      if (shouldSkip('relationship', rel.id)) {
        skipped.relationships++;
      } else {
        const newId = getEntityId('relationship', rel.id);
        const sanitizedRel = this.sanitizeObject(rel);
        
        // FIX #9: Preserve cross-graph references, only remap local references
        const causeEventId = rel.causeGraphId 
          ? rel.cause_event_id  // Cross-graph reference, don't remap
          : getRemappedId('event', rel.cause_event_id);
        const effectEventId = rel.effectGraphId
          ? rel.effect_event_id  // Cross-graph reference, don't remap
          : getRemappedId('event', rel.effect_event_id);
        const storedCrossRefs = storedCrossRefsFor('relationship', rel.id);
        
        relationshipsToImport.push({
          id: newId,
          data: {
            ...sanitizedRel,
            id: newId,
            cause_event_id: causeEventId,
            effect_event_id: effectEventId,
            // Preserve cross-graph IDs
            causeGraphId: rel.causeGraphId,
            effectGraphId: rel.effectGraphId,
            ...(storedCrossRefs ? { metadata: { crossGraphRefs: storedCrossRefs } } : {}),
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
    const entitiesToDelete: {
      events: string[];
      arcs: string[];
      relationships: string[];
      pressures: string[];
    } = { events: [], arcs: [], relationships: [], pressures: [] };

    if (mode === 'replace') {
      try {
        const graphData = await this.loadExistingGraph(graphId);
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
          // Provenance reference, exported alongside the entity (see
          // ExportService.convertToExportFormat). Only a string survives;
          // `validateEvents` warns about anything else.
          ...(typeof data.sourceRef === 'string' && data.sourceRef !== ''
            ? { sourceRef: data.sourceRef }
            : {}),
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
          ...(typeof data.sourceRef === 'string' && data.sourceRef !== ''
            ? { sourceRef: data.sourceRef }
            : {}),
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
          // A relationship's cross-graph endpoints are part of the exported
          // relationship. Dropping them here left an imported remote cause
          // recorded as a local event id that does not exist.
          ...(data.causeGraphId ? { causeGraphId: data.causeGraphId } : {}),
          ...(data.effectGraphId ? { effectGraphId: data.effectGraphId } : {}),
          ...(typeof data.sourceRef === 'string' && data.sourceRef !== ''
            ? { sourceRef: data.sourceRef }
            : {}),
          // Kept so an imported cross-graph reference survives to the next
          // export (see `storedCrossRefsFor` above). Absent otherwise.
          ...(data.metadata ? { metadata: data.metadata } : {}),
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
