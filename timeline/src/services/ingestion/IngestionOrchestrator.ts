/**
 * Ingestion orchestrator (spec Req 7.5-7.6, 8.5, 9.5).
 *
 * Runs a request through one interchangeable {@link Extractor}, validates the
 * result, holds it for review, and on approval converts the selected (and
 * edited) entities into an {@link AlthistoryExport} that is handed to the
 * existing `ImportService`. This is the only route from ingestion into a graph;
 * no entity is created here directly.
 *
 * Jobs are owned. `ingest` records the id of the API key that created the job,
 * and every read or mutation of the job requires that id: a preview holds the
 * caller's pasted text, so an ingestion job is private to the key that made it.
 * A request naming another key's job is answered as "not found" (the route maps
 * {@link IngestionJobNotFoundError} to 404) rather than "forbidden", so job ids
 * cannot be probed for existence. A job created without an owner -- only
 * possible when the orchestrator is driven directly, as tests do -- has no
 * ownership restriction; the route always passes one.
 *
 * `approve` refuses a job that is not in `review` status, so an approved job
 * cannot be imported twice.
 */

import * as crypto from 'crypto';
import { AppError } from '../../utils/errors';
import {
  AlthistoryExport,
  DataSource,
  ExportProvenance,
  ExportedArc,
  ExportedEvent,
  ExportedRelationship,
} from '../ExportService';
import { ConflictResolution, ImportMode, ImportOptions, ImportResult } from '../ImportService';
import { newTempId } from './ids';
import {
  ExtractedArc,
  ExtractedEvent,
  ExtractionContext,
  ExtractionResult,
  Extractor,
  IngestionPreview,
  IngestionRequest,
  TextExtractionInput,
  ValidationIssue,
  WikidataExtractionInput,
  WikipediaExtractionInput,
} from './types';

/**
 * The slice of `ImportService` the orchestrator uses. Declared structurally so
 * tests can pass a fake and so the orchestrator does not depend on the concrete
 * class's constructor.
 */
export interface ImportExecutor {
  initialize(): Promise<void>;
  executeImport(data: AlthistoryExport, options: ImportOptions): Promise<ImportResult>;
  destroy?(): Promise<void>;
}

/** Editable fields, spanning both event and arc shapes. */
export type ExtractedEdit = Partial<ExtractedEvent> & Partial<ExtractedArc>;

export interface IngestionJob {
  id: string;
  source: ExtractionResultSource;
  status: 'extracting' | 'review' | 'imported' | 'failed';
  progress?: number;
  createdAt: string;
  updatedAt: string;
  extraction: ExtractionResult;
  validationIssues: ValidationIssue[];
  importResult?: ImportResult;
  /**
   * Id of the API key that created the job. Absent only when the orchestrator
   * was driven directly without an owner; the ingest routes always set it.
   */
  ownerKeyId?: string;
}

type ExtractionResultSource = 'wikipedia' | 'wikidata' | 'text' | 'llm';

export interface IngestionJobStore {
  set(job: IngestionJob): void;
  get(id: string): IngestionJob | undefined;
  delete(id: string): boolean;
}

/** Bounded in-memory store. Evicted oldest-first once `maxJobs` is reached. */
export class InMemoryIngestionJobStore implements IngestionJobStore {
  private readonly jobs = new Map<string, IngestionJob>();

  constructor(private readonly maxJobs: number = 200) {}

  set(job: IngestionJob): void {
    this.jobs.delete(job.id);
    this.jobs.set(job.id, job);
    while (this.jobs.size > this.maxJobs) {
      const oldest = this.jobs.keys().next().value;
      if (oldest === undefined) break;
      this.jobs.delete(oldest);
    }
  }

  get(id: string): IngestionJob | undefined {
    return this.jobs.get(id);
  }

  delete(id: string): boolean {
    return this.jobs.delete(id);
  }
}

export class IngestionJobNotFoundError extends Error {
  constructor(id: string) {
    super(`Ingestion job not found: ${id}`);
    this.name = 'IngestionJobNotFoundError';
  }
}

/**
 * Raised when an operation is not valid for a job's current status (an approve
 * of a job that was already approved or has failed). Carries 409 so the route
 * needs no special case: it is an `AppError`, and the shared error handler maps
 * it to Conflict.
 */
export class IngestionJobStateError extends AppError {
  readonly statusCode = 409;
  readonly isOperational = true;

  constructor(message: string) {
    super(message);
  }
}

export class IngestionValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super(`Extraction has ${issues.length} validation error(s) for the selected entities`);
    this.name = 'IngestionValidationError';
    this.issues = issues;
  }
}

export interface ApproveIngestionRequest {
  approvedEventIds?: string[];
  approvedArcIds?: string[];
  approvedRelationshipIds?: string[];
  edits?: Record<string, ExtractedEdit>;
  targetGraphId?: string;
  mode?: ImportMode;
  conflictResolution?: ConflictResolution;
  userId?: string;
}

export interface IngestionOrchestratorDeps {
  extractors: {
    wikipedia: Extractor<WikipediaExtractionInput>;
    wikidata: Extractor<WikidataExtractionInput>;
    text: Extractor<TextExtractionInput>;
  };
  importExecutor: ImportExecutor;
  jobStore?: IngestionJobStore;
  now?: () => Date;
  idFactory?: () => string;
}

export class IngestionOrchestrator {
  private readonly extractors: IngestionOrchestratorDeps['extractors'];
  private readonly importExecutor: ImportExecutor;
  private readonly jobStore: IngestionJobStore;
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private initPromise: Promise<void> | null = null;

  constructor(deps: IngestionOrchestratorDeps) {
    this.extractors = deps.extractors;
    this.importExecutor = deps.importExecutor;
    this.jobStore = deps.jobStore ?? new InMemoryIngestionJobStore();
    this.now = deps.now ?? (() => new Date());
    this.idFactory = deps.idFactory ?? (() => newTempId('ingest'));
  }

  private ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.importExecutor.initialize();
    }
    return this.initPromise;
  }

  /** Extract, validate and store a result for review. */
  async ingest(
    request: IngestionRequest,
    context?: ExtractionContext,
    ownerKeyId?: string
  ): Promise<IngestionPreview> {
    const jobId = this.idFactory();
    const createdAt = this.now().toISOString();
    const emptyExtraction: ExtractionResult = {
      events: [],
      arcs: [],
      relationships: [],
      sources: [],
      overallConfidence: 0,
    };

    const initialJob: IngestionJob = {
      id: jobId,
      source: request.source,
      status: 'extracting',
      progress: 0,
      createdAt,
      updatedAt: createdAt,
      extraction: emptyExtraction,
      validationIssues: [],
      ownerKeyId,
    };
    this.jobStore.set(initialJob);

    let extraction: ExtractionResult;
    try {
      extraction = await this.runExtractor(request, context);
    } catch (error) {
      this.jobStore.set({
        ...initialJob,
        status: 'failed',
        updatedAt: this.now().toISOString(),
      });
      throw error;
    }

    const validationIssues = validateExtraction(extraction);
    const updatedAt = this.now().toISOString();

    const job: IngestionJob = {
      id: jobId,
      source: extraction.events[0]?.source.type ?? request.source,
      status: 'review',
      progress: 100,
      createdAt,
      updatedAt,
      extraction,
      validationIssues,
      ownerKeyId,
    };
    this.jobStore.set(job);

    return { jobId: job.id, status: 'review', extraction, validationIssues };
  }

  private async runExtractor(
    request: IngestionRequest,
    context?: ExtractionContext
  ): Promise<ExtractionResult> {
    switch (request.source) {
      case 'wikipedia':
        return this.extractors.wikipedia.extract(request.wikipedia, context);
      case 'wikidata':
        return this.extractors.wikidata.extract(request.wikidata, context);
      case 'text':
        return this.extractors.text.extract(request.text, context);
    }
  }

  /** The job, or undefined when unknown or owned by a different API key. */
  getJob(jobId: string, ownerKeyId?: string): IngestionJob | undefined {
    const job = this.jobStore.get(jobId);
    if (!job) return undefined;
    if (job.ownerKeyId !== undefined && job.ownerKeyId !== ownerKeyId) return undefined;
    return job;
  }

  getPreview(jobId: string, ownerKeyId?: string): IngestionPreview {
    const job = this.requireJob(jobId, ownerKeyId);
    return {
      jobId: job.id,
      status: 'review',
      extraction: job.extraction,
      validationIssues: job.validationIssues,
    };
  }

  /** False for an unknown job, or one owned by a different API key. */
  deleteJob(jobId: string, ownerKeyId?: string): boolean {
    if (!this.getJob(jobId, ownerKeyId)) return false;
    return this.jobStore.delete(jobId);
  }

  /**
   * Apply reviewer edits and selection, re-validate, and import the result
   * through `ImportService`. Throws {@link IngestionJobNotFoundError} for an
   * unknown job (or one owned by another key), {@link IngestionJobStateError}
   * for a job that is not awaiting review, and {@link IngestionValidationError}
   * when the selected subset still has errors.
   */
  async approve(
    jobId: string,
    request: ApproveIngestionRequest,
    ownerKeyId?: string
  ): Promise<ImportResult> {
    const job = this.requireJob(jobId, ownerKeyId);
    if (job.status !== 'review') {
      throw new IngestionJobStateError(
        `Ingestion job ${job.id} is not awaiting review (status: ${job.status})`
      );
    }
    const selected = selectForImport(job.extraction, request);

    const issues = validateExtraction(selected);
    const errors = issues.filter((issue) => issue.severity === 'error');
    if (errors.length > 0) {
      throw new IngestionValidationError(errors);
    }

    const exportData = toAlthistoryExport(selected, {
      graphId: request.targetGraphId,
      graphName: 'Ingestion import',
      userId: request.userId,
      now: this.now,
    });

    await this.ensureInitialized();
    const result = await this.importExecutor.executeImport(exportData, {
      graphId: request.targetGraphId,
      mode: request.mode ?? 'merge',
      conflictResolution: request.conflictResolution ?? 'skip',
      userId: request.userId,
    });

    job.importResult = result;
    job.status = result.success ? 'imported' : 'failed';
    job.updatedAt = this.now().toISOString();
    this.jobStore.set(job);

    return result;
  }

  async destroy(): Promise<void> {
    if (this.importExecutor.destroy) {
      await this.importExecutor.destroy();
    }
  }

  private requireJob(jobId: string, ownerKeyId?: string): IngestionJob {
    const job = this.getJob(jobId, ownerKeyId);
    if (!job) throw new IngestionJobNotFoundError(jobId);
    return job;
  }
}

/** Apply edits and the approved selection to produce the subset to import. */
export function selectForImport(
  extraction: ExtractionResult,
  request: ApproveIngestionRequest
): ExtractionResult {
  const edits = request.edits ?? {};
  const events = extraction.events
    .map((event) => mergeEvent(event, edits[event.tempId]))
    .filter((event) =>
      hasApproved(request.approvedEventIds, event.tempId, event.selected)
    );
  const eventIds = new Set(events.map((event) => event.tempId));

  const arcs = extraction.arcs
    .map((arc) => mergeArc(arc, edits[arc.tempId]))
    .filter((arc) => hasApproved(request.approvedArcIds, arc.tempId, arc.selected));

  const relationships = extraction.relationships
    .filter((relationship) => eventIds.has(relationship.causeEventTempId))
    .filter((relationship) => eventIds.has(relationship.effectEventTempId))
    .filter((relationship) =>
      hasApproved(request.approvedRelationshipIds, relationship.tempId, relationship.selected)
    );

  return {
    events,
    arcs,
    relationships,
    sources: extraction.sources,
    overallConfidence: events.length > 0
      ? events.reduce((sum, event) => sum + event.confidence, 0) / events.length
      : 0,
  };
}

function hasApproved(approved: string[] | undefined, tempId: string, fallback: boolean): boolean {
  if (approved && approved.length > 0) return approved.includes(tempId);
  return fallback;
}

function mergeEvent(event: ExtractedEvent, edit: ExtractedEdit | undefined): ExtractedEvent {
  if (!edit) return event;
  return {
    ...event,
    description: typeof edit.description === 'string' ? edit.description : event.description,
    actor: typeof edit.actor === 'string' ? edit.actor : event.actor,
    target: typeof edit.target === 'string' ? edit.target : event.target,
    timestamp: typeof edit.timestamp === 'string' ? edit.timestamp : event.timestamp,
    confidence: typeof edit.confidence === 'number' ? edit.confidence : event.confidence,
    selected: typeof edit.selected === 'boolean' ? edit.selected : event.selected,
    edited: true,
  };
}

function mergeArc(arc: ExtractedArc, edit: ExtractedEdit | undefined): ExtractedArc {
  if (!edit) return arc;
  return {
    ...arc,
    name: typeof edit.name === 'string' ? edit.name : arc.name,
    description: typeof edit.description === 'string' ? edit.description : arc.description,
    start_time: typeof edit.start_time === 'string' ? edit.start_time : arc.start_time,
    end_time: typeof edit.end_time === 'string' ? edit.end_time : arc.end_time,
    level: typeof edit.level === 'number' ? edit.level : arc.level,
    confidence: typeof edit.confidence === 'number' ? edit.confidence : arc.confidence,
    selected: typeof edit.selected === 'boolean' ? edit.selected : arc.selected,
    edited: true,
  };
}

/**
 * Validation over an extraction. Errors block import; warnings are surfaced to
 * the reviewer. Mirrors the required-field rules `ImportService` enforces so a
 * reviewer sees the problem before approving rather than after.
 */
export function validateExtraction(extraction: ExtractionResult): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const eventIds = new Set<string>();
  const seen = new Set<string>();

  for (const event of extraction.events) {
    if (seen.has(event.tempId)) {
      issues.push(issue(event.tempId, 'event', 'error', 'Duplicate entity id in extraction'));
    }
    seen.add(event.tempId);
    eventIds.add(event.tempId);

    if (!event.description.trim()) {
      issues.push(issue(event.tempId, 'event', 'error', 'Event description is required'));
    }
    if (!event.actor.trim()) {
      issues.push(issue(event.tempId, 'event', 'error', 'Event actor is required'));
    }
    if (!event.target.trim()) {
      issues.push(issue(event.tempId, 'event', 'error', 'Event target is required'));
    }
    if (Number.isNaN(Date.parse(event.timestamp))) {
      issues.push(issue(event.tempId, 'event', 'error', `Invalid event timestamp: ${event.timestamp}`));
    } else if (Date.parse(event.timestamp) > Date.now()) {
      issues.push(issue(event.tempId, 'event', 'warning', 'Event timestamp is in the future'));
    }
    if (event.confidence < 0 || event.confidence > 1) {
      issues.push(issue(event.tempId, 'event', 'warning', 'Event confidence is outside 0..1'));
    }
  }

  for (const arc of extraction.arcs) {
    if (seen.has(arc.tempId)) {
      issues.push(issue(arc.tempId, 'arc', 'error', 'Duplicate entity id in extraction'));
    }
    seen.add(arc.tempId);

    if (!arc.name.trim()) {
      issues.push(issue(arc.tempId, 'arc', 'error', 'Arc name is required'));
    }
    const start = Date.parse(arc.start_time);
    const end = Date.parse(arc.end_time);
    if (Number.isNaN(start) || Number.isNaN(end)) {
      issues.push(issue(arc.tempId, 'arc', 'error', 'Arc start/end must be valid timestamps'));
    } else if (start > end) {
      issues.push(issue(arc.tempId, 'arc', 'error', 'Arc start_time is after end_time'));
    }
    if (arc.level < 0) {
      issues.push(issue(arc.tempId, 'arc', 'error', 'Arc level must be non-negative'));
    }
  }

  for (const relationship of extraction.relationships) {
    if (!eventIds.has(relationship.causeEventTempId)) {
      issues.push(issue(relationship.tempId, 'relationship', 'error', 'Relationship cause event is not part of the extraction'));
    }
    if (!eventIds.has(relationship.effectEventTempId)) {
      issues.push(issue(relationship.tempId, 'relationship', 'error', 'Relationship effect event is not part of the extraction'));
    }
    if (relationship.confidence < 0 || relationship.confidence > 1) {
      issues.push(issue(relationship.tempId, 'relationship', 'warning', 'Relationship confidence is outside 0..1'));
    }
  }

  return issues;
}

function issue(
  entityTempId: string,
  entityType: ValidationIssue['entityType'],
  severity: ValidationIssue['severity'],
  message: string
): ValidationIssue {
  return { entityTempId, entityType, severity, message };
}

export interface ExportConversionOptions {
  graphId?: string;
  graphName: string;
  userId?: string;
  now: () => Date;
}

/** Convert a reviewed extraction into the export shape `ImportService` accepts. */
export function toAlthistoryExport(
  extraction: ExtractionResult,
  options: ExportConversionOptions
): AlthistoryExport {
  const exportedAt = options.now().toISOString();

  const events: ExportedEvent[] = extraction.events.map((event) => ({
    id: event.tempId,
    description: event.description,
    actor: event.actor,
    target: event.target,
    timestamp: event.timestamp,
    metadata: {
      confidence: event.confidence,
      extractionSource: event.source.type,
      aiGenerated: event.source.type === 'llm',
      sourceUrl: event.source.url,
      articleTitle: event.source.articleTitle,
      wikidataId: event.source.wikidataId,
      edited: event.edited,
    },
    sourceRef: event.source.url,
  }));

  const arcs: ExportedArc[] = extraction.arcs.map((arc) => ({
    id: arc.tempId,
    name: arc.name,
    description: arc.description,
    start_time: arc.start_time,
    end_time: arc.end_time,
    level: arc.level,
    parent_arc_id: null,
    metadata: {
      confidence: arc.confidence,
      extractionSource: arc.source.type,
      aiGenerated: arc.source.type === 'llm',
      sourceUrl: arc.source.url,
    },
    sourceRef: arc.source.url,
  }));

  const relationships: ExportedRelationship[] = extraction.relationships.map((relationship) => ({
    id: relationship.tempId,
    cause_event_id: relationship.causeEventTempId,
    effect_event_id: relationship.effectEventTempId,
    weight: relationship.weight,
    evidence: relationship.reasoning,
    confidence: relationship.confidence,
    relationship_type: 'direct',
    sourceRef: relationship.source.url,
  }));

  const sources = buildProvenanceSources(extraction);
  const provenance: ExportProvenance = {
    sources,
    importHistory: [
      {
        id: options.now().toISOString(),
        importedAt: exportedAt,
        entityCount: events.length + arcs.length + relationships.length,
        userId: options.userId,
      },
    ],
  };

  const data = { events, arcs, causalRelationships: relationships, inferredPressures: [] };
  const checksum = crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');

  return {
    version: '1.0',
    metadata: {
      graphId: options.graphId ?? '',
      graphName: options.graphName,
      exportedAt,
      sourceVersion: '1.0.0',
      graphVersion: 0,
      checksum,
    },
    data,
    provenance,
  };
}

function buildProvenanceSources(extraction: ExtractionResult): DataSource[] {
  const byType = new Map<string, DataSource>();
  for (const source of extraction.sources) {
    const key = `${source.type}:${source.url ?? ''}`;
    const existing = byType.get(key);
    if (existing) {
      existing.entityIds = [...existing.entityIds, ...source.entityIds];
      existing.confidence = Math.max(existing.confidence, source.confidence);
    } else {
      byType.set(key, { ...source, entityIds: [...source.entityIds] });
    }
  }

  // Record the extraction model type even when an extractor supplied no
  // DataSource (e.g. an empty extraction), so provenance is always explicit.
  if (byType.size === 0) {
    byType.set('text-extraction', {
      id: 'text-extraction-source',
      type: 'text-extraction',
      accessedAt: new Date().toISOString(),
      confidence: 0,
      entityIds: [],
    });
  }

  return [...byType.values()];
}
